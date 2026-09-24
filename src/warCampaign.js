// War campaign: a pure, DOM-free state machine that sits on top of the War
// battle engine. The campaign owns the strategic layer (regions, roster, gold,
// turns, enemy counter-attacks); battles themselves are played by src/war.js
// and their outcome is fed back through applyBattle().
//
// Everything here works on a plain JSON-able state object so it can be saved
// to localStorage and unit-tested under node.

export const CAMPAIGN_KEY = "kinetic-war-campaign-v1";
export const MAX_ROSTER = 7;
export const MIN_RECRUIT = 10;
export const MAX_RECRUIT = 300;
const COST = { inf: 1, arc: 1.4, cav: 2.6 }; // must match war.js COST
const DIFF_IDS = ["easy", "normal", "hard"];
const FORT_COST = 60;
const MAX_FORT = 2;
const MAX_LOG = 40;

// ---------- static data ----------
export const TERRAINS = {
  plains: { name: "Plains", map: "open", bonus: 0, income: 50, fill: "#cfdca6", note: "Open ground: fast movement and nowhere to hide. Cavalry shines here." },
  forest: { name: "Forest", map: "forest", bonus: 0.1, income: 35, fill: "#93b57e", note: "Trees slow columns and hide defenders, and cavalry cannot charge through them." },
  hills: { name: "Hills", map: "open", bonus: 0.18, income: 30, fill: "#d8c48f", note: "Higher ground: defenders see farther and attackers arrive tired, so attackers need better numbers." },
  river: { name: "River", map: "river", bonus: 0.12, income: 45, fill: "#aacfdc", note: "Rivers funnel armies toward fords and bridges, so a small force can hold a crossing." },
  ruins: { name: "Ruins", map: "ruins", bonus: 0.1, income: 25, fill: "#c9bcac", note: "Broken walls give cover and break up formations. Fights get messy." },
};

// Region centres on a 100 x 60 map; edges are roads between neighbours.
export const LAYOUT = {
  pos: [
    [8, 30], [22, 14], [24, 32], [22, 48], [40, 22], [42, 42], [58, 12], [60, 34], [76, 20], [86, 40],
  ],
  edges: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 4], [2, 3], [2, 4], [2, 5], [3, 5], [4, 6], [4, 7], [5, 7], [6, 7], [6, 8], [7, 8], [7, 9], [8, 9]],
  playerCapital: 0,
  enemyCapital: 9,
};

export const SCENARIOS = [
  {
    id: "marches", name: "The Border Marches", level: "Easy", seed: 11,
    blurb: "A gentle start. Terrain decides a lot: forests slow movement, and defenders on hills or behind walls can beat a larger attacker.",
    lesson: "Terrain multiplies force. Attacking uphill or through woods costs the attacker speed and cohesion, which is why commanders usually chose where to fight.",
    gold: 300, garrison: 190, scale: 0.22, aggr: 0.5, maxAttacks: 1, diff: 0, rosterScale: 1.15,
    names: ["Homeland", "Northmere", "Ashford", "Southreach", "Greywood", "Fenwick", "Highcrest", "Stonebridge", "Ravenmoor", "Ironhold"],
    terrain: ["plains", "plains", "forest", "plains", "hills", "forest", "river", "hills", "plains", "ruins"],
  },
  {
    id: "rivers", name: "The River Kingdoms", level: "Medium", seed: 23,
    blurb: "Rivers cut the land into chokepoints. Armies need food and ammunition, so the farther you push from home, the thinner your supply gets.",
    lesson: "Supply lines win campaigns. A tired, hungry army far from its base fights worse, and rivers turn a few fords into the whole battlefield.",
    gold: 250, garrison: 240, scale: 0.28, aggr: 0.7, maxAttacks: 2, diff: 1, rosterScale: 1,
    names: ["Riverhome", "Eastwater", "Millford", "Saltmarsh", "Twin Fords", "Cranemere", "Highbank", "Reedholm", "Longbridge", "Castle Delta"],
    terrain: ["plains", "river", "plains", "forest", "river", "plains", "hills", "river", "forest", "river"],
  },
  {
    id: "frontier", name: "The Iron Frontier", level: "Hard", seed: 37,
    blurb: "A hard-fought border of hills and ruined forts. The enemy is well supplied, counter-attacks often, and its garrisons dig in.",
    lesson: "Combined arms and fortifications: infantry hold the line, archers wear the enemy down, cavalry finish a broken flank. Strong defences can stall a much bigger force.",
    gold: 200, garrison: 290, scale: 0.3, aggr: 0.95, maxAttacks: 2, diff: 1, rosterScale: 0.9,
    names: ["Fort Dawn", "Ashen Vale", "Barrowdown", "Cinder Pass", "Old Wall", "Gallows Hill", "Redscar", "Broken Keep", "Storm Ridge", "Iron Citadel"],
    terrain: ["hills", "ruins", "forest", "hills", "ruins", "plains", "hills", "forest", "ruins", "hills"],
  },
];

