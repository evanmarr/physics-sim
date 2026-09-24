import { test, assert } from "./helpers.js";
import { CHALLENGES, checkIntegrity, restoreCritical } from "../src/challenges.js";

test("challenge integrity: every challenge defines critical parts that exist in its build", () => {
  for (const c of CHALLENGES) {
    assert.ok(c.critical?.length, c.id + " has critical parts");
    const ids = new Set(c.build().map((o) => o.id));
    for (const part of c.critical) { assert.ok(ids.has(part.id), `${c.id}: ${part.id}`); assert.ok(part.props.length && part.label); }
    assert.equal(checkIntegrity(c, c.build()).ok, true, c.id + " pristine is ok");
  }
});
test("challenge integrity: moving, changing or deleting a critical part breaks it; tunables don't", () => {
  const c = CHALLENGES.find((x) => x.id === "float_test");
  const moved = c.build().map((o) => (o.id === "chal_md_magnet" ? { ...o, x: o.x + 50 } : o));
  const r = checkIntegrity(c, moved);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems[0].changed, ["x"]);
  const deleted = c.build().filter((o) => o.id !== "chal_md_floor");
  assert.equal(checkIntegrity(c, deleted).problems[0].deleted, true);
  const tuned = c.build().map((o) => (o.id === "chal_md_ball" ? { ...o, material: "metal" } : o));
  assert.equal(checkIntegrity(c, tuned).ok, true); // the intended fix is allowed
  assert.equal(checkIntegrity(c, c.build().map((o) => (o.id === "chal_md_magnet" ? { ...o, x: o.x + 0.3 } : o))).ok, true); // grid rounding tolerated
});
test("challenge integrity: restore puts parts back and keeps the player's extras", () => {
  const c = CHALLENGES.find((x) => x.id === "fan_lift");
  const broken = [...c.build().filter((o) => o.id !== "chal_fl_ceiling").map((o) => (o.id === "chal_fl_marker" ? { ...o, y: 0 } : o)), { id: "mine", type: "ball", x: 1, y: 1 }];
  const fixed = restoreCritical(c, broken);
  assert.equal(checkIntegrity(c, fixed).ok, true);
  assert.ok(fixed.some((o) => o.id === "mine"));
});
