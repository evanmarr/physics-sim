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
import { wrapEmailHtml } from "./emailTemplate.js";
import * as db from "./db.js";
import { resolveEntitlements, publicEntitlements, PLAN_SOURCES } from "./entitlements.js";
import { AI_MONTHLY_COST_CAP_USD, currentPeriodKey } from "./aiConfig.js";
import { PLAN_PRICING, PAYMENT_PROCESSOR, annualSavingsPct } from "./checkoutConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB — generous for a saved scene, small enough to block abuse
const MAX_SHARED_ITEM_BYTES = 2 * 1024 * 1024;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TRUSTED_DEVICE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
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
  return {
    email: u.email, subscribed: !!u.subscribed, firstName: u.first_name || "", lastName: u.last_name || "",
    title: u.title || "independent",
    // null = hasn't been through the onboarding quiz yet (see
    // src/onboarding.js) — {} means they explicitly skipped it.
    preferences: u.preferences ?? null,
    // See server/entitlements.js — the one source of truth for plan/AI
    // access. Never expose raw plan/plan_source/ai_enabled columns
    // directly; always route through resolveEntitlements first so lazy
    // expiry and the promo-can't-have-AI rule are actually applied.
    entitlements: publicEntitlements(resolveEntitlements(u)),
  };
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
    subject: `Your Kinetic verification code: ${code}`,
    html: wrapEmailHtml(`
      <p>Your Kinetic sign-in code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:.14em;color:#3b6fe0;margin:12px 0;">${code}</p>
      <p style="color:#6b7280;">This code expires in 10 minutes. If you didn't request this, you can ignore it — nothing happens without it.</p>
    `),
  });
}

// Fires on every blocked login attempt from a banned account, not just the
// first — mirrors sendVerificationEmail's per-attempt style. A banned
// account can only trigger this by attempting to sign in with its own
// correct password, so this never reaches anyone but the account holder.
async function sendBanNotice(email) {
  await sendEmail({
    to: email,
    subject: "Your Kinetic account has been suspended",
    html: wrapEmailHtml(`
      <p>Your Kinetic account (${email}) has been suspended and you will not be able to sign in.</p>
      <p style="color:#6b7280;">If you think this is a mistake, reply to this email.</p>
    `),
  });
}

// ---------- sessions ----------

async function createSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.createSessionRow(token, email, Date.now() + SESSION_MAX_AGE_MS);
  return token;
}

async function issueTrustedDevice(email) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.insertTrustedDevice(token, email, Date.now() + TRUSTED_DEVICE_MAX_AGE_MS);
  return token;
}

async function isDeviceTrustedFor(req, email) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.dvt;
  if (!token) return false;
  const trusted = await db.getTrustedDevice(token);
  return !!trusted && trusted.email === email && trusted.expiresAt > Date.now();
}

async function sessionUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.sid;
  if (!token) return null;
  const session = await db.getSession(token);
  if (!session || Number(session.expires) < Date.now()) return null;
  const user = await db.getUser(session.email);
  // Every authenticated route funnels through here, so this is also where
  // a ban placed mid-session takes effect — without it, banning someone
  // would only stop their NEXT login, not anything they're already doing.
  if (!user || user.banned) return null;
  return session.email;
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

// A response can need more than one Set-Cookie header at once (the session
// cookie plus the device-trust cookie, on a fresh verification) — plain
// res.setHeader("Set-Cookie", ...) called twice would silently overwrite
// the first with the second, so this appends onto whatever's already set.
function appendCookie(res, cookieString) {
  const existing = res.getHeader("Set-Cookie");
  const next = existing ? (Array.isArray(existing) ? [...existing, cookieString] : [existing, cookieString]) : [cookieString];
  res.setHeader("Set-Cookie", next);
}

function setSessionCookie(res, req, token, maxAgeSeconds) {
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  appendCookie(res, `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
}

function setDeviceTrustCookie(res, req, token, maxAgeSeconds) {
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  appendCookie(res, `dvt=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
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
// request, it must match this server's own host. On Vercel (and behind most
// reverse proxies), the inbound `host` header a serverless function actually
// sees isn't guaranteed to be the same string the browser's Origin reflects
// (edge routing can present an internal/deployment hostname) — the
// `x-forwarded-host` header is the standard place a proxy records the
// original public hostname, so a request is accepted if it matches either.
function sameOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const forwardedHost = req.headers["x-forwarded-host"];
    return originHost === req.headers.host || (!!forwardedHost && originHost === forwardedHost);
  } catch { return false; }
}

// ---------- saved-item collections (shared logic for worlds/mathItems/cities) ----------

async function listItems(email, kind) {
  return db.listSavedItems(email, kind);
}

