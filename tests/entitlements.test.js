import { test, assert } from "./helpers.js";
import { resolveEntitlements, withClassroomAssignmentScope, PLAN_SOURCES, LIMITS, isUnlimited } from "../server/entitlements.js";

test("default/missing user row resolves to free", () => {
  const r = resolveEntitlements({});
  assert.equal(r.plan, "free");
  assert.equal(r.isPlus, false);
  assert.equal(r.aiEnabled, false);
});

test("paid Plus with ai_enabled=true resolves aiEnabled=true", () => {
  const r = resolveEntitlements({ plan: "plus", plan_source: "paid_plus", ai_enabled: true });
  assert.equal(r.isPlus, true);
  assert.equal(r.aiEnabled, true);
});

test("CRITICAL: promo Plus never gets AI, even if ai_enabled is mistakenly true", () => {
  const r = resolveEntitlements({ plan: "plus", plan_source: "promo_plus", ai_enabled: true });
  assert.equal(r.isPlus, true);
  assert.equal(r.aiEnabled, false, "promo_plus must hard-block AI regardless of the ai_enabled column");
});

test("teacher plan includes Plus-level access", () => {
  const r = resolveEntitlements({ plan: "teacher", plan_source: "teacher" });
  assert.equal(r.isPlus, true);
  assert.equal(r.isTeacher, true);
  assert.deepEqual(r.limits, LIMITS.teacher);
});

test("expired plan_expires_at lazily downgrades to free without mutating input", () => {
  const row = { plan: "plus", plan_source: "promo_plus", plan_expires_at: Date.now() - 1000 };
  const r = resolveEntitlements(row);
  assert.equal(r.plan, "free");
  assert.equal(r.planSource, PLAN_SOURCES.FREE);
  assert.equal(row.plan, "plus", "the raw row must not be mutated");
});

test("a future plan_expires_at does NOT downgrade", () => {
  const r = resolveEntitlements({ plan: "plus", plan_source: "promo_plus", plan_expires_at: Date.now() + 100000 });
  assert.equal(r.plan, "plus");
});

test("an invalid/garbage plan string falls back to free, not a crash", () => {
  const r = resolveEntitlements({ plan: "super-admin-hacker", plan_source: "??" });
  assert.equal(r.plan, "free");
});

test("free vs plus limits actually differ and free is never higher", () => {
  assert.ok(LIMITS.free.maxWorlds < LIMITS.plus.maxWorlds);
  assert.equal(LIMITS.free.customItemsEnabled, false);
  assert.equal(LIMITS.plus.customItemsEnabled, true);
  assert.equal(isUnlimited(LIMITS.plus.notebookEntries), true);
  assert.equal(isUnlimited(LIMITS.free.notebookEntries), false);
});

test("classroom-assignment scoping grants Plus-shaped limits without persisting a source change for an already-Plus user", () => {
  const alreadyPlus = resolveEntitlements({ plan: "plus", plan_source: "paid_plus" });
  const scoped = withClassroomAssignmentScope(alreadyPlus, { activeAssignment: true });
  assert.equal(scoped.planSource, "paid_plus", "an existing Plus source must not be overwritten by assignment scoping");
});

test("classroom-assignment scoping grants a free user Plus-shaped limits, marked as scoped/temporary", () => {
  const free = resolveEntitlements({});
  const scoped = withClassroomAssignmentScope(free, { activeAssignment: true });
  assert.equal(scoped.isPlus, true);
  assert.equal(scoped.scoped, true);
  assert.equal(scoped.planSource, PLAN_SOURCES.CLASSROOM_ASSIGNMENT);
});

test("without an active assignment, scoping is a no-op", () => {
  const free = resolveEntitlements({});
  const notScoped = withClassroomAssignmentScope(free, { activeAssignment: false });
  assert.equal(notScoped.isPlus, false);
});
