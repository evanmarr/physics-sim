// Real-world environment presets for the Physics sandbox. Each preset sets
// the environment knobs the sandbox already has (gravity, air) plus a global friction multiplier, from published constants.
//
// How the real numbers map onto the sim: the sandbox's 1.0x gravity IS
// "Earth". Every other world is scaled by the true ratio g_world / g_earth
// (so Mars is exactly 3.71 / 9.80665 = 0.378x). Air is scaled the same way
// by real atmospheric density relative to Earth sea level. The sandbox has
// no buoyancy, wind-chill or temperature model — each preset lists what it
// does NOT capture, so nothing here claims more than the sim really does.
export const STANDARD_GRAVITY = 9.80665; // m/s², CGPM standard value
export const EARTH_AIR_DENSITY = 1.225; // kg/m³, ISA sea level, 15 °C

// The toolbar's own slider limits (index.html). Values beyond them are
// clamped, and the preset says so.
export const LIMITS = { gravity: [-2, 3], air: [0, 10] };

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 3) => Number(v.toFixed(d));

function make(def) {
  const gravityRatio = def.g / STANDARD_GRAVITY;
  const airRatio = def.airDensity / EARTH_AIR_DENSITY;
  return {
    ...def,
    // What the sim is actually set to (already inside the slider limits).
    settings: {
      gravity: round(clamp(gravityRatio, LIMITS.gravity), 3),
      airFriction: round(clamp(airRatio, LIMITS.air), 3),
      frictionScale: def.frictionScale ?? 1,
    },
    clamped: {
      gravity: gravityRatio !== clamp(gravityRatio, LIMITS.gravity),
      air: airRatio !== clamp(airRatio, LIMITS.air),
    },
    gravityRatio: round(gravityRatio, 4),
    airRatio: round(airRatio, 4),
  };
}

export const PRESETS = [
  make({
    id: "earth", label: "Earth", g: 9.80665, airDensity: 1.225,
    facts: ["g = 9.80665 m/s² (standard gravity)", "Air density 1.225 kg/m³ (sea level, 15 °C)"],
    assumptions: ["This is the sandbox's default, so 1.0x on every slider."],
    source: "CGPM 1901 standard gravity; ISA standard atmosphere",
  }),
  make({
    id: "moon", label: "Moon", g: 1.62, airDensity: 0,
    facts: ["g = 1.62 m/s² (mean surface)", "No appreciable atmosphere (~10⁻¹⁵ of Earth's)"],
    assumptions: ["Air is set to exactly 0: falling objects feel no drag, so a feather and a hammer land together."],
    source: "NASA Moon Fact Sheet",
  }),
  make({
    id: "mars", label: "Mars", g: 3.71, airDensity: 0.020,
    facts: ["g = 3.71 m/s² (equatorial)", "Surface air density ≈ 0.020 kg/m³ (~6 mbar CO₂)"],
    assumptions: ["Air drag is scaled by density only; Mars's colder, CO₂ air differs slightly in viscosity, which the sim doesn't model."],
    source: "NASA Mars Fact Sheet",
  }),
  make({
    id: "jupiter", label: "Jupiter (cloud tops)", g: 24.79, airDensity: 0.16,
    facts: ["g = 24.79 m/s² at the 1-bar level", "Air density ≈ 0.16 kg/m³ at 1 bar"],
    assumptions: ["Jupiter has no solid surface — the 'ground' here is an imagined platform at the 1-bar pressure level.", "Gravity is 2.53x Earth's, inside the slider's 3x limit."],
    source: "NASA Jupiter Fact Sheet",
  }),
  make({
    id: "titan", label: "Titan", g: 1.352, airDensity: 5.3,
    facts: ["g = 1.352 m/s²", "Surface air density ≈ 5.3 kg/m³ (1.45 bar, N₂, 94 K)"],
    assumptions: ["A thick, cold nitrogen atmosphere: about 4.3x Earth's air drag."],
    source: "NASA Saturn Satellite Fact Sheet; Huygens probe results",
  }),
  make({
    id: "vacuum", label: "Vacuum (Earth gravity)", g: 9.80665, airDensity: 0,
    facts: ["g = 9.80665 m/s²", "Air density 0"],
    assumptions: ["Ideal vacuum chamber: gravity is Earth's, and drag is removed entirely."],
    source: "Definition (ideal vacuum)",
  }),
  make({
    id: "space", label: "Deep space (zero-g)", g: 0, airDensity: 0,
    facts: ["g ≈ 0 (far from any large mass)", "Air density 0"],
    assumptions: ["Free-fall / far from any body: nothing falls, and nothing slows down on its own."],
    source: "Definition (no gravitational field)",
  }),
  make({
    id: "underwater", label: "Underwater", g: 9.80665, airDensity: 997,
    facts: ["g = 9.80665 m/s²", "Fresh-water density ≈ 997 kg/m³ (~814x air)"],
    assumptions: [
      "Drag is clamped to the slider's 10x limit; real water drag on a ball is hundreds of times air's.",
      "The sim has NO buoyancy: a light object still sinks instead of floating.",
    ],
    source: "CRC Handbook (water at 25 °C)",
  }),
  make({
    id: "ice", label: "Low friction (ice)", g: 9.80665, airDensity: 1.225,
    frictionScale: 0.1,
    facts: ["Kinetic friction of ice on ice / steel on ice ≈ 0.03", "Earth gravity and air"],
    assumptions: [
      "Every object's friction is scaled by 0.1, an approximation of ice-like surfaces (real ice-on-ice ≈ 0.03), not a per-material measurement.",
    ],
    source: "Engineering Toolbox friction coefficients; Persson (2000)",
  }),
];

export function getPreset(id) { return PRESETS.find((p) => p.id === id) || null; }

// True when the given live settings still match a preset (used to show
// "Custom" in the picker once the user moves a slider by hand).
export function matchPreset(settings) {
  const eq = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.05;
  return PRESETS.find((p) =>
    eq(p.settings.gravity, settings.gravity) &&
    eq(p.settings.airFriction, settings.airFriction) &&
    eq(p.settings.frictionScale, settings.frictionScale ?? 1)
  ) || null;
}

// A modelInfo.js config so the preset's constants and caveats open in the
// same "How This Model Works" panel the rest of the app uses.
export function presetInfo(preset) {
  return {
    title: `${preset.label} preset`,
    concept: "Sets gravity, air drag and friction from published real-world values, using ratios to Earth.",
    equation: "gravity multiplier = g_world / 9.80665     air multiplier = ρ_air,world / 1.225",
    variables: [
      { symbol: "g_world", meaning: "surface gravitational acceleration", unit: "m/s²" },
      { symbol: "ρ_air", meaning: "atmospheric density", unit: "kg/m³" },
    ],
    constants: [
      { name: "Gravity multiplier", value: String(preset.settings.gravity), unit: "x" },
      { name: "Air multiplier", value: String(preset.settings.airFriction), unit: "x" },
      { name: "Friction scale", value: String(preset.settings.frictionScale), unit: "x" },
    ],
    assumptions: [
      ...preset.facts,
      ...preset.assumptions,
      ...(preset.clamped.gravity ? ["Gravity was clamped to the slider limit."] : []),
      ...(preset.clamped.air ? ["Air drag was clamped to the slider limit."] : []),
    ],
    limitations: ["The sandbox has no buoyancy, temperature or humidity model.", "Distances/time stay in sandbox units; only the ratios to Earth are real."],
    sources: [preset.source],
  };
}
