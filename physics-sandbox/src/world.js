export const WORLD = {
  minX: -4000, maxX: 4000,
  minY: -2600, maxY: 2400,
  groundY: 1400,
};

export const GRID_SIZE = 50;

export function snap(v, size = GRID_SIZE) {
  return Math.round(v / size) * size;
}