export function scenarioById(id) { return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0]; }

// ---------- helpers ----------
export function unitCost(n, arc, cav) { return n * ((1 - arc - cav) * COST.inf + arc * COST.arc + cav * COST.cav); }
function rngOf(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function neighbors(i) {
  const out = [];
  for (const [a, b] of LAYOUT.edges) { if (a === i) out.push(b); else if (b === i) out.push(a); }
  return out;
}
// steps from the player start through the whole map graph
export function baseDistances() {
  const d = LAYOUT.pos.map(() => -1); d[LAYOUT.playerCapital] = 0;
  const q = [LAYOUT.playerCapital];
  while (q.length) { const c = q.shift(); for (const n of neighbors(c)) if (d[n] < 0) { d[n] = d[c] + 1; q.push(n); } }
  return d;
}
const DIST = baseDistances();
export function tName(state, id) { return scenarioById(state.scenarioId).names[id]; }

function pushLog(state, msg) { state.log.push(`T${state.turn}: ${msg}`); if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG); }

// ---------- creation ----------
export function newCampaign(scenarioId, seed) {
  const sc = scenarioById(scenarioId);
  const rs = sc.rosterScale;
  const mk = (i, name, n, arc, cav) => ({ id: i, name, n: Math.round(n * rs), arc, cav, morale: 100 });
  const regions = LAYOUT.pos.map((_, i) => {
    const owner = i === LAYOUT.playerCapital ? 0 : 1;
    let garrison, fort = 0;
    if (owner === 0) { garrison = 80; fort = 1; }
    else {
      garrison = sc.garrison * (1 + sc.scale * (DIST[i] - 1));
      if (i === LAYOUT.enemyCapital) { garrison *= 1.35; fort = 1; }
      if (sc.terrain[i] === "hills" && sc.id === "frontier") fort = Math.max(fort, 1);
      garrison = Math.round(Math.min(1100, garrison));
    }
    return { id: i, owner, terrain: sc.terrain[i], garrison, base: garrison, fort };
  });
  return {
    v: 1, scenarioId: sc.id, seed: seed ?? sc.seed, turn: 1, gold: sc.gold, attacked: false, status: "active", endReason: "",
    roster: [mk(1, "Vanguard", 120, 0.1, 0), mk(2, "Longbows", 80, 0.7, 0), mk(3, "Riders", 70, 0, 0.8)],
    nextId: 4, regions, battles: 0, log: [`T1: The campaign begins at ${sc.names[0]}.`],
    lastReport: [],
    stats: { battles: 0, won: 0, lost: 0, troopsLost: 0, enemyKilled: 0, captured: 0, lostRegions: 0, goldSpent: 0, defended: 0 },
  };
}

