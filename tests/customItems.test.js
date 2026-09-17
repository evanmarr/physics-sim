import { test, assert } from "./helpers.js";
import { isConvexSimplePolygon, regularPolygon } from "../src/objectTypes.js";

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
