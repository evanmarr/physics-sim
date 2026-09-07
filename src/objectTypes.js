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

// Each definition describes: palette label/icon, default spec, and which
// property-panel fields apply to it. Specs are the *authored blueprint* —
// physics bodies are (re)built from specs each time Play starts.
export const OBJECT_DEFS = {
  ball: {
    label: "Ball",
    icon: "●",
    category: "core",
    defaultSpec: () => ({ type: "ball", x: 0, y: 0, rotation: 0, radius: 26, material: "rubber", fixed: false }),
    fields: ["radius", "material", "fixed"],
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
    fields: [],
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
    defaultSpec: () => ({ type: "fan", x: 0, y: 0, rotation: -90, width: 50, height: 60, material: "metal", power: 18, range: 400 }),
    fields: ["width", "height", "power", "range", "material"],
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
    defaultSpec: () => ({ type: "magnet", x: 0, y: 0, rotation: 0, radius: 20, material: "metal", power: 20, range: 350 }),
    fields: ["power", "range"],
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
    defaultSpec: () => ({ type: "rope", x: 0, y: 0, x2: 0, y2: 240, thickness: 10, elasticity: 0.15, material: "wood", attachStartId: null, attachEndId: null }),
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
