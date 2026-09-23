import { test, assert } from "./helpers.js";
import { PRESETS, getPreset, matchPreset, presetInfo, LIMITS, STANDARD_GRAVITY } from "../src/physicsPresets.js";
import { distance, angleAt, elevationDeg, pxToMeters, velocityToMps, ForceEstimator, Stopwatch, TrajectoryRecorder, simMass } from "../src/measureMath.js";
import { sweepValues, validateSweep, computeMetrics, sweepToCsv, bestRow, getVariable, VARIABLES, MAX_RUNS, METRICS } from "../src/sweepMath.js";
import { sanitizeVariation, valuesFor, seededUnit, rangeOf, VARIATION_VARS, describeValues } from "../src/assignmentVariation.js";

// ---------- presets ----------
test("presets: real gravity ratios", () => {
  assert.equal(getPreset("earth").settings.gravity, 1);
  assert.equal(getPreset("moon").settings.gravity, Number((1.62 / STANDARD_GRAVITY).toFixed(3)));
  assert.equal(getPreset("mars").settings.gravity, Number((3.71 / STANDARD_GRAVITY).toFixed(3)));
  assert.ok(Math.abs(getPreset("jupiter").settings.gravity - 2.528) < 0.001);
  assert.equal(getPreset("space").settings.gravity, 0);
});
test("presets: air ratios and vacuum", () => {
  assert.equal(getPreset("vacuum").settings.airFriction, 0);
  assert.equal(getPreset("moon").settings.airFriction, 0);
  assert.ok(getPreset("mars").settings.airFriction < 0.05);
  assert.ok(getPreset("titan").settings.airFriction > 4);
});
test("presets: every setting lies inside the toolbar's slider limits", () => {
  for (const p of PRESETS) {
    const { gravity, airFriction } = p.settings;
    assert.ok(gravity >= LIMITS.gravity[0] && gravity <= LIMITS.gravity[1], p.id + " gravity");
    assert.ok(airFriction >= LIMITS.air[0] && airFriction <= LIMITS.air[1], p.id + " air");
  }
});
test("presets: underwater is flagged as clamped and lists the buoyancy caveat", () => {
  const u = getPreset("underwater");
  assert.equal(u.clamped.air, true);
  assert.equal(u.settings.airFriction, 10);
  assert.ok(u.assumptions.some((a) => /buoyancy/i.test(a)));
});
test("presets: every preset labels facts, assumptions and a source", () => {
  for (const p of PRESETS) {
    assert.ok(p.facts.length && p.assumptions.length && p.source, p.id);
    const info = presetInfo(p);
    assert.ok(info.title && info.sources.length && info.assumptions.length);
  }
});
test("presets: matchPreset finds a preset and returns null for custom values", () => {
  assert.equal(matchPreset({ gravity: 0.165, airFriction: 0, frictionScale: 1 }).id, "moon");
  assert.equal(matchPreset({ gravity: 1.7, airFriction: 3, frictionScale: 1 }), null);
  assert.equal(matchPreset({ gravity: 1, airFriction: 1, frictionScale: 0.1 }).id, "ice");
});

