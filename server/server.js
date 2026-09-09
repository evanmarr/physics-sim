// Serves the static site AND a small JSON API for accounts + saved
// worlds/math items/cities, all from one origin. Keeping API and static
// files same-origin means the session cookie never has to cross origins,
// which sidesteps most CORS/CSRF footguns outright.
//
// Persistence is a real Postgres database (see db.js) — not a local JSON
// file — specifically so this also works when deployed somewhere
// serverless (Vercel), where there's no durable local disk and no shared
// memory between requests. This same handleApi() function is used both by
// the always-on server below (for local dev / a traditional host) and by
// api/[...path].js (the Vercel serverless entry point), so there's exactly
// one copy of the actual business logic.
//
// Password hashing uses Node's built-in crypto.scrypt (a real, memory-hard
// KDF, the same job bcrypt/argon2 do) — no dependency needed for that part.

import http from "node:http";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { unsubscribeToken } from "./unsubscribe.js";
import { sendEmail } from "./newsletter/mailer.js";
import * as db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

const MAX_WORLDS = 6;
const MAX_MATH_ITEMS = 6;
const MAX_CITIES = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB — generous for a saved scene, small enough to block abuse
const MAX_SHARED_ITEM_BYTES = 2 * 1024 * 1024;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_NAME_LEN = 60;
const MAX_EMAIL_LEN = 254;
const MAX_PASSWORD_LEN = 200;
const MAX_CLASSROOMS_PER_TEACHER = 20;
const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const VALID_TITLES = new Set(["teacher", "student", "independent"]);

function clampTitle(t) { return VALID_TITLES.has(t) ? t : "independent"; }
// Unlike clampName (worlds/classrooms, which fall back to "Untitled"), a
// blank first/last name should just stay blank — nobody's real name is
// "Untitled".
function clampPersonName(name) { return String(name ?? "").slice(0, MAX_NAME_LEN).trim(); }
function clampName(name) { return String(name ?? "").slice(0, MAX_NAME_LEN).trim() || "Untitled"; }

function publicUser(u) {
  return { email: u.email, subscribed: !!u.subscribed, firstName: u.first_name || "", lastName: u.last_name || "", title: u.title || "independent" };
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

// ---------- login rate limiting ----------
// Persisted in Postgres (see db.js) rather than an in-memory Map — a
// serverless instance wouldn't remember previous attempts otherwise,
// defeating the point of a lockout.

async function isLockedOut(key) {
  const rec = await db.getLoginAttempts(key);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > LOCKOUT_WINDOW_MS) { await db.clearLoginAttempts(key); return false; }
  return rec.count >= LOCKOUT_THRESHOLD;
}
async function recordFailedLogin(key) {
  const rec = await db.getLoginAttempts(key);
  if (!rec || Date.now() - rec.firstAt > LOCKOUT_WINDOW_MS) await db.recordLoginAttempt(key, 1, Date.now());
  else await db.recordLoginAttempt(key, rec.count + 1, rec.firstAt);
}
async function clearFailedLogins(key) { await db.clearLoginAttempts(key); }

// ---------- email verification codes ----------
// Sign in/up doesn't actually create a session until the emailed 6-digit
// code comes back correct — this closes the gap where someone guesses or
// reuses a leaked password, since they'd also need access to the account's
// actual inbox.

async function beginVerification(email, { kind, signupData }) {
  const token = crypto.randomBytes(32).toString("hex");
  const code = String(crypto.randomInt(1000000)).padStart(6, "0");
  await db.insertPendingVerification(token, email, kind, code, Date.now() + VERIFICATION_TTL_MS, signupData);
  await sendVerificationEmail(email, code);
  return token;
}

async function sendVerificationEmail(email, code) {
  await sendEmail({
    to: email,
    subject: `Your Continuum verification code: ${code}`,
    html: `<p>Your Continuum sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:.1em;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore it.</p>`,
  });
}

// ---------- sessions ----------

async function createSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.createSessionRow(token, email, Date.now() + SESSION_MAX_AGE_MS);
  return token;
}

async function sessionUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.sid;
  if (!token) return null;
  const session = await db.getSession(token);
  if (!session || Number(session.expires) < Date.now()) return null;
  const user = await db.getUser(session.email);
  return user ? session.email : null;
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

// ---------- saved-item collections (shared logic for worlds/mathItems/cities) ----------

async function listItems(email, kind) {
  return db.listSavedItems(email, kind);
}

async function createItem(email, kind, max, name, data) {
  const count = await db.countSavedItems(email, kind);
  if (count >= max) return { error: `You already have ${max} saved — delete one first.` };
  const item = { id: crypto.randomUUID(), name: clampName(name), data, updatedAt: Date.now() };
  await db.insertSavedItem(item.id, email, kind, item.name, item.data, item.updatedAt);
  return { item };
}

