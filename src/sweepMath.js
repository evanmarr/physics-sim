// Pure logic for Parameter Sweep (Plus): which variables can be swept, the
// list of values to try, and the metrics computed from one run's recorded
// trace. The headless runner and the UI live in paramSweep.js.
import { GRID_SIZE } from "./world.js";
import { MPS_PER_PX_STEP } from "./measureMath.js";

export const MAX_RUNS = 25;
export const MAX_DURATION_S = 20;

// scope "world": changes an environment slider. scope "object": edits one
// property of the object being varied, using the same spec field the
// property panel writes (so a sweep is exactly "what if I dragged that slider").
export const VARIABLES = [
  { id: "gravity", label: "Gravity", unit: "x Earth", scope: "world", min: 0.1, max: 3, appliesTo: null },
  { id: "air", label: "Air friction", unit: "x", scope: "world", min: 0, max: 10, appliesTo: null },
  { id: "density", label: "Density", unit: "ρ", scope: "object", key: "densityOverride", min: 0.1, max: 12, appliesTo: (s) => s.type !== "text" },
  { id: "friction", label: "Friction", unit: "μ", scope: "object", key: "frictionOverride", min: 0, max: 1.2, appliesTo: (s) => s.type !== "text" },
  { id: "restitution", label: "Bounciness", unit: "e", scope: "object", key: "restitutionOverride", min: 0, max: 1, appliesTo: (s) => s.type !== "text" },
  { id: "rotation", label: "Angle (tilt)", unit: "°", scope: "object", key: "rotation", min: -60, max: 60, appliesTo: (s) => s.type !== "text" && s.type !== "ball" },
  { id: "power", label: "Power / launch speed", unit: "", scope: "object", key: "power", min: 4, max: 50, appliesTo: (s) => ["cannon", "bomb", "fan", "springPad", "magnet"].includes(s.type) },
  { id: "launchAngle", label: "Fire angle", unit: "°", scope: "object", key: "launchRotation", min: -90, max: 90, appliesTo: (s) => s.type === "cannon" },
];

export const METRICS = [
  { id: "maxHeight", label: "Peak height gained", unit: "m" },
  { id: "range", label: "Horizontal distance (end − start)", unit: "m" },
  { id: "maxSpeed", label: "Top speed", unit: "m/s" },
  { id: "finalSpeed", label: "Final speed", unit: "m/s" },
  { id: "pathLength", label: "Distance travelled", unit: "m" },
  { id: "settleTime", label: "Time to come to rest", unit: "s" },
];

export function getVariable(id) { return VARIABLES.find((v) => v.id === id) || null; }

// n evenly spaced values from min to max inclusive. n is clamped to
// [2, MAX_RUNS]; min > max is fine (counts down). Values are rounded so the
// table shows 0.3 not 0.30000000000000004.
export function sweepValues(min, max, n) {
  const count = Math.max(2, Math.min(MAX_RUNS, Math.round(n) || 2));
  const out = [];
  for (let i = 0; i < count; i++) out.push(Number((min + ((max - min) * i) / (count - 1)).toPrecision(10)));
  return out;
}

export function validateSweep({ variable, min, max, runs, duration }) {
  const v = getVariable(variable);
  if (!v) return "Pick a variable to sweep.";
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "Enter a start and end value.";
  if (min === max) return "The start and end values must differ.";
  if (!(runs >= 2)) return "Run at least 2 experiments.";
  if (runs > MAX_RUNS) return `Up to ${MAX_RUNS} runs at a time.`;
  if (!(duration > 0) || duration > MAX_DURATION_S) return `Duration must be between 0 and ${MAX_DURATION_S} seconds.`;
  return null;
}

// trace: [{ t (ms), x, y, vx, vy }] in px / px-per-step, sampled during a
// run. Returns a plain { metricId: number } in metres / seconds.
export function computeMetrics(trace) {
  const out = { maxHeight: 0, range: 0, maxSpeed: 0, finalSpeed: 0, pathLength: 0, settleTime: 0 };
  if (!trace.length) return out;
  const first = trace[0], last = trace[trace.length - 1];
  let minY = first.y, path = 0, maxSpeed = 0;
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    if (p.y < minY) minY = p.y;
    maxSpeed = Math.max(maxSpeed, Math.hypot(p.vx, p.vy));
    if (i) path += Math.hypot(p.x - trace[i - 1].x, p.y - trace[i - 1].y);
  }
  out.maxHeight = (first.y - minY) / GRID_SIZE;
  out.range = (last.x - first.x) / GRID_SIZE;
  out.maxSpeed = maxSpeed * MPS_PER_PX_STEP;
  out.finalSpeed = Math.hypot(last.vx, last.vy) * MPS_PER_PX_STEP;
  out.pathLength = path / GRID_SIZE;
  // First moment after which the object stays slower than the threshold
  // (0.05 px/step ≈ 0.15 m/s) for the rest of the run; the full run length if it never does.
  const REST = 0.05;
  let restSince = null;
  for (const p of trace) {
    if (Math.hypot(p.vx, p.vy) < REST) { if (restSince == null) restSince = p.t; } else restSince = null;
  }
  out.settleTime = (restSince == null ? last.t : restSince) / 1000;
  return out;
}

// Rows -> CSV text. rows: [{ value, metrics: {...} }]
export function sweepToCsv(variableLabel, rows) {
  const header = [variableLabel, ...METRICS.map((m) => `${m.label} (${m.unit})`)].join(",");
  const body = rows.map((r) => [r.value, ...METRICS.map((m) => Number(r.metrics[m.id]).toFixed(4))].join(","));
  return [header, ...body].join("\n");
}

// Which row gives the largest / smallest value of a metric (for the summary line).
export function bestRow(rows, metricId, mode = "max") {
  if (!rows.length) return null;
  return rows.reduce((best, r) => (mode === "max" ? r.metrics[metricId] > best.metrics[metricId] : r.metrics[metricId] < best.metrics[metricId]) ? r : best);
}
