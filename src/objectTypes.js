import { materialOf } from "./materials.js";

let nextId = 1;
export function makeId(type) {
  return `${type}_${nextId++}_${Date.now().toString(36)}`;
}

// A ball that falls within this radius of a cannon's center gets caught and
// re-fired. Shared by the physics build and the edit-mode preview circle.
export function cannonCatchRadius(spec) {
  return Math.max(spec.width, spec.height) * 0.55;
}

// A regular N-gon's vertices as {x,y} points, local/centroid-relative
// coords — same convention render.js's trianglePoints() and physics.js's
// Bodies.fromVertices calls already use for every other vertex-based
// shape in this app. The starting shape src/customItems.js's editor lets
// you drag away from regular into something irregular.
export function regularPolygon(sides, radius) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) });
  }
  return pts;
}

// Real geometry validation for Custom Physics Items (src/customItems.js) —
// extracted here (rather than left inline in the editor) so it's a plain,
// testable pure function with no DOM dependency. Checks that turning at
// every vertex goes the same rotational direction the whole way around,
// which is true for a convex polygon and false for either a concave one
// or a self-intersecting one — exactly the two failure modes
// Bodies.fromVertices (physics.js) can't safely handle without also
// depending on poly-decomp.
export function isConvexSimplePolygon(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue; // collinear — neither sign, skip
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

// Whether two segments (p1-q1) and (p2-q2) intersect — used below to
// reject a self-intersecting (bowtie) polygon while still allowing a
// concave one. The standard general-position-plus-collinear-special-case
// algorithm, not just a strict "do they properly cross" test: an earlier
// version here only checked strict opposite-side inequalities, which
// missed the degenerate cases where a vertex lands exactly ON another
// edge, or two edges briefly overlap along the same line (both real,
// reachable results of freely dragging a vertex in the editor) — those
// are just as invalid a shape as a clean crossing, and poly-decomp can't
// safely handle them either.
function orientation(p, q, r) {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(val) < 1e-9) return 0; // collinear
  return val > 0 ? 1 : 2;
}
function onSegment(p, q, r) {
  // Assumes p, q, r are already known collinear — is q within segment p-r?
  return Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 &&
         Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9;
}
function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2), o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1), o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

// A concave (but still simple, non-self-intersecting) polygon is real
// geometry Bodies.fromVertices (physics.js) CAN safely handle once
// Matter.Common.setDecomp is wired to poly-decomp (see src/customItems.js)
// — it decomposes into convex parts automatically. Self-intersection
// (a bowtie) is the one shape that's never safe: poly-decomp itself
// requires simple input, so that's still rejected here, just no longer
// convexity itself.
export function isSimplePolygon(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return false;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i) continue;
      const adjacent = j === i || (j + 1) % n === i || (i + 1) % n === j;
      if (adjacent) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  // Degenerate zero-area (every point collinear) is still not a real polygon.
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) > 1e-6;
}

