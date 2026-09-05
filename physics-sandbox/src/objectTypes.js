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
    defaultSpec: () => ({ type: "board", x: 0, y: 0, rotation: 0, width: 200, height: 30, material: "wood", fixed: true }),
    fields: ["width", "height", "material", "fixed"],
  },
  triangle: {
    label: "Triangle",
    icon: "▲",
    category: "core",
    // Always equilateral (all three sides equal length `size`) — simpler to
    // reason about than independent width/height for a ramp/wedge shape.
    defaultSpec: () => ({ type: "triangle", x: 0, y: 0, rotation: 0, size: 130, material: "wood", fixed: true }),
    fields: ["size", "material", "fixed"],
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
  track: {
    label: "Track",
    icon: "🛤️",
    category: "core",
    // Looks like a taut string with a ball bearing resting at its
    // midpoint — press Play and the bearing shuttles back and forth along
    // it at Speed, either forever (Cycles = 0) or stopping after that many
    // round trips. Two independent draggable ends, same model as rope.
    defaultSpec: () => ({ type: "track", x: 0, y: 0, x2: 0, y2: 200, speed: 200, cycles: 0, material: "metal" }),
    fields: ["speed", "cycles", "material"],
  },
  motor: {
    label: "Motor",
    icon: "🌀",
    category: "core",
    // Spins continuously at a fixed RPM the instant you press Play — a
    // scripted rotation (like the cannon barrel's procedural angle), not
    // something driven by torque/forces.
    defaultSpec: () => ({ type: "motor", x: 0, y: 0, rotation: 0, radius: 24, material: "metal", rpm: 60 }),
    fields: ["radius", "rpm", "material"],
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
