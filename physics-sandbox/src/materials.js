// Material presets: real-ish relative densities (g/cm^3 scaled) and friction/restitution.
// density is used both by Matter.js (mass) and by buoyancy comparisons against water (1.0).
export const MATERIALS = {
  wood: {
    label: "Wood",
    color: "#b98452",
    strokeColor: "#8a6038",
    density: 0.6,
    friction: 0.45,
    restitution: 0.25,
    frictionAir: 0.01,
  },
  metal: {
    label: "Metal",
    color: "#9aa1ac",
    strokeColor: "#5f6672",
    density: 7.8,
    friction: 0.3,
    restitution: 0.1,
    frictionAir: 0.01,
  },
  rubber: {
    label: "Rubber",
    color: "#e2483f",
    strokeColor: "#a02b24",
    density: 1.1,
    friction: 0.95,
    restitution: 0.92,
    frictionAir: 0.01,
  },
  glass: {
    label: "Glass",
    color: "#bfe6f2",
    strokeColor: "#7fb6c9",
    density: 2.5,
    friction: 0.1,
    restitution: 0.15,
    frictionAir: 0.01,
    fillOpacity: 0.45,
    shatters: true,
    shatterImpactThreshold: 9, // relative speed (world units/step-ish) needed to shatter
    refractiveIndex: 1.5, // used by Light Mode's ray tracer
  },
  ice: {
    label: "Ice",
    color: "#d7f3fb",
    strokeColor: "#9fd6e8",
    density: 0.92,
    friction: 0.02,
    restitution: 0.05,
    frictionAir: 0.01,
    refractiveIndex: 1.31,
  },
  water: {
    label: "Water",
    color: "#3a7bd5",
    strokeColor: "#2c5ea3",
    density: 1.0,
    friction: 0,
    restitution: 0,
    frictionAir: 0.01,
    fillOpacity: 0.5,
    isFluid: true,
    refractiveIndex: 1.33,
  },
};

export const MATERIAL_LIST = Object.keys(MATERIALS);

export function materialOf(name) {
  return MATERIALS[name] || MATERIALS.wood;
}
