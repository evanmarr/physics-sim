// Shared 7-tier difficulty ladder used by every module's challenge set
// (Physics: src/challenges.js, Rocket Simulator: src/rocketSim.js, Sound:
// src/soundChallenges.js, and whichever modules pick this up next). Every
// module's list is expected to have EXACTLY one challenge per tier, in this
// order — difficulty climbs through tighter constraints, more required
// precision, genuine optimization, prediction, and multi-variable
// reasoning, not just "bigger numbers."
export const DIFFICULTY_TIERS = ["Simple", "Easy", "Medium", "Hard", "Challenging", "Extreme", "Impossible"];

export function difficultyBadgeHtml(tier) {
  return `<span class="difficulty-badge" data-tier="${tier}">${tier}</span>`;
}

// Dev-time sanity check, not shown to players — logs (doesn't throw, so a
// content bug never breaks the app) if a module's list is missing a tier,
// has an unrecognized one, or duplicates one.
export function assertFullLadder(list, moduleName) {
  const tiers = list.map((c) => c.difficulty);
  const seen = new Set(tiers);
  const missing = DIFFICULTY_TIERS.filter((t) => !seen.has(t));
  const unexpected = tiers.filter((t) => !DIFFICULTY_TIERS.includes(t));
  const duplicates = tiers.filter((t, i) => tiers.indexOf(t) !== i);
  if (missing.length || unexpected.length || duplicates.length) {
    console.error(`[challenges] ${moduleName} ladder is incomplete/invalid`, { missing, unexpected, duplicates, count: list.length });
  }
}
