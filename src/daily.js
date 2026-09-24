// Daily streak + Concept of the Day card (DOM part). Logic lives in dailyLogic.js,
// content in dailyConcepts.js, animations in dailyAnim.js.
import { CONCEPTS } from "./dailyConcepts.js";
import { animMeta, createPlayer } from "./dailyAnim.js";
import {
  addDays, conceptForDate, displayStreak, markMilestoneShown, milestoneMessage, normalizeState,
  recordVisit, toDateKey, weekView, MAX_FREEZES,
} from "./dailyLogic.js";

const KEY = "kinetic-daily-v1";
let openMode = () => {};
let memoryState = null; // fallback when localStorage is unavailable
let state = null;

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return normalizeState(JSON.parse(raw)); } catch { /* unavailable or corrupt */ }
  return memoryState ? normalizeState(memoryState) : normalizeState(null);
}
function save(s) {
  memoryState = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}
const today = () => toDateKey(new Date());

/**
 * Call once at startup. Records today's visit and returns
 * { current, best, freezes, milestone } where `milestone` is a friendly message
 * (3/7/30/100 days) the first time it is reached, otherwise null.
 */
export function initDaily({ onOpenMode } = {}) {
  if (typeof onOpenMode === "function") openMode = onOpenMode;
  state = recordVisit(load(), today());
  const milestone = milestoneMessage(state);
  if (milestone) state = markMilestoneShown(state);
  save(state);
  return { current: state.current, best: state.best, freezes: state.freezes, milestone };
}

/** Small summary for a nav/menu badge. Safe to call any time. */
export function getStreakSummary() {
  const s = state || load();
  return { current: displayStreak(s, today()), best: s.best, total: s.total, freezes: s.freezes, last: s.last };
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const FLAME = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M12 2c1 3.5-1.5 5-3 7.5C7.500 12 8 14 9 15c-2-.3-3-2-3-4-2 2-3 4-3 6.500C3 21 7 23 12 23s9-2 9-6.500c0-4-3-6-4-9-1 1-1.500 2-2 2.500C15 7 14 4 12 2z"/></svg>';
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function dayLetter(key) { const [y, m, d] = key.split("-").map(Number); return DAY_LETTERS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; }

/** Draw the card into `container` (replacing its contents). Safe to call repeatedly. */
export function renderDailyCard(container) {
  if (!container) return;
  if (!state) state = load();
  if (container._dailyPlayer) { container._dailyPlayer.destroy(); container._dailyPlayer = null; }
  container.textContent = "";
  const now = today(), s = state, streak = displayStreak(s, now);
  const card = el("section", "daily-card"); card.setAttribute("aria-label", "Daily streak and concept of the day");

  // ---- streak header ----
  const head = el("div", "daily-streak");
  const flame = el("div", "daily-flame" + (streak > 0 ? " on" : "")); flame.innerHTML = FLAME;
  const big = el("div", "daily-streak-main");
  big.append(el("div", "daily-streak-num", String(streak)), el("div", "daily-streak-label", streak === 1 ? "day streak" : "day streak"));
  const stats = el("div", "daily-stats");
  stats.append(el("span", "daily-stat", `Best ${s.best}`), el("span", "daily-stat", `${s.total} total`), el("span", "daily-stat daily-freeze", `Freezes ${s.freezes}/${MAX_FREEZES}`));
  stats.lastChild.title = "A freeze automatically covers one missed day. Earn one every 7-day streak.";
  head.append(flame, big, stats);

  // ---- 7-day calendar ----
  const cal = el("div", "daily-week"); cal.setAttribute("role", "list");
  for (const d of weekView(s, now)) {
    const cell = el("div", "daily-day" + (d.visited ? " on" : d.covered ? " frozen" : "") + (d.today ? " today" : "")); cell.setAttribute("role", "listitem");
    cell.setAttribute("aria-label", `${d.key}${d.visited ? ", visited" : d.covered ? ", covered by a freeze" : ", no visit"}${d.today ? ", today" : ""}`);
    cell.append(el("span", "daily-day-l", dayLetter(d.key)), el("i", "daily-day-dot"));
    cal.append(cell);
  }

  // ---- concept ----
  const body = el("div", "daily-concept");
  card.append(head, cal, body);
  container.append(card);

  const todays = conceptForDate(now, CONCEPTS);
  function showConcept(concept, isToday) {
    if (container._dailyPlayer) { container._dailyPlayer.destroy(); container._dailyPlayer = null; }
    body.textContent = "";
    if (!concept) return;
    const meta = animMeta(concept.anim);
    const top = el("div", "daily-concept-head");
    top.append(el("span", "daily-chip", concept.subject), el("span", "daily-kicker", isToday ? "Concept of the day" : "Earlier concept"));
    const title = el("h3", "daily-title", concept.title);
    const stage = el("div", "daily-stage");
    const canvas = el("canvas", "daily-canvas"); canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `${meta.title}: ${meta.captions.join(" ")}`);
    const play = el("button", "daily-play", "Pause"); play.type = "button";
    const cap = el("div", "daily-animtitle", meta.title);
    stage.append(canvas);
    const steps = el("ol", "daily-steps"), lis = meta.captions.map((t, i) => {
      const li = el("li", "daily-step"); const b = el("button", "daily-step-btn", t); b.type = "button";
      b.addEventListener("click", () => { player.pause(); player.seekStep(i); lis.forEach((x, j) => x.classList.toggle("active", j === i)); });
      li.append(b); steps.append(li); return li;
    });
    const controls = el("div", "daily-controls"); controls.append(cap, play);
    const blurb = el("p", "daily-blurb", concept.blurb);
    const why = el("p", "daily-why"); why.append(el("strong", null, "Why it matters: "), document.createTextNode(concept.whyItMatters));
    const tryBtn = el("button", "daily-try", concept.tryIt.label); tryBtn.type = "button";
    tryBtn.addEventListener("click", () => openMode(concept.tryIt.mode));
    body.append(top, title, stage, controls, steps, blurb, why, tryBtn);
    const setLabel = (playing) => { play.textContent = playing ? "Pause" : "Play"; play.setAttribute("aria-pressed", String(!playing)); };
    const player = createPlayer(canvas, concept.anim, {
      onStep: (i) => lis.forEach((x, j) => x.classList.toggle("active", j === i)),
      onState: setLabel,
    });
    container._dailyPlayer = player; setLabel(player.isPlaying());
    play.addEventListener("click", () => player.toggle());
    if (!isToday && todays) {
      const back = el("button", "daily-back", "Back to today's concept"); back.type = "button";
      back.addEventListener("click", () => showConcept(todays, true)); body.append(back);
    }
  }
  showConcept(todays, true);

  // ---- previous concepts (last 5 days) ----
  const prev = el("div", "daily-prev");
  prev.append(el("h4", "daily-prev-h", "Previous concepts"));
  const list = el("ul", "daily-prev-list");
  const seen = new Set(todays ? [todays.id] : []);
  for (let i = 1; i <= 5; i++) {
    const c = conceptForDate(addDays(now, -i), CONCEPTS);
    if (!c || seen.has(c.id)) continue; seen.add(c.id);
    const li = el("li"), b = el("button", "daily-prev-btn"); b.type = "button";
    b.append(el("span", "daily-prev-t", c.title), el("span", "daily-prev-s", c.subject));
    b.addEventListener("click", () => { showConcept(c, false); body.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
    li.append(b); list.append(li);
  }
  prev.append(list); card.append(prev);
}
