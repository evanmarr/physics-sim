const KEY = "contraption-save-v1";

export function saveState(state) {
  try {
    const payload = {
      objects: state.objects,
      completedChallenges: [...state.completedChallenges],
      // World settings travel with the world: gravity, air, the friction preset and the speed slider
      gravity: state.gravity, airFriction: state.airFriction, frictionScale: state.frictionScale, simSpeed: state.simSpeed,
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("save failed", e);
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
    const out = {
      objects: data.objects || [],
      completedChallenges: new Set(data.completedChallenges || []),
    };
    const env = { gravity: num(data.gravity, -2, 3), airFriction: num(data.airFriction, 0, 10), frictionScale: num(data.frictionScale, 0, 3), simSpeed: num(data.simSpeed, 0.1, 3) };
    for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
    return out;
  } catch (e) {
    console.warn("load failed", e);
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}
