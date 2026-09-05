// A small 2D ray tracer for "Light Mode": traces straight light rays from
// each Light Source through the scene, refracting through glass/water
// shapes (real Snell's law, entry + exit) and through Lens objects (a thin-
// lens approximation — bend once at the lens's center line — the standard
// simplification used by most teaching-oriented optics simulators).
import { materialOf } from "./materials.js";

const AIR_N = 1.0;
const MAX_BOUNCES = 6;
const MAX_SEGMENT = 3000;
const EPS = 0.01;

function vec(x, y) { return { x, y }; }
function sub(a, b) { return vec(a.x - b.x, a.y - b.y); }
function add(a, b) { return vec(a.x + b.x, a.y + b.y); }
function scale(a, s) { return vec(a.x * s, a.y * s); }
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function len(a) { return Math.sqrt(dot(a, a)); }
function norm(a) { const l = len(a) || 1; return vec(a.x / l, a.y / l); }
function rotate(a, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return vec(a.x * c - a.y * s, a.x * s + a.y * c);
}

function refractiveIndexOf(spec) {
  const mat = materialOf(spec.material);
  return mat.refractiveIndex || null;
}

// Refract direction `d` (unit, incoming) at a surface with outward normal
// `n` between media n1 -> n2. Returns { dir, tir } — tir true means total
// internal reflection occurred and `dir` is the reflected direction instead.
function refract(d, n, n1, n2) {
  let cosI = -dot(n, d);
  let normal = n;
  let ni = n1, nt = n2;
  if (cosI < 0) { normal = scale(n, -1); cosI = -cosI; ni = n2; nt = n1; }
  const eta = ni / nt;
  const sin2T = eta * eta * Math.max(0, 1 - cosI * cosI);
  if (sin2T > 1) {
    // total internal reflection
    const reflected = sub(d, scale(normal, 2 * dot(d, normal)));
    return { dir: norm(reflected), tir: true };
  }
  const cosT = Math.sqrt(1 - sin2T);
  const dir = add(scale(d, eta), scale(normal, eta * cosI - cosT));
  return { dir: norm(dir), tir: false };
}

// Ray (origin o, direction d, both world-space) vs. a circle. Returns the
// smallest t > eps, or null.
function hitCircle(o, d, center, r) {
  const oc = sub(o, center);
  const b = 2 * dot(d, oc);
  const c = dot(oc, oc) - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2, t2 = (-b + sq) / 2;
  const t = t1 > EPS ? t1 : (t2 > EPS ? t2 : null);
  if (t == null) return null;
  const point = add(o, scale(d, t));
  const normal = norm(sub(point, center));
  return { t, point, normal };
}