// ---------- queries ----------
export function rosterTotal(state) { return state.roster.reduce((s, a) => s + a.n, 0); }
export function rosterStrength(state) { return state.roster.reduce((s, a) => s + a.n * (0.5 + a.morale / 200), 0); }
export function playerRegions(state) { return state.regions.filter((r) => r.owner === 0); }
export function income(state) {
  let g = 40;
  for (const r of state.regions) if (r.owner === 0) g += TERRAINS[r.terrain].income + (r.id === LAYOUT.playerCapital ? 30 : 0);
  return g;
}
export function levyPerTurn(state) { return 4 * Math.max(0, playerRegions(state).length - 1); }
export function attackableRegions(state) {
  const out = [];
  for (const r of state.regions) if (r.owner === 1 && neighbors(r.id).some((n) => state.regions[n].owner === 0)) out.push(r.id);
  return out;
}
// steps from the capital to region rid travelling through player-held land
export function supplyDistance(state, rid) {
  const d = new Map([[LAYOUT.playerCapital, 0]]); const q = [LAYOUT.playerCapital];
  while (q.length) {
    const c = q.shift();
    for (const n of neighbors(c)) {
      if (d.has(n)) continue;
      if (state.regions[n].owner === 0) { d.set(n, d.get(c) + 1); q.push(n); }
    }
  }
  let best = Infinity;
  for (const n of neighbors(rid)) if (d.has(n)) best = Math.min(best, d.get(n) + 1);
  return best;
}
export function regionDifficulty(state, rid) {
  const sc = scenarioById(state.scenarioId);
  const idx = clamp(sc.diff + (DIST[rid] >= 3 || rid === LAYOUT.enemyCapital ? 1 : 0), 0, 2);
  return DIFF_IDS[idx];
}
export function defenderPoints(state, rid) {
  const r = state.regions[rid];
  return Math.round(r.garrison * (1 + TERRAINS[r.terrain].bonus + 0.12 * r.fort));
}
export function moralePenalty(state, rid) { return Math.max(0, 4 * (supplyDistance(state, rid) - 1)); }

// Everything the battle engine needs to play region rid.
export function battleSetup(state, rid) {
  const r = state.regions[rid];
  const pen = moralePenalty(state, rid);
  return {
    regionId: rid, map: TERRAINS[r.terrain].map, difficulty: regionDifficulty(state, rid),
    seed: (scenarioById(state.scenarioId).seed * 7919 + rid * 131 + state.stats.battles * 17) | 0,
    enemyBudget: defenderPoints(state, rid), morale: pen,
    armies: state.roster.map((a) => ({ id: a.id, name: a.name, n: a.n, arc: a.arc, cav: a.cav, morale: clamp(a.morale - pen, 25, 100) })),
    startTotal: rosterTotal(state),
  };
}

export function canAttack(state, rid) {
  if (state.status !== "active") return { ok: false, reason: "The campaign is over." };
  if (state.attacked) return { ok: false, reason: "You already attacked this turn." };
  const r = state.regions[rid];
  if (!r || r.owner !== 1) return { ok: false, reason: "Not an enemy region." };
  if (!attackableRegions(state).includes(rid)) return { ok: false, reason: "No border with your land." };
  if (rosterTotal(state) < 1) return { ok: false, reason: "You have no troops." };
  return { ok: true, reason: "" };
}

// ---------- battle result ----------
// res: { won, survivors, startTotal, enemyFrac }
export function applyBattle(state, rid, res) {
  const r = state.regions[rid];
  const start = res.startTotal || rosterTotal(state);
  const surv = clamp(res.survivors, 0, start);
  const ratio = start > 0 ? surv / start : 0;
  const lost = Math.round(start - surv);
  const pts = defenderPoints(state, rid);
  const enemyFrac = clamp(res.enemyFrac ?? (res.won ? 0 : 0.7), 0, 1);
  state.attacked = true;
  const st = state.stats;
  st.battles++; st.troopsLost += lost; st.enemyKilled += Math.round(pts * (1 - enemyFrac));
  for (const a of state.roster) {
    a.n = Math.round(a.n * ratio);
    a.morale = clamp(a.morale - (res.won ? 8 : 25), 30, 100);
  }
  state.roster = state.roster.filter((a) => a.n >= 5);
  const nm = tName(state, rid);
  if (res.won) {
    st.won++; st.captured++;
    r.owner = 0; r.garrison = 30; r.base = 30; r.fort = 0;
    pushLog(state, `Captured ${nm}. Lost ${lost} troops.`);
    if (rid === LAYOUT.enemyCapital) { state.status = "won"; state.endReason = `${nm} has fallen. The enemy capital is yours.`; }
  } else {
    st.lost++;
    r.garrison = Math.max(30, Math.round(r.garrison * Math.max(0.4, enemyFrac)));
    pushLog(state, `Attack on ${nm} failed. Lost ${lost} troops.`);
  }
  checkEnd(state);
  return state;
}