// ---------- measurement math ----------
test("measure: distance, unit conversion, angle", () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(pxToMeters(100), 5);
  assert.ok(Math.abs(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }) - 90) < 1e-9);
  assert.ok(Math.abs(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }) - 180) < 1e-9);
  assert.ok(Number.isNaN(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })));
  assert.ok(Math.abs(elevationDeg({ x: 0, y: 0 }, { x: 1, y: -1 }) - 45) < 1e-9); // up-right on screen
  assert.equal(velocityToMps(2), 6);
});
test("measure: F = m·a from a steady speed-up (and ≈0 at constant velocity)", () => {
  const est = new ForceEstimator(90);
  // vx grows 0.1 px/step per 100 ms → a = 0.1*3 m/s / 0.1 s = 3 m/s²
  for (let t = 0; t <= 400; t += 20) est.push(t, (t / 100) * 0.1, 0);
  const f = est.force(2);
  assert.ok(Math.abs(f.fx - 6) < 0.5, "fx " + f.fx);
  assert.ok(Math.abs(f.fy) < 1e-9);
  const still = new ForceEstimator();
  for (let t = 0; t <= 400; t += 20) still.push(t, 1, 0);
  assert.ok(Math.abs(still.force(5).fx) < 1e-9);
  assert.equal(new ForceEstimator().force(1), null);
});
test("measure: force estimator drops stale samples after a reset", () => {
  const est = new ForceEstimator();
  est.push(1000, 5, 0); est.push(1100, 5, 0);
  est.push(0, 0, 0); // sim restarted — time went backwards
  assert.equal(est.samples.length, 1);
});
test("measure: stopwatch runs on sim time, stops, laps, resets", () => {
  const sw = new Stopwatch();
  assert.equal(sw.elapsed(500), 0);
  sw.start(1000);
  assert.equal(sw.elapsed(1600), 600);
  sw.stop(2000);
  assert.equal(sw.elapsed(9999), 1000); // stopped: frozen
  sw.start(3000);
  assert.equal(sw.elapsed(3500), 1500);
  sw.lap(3500);
  assert.deepEqual(sw.laps, [1500]);
  sw.reset();
  assert.equal(sw.elapsed(4000), 0);
});
test("measure: trajectory thins points and totals the path", () => {
  const rec = new TrajectoryRecorder(4);
  assert.equal(rec.push("a", 0, 0, 0), true);
  assert.equal(rec.push("a", 16, 1, 0), false); // too close
  rec.push("a", 32, 20, 0); rec.push("a", 48, 20, 20);
  const s = rec.summary("a");
  assert.equal(s.points, 3);
  assert.equal(s.pathMeters, 2); // 40 px = 2 m
  assert.ok(Math.abs(s.displacementMeters - Math.hypot(20, 20) / 20) < 1e-9);
  rec.clear("a");
  assert.equal(rec.get("a").length, 0);
  assert.equal(simMass(2, 1000), 2);
});

