// Streaks + concept-of-the-day logic. Pure and DOM-free (unit-tested).
// Dates are "YYYY-MM-DD" keys in the user's LOCAL calendar. Day arithmetic goes
// through Date.UTC on the y/m/d parts, so DST changes (23/25-hour days) and
// time zones can never make two calendar days look like 0 or 2 days apart.

export const MAX_FREEZES = 2;
export const FREEZE_EVERY = 7;
const KEEP_DAYS = 60;

const pad = (n) => String(n).padStart(2, "0");

/** Local calendar key for a Date (or pass-through for a valid key). */
export function toDateKey(d) {
  if (typeof d === "string") return isKey(d) ? d : null;
  if (!(d instanceof Date) || isNaN(d)) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function isKey(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
/** Whole-day index (days since 1970-01-01) of a date key. */
export function dayNumber(key) {
  const k = toDateKey(key);
  if (!k) return NaN;
  const [y, m, d] = k.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
/** Days from a to b (positive when b is later). */
export function dayDiff(a, b) { return dayNumber(b) - dayNumber(a); }
export function addDays(key, n) {
  const t = new Date((dayNumber(key) + n) * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function emptyState() {
  return { current: 0, best: 0, total: 0, last: null, freezes: 0, days: [], covered: [], milestone: 0 };
}

/** Coerce anything (corrupt storage, old versions) into a valid state. */
export function normalizeState(s) {
  const e = emptyState();
  if (!s || typeof s !== "object") return e;
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const keys = (a) => (Array.isArray(a) ? a.filter(isKey) : []);
  const out = {
    current: n(s.current), best: n(s.best), total: n(s.total),
    last: isKey(s.last) ? s.last : null,
    freezes: Math.min(MAX_FREEZES, n(s.freezes)),
    days: keys(s.days).slice(-KEEP_DAYS), covered: keys(s.covered).slice(-KEEP_DAYS),
    milestone: n(s.milestone),
  };
  if (!out.last) { out.current = 0; }
  out.best = Math.max(out.best, out.current);
  return out;
}

/**
 * Record a visit on `today` (Date or key). Returns a NEW state.
 *  - same day: unchanged. Earlier than last visit (clock went backwards): unchanged.
 *  - next day: streak +1. Exactly one missed day: a freeze (if any) is spent
 *    and the streak continues. Anything longer: streak restarts at 1.
 *  - every 7th streak day earns a freeze (max 2).
 */
export function recordVisit(state, today) {
  const s = normalizeState(state);
  const key = toDateKey(today);
  if (!key) return s;
  if (!s.last) {
    return { ...s, current: 1, best: Math.max(1, s.best), total: s.total + 1, last: key, days: [key], covered: [] };
  }
  const gap = dayDiff(s.last, key);
  if (gap <= 0) return s;
  let current, freezes = s.freezes;
  const covered = s.covered.slice();
  if (gap === 1) current = s.current + 1;
  else if (gap === 2 && freezes > 0) {
    freezes -= 1; current = s.current + 1;
    covered.push(addDays(s.last, 1));
  } else current = 1;
  if (current > s.current && current % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
  return {
    current, best: Math.max(s.best, current), total: s.total + 1, last: key, freezes,
    days: [...s.days, key].slice(-KEEP_DAYS), covered: covered.slice(-KEEP_DAYS), milestone: s.milestone,
  };
}

/** Streak as it should DISPLAY on `today` (a lapsed streak shows 0 unless a freeze would cover it). */
export function displayStreak(state, today) {
  const s = normalizeState(state);
  const key = toDateKey(today);
  if (!s.last || !key) return 0;
  const gap = dayDiff(s.last, key);
  if (gap <= 1) return s.current;
  if (gap === 2 && s.freezes > 0) return s.current;
  return 0;
}

const MILESTONES = {
  3: "3 days in a row. A habit is starting to form!",
  7: "A whole week! You earned a streak freeze to protect a missed day.",
  30: "30 days. A month of daily curiosity, well done!",
  100: "100 days! You are a certified Kinetic regular.",
};
/** Friendly message when the streak has just reached a milestone we haven't announced. */
export function milestoneMessage(state) {
  const s = normalizeState(state);
  const msg = MILESTONES[s.current];
  return msg && s.milestone < s.current ? msg : null;
}
export function markMilestoneShown(state) {
  const s = normalizeState(state);
  return { ...s, milestone: Math.max(s.milestone, s.current) };
}

/** Last 7 calendar days ending today: [{key, visited, covered, today}]. */
export function weekView(state, today) {
  const s = normalizeState(state);
  const key = toDateKey(today);
  if (!key) return [];
  const seen = new Set(s.days), cov = new Set(s.covered);
  return Array.from({ length: 7 }, (_, i) => {
    const k = addDays(key, i - 6);
    return { key: k, visited: seen.has(k), covered: cov.has(k), today: i === 6 };
  });
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function cyclePerm(n, cycle) {
  const rnd = mulberry32(0x9e3779b1 ^ (cycle * 2654435761));
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}
/** Index into the list for a date: a fresh shuffle per full cycle, so no repeats until exhausted. */
export function conceptIndexForDate(date, n) {
  const day = dayNumber(date);
  if (!n || !Number.isFinite(day)) return -1;
  const cycle = Math.floor(day / n), pos = ((day % n) + n) % n;
  const perm = cyclePerm(n, cycle);
  if (n > 2) {
    // Avoid the same concept on both sides of a cycle boundary.
    const prevLast = cyclePerm(n, cycle - 1)[n - 1];
    if (perm[0] === prevLast) [perm[0], perm[1]] = [perm[1], perm[0]];
  }
  return perm[pos];
}
export function conceptForDate(date, concepts) {
  const i = conceptIndexForDate(date, concepts ? concepts.length : 0);
  return i < 0 ? null : concepts[i];
}
