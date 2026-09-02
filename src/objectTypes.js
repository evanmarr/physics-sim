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
  bomb: {
    label: "Bomb",
    icon: "💣",
    category: "shop",
    price: 40,
    defaultSpec: () => ({ type: "bomb", x: 0, y: 0, rotation: 0, radius: 18, material: "metal", fixed: false, power: 26, radiusOfEffect: 260 }),
    fields: ["power", "radiusOfEffect", "fixed"],
  },
  button: {
    label: "Button",
    icon: "⏺",
    category: "shop",
    price: 25,
    defaultSpec: () => ({ type: "button", x: 0, y: 0, rotation: 0, width: 40, height: 14, material: "wood", fixed: true, targetId: null }),
    fields: ["targetId"],
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
