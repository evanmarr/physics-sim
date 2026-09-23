// Randomized assignments: a teacher picks which physics values vary
// (gravity, mass, launch power, …) and by how much (± percent of a base
// value). Every student then gets their own, deterministic set of values —
// derived from (student email, assignment id, variable) with a seeded hash,
// never from Math.random — so the numbers are stable across reloads and
// devices, and the teacher can recompute any student's values to grade them.
// The relationship being taught is identical for everyone; only the
// numbers change, so answers can't just be copied between students.
//
// Pure module (no DOM, no imports) — the server imports it to validate what
// a teacher posts, and the client imports the same file to compute values.

// `applies` documents what the value changes when applied to a student's sandbox
// (see applyVariation in main.js). Ranges match the toolbar's own limits.
export const VARIATION_VARS = [
  { id: "gravity", label: "Gravity", unit: "x Earth", base: 1, min: 0.05, max: 3, decimals: 2, applies: "Gravity slider" },
  { id: "airFriction", label: "Air friction", unit: "x", base: 1, min: 0, max: 10, decimals: 2, applies: "Air slider" },
  { id: "massScale", label: "Object mass", unit: "x", base: 1, min: 0.1, max: 10, decimals: 2, applies: "Density of every movable object, multiplied" },
  { id: "launchPower", label: "Launch / push power", unit: "x", base: 1, min: 0.2, max: 3, decimals: 2, applies: "Power of every cannon, bomb, fan, spring pad and magnet, multiplied" },
  { id: "frictionScale", label: "Surface friction", unit: "x", base: 1, min: 0.05, max: 3, decimals: 2, applies: "Friction of every object, multiplied" },
];

export const MAX_PERCENT = 50;
export const MIN_PERCENT = 1;

export function getVariationVar(id) { return VARIATION_VARS.find((v) => v.id === id) || null; }

// 32-bit FNV-1a → mulberry32: a tiny, well-distributed seeded PRNG.
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function seededUnit(seedStr) {
  let a = hashString(seedStr) + 0x6d2b79f5;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296; // [0, 1)
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Normalizes whatever a client posts into a safe config, or null when it
// has nothing to randomize. Unknown variables and duplicates are dropped,
// numbers are clamped into each variable's allowed range.
export function sanitizeVariation(raw) {
  const list = Array.isArray(raw?.params) ? raw.params : [];
  const seen = new Set(), params = [];
  for (const p of list) {
    const def = getVariationVar(p?.id);
    if (!def || seen.has(def.id)) continue;
    const base = Number(p.base), pct = Number(p.pct);
    if (!Number.isFinite(base) || !Number.isFinite(pct)) continue;
    seen.add(def.id);
    params.push({
      id: def.id,
      base: Number(clamp(base, def.min, def.max).toFixed(4)),
      pct: Math.round(clamp(pct, MIN_PERCENT, MAX_PERCENT)),
    });
  }
  return params.length ? { params } : null;
}

// One student's values: base × (1 + u·pct/100) with u uniform in [-1, 1],
// rounded and kept inside the variable's allowed range.
export function valuesFor(variation, assignmentId, studentEmail) {
  const out = {};
  for (const p of variation?.params || []) {
    const def = getVariationVar(p.id);
    if (!def) continue;
    const u = seededUnit(`${assignmentId}|${String(studentEmail).toLowerCase()}|${p.id}`) * 2 - 1;
    const raw = p.base * (1 + (u * p.pct) / 100);
    out[p.id] = Number(clamp(raw, def.min, def.max).toFixed(def.decimals));
  }
  return out;
}

// The lowest/highest a value can be under this config — shown to the teacher.
export function rangeOf(param) {
  const def = getVariationVar(param.id);
  return [clamp(param.base * (1 - param.pct / 100), def.min, def.max), clamp(param.base * (1 + param.pct / 100), def.min, def.max)];
}

export function describeValues(values) {
  return Object.entries(values).map(([id, v]) => {
    const def = getVariationVar(id);
    return def ? `${def.label} ${v}${def.unit === "x" || def.unit === "x Earth" ? "×" : ""}` : null;
  }).filter(Boolean);
}
