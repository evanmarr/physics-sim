// A small app-wide setting for which unit system the property panel (and
// the grid-scale badge) displays distances and weights in. The simulation
// itself never changes — this only changes what numbers a human reads and
// types; see numberField/sliderField's unitScale param in panel.js for how
// a raw pixel/density value gets converted to/from the displayed number.
import { GRID_SIZE } from "./world.js";

const STORAGE_KEY = "continuum-unit-system";
const M_PER_FT = 0.3048;
const KG_PER_LB = 0.45359237;

export function getUnitSystem() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "imperial" ? "imperial" : "metric";
}

export function setUnitSystem(system) {
  localStorage.setItem(STORAGE_KEY, system === "imperial" ? "imperial" : "metric");
}

export function toggleUnitSystem() {
  const next = getUnitSystem() === "metric" ? "imperial" : "metric";
  setUnitSystem(next);
  return next;
}

// Raw pixels per 1 displayed distance unit — pass straight into
// numberField/sliderField's unitScale.
export function distanceUnitScale() {
  return getUnitSystem() === "imperial" ? GRID_SIZE * M_PER_FT : GRID_SIZE;
}

export function distanceUnitSuffix() {
  return getUnitSystem() === "imperial" ? "ft" : "m";
}

// Raw "kg-scale" density/weight numbers per 1 displayed weight unit.
export function weightUnitScale() {
  return getUnitSystem() === "imperial" ? KG_PER_LB : 1;
}

export function weightUnitSuffix() {
  return getUnitSystem() === "imperial" ? "lb" : "kg";
}

// For the grid-scale badge: how many displayed distance units one grid
// square actually spans (exactly 1 in metric; a rounded, honest ~3.28 in
// imperial, since a grid square isn't a round number of feet).
export function gridSquareInUnits() {
  return GRID_SIZE / distanceUnitScale();
}