// Ray vs. an axis-aligned box in *local* space [-w/2,w/2] x [-h/2,h/2],
// where the ray has already been transformed into that local frame.
function hitLocalBox(o, d, w, h) {
  const hw = w / 2, hh = h / 2;
  let tmin = -Infinity, tmax = Infinity;
  let normal = null;
  for (const axis of ["x", "y"]) {
    const lo = -(axis === "x" ? hw : hh), hi = (axis === "x" ? hw : hh);
    const dv = d[axis], ov = o[axis];
    if (Math.abs(dv) < 1e-9) {
      if (ov < lo || ov > hi) return null;
      continue;
    }
    let t1 = (lo - ov) / dv, t2 = (hi - ov) / dv;
    let n1 = axis === "x" ? vec(-1, 0) : vec(0, -1);
    let n2 = axis === "x" ? vec(1, 0) : vec(0, 1);
    if (t1 > t2) { [t1, t2] = [t2, t1]; [n1, n2] = [n2, n1]; }
    if (t1 > tmin) { tmin = t1; normal = n1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  const t = tmin > EPS ? tmin : (tmax > EPS ? tmax : null);
  if (t == null) return null;
  // recompute which face we exited through if we used tmax
  return { t, normalLocal: normal || vec(-Math.sign(d.x) || 1, 0) };
}

function hitBox(o, d, spec) {
  const angle = (spec.rotation || 0) * Math.PI / 180;
  const local = rotate(sub(o, vec(spec.x, spec.y)), -angle);
  const dLocal = rotate(d, -angle);
  const hit = hitLocalBox(local, dLocal, spec.width, spec.height);
  if (!hit) return null;
  const point = add(o, scale(d, hit.t));
  const normal = rotate(hit.normalLocal, angle);
  return { t: hit.t, point, normal: norm(normal) };
}

function shapeHit(o, d, spec) {
  if (spec.type === "ball" || spec.type === "bomb" || spec.type === "peg" || spec.type === "ballBearing" || spec.type === "magnet") {
    return hitCircle(o, d, vec(spec.x, spec.y), spec.radius);
  }
  if (spec.type === "board" || spec.type === "button" || spec.type === "springPad") {
    return hitBox(o, d, spec);
  }
  return null;
}

// A ray bounced off a mirror's flat face: standard angle-of-incidence =
// angle-of-reflection, same hit-testing as any other rectangle but the ray
// continues instead of refracting or stopping.
function reflectOffMirror(d, normal) {
  return norm(sub(d, scale(normal, 2 * dot(d, normal))));
}

// A ray bent by a thin lens: bends once at the lens's own vertical
// (rotated) center line, toward the focal point on the far side for a
// converging (curvature > 0) lens, or as if diverging from a focal point
// on the near side for a diverging (curvature < 0) one.
function bendThroughLens(o, d, lens) {
  const angle = (lens.rotation || 0) * Math.PI / 180;
  const local = rotate(sub(o, vec(lens.x, lens.y)), -angle);
  const dLocal = rotate(d, -angle);
  if (Math.abs(dLocal.x) < 1e-9) return null;
  const t = -local.x / dLocal.x;
  if (t <= EPS) return null;
  const hitLocal = add(local, scale(dLocal, t));
  if (Math.abs(hitLocal.y) > lens.height / 2) return null; // missed the aperture

  const focalLength = Math.max(30, 260 - Math.abs(lens.curvature) * 220);
  let newDirLocal;
  if (lens.curvature >= 0) {
    // converging: bend toward the focal point straight ahead
    const focus = vec(dLocal.x > 0 ? focalLength : -focalLength, 0);
    newDirLocal = norm(sub(focus, hitLocal));
  } else {
    // diverging: bend as if radiating from a focal point behind the source
    const focus = vec(dLocal.x > 0 ? -focalLength : focalLength, 0);
    newDirLocal = norm(sub(hitLocal, focus));
  }
  const point = add(o, scale(d, t));
  const newDir = norm(rotate(newDirLocal, angle));
  return { t, point, dir: newDir };
}

// Trace every light source's rays through the given specs (edit-mode
// blueprint or live play-mode render items — either works, both just need
// x/y/rotation/width/height/radius/material). Returns an array of
// polylines: [{x,y}, {x,y}, ...] per ray.
export function traceLightRays(specs, worldBounds) {
  const sources = specs.filter((s) => s.type === "lightSource");
  const obstacles = specs.filter((s) => s.type !== "lightSource" && s.type !== "lens" && s.type !== "mirror");
  const lenses = specs.filter((s) => s.type === "lens");
  const mirrors = specs.filter((s) => s.type === "mirror");
  const rays = [];

  for (const src of sources) {
    const angle = (src.rotation || 0) * Math.PI / 180;
    const dir0 = vec(Math.cos(angle), Math.sin(angle));
    const perp = vec(-dir0.y, dir0.x);
    const n = Math.max(1, src.rayCount || 9);
    for (let i = 0; i < n; i++) {
      const offset = n === 1 ? 0 : (i / (n - 1) - 0.5) * src.beamWidth;
      const origin = add(vec(src.x, src.y), scale(perp, offset));
      rays.push(traceOneRay(origin, dir0, obstacles, lenses, mirrors, worldBounds));
    }
  }
  return rays;
}

function traceOneRay(origin, dir, obstacles, lenses, mirrors, bounds) {
  const points = [origin];
  let o = origin, d = dir, medium = AIR_N;
  let insideId = null; // spec id of the shape we're currently inside, if any

  for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    let nearest = null, nearestSpec = null, nearestIsLens = false, nearestIsMirror = false, nearestOpaque = false;

    for (const spec of obstacles) {
      const n2 = refractiveIndexOf(spec);
      const hit = shapeHit(o, d, spec);
      if (hit && (!nearest || hit.t < nearest.t)) { nearest = hit; nearestSpec = spec; nearestIsLens = false; nearestIsMirror = false; nearestOpaque = !n2; }
    }
    for (const lens of lenses) {
      const hit = bendThroughLens(o, d, lens);
      if (hit && (!nearest || hit.t < nearest.t)) { nearest = hit; nearestSpec = lens; nearestIsLens = true; nearestIsMirror = false; nearestOpaque = false; }
    }
    for (const mirror of mirrors) {
      const hit = hitBox(o, d, mirror);
      if (hit && (!nearest || hit.t < nearest.t)) { nearest = hit; nearestSpec = mirror; nearestIsLens = false; nearestIsMirror = true; nearestOpaque = false; }
    }

    // clip against world bounds too, so a ray that hits nothing terminates
    const boundsHit = hitLocalBox(o, d, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const boundsT = boundsHit ? boundsHit.t : MAX_SEGMENT;

    if (!nearest || nearest.t > boundsT) {
      points.push(add(o, scale(d, Math.min(boundsT, MAX_SEGMENT))));
      break;
    }

    points.push(nearest.point);

    if (nearestOpaque) break; // opaque surface absorbs the ray — it stops here, casting a shadow

    if (nearestIsLens) {
      o = nearest.point;
      d = nearest.dir;
      continue;
    }

    if (nearestIsMirror) {
      d = reflectOffMirror(d, nearest.normal);
      o = add(nearest.point, scale(d, EPS * 4));
      continue;
    }

    const n2 = refractiveIndexOf(nearestSpec);
    const enteringNow = insideId !== nearestSpec.id;
    const { dir: newDir, tir } = refract(d, nearest.normal, medium, enteringNow ? n2 : AIR_N);
    d = newDir;
    o = add(nearest.point, scale(d, EPS * 4));
    if (!tir) {
      medium = enteringNow ? n2 : AIR_N;
      insideId = enteringNow ? nearestSpec.id : null;
    }
  }

  return points;
}
