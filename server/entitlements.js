// Centralized entitlement resolution — the ONE place in the app that
// answers "can this user do X." Every plan check anywhere else (server
// routes, client display) should read from resolveEntitlements()'s result,
// not re-derive its own "is this user Plus" logic from raw DB columns.
//
// Plan is a base tier: "free" | "plus" | "teacher" — teacher is treated as
// a strict superset of plus (see PLAN_INCLUDES_PLUS below), matching the
// product rule "Teacher includes Plus features plus classrooms/...".
//
// AI access is tracked as its OWN field, deliberately separate from plan:
// paid Plus may someday include AI, promo Plus never does, and a bare
// `plan === "plus"` check must never be read anywhere as "this user can
// use AI." See aiEnabled below and PLAN_SOURCES.PROMO_PLUS.

export const PLANS = ["free", "plus", "teacher"];

// How a user's plan came to be — kept even after resolution so the UI and
// future support tooling can explain "why do you have this," not just
// state a bare tier name. Not meant to be exhaustive of every possible
// future source; add to this list rather than overloading an existing one.
export const PLAN_SOURCES = {
  FREE: "free",
  PAID_PLUS: "paid_plus",
  PROMO_PLUS: "promo_plus",
  TEACHER: "teacher",
  CLASSROOM_ASSIGNMENT: "classroom_assignment",
  ADMIN: "admin",
};

const PLAN_INCLUDES_PLUS = new Set(["plus", "teacher"]);

// Free-tier and Plus-tier limits live here — the one place "how many saved
// worlds does Free get" is actually decided, instead of a bare number
// dropped into a route handler. server.js reads these instead of its own
// hardcoded MAX_WORLDS-style constants.
//
// `null` means "unlimited" — used instead of `Infinity` because this
// object gets sent to the client as JSON, and `JSON.stringify(Infinity)`
// silently becomes `null` anyway; using `null` on purpose (and exporting
// `isUnlimited()` below) keeps server and client reading the exact same
// value instead of one side seeing `Infinity` and the other seeing `null`.
export const LIMITS = {
  free: {
    maxWorlds: 6, maxMathItems: 6, maxCities: 3, maxCustomItems: 0,
    notebookEntries: 8, compareRunsHistory: 2, graphHistorySeconds: 60,
    shareCodesEnabled: false, customItemsEnabled: false, physics3dEnabled: false,
  },
  plus: {
    maxWorlds: 40, maxMathItems: 40, maxCities: 20, maxCustomItems: 30,
    notebookEntries: null, compareRunsHistory: null, graphHistorySeconds: null,
    shareCodesEnabled: true, customItemsEnabled: true, physics3dEnabled: true,
  },
};
export function isUnlimited(limitValue) { return limitValue === null; }
LIMITS.teacher = LIMITS.plus;

// Resolves a raw `users` row (as returned by db.getUser) into the shape
// every feature check should use. Never mutates the row or the database —
// a lazily-expired grant reads back as free from here on, but the DB row
// itself is left alone so redemption/grant history stays intact for audit.
export function resolveEntitlements(userRow) {
  const now = Date.now();
  let plan = PLANS.includes(userRow?.plan) ? userRow.plan : "free";
  let planSource = userRow?.plan_source || PLAN_SOURCES.FREE;
  const expiresAt = userRow?.plan_expires_at != null ? Number(userRow.plan_expires_at) : null;

  if (expiresAt && now >= expiresAt && plan !== "free") {
    plan = "free";
    planSource = PLAN_SOURCES.FREE;
  }

  const isPlus = PLAN_INCLUDES_PLUS.has(plan);
  const isTeacher = plan === "teacher";
  // Explicit column, never derived from plan — see the file header. Promo
  // Plus is hard-blocked here even if the ai_enabled column were ever
  // mistakenly set true for a promo account, since that's the one mistake
  // this system must never allow silently.
  const aiEnabled = !!userRow?.ai_enabled && planSource !== PLAN_SOURCES.PROMO_PLUS;

  return { plan, planSource, isPlus, isTeacher, aiEnabled, expiresAt, limits: LIMITS[plan] || LIMITS.free };
}

// A student working a specific teacher assignment may need scoped access
// to Plus-only tools (advanced graphs, Notebook, Compare Runs, a
// teacher-shared world) WITHOUT their account becoming Plus anywhere else
// in the app — and this must never persist past the assignment context.
// This composes an assignment-scoped view on top of an already-resolved
// base entitlement; it does not read or write the database itself.
//
// NOT YET WIRED to a real route: the full classroom-assignment feature
// (rosters/assignments/submissions) doesn't exist in this codebase yet —
// this exists so that feature can slot into the entitlement model later
// without another redesign. See README.md's "known limitations."
export function withClassroomAssignmentScope(base, { activeAssignment } = {}) {
  if (!activeAssignment) return base;
  if (base.isPlus) return base; // already has it everywhere — no scoping needed
  return {
    ...base,
    isPlus: true,
    planSource: PLAN_SOURCES.CLASSROOM_ASSIGNMENT,
    limits: LIMITS.plus,
    scoped: true, // marks this as a temporary, assignment-bound grant — never persisted
  };
}

// What the client is allowed to see about its own entitlements. Deliberately
// a narrow, explicit projection (not "spread the whole resolved object")
// so a new internal field never leaks to the client by accident.
export function publicEntitlements(resolved) {
  return {
    plan: resolved.plan,
    planSource: resolved.planSource,
    isPlus: resolved.isPlus,
    isTeacher: resolved.isTeacher,
    aiEnabled: resolved.aiEnabled,
    expiresAt: resolved.expiresAt,
    limits: resolved.limits,
  };
}
