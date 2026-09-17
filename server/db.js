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
import crypto from "node:crypto";

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
    CREATE TABLE IF NOT EXISTS trusted_devices (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    -- A saved item's snapshot is a small canvas-rendered PNG data URL
    -- (see src/snapshot.js) generated client-side at save time — added to
    -- an existing table via ALTER rather than the CREATE-only pattern
    -- above, since "IF NOT EXISTS" on CREATE TABLE never touches columns
    -- on a table that already exists.
    ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS snapshot TEXT;
    -- NULL until the onboarding quiz (src/onboarding.js) runs once, then
    -- either the answers or {} if explicitly skipped — see setUserPreferences.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB;
    -- Set only by remixing a Community Sim that itself had a lock code (see
    -- community_sims.lock_code_hash below) — a plain save from your own
    -- workspace never gets one. Never sent to a client; only compared
    -- server-side by the /unlock-code route.
    ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS lock_code_hash TEXT;
    CREATE TABLE IF NOT EXISTS community_sims (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      creator_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      snapshot TEXT,
      created_at BIGINT NOT NULL,
      is_featured BOOLEAN NOT NULL DEFAULT false,
      unpublished BOOLEAN NOT NULL DEFAULT false,
      remix_count INT NOT NULL DEFAULT 0,
      -- Set when the publisher chose a 6-digit code to protect this world's
      -- Locked objects (see src/panel.js) — a hash, never the raw code.
      -- Every public-facing read exposes only a hasLock boolean derived
      -- from this; the hash itself only ever leaves the DB for the
      -- server-side comparison in the /unlock-code route.
      lock_code_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS community_sims_public_idx ON community_sims(unpublished, kind);
    -- community_sims already existed before locking was added, so the
    -- column in its CREATE TABLE above never touches a database that
    -- already has the table — same story as saved_items.lock_code_hash.
    ALTER TABLE community_sims ADD COLUMN IF NOT EXISTS lock_code_hash TEXT;
    CREATE TABLE IF NOT EXISTS sim_favorites (
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      sim_id TEXT NOT NULL REFERENCES community_sims(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_email, sim_id)
    );
    CREATE TABLE IF NOT EXISTS sim_reports (
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      sim_id TEXT NOT NULL REFERENCES community_sims(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_email, sim_id)
    );
    -- Entitlements (see server/entitlements.js, the actual resolver — these
    -- columns are raw storage only, never read directly by feature code).
    -- plan_source records HOW plan was granted (paid_plus/promo_plus/teacher/
    -- admin/free) so the UI and future support tooling can explain access,
    -- not just state it. plan_expires_at is set for time-limited grants
    -- (e.g. a promo code with an access window) and is checked lazily at
    -- resolution time — no cron/sweep needed, expired rows just read back
    -- as free from that point on. ai_enabled is intentionally a SEPARATE
    -- column from plan: Plus (paid or promo) never implies AI access.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_source TEXT NOT NULL DEFAULT 'free';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at BIGINT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY,
      active BOOLEAN NOT NULL DEFAULT true,
      max_redemptions INT,
      redemption_count INT NOT NULL DEFAULT 0,
      expires_at BIGINT,
      -- Days of Plus access granted per redemption; NULL = does not expire
      -- on its own (still revocable by deactivating the code, which only
      -- blocks FUTURE redemptions — see redeemPromoCode/deactivate docs).
      access_days INT,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      redeemed_at BIGINT NOT NULL,
      -- Belt-and-suspenders against the same account redeeming the same
      -- code twice — enforced here at the DB level, not just in app logic,
      -- so a race between two near-simultaneous requests can't double-book.
      UNIQUE (code, user_email)
    );
    CREATE INDEX IF NOT EXISTS promo_redemptions_code_idx ON promo_redemptions(code);
    -- AI Tutor cost accounting (see server/aiConfig.js) — accumulates
    -- ESTIMATED cost per user per calendar-month period. No row here is
    -- ever produced by a real AI call today (none exist yet); this table
    -- is architecture, ready for when one does.
    -- Physics world share codes (Kinetic Plus) — a short, typeable code
    -- (displayed as e.g. K7P4-X2) that loads a specific world snapshot.
    -- Deliberately separate from community_sims (that's a permanent public
    -- gallery listing) and shared_items (that's classroom-membership-
    -- scoped) — this is neither: anyone with the code can load it once,
    -- it never appears in any public listing, and generating one requires
    -- Plus while LOADING one does not (see server.js's /world-share route).
    CREATE TABLE IF NOT EXISTS world_share_codes (
      code TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      data JSONB NOT NULL,
      schema_version INT NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_usage_periods (
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      request_count INT NOT NULL DEFAULT 0,
      pricing_version INT NOT NULL DEFAULT 1,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_email, period_key)
    );
    -- No payment processor is connected yet (see server/checkoutConfig.js).
    -- This just records "I got to the end of the checkout flow and would
    -- have paid" so real interest isn't lost while billing isn't live —
    -- one row per user+plan+period, updated (not duplicated) on repeat visits.
    CREATE TABLE IF NOT EXISTS upgrade_interest (
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      billing_period TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_email, plan)
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

// null = never been through onboarding yet (see src/onboarding.js); {} =
// explicitly skipped it. Either way, `preferences` is a plain object of
// whatever the quiz's questions currently are, so adding/removing a
// question later never needs a migration.
export async function setUserPreferences(email, preferences) {
  await query("UPDATE users SET preferences = $2 WHERE email = $1", [email, JSON.stringify(preferences)]);
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
  const rows = await query("SELECT id, name, data, snapshot, updated_at, lock_code_hash FROM saved_items WHERE email = $1 AND kind = $2 ORDER BY updated_at DESC", [email, kind]);
  return rows.map((r) => ({ id: r.id, name: r.name, data: r.data, snapshot: r.snapshot, updatedAt: Number(r.updated_at), hasLock: !!r.lock_code_hash }));
}

export async function countSavedItems(email, kind) {
  const rows = await query("SELECT count(*)::int AS n FROM saved_items WHERE email = $1 AND kind = $2", [email, kind]);
  return rows[0].n;
}

export async function insertSavedItem(id, email, kind, name, data, updatedAt, snapshot, lockCodeHash) {
  await query("INSERT INTO saved_items (id, email, kind, name, data, updated_at, snapshot, lock_code_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [id, email, kind, name, JSON.stringify(data), updatedAt, snapshot || null, lockCodeHash || null]);
}

export async function updateSavedItem(email, kind, id, name, data, updatedAt, snapshot) {
  const rows = await query(
    "UPDATE saved_items SET name = $4, data = $5, updated_at = $6, snapshot = $7 WHERE id = $1 AND email = $2 AND kind = $3 RETURNING id",
    [id, email, kind, name, JSON.stringify(data), updatedAt, snapshot || null]
  );
  return rows.length > 0;
}

export async function deleteSavedItem(email, kind, id) {
  const rows = await query("DELETE FROM saved_items WHERE id = $1 AND email = $2 AND kind = $3 RETURNING id", [id, email, kind]);
  return rows.length > 0;
}

// ---------- community sims ----------

export async function insertCommunitySim(id, ownerEmail, creatorName, kind, name, description, subject, data, snapshot, createdAt, lockCodeHash) {
  await query(
    `INSERT INTO community_sims (id, owner_email, creator_name, kind, name, description, subject, data, snapshot, created_at, lock_code_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, ownerEmail, creatorName, kind, name, description, subject, JSON.stringify(data), snapshot || null, createdAt, lockCodeHash || null]
  );
}

// Public listing — never includes unpublished sims regardless of caller,
// with each row's live favorite count joined in rather than trusted as a
// stored counter (a counter that could drift from the real join table is
// worse than just always computing it).
export async function listCommunitySims({ kind, subject, featuredOnly } = {}) {
  const conditions = ["unpublished = false"];
  const params = [];
  if (kind) { params.push(kind); conditions.push(`kind = $${params.length}`); }
  if (subject) { params.push(subject); conditions.push(`subject = $${params.length}`); }
  if (featuredOnly) conditions.push("is_featured = true");
  const rows = await query(
    `SELECT c.id, c.owner_email, c.creator_name, c.kind, c.name, c.description, c.subject, c.snapshot,
            c.created_at, c.is_featured, c.remix_count, c.lock_code_hash,
            (SELECT count(*)::int FROM sim_favorites f WHERE f.sim_id = c.id) AS favorite_count
     FROM community_sims c
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.created_at DESC`,
    params
  );
  return rows.map((r) => ({
    id: r.id, ownerEmail: r.owner_email, creatorName: r.creator_name, kind: r.kind, name: r.name,
    description: r.description, subject: r.subject, snapshot: r.snapshot, createdAt: Number(r.created_at),
    isFeatured: r.is_featured, remixCount: r.remix_count, favoriteCount: r.favorite_count, hasLock: !!r.lock_code_hash,
  }));
}

export async function getCommunitySim(id) {
  const rows = await query("SELECT * FROM community_sims WHERE id = $1 AND unpublished = false", [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, ownerEmail: r.owner_email, creatorName: r.creator_name, kind: r.kind, name: r.name,
    description: r.description, subject: r.subject, data: r.data, snapshot: r.snapshot,
    createdAt: Number(r.created_at), isFeatured: r.is_featured, hasLock: !!r.lock_code_hash,
  };
}

// Internal only — the raw hash never leaves the server (see the
// /unlock-code route and remixCommunitySim, the only two callers).
export async function getCommunitySimLockHash(id) {
  const rows = await query("SELECT lock_code_hash FROM community_sims WHERE id = $1", [id]);
  return rows[0]?.lock_code_hash || null;
}

// Looks up whichever table `kind` refers to — used only by the
// /unlock-code route to verify a submitted code server-side.
export async function getLockHash(kind, id) {
  if (kind === "community-sim") return getCommunitySimLockHash(id);
  const rows = await query("SELECT lock_code_hash FROM saved_items WHERE id = $1", [id]);
  return rows[0]?.lock_code_hash || null;
}

export async function unpublishCommunitySim(id, ownerEmail) {
  const rows = await query("UPDATE community_sims SET unpublished = true WHERE id = $1 AND owner_email = $2 RETURNING id", [id, ownerEmail]);
  return rows.length > 0;
}

export async function setCommunitySimFeatured(id, featured) {
  const rows = await query("UPDATE community_sims SET is_featured = $2 WHERE id = $1 RETURNING id", [id, featured]);
  return rows.length > 0;
}

export async function incrementRemixCount(id) {
  await query("UPDATE community_sims SET remix_count = remix_count + 1 WHERE id = $1", [id]);
}

export async function toggleFavorite(userEmail, simId) {
  const existing = await query("SELECT 1 FROM sim_favorites WHERE user_email = $1 AND sim_id = $2", [userEmail, simId]);
  if (existing.length) {
    await query("DELETE FROM sim_favorites WHERE user_email = $1 AND sim_id = $2", [userEmail, simId]);
    return false;
  }
  await query("INSERT INTO sim_favorites (user_email, sim_id, created_at) VALUES ($1, $2, $3)", [userEmail, simId, Date.now()]);
  return true;
}

export async function listFavoriteSimIds(userEmail) {
  const rows = await query("SELECT sim_id FROM sim_favorites WHERE user_email = $1", [userEmail]);
  return rows.map((r) => r.sim_id);
}

// One report per user per sim (the primary key enforces that) — reporting
// twice just no-ops rather than inflating the count.
export async function reportSim(userEmail, simId) {
  await query("INSERT INTO sim_reports (user_email, sim_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [userEmail, simId, Date.now()]);
  const rows = await query("SELECT count(*)::int AS n FROM sim_reports WHERE sim_id = $1", [simId]);
  return rows[0].n;
}

// Admin-only listing: every published sim (any kind), with live report and
// favorite counts, for the manual "Feature" curation pass — never exposed
// to the public listing since it includes moderation data.
export async function listCommunitySimsForAdmin() {
  const rows = await query(
    `SELECT c.id, c.owner_email, c.creator_name, c.kind, c.name, c.description, c.subject,
            c.created_at, c.is_featured, c.remix_count,
            (SELECT count(*)::int FROM sim_favorites f WHERE f.sim_id = c.id) AS favorite_count,
            (SELECT count(*)::int FROM sim_reports r WHERE r.sim_id = c.id) AS report_count
     FROM community_sims c
     WHERE unpublished = false
     ORDER BY c.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id, ownerEmail: r.owner_email, creatorName: r.creator_name, kind: r.kind, name: r.name,
    description: r.description, subject: r.subject, createdAt: Number(r.created_at),
    isFeatured: r.is_featured, remixCount: r.remix_count, favoriteCount: r.favorite_count, reportCount: r.report_count,
  }));
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

// ---------- trusted devices ----------
// Lets a browser skip the email-code step on future sign-ins, once it's
// proven it can read that inbox at least once (at signup, or the first
// login there). A separate long-lived cookie from the session cookie —
// signing out clears the session but intentionally leaves this alone, so
// signing back in on the same browser still skips verification.

export async function insertTrustedDevice(token, email, expiresAt) {
  await query("INSERT INTO trusted_devices (token, email, expires_at) VALUES ($1, $2, $3)", [token, email, expiresAt]);
}

export async function getTrustedDevice(token) {
  const rows = await query("SELECT * FROM trusted_devices WHERE token = $1", [token]);
  if (!rows[0]) return null;
  return { email: rows[0].email, expiresAt: Number(rows[0].expires_at) };
}

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

// ---------- entitlements / plan ----------
// Raw storage only — see server/entitlements.js for the actual resolver
// every route/UI should read through instead of these columns directly.

export async function setUserPlan(email, plan, planSource, expiresAt) {
  await query(
    "UPDATE users SET plan = $2, plan_source = $3, plan_expires_at = $4 WHERE email = $1",
    [email, plan, planSource, expiresAt]
  );
}

// ---------- promo codes (admin-managed, see ~/physics-sim-admin) ----------

export async function createPromoCode({ code, maxRedemptions, expiresAt, accessDays }) {
  await query(
    `INSERT INTO promo_codes (code, max_redemptions, expires_at, access_days, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [code, maxRedemptions ?? null, expiresAt ?? null, accessDays ?? null, Date.now()]
  );
}

export async function listPromoCodes() {
  const rows = await query("SELECT * FROM promo_codes ORDER BY created_at DESC");
  return rows.map((r) => ({
    code: r.code, active: r.active, maxRedemptions: r.max_redemptions, redemptionCount: r.redemption_count,
    expiresAt: r.expires_at ? Number(r.expires_at) : null, accessDays: r.access_days, createdAt: Number(r.created_at),
  }));
}

export async function getPromoCode(code) {
  const rows = await query("SELECT * FROM promo_codes WHERE code = $1", [code]);
  return rows[0] || null;
}

export async function setPromoCodeActive(code, active) {
  const rows = await query("UPDATE promo_codes SET active = $2 WHERE code = $1 RETURNING code", [code, active]);
  return rows.length > 0;
}

export async function listPromoRedemptions(code) {
  const rows = await query(
    `SELECT r.user_email, r.redeemed_at, u.first_name, u.last_name
     FROM promo_redemptions r JOIN users u ON u.email = r.user_email
     WHERE r.code = $1 ORDER BY r.redeemed_at DESC`,
    [code]
  );
  return rows.map((r) => ({ email: r.user_email, redeemedAt: Number(r.redeemed_at), name: `${r.first_name} ${r.last_name}`.trim() }));
}

export async function hasRedeemedPromoCode(code, email) {
  const rows = await query("SELECT 1 FROM promo_redemptions WHERE code = $1 AND user_email = $2", [code, email]);
  return rows.length > 0;
}

// The actual redemption — see the /promo-redeem route in server.js for the
// full validation sequence (this just performs the DB half once every
// check has already passed there). Relies on promo_redemptions' UNIQUE
// (code, user_email) constraint as a last line of defense against a race
// between two near-simultaneous redemption attempts from the same account;
// callers should catch a unique-violation error (code '23505') as "already
// redeemed" rather than a hard failure.
export async function insertPromoRedemption(code, email) {
  await query(
    "INSERT INTO promo_redemptions (id, code, user_email, redeemed_at) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), code, email, Date.now()]
  );
  await query("UPDATE promo_codes SET redemption_count = redemption_count + 1 WHERE code = $1", [code]);
}

// ---------- world share codes (Kinetic Plus) ----------

export async function worldShareCodeExists(code) {
  const rows = await query("SELECT 1 FROM world_share_codes WHERE code = $1", [code]);
  return rows.length > 0;
}

export async function createWorldShareCode(code, ownerEmail, kind, data) {
  await query(
    "INSERT INTO world_share_codes (code, owner_email, kind, data, schema_version, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [code, ownerEmail, kind, JSON.stringify(data), 1, Date.now()]
  );
}

export async function getWorldShareCode(code) {
  const rows = await query("SELECT kind, data, schema_version, created_at FROM world_share_codes WHERE code = $1", [code]);
  if (!rows.length) return null;
  return { kind: rows[0].kind, data: rows[0].data, schemaVersion: rows[0].schema_version, createdAt: Number(rows[0].created_at) };
}

// ---------- AI Tutor usage accounting (architecture only — see server/aiConfig.js) ----------

export async function getAiUsage(email, periodKey) {
  const rows = await query("SELECT * FROM ai_usage_periods WHERE user_email = $1 AND period_key = $2", [email, periodKey]);
  if (!rows.length) return { estimatedCostUsd: 0, requestCount: 0 };
  return { estimatedCostUsd: Number(rows[0].estimated_cost_usd), requestCount: rows[0].request_count };
}

// Would be called AFTER a real request completes, to add its actual
// estimated cost to the running monthly total — never called today, since
// no real request exists yet. Included so the accounting half of this
// architecture isn't purely theoretical when a real integration lands.
export async function recordAiUsage(email, periodKey, costUsd, pricingVersion) {
  await query(
    `INSERT INTO ai_usage_periods (user_email, period_key, estimated_cost_usd, request_count, pricing_version, updated_at)
     VALUES ($1, $2, $3, 1, $4, $5)
     ON CONFLICT (user_email, period_key)
     DO UPDATE SET estimated_cost_usd = ai_usage_periods.estimated_cost_usd + $3, request_count = ai_usage_periods.request_count + 1, updated_at = $5`,
    [email, periodKey, costUsd, pricingVersion, Date.now()]
  );
}

// ---------- upgrade interest (no payment processor connected — see server/checkoutConfig.js) ----------

export async function recordUpgradeInterest(email, plan, billingPeriod) {
  const now = Date.now();
  await query(
    `INSERT INTO upgrade_interest (user_email, plan, billing_period, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (user_email, plan)
     DO UPDATE SET billing_period = $3, updated_at = $4`,
    [email, plan, billingPeriod, now]
  );
}
