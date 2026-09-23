// Pure math behind the Physics measurement tools (ruler, protractor,
// stopwatch, velocity / force vectors, trajectory tracking). No DOM here so
// it can be unit-tested; src/measureTools.js draws it.
import { GRID_SIZE } from "./world.js";

// Matter reports velocity in px per 1/60 s step, and the sandbox draws one
// grid square (20 px) as 1 m — so a speed of 1 px/step is 60/20 = 3 m/s.
// These are the SAME sandbox units the grid badge and unit toggle use, not
// a calibrated real-world scale (see the tool footnote in the UI).
export const STEPS_PER_SECOND = 60;
export const MPS_PER_PX_STEP = STEPS_PER_SECOND / GRID_SIZE;

export function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
export function pxToMeters(px) { return px / GRID_SIZE; }
export function velocityToMps(v) { return v * MPS_PER_PX_STEP; }

// Interior angle at `vertex` between the rays to `a` and `b`, in degrees
// (0–180). Returns NaN if either arm has zero length.
export function angleAt(vertex, a, b) {
  const ax = a.x - vertex.x, ay = a.y - vertex.y;
  const bx = b.x - vertex.x, by = b.y - vertex.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (!la || !lb) return NaN;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return Math.acos(cos) * 180 / Math.PI;
}

// Angle of the a→b line above the horizontal, in degrees, using the usual
// maths convention (screen y points down, so it's flipped). Range (-180, 180].
export function elevationDeg(a, b) {
  return Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI;
}

// Sandbox "mass": density × area × 0.001, the exact figure the property
// panel's m = ρ·A line shows.
export function simMass(density, area) { return density * area * 1e-3; }

// Net force from F = m·a, with a estimated from the velocity change over a
// short window (≥ minWindowMs) so per-frame jitter doesn't flicker the arrow.
export class ForceEstimator {
  constructor(minWindowMs = 90) {
    this.minWindowMs = minWindowMs;
    this.samples = [];
  }
  push(tMs, vx, vy) {
    const last = this.samples[this.samples.length - 1];
    if (last && tMs < last.t) this.samples.length = 0; // sim was reset
    this.samples.push({ t: tMs, vx, vy });
    while (this.samples.length > 2 && tMs - this.samples[1].t >= this.minWindowMs) this.samples.shift();
  }
  // → { ax, ay } in m/s² (y down, screen coordinates) or null until enough data
  acceleration() {
    if (this.samples.length < 2) return null;
    const a = this.samples[0], b = this.samples[this.samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return null;
    return { ax: velocityToMps(b.vx - a.vx) / dt, ay: velocityToMps(b.vy - a.vy) / dt };
  }
  force(mass) {
    const a = this.acceleration();
    return a ? { fx: mass * a.ax, fy: mass * a.ay } : null;
  }
  clear() { this.samples.length = 0; }
}

// A stopwatch driven by simulation time (not wall-clock), so it respects
// Pause and the speed slider. Times are in milliseconds.
export class Stopwatch {
  constructor() { this.reset(); }
  reset() { this.running = false; this.acc = 0; this.startedAt = 0; this.laps = []; }
  start(simNow) { if (!this.running) { this.running = true; this.startedAt = simNow; } }
  stop(simNow) { if (this.running) { this.acc += simNow - this.startedAt; this.running = false; } }
  elapsed(simNow) { return this.acc + (this.running ? Math.max(0, simNow - this.startedAt) : 0); }
  lap(simNow) { const t = this.elapsed(simNow); this.laps.push(t); return t; }
}

export function formatSeconds(ms) { return (ms / 1000).toFixed(2) + " s"; }

// Records where each tracked object has been. Points are thinned by a
// minimum spacing so a long run stays cheap to draw, and capped in length.
export class TrajectoryRecorder {
  constructor(minGapPx = 4, maxPoints = 4000) {
    this.minGapPx = minGapPx; this.maxPoints = maxPoints; this.tracks = new Map();
  }
  push(id, t, x, y) {
    let track = this.tracks.get(id);
    if (!track) { track = []; this.tracks.set(id, track); }
    const last = track[track.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < this.minGapPx) return false;
    track.push({ t, x, y });
    if (track.length > this.maxPoints) track.shift();
    return true;
  }
  get(id) { return this.tracks.get(id) || []; }
  clear(id) { if (id == null) this.tracks.clear(); else this.tracks.delete(id); }
  // Total path length in metres, and straight-line displacement.
  summary(id) {
    const track = this.get(id);
    let path = 0;
    for (let i = 1; i < track.length; i++) path += Math.hypot(track[i].x - track[i - 1].x, track[i].y - track[i - 1].y);
    const disp = track.length > 1 ? distance(track[0], track[track.length - 1]) : 0;
    return { pathMeters: pxToMeters(path), displacementMeters: pxToMeters(disp), points: track.length };
  }
}