async function updateItem(email, kind, id, name, data) {
  const updatedAt = Date.now();
  const clampedName = clampName(name);
  const ok = await db.updateSavedItem(email, kind, id, clampedName, data, updatedAt);
  if (!ok) return { error: "Not found" };
  return { item: { id, name: clampedName, data, updatedAt } };
}

async function deleteItem(email, kind, id) {
  const ok = await db.deleteSavedItem(email, kind, id);
  if (!ok) return { error: "Not found" };
  return { ok: true };
}

// ---------- classrooms ----------
// Any signed-in account can create a classroom (becomes its teacher) and/or
// join one with a code (becomes a student in it) — there's no separate
// "teacher" vs "student" account type, since plenty of real people are
// both (a TA, a parent-teacher, someone auditing their own kid's class).

// Unambiguous alphabet — no 0/O or 1/I, so a code read aloud or handwritten
// on a whiteboard doesn't turn into a support request.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
async function generateClassCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
  } while (await db.classCodeExists(code));
  return code;
}

async function classroomsTaughtBy(email) { return db.classroomsTaughtByDb(email); }
async function classroomsJoinedBy(email) { return db.classroomsJoinedByDb(email); }

async function createClassroom(email, name) {
  const teachingCount = await db.countClassroomsTaughtBy(email);
  if (teachingCount >= MAX_CLASSROOMS_PER_TEACHER) return { error: `You already have ${MAX_CLASSROOMS_PER_TEACHER} classrooms — delete one first.` };
  const code = await generateClassCode();
  const createdAt = Date.now();
  const clampedName = clampName(name);
  await db.insertClassroom(code, email, clampedName, createdAt);
  return { classroom: { code, teacherEmail: email, name: clampedName, students: [], createdAt } };
}

async function joinClassroom(email, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  const classroom = await db.getClassroom(code);
  if (!classroom) return { error: "That class code doesn't match any classroom." };
  if (classroom.teacher_email === email) return { error: "You're the teacher of that classroom, not a student in it." };
  await db.addStudentToClassroom(code, email);
  return { classroom: { code: classroom.code, name: classroom.name, teacherEmail: classroom.teacher_email } };
}

async function leaveClassroom(email, code) {
  const ok = await db.removeStudentFromClassroom(code, email);
  if (!ok) return { error: "Not found" };
  return { ok: true };
}

async function deleteClassroom(email, code) {
  const classroom = await db.getClassroom(code);
  if (!classroom || classroom.teacher_email !== email) return { error: "Not found" };
  await db.deleteClassroomRow(code);
  return { ok: true };
}

// ---------- sharing worlds/math items with a classroom ----------
// A student shares one saved item up to their teacher; a teacher shares
// one down to every student in a class they teach. Either direction
// requires the sharer to actually be in that classroom — sharing isn't a
// general inbox, it only ever flows along an existing teacher/student
// relationship.

async function shareItem(email, { kind, name, data, classroomCode, direction }) {
  if (kind !== "worlds" && kind !== "mathItems") return { error: "Can only share Physics worlds or Mathematics items." };
  if (JSON.stringify(data ?? {}).length > MAX_SHARED_ITEM_BYTES) return { error: "That item is too large to share." };
  const classroom = await db.getClassroom(String(classroomCode || "").toUpperCase());
  if (!classroom) return { error: "That class code doesn't match any classroom." };
  if (direction === "to-teacher") {
    if (!(await db.isStudentInClassroom(classroom.code, email))) return { error: "You're not a student in that classroom." };
  } else if (direction === "to-students") {
    if (classroom.teacher_email !== email) return { error: "You're not the teacher of that classroom." };
  } else {
    return { error: "Invalid share direction." };
  }
  const item = {
    id: crypto.randomUUID(), kind, name: clampName(name), data,
    fromEmail: email, classroomCode: classroom.code, classroomName: classroom.name,
    direction, createdAt: Date.now(),
  };
  await db.insertSharedItem(item);
  return { item: { ...item, data: undefined } }; // the confirmation doesn't need to echo the payload back
}

// What shows up on a signed-in user's dashboard: items they're the
// recipient of, given who they are relative to each classroom (a teacher
// sees "to-teacher" shares from students in classes they teach; a student
// sees "to-students" shares from the teacher of classes they're in).
async function sharedItemsFor(email) {
  const teaching = (await classroomsTaughtBy(email)).map((c) => c.code);
  const joined = (await classroomsJoinedBy(email)).map((c) => c.code);
  return db.sharedItemsReceivedFor(teaching, joined);
}

async function sentItemsBy(email) { return db.sharedItemsSentBy(email); }

