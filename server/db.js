// Real persistence via Postgres (Neon) — replaces the old single
// data.json file. This exists because Vercel (and serverless hosts in
// general) run request handlers as short-lived, stateless functions with
// no shared memory and no durable local disk between invocations: the old
// in-memory `db` object + local JSON file worked great for one always-on
// process, but a fresh serverless instance would start with an empty `db`
// on every single request. A real database is the only thing that
// actually persists here.
//
// `pg` is the one real npm dependency this project has ever needed — there's
// no reasonable way to speak the Postgres wire protocol from scratch, unlike
// password hashing (crypto.scryptSync) which Node already provides.
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Only needed by short-lived standalone scripts (the newsletter sender) —
// the long-running server and Vercel's function runtime both just let the
// pool live for the life of the process/instance instead.
export async function closePool() { await pool.end(); }

async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// Runs once per cold start (and is cheap/idempotent otherwise) — creates
// every table if it doesn't already exist yet. No migration framework:
// the schema is small and stable enough that "CREATE TABLE IF NOT EXISTS"
// covers it.
let readySchema = null;
export function ensureSchema() {
  readySchema ??= query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      subscribed BOOLEAN NOT NULL DEFAULT false,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT 'independent',
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      expires BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_items (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_items_email_kind_idx ON saved_items(email, kind);
    CREATE TABLE IF NOT EXISTS classrooms (
      code TEXT PRIMARY KEY,
      teacher_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classroom_students (
      classroom_code TEXT NOT NULL REFERENCES classrooms(code) ON DELETE CASCADE,
      student_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      PRIMARY KEY (classroom_code, student_email)
    );
    CREATE TABLE IF NOT EXISTS shared_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      data JSONB NOT NULL,
      from_email TEXT NOT NULL,
      classroom_code TEXT NOT NULL REFERENCES classrooms(code) ON DELETE CASCADE,
      classroom_name TEXT NOT NULL,
      direction TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      email TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mailing_list (
      email TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS pending_verifications (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      kind TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      signup_data JSONB
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      count INT NOT NULL,
      first_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return readySchema;
}

// ---------- users ----------

export async function getUser(email) {
  const rows = await query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] || null;
}

export async function createUser(email, { passwordHash, subscribed, firstName, lastName, title, createdAt }) {
  await query(
    `INSERT INTO users (email, password_hash, subscribed, first_name, last_name, title, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [email, passwordHash, subscribed, firstName, lastName, title, createdAt]
  );
}

export async function setUserTitle(email, title) {
  await query("UPDATE users SET title = $2 WHERE email = $1", [email, title]);
}

export async function setUserSubscribed(email, subscribed) {
  await query("UPDATE users SET subscribed = $2 WHERE email = $1", [email, subscribed]);
}

// ---------- sessions ----------

export async function createSessionRow(token, email, expires) {
  await query("INSERT INTO sessions (token, email, expires) VALUES ($1, $2, $3)", [token, email, expires]);
}

export async function getSession(token) {
  const rows = await query("SELECT * FROM sessions WHERE token = $1", [token]);
  return rows[0] || null;
}

export async function deleteSession(token) {
  await query("DELETE FROM sessions WHERE token = $1", [token]);
}

// ---------- saved items (worlds / mathItems / cities) ----------

export async function listSavedItems(email, kind) {
  const rows = await query("SELECT id, name, data, updated_at FROM saved_items WHERE email = $1 AND kind = $2 ORDER BY updated_at DESC", [email, kind]);
  return rows.map((r) => ({ id: r.id, name: r.name, data: r.data, updatedAt: Number(r.updated_at) }));
}

export async function countSavedItems(email, kind) {
  const rows = await query("SELECT count(*)::int AS n FROM saved_items WHERE email = $1 AND kind = $2", [email, kind]);
  return rows[0].n;
}

export async function insertSavedItem(id, email, kind, name, data, updatedAt) {
  await query("INSERT INTO saved_items (id, email, kind, name, data, updated_at) VALUES ($1, $2, $3, $4, $5, $6)", [id, email, kind, name, JSON.stringify(data), updatedAt]);
}

export async function updateSavedItem(email, kind, id, name, data, updatedAt) {
  const rows = await query(
    "UPDATE saved_items SET name = $4, data = $5, updated_at = $6 WHERE id = $1 AND email = $2 AND kind = $3 RETURNING id",
    [id, email, kind, name, JSON.stringify(data), updatedAt]
  );
  return rows.length > 0;
}

export async function deleteSavedItem(email, kind, id) {
  const rows = await query("DELETE FROM saved_items WHERE id = $1 AND email = $2 AND kind = $3 RETURNING id", [id, email, kind]);
  return rows.length > 0;
}

// ---------- classrooms ----------

export async function classCodeExists(code) {
  const rows = await query("SELECT 1 FROM classrooms WHERE code = $1", [code]);
  return rows.length > 0;
}

export async function insertClassroom(code, teacherEmail, name, createdAt) {
  await query("INSERT INTO classrooms (code, teacher_email, name, created_at) VALUES ($1, $2, $3, $4)", [code, teacherEmail, name, createdAt]);
}

export async function countClassroomsTaughtBy(email) {
  const rows = await query("SELECT count(*)::int AS n FROM classrooms WHERE teacher_email = $1", [email]);
  return rows[0].n;
}

export async function classroomsTaughtByDb(email) {
  const rows = await query(
    `SELECT c.code, c.name, c.created_at,
            coalesce(array_agg(cs.student_email) FILTER (WHERE cs.student_email IS NOT NULL), '{}') AS students
     FROM classrooms c
     LEFT JOIN classroom_students cs ON cs.classroom_code = c.code
     WHERE c.teacher_email = $1
     GROUP BY c.code`,
    [email]
  );
  return rows.map((r) => ({ code: r.code, name: r.name, createdAt: Number(r.created_at), students: r.students }));
}

export async function classroomsJoinedByDb(email) {
  const rows = await query(
    `SELECT c.code, c.name, c.teacher_email
     FROM classrooms c
     JOIN classroom_students cs ON cs.classroom_code = c.code
     WHERE cs.student_email = $1`,
    [email]
  );
  return rows.map((r) => ({ code: r.code, name: r.name, teacherEmail: r.teacher_email }));
}

export async function getClassroom(code) {
  const rows = await query("SELECT * FROM classrooms WHERE code = $1", [code]);
  return rows[0] || null;
}

export async function addStudentToClassroom(code, email) {
  await query("INSERT INTO classroom_students (classroom_code, student_email) VALUES ($1, $2) ON CONFLICT DO NOTHING", [code, email]);
}

export async function removeStudentFromClassroom(code, email) {
  const rows = await query("DELETE FROM classroom_students WHERE classroom_code = $1 AND student_email = $2 RETURNING 1", [code, email]);
  return rows.length > 0;
}

export async function isStudentInClassroom(code, email) {
  const rows = await query("SELECT 1 FROM classroom_students WHERE classroom_code = $1 AND student_email = $2", [code, email]);
  return rows.length > 0;
}

export async function getClassroomStudents(code) {
  const rows = await query("SELECT student_email FROM classroom_students WHERE classroom_code = $1", [code]);
  return rows.map((r) => r.student_email);
}

export async function deleteClassroomRow(code) {
  await query("DELETE FROM classrooms WHERE code = $1", [code]);
}

// ---------- shared items ----------

export async function insertSharedItem(item) {
  await query(
    `INSERT INTO shared_items (id, kind, name, data, from_email, classroom_code, classroom_name, direction, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [item.id, item.kind, item.name, JSON.stringify(item.data), item.fromEmail, item.classroomCode, item.classroomName, item.direction, item.createdAt]
  );
}

function rowToSharedMeta(r) {
  return { id: r.id, kind: r.kind, name: r.name, fromEmail: r.from_email, classroomCode: r.classroom_code, classroomName: r.classroom_name, direction: r.direction, createdAt: Number(r.created_at) };
}

export async function sharedItemsReceivedFor(teachingCodes, joinedCodes) {
  if (!teachingCodes.length && !joinedCodes.length) return [];
  const rows = await query(
    `SELECT * FROM shared_items
     WHERE (direction = 'to-teacher' AND classroom_code = ANY($1))
        OR (direction = 'to-students' AND classroom_code = ANY($2))
     ORDER BY created_at DESC`,
    [teachingCodes, joinedCodes]
  );
  return rows.map(rowToSharedMeta);
}

export async function sharedItemsSentBy(email) {
  const rows = await query("SELECT * FROM shared_items WHERE from_email = $1 ORDER BY created_at DESC", [email]);
  return rows.map(rowToSharedMeta);
}

export async function getSharedItemById(id) {
  const rows = await query("SELECT * FROM shared_items WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { ...rowToSharedMeta(r), data: r.data };
}

// ---------- feedback ----------

export async function insertFeedback(id, message, email, createdAt) {
  await query("INSERT INTO feedback (id, message, email, created_at) VALUES ($1, $2, $3, $4)", [id, message, email, createdAt]);
}

export async function listFeedback(limit = 50) {
  const rows = await query("SELECT id, message, email, created_at FROM feedback ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map((r) => ({ id: r.id, message: r.message, email: r.email, createdAt: Number(r.created_at) }));
}

// ---------- admin dashboard stats (physics-sim-admin) ----------

export async function getStats() {
  const [users, classrooms, feedbackCount, sharedCount] = await Promise.all([
    query("SELECT count(*)::int AS n FROM users"),
    query("SELECT count(*)::int AS n FROM classrooms"),
    query("SELECT count(*)::int AS n FROM feedback"),
    query("SELECT count(*)::int AS n FROM shared_items"),
  ]);
  return { users: users[0].n, classrooms: classrooms[0].n, feedback: feedbackCount[0].n, sharedItems: sharedCount[0].n };
}

export async function listAllClassrooms() {
  const rows = await query(
    `SELECT c.code, c.name, c.teacher_email, c.created_at,
            coalesce(array_agg(cs.student_email) FILTER (WHERE cs.student_email IS NOT NULL), '{}') AS students
     FROM classrooms c
     LEFT JOIN classroom_students cs ON cs.classroom_code = c.code
     GROUP BY c.code
     ORDER BY c.created_at DESC`
  );
  return rows.map((r) => ({ code: r.code, name: r.name, teacherEmail: r.teacher_email, createdAt: Number(r.created_at), students: r.students }));
}

// ---------- mailing list ----------

export async function getMailingList() {
  const rows = await query("SELECT email FROM mailing_list", []);
  return rows.map((r) => r.email);
}

export async function addToMailingList(email) {
  await query("INSERT INTO mailing_list (email) VALUES ($1) ON CONFLICT DO NOTHING", [email]);
}

export async function removeFromMailingList(email) {
  await query("DELETE FROM mailing_list WHERE email = $1", [email]);
}

// ---------- pending email verification ----------

export async function insertPendingVerification(token, email, kind, code, expiresAt, signupData) {
  await query(
    "INSERT INTO pending_verifications (token, email, kind, code, expires_at, signup_data) VALUES ($1, $2, $3, $4, $5, $6)",
    [token, email, kind, code, expiresAt, signupData ? JSON.stringify(signupData) : null]
  );
}

export async function getPendingVerification(token) {
  const rows = await query("SELECT * FROM pending_verifications WHERE token = $1", [token]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { token: r.token, email: r.email, kind: r.kind, code: r.code, expiresAt: Number(r.expires_at), signupData: r.signup_data };
}

export async function deletePendingVerification(token) {
  await query("DELETE FROM pending_verifications WHERE token = $1", [token]);
}

// ---------- login-attempt rate limiting ----------
// A real table instead of an in-memory Map for the same reason as
// everything else here: a serverless instance wouldn't remember previous
// attempts otherwise, defeating the point of a lockout.

export async function getLoginAttempts(key) {
  const rows = await query("SELECT * FROM login_attempts WHERE key = $1", [key]);
  if (!rows[0]) return null;
  return { count: rows[0].count, firstAt: Number(rows[0].first_at) };
}

export async function recordLoginAttempt(key, count, firstAt) {
  await query(
    `INSERT INTO login_attempts (key, count, first_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET count = $2, first_at = $3`,
    [key, count, firstAt]
  );
}

export async function clearLoginAttempts(key) {
  await query("DELETE FROM login_attempts WHERE key = $1", [key]);
}

// ---------- app-wide metadata (unsubscribe secret, newsletter state) ----------

export async function getMeta(key) {
  const rows = await query("SELECT value FROM app_meta WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key, value) {
  await query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}