async function createItem(email, kind, max, name, data, snapshot) {
  // max === null means unlimited (see server/entitlements.js's LIMITS) —
  // handled explicitly rather than falling into `count >= max`, since
  // `count >= null` coerces null to 0 and would wrongly block everyone.
  if (max !== null) {
    const count = await db.countSavedItems(email, kind);
    if (count >= max) {
      return { error: max === 0 ? "This is a Kinetic Plus feature." : `You already have ${max} saved — delete one first.` };
    }
  }
  const item = { id: crypto.randomUUID(), name: clampName(name), data, updatedAt: Date.now() };
  await db.insertSavedItem(item.id, email, kind, item.name, item.data, item.updatedAt, snapshot);
  return { item };
}

async function updateItem(email, kind, id, name, data, snapshot) {
  const updatedAt = Date.now();
  const clampedName = clampName(name);
  const ok = await db.updateSavedItem(email, kind, id, clampedName, data, updatedAt, snapshot);
  if (!ok) return { error: "Not found" };
  return { item: { id, name: clampedName, data, updatedAt } };
}

async function deleteItem(email, kind, id) {
  const ok = await db.deleteSavedItem(email, kind, id);
  if (!ok) return { error: "Not found" };
  return { ok: true };
}

// ---------- classrooms ----------
// Gated by the account's own Title (see clampTitle/VALID_TITLES): only a
// Teacher account can create a classroom, only a Student account can join
// one — an Independent account can do neither until they switch their
// Title in the account menu. This is enforced here, not just hidden in
// the UI, since the UI check alone would only stop an honest client.

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

// Same unambiguous alphabet/length as classroom codes — displayed to the
// user with a hyphen after the 4th character (e.g. "K7P4-X2") for
// readability, but stored/looked-up as the plain 6-character string.
async function generateWorldShareCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
  } while (await db.worldShareCodeExists(code));
  return code;
}

async function classroomsTaughtBy(email) { return db.classroomsTaughtByDb(email); }
async function classroomsJoinedBy(email) { return db.classroomsJoinedByDb(email); }

async function createClassroom(email, name) {
  const user = await db.getUser(email);
  if (user?.title !== "teacher") return { error: "Only a Teacher account can create a classroom — switch your Title to Teacher in the account menu." };
  const teachingCount = await db.countClassroomsTaughtBy(email);
  if (teachingCount >= MAX_CLASSROOMS_PER_TEACHER) return { error: `You already have ${MAX_CLASSROOMS_PER_TEACHER} classrooms — delete one first.` };
  const code = await generateClassCode();
  const createdAt = Date.now();
  const clampedName = clampName(name);
  await db.insertClassroom(code, email, clampedName, createdAt);
  return { classroom: { code, teacherEmail: email, name: clampedName, students: [], createdAt } };
}

