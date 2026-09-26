// War PvP: pure, DOM-free state machine for two-player hot-seat play on one
// device. The caller (WarMode) owns the game object `g`; this module only
// tracks who may act, when covers are shown and when rounds end.
//
// stage: setup | cover | deploy | orders | play | over
//   cover  = a screen that hides the map ("Pass the device to X"); `next` is
//            the stage entered when that player presses Ready.

export const ROUND_LENGTHS = [10, 15, 30];
export const BUDGETS = [500, 1000, 1500, 2000];
export const TEAM_NAMES = ["Blue", "Red"];

export function defaultConfig() {
  return { map: "open", seed: 1, fog: true, budget: 1000, roundLen: 15 };
}

export function normalizeConfig(c = {}) {
  const d = defaultConfig();
  const near = (list, v, dv) => (list.includes(+v) ? +v : dv);
  return {
    map: typeof c.map === "string" && c.map ? c.map : d.map,
    seed: Number.isFinite(+c.seed) ? Math.floor(Math.abs(+c.seed)) % 1e9 : d.seed,
    fog: c.fog === undefined ? d.fog : !!c.fog,
    budget: near(BUDGETS, c.budget, d.budget),
    roundLen: near(ROUND_LENGTHS, c.roundLen, d.roundLen),
  };
}

// Begin a match (after setup). Blue deploys first behind a cover screen.
export function startPvp(cfg, swapped = false) {
  return { cfg: normalizeConfig(cfg), stage: "cover", turn: 0, next: "deploy", round: 0, roundEnd: 0, swapped: !!swapped };
}

// Which team (0/1) the current human may command, or -1 for nobody.
export function activeTeam(st) {
  return st && (st.stage === "deploy" || st.stage === "orders") ? st.turn : -1;
}
export function canCommand(st, team) { return activeTeam(st) === team; }

// Which teams' vision the screen may show. Cover hides everything.
export function viewTeams(st, fog) {
  if (!st) return [];
  if (st.stage === "cover" || st.stage === "setup") return [];
  if (st.stage === "deploy" || st.stage === "orders") return [st.turn];
  return fog ? [0, 1] : [0, 1]; // play/over: union of both sides (all, if fog is off)
}
export function hidesMap(st) { return !!st && st.stage === "cover"; }

export function canReady(st, armyCount = 1) {
  if (!st) return false;
  if (st.stage === "deploy") return armyCount > 0;
  return st.stage === "cover" || st.stage === "orders";
}

// Player number (1/2) who commands `team` (they swap on rematch).
export function playerNumber(st, team) { return (st && st.swapped ? 1 - team : team) + 1; }
export function label(st, team) { return `${TEAM_NAMES[team]} (Player ${playerNumber(st, team)})`; }

// Press Ready. Returns "battleStart" when the caller must call startBattle(g),
// "play" when a round begins, otherwise "" (or null if not allowed).
export function ready(st, g, armyCount = 1) {
  if (!canReady(st, armyCount)) return null;
  if (st.stage === "cover") { st.stage = st.next; return ""; }
  if (st.stage === "deploy") {
    if (st.turn === 0) { st.stage = "cover"; st.turn = 1; st.next = "deploy"; return ""; }
    st.stage = "cover"; st.turn = 0; st.next = "orders"; st.round = 1; return "battleStart";
  }
  if (st.stage === "orders") {
    if (st.turn === 0) { st.stage = "cover"; st.turn = 1; st.next = "orders"; return ""; }
    st.stage = "play"; st.turn = -1; st.roundEnd = (g?.t || 0) + st.cfg.roundLen; return "play";
  }
  return null;
}

// Call every sim frame. Moves play -> next round's cover, or -> over.
export function tick(st, g) {
  if (!st || st.stage !== "play") return false;
  if (g.phase === "over") { st.stage = "over"; return true; }
  if (g.t >= st.roundEnd - 1e-9) { st.stage = "cover"; st.turn = 0; st.next = "orders"; st.round++; return true; }
  return false;
}

export function roundTimeLeft(st, g) { return st.stage === "play" ? Math.max(0, st.roundEnd - g.t) : 0; }

export function setRoundLength(st, s) { if (ROUND_LENGTHS.includes(+s)) st.cfg.roundLen = +s; }

// Same map, sides swapped. Returns a fresh state ready for a new game.
export function rematch(st) { return startPvp(st.cfg, !st.swapped); }

// Stats for the results screen.
export function summarize(g) {
  const troops = [0, 1].map((t) => g.armies.filter((a) => a.team === t).reduce((s, a) => s + a.n, 0));
  return {
    winner: g.winner ? g.winner.team : -1,
    reason: g.winReason || "",
    time: g.t,
    teams: [0, 1].map((t) => ({
      team: t, lost: g.stats.lost[t], killed: g.stats.killed[t], troops: troops[t],
      hqPct: Math.round((g.hqs[t].hp / g.hqs[t].max) * 100), points: g.points.filter((p) => p.owner === t).length,
    })),
  };
}