export function checkEnd(state) {
  if (state.status !== "active") return state;
  if (state.regions[LAYOUT.playerCapital].owner !== 0) { state.status = "lost"; state.endReason = `${tName(state, LAYOUT.playerCapital)} has fallen. Your capital is lost.`; }
  else if (rosterTotal(state) < 1 && state.gold < unitCost(MIN_RECRUIT * 2, 0, 0)) { state.status = "lost"; state.endReason = "Your army is gone and you cannot afford to raise another."; }
  return state;
}

// ---------- spending ----------
export function recruitCost(n, arcPct, cavPct) {
  const arc = clamp(arcPct / 100, 0, 1), cav = clamp(cavPct / 100, 0, 1 - arc);
  return Math.round(unitCost(n, arc, cav));
}
// armyId null => raise a new army; otherwise reinforce an existing one.
export function recruit(state, { armyId = null, n, arcPct, cavPct }) {
  if (state.status !== "active") return { ok: false, reason: "The campaign is over." };
  n = Math.round(n);
  if (!(n >= MIN_RECRUIT && n <= MAX_RECRUIT)) return { ok: false, reason: `Recruit ${MIN_RECRUIT}-${MAX_RECRUIT} troops at a time.` };
  const arc = clamp(arcPct / 100, 0, 1), cav = clamp(cavPct / 100, 0, 1 - arc);
  const cost = Math.round(unitCost(n, arc, cav));
  if (cost > state.gold) return { ok: false, reason: "Not enough gold." };
  if (armyId == null) {
    if (state.roster.length >= MAX_ROSTER) return { ok: false, reason: `Roster is full (${MAX_ROSTER} armies). Reinforce one instead.` };
    state.roster.push({ id: state.nextId, name: `Company ${state.nextId}`, n, arc, cav, morale: 85 });
    state.nextId++;
  } else {
    const a = state.roster.find((x) => x.id === armyId);
    if (!a) return { ok: false, reason: "No such army." };
    const tot = a.n + n;
    a.arc = (a.arc * a.n + arc * n) / tot; a.cav = (a.cav * a.n + cav * n) / tot;
    a.morale = Math.round((a.morale * a.n + 85 * n) / tot);
    a.n = tot;
  }
  state.gold -= cost; state.stats.goldSpent += cost;
  return { ok: true, cost };
}
export function fortifyCost(state, rid) { return FORT_COST * (state.regions[rid].fort + 1); }
export function fortify(state, rid) {
  const r = state.regions[rid];
  if (state.status !== "active" || !r || r.owner !== 0) return { ok: false, reason: "You can only fortify your own regions." };
  if (r.fort >= MAX_FORT) return { ok: false, reason: "Already fully fortified." };
  const cost = fortifyCost(state, rid);
  if (cost > state.gold) return { ok: false, reason: "Not enough gold." };
  state.gold -= cost; state.stats.goldSpent += cost; r.fort++; r.garrison += 20;
  return { ok: true, cost };
}