async function getSharedItemData(email, id) {
  const item = await db.getSharedItemById(id);
  if (!item) return { error: "Not found" };
  const teaching = new Set((await classroomsTaughtBy(email)).map((c) => c.code));
  const joined = new Set((await classroomsJoinedBy(email)).map((c) => c.code));
  const canSee = (item.direction === "to-teacher" && teaching.has(item.classroomCode)) || (item.direction === "to-students" && joined.has(item.classroomCode)) || item.fromEmail === email;
  if (!canSee) return { error: "Not found" };
  return { item };
}

// ---------- routes ----------

export async function handleApi(req, res, url) {
  await db.ensureSchema();
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const mutating = req.method !== "GET" && req.method !== "HEAD";
  if (mutating && !sameOriginOk(req)) return sendJson(res, 403, { error: "Cross-origin request blocked" });

  // Public — reached by clicking a link in an email, not by the app itself,
  // so there's no session and no same-origin fetch to rely on. The token
  // (not just knowing the address) is what proves the click is genuine.
  if (parts[1] === "unsubscribe" && req.method === "GET") {
    const email = validateEmail(url.searchParams.get("email"));
    const token = url.searchParams.get("token") || "";
    let secret = await db.getMeta("unsubscribeSecret");
    if (!secret) { secret = crypto.randomBytes(32).toString("hex"); await db.setMeta("unsubscribeSecret", secret); }
    const expected = email ? unsubscribeToken(email, secret) : "";
    const valid = email && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    res.writeHead(valid ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
    if (!valid) return res.end("<p>That unsubscribe link is invalid or has expired.</p>");
    await db.removeFromMailingList(email);
    const user = await db.getUser(email);
    if (user) await db.setUserSubscribed(email, false);
    return res.end("<p>You've been unsubscribed from the Continuum newsletter. Sorry to see you go.</p>");
  }

  if (parts[1] === "signup" && req.method === "POST") {
    const body = await readJsonBody(req);
    const email = validateEmail(body.email);
    if (!email) return sendJson(res, 400, { error: "Enter a valid email address." });
    const pwError = validatePassword(body.password);
    if (pwError) return sendJson(res, 400, { error: pwError });
    if (await db.getUser(email)) return sendJson(res, 409, { error: "An account with that email already exists." });
    const pendingToken = await beginVerification(email, {
      kind: "signup",
      signupData: {
        passwordHash: hashPassword(body.password), subscribed: !!body.subscribe,
        firstName: clampPersonName(body.firstName), lastName: clampPersonName(body.lastName), title: clampTitle(body.title),
      },
    });
    return sendJson(res, 200, { pending: true, token: pendingToken, email });
  }

  if (parts[1] === "login" && req.method === "POST") {
    const body = await readJsonBody(req);
    const email = validateEmail(body.email);
    const genericError = () => sendJson(res, 401, { error: "Invalid email or password." });
    if (!email || typeof body.password !== "string") return genericError();
    if (await isLockedOut(email)) return sendJson(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    const user = await db.getUser(email);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      await recordFailedLogin(email);
      return genericError();
    }
    await clearFailedLogins(email);
    const pendingToken = await beginVerification(email, { kind: "login" });
    return sendJson(res, 200, { pending: true, token: pendingToken, email });
  }

  if (parts[1] === "verify-code" && req.method === "POST") {
    const body = await readJsonBody(req);
    const pendingToken = String(body.token || "");
    const code = String(body.code || "").trim();
    const pending = await db.getPendingVerification(pendingToken);
    if (!pending || pending.expiresAt < Date.now()) {
      if (pending) await db.deletePendingVerification(pendingToken);
      return sendJson(res, 400, { error: "That code has expired — request a new one." });
    }
    const verifyKey = `verify:${pendingToken}`;
    if (await isLockedOut(verifyKey)) return sendJson(res, 429, { error: "Too many attempts. Request a new code." });
    if (code !== pending.code) {
      await recordFailedLogin(verifyKey);
      return sendJson(res, 400, { error: "That code isn't right." });
    }
    await db.deletePendingVerification(pendingToken);
    await clearFailedLogins(verifyKey);

    if (pending.kind === "signup") {
      const { email } = pending;
      if (await db.getUser(email)) return sendJson(res, 409, { error: "An account with that email already exists." }); // raced with another signup
      const createdAt = Date.now();
      await db.createUser(email, { ...pending.signupData, createdAt });
      if (pending.signupData.subscribed) await db.addToMailingList(email);
    }
    const token = await createSession(pending.email);
    setSessionCookie(res, req, token, SESSION_MAX_AGE_MS / 1000);
    return sendJson(res, 200, publicUser(await db.getUser(pending.email)));
  }

  if (parts[1] === "resend-code" && req.method === "POST") {
    const body = await readJsonBody(req);
    const pending = await db.getPendingVerification(String(body.token || ""));
    if (!pending || pending.expiresAt < Date.now()) return sendJson(res, 400, { error: "That code has expired — sign in again." });
    await sendVerificationEmail(pending.email, pending.code);
    return sendJson(res, 200, { ok: true });
  }

  if (parts[1] === "logout" && req.method === "POST") {
    const cookies = parseCookies(req.headers.cookie || "");
    if (cookies.sid) await db.deleteSession(cookies.sid);
    res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return sendJson(res, 200, { ok: true });
  }

  // Open to anyone, signed in or not — feedback shouldn't require an
  // account. If there is a session, the email rides along automatically so
  // a reply is possible without asking the person to type it in twice.
  if (parts[1] === "feedback" && req.method === "POST") {
    const body = await readJsonBody(req);
    const message = String(body.message || "").trim().slice(0, 4000);
    if (!message) return sendJson(res, 400, { error: "Feedback can't be empty." });
    const fromEmail = (await sessionUser(req)) || validateEmail(body.email) || null;
    await db.insertFeedback(crypto.randomUUID(), message, fromEmail, Date.now());
    return sendJson(res, 200, { ok: true });
  }

  // Everything past this point requires a signed-in session.
  const email = await sessionUser(req);
  if (parts[1] === "me") {
    if (!email) return sendJson(res, 401, { error: "Not signed in" });
    return sendJson(res, 200, publicUser(await db.getUser(email)));
  }
  if (!email) return sendJson(res, 401, { error: "Sign in to save and load your work." });

  if (parts[1] === "title" && req.method === "POST") {
    const body = await readJsonBody(req);
    await db.setUserTitle(email, clampTitle(body.title));
    return sendJson(res, 200, publicUser(await db.getUser(email)));
  }

  if (parts[1] === "classrooms") {
    if (parts.length === 2 && req.method === "GET") {
      return sendJson(res, 200, { teaching: await classroomsTaughtBy(email), joined: await classroomsJoinedBy(email) });
    }
    if (parts.length === 2 && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await createClassroom(email, body.name);
      return sendJson(res, result.error ? 400 : 200, result.error ? result : { classroom: result.classroom });
    }
    if (parts.length === 3 && parts[2] === "join" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await joinClassroom(email, body.code);
      return sendJson(res, result.error ? 400 : 200, result);
    }
    if (parts.length === 4 && parts[3] === "leave" && req.method === "POST") {
      const result = await leaveClassroom(email, String(parts[2] || "").toUpperCase());
      return sendJson(res, result.error ? 404 : 200, result);
    }
    if (parts.length === 3 && req.method === "DELETE") {
      const result = await deleteClassroom(email, String(parts[2] || "").toUpperCase());
      return sendJson(res, result.error ? 404 : 200, result);
    }
  }

  if (parts[1] === "shared-items") {
    if (parts.length === 2 && req.method === "GET") {
      return sendJson(res, 200, { received: await sharedItemsFor(email), sent: await sentItemsBy(email) });
    }
    if (parts.length === 2 && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await shareItem(email, body);
      return sendJson(res, result.error ? 400 : 200, result);
    }
    if (parts.length === 3 && req.method === "GET") {
      const result = await getSharedItemData(email, parts[2]);
      return sendJson(res, result.error ? 404 : 200, result);
    }
  }

  const collectionKey = parts[1] === "worlds" ? "worlds" : parts[1] === "math-items" ? "mathItems" : parts[1] === "cities" ? "cities" : null;
  const max = collectionKey === "worlds" ? MAX_WORLDS : collectionKey === "cities" ? MAX_CITIES : MAX_MATH_ITEMS;
  if (collectionKey) {
    if (parts.length === 2 && req.method === "GET") return sendJson(res, 200, { items: await listItems(email, collectionKey) });
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

// ---------- static file serving (local dev / traditional hosting only —
// on Vercel, static files are served directly by the platform instead) ----------

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

// ---------- standalone server entry point (local dev / any host that runs
// a persistent Node process) — skipped entirely when this file is only
// imported for its handleApi export, e.g. by api/[...path].js on Vercel ----------

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
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

  await db.ensureSchema();
  server.listen(PORT, () => {
    console.log(`Continuum server running at http://localhost:${PORT}`);
    // No host was passed to listen(), so this already accepts connections
    // from other devices on the same network, not just this machine —
    // printing the LAN address is just so you don't have to go find it
    // yourself to try that.
    for (const iface of Object.values(os.networkInterfaces()).flat()) {
      if (iface.family === "IPv4" && !iface.internal) {
        console.log(`  Also reachable on your network at: http://${iface.address}:${PORT}`);
      }
    }
  });
}
