import { test, assert } from "./helpers.js";
import { isConvexSimplePolygon, isSimplePolygon, regularPolygon } from "../src/objectTypes.js";

test("a regular hexagon (the actual default starting shape) is valid", () => {
  assert.equal(isConvexSimplePolygon(regularPolygon(6, 80)), true);
});

test("every regular N-gon from a triangle to a 12-gon is valid", () => {
  for (let n = 3; n <= 12; n++) {
    assert.equal(isConvexSimplePolygon(regularPolygon(n, 50)), true, `regularPolygon(${n}) should be convex`);
  }
});

test("a concave (caved-in) quadrilateral is rejected", () => {
  const dart = [{ x: 0, y: -80 }, { x: 60, y: 40 }, { x: 0, y: 0 }, { x: -60, y: 40 }];
  assert.equal(isConvexSimplePolygon(dart), false);
});

test("a self-intersecting (bowtie) quadrilateral is rejected", () => {
  const bowtie = [{ x: -50, y: -50 }, { x: 50, y: 50 }, { x: 50, y: -50 }, { x: -50, y: 50 }];
  assert.equal(isConvexSimplePolygon(bowtie), false);
});

test("fewer than 3 vertices is always rejected", () => {
  assert.equal(isConvexSimplePolygon([]), false);
  assert.equal(isConvexSimplePolygon([{ x: 0, y: 0 }]), false);
  assert.equal(isConvexSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
});

test("a simple valid triangle is accepted", () => {
  assert.equal(isConvexSimplePolygon([{ x: 0, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }]), true);
});

test("a degenerate triangle with all collinear points is rejected", () => {
  assert.equal(isConvexSimplePolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]), false);
});

test("a slightly irregular but still-convex pentagon (a dragged vertex) is accepted", () => {
  const pentagon = regularPolygon(5, 80);
  pentagon[0] = { x: pentagon[0].x, y: pentagon[0].y + 20 }; // nudge outward, still convex
  assert.equal(isConvexSimplePolygon(pentagon), true);
});

// isSimplePolygon — the relaxed check that allows concave shapes (poly-decomp
// support) but still rejects self-intersection, used by the actual editor now.
test("isSimplePolygon accepts a concave (caved-in) quadrilateral — poly-decomp can handle it", () => {
  const dart = [{ x: 0, y: -80 }, { x: 60, y: 40 }, { x: 0, y: 0 }, { x: -60, y: 40 }];
  assert.equal(isSimplePolygon(dart), true);
});

test("isSimplePolygon accepts a real concave star shape", () => {
  const star = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 80 : 35;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    star.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  assert.equal(isSimplePolygon(star), true);
  assert.equal(isConvexSimplePolygon(star), false, "a 10-point star should NOT pass the strict convex-only check");
});

test("isSimplePolygon still rejects a self-intersecting (bowtie) quadrilateral", () => {
  const bowtie = [{ x: -50, y: -50 }, { x: 50, y: 50 }, { x: 50, y: -50 }, { x: -50, y: 50 }];
  assert.equal(isSimplePolygon(bowtie), false);
});

test("isSimplePolygon still accepts every convex regular N-gon", () => {
  for (let n = 3; n <= 12; n++) {
    assert.equal(isSimplePolygon(regularPolygon(n, 50)), true, `regularPolygon(${n}) should be simple`);
  }
});

test("isSimplePolygon rejects a degenerate (zero-area, all collinear) triangle", () => {
  assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]), false);
});

test("isSimplePolygon rejects fewer than 3 vertices", () => {
  assert.equal(isSimplePolygon([]), false);
  assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
});
