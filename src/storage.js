const KEY = "contraption-save-v1";

export function saveState(state) {
  try {
    const payload = {
      objects: state.objects,
      completedChallenges: [...state.completedChallenges],
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
    return {
      objects: data.objects || [],
      completedChallenges: new Set(data.completedChallenges || []),
    };
  } catch (e) {
    console.warn("load failed", e);
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}
