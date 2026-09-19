// Achievements/badges — a pure VIEW over the same state.completedChallenges
// Set every sandbox's own challenge system already writes to (see
// challenges.js, chemistryChallenges.js, historyChallenges.js,
// cyberChallenges.js, rocketSim.js). No separate storage, no server round
// trip, nothing to get out of sync: a badge is earned exactly when its
// underlying challenge ids are already in that one shared Set, recomputed
// fresh every time this panel opens or a challenge completes.
import { CHALLENGES as PHYSICS_CHALLENGES } from "./challenges.js";
import { CHEMISTRY_CHALLENGES } from "./chemistryChallenges.js";
import { HISTORY_CHALLENGES } from "./historyChallenges.js";
import { CYBER_CHALLENGES } from "./cyberChallenges.js";

// Each sandbox's challenge ids, normalized to exactly how they actually
// land in state.completedChallenges — Chemistry and Rocket Simulator
// prefix at the call site (see chemistry.js/rocketSim.js), History and
// Cybersecurity prefix at the data source already, Physics and the single
// Astronomy challenge use their raw id as-is.
//
// Rocket Simulator's own 7 challenge ids are listed directly here (not
// imported from rocketSim.js) — rocketSim.js already needs to import
// refreshAchievements() below to report completions, and importing its
// CHALLENGES array back here would make a circular import where each
// module needs the other fully loaded first. Keep this list in sync with
// the `id` field of every entry in rocketSim.js's own CHALLENGES array
// (assertFullLadder there already guarantees there are exactly 7).
const ROCKET_CHALLENGE_IDS = ["reach_10km", "apogee_window", "karman", "orbit_moon", "orbit_earth_two_stage", "escape_earth", "efficient_orbit"];

const SANDBOXES = [
  { key: "physics", label: "Physics", ids: PHYSICS_CHALLENGES.map((c) => c.id) },
  { key: "chemistry", label: "Chemistry", ids: CHEMISTRY_CHALLENGES.map((c) => "chem_" + c.id) },
  { key: "history", label: "History", ids: HISTORY_CHALLENGES.map((c) => c.id) },
  { key: "cybersecurity", label: "Cybersecurity", ids: CYBER_CHALLENGES.map((c) => c.id) },
  { key: "rocket", label: "Rocket Simulator", ids: ROCKET_CHALLENGE_IDS.map((id) => "rocket_" + id) },
  { key: "astronomy", label: "Astronomy", ids: ["astro_find_eclipse"] },
];

const ALL_IDS = SANDBOXES.flatMap((s) => s.ids);

function buildBadges(completed) {
  const badges = [];

  for (const s of SANDBOXES) {
    const done = s.ids.filter((id) => completed.has(id)).length;
    badges.push({
      id: `sandbox_${s.key}`,
      title: `${s.label}: Completionist`,
      desc: `Complete every ${s.label} challenge.`,
      earned: done === s.ids.length,
      progressText: `${done}/${s.ids.length}`,
    });
  }

  const totalDone = ALL_IDS.filter((id) => completed.has(id)).length;
  const tiers = [
    { id: "tier_first", title: "First Steps", desc: "Complete your first challenge, in any sandbox.", threshold: 1 },
    { id: "tier_bronze", title: "Bronze Explorer", desc: "Complete 5 challenges across any sandboxes.", threshold: 5 },
    { id: "tier_silver", title: "Silver Explorer", desc: "Complete 15 challenges across any sandboxes.", threshold: 15 },
    { id: "tier_gold", title: "Gold Explorer", desc: `Complete all ${ALL_IDS.length} challenges across every sandbox.`, threshold: ALL_IDS.length },
  ];
  for (const t of tiers) {
    badges.push({
      id: t.id,
      title: t.title,
      desc: t.desc,
      earned: totalDone >= t.threshold,
      progressText: `${Math.min(totalDone, t.threshold)}/${t.threshold}`,
    });
  }

  return { badges, totalDone, totalPossible: ALL_IDS.length };
}

let modal, box, btn, badgeEl, getState;

export function initAchievementsUI(state) {
  getState = () => state;
  modal = document.getElementById("achievements-modal");
  box = document.getElementById("achievements-modal-box");
  btn = document.getElementById("achievements-btn");
  badgeEl = document.getElementById("achievements-badge");

  btn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    render();
  });

  refreshBadge();
}

const completionListeners = [];

// Lets main.js (or anything else) react to "a challenge completed
// somewhere," without achievements.js needing to know anything about what
// that reaction is — see main.js's checkWeeklyCompletion, which uses this
// same event to notice when the just-completed challenge happens to be the
// current Weekly Challenge.
export function onChallengeCompleted(fn) {
  completionListeners.push(fn);
}

// Called after any challenge completes anywhere (see every sandbox's own
// completedChallenges.add(id) call site) so the topbar count stays live
// without polling — completedChallenges only ever grows during a session,
// so a cheap recompute on that one event is all this needs. `id` is the
// exact string just added to completedChallenges; omit it if there's
// nothing new to report (e.g. a plain refresh).
export function refreshAchievements(id) {
  refreshBadge();
  if (modal && !modal.classList.contains("hidden")) render();
  if (id != null) completionListeners.forEach((fn) => fn(id));
}

function refreshBadge() {
  if (!getState) return;
  const { badges } = buildBadges(getState().completedChallenges);
  const earned = badges.filter((b) => b.earned).length;
  badgeEl.textContent = String(earned);
  badgeEl.classList.toggle("hidden", earned === 0);
}

function render() {
  const { badges, totalDone, totalPossible } = buildBadges(getState().completedChallenges);
  const earnedCount = badges.filter((b) => b.earned).length;
  box.innerHTML = `
    <h2>Achievements</h2>
    <div class="achv-summary">${earnedCount}/${badges.length} badges earned · ${totalDone}/${totalPossible} challenges completed across every sandbox</div>
    <div class="achv-grid">
      ${badges.map(rowHtml).join("")}
    </div>
    <button id="achv-close">Close</button>
  `;
  box.querySelector("#achv-close").addEventListener("click", () => modal.classList.add("hidden"));
}

function rowHtml(b) {
  return `
    <div class="achv-row ${b.earned ? "achv-earned" : "achv-locked"}">
      <div class="achv-mark">${b.earned ? "✓" : "—"}</div>
      <div class="achv-body">
        <div class="achv-title">${b.title}</div>
        <div class="achv-desc">${b.desc}</div>
        <div class="achv-progress">${b.earned ? "Earned" : b.progressText}</div>
      </div>
    </div>
  `;
}
