// Dependency-free Node server: serves the static site AND a small JSON API
// for accounts + saved worlds/math items, all from one origin. Keeping API
// and static files same-origin means the session cookie never has to cross
// origins, which sidesteps most CORS/CSRF footguns outright.
//
// No npm packages: Node's built-in crypto.scrypt is a real, memory-hard
// password KDF (the same job bcrypt/argon2 do) so there's no dependency
// needed to hash passwords properly.

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unsubscribeToken } from "./unsubscribe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_FILE = path.join(__dirname, "data.json");
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

const MAX_WORLDS = 6;
const MAX_MATH_ITEMS = 6;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB — generous for a saved scene, small enough to block abuse
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_NAME_LEN = 60;
const MAX_EMAIL_LEN = 254;
const MAX_PASSWORD_LEN = 200;

// ---------- persistence ----------

function freshDb() {
  return { users: {}, sessions: {}, mailingList: [], unsubscribeSecret: crypto.randomBytes(32).toString("hex"), newsletter: { nextContentIndex: 0, lastSentAt: null } };
}

let db = freshDb();

async function loadDb() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    db = JSON.parse(raw);
    db.users ||= {};
    db.sessions ||= {};
    db.mailingList ||= [];
    // Generated once and persisted immediately — the monthly newsletter
    // script reads this same file to mint unsubscribe links, so it must
    // exist (and never change) before the first newsletter ever sends.
    const needsSave = !db.unsubscribeSecret || !db.newsletter;
    db.unsubscribeSecret ||= crypto.randomBytes(32).toString("hex");
    db.newsletter ||= { nextContentIndex: 0, lastSentAt: null };
    if (needsSave) await persist();
  } catch {
    db = freshDb();
    await persist();
  }
}

let writeQueue = Promise.resolve();
function persist() {
  // Serialize writes and go through a temp file + rename so a crash
  // mid-write can never leave data.json half-written/corrupt.
  writeQueue = writeQueue.then(async () => {
    const tmp = DATA_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, DATA_FILE);
  });
  return writeQueue;
}

// ---------- passwords ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function validateEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LEN) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > MAX_PASSWORD_LEN) {
    return "Password must be 8-200 characters.";
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

// ---------- login rate limiting (in-memory, resets on restart — fine, it's a deterrent not a ledger) ----------

const loginAttempts = new Map(); // email -> { count, first }
const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

function isLockedOut(email) {
  const rec = loginAttempts.get(email);
  if (!rec) return false;
  if (Date.now() - rec.first > LOCKOUT_WINDOW_MS) { loginAttempts.delete(email); return false; }
  return rec.count >= LOCKOUT_THRESHOLD;
}
function recordFailedLogin(email) {
  const rec = loginAttempts.get(email);
  if (!rec || Date.now() - rec.first > LOCKOUT_WINDOW_MS) loginAttempts.set(email, { count: 1, first: Date.now() });
  else rec.count++;
}
function clearFailedLogins(email) { loginAttempts.delete(email); }

// ---------- sessions ----------

function createSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = { email, expires: Date.now() + SESSION_MAX_AGE_MS };
  return token;
}

function sessionUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.sid;
  if (!token) return null;
  const session = db.sessions[token];
  if (!session || session.expires < Date.now()) return null;
  return db.users[session.email] ? session.email : null;
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, req, token, maxAgeSeconds) {
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
}

// ---------- HTTP helpers ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("Payload too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

// Defense-in-depth against cross-site requests riding a same-site cookie
// policy loophole: if the browser sent an Origin header for a mutating
// request, it must match this server's own host.
function sameOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === req.headers.host;
  } catch { return false; }
}

function clampName(name) {
  return String(name ?? "").slice(0, MAX_NAME_LEN).trim() || "Untitled";
}

// ---------- saved-item collections (shared logic for worlds + math items) ----------

function listItems(email, key) {
  return (db.users[email]?.[key] || []).map(({ id, name, updatedAt, data }) => ({ id, name, updatedAt, data }));
}

async function createItem(email, key, max, name, data) {
  const items = db.users[email][key];
  if (items.length >= max) return { error: `You already have ${max} saved — delete one first.` };
  const item = { id: crypto.randomUUID(), name: clampName(name), data, updatedAt: Date.now() };
  items.push(item);
  await persist();
  return { item };
}

async function updateItem(email, key, id, name, data) {
  const item = db.users[email][key].find((it) => it.id === id);
  if (!item) return { error: "Not found" };
  item.name = clampName(name);
  item.data = data;
  item.updatedAt = Date.now();
  await persist();
  return { item };
}

async function deleteItem(email, key, id) {
  const items = db.users[email][key];
  const next = items.filter((it) => it.id !== id);
  if (next.length === items.length) return { error: "Not found" };
  db.users[email][key] = next;
  await persist();
  return { ok: true };
}