// ---------- parameter sweep ----------
test("sweep: values are evenly spaced, inclusive, clamped, and clean", () => {
  assert.deepEqual(sweepValues(0, 1, 5), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(sweepValues(3, 1, 3), [3, 2, 1]);
  assert.equal(sweepValues(0, 1, 500).length, MAX_RUNS);
  assert.equal(sweepValues(0, 1, 1).length, 2);
  assert.deepEqual(sweepValues(0.1, 0.4, 4), [0.1, 0.2, 0.3, 0.4]); // no 0.30000000000000004
});
test("sweep: validation", () => {
  const ok = { variable: "gravity", min: 0.5, max: 2, runs: 5, duration: 5 };
  assert.equal(validateSweep(ok), null);
  assert.ok(validateSweep({ ...ok, variable: "nope" }));
  assert.ok(validateSweep({ ...ok, min: NaN }));
  assert.ok(validateSweep({ ...ok, max: 0.5 }));
  assert.ok(validateSweep({ ...ok, runs: 1 }));
  assert.ok(validateSweep({ ...ok, runs: MAX_RUNS + 1 }));
  assert.ok(validateSweep({ ...ok, duration: 0 }));
  assert.ok(validateSweep({ ...ok, duration: 999 }));
});
test("sweep: metrics from a known trace (ball thrown up and right)", () => {
  // 20 px = 1 m. rises 100 px (5 m), moves 200 px right (10 m), ends at rest.
  const trace = [
    { t: 0, x: 0, y: 0, vx: 1, vy: -2 },
    { t: 500, x: 100, y: -100, vx: 1, vy: 0 },
    { t: 1000, x: 200, y: 0, vx: 0, vy: 0 },
    { t: 1500, x: 200, y: 0, vx: 0, vy: 0 },
  ];
  const m = computeMetrics(trace);
  assert.equal(m.maxHeight, 5);
  assert.equal(m.range, 10);
  assert.ok(Math.abs(m.maxSpeed - Math.hypot(1, 2) * 3) < 1e-9);
  assert.equal(m.finalSpeed, 0);
  assert.equal(m.settleTime, 1); // at rest from t=1000 ms
  assert.ok(m.pathLength > 10);
  assert.deepEqual(computeMetrics([]), { maxHeight: 0, range: 0, maxSpeed: 0, finalSpeed: 0, pathLength: 0, settleTime: 0 });
});
test("sweep: a body that never rests settles at the full duration; brief stillness doesn't count", () => {
  const moving = [{ t: 0, x: 0, y: 0, vx: 1, vy: 0 }, { t: 800, x: 10, y: 0, vx: 1, vy: 0 }];
  assert.equal(computeMetrics(moving).settleTime, 0.8);
  const blip = [{ t: 0, x: 0, y: 0, vx: 1, vy: 0 }, { t: 200, x: 1, y: 0, vx: 0, vy: 0 }, { t: 400, x: 2, y: 0, vx: 1, vy: 0 }, { t: 600, x: 3, y: 0, vx: 1, vy: 0 }];
  assert.equal(computeMetrics(blip).settleTime, 0.6);
});
test("sweep: csv + best row + variable table sanity", () => {
  const rows = [{ value: 1, metrics: { maxHeight: 1, range: 2, maxSpeed: 3, finalSpeed: 4, pathLength: 5, settleTime: 6 } },
                { value: 2, metrics: { maxHeight: 9, range: 8, maxSpeed: 7, finalSpeed: 6, pathLength: 5, settleTime: 4 } }];
  const csv = sweepToCsv("Gravity", rows).split("\n");
  assert.equal(csv.length, 3);
  assert.equal(csv[0].split(",").length, 1 + METRICS.length);
  assert.equal(bestRow(rows, "maxHeight", "max").value, 2);
  assert.equal(bestRow(rows, "maxHeight", "min").value, 1);
  assert.equal(bestRow([], "range"), null);
  for (const v of VARIABLES) assert.ok(v.min < v.max && getVariable(v.id));
  assert.ok(VARIABLES.find((v) => v.id === "power").appliesTo({ type: "cannon" }));
  assert.ok(!VARIABLES.find((v) => v.id === "power").appliesTo({ type: "ball" }));
});

// ---------- randomized assignments ----------
const cfg = { params: [{ id: "gravity", base: 1, pct: 10 }, { id: "massScale", base: 2, pct: 25 }] };
test("variation: same student + assignment always gives the same values", () => {
  const a = valuesFor(cfg, "asg1", "kim@school.org"), b = valuesFor(cfg, "asg1", "KIM@school.org");
  assert.deepEqual(a, b); // email case doesn't matter
});
test("variation: different students / assignments differ, but stay within ±pct", () => {
  const emails = Array.from({ length: 60 }, (_, i) => `s${i}@x.org`);
  const gs = emails.map((e) => valuesFor(cfg, "asg1", e).gravity);
  assert.ok(new Set(gs).size > 12, "should be well spread");
  for (const g of gs) assert.ok(g >= 0.9 && g <= 1.1, "gravity " + g);
  for (const e of emails) { const m = valuesFor(cfg, "asg1", e).massScale; assert.ok(m >= 1.5 && m <= 2.5); }
  assert.notDeepEqual(valuesFor(cfg, "asg1", emails[0]), valuesFor(cfg, "asg2", emails[0]));
});
test("variation: seeded generator is uniform-ish and in [0,1)", () => {
  let sum = 0; const n = 2000;
  for (let i = 0; i < n; i++) { const u = seededUnit("k" + i); assert.ok(u >= 0 && u < 1); sum += u; }
  assert.ok(Math.abs(sum / n - 0.5) < 0.03);
});
test("variation: sanitize drops junk, clamps, dedupes; empty -> null", () => {
  assert.equal(sanitizeVariation(null), null);
  assert.equal(sanitizeVariation({ params: [] }), null);
  assert.equal(sanitizeVariation({ params: [{ id: "evil", base: 1, pct: 5 }, { id: "gravity", base: "x", pct: 5 }] }), null);
  const clean = sanitizeVariation({ params: [{ id: "gravity", base: 99, pct: 500 }, { id: "gravity", base: 1, pct: 5 }, { id: "airFriction", base: 1, pct: 0 }] });
  assert.equal(clean.params.length, 2);
  assert.equal(clean.params[0].base, 3);   // clamped to var max
  assert.equal(clean.params[0].pct, 50);   // clamped to MAX_PERCENT
  assert.equal(clean.params[1].pct, 1);    // clamped to MIN_PERCENT
});
test("variation: values stay inside each variable's legal range even at the edge", () => {
  const edge = { params: VARIATION_VARS.map((v) => ({ id: v.id, base: v.max, pct: 50 })) };
  for (let i = 0; i < 50; i++) {
    const vals = valuesFor(edge, "a", "e" + i);
    for (const v of VARIATION_VARS) assert.ok(vals[v.id] >= v.min && vals[v.id] <= v.max, v.id);
  }
  assert.deepEqual(valuesFor(null, "a", "b"), {});
  const [lo, hi] = rangeOf({ id: "gravity", base: 1, pct: 10 });
  assert.ok(Math.abs(lo - 0.9) < 1e-9 && Math.abs(hi - 1.1) < 1e-9);
  assert.ok(describeValues({ gravity: 1.05 })[0].includes("Gravity"));
});
