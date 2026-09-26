import { test, assert } from "./helpers.js";
import { serializeDesign, sanitizeDesign, sanitizeGrid, SAVE_COLS, SAVE_ROWS, SAVE_MATERIALS, SAVE_DISASTERS, SAVE_COSTS, SAVE_BUDGET } from "../src/structureSave.js";
import { COLS, ROWS, MATERIALS, BUDGET, TEMPLATES } from "../src/structures.js";

test("structureSave constants match structures.js", () => {
  assert.equal(SAVE_COLS, COLS); assert.equal(SAVE_ROWS, ROWS); assert.equal(SAVE_BUDGET, BUDGET);
  assert.deepEqual([...SAVE_MATERIALS].sort(), Object.keys(MATERIALS).sort());
  for (const m of SAVE_MATERIALS) assert.equal(SAVE_COSTS[m], MATERIALS[m].cost);
});

test("round trip of a template keeps the grid", () => {
  const grid = TEMPLATES.house();
  const d = sanitizeDesign(JSON.parse(JSON.stringify(serializeDesign({ grid, disaster: "wind", params: { cat: 4 }, name: "H" }))));
  assert.deepEqual(d.grid, grid);
  assert.equal(d.disaster, "wind");
  assert.equal(d.params.cat, 4);
  assert.equal(d.name, "H");
});

test("sanitize clamps numbers, drops unknown materials and fields", () => {
  const g = new Array(10).fill("unobtainium"); g[0] = "wood";
  const d = sanitizeDesign({ grid: g, disaster: "meteor", params: { mag: 99, freq: "x", cat: 2.6 }, evil: 1, mat: "nope" });
  assert.equal(d.grid.length, SAVE_COLS * SAVE_ROWS);
  assert.equal(d.grid[0], "wood");
  assert.equal(d.grid.filter(Boolean).length, 1);
  assert.equal(d.disaster, "earthquake");
  assert.equal(d.params.mag, 9);
  assert.equal(d.params.freq, 2);
  assert.equal(d.params.cat, 3);
  assert.equal(d.mat, "wood");
  assert.equal("evil" in d, false);
});

test("foundations only on the ground row; budget enforced; garbage rejected", () => {
  const g = new Array(SAVE_COLS * SAVE_ROWS).fill(null);
  g[0] = "foundation"; g[SAVE_COLS * (SAVE_ROWS - 1)] = "foundation";
  const s = sanitizeGrid(g);
  assert.equal(s[0], null); assert.equal(s[SAVE_COLS * (SAVE_ROWS - 1)], "foundation");
  const steel = sanitizeGrid(new Array(SAVE_COLS * SAVE_ROWS).fill("steel"));
  assert.ok(steel.filter(Boolean).length * 180 <= SAVE_BUDGET);
  assert.equal(sanitizeDesign(null), null);
  assert.equal(sanitizeDesign([1]), null);
  assert.equal(sanitizeGrid("x").length, SAVE_COLS * SAVE_ROWS);
});
