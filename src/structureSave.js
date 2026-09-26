// Pure serialize/sanitize helpers for saving Structure Tester designs.
// No DOM, no Matter — unit tested under node (tests/structureSave.test.js).
// Constants mirror src/structures.js; a test asserts they stay in sync.

export const SAVE_COLS = 30, SAVE_ROWS = 18;
export const SAVE_MATERIALS = ["wood", "steel", "concrete", "brick", "glass", "foundation", "brace"];
export const SAVE_DISASTERS = ["earthquake", "wind", "flood", "snow", "tsunami"];
export const SAVE_BUDGET = 15000;
export const SAVE_COSTS = { wood: 40, steel: 180, concrete: 120, brick: 70, glass: 60, foundation: 150, brace: 90 };
export const PARAM_RANGES = {
  mag: [4, 9, 7], freq: [0.5, 8, 2], quakeDur: [5, 30, 12],
  cat: [1, 5, 3], depth: [1, 10, 4], snow: [1, 20, 4], wave: [2, 12, 5],
};
export const DRAFT_KEY = "kinetic-structure-draft-v1";

function num(v, [min, max, def]) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeParams(p) {
  const out = {};
  for (const k of Object.keys(PARAM_RANGES)) out[k] = num(p && p[k], PARAM_RANGES[k]);
  out.cat = Math.round(out.cat);
  return out;
}

// Returns a clean grid: right length, only known materials, foundations only
// on the ground row, and the budget respected (excess cells dropped).
export function sanitizeGrid(grid) {
  const out = new Array(SAVE_COLS * SAVE_ROWS).fill(null);
  if (!Array.isArray(grid)) return out;
  let cost = 0;
  for (let i = 0; i < out.length && i < grid.length; i++) {
    const m = grid[i];
    if (typeof m !== "string" || !SAVE_MATERIALS.includes(m)) continue;
    if (m === "foundation" && Math.floor(i / SAVE_COLS) !== SAVE_ROWS - 1) continue;
    if (cost + SAVE_COSTS[m] > SAVE_BUDGET) continue;
    cost += SAVE_COSTS[m];
    out[i] = m;
  }
  return out;
}

export function serializeDesign({ grid, disaster, params, mat, name } = {}) {
  return {
    v: 1,
    name: typeof name === "string" ? name.slice(0, 60) : "",
    grid: sanitizeGrid(grid),
    disaster: SAVE_DISASTERS.includes(disaster) ? disaster : "earthquake",
    params: sanitizeParams(params),
    mat: SAVE_MATERIALS.includes(mat) ? mat : "wood",
  };
}

// Accepts anything (server data, localStorage); unknown fields are ignored.
// Returns null when it isn't an object at all.
export function sanitizeDesign(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return serializeDesign(data);
}