// ---------- routes ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const mutating = req.method !== "GET" && req.method !== "HEAD";
  if (mutating && !sameOriginOk(req)) return sendJson(res, 403, { error: "Cross-origin request blocked" });

  // Public — reached by clicking a link in an email, not by the app itself,
  // so there's no session and no same-origin fetch to rely on. The token
  // (not just knowing the address) is what proves the click is genuine.
  if (parts[1] === "unsubscribe" && req.method === "GET") {
    const email = validateEmail(url.searchParams.get("email"));
    const token = url.searchParams.get("token") || "";
    const expected = email ? unsubscribeToken(email, db.unsubscribeSecret) : "";
    const valid = email && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    res.writeHead(valid ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
    if (!valid) return res.end("<p>That unsubscribe link is invalid or has expired.</p>");
    db.mailingList = db.mailingList.filter((e) => e !== email);
    if (db.users[email]) db.users[email].subscribed = false;
    await persist();
    return res.end("<p>You've been unsubscribed from the Continuum newsletter. Sorry to see you go.</p>");
  }

  if (parts[1] === "signup" && req.method === "POST") {
    const body = await readJsonBody(req);
    const email = validateEmail(body.email);
    if (!email) return sendJson(res, 400, { error: "Enter a valid email address." });
    const pwError = validatePassword(body.password);
    if (pwError) return sendJson(res, 400, { error: pwError });
    if (db.users[email]) return sendJson(res, 409, { error: "An account with that email already exists." });
    const subscribed = !!body.subscribe;
    db.users[email] = { passwordHash: hashPassword(body.password), subscribed, worlds: [], mathItems: [], createdAt: Date.now() };
    if (subscribed && !db.mailingList.includes(email)) db.mailingList.push(email);
    await persist();
    const token = createSession(email);
    setSessionCookie(res, req, token, SESSION_MAX_AGE_MS / 1000);
    return sendJson(res, 200, { email, subscribed });
  }

  if (parts[1] === "login" && req.method === "POST") {
    const body = await readJsonBody(req);
    const email = validateEmail(body.email);
    const genericError = () => sendJson(res, 401, { error: "Invalid email or password." });
    if (!email || typeof body.password !== "string") return genericError();
    if (isLockedOut(email)) return sendJson(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    const user = db.users[email];
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      recordFailedLogin(email);
      return genericError();
    }
    clearFailedLogins(email);
    const token = createSession(email);
    setSessionCookie(res, req, token, SESSION_MAX_AGE_MS / 1000);
    return sendJson(res, 200, { email, subscribed: !!user.subscribed });
  }

  if (parts[1] === "logout" && req.method === "POST") {
    const cookies = parseCookies(req.headers.cookie || "");
    if (cookies.sid) { delete db.sessions[cookies.sid]; await persist(); }
    res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return sendJson(res, 200, { ok: true });
  }

  // Everything past this point requires a signed-in session.
  const email = sessionUser(req);
  if (parts[1] === "me") {
    if (!email) return sendJson(res, 401, { error: "Not signed in" });
    return sendJson(res, 200, { email, subscribed: !!db.users[email].subscribed });
  }
  if (!email) return sendJson(res, 401, { error: "Sign in to save and load your work." });

  const collectionKey = parts[1] === "worlds" ? "worlds" : parts[1] === "math-items" ? "mathItems" : null;
  const max = collectionKey === "worlds" ? MAX_WORLDS : MAX_MATH_ITEMS;
  if (collectionKey) {
    if (parts.length === 2 && req.method === "GET") return sendJson(res, 200, { items: listItems(email, collectionKey) });
    if (parts.length === 2 && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await createItem(email, collectionKey, max, body.name, body.data);
      return sendJson(res, result.error ? 400 : 200, result.error ? result : { item: result.item });
    }
    if (parts.length === 3 && req.method === "PUT") {
      const body = await readJsonBody(req);
      const result = await updateItem(email, collectionKey, parts[2], body.name, body.data);
      return sendJson(res, result.error ? 404 : 200, result.error ? result : { item: result.item });
    }
    if (parts.length === 3 && req.method === "DELETE") {
      const result = await deleteItem(email, collectionKey, parts[2]);
      return sendJson(res, result.error ? 404 : 200, result);
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

// ---------- static file serving ----------

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  const resolved = path.normalize(path.join(ROOT, rel));
  if (!resolved.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) return serveStatic(req, res, pathname.replace(/\/?$/, "/index.html"));
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": stat.size });
    // An unhandled 'error' here (e.g. the file vanishing mid-read) would
    // otherwise crash the whole process — one bad request taking down every
    // other user's session — so it's a hard requirement, not just tidiness.
    fsSync.createReadStream(resolved).on("error", () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

// ---------- server ----------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((err) => {
      sendJson(res, err.status || 500, { error: err.status ? err.message : "Server error" });
    });
  } else {
    serveStatic(req, res, url.pathname);
  }
});

// A bug in one request handler shouldn't take down every other signed-in
// user's session — log it and keep serving instead of crashing the process.
process.on("uncaughtException", (err) => console.error("Unhandled error (server still running):", err));
process.on("unhandledRejection", (err) => console.error("Unhandled rejection (server still running):", err));

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use — something else (maybe an earlier run of this` +
      ` server, or the python/php static server) is still listening on it.\n` +
      `Find it with \`lsof -i :${PORT}\` and stop that process, or run this one on a different port:` +
      ` \`PORT=5174 node server/server.js\`.\n`);
    process.exit(1);
  }
  throw err;
});

await loadDb();
server.listen(PORT, () => {
  console.log(`Continuum server running at http://localhost:${PORT}`);
});