async function joinClassroom(email, rawCode) {
  const user = await db.getUser(email);
  if (user?.title !== "student") return { error: "Only a Student account can join a classroom — switch your Title to Student in the account menu." };
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

// ---------- assignments ----------
// A teacher posts an assignment to one classroom they teach; every student
// in it sees it and can mark it done. Deliberately not a file-submission
// system — the "work" a student hands in is whatever they already save or
// share via shared_items above; an assignment is just a pointer to what to
// go do, plus a checkbox the teacher can see filling in across the roster.

const MAX_INSTRUCTIONS_LEN = 2000;

async function createAssignment(email, { classroomCode, title, instructions, dueAt }) {
  const classroom = await db.getClassroom(String(classroomCode || "").toUpperCase());
  if (!classroom) return { error: "That class code doesn't match any classroom." };
  if (classroom.teacher_email !== email) return { error: "You're not the teacher of that classroom." };
  const clampedTitle = clampName(title);
  const clampedInstructions = String(instructions ?? "").slice(0, MAX_INSTRUCTIONS_LEN).trim();
  const dueAtNum = dueAt ? Number(dueAt) : null;
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await db.insertAssignment(id, classroom.code, email, clampedTitle, clampedInstructions, dueAtNum, createdAt);
  return { assignment: { id, classroomCode: classroom.code, title: clampedTitle, instructions: clampedInstructions, dueAt: dueAtNum, createdAt, completedBy: [] } };
}

async function deleteAssignment(email, id) {
  const assignment = await db.getAssignment(id);
  if (!assignment || assignment.teacher_email !== email) return { error: "Not found" };
  await db.deleteAssignmentRow(id);
  return { ok: true };
}

async function setAssignmentComplete(email, id, completed) {
  const assignment = await db.getAssignment(id);
  if (!assignment) return { error: "Not found" };
  if (!(await db.isStudentInClassroom(assignment.classroom_code, email))) return { error: "You're not a student in that classroom." };
  await db.setAssignmentComplete(id, email, !!completed, Date.now());
  return { ok: true };
}

// Same shape for both sides so the client renders one list either way:
// a teacher sees every student's completion for each of their classrooms'
// assignments, a student sees just their own yes/no per assignment.
async function assignmentsFor(email) {
  const teaching = await classroomsTaughtBy(email);
  const joined = await classroomsJoinedBy(email);
  const teachingOut = [];
  for (const c of teaching) {
    const assignments = await db.assignmentsForClassroom(c.code);
    teachingOut.push({ classroomCode: c.code, classroomName: c.name, assignments });
  }
  const joinedOut = [];
  for (const c of joined) {
    const assignments = await db.assignmentsForClassroom(c.code);
    joinedOut.push({
      classroomCode: c.code, classroomName: c.name,
      assignments: assignments.map((a) => ({ id: a.id, title: a.title, instructions: a.instructions, dueAt: a.dueAt, createdAt: a.createdAt, completed: a.completedBy.includes(email) })),
    });
  }
  return { teaching: teachingOut, joined: joinedOut };
}

// ---------- sharing worlds/math items with a classroom ----------
// A student shares one saved item up to their teacher; a teacher shares
// one down to every student in a class they teach. Either direction
// requires the sharer to actually be in that classroom — sharing isn't a
// general inbox, it only ever flows along an existing teacher/student
// relationship.

const SHAREABLE_KINDS = new Set(["worlds", "mathItems", "cities", "notebookEntries", "aiChats", "whiteboards", "notes", "rocketFlights"]);
const MAX_SHARE_NOTE_LEN = 1000;

async function shareItem(email, { kind, name, data, classroomCode, direction, note, assignmentId }) {
  if (!SHAREABLE_KINDS.has(kind)) return { error: "That isn't something you can share." };
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
  // Attaching to an assignment only makes sense for a student submitting up
  // to their teacher — a teacher sharing something down isn't "responding"
  // to an assignment they themselves posted.
  let clampedAssignmentId = null;
  if (assignmentId) {
    if (direction !== "to-teacher") return { error: "Only a submission to a teacher can be attached to an assignment." };
    const assignment = await db.getAssignment(assignmentId);
    if (!assignment || assignment.classroom_code !== classroom.code) return { error: "That assignment isn't in this classroom." };
    clampedAssignmentId = assignmentId;
  }
  const item = {
    id: crypto.randomUUID(), kind, name: clampName(name), data,
    fromEmail: email, classroomCode: classroom.code, classroomName: classroom.name,
    direction, createdAt: Date.now(),
    note: String(note ?? "").slice(0, MAX_SHARE_NOTE_LEN).trim(), assignmentId: clampedAssignmentId,
  };
  await db.insertSharedItem(item);
  return { item: { ...item, data: undefined } }; // the confirmation doesn't need to echo the payload back
}

// ---------- Community Sims ----------
// Publishing is always an explicit, separate action from saving — a saved
// world never becomes public on its own. A published sim is a standalone
// copy in its own table, so editing (or even deleting) your private saved
// world afterward never changes what other people already see published.

const MAX_COMMUNITY_SIM_BYTES = 2 * 1024 * 1024;
const MAX_DESCRIPTION_LEN = 400;

// The 6-digit unlock code (see src/panel.js's Locked checkbox) is hashed
// before it ever touches the database — a plain sha256 is plenty here since
// this is a lightweight "don't let a remixer casually break my setup"
// feature, not account security, but there's still no reason to store or
// transmit the raw digits when a hash does the same comparison job.
function hashLockCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

async function creatorDisplayName(email) {
  const user = await db.getUser(email);
  return [user?.first_name, user?.last_name].filter(Boolean).join(" ") || email.split("@")[0];
}

async function publishCommunitySim(email, { kind, name, description, subject, data, snapshot, lockCode }) {
  if (kind !== "worlds" && kind !== "math-items") return { error: "Can only publish Physics worlds or Mathematics items." };
  if (JSON.stringify(data ?? {}).length > MAX_COMMUNITY_SIM_BYTES) return { error: "That item is too large to publish." };
  if (lockCode && !/^\d{6}$/.test(String(lockCode))) return { error: "The unlock code must be exactly 6 digits." };
  const creatorName = await creatorDisplayName(email);
  const sim = {
    id: crypto.randomUUID(), ownerEmail: email, creatorName, kind, name: clampName(name),
    description: String(description ?? "").slice(0, MAX_DESCRIPTION_LEN).trim(),
    subject: String(subject ?? "").slice(0, 60).trim(),
    data, snapshot: typeof snapshot === "string" ? snapshot.slice(0, 200000) : null,
    createdAt: Date.now(),
  };
  const lockCodeHash = lockCode ? hashLockCode(lockCode) : null;
  await db.insertCommunitySim(sim.id, sim.ownerEmail, sim.creatorName, sim.kind, sim.name, sim.description, sim.subject, sim.data, sim.snapshot, sim.createdAt, lockCodeHash);
  // Every publish here is a brand-new community_sims row (never an edit —
  // editing your own private saved world never touches this table), so
  // this is exactly "a creator you subscribed to publishes a NEW public
  // world," never a republish/edit notification.
  const subscribers = await db.listSubscriberEmails(email);
  for (const subscriberEmail of subscribers) {
    await db.insertNewWorldNotification({ recipientEmail: subscriberEmail, creatorName, simId: sim.id, simName: sim.name });
  }
  return { sim: { ...sim, data: undefined, hasLock: !!lockCodeHash } };
}

// Remix = a real, independent copy in the caller's OWN saved items —
// "never edits the original" isn't just a UI restriction, the remixed
// world is a brand-new saved_items row with a new id from the moment it's
// created, with no ongoing link back to the community sim it came from.
// community_sims.kind stores the same client-facing string used everywhere
// else ("worlds" / "math-items"), but saved_items has always used a
// slightly different internal key for the math case ("mathItems") — this
// bridges the two rather than introducing a third spelling.
const SAVED_ITEM_KIND = { worlds: "worlds", "math-items": "mathItems" };

async function remixCommunitySim(email, simId) {
  const sim = await db.getCommunitySim(simId);
  if (!sim) return { error: "Not found" };
  const savedKind = SAVED_ITEM_KIND[sim.kind] || sim.kind;
  const count = await db.countSavedItems(email, savedKind);
  const limits = resolveEntitlements(await db.getUser(email)).limits;
  const max = sim.kind === "worlds" ? limits.maxWorlds : limits.maxMathItems;
  if (count >= max) return { error: `You already have ${max} saved ${sim.kind === "worlds" ? "worlds" : "items"} — delete one first, then remix.` };
  const item = { id: crypto.randomUUID(), name: clampName(`${sim.name} (remix)`), data: sim.data, updatedAt: Date.now() };
  // Propagate the original's lock (if any) onto the remixed copy too — a
  // remix is "your own editable copy" of the WORLD, not a bypass of
  // whatever the creator chose to protect within it.
  const lockCodeHash = await db.getCommunitySimLockHash(simId);
  await db.insertSavedItem(item.id, email, savedKind, item.name, item.data, item.updatedAt, sim.snapshot, lockCodeHash);
  await db.incrementRemixCount(simId);
  // Never notify yourself for remixing your own published world.
  if (sim.ownerEmail !== email) {
    const actorName = await creatorDisplayName(email);
    await db.upsertInteractionNotification({ recipientEmail: sim.ownerEmail, actorName, simId: sim.id, simName: sim.name, verb: "remixed" });
  }
  return { item: { ...item, hasLock: !!lockCodeHash } };
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
    return res.end("<p>You've been unsubscribed from the Kinetic newsletter. Sorry to see you go.</p>");
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
    // Checked only after the password's already confirmed valid, so a
    // banned account's login attempt doesn't leak anything a wrong
    // password attempt wouldn't (both would otherwise look identical from
    // the outside, this just says which one this particular case is).
    if (user.banned) {
      await sendBanNotice(email);
      return sendJson(res, 403, { error: "Your account was banned." });
    }
    // A password alone got them this far, but this browser needs to have
    // proven it can read the inbox at least once before — at this account's
    // signup, or a prior login here — to skip straight past the code step.
    if (await isDeviceTrustedFor(req, email)) {
      const token = await createSession(email);
      setSessionCookie(res, req, token, SESSION_MAX_AGE_MS / 1000);
      return sendJson(res, 200, publicUser(user));
    }
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
    } else {
      // A login can only reach this step after a password was already
      // verified, so re-check ban status here too — otherwise a ban placed
      // between that step and code entry would go unenforced.
      const user = await db.getUser(pending.email);
      if (user?.banned) {
        await sendBanNotice(pending.email);
        return sendJson(res, 403, { error: "Your account was banned." });
      }
    }
    const token = await createSession(pending.email);
    setSessionCookie(res, req, token, SESSION_MAX_AGE_MS / 1000);
    // Reading the code from this inbox just now is exactly the proof this
    // browser needs to skip the code step on future sign-ins — mark it
    // trusted right here, whether this was a signup or a login.
    const deviceToken = await issueTrustedDevice(pending.email);
    setDeviceTrustCookie(res, req, deviceToken, TRUSTED_DEVICE_MAX_AGE_MS / 1000);
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

  // Community Sims browsing is public — no account needed to look around,
  // same as walking into a gallery. Publishing/remixing/favoriting/
  // reporting (below, past the session gate) does need one.
  //
  // Every route below is intentionally exactly one path segment
  // (/api/<name>), with any id/action carried as a query param or request
  // body instead of extra path segments (/api/<name>/<id>/<action>) — a
  // hosting quirk on this project only routes single-segment /api/* paths
  // correctly, silently 404ing anything deeper before it ever reaches this
  // function. Flattening the API sidesteps that regardless of whether the
  // underlying platform issue ever gets fixed.
  if (parts[1] === "community-sims" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (id) {
      const sim = await db.getCommunitySim(id);
      if (!sim) return sendJson(res, 404, { error: "Not found" });
      return sendJson(res, 200, { sim });
    }
    // "mine=1" (a signed-in viewer's own favorite ids) needs `email`, so
    // it's handled again further down past the session gate — this GET
    // branch only needs to not swallow that request itself.
    if (url.searchParams.get("mine") !== "1") {
      const kind = url.searchParams.get("kind") || undefined;
      const subject = url.searchParams.get("subject") || undefined;
      return sendJson(res, 200, { sims: await db.listCommunitySims({ kind, subject }) });
    }
  }
  if (parts[1] === "community-sims-featured" && req.method === "GET") {
    return sendJson(res, 200, { sims: await db.listCommunitySims({ featuredOnly: true }) });
  }

  // Loading a Physics world share code is deliberately public (no sign-in
  // required) — generating one is the Plus-gated half (see the
  // authenticated /world-share POST route below). Anyone with the code
  // can load it; it never appears in any listing regardless.
  if (parts[1] === "world-share" && req.method === "GET") {
    const code = String(url.searchParams.get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z0-9]{6}$/.test(code)) return sendJson(res, 400, { error: "Enter a 6-character code." });
    const found = await db.getWorldShareCode(code);
    if (!found) return sendJson(res, 404, { error: "That code doesn't match a shared world." });
    return sendJson(res, 200, found);
  }

  // Public so the Weekly Challenge card can show "N people completed this"
  // to a signed-out visitor too, same as a community sim's favorite count.
  if (parts[1] === "weekly-challenge-count" && req.method === "GET") {
    const week = String(url.searchParams.get("week") || "").slice(0, 20);
    if (!week) return sendJson(res, 400, { error: "Missing week." });
    return sendJson(res, 200, { count: await db.countWeeklyChallengeCompletions(week) });
  }

  // Everything past this point requires a signed-in session.
  const email = await sessionUser(req);
  if (parts[1] === "me") {
    if (!email) return sendJson(res, 401, { error: "Not signed in" });
    return sendJson(res, 200, publicUser(await db.getUser(email)));
  }
  if (!email) return sendJson(res, 401, { error: "Sign in to save and load your work." });

  // Idempotent — safe to call every time the client sees the weekly
  // challenge complete, not just the first (see db.js's ON CONFLICT DO
  // NOTHING keyed on (week_key, email)).
  if (parts[1] === "weekly-challenge-complete" && req.method === "POST") {
    const body = await readJsonBody(req);
    const week = String(body.week || "").slice(0, 20);
    const challengeId = String(body.challengeId || "").slice(0, 80);
    if (!week || !challengeId) return sendJson(res, 400, { error: "Missing week or challengeId." });
    await db.recordWeeklyChallengeCompletion(week, challengeId, email, Date.now());
    return sendJson(res, 200, { count: await db.countWeeklyChallengeCompletions(week) });
  }

  // Every challenge this account has ever completed, across all 12
  // sandboxes — fetched once at sign-in/load and merged into the client's
  // local state.completedChallenges (see main.js), so Achievements/badges
  // and each sandbox's own "(Completed)" markers follow the ACCOUNT
  // instead of being stuck on whichever browser/device first earned them.
  if (parts[1] === "challenge-completions" && req.method === "GET") {
    return sendJson(res, 200, { completed: await db.getChallengeCompletions(email) });
  }

  // Idempotent, same as weekly-challenge-complete above — safe to call
  // every time a challenge completes locally, not just the first (ON
  // CONFLICT DO NOTHING keyed on (email, challenge_id)).
  if (parts[1] === "challenge-complete" && req.method === "POST") {
    const body = await readJsonBody(req);
    const challengeId = String(body.challengeId || "").slice(0, 80);
    if (!challengeId) return sendJson(res, 400, { error: "Missing challengeId." });
    await db.recordChallengeCompletion(email, challengeId, Date.now());
    return sendJson(res, 200, { ok: true });
  }

  if (parts[1] === "title" && req.method === "POST") {
    const body = await readJsonBody(req);
    await db.setUserTitle(email, clampTitle(body.title));
    return sendJson(res, 200, publicUser(await db.getUser(email)));
  }

  // The onboarding quiz (src/onboarding.js) writes here once, whether
  // finished or skipped ({} either way marks it done) — and again anytime
  // afterward, since the answers stay editable from the account menu.
  if (parts[1] === "preferences" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (typeof body.preferences !== "object" || body.preferences === null || Array.isArray(body.preferences)) {
      return sendJson(res, 400, { error: "Invalid preferences." });
    }
    if (JSON.stringify(body.preferences).length > 4000) return sendJson(res, 400, { error: "That's too much data." });
    await db.setUserPreferences(email, body.preferences);
    return sendJson(res, 200, publicUser(await db.getUser(email)));
  }

  // AI Tutor status — architecture only (see server/aiConfig.js). Reflects
  // real entitlement/usage state, but nothing behind this route ever
  // calls a real AI provider; aiEnabled is false for every account today
  // since nothing sets the ai_enabled column true yet.
  if (parts[1] === "ai-status" && req.method === "GET") {
    const ents = resolveEntitlements(await db.getUser(email));
    const periodKey = currentPeriodKey();
    const usage = await db.getAiUsage(email, periodKey);
    return sendJson(res, 200, {
      aiEnabled: ents.aiEnabled,
      capUsd: AI_MONTHLY_COST_CAP_USD,
      usedUsd: usage.estimatedCostUsd,
      remainingUsd: Math.max(0, AI_MONTHLY_COST_CAP_USD - usage.estimatedCostUsd),
      periodKey,
    });
  }

  // AI Tutor chat — architecture only, same as ai-status above. No real AI
  // provider is wired up anywhere in this codebase (see server/aiConfig.js),
  // so this deliberately never attempts a real call and always returns the
  // same honest, non-fabricated error — a stub, not a mock of a working
  // feature. Kept server-side (rather than a client-only canned string) so
  // swapping in a real provider later is a change to this one route, not a
  // client rewrite.
  if (parts[1] === "ai-chat" && req.method === "POST") {
    if (!email) return sendJson(res, 401, { error: "Sign in first." });
    await readJsonBody(req); // drain the request body; the message itself is never used or stored
    return sendJson(res, 200, { reply: "Sorry, I encountered a problem. Please try again later, or contact kinetic.sims@gmail.com" });
  }

  // Checkout pricing — public (shown on the Plans page before sign-in).
  // `connected: false` is what the client actually uses to decide whether
  // to route to a real payment step or the "not live yet" placeholder — see
  // server/checkoutConfig.js.
  if (parts[1] === "checkout-config" && req.method === "GET") {
    return sendJson(res, 200, {
      pricing: PLAN_PRICING,
      annualSavingsPct: { plus: annualSavingsPct("plus"), teacher: annualSavingsPct("teacher") },
      processorConnected: PAYMENT_PROCESSOR.connected,
    });
  }

  // Records "reached the end of checkout and would have paid" so real
  // demand isn't lost while no payment processor is connected (see
  // server/checkoutConfig.js) — never a charge, just a signal for when
  // billing goes live. Needs a session since it's tied to a real account.
  if (parts[1] === "upgrade-interest" && req.method === "POST") {
    if (!email) return sendJson(res, 401, { error: "Sign in first." });
    const body = await readJsonBody(req);
    const plan = String(body.plan || "");
    const billingPeriod = String(body.billingPeriod || "");
    if (!PLAN_PRICING[plan]) return sendJson(res, 400, { error: "Unknown plan." });
    if (!["monthly", "annual"].includes(billingPeriod)) return sendJson(res, 400, { error: "Unknown billing period." });
    await db.recordUpgradeInterest(email, plan, billingPeriod);
    return sendJson(res, 200, { ok: true });
  }

  // Promo code redemption — see src/plans.js for the client side and
  // ~/physics-sim-admin for where codes are actually created/managed.
  // Deliberately server-only validation: the valid-code list never reaches
  // browser JS, and every failure mode returns a generic-enough message
  // that it doesn't help an attacker distinguish "wrong code" from "right
  // code, already used by someone else." Throttled the same way
  // login/admin-code/unlock-code already are, keyed per account, so
  // brute-forcing the 6-digit space isn't practical from one session.
  if (parts[1] === "promo-redeem" && req.method === "POST") {
    const body = await readJsonBody(req);
    const code = String(body.code || "").trim();
    if (!/^\d{6}$/.test(code)) return sendJson(res, 400, { error: "Enter a 6-digit code." });
    const throttleKey = `promo:${email}`;
    if (await isLockedOut(throttleKey)) return sendJson(res, 429, { error: "Too many attempts. Try again in a few minutes." });

    const promo = await db.getPromoCode(code);
    if (!promo) {
      await recordFailedLogin(throttleKey);
      return sendJson(res, 200, { ok: false, reason: "invalid" });
    }
    if (!promo.active) return sendJson(res, 200, { ok: false, reason: "deactivated" });
    if (promo.expires_at && Date.now() >= Number(promo.expires_at)) return sendJson(res, 200, { ok: false, reason: "expired" });
    if (await db.hasRedeemedPromoCode(code, email)) return sendJson(res, 200, { ok: false, reason: "already_redeemed" });
    if (promo.max_redemptions != null && promo.redemption_count >= promo.max_redemptions) {
      return sendJson(res, 200, { ok: false, reason: "limit_reached" });
    }

    try {
      await db.insertPromoRedemption(code, email);
    } catch (err) {
      // Unique-violation on (code, user_email) — a race between two
      // near-simultaneous redemption attempts from the same account lost
      // to the DB's own constraint; treat it exactly like "already redeemed."
      if (err?.code === "23505") return sendJson(res, 200, { ok: false, reason: "already_redeemed" });
      throw err;
    }
    await clearFailedLogins(throttleKey);

    // Never downgrade a stronger existing grant (paid Plus, or Teacher) —
    // the redemption above is still recorded either way, so it doesn't
    // look like the code failed; it just doesn't need to change anything.
    const current = resolveEntitlements(await db.getUser(email));
    if (!current.isPlus) {
      const expiresAt = promo.access_days ? Date.now() + promo.access_days * 24 * 60 * 60 * 1000 : null;
      await db.setUserPlan(email, "plus", PLAN_SOURCES.PROMO_PLUS, expiresAt);
    }
    return sendJson(res, 200, { ok: true, user: publicUser(await db.getUser(email)) });
  }

  if (parts[1] === "classrooms") {
    if (req.method === "GET") {
      return sendJson(res, 200, { teaching: await classroomsTaughtBy(email), joined: await classroomsJoinedBy(email) });
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await createClassroom(email, body.name);
      return sendJson(res, result.error ? 400 : 200, result.error ? result : { classroom: result.classroom });
    }
    if (req.method === "DELETE") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const result = await deleteClassroom(email, code);
      return sendJson(res, result.error ? 404 : 200, result);
    }
  }
  if (parts[1] === "classroom-join" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await joinClassroom(email, body.code);
    return sendJson(res, result.error ? 400 : 200, result);
  }
  if (parts[1] === "classroom-leave" && req.method === "POST") {
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    const result = await leaveClassroom(email, code);
    return sendJson(res, result.error ? 404 : 200, result);
  }

  if (parts[1] === "assignments") {
    if (req.method === "GET") {
      return sendJson(res, 200, await assignmentsFor(email));
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await createAssignment(email, body);
      return sendJson(res, result.error ? 400 : 200, result.error ? result : { assignment: result.assignment });
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      const result = await deleteAssignment(email, id);
      return sendJson(res, result.error ? 404 : 200, result);
    }
  }
  if (parts[1] === "assignment-complete" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await setAssignmentComplete(email, body.id, body.completed);
    return sendJson(res, result.error ? 400 : 200, result);
  }

  if (parts[1] === "community-sims") {
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await publishCommunitySim(email, body);
      return sendJson(res, result.error ? 400 : 200, result.error ? result : { sim: result.sim });
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      const ok = id && (await db.unpublishCommunitySim(id, email));
      if (!ok) return sendJson(res, 404, { error: "Not found, or you're not the one who published it." });
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.searchParams.get("mine") === "1") {
      return sendJson(res, 200, { favoriteIds: await db.listFavoriteSimIds(email) });
    }
  }
  if (parts[1] === "community-sim-favorite" && req.method === "POST") {
    const simId = url.searchParams.get("id");
    const favorited = await db.toggleFavorite(email, simId);
    // Only the transition TO favorited notifies — unfavoriting is silent,
    // and never notify yourself for favoriting your own published world.
    if (favorited) {
      const sim = await db.getCommunitySim(simId);
      if (sim && sim.ownerEmail !== email) {
        const actorName = await creatorDisplayName(email);
        await db.upsertInteractionNotification({ recipientEmail: sim.ownerEmail, actorName, simId: sim.id, simName: sim.name, verb: "favorited" });
      }
    }
    return sendJson(res, 200, { favorited });
  }
  if (parts[1] === "community-sim-report" && req.method === "POST") {
    const reportCount = await db.reportSim(email, url.searchParams.get("id"));
    return sendJson(res, 200, { ok: true, reportCount });
  }
  if (parts[1] === "community-sim-remix" && req.method === "POST") {
    const result = await remixCommunitySim(email, url.searchParams.get("id"));
    return sendJson(res, result.error ? 404 : 200, result.error ? result : { item: result.item });
  }

  // ---------- notification center ----------
  // Every query below is scoped to `email` (the caller's own session) in
  // the WHERE clause — see db.js's listNotifications/markNotificationsRead/
  // markAllNotificationsRead — so one account can never read or mark
  // another account's notifications, including by guessing an id.
  if (parts[1] === "notifications" && req.method === "GET") {
    const [notifications, unreadCount] = await Promise.all([
      db.listNotifications(email),
      db.countUnreadNotifications(email),
    ]);
    return sendJson(res, 200, { notifications, unreadCount });
  }
  // body.read === false marks the given ids UNREAD (reopening them);
  // anything else (or body.all) marks read, same as before.
  if (parts[1] === "notifications-read" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (body.all) await db.markAllNotificationsRead(email);
    else if (Array.isArray(body.ids) && body.ids.length) {
      const ids = body.ids.map(String);
      if (body.read === false) await db.markNotificationsUnread(email, ids);
      else await db.markNotificationsRead(email, ids);
    }
    const unreadCount = await db.countUnreadNotifications(email);
    return sendJson(res, 200, { ok: true, unreadCount });
  }

  // "Subscribe to a creator" (never "follow" — see db.js's comment on
  // creator_subscriptions) — GET returns which creators the caller is
  // subscribed to (so a Community Sims card can show the right button
  // state), POST toggles one.
  if (parts[1] === "creator-subscribe" && req.method === "GET") {
    return sendJson(res, 200, { creatorEmails: await db.listSubscribedCreatorEmails(email) });
  }
  if (parts[1] === "creator-subscribe" && req.method === "POST") {
    const body = await readJsonBody(req);
    const creatorEmail = String(body.creatorEmail || "").trim().toLowerCase();
    if (!creatorEmail) return sendJson(res, 400, { error: "Missing creator." });
    if (creatorEmail === email) return sendJson(res, 400, { error: "You can't subscribe to yourself." });
    const subscribed = await db.toggleCreatorSubscription(email, creatorEmail);
    // Only the transition TO subscribed notifies — unsubscribing is silent,
    // matching the same rule favoriting/remixing follows.
    if (subscribed) {
      const actorName = await creatorDisplayName(email);
      await db.upsertSubscribeNotification({ recipientEmail: creatorEmail, actorName });
    }
    return sendJson(res, 200, { subscribed });
  }
  // Verifies a Locked object's 6-digit unlock code (see src/panel.js) —
  // `kind` is "community-sim" for a Community Sims Open/shared link, or a
  // saved_items kind ("worlds") for a world already remixed into someone's
  // My Worlds. Same failed-attempt throttling as login, keyed per world so
  // one bad guesser can't hammer it, and the response never reveals whether
  // the world has a code at all — just whether this one matched.
  if (parts[1] === "unlock-code" && req.method === "POST") {
    const body = await readJsonBody(req);
    const kind = String(body.kind || "");
    const id = String(body.id || "");
    const code = String(body.code || "");
    if (!id || !/^\d{6}$/.test(code)) return sendJson(res, 400, { error: "Enter a 6-digit code." });
    const throttleKey = `unlock:${kind}:${id}`;
    if (await isLockedOut(throttleKey)) return sendJson(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    const hash = await db.getLockHash(kind, id);
    if (!hash || hashLockCode(code) !== hash) {
      await recordFailedLogin(throttleKey);
      return sendJson(res, 200, { ok: false });
    }
    await clearFailedLogins(throttleKey);
    return sendJson(res, 200, { ok: true });
  }


  if (parts[1] === "shared-items") {
    const id = url.searchParams.get("id");
    if (req.method === "GET" && id) {
      const result = await getSharedItemData(email, id);
      return sendJson(res, result.error ? 404 : 200, result);
    }
    if (req.method === "GET") {
      return sendJson(res, 200, { received: await sharedItemsFor(email), sent: await sentItemsBy(email) });
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await shareItem(email, body);
      return sendJson(res, result.error ? 400 : 200, result);
    }
  }

  // Generating a Physics world share code — Plus only. Promo Plus counts
  // (shareCodesEnabled is a normal non-AI Plus limit), matching the
  // product rule that promo access includes every non-AI Plus feature.
  if (parts[1] === "world-share" && req.method === "POST") {
    const limits = resolveEntitlements(await db.getUser(email)).limits;
    if (!limits.shareCodesEnabled) return sendJson(res, 403, { error: "World sharing codes are a Kinetic Plus feature." });
    const body = await readJsonBody(req);
    const kind = String(body.kind || "worlds");
    if (!body.data || typeof body.data !== "object") return sendJson(res, 400, { error: "Nothing to share." });
    if (JSON.stringify(body.data).length > MAX_BODY_BYTES) return sendJson(res, 400, { error: "That world is too large to share." });
    const code = await generateWorldShareCode();
    await db.createWorldShareCode(code, email, kind, body.data);
    return sendJson(res, 200, { code });
  }

  // "custom-items" (Kinetic Plus's saved Custom Physics Items — see
  // src/customItems.js) reuses this exact same generic saved_items
  // machinery as worlds/math-items/cities. Free's maxCustomItems is 0 (see
  // server/entitlements.js), so createItem's own over-limit check is
  // already the entitlement gate here — no separate 403 branch needed.
  const collectionKey = parts[1] === "worlds" ? "worlds" : parts[1] === "math-items" ? "mathItems" : parts[1] === "cities" ? "cities"
    : parts[1] === "custom-items" ? "customItems" : parts[1] === "notebook" ? "notebookEntries"
    : parts[1] === "ai-chats" ? "aiChats" : parts[1] === "whiteboards" ? "whiteboards" : parts[1] === "notes" ? "notes"
    : parts[1] === "rocket-flights" ? "rocketFlights" : null;
  if (collectionKey) {
    if (req.method === "GET") return sendJson(res, 200, { items: await listItems(email, collectionKey) });
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const limits = resolveEntitlements(await db.getUser(email)).limits;
      const max = collectionKey === "worlds" ? limits.maxWorlds : collectionKey === "cities" ? limits.maxCities
        : collectionKey === "customItems" ? limits.maxCustomItems
        : collectionKey === "notebookEntries" ? limits.notebookEntries
        : collectionKey === "aiChats" ? limits.maxAiChats : collectionKey === "whiteboards" ? limits.maxWhiteboards
        : collectionKey === "notes" ? limits.maxNotes : collectionKey === "rocketFlights" ? limits.maxRocketFlights
        : limits.maxMathItems;
      const result = await createItem(email, collectionKey, max, body.name, body.data, body.snapshot);
      return sendJson(res, result.error ? 400 : 200, result.error ? result : { item: result.item });
    }
    if (req.method === "PUT") {
      const id = url.searchParams.get("id");
      const body = await readJsonBody(req);
      const result = await updateItem(email, collectionKey, id, body.name, body.data, body.snapshot);
      return sendJson(res, result.error ? 404 : 200, result.error ? result : { item: result.item });
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      const result = await deleteItem(email, collectionKey, id);
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
        console.error("API error:", err);
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
    console.log(`Kinetic server running at http://localhost:${PORT}`);
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