// Each definition describes: palette label/icon, default spec, and which
// property-panel fields apply to it. Specs are the *authored blueprint* —
// physics bodies are (re)built from specs each time Play starts.
export const OBJECT_DEFS = {
  ball: {
    label: "Ball",
    icon: "●",
    category: "core",
    defaultSpec: () => ({ type: "ball", x: 0, y: 0, rotation: 0, radius: 26, material: "rubber", fixed: false, holeRatio: 0 }),
    fields: ["radius", "material", "fixed", "holeRatio"],
  },
  board: {
    label: "Board",
    icon: "▭",
    category: "core",
    defaultSpec: () => ({ type: "board", x: 0, y: 0, rotation: 0, width: 200, height: 30, material: "wood", fixed: true, blocksMagnetism: false }),
    fields: ["width", "height", "material", "fixed", "blocksMagnetism"],
  },
  triangle: {
    label: "Triangle",
    icon: "▲",
    category: "core",
    // Base = width, apex height = height — independent, so it can be a
    // shallow wedge or a tall spike, not just an equilateral triangle.
    defaultSpec: () => ({ type: "triangle", x: 0, y: 0, rotation: 0, width: 130, height: Math.round((130 * Math.sqrt(3)) / 2), material: "wood", fixed: true, blocksMagnetism: false }),
    fields: ["width", "height", "material", "fixed", "blocksMagnetism"],
  },
  ballBearing: {
    label: "Ball Bearing",
    icon: "◎",
    category: "core",
    defaultSpec: () => ({ type: "ballBearing", x: 0, y: 0, rotation: 0, radius: 9, material: "metal", fixed: true }),
    // "Fixed" only matters when this bearing ISN'T pivoting anything (see
    // physics.js's pivotBearingIds) — sitting inside a board/triangle/ball/
    // bomb always overrides it static so the hinge works. Standalone, it
    // behaves like any other dynamic metal ball unless left Fixed.
    fields: ["fixed"],
  },
  peg: {
    label: "Peg",
    icon: "◉",
    category: "core",
    // A small fixed bouncer/obstacle — unlike a Ball Bearing it never pivots
    // anything, it's just something for balls to ricochet off of.
    defaultSpec: () => ({ type: "peg", x: 0, y: 0, rotation: 0, radius: 14, material: "rubber" }),
    fields: ["radius", "material"],
  },
  fan: {
    label: "Fan",
    icon: "🌀",
    category: "core",
    // Blows a constant wind force out of its front face (local +x, same
    // convention as the cannon muzzle) over `range` world units, tapering
    // to zero at the edge of that range.
    defaultSpec: () => ({ type: "fan", x: 0, y: 0, rotation: -90, width: 50, height: 60, material: "metal", power: 18, range: 400, fixed: true }),
    fields: ["width", "height", "power", "range", "material", "fixed"],
  },
  cannon: {
    label: "Cannon",
    icon: "🡖",
    category: "core",
    defaultSpec: () => ({
      type: "cannon", x: 0, y: 0, rotation: 0,
      width: 90, height: 34, material: "metal", fixed: true,
      startRotation: -90, launchRotation: -45, power: 22,
    }),
    fields: ["startRotation", "launchRotation", "power"],
  },
  springPad: {
    label: "Spring Pad",
    icon: "⏫",
    category: "core",
    // A static platform that gives anything touching it a one-shot launch
    // along its own "up" (away from its face) at Power, on top of whatever
    // its material's normal restitution already does.
    defaultSpec: () => ({ type: "springPad", x: 0, y: 0, rotation: 0, width: 100, height: 20, material: "rubber", power: 30 }),
    fields: ["width", "height", "power", "material"],
  },
  bomb: {
    label: "Bomb",
    icon: "💣",
    category: "core",
    defaultSpec: () => ({ type: "bomb", x: 0, y: 0, rotation: 0, radius: 18, material: "metal", fixed: false, power: 26, radiusOfEffect: 260 }),
    fields: ["power", "radiusOfEffect", "fixed"],
  },
  button: {
    label: "Button",
    icon: "⏺",
    category: "core",
    defaultSpec: () => ({ type: "button", x: 0, y: 0, rotation: 0, width: 40, height: 14, material: "wood", fixed: true, targetId: null }),
    fields: ["targetId"],
  },
  magnet: {
    label: "Magnet",
    icon: "🧲",
    category: "core",
    // Continuous radial force on metal objects within range: positive power
    // attracts, negative repels.
    defaultSpec: () => ({ type: "magnet", x: 0, y: 0, rotation: 0, radius: 20, material: "metal", power: 20, range: 350, fixed: true }),
    // Fixed by default (a wall-mounted magnet), but can be unfixed so it
    // gets pulled toward fixed metal instead — see physics.js's _applyMagnets.
    fields: ["power", "range", "fixed"],
  },
  portal: {
    label: "Portal",
    icon: "🌀",
    category: "core",
    // Always built/edited in linked pairs — entering either one teleports
    // you out the other, exit velocity rotated to match the *exit*
    // portal's own facing (rotation), so the direction you come out
    // depends on how that portal is oriented, not just how fast you went in.
    // Material stays fixed at "metal" (never user-facing — see fields
    // below) purely to avoid "glass," since a portal's own rendering is
    // entirely custom CSS, not material-driven, but its material still
    // feeds physics.js's material-based rules — "glass" would make it
    // breakable, which a portal should never be.
    defaultSpec: () => ({ type: "portal", x: 0, y: 0, rotation: 0, radius: 26, material: "metal", linkedId: null }),
    fields: ["linkedId"],
  },
  rope: {
    label: "Rope",
    icon: "🪢",
    category: "core",
    // (x,y) and (x2,y2) are its two ends — each one draggable independently
    // in the editor (they render like small ball bearings) — and it
    // stretches between wherever you leave them. Each end auto-pivots onto
    // whatever's there (like a ball bearing does), or hangs/swings free if
    // nothing's there.
    defaultSpec: () => ({ type: "rope", x: 0, y: 0, x2: 0, y2: 240, thickness: 10, elasticity: 0.15, material: "rubber", attachStartId: null, attachEndId: null }),
    fields: ["thickness", "elasticity", "material", "attachStartId", "attachEndId"],
  },
  wire: {
    label: "Wire",
    icon: "🧵",
    category: "core",
    // Same two-independent-endpoint model as rope/track — drag either end
    // onto a Button and a Bomb (or Cannon) to trigger it, same as setting
    // the button's "Triggers" dropdown, just done physically. Rendered as
    // a tricolor braided cord and never solid — nothing can collide with
    // it, so it's safe to route across/through anything else in the scene.
    defaultSpec: () => ({ type: "wire", x: 0, y: 0, x2: 150, y2: 0, material: "metal" }),
    fields: [],
  },
  lens: {
    label: "Lens",
    icon: "🔍",
    category: "core",
    // A glass lens for Light Mode: bends light rays passing through it.
    // curvature > 0 is convex (converging), < 0 is concave (diverging).
    defaultSpec: () => ({ type: "lens", x: 0, y: 0, rotation: 0, width: 80, height: 140, curvature: 0.6, material: "glass" }),
    fields: ["width", "height", "curvature"],
  },
  lightSource: {
    label: "Light Source",
    icon: "🔦",
    category: "core",
    // Emits parallel light rays in Light Mode, in the direction it's
    // rotated. Only visible/active while Light Mode is on.
    defaultSpec: () => ({ type: "lightSource", x: 0, y: 0, rotation: 0, beamWidth: 120, rayCount: 9, material: "metal", radius: 15 }),
    fields: ["beamWidth", "rayCount"],
  },
  // Kinetic Plus's Custom Physics Items — a user-authored convex polygon
  // (see src/customItems.js for the shape editor). `vertices` are LOCAL
  // coordinates (relative to the object's own x,y, unrotated) so the same
  // saved shape can be placed and rotated independently of how it was
  // drawn — physics.js's _createBody passes these straight to Matter's
  // Bodies.fromVertices, so the collision shape is exactly the visible
  // shape, never a circle/rectangle standing in for it.
  customPolygon: {
    label: "Custom Item",
    icon: "⬠",
    category: "custom",
    defaultSpec: () => ({ type: "customPolygon", x: 0, y: 0, rotation: 0, vertices: regularPolygon(6, 40), material: "wood", fixed: false, color: null, customItemName: "Custom Item" }),
    fields: ["material", "fixed"],
  },
  mirror: {
    label: "Mirror",
    icon: "🪞",
    category: "core",
    // A flat reflector: in Light Mode any ray that hits its face bounces
    // off (real angle-of-incidence = angle-of-reflection), same as a lens
    // bends light but without changing medium. Also a solid physics
    // obstacle the rest of the time, like a thin board.
    defaultSpec: () => ({ type: "mirror", x: 0, y: 0, rotation: 0, width: 120, height: 10, material: "metal", fixed: true }),
    fields: ["width", "material", "fixed"],
  },
};

export function createSpec(type) {
  const def = OBJECT_DEFS[type];
  const spec = def.defaultSpec();
  spec.id = makeId(type);
  return spec;
}

export function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec));
}

export function colorForSpec(spec) {
  return materialOf(spec.material).color;
}