// ---------- enemy phase ----------
export function defenseOf(state, rid) {
  const r = state.regions[rid];
  return (r.garrison + rosterStrength(state) * 0.5) * (1 + TERRAINS[r.terrain].bonus + 0.3 * r.fort);
}
function attackPower(state, eid) {
  return state.regions[eid].garrison * 0.5 * scenarioById(state.scenarioId).aggr;
}
// What the player should brace for: for each enemy region bordering you, its
// best target and the odds it would use (shown in the UI).
export function threats(state) {
  const out = [];
  for (const e of state.regions) {
    if (e.owner !== 1) continue;
    let best = null;
    for (const n of neighbors(e.id)) {
      if (state.regions[n].owner !== 0) continue;
      const def = defenseOf(state, n);
      if (!best || def < best.def) best = { from: e.id, to: n, def: Math.round(def) };
    }
    if (!best) continue;
    best.atk = Math.round(attackPower(state, e.id));
    best.ratio = best.atk / Math.max(1, best.def);
    out.push(best);
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

export function endTurn(state) {
  if (state.status !== "active") return state;
  const sc = scenarioById(state.scenarioId);
  const rng = rngOf(state.seed * 31 + state.turn * 1013 + state.stats.battles * 7);
  const ev = [];
  // economy
  const inc = income(state); state.gold += inc; ev.push(`Collected ${inc} gold.`);
  const levy = levyPerTurn(state);
  if (levy > 0) {
    if (!state.roster.length) { state.roster.push({ id: state.nextId, name: `Company ${state.nextId}`, n: levy, arc: 0, cav: 0, morale: 70 }); state.nextId++; }
    else { const w = state.roster.reduce((m, a) => (a.n < m.n ? a : m)); w.n += levy; }
    ev.push(`Levies added ${levy} troops.`);
  }
  for (const a of state.roster) a.morale = clamp(a.morale + 12, 0, 100);
  // enemy garrisons recover a little
  for (const r of state.regions) if (r.owner === 1 && r.garrison < r.base * 1.1) r.garrison = Math.round(Math.min(r.base * 1.1, r.garrison + r.base * 0.06));
  // player militia grows
  for (const r of state.regions) if (r.owner === 0 && r.id !== LAYOUT.playerCapital) r.garrison = Math.min(60 + 25 * r.fort, r.garrison + 4);
  // counter-attacks
  const cands = threats(state).filter((t) => t.ratio > 0.55 && rng() < 0.4 + sc.aggr * 0.6);
  const usedFrom = new Set(), usedTo = new Set(); const attacks = [];
  for (const t of cands) {
    if (attacks.length >= sc.maxAttacks) break;
    if (usedFrom.has(t.from) || usedTo.has(t.to)) continue;
    usedFrom.add(t.from); usedTo.add(t.to);
    const eff = t.atk * (0.8 + 0.4 * rng());
    const tgt = state.regions[t.to], src = state.regions[t.from];
    const fell = eff > t.def;
    const att = { from: t.from, to: t.to, atk: Math.round(eff), def: t.def, fell };
    src.garrison = Math.max(30, Math.round(src.garrison * 0.85));
    if (fell) {
      tgt.owner = 1; tgt.garrison = Math.max(30, Math.round(eff - t.def) + 40); tgt.base = tgt.garrison; tgt.fort = 0;
      state.stats.lostRegions++;
      ev.push(`${tName(state, t.from)} attacked ${tName(state, t.to)} (${att.atk} vs ${att.def}) and took it.`);
    } else {
      tgt.garrison = Math.max(10, Math.round(tgt.garrison - eff * 0.3));
      src.garrison = Math.max(30, Math.round(src.garrison - t.def * 0.2));
      state.stats.defended++;
      ev.push(`${tName(state, t.from)} attacked ${tName(state, t.to)} (${att.atk} vs ${att.def}) and was repelled.`);
    }
    attacks.push(att);
  }
  if (!attacks.length) ev.push("The enemy held back this turn.");
  state.turn++; state.attacked = false;
  state.lastReport = ev; state.lastAttacks = attacks;
  for (const e of ev) pushLog(state, e);
  checkEnd(state);
  return state;
}

// ---------- persistence ----------
export function saveCampaign(state, storage) {
  try { storage.setItem(CAMPAIGN_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function loadCampaign(storage) {
  try {
    const raw = storage.getItem(CAMPAIGN_KEY); if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.v !== 1 || !Array.isArray(s.regions) || s.regions.length !== LAYOUT.pos.length || !Array.isArray(s.roster) || !s.stats) return null;
    if (!SCENARIOS.some((x) => x.id === s.scenarioId)) return null;
    s.log = Array.isArray(s.log) ? s.log : []; s.lastReport = Array.isArray(s.lastReport) ? s.lastReport : [];
    return s;
  } catch { return null; }
}
export function clearCampaign(storage) { try { storage.removeItem(CAMPAIGN_KEY); } catch { /* ignore */ } }

export function summary(state) {
  const s = state.stats, sc = scenarioById(state.scenarioId);
  return {
    won: state.status === "won", scenario: sc.name, turns: state.turn, battles: s.battles, battlesWon: s.won,
    troopsLost: s.troopsLost, enemyKilled: s.enemyKilled, captured: s.captured, lostRegions: s.lostRegions,
    defended: s.defended, goldSpent: s.goldSpent, regionsHeld: playerRegions(state).length, lesson: sc.lesson,
  };
}
