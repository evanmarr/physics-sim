import { test, assert } from "./helpers.js";
import { compileExpression } from "../src/mathExpr.js";

const ev = (s, x = 0) => compileExpression(s)(x);

test("mathExpr: -2^2 is -4 and 2^3^2 is 512", () => {
  assert.equal(ev("-2^2"), -4);
  assert.equal(ev("2^3^2"), 512);
  assert.equal(ev("2^-1"), 0.5);
});
test("mathExpr: implicit multiplication", () => {
  assert.equal(ev("2x", 3), 6);
  assert.equal(ev("(x+1)(x-1)", 3), 8);
});
test("mathExpr: malformed numbers are errors", () => {
  for (const s of ["1.2.3", ".", "1..2"]) {
    let threw = false;
    try { compileExpression(s); } catch { threw = true; }
    assert.ok(threw, s);
  }
  assert.equal(ev(".5"), 0.5);
  assert.equal(ev("3."), 3);
});
