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
    -- An assignment is scoped to exactly one classroom, set by its teacher
    -- (who must be that classroom's teacher — enforced in server.js, not
    -- here). Deleting the classroom cascades to its assignments, which
    -- cascades to their completion rows below — a deleted classroom leaves
    -- nothing behind.
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      classroom_code TEXT NOT NULL REFERENCES classrooms(code) ON DELETE CASCADE,
      teacher_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      due_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assignments_classroom_idx ON assignments(classroom_code);
    -- Optional per-student randomization (see src/assignmentVariation.js):
    -- which values vary and by how much. Null = everyone gets the same setup.
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS variation JSONB;
    -- A student marking an assignment done — deliberately just a
    -- completion flag, not a submitted file: assignments here point at
    -- something to go do in the app (a Physics Challenge, a mode to
    -- explore), and the actual work product is whatever they already save
    -- or share via shared_items, not re-collected here.
    CREATE TABLE IF NOT EXISTS assignment_completions (
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      student_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      completed_at BIGINT NOT NULL,
      PRIMARY KEY (assignment_id, student_email)
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
    -- A short message alongside the shared item itself (e.g. a student
    -- explaining what they tried), and an optional pointer to the specific
    -- assignment this is in response to — only meaningful for a
    -- direction='to-teacher' share, since assignments are teacher-created.
    -- ON DELETE SET NULL (not CASCADE) because deleting an assignment
    -- later shouldn't take a student's already-submitted share down with
    -- it; it just becomes an un-attached share.
    ALTER TABLE shared_items ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
    ALTER TABLE shared_items ADD COLUMN IF NOT EXISTS assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL;
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
    -- Which saved item a published sim was made from, so overwriting or deleting
    -- that save can update or unpublish the public copy too.
    ALTER TABLE community_sims ADD COLUMN IF NOT EXISTS source_item_id TEXT;
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
    -- "Subscribe to a creator" (deliberately not "follow" — this is an
    -- inbox opt-in, not a social graph) — one row means the subscriber
    -- wants a notification the next time creator_email publishes a NEW
    -- public world. No counts are ever read off this table for display
    -- (no follower counts anywhere in this app, by design).
    CREATE TABLE IF NOT EXISTS creator_subscriptions (
      subscriber_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      creator_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (subscriber_email, creator_email)
    );
    -- The Notification Center's one table. This is an inbox, not a feed:
    -- every row is something that actually happened, precomputed into a
    -- plain title/body at write time so it still reads correctly even
    -- after the thing it points at (a world, a creator's account) is
    -- gone — link_kind/link_id are best-effort "open this" hints, never
    -- required to render the row itself.
    --
    -- group_key + the partial unique index below are what "group low-
    -- priority activity" and "avoid duplicate notifications from
    -- retries" both come from: at most one UNREAD row can exist per
    -- (recipient, group_key), so a second favorite/remix on the same
    -- world while the first notification is still unread increments
    -- count and rewrites title in place (see
    -- upsertInteractionNotification) instead of spawning a new row —
    -- and a retried request that lands twice just increments or
    -- no-ops instead of duplicating. Once read, the next event starts a
    -- fresh row, so read notifications never silently reopen.
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      kind TEXT NOT NULL, -- 'interaction' | 'new_world' | 'product_update' | 'newsletter' | 'donor_thanks'
      group_key TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link_kind TEXT,
      link_id TEXT,
      count INT NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      read_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_email, read_at, created_at DESC);
    -- Grouping/dedup window: only while a grouped notification is still
    -- unread. Read notifications are excluded from the index entirely,
    -- so they're never a conflict target for a later event.
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_group_unread_idx ON notifications(recipient_email, group_key) WHERE group_key IS NOT NULL AND read_at IS NULL;
    -- Separate dedup for one-shot kinds (new_world, and every admin
    -- broadcast kind) that are never merged/incremented — link_id here is
    -- either the freshly-published world's id (naturally unique per
    -- publish) or an admin-supplied broadcastId (see
    -- server/notifyBroadcast.js), so a retried publish/broadcast can only
    -- ever insert the same row once, retry or not.
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_oneshot_idx ON notifications(recipient_email, kind, link_id) WHERE group_key IS NULL AND link_id IS NOT NULL;

    -- One row per (week, user) — the weekly challenge is a single shared
    -- pick for everyone that week (see main.js's weeklyChallenge()), so
    -- there's nothing to key on per-challenge; the primary key alone
    -- keeps a retried "I finished it" request from ever double-counting
    -- the same person twice in the same week.
    CREATE TABLE IF NOT EXISTS weekly_challenge_completions (
      week_key TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      completed_at BIGINT NOT NULL,
      PRIMARY KEY (week_key, email)
    );

    -- Every individual challenge a signed-in account has ever completed,
    -- across all 12 sandboxes (physics/chemistry/history/cybersecurity/
    -- rocket/astronomy each mint their own challenge_id strings, some
    -- sandbox-prefixed — see achievements.js — this table doesn't care,
    -- it's free-form text). Unlike weekly_challenge_completions this is
    -- unbounded per user (one row per challenge, not per week), which is
    -- exactly what lets Achievements/badges (a running count/set of every
    -- challenge ever done) sync across devices instead of living only in
    -- one browser's localStorage.
    CREATE TABLE IF NOT EXISTS challenge_completions (
      email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL,
      completed_at BIGINT NOT NULL,
      PRIMARY KEY (email, challenge_id)
    );
  `);
  return readySchema;
}

// ---------- users ----------

export async function getUser(email) {
  const rows = await query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] || null;
}

// Every account's email — used only for the "product update" broadcast
// (see server/notifyBroadcast.js), which is genuinely for everyone,
// unlike the newsletter's mailing_list (opt-in) or a donor thank-you
// (one specific person).
export async function listAllUserEmails() {
  const rows = await query("SELECT email FROM users", []);
  return rows.map((r) => r.email);
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

export async function insertCommunitySim(id, ownerEmail, creatorName, kind, name, description, subject, data, snapshot, createdAt, lockCodeHash, sourceItemId = null) {
  await query(
    `INSERT INTO community_sims (id, owner_email, creator_name, kind, name, description, subject, data, snapshot, created_at, lock_code_hash, source_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, ownerEmail, creatorName, kind, name, description, subject, JSON.stringify(data), snapshot || null, createdAt, lockCodeHash || null, sourceItemId || null]
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

// A saved item was overwritten: refresh its still-published public copies.
// Copies published before source_item_id existed are matched by owner+kind+old name.
export async function syncPublishedFromItem(email, kind, itemId, oldName, newName, data, snapshot) {
  const rows = await query(
    `UPDATE community_sims SET name = $5, data = $6, snapshot = $7
     WHERE owner_email = $1 AND kind = $2 AND unpublished = false
       AND (source_item_id = $3 OR (source_item_id IS NULL AND name = $4)) RETURNING id`,
    [email, kind, itemId, oldName, newName, JSON.stringify(data), snapshot || null]
  );
  return rows.length;
}

// A saved item was deleted: take its public copies down.
export async function unpublishBySourceItem(email, kind, itemId, name) {
  const rows = await query(
    `UPDATE community_sims SET unpublished = true
     WHERE owner_email = $1 AND kind = $2 AND unpublished = false
       AND (source_item_id = $3 OR (source_item_id IS NULL AND name = $4)) RETURNING id`,
    [email, kind, itemId, name]
  );
  return rows.length;
}

export async function getSavedItemName(email, kind, id) {
  const rows = await query("SELECT name FROM saved_items WHERE id = $1 AND email = $2 AND kind = $3", [id, email, kind]);
  return rows[0]?.name ?? null;
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

// ---------- creator subscriptions ----------
// "Subscribe to a creator" — deliberately a plain opt-in toggle, not a
// social graph: no counts are ever read back off this table for display
// (see notifications below for the one thing it drives).

export async function toggleCreatorSubscription(subscriberEmail, creatorEmail) {
  const existing = await query("SELECT 1 FROM creator_subscriptions WHERE subscriber_email = $1 AND creator_email = $2", [subscriberEmail, creatorEmail]);
  if (existing.length) {
    await query("DELETE FROM creator_subscriptions WHERE subscriber_email = $1 AND creator_email = $2", [subscriberEmail, creatorEmail]);
    return false;
  }
  await query("INSERT INTO creator_subscriptions (subscriber_email, creator_email, created_at) VALUES ($1, $2, $3)", [subscriberEmail, creatorEmail, Date.now()]);
  return true;
}

export async function listSubscribedCreatorEmails(subscriberEmail) {
  const rows = await query("SELECT creator_email FROM creator_subscriptions WHERE subscriber_email = $1", [subscriberEmail]);
  return rows.map((r) => r.creator_email);
}

export async function listSubscriberEmails(creatorEmail) {
  const rows = await query("SELECT subscriber_email FROM creator_subscriptions WHERE creator_email = $1", [creatorEmail]);
  return rows.map((r) => r.subscriber_email);
}

// ---------- notifications ----------
// An inbox, not a feed — see the CREATE TABLE comment above for the
// grouping/dedup design. Every function here is written so a caller never
// has to know whether a given event turned into a new row or an update to
// an existing one.

export async function listNotifications(email, limit = 50) {
  const rows = await query(
    `SELECT id, kind, title, body, link_kind, link_id, count, created_at, updated_at, read_at
     FROM notifications WHERE recipient_email = $1
     ORDER BY updated_at DESC LIMIT $2`,
    [email, limit]
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body,
    linkKind: r.link_kind, linkId: r.link_id, count: r.count,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    readAt: r.read_at == null ? null : Number(r.read_at),
  }));
}

export async function countUnreadNotifications(email) {
  const rows = await query("SELECT count(*)::int AS n FROM notifications WHERE recipient_email = $1 AND read_at IS NULL", [email]);
  return rows[0].n;
}

// Scoped by recipient_email in the WHERE clause (not just the id) so one
// account can never mark — or even discover the existence of — another
// account's notification by guessing an id.
export async function markNotificationsRead(email, ids) {
  if (!ids?.length) return;
  await query("UPDATE notifications SET read_at = $1 WHERE recipient_email = $2 AND id = ANY($3) AND read_at IS NULL", [Date.now(), email, ids]);
}

export async function markAllNotificationsRead(email) {
  await query("UPDATE notifications SET read_at = $1 WHERE recipient_email = $2 AND read_at IS NULL", [Date.now(), email]);
}

// The reverse of markNotificationsRead — also scoped by recipient_email.
// One at a time (not a single bulk UPDATE) because reopening a row can
// collide with notifications_group_unread_idx: if a NEWER unread
// notification already exists for the same group_key (e.g. someone else
// favorited the same world after you read the first notice), reopening
// the old one would violate that partial unique index. That's caught and
// skipped per-row rather than failing the whole request — the row just
// stays read, which is the only sane outcome once a fresher unread one
// already exists for that group.
export async function markNotificationsUnread(email, ids) {
  if (!ids?.length) return;
  for (const id of ids) {
    try {
      await query("UPDATE notifications SET read_at = NULL WHERE recipient_email = $1 AND id = $2", [email, id]);
    } catch (e) {
      if (e.code !== "23505") throw e;
    }
  }
}

// Someone favorited/remixed the recipient's world. Merges into the same
// group_key while unread — see notifications_group_unread_idx — so a
// burst of activity on one world reads as "3 people interacted with X"
// (count > 1) rather than three separate rows; the very first event still
// gets the specific, real verb ("favorited"/"remixed") since a count of
// one IS just that one specific thing.
export async function upsertInteractionNotification({ recipientEmail, actorName, simId, simName, verb }) {
  const now = Date.now();
  const groupKey = `interaction:${simId}`;
  const singularTitle = `${actorName} ${verb} your world "${simName}"`;
  await query(
    `INSERT INTO notifications (id, recipient_email, kind, group_key, title, body, link_kind, link_id, count, created_at, updated_at, read_at)
     VALUES ($1, $2, 'interaction', $3, $4, '', 'community-sim', $5, 1, $6, $6, NULL)
     ON CONFLICT (recipient_email, group_key) WHERE group_key IS NOT NULL AND read_at IS NULL
     DO UPDATE SET
       count = notifications.count + 1,
       title = format('%s people interacted with "%s"', notifications.count + 1, $7::text),
       updated_at = $6`,
    [crypto.randomUUID(), recipientEmail, groupKey, singularTitle, simId, now, simName]
  );
}

// Someone subscribed to the recipient (a creator). Same escalating-group
// shape as upsertInteractionNotification above ("X subscribed to you" ->
// "N people subscribed to you" while unread) — this is still just an
// inbox notice about something that happened, never a persisted,
// always-visible follower count anywhere in the UI.
export async function upsertSubscribeNotification({ recipientEmail, actorName }) {
  const now = Date.now();
  const groupKey = "new_subscriber";
  const singularTitle = `${actorName} subscribed to you`;
  await query(
    `INSERT INTO notifications (id, recipient_email, kind, group_key, title, body, link_kind, link_id, count, created_at, updated_at, read_at)
     VALUES ($1, $2, 'new_subscriber', $3, $4, '', NULL, NULL, 1, $5, $5, NULL)
     ON CONFLICT (recipient_email, group_key) WHERE group_key IS NOT NULL AND read_at IS NULL
     DO UPDATE SET
       count = notifications.count + 1,
       title = format('%s people subscribed to you', notifications.count + 1),
       updated_at = $5`,
    [crypto.randomUUID(), recipientEmail, groupKey, singularTitle, now]
  );
}

// A creator the recipient subscribed to published a brand-new public
// world — never fired for an edit or a private save (see server.js's
// publishCommunitySim, the only call site). One-shot per (recipient,
// simId) via notifications_oneshot_idx, so a retried publish request
// can't fan out the same notification twice.
export async function insertNewWorldNotification({ recipientEmail, creatorName, simId, simName }) {
  const now = Date.now();
  await query(
    `INSERT INTO notifications (id, recipient_email, kind, group_key, title, body, link_kind, link_id, count, created_at, updated_at, read_at)
     VALUES ($1, $2, 'new_world', NULL, $3, '', 'community-sim', $4, 1, $5, $5, NULL)
     ON CONFLICT (recipient_email, kind, link_id) WHERE group_key IS NULL AND link_id IS NOT NULL DO NOTHING`,
    [crypto.randomUUID(), recipientEmail, `${creatorName} published a new world: "${simName}"`, simId, now]
  );
}

// The shared primitive behind every admin-triggered broadcast (product
// updates, newsletters, donor thank-yous — see server/notifyBroadcast.js).
// `broadcastId` is the caller's own stable idempotency key: re-running the
// same broadcast (a retried cron run, an admin re-submitting a form) with
// the same id is a guaranteed no-op per recipient via notifications_oneshot_idx,
// not just "unlikely to duplicate."
// Returns the number of rows ACTUALLY inserted (via RETURNING id, which
// ON CONFLICT DO NOTHING leaves empty for a skipped/deduped recipient) —
// re-running with the same broadcastId reports 0, not the recipient count,
// so a caller can tell a no-op retry from a real send.
export async function insertBroadcastNotifications(recipientEmails, { kind, title, body, broadcastId }) {
  const now = Date.now();
  let inserted = 0;
  for (const recipientEmail of recipientEmails) {
    try {
      const rows = await query(
        `INSERT INTO notifications (id, recipient_email, kind, group_key, title, body, link_kind, link_id, count, created_at, updated_at, read_at)
         VALUES ($1, $2, $3, NULL, $4, $5, NULL, $6, 1, $7, $7, NULL)
         ON CONFLICT (recipient_email, kind, link_id) WHERE group_key IS NULL AND link_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [crypto.randomUUID(), recipientEmail, kind, title, body, broadcastId, now]
      );
      if (rows.length) inserted++;
    } catch (e) {
      if (e.code !== "23503") throw e; // no account with this email anymore — skip it, don't fail the whole batch
    }
  }
  return inserted;
}

// ---------- weekly challenge completions ----------

export async function recordWeeklyChallengeCompletion(weekKey, challengeId, email, completedAt) {
  await query(
    `INSERT INTO weekly_challenge_completions (week_key, challenge_id, email, completed_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (week_key, email) DO NOTHING`,
    [weekKey, challengeId, email, completedAt]
  );
}

export async function countWeeklyChallengeCompletions(weekKey) {
  const rows = await query("SELECT COUNT(*)::int AS n FROM weekly_challenge_completions WHERE week_key = $1", [weekKey]);
  return rows[0]?.n ?? 0;
}

export async function hasCompletedWeeklyChallenge(weekKey, email) {
  const rows = await query("SELECT 1 FROM weekly_challenge_completions WHERE week_key = $1 AND email = $2", [weekKey, email]);
  return rows.length > 0;
}

// ---------- per-account challenge completions (achievements/badges) ----------

export async function recordChallengeCompletion(email, challengeId, completedAt) {
  await query(
    `INSERT INTO challenge_completions (email, challenge_id, completed_at) VALUES ($1, $2, $3)
     ON CONFLICT (email, challenge_id) DO NOTHING`,
    [email, challengeId, completedAt]
  );
}

export async function getChallengeCompletions(email) {
  const rows = await query("SELECT challenge_id FROM challenge_completions WHERE email = $1", [email]);
  return rows.map((r) => r.challenge_id);
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

// ---------- assignments ----------

export async function insertAssignment(id, classroomCode, teacherEmail, title, instructions, dueAt, createdAt, variation = null) {
  await query(
    `INSERT INTO assignments (id, classroom_code, teacher_email, title, instructions, due_at, created_at, variation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, classroomCode, teacherEmail, title, instructions, dueAt, createdAt, variation ? JSON.stringify(variation) : null]
  );
}

export async function getAssignment(id) {
  const rows = await query("SELECT * FROM assignments WHERE id = $1", [id]);
  return rows[0] || null;
}

// One row per assignment, with every completion for it attached — a
// teacher's classroom view needs both in one shot to show "6 of 12 done"
// plus who, and there's no separate per-assignment roster endpoint.
export async function assignmentsForClassroom(code) {
  const rows = await query(
    `SELECT a.id, a.title, a.instructions, a.due_at, a.created_at, a.variation,
            coalesce(array_agg(ac.student_email) FILTER (WHERE ac.student_email IS NOT NULL), '{}') AS completed_by
     FROM assignments a
     LEFT JOIN assignment_completions ac ON ac.assignment_id = a.id
     WHERE a.classroom_code = $1
     GROUP BY a.id
     ORDER BY a.created_at DESC`,
    [code]
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, instructions: r.instructions,
    dueAt: r.due_at == null ? null : Number(r.due_at), createdAt: Number(r.created_at),
    completedBy: r.completed_by, variation: r.variation || null,
  }));
}

export async function deleteAssignmentRow(id) {
  const rows = await query("DELETE FROM assignments WHERE id = $1 RETURNING 1", [id]);
  return rows.length > 0;
}

export async function setAssignmentComplete(assignmentId, studentEmail, completed, completedAt) {
  if (completed) {
    await query(
      `INSERT INTO assignment_completions (assignment_id, student_email, completed_at) VALUES ($1, $2, $3)
       ON CONFLICT (assignment_id, student_email) DO NOTHING`,
      [assignmentId, studentEmail, completedAt]
    );
  } else {
    await query("DELETE FROM assignment_completions WHERE assignment_id = $1 AND student_email = $2", [assignmentId, studentEmail]);
  }
}

// ---------- shared items ----------

export async function insertSharedItem(item) {
  await query(
    `INSERT INTO shared_items (id, kind, name, data, from_email, classroom_code, classroom_name, direction, created_at, note, assignment_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [item.id, item.kind, item.name, JSON.stringify(item.data), item.fromEmail, item.classroomCode, item.classroomName, item.direction, item.createdAt, item.note ?? "", item.assignmentId ?? null]
  );
}

function rowToSharedMeta(r) {
  return {
    id: r.id, kind: r.kind, name: r.name, fromEmail: r.from_email, classroomCode: r.classroom_code, classroomName: r.classroom_name,
    direction: r.direction, createdAt: Number(r.created_at), note: r.note || "",
    assignmentId: r.assignment_id, assignmentTitle: r.assignment_title ?? null,
  };
}

// LEFT JOINed against assignments so the client gets the assignment's
// current title for free — a plain assignment_id would otherwise need a
// second round trip (or the client cross-referencing its own separately
// fetched assignment list) just to show what it's called.
const SHARED_ITEM_COLUMNS = "s.*, a.title AS assignment_title";

export async function sharedItemsReceivedFor(teachingCodes, joinedCodes) {
  if (!teachingCodes.length && !joinedCodes.length) return [];
  const rows = await query(
    `SELECT ${SHARED_ITEM_COLUMNS} FROM shared_items s
     LEFT JOIN assignments a ON a.id = s.assignment_id
     WHERE (s.direction = 'to-teacher' AND s.classroom_code = ANY($1))
        OR (s.direction = 'to-students' AND s.classroom_code = ANY($2))
     ORDER BY s.created_at DESC`,
    [teachingCodes, joinedCodes]
  );
  return rows.map(rowToSharedMeta);
}

export async function sharedItemsSentBy(email) {
  const rows = await query(
    `SELECT ${SHARED_ITEM_COLUMNS} FROM shared_items s
     LEFT JOIN assignments a ON a.id = s.assignment_id
     WHERE s.from_email = $1 ORDER BY s.created_at DESC`,
    [email]
  );
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
