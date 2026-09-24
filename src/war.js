// War: a real-time strategy game against a computer opponent. Armies are
// single "blobs" whose size shows troop count; they fight with a
// Lanchester-style exchange modified by composition, terrain, flanking and
// morale. The simulation core (createGame / stepGame and friends) is DOM-free
// and testable under node; WarMode is the canvas/HUD wrapper around it.

import * as CP from "./warCampaign.js";

export const WORLD_W = 1600;
export const WORLD_H = 1000;
export const CELL = 25;
export const GW = WORLD_W / CELL; // 64
export const GH = WORLD_H / CELL; // 40
export const SIM_DT = 1 / 30;

export const T_GRASS = 0, T_FOREST = 1, T_HILL = 2, T_WATER = 3, T_ROCK = 4, T_FORD = 5, T_BRIDGE = 6;
export const TEAMS = [
  { name: "Blue", color: "#3b82f6" },
  { name: "Red", color: "#ef4444" },
];
export const MAPS = [
  { id: "open", name: "Open field" },
  { id: "forest", name: "Forest pass" },
  { id: "river", name: "River crossing" },
  { id: "ruins", name: "Ruins" },
];
export const DIFFICULTIES = {
  easy: { name: "Easy", think: 2.6, aggr: 0.6, flank: 0, ambush: 0, mem: 8, pushTime: 150, budget: 0.8 },
  normal: { name: "Normal", think: 1.2, aggr: 0.85, flank: 0.5, ambush: 0.5, mem: 20, pushTime: 100, budget: 1 },
  hard: { name: "Hard", think: 0.6, aggr: 1.05, flank: 1, ambush: 1, mem: 40, pushTime: 70, budget: 1 },
};
export const START_BUDGET = 1000;
export const COST = { inf: 1, arc: 1.4, cav: 2.6 }; // points per troop
export const MAX_ARMIES = 14;
const HQ_POS = [{ x: 100, y: 500 }, { x: 1500, y: 500 }];
const HQ_R = 38;
const HQ_HP = 1400;
const REINFORCE_COST = 120;
const TIME_LIMIT = 1500;
const K_DMG = 0.04;

// ---------- utils ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const cellOf = (v) => Math.floor(v / CELL);
const ci = (cx, cy) => cy * GW + cx;

export function terrainAt(g, x, y) {
  const cx = cellOf(x), cy = cellOf(y);
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return T_ROCK;
  return g.terrain[ci(cx, cy)];
}
const isBlockedType = (t) => t === T_WATER || t === T_ROCK;
export function blockedAt(g, x, y) { return isBlockedType(terrainAt(g, x, y)); }
const TERRAIN_COST = [1, 2, 1.3, 99, 99, 1.6, 1];
const TERRAIN_SPEED = [1, 0.55, 0.8, 0, 0, 0.75, 1];

// ---------- map generation ----------
function blob(t, rng, cx, cy, r, type, overwriteBlocked = false) {
  const ph = rng() * 6.28, amp = 0.25 + rng() * 0.2;
  for (let y = Math.floor(cy - r * 1.6); y <= Math.ceil(cy + r * 1.6); y++) {
    for (let x = Math.floor(cx - r * 1.6); x <= Math.ceil(cx + r * 1.6); x++) {
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const a = Math.atan2(y - cy, x - cx);
      const rr = r * (1 + amp * Math.sin(a * 3 + ph) + amp * 0.5 * Math.sin(a * 5 + ph * 2));
      if (Math.hypot(x - cx, y - cy) <= rr) {
        if (!overwriteBlocked && isBlockedType(t[ci(x, y)])) continue;
        t[ci(x, y)] = type;
      }
    }
  }
}
function rectFill(t, x0, y0, x1, y1, type) {
  for (let y = Math.max(0, y0); y <= Math.min(GH - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(GW - 1, x1); x++) t[ci(x, y)] = type;
}

export function controlPointSpots() {
  return [
    { x: 800, y: 500 }, { x: 800, y: 170 }, { x: 800, y: 830 },
    { x: 470, y: 260 }, { x: 470, y: 740 }, { x: 1130, y: 260 }, { x: 1130, y: 740 },
  ].filter((p, i) => i !== 1 && i !== 2 || true);
}

export function generateMap(id, seed) {
  const rng = mulberry32(seed | 0);
  const R = (a, b) => a + rng() * (b - a);
  const t = new Uint8Array(GW * GH);
  if (id === "random") id = ["open", "forest", "river", "ruins"][Math.floor(rng() * 4)];
  const feats = { open: 0, forest: 0, river: 0, ruins: 0 };
  feats[id] = 1;
  if (id === "open") {
    for (let i = 0; i < 4; i++) blob(t, rng, R(14, 50), R(4, 36), R(2, 4), T_HILL);
    for (let i = 0; i < 6; i++) blob(t, rng, R(12, 52), R(3, 37), R(1.5, 3.2), T_FOREST);
    for (let i = 0; i < 7; i++) blob(t, rng, R(14, 50), R(3, 37), R(0.6, 1.4), T_ROCK);
  } else if (id === "forest") {
    for (let y = 0; y < GH; y++) {
      const x0 = 23 + Math.round(2 * Math.sin(y * 0.35 + seed));
      const w = 15 + Math.round(2 * Math.sin(y * 0.5 + seed * 2));
      rectFill(t, x0, y, x0 + w, y, T_FOREST);
    }
    const gaps = [R(5, 9), R(17, 22), R(29, 34)];
    for (const gy of gaps) rectFill(t, 20, Math.round(gy), 44, Math.round(gy) + 3, T_GRASS);
    for (let i = 0; i < 9; i++) blob(t, rng, R(25, 40), R(2, 38), R(0.5, 1.2), T_ROCK);
    for (let i = 0; i < 3; i++) blob(t, rng, R(14, 50), R(3, 37), R(2, 3), T_HILL);
  } else if (id === "river") {
    const cx = 32;
    for (let y = 0; y < GH; y++) {
      const x0 = cx + Math.round(2 * Math.sin(y * 0.28 + seed));
      rectFill(t, x0 - 1, y, x0 + 1, y, T_WATER);
    }
    const fy = [R(6, 10), R(26, 31)], by = R(16, 22);
    for (const y of fy) for (let x = 26; x <= 38; x++) for (let k = 0; k < 3; k++) if (t[ci(x, Math.round(y) + k)] === T_WATER) t[ci(x, Math.round(y) + k)] = T_FORD;
    for (let x = 26; x <= 38; x++) for (let k = 0; k < 2; k++) if (t[ci(x, Math.round(by) + k)] === T_WATER) t[ci(x, Math.round(by) + k)] = T_BRIDGE;
    for (let i = 0; i < 6; i++) blob(t, rng, R(24, 40), R(2, 38), R(1.5, 3), T_FOREST);
    for (let i = 0; i < 3; i++) blob(t, rng, R(14, 50), R(4, 36), R(2, 3.5), T_HILL);
    for (let i = 0; i < 3; i++) blob(t, rng, R(14, 50), R(3, 37), R(0.6, 1.1), T_ROCK);
  } else {
    for (let i = 0; i < 9; i++) {
      const horiz = rng() < 0.5, len = Math.round(R(5, 10));
      const x = Math.round(R(15, 46)), y = Math.round(R(3, 36));
      if (horiz) rectFill(t, x, y, x + len, y, T_ROCK); else rectFill(t, x, y, x, y + len, T_ROCK);
    }
    for (let i = 0; i < 14; i++) blob(t, rng, R(13, 51), R(2, 38), R(0.4, 0.9), T_ROCK);
    for (let i = 0; i < 4; i++) blob(t, rng, R(14, 50), R(4, 36), R(1.5, 2.5), T_FOREST);
    blob(t, rng, 32, 20, 3, T_HILL);
  }
  void feats;
  // keep bases, deployment areas and control points open
  const clear = (px, py, r) => {
    const cx = px / CELL, cy = py / CELL;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && isBlockedType(t[ci(x, y)]) && t[ci(x, y)] !== T_WATER) t[ci(x, y)] = T_GRASS;
      else if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && t[ci(x, y)] === T_WATER) t[ci(x, y)] = T_FORD;
  };
  for (const h of HQ_POS) clear(h.x, h.y, 5);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if ((x < 12 || x > 51) && isBlockedType(t[ci(x, y)])) t[ci(x, y)] = T_GRASS;
  }
  for (const p of controlPointSpots()) clear(p.x, p.y, 2.2);
  return t;
}

// ---------- pathfinding (grid A*, cached) ----------
const NAV_N = GW * GH;
const _gs = new Float32Array(NAV_N), _par = new Int32Array(NAV_N), _stamp = new Int32Array(NAV_N), _closed = new Int32Array(NAV_N);
let _sid = 0;

function buildNav(g) {
  const raw = new Uint8Array(NAV_N), dil = new Uint8Array(NAV_N);
  for (let i = 0; i < NAV_N; i++) raw[i] = isBlockedType(g.terrain[i]) ? 1 : 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = ci(x, y);
    if (raw[i]) { dil[i] = 1; continue; }
    if ((x > 0 && raw[i - 1]) || (x < GW - 1 && raw[i + 1]) || (y > 0 && raw[i - GW]) || (y < GH - 1 && raw[i + GW])) dil[i] = 1;
  }
  g.navRaw = raw; g.navDil = dil; g.pathCache = new Map();
}

function nearestFree(nav, cx, cy) {
  cx = clamp(cx, 0, GW - 1); cy = clamp(cy, 0, GH - 1);
  if (!nav[ci(cx, cy)]) return [cx, cy];
  for (let r = 1; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < GW && y < GH && !nav[ci(x, y)]) return [x, y];
    }
  }
  return null;
}

function losClear(nav, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 8);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const cx = cellOf(x0 + (x1 - x0) * t), cy = cellOf(y0 + (y1 - y0) * t);
    if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || nav[ci(cx, cy)]) return false;
  }
  return true;
}

function astar(g, nav, sx, sy, gx, gy) {
  const sid = ++_sid;
  const start = ci(sx, sy), goal = ci(gx, gy);
  const heap = [[0, start]];
  _gs[start] = 0; _stamp[start] = sid; _par[start] = -1;
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } }
    return top;
  };
  while (heap.length) {
    const [, cur] = pop();
    if (_closed[cur] === sid) continue;
    _closed[cur] = sid;
    if (cur === goal) {
      const out = [];
      for (let i = cur; i !== -1; i = _par[i]) out.push(i);
      return out.reverse();
    }
    const cx = cur % GW, cy = (cur / GW) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const ni = ci(x, y);
      if (nav[ni]) continue;
      if (dx && dy && (nav[ci(cx + dx, cy)] || nav[ci(cx, cy + dy)])) continue;
      const ng = _gs[cur] + (dx && dy ? 1.414 : 1) * TERRAIN_COST[g.terrain[ni]];
      if (_stamp[ni] !== sid || ng < _gs[ni]) {
        _stamp[ni] = sid; _gs[ni] = ng; _par[ni] = cur;
        push(ng + Math.hypot(gx - x, gy - y), ni);
      }
    }
  }
  return null;
}

// Returns waypoints (world coords) from (x0,y0) to near (x1,y1), excluding the start. [] if unreachable.
export function findPath(g, x0, y0, x1, y1) {
  if (!g.navDil) buildNav(g);
  const key = cellOf(x0) + "," + cellOf(y0) + ">" + cellOf(x1) + "," + cellOf(y1);
  const hit = g.pathCache.get(key);
  if (hit) return hit.map((p) => ({ x: p.x, y: p.y }));
  let res = null;
  for (const nav of [g.navDil, g.navRaw]) {
    const s = nearestFree(nav, cellOf(x0), cellOf(y0)), e = nearestFree(nav, cellOf(x1), cellOf(y1));
    if (!s || !e) continue;
    const cells = astar(g, nav, s[0], s[1], e[0], e[1]);
    if (!cells) continue;
    const pts = cells.map((c) => ({ x: (c % GW + 0.5) * CELL, y: (((c / GW) | 0) + 0.5) * CELL }));
    // replace final cell with the true goal when it is itself free
    const goalFree = !nav[ci(clamp(cellOf(x1), 0, GW - 1), clamp(cellOf(y1), 0, GH - 1))];
    if (goalFree) pts[pts.length - 1] = { x: clamp(x1, 1, WORLD_W - 1), y: clamp(y1, 1, WORLD_H - 1) };
    // string pulling
    const out = [];
    let ax = x0, ay = y0, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !losClear(nav, ax, ay, pts[j].x, pts[j].y)) j--;
      out.push(pts[j]); ax = pts[j].x; ay = pts[j].y; i = j + 1;
    }
    res = out; break;
  }
  if (!res) res = [];
  if (g.pathCache.size > 600) g.pathCache.clear();
  g.pathCache.set(key, res);
  return res.map((p) => ({ x: p.x, y: p.y }));
}

// ---------- game state ----------
let _uid = 1;
export function armyRadius(n) { return 9 + 1.75 * Math.sqrt(Math.max(0, n)); }
export function armyCost(n, comp) { return n * (comp.inf * COST.inf + comp.arc * COST.arc + comp.cav * COST.cav); }
export function normComp(arc, cav) {
  arc = clamp(arc, 0, 1); cav = clamp(cav, 0, 1 - arc);
  return { inf: 1 - arc - cav, arc, cav };
}
export function inZone(team, x, y) {
  return y > 50 && y < WORLD_H - 50 && (team === 0 ? x > 40 && x < 300 : x > WORLD_W - 300 && x < WORLD_W - 40);
}

export function createGame(opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const g = {
    seed, mapId: opts.map || "open", difficulty: opts.difficulty || "normal", fog: !!opts.fog,
    aiTeams: opts.aiTeams || [1],
    terrain: generateMap(opts.map || "open", seed),
    phase: "deploy", t: 0, armies: [], contacts: [], winner: null, winReason: "", speedNote: 0,
    hqs: [0, 1].map((i) => ({ team: i, x: HQ_POS[i].x, y: HQ_POS[i].y, hp: HQ_HP, max: HQ_HP })),
    points: controlPointSpots().map((p, i) => ({ x: p.x, y: p.y, owner: p.x < 700 ? 0 : p.x > 900 ? 1 : -1, prog: p.x < 700 ? -1 : p.x > 900 ? 1 : 0, id: i })),
    budget: [START_BUDGET, START_BUDGET * (DIFFICULTIES[opts.difficulty || "normal"].budget)],
    reserve: [0, 0], counters: [0, 0],
    stats: { lost: [0, 0], killed: [0, 0] },
    ai: [{ mem: {}, timer: 0, wait: 0, scout: 0, splitT: 0 }, { mem: {}, timer: 0, wait: 0, scout: 0, splitT: 0 }],
    rng: mulberry32(seed ^ 0x9e3779b9),
  };
  // point ownership: only "near" points; drop the two extremes for smaller maps
  g.points = g.points.filter((p) => p.id !== 1 && p.id !== 2);
  g.points.forEach((p, i) => (p.id = i));
  buildNav(g);
  if (opts.aiDeploy !== false) for (const tm of g.aiTeams) autoDeploy(g, tm);
  return g;
}

function nextName(g, team) {
  return (team === 0 ? "B" : "R") + ++g.counters[team];
}

export function addArmy(g, team, x, y, n, comp, opts = {}) {
  if (g.armies.filter((a) => a.team === team).length >= MAX_ARMIES) return null;
  const cost = armyCost(n, comp);
  if (opts.pay && cost > g.budget[team] + 1e-6) return null;
  if (opts.zone && !inZone(team, x, y)) return null;
  if (blockedAt(g, x, y)) return null;
  if (opts.pay) g.budget[team] -= cost;
  const a = {
    id: _uid++, name: nextName(g, team), team, x, y, n, n0: n, inf: comp.inf, arc: comp.arc, cav: comp.cav,
    morale: 100, route: [], path: [], legActive: false, stance: opts.stance || "advance", facing: team === 0 ? 0 : Math.PI,
    vx: 0, vy: 0, routed: false, engaged: false, engT: 0, chaseT: 0, dr: armyRadius(n), ph: g.rng() * 6.28, cost, aiGoal: null, role: "",
  };
  g.armies.push(a);
  return a;
}

export function removeArmyRefund(g, a) {
  const i = g.armies.indexOf(a);
  if (i < 0 || g.phase !== "deploy") return false;
  g.armies.splice(i, 1);
  g.budget[a.team] += a.cost;
  return true;
}

export function autoDeploy(g, team) {
  const P = DIFFICULTIES[g.difficulty] || DIFFICULTIES.normal;
  let budget = g.budget[team];
  const plan = [
    [150, 0.15, 0], [150, 0.1, 0], [100, 0.7, 0], [80, 0.1, 0.75], [120, 0.3, 0.2], [80, 0.1, 0.3], [100, 0.2, 0.1],
  ];
  const zx = team === 0 ? 60 : WORLD_W - 300, k = plan.length;
  for (let i = 0; i < k; i++) {
    const [n, arc, cav] = plan[i];
    const comp = normComp(arc, cav);
    const cost = armyCost(n, comp);
    if (cost > budget) continue;
    for (let tries = 0; tries < 30; tries++) {
      const x = zx + 20 + g.rng() * 200 - (team === 0 ? 0 : 0), y = 80 + ((i + 0.5) / k) * 840 + (g.rng() - 0.5) * 40;
      const a = addArmy(g, team, x, y, n, comp, { zone: true });
      if (a) { g.budget[team] = g.budget[team] - cost; budget = g.budget[team]; break; }
    }
  }
  void P;
  return budget;
}

export function startBattle(g) {
  if (g.phase !== "deploy") return;
  g.phase = "battle";
  g.reserve[0] = g.budget[0]; g.reserve[1] = g.budget[1];
  g.budget[0] = 0; g.budget[1] = 0;
}

// ---------- orders ----------
function setRoute(g, a, pts, add) {
  if (a.stance === "retreat" && !a.routed) a.stance = "advance";
  if (a.routed) return;
  if (!add) { a.route = []; a.path = []; a.legActive = false; a.chasing = false; }
  for (const p of pts) a.route.push({ x: clamp(p.x, 5, WORLD_W - 5), y: clamp(p.y, 5, WORLD_H - 5) });
  if (!add || !a.path.length) { a.path = []; a.legActive = false; }
  a.aiGoal = null;
}
export function orderMove(g, armies, pts, add = false) {
  if (!armies.length || !pts.length) return;
  for (const a of armies) a.mergeTarget = null; // a fresh order cancels any pending merge
  const dest = pts[pts.length - 1];
  const cx = armies.reduce((s, a) => s + a.x, 0) / armies.length, cy = armies.reduce((s, a) => s + a.y, 0) / armies.length;
  for (const a of armies) {
    let list = pts;
    if (armies.length > 1) {
      const ox = (a.x - cx) * 0.6, oy = (a.y - cy) * 0.6;
      const off = Math.hypot(ox, oy) > 90 ? 90 / Math.hypot(ox, oy) : 1;
      list = pts.map((p, i) => (i === pts.length - 1 ? { x: p.x + ox * off, y: p.y + oy * off } : p));
    }
    setRoute(g, a, list, add);
  }
  void dest;
}
export function setStance(g, armies, stance) {
  for (const a of armies) {
    if (a.routed) continue;
    a.stance = stance;
    if (stance === "hold") { a.route = []; a.path = []; a.legActive = false; a.chasing = false; }
    if (stance === "retreat") { a.route = []; a.path = []; a.legActive = false; a.chasing = false; }
    a.aiGoal = null;
  }
}
export function cancelOrders(g, armies) {
  for (const a of armies) { a.mergeTarget = null; a.route = []; a.path = []; a.legActive = false; a.chasing = false; a.aiGoal = null; if (a.stance === "retreat" && !a.routed) a.stance = "hold"; }
}

export function splitArmy(g, a, frac = 0.5) {
  if (a.n < 10 || g.armies.filter((x) => x.team === a.team).length >= MAX_ARMIES) return null;
  frac = clamp(frac, 0.1, 0.9);
  const nn = a.n * frac;
  const b = {
    ...a, id: _uid++, name: nextName(g, a.team), n: nn, n0: a.n0 * frac,
    route: a.route.map((p) => ({ ...p })), path: a.path.map((p) => ({ ...p })), aiGoal: null, cost: a.cost * frac, role: a.role,
  };
  a.n -= nn; a.n0 -= b.n0; a.cost -= b.cost;
  const ang = a.facing + Math.PI / 2, off = armyRadius(nn) * 0.8;
  for (const s of [1, 0.6, 0.3, -1]) {
    const nx = a.x + Math.cos(ang) * off * s * 1.4, ny = a.y + Math.sin(ang) * off * s * 1.4;
    if (!blockedAt(g, nx, ny)) { b.x = nx; b.y = ny; break; }
  }
  b.dr = armyRadius(nn) * 0.6;
  g.armies.push(b);
  return b;
}
export function mergeArmies(g, a, b) {
  if (a === b || a.team !== b.team || a.engaged || b.engaged) return false;
  const tot = a.n + b.n;
  a.inf = (a.inf * a.n + b.inf * b.n) / tot; a.arc = (a.arc * a.n + b.arc * b.n) / tot; a.cav = (a.cav * a.n + b.cav * b.n) / tot;
  a.morale = (a.morale * a.n + b.morale * b.n) / tot;
  a.x = (a.x * a.n + b.x * b.n) / tot; a.y = (a.y * a.n + b.y * b.n) / tot;
  a.n = tot; a.n0 += b.n0; a.cost += b.cost;
  if (b.routed) a.routed = a.routed && true;
  const i = g.armies.indexOf(b);
  if (i >= 0) g.armies.splice(i, 1);
  return true;
}
export function mergeOverlapping(g, list) {
  let merged = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (!g.armies.includes(a) || !g.armies.includes(b)) continue;
    if (dist(a.x, a.y, b.x, b.y) < (armyRadius(a.n) + armyRadius(b.n)) * 0.9 && mergeArmies(g, a, b)) merged++;
  }
  return merged;
}

// ---------- visibility ----------
export function visibleTo(g, team, e) {
  if (!g.fog || e.team === team) return true;
  const range = terrainAt(g, e.x, e.y) === T_FOREST ? 110 : 290;
  for (const a of g.armies) if (a.team === team && dist(a.x, a.y, e.x, e.y) < range + armyRadius(a.n) * 0.3) return true;
  const h = g.hqs[team];
  return dist(h.x, h.y, e.x, e.y) < (terrainAt(g, e.x, e.y) === T_FOREST ? 110 : 320);
}

// ---------- simulation ----------
function maxSpeed(a) { return 34 * (a.inf + a.arc * 1.05 + a.cav * 2.1); }
function defOf(a) { return a.inf + a.arc * 0.65 + a.cav * 0.85; }
function strengthOf(a) { return a.n * (0.5 + a.morale / 200); }

function nearestEnemy(g, a, maxD) {
  let best = null, bd = maxD;
  for (const e of g.armies) {
    if (e.team === a.team || !visibleTo(g, a.team, e)) continue;
    const d = dist(a.x, a.y, e.x, e.y) - armyRadius(e.n);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function tryMove(g, a, nx, ny) {
  if (!blockedAt(g, nx, ny) && nx > 2 && ny > 2 && nx < WORLD_W - 2 && ny < WORLD_H - 2) { a.x = nx; a.y = ny; return true; }
  if (!blockedAt(g, nx, a.y)) { a.x = nx; return true; }
  if (!blockedAt(g, a.x, ny)) { a.y = ny; return true; }
  return false;
}

function moveArmy(g, a, dt) {
  const hq = g.hqs[a.team];
  // stance / rout driven retreat
  if (a.routed || a.stance === "retreat") {
    if (!a.route.length && dist(a.x, a.y, hq.x, hq.y) > 70) {
      const ang = g.rng() * 6.28;
      a.route = [{ x: hq.x + Math.cos(ang) * 50, y: hq.y + Math.sin(ang) * 50 }]; a.path = []; a.legActive = false;
    } else if (!a.route.length && !a.routed) { a.stance = "hold"; }
  } else if (!a.route.length && a.stance === "advance") {
    // auto-attack: chase nearby visible enemy
    a.chaseT -= dt;
    if (a.chaseT <= 0) {
      a.chaseT = 0.8;
      const e = a.engaged ? null : nearestEnemy(g, a, 180);
      if (e) { a.path = findPath(g, a.x, a.y, e.x, e.y); a.chasing = true; }
      else if (a.chasing) { a.path = []; a.chasing = false; }
    }
  }
  if (!a.path.length && a.route.length && !a.chasing) {
    const w = a.route[0];
    if (dist(a.x, a.y, w.x, w.y) < 14) a.route.shift();
    else { a.path = findPath(g, a.x, a.y, w.x, w.y); a.legActive = true; if (!a.path.length) { a.route.shift(); a.legActive = false; } }
  }
  const tgt = a.path[0];
  let speed = maxSpeed(a) * TERRAIN_SPEED[terrainAt(g, a.x, a.y)] * (a.routed ? 1.15 : 1) * (0.7 + 0.3 * a.morale / 100);
  if (a.engaged) speed *= a.stance === "retreat" || a.routed ? 0.8 : 0.25;
  if (a.n < 1) return;
  if (tgt) {
    const d = dist(a.x, a.y, tgt.x, tgt.y);
    if (d < 6) {
      a.path.shift();
      if (!a.path.length && a.legActive) { a.route.shift(); a.legActive = false; }
      a.vx *= 0.5; a.vy *= 0.5;
    } else {
      const step = Math.min(d, speed * dt);
      const ux = (tgt.x - a.x) / d, uy = (tgt.y - a.y) / d;
      const ox = a.x, oy = a.y;
      if (!tryMove(g, a, a.x + ux * step, a.y + uy * step)) { a.path = []; a.legActive = false; if (a.route.length) a.route.unshift(a.route[0]); }
      a.vx += ((a.x - ox) / dt - a.vx) * 0.3; a.vy += ((a.y - oy) / dt - a.vy) * 0.3;
      if (!a.engaged) {
        const fa = Math.atan2(uy, ux);
        let da = fa - a.facing; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283;
        a.facing += da * Math.min(1, dt * 4);
      }
    }
  } else { a.vx *= 0.8; a.vy *= 0.8; }
}

export function stepGame(g, dt = SIM_DT) {
  if (g.phase !== "battle") return;
  g.t += dt;
  const arm = g.armies;
  // AI
  for (const tm of g.aiTeams) {
    const st = g.ai[tm];
    st.timer -= dt;
    if (st.timer <= 0) { st.timer = DIFFICULTIES[g.difficulty].think * (0.8 + g.rng() * 0.4); aiThink(g, tm); }
  }
  // orders + movement
  for (const a of arm) { a.dr += (armyRadius(a.n) - a.dr) * Math.min(1, dt * 4); a.ph += dt; moveArmy(g, a, dt); }
  // hostile separation
  for (let i = 0; i < arm.length; i++) for (let j = i + 1; j < arm.length; j++) {
    const a = arm[i], b = arm[j];
    if (a.team === b.team) continue;
    const d = dist(a.x, a.y, b.x, b.y) || 0.01, want = (armyRadius(a.n) + armyRadius(b.n)) * 0.8;
    if (d < want) {
      const push = (want - d) * 0.25, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
      tryMove(g, a, a.x - ux * push, a.y - uy * push); tryMove(g, b, b.x + ux * push, b.y + uy * push);
    }
  }
  // combat
  g.contacts.length = 0;
  const dmgIn = new Map(), flankIn = new Map();
  for (const a of arm) { a.engaged = false; dmgIn.set(a, 0); flankIn.set(a, 0); }
  const reach = new Map();
  for (const a of arm) {
    const ra = armyRadius(a.n), list = [];
    const ta = terrainAt(g, a.x, a.y);
    const range = a.arc * 100 * (ta === T_HILL ? 1.3 : 1);
    for (const b of arm) {
      if (b.team === a.team) continue;
      const d = dist(a.x, a.y, b.x, b.y), rb = armyRadius(b.n);
      const contact = d < (ra + rb) * 0.85;
      if (contact || (a.arc > 0.05 && d < ra + rb + range)) list.push({ b, d, contact });
    }
    reach.set(a, list);
  }
  for (const a of arm) {
    const list = reach.get(a);
    if (!list.length) continue;
    const ta = terrainAt(g, a.x, a.y);
    for (const { b, d, contact } of list) {
      if (contact) { a.engaged = true; b.engaged = true; g.contacts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); }
    }
    const mf = 0.5 + 0.5 * a.morale / 100;
    for (const { b, d, contact } of list) {
      let str;
      if (contact) {
        const charge = a.engT < 4 ? 1 + 0.8 * a.cav : 1;
        str = a.inf + a.cav * 1.4 * charge + a.arc * 0.4;
        str *= (1 + 0.3 * a.cav * b.arc) * (1 - 0.3 * a.cav * b.inf);
      } else str = a.arc * 0.75;
      // flanking: where does A stand relative to B's facing
      const dx = a.x - b.x, dy = a.y - b.y, dl = Math.hypot(dx, dy) || 1;
      const dot = (dx / dl) * Math.cos(b.facing) + (dy / dl) * Math.sin(b.facing); // 1 = in front
      const flank = dot < -0.35 ? 1.6 : dot < 0.3 ? 1.25 : 1;
      const tb = terrainAt(g, b.x, b.y);
      let def = defOf(b) * (tb === T_FOREST ? 1.35 : tb === T_HILL ? 1.2 : 1);
      if (!contact && tb === T_FOREST) def *= 1.15;
      const atk = ta === T_HILL ? 1.15 : 1;
      const share = list.length;
      let dmg = a.n * K_DMG * str * mf * flank * atk / def / (share > 1 ? Math.sqrt(share) : 1) * dt * (a.routed ? 0.3 : 1) * (a.stance === "retreat" ? 0.5 : 1);
      if (b.routed) dmg *= 1.2;
      dmgIn.set(b, dmgIn.get(b) + dmg);
      if (flank > 1) flankIn.set(b, flankIn.get(b) + dmg * (flank - 1));
    }
  }
  // HQ
  for (const h of g.hqs) {
    if (h.hp <= 0) continue;
    for (const a of arm) {
      if (a.team === h.team) continue;
      const d = dist(a.x, a.y, h.x, h.y);
      if (d < HQ_R + armyRadius(a.n) * 0.7) {
        h.hp -= a.n * 0.14 * dt * (a.routed ? 0.2 : 1) * (0.5 + 0.5 * a.morale / 100);
        dmgIn.set(a, dmgIn.get(a) + 4 * dt);
        a.engaged = true; a.hqHit = true;
      }
    }
  }
  // apply damage, morale
  for (const a of arm) {
    const loss = Math.min(a.n, dmgIn.get(a));
    a.n -= loss; g.stats.lost[a.team] += loss;
    const foe = 1 - a.team; g.stats.killed[foe] += loss;
    if (a.engaged) a.engT += dt; else a.engT = 0;
    const frac = a.n > 0 ? loss / Math.max(a.n, 10) : 1;
    a.morale -= frac * 55 + (flankIn.get(a) / Math.max(a.n, 10)) * 45;
    const list = reach.get(a);
    if (list.length) {
      const my = strengthOf(a); let their = 0;
      for (const x of list) their += strengthOf(x.b);
      if (their > my * 1.6) a.morale -= 1.2 * dt;
    }
    if (!a.engaged) a.morale += (dist(a.x, a.y, g.hqs[a.team].x, g.hqs[a.team].y) < 160 ? 5 : 2) * dt;
    a.morale = clamp(a.morale, 0, 100);
    if (!a.routed && a.morale < 18 && a.n > 0) { a.routed = true; a.route = []; a.path = []; a.legActive = false; a.chasing = false; }
    if (a.routed && a.morale > 50) { a.routed = false; a.stance = "hold"; }
    if (a.engaged && a.n > 0) {
      // face nearest enemy in contact
      let bd = 1e9, tb = null;
      for (const { b, d, contact } of list) if (contact && d < bd) { bd = d; tb = b; }
      if (tb) { const fa = Math.atan2(tb.y - a.y, tb.x - a.x); let da = fa - a.facing; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283; a.facing += da * Math.min(1, dt * 5); }
    }
  }
  // HQ garrison shoots
  for (const h of g.hqs) {
    if (h.hp <= 0) continue;
    for (const a of arm) if (a.team !== h.team && dist(a.x, a.y, h.x, h.y) < 90 + armyRadius(a.n)) { const l = Math.min(a.n, 3 * dt); a.n -= l; g.stats.lost[a.team] += l; g.stats.killed[h.team] += l; }
  }
  for (let i = arm.length - 1; i >= 0; i--) if (arm[i].n < 0.5) { g.stats.lost[arm[i].team] += arm[i].n; arm.splice(i, 1); }
  // control points
  for (const p of g.points) {
    let s = [0, 0];
    for (const a of arm) if (dist(a.x, a.y, p.x, p.y) < 55 + armyRadius(a.n) * 0.4) s[a.team] += a.n;
    if (s[0] !== s[1] && (s[0] > 0 || s[1] > 0)) {
      const dir = s[0] > s[1] ? -1 : 1; // prog: -1 = team0, +1 = team1
      if (s[0] > 0 && s[1] > 0) continue; // contested
      p.prog = clamp(p.prog + dir * dt / 8, -1, 1);
      if (p.prog <= -1) p.owner = 0; else if (p.prog >= 1) p.owner = 1;
      else if (Math.abs(p.prog) < 0.05) p.owner = -1;
    }
  }
  // reinforcements
  for (let tm = 0; tm < 2; tm++) {
    let held = 0; for (const p of g.points) if (p.owner === tm) held++;
    g.reserve[tm] += held * 1.4 * dt;
    if (g.reserve[tm] >= REINFORCE_COST && arm.filter((a) => a.team === tm).length < MAX_ARMIES) {
      const comp = normComp(0.25, 0.1), n = Math.floor(REINFORCE_COST / (armyCost(1, comp)));
      const hq = g.hqs[tm];
      const a = addArmy(g, tm, hq.x + (tm === 0 ? 70 : -70), hq.y + (g.rng() - 0.5) * 120, n, comp);
      if (a) { g.reserve[tm] -= armyCost(n, comp); a.stance = "advance"; }
    }
  }
  // victory
  if (!g.winner) {
    for (let tm = 0; tm < 2; tm++) {
      if (g.hqs[tm].hp <= 0) { g.winner = { team: 1 - tm }; g.winReason = "Headquarters destroyed"; }
    }
    if (!g.winner) for (let tm = 0; tm < 2; tm++) {
      if (!arm.some((a) => a.team === tm) && g.reserve[tm] < REINFORCE_COST) { g.winner = { team: 1 - tm }; g.winReason = "All armies destroyed"; }
    }
    if (!g.winner && g.t > TIME_LIMIT) {
      const s0 = arm.filter((a) => a.team === 0).reduce((s, a) => s + a.n, 0) + g.hqs[0].hp / 4, s1 = arm.filter((a) => a.team === 1).reduce((s, a) => s + a.n, 0) + g.hqs[1].hp / 4;
      g.winner = { team: s0 >= s1 ? 0 : 1 }; g.winReason = "Time limit: stronger side wins";
    }
    if (g.winner) g.phase = "over";
  }
}

// ---------- computer opponent ----------
function aiGo(g, a, tx, ty, stance = "advance", extra = null) {
  if (a.routed) return;
  if (a.aiGoal && dist(a.aiGoal.x, a.aiGoal.y, tx, ty) < 60 && (a.route.length || a.path.length) && a.stance === stance) return;
  a.stance = stance;
  a.route = extra ? [...extra, { x: tx, y: ty }] : [{ x: tx, y: ty }];
  a.path = []; a.legActive = false; a.chasing = false;
  a.aiGoal = { x: tx, y: ty };
}

function bestDefCell(g, cx, cy, rad, towardX, towardY) {
  let best = null, bs = -1e9;
  for (let k = 0; k < 40; k++) {
    const ang = g.rng() * 6.28, r = 40 + g.rng() * rad;
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    if (x < 30 || y < 30 || x > WORLD_W - 30 || y > WORLD_H - 30 || blockedAt(g, x, y)) continue;
    const t = terrainAt(g, x, y);
    let s = t === T_FOREST ? 3 : t === T_HILL ? 2.5 : 0;
    s -= dist(x, y, towardX, towardY) * 0.002;
    if (s > bs) { bs = s; best = { x, y }; }
  }
  return best;
}

function flankPoint(g, e, from) {
  const face = e.facing ?? 0;
  const opts = [];
  for (const s of [1, -1]) {
    const ang = face + s * 2.3; // to the side/rear
    for (const r of [190, 150, 230]) {
      const x = e.x + Math.cos(ang) * r, y = e.y + Math.sin(ang) * r;
      if (x > 30 && y > 30 && x < WORLD_W - 30 && y < WORLD_H - 30 && !blockedAt(g, x, y) && terrainAt(g, x, y) !== T_FOREST) opts.push({ x, y, d: dist(from.x, from.y, x, y) });
    }
  }
  opts.sort((a, b) => a.d - b.d);
  return opts[0] || null;
}

function aiThink(g, team) {
  const P = DIFFICULTIES[g.difficulty] || DIFFICULTIES.normal;
  const st = g.ai[team], enemyTeam = 1 - team;
  const mine = g.armies.filter((a) => a.team === team);
  if (!mine.length) return;
  const hq = g.hqs[team], ehq = g.hqs[enemyTeam];
  // memory of what we can legitimately see
  for (const e of g.armies) if (e.team !== team && visibleTo(g, team, e)) st.mem[e.id] = { id: e.id, x: e.x, y: e.y, n: e.n, t: g.t, facing: e.facing, str: strengthOf(e), morale: e.morale };
  const known = [];
  for (const k of Object.keys(st.mem)) {
    const m = st.mem[k];
    if (!g.armies.some((a) => a.id === m.id) || g.t - m.t > P.mem) { delete st.mem[k]; continue; }
    known.push(m);
  }
  const ownTotal = mine.reduce((s, a) => s + strengthOf(a), 0);
  const enTotal = known.reduce((s, m) => s + m.str, 0);
  const rally = { x: hq.x + (team === 0 ? 120 : -120), y: hq.y };

  // rally / retreat weak
  const active = [];
  for (const a of mine) {
    const near = known.some((m) => dist(m.x, m.y, a.x, a.y) < 230 && m.str > strengthOf(a) * 0.9);
    if (a.routed) continue;
    if (a.stance === "retreat" && dist(a.x, a.y, hq.x, hq.y) < 130 && a.morale > 60 && !a.engaged) { a.stance = "advance"; a.role = ""; a.aiGoal = null; }
    if (a.stance === "retreat") { a.role = "retreat"; continue; }
    if ((a.n < a.n0 * 0.3 || a.morale < 32) && (a.engaged || near) && mine.length > 1) {
      a.stance = "retreat"; a.role = "retreat"; a.route = []; a.path = []; a.legActive = false; a.chasing = false; a.aiGoal = null; continue;
    }
    active.push(a);
  }
  // merge weakened rallied blobs near base
  const rl = mine.filter((a) => a.role === "retreat" && !a.routed && !a.engaged && dist(a.x, a.y, hq.x, hq.y) < 150);
  if (rl.length > 1 && P.flank > 0) mergeOverlapping(g, rl);

  // defend the HQ
  const threats = known.filter((m) => dist(m.x, m.y, hq.x, hq.y) < 430 && g.t - m.t < 6);
  if (threats.length) {
    const tc = threats.reduce((b, m) => (dist(m.x, m.y, hq.x, hq.y) < dist(b.x, b.y, hq.x, hq.y) ? m : b), threats[0]);
    for (const a of active) if (dist(a.x, a.y, hq.x, hq.y) < 700 || dist(tc.x, tc.y, hq.x, hq.y) < 260) { a.role = "defend"; aiGo(g, a, tc.x, tc.y, "advance"); }
  }
  const free = active.filter((a) => a.role !== "defend");
  for (const a of free) if (a.role === "defend") a.role = "";

  // scout (fog only matters, but cheap): a cavalry-ish blob probes the middle
  if (free.length >= 3 && P.flank >= 0.5) {
    let sc = mine.find((a) => a.id === st.scout);
    if (!sc || sc.role !== "scout") {
      sc = free.slice().sort((a, b) => b.cav - a.cav || a.n - b.n)[0];
      if (sc && sc.cav > 0.3) { st.scout = sc.id; sc.role = "scout"; st.scoutStep = 0; } else sc = null;
    }
    if (sc && free.includes(sc)) {
      const spots = [{ x: 800, y: 500 }, { x: 900, y: 200 }, { x: 900, y: 800 }, { x: 800, y: 500 }];
      const near = known.find((m) => dist(m.x, m.y, sc.x, sc.y) < 260 && m.str > strengthOf(sc) * 1.1);
      if (near) aiGo(g, sc, rally.x, rally.y, "retreat");
      else if (!sc.route.length && !sc.path.length) {
        st.scoutStep = ((st.scoutStep || 0) + 1) % spots.length;
        const s = spots[st.scoutStep];
        aiGo(g, sc, team === 0 ? s.x : WORLD_W - s.x, s.y, "advance");
      }
    }
  }
  const main = free.filter((a) => a.role !== "scout");
  if (!main.length) return;
  const cx = main.reduce((s, a) => s + a.x, 0) / main.length, cy = main.reduce((s, a) => s + a.y, 0) / main.length;
  const mainStr = main.reduce((s, a) => s + strengthOf(a), 0);

  // pick a target among the enemies we know about
  let target = null, bs = 1e9;
  for (const m of known) {
    const local = known.filter((o) => dist(o.x, o.y, m.x, m.y) < 260).reduce((s, o) => s + o.str, 0);
    const s = dist(cx, cy, m.x, m.y) * 0.5 + (P.flank > 0 ? local : m.str) * 1.4;
    if (s < bs) { bs = s; target = { ...m, local }; }
  }
  const allIn = g.t > P.pushTime && ownTotal > enTotal * 0.9 || g.t > 260;

  if (target && (mainStr * P.aggr >= target.local * 0.85 || allIn || dist(target.x, target.y, hq.x, hq.y) < 450)) {
    const ratio = mainStr / Math.max(1, target.local);
    const inForest = terrainAt(g, target.x, target.y) === T_FOREST;
    if (inForest && ratio < 2.1 && P.ambush > 0.4 && g.rng() < P.ambush + 0.4) {
      // do not walk into the trees: pull to the flank and bait, attack after a wait
      if (!st.wait) st.wait = g.t;
      if (g.t - st.wait < 45) {
        const fp = flankPoint(g, target, { x: cx, y: cy });
        if (fp) { for (const a of main) aiGo(g, a, fp.x + (g.rng() - 0.5) * 40, fp.y + (g.rng() - 0.5) * 40, "hold"); return; }
      }
    } else st.wait = 0;
    let idx = 0;
    for (const a of main) {
      a.role = "attack";
      if (P.flank > 0 && main.length >= 2 && idx % 2 === 1 && dist(a.x, a.y, target.x, target.y) > 260) {
        const fp = flankPoint(g, target, a);
        if (fp) { aiGo(g, a, target.x, target.y, "advance", [fp]); idx++; continue; }
      }
      // split a big blob to flank
      if (P.flank > 0 && main.length < 6 && a.n > 110 && dist(a.x, a.y, target.x, target.y) > 300 && g.t - st.splitT > 18 && g.rng() < P.flank) {
        const b = splitArmy(g, a, 0.4);
        if (b) {
          st.splitT = g.t; b.role = "attack";
          const fp = flankPoint(g, target, b);
          aiGo(g, b, target.x, target.y, "advance", fp ? [fp] : null);
        }
      }
      aiGo(g, a, target.x, target.y, "advance");
      idx++;
    }
    return;
  }
  st.wait = 0;
  if (target && mainStr < target.local * 0.6 && dist(target.x, target.y, hq.x, hq.y) < 700) {
    // outmatched and they are coming: dig in on good ground near home
    const d = bestDefCell(g, hq.x + (team === 0 ? 160 : -160), hq.y, 170, target.x, target.y);
    for (const a of main) { if (d) aiGo(g, a, d.x + (g.rng() - 0.5) * 40, d.y + (g.rng() - 0.5) * 40, "hold"); }
    return;
  }
  // no fight to pick: take control points, then push the HQ
  const takenBy = new Set();
  const wantPoints = g.points.filter((p) => p.owner !== team).sort((p, q) => dist(cx, cy, p.x, p.y) - dist(cx, cy, q.x, q.y));
  const spare = main.slice().sort((a, b) => a.n - b.n);
  for (const p of wantPoints) {
    if (takenBy.size >= Math.max(1, main.length - 1)) break;
    const a = spare.filter((s) => !takenBy.has(s.id)).sort((s1, s2) => dist(s1.x, s1.y, p.x, p.y) - dist(s2.x, s2.y, p.x, p.y))[0];
    if (!a) break;
    if (dist(a.x, a.y, p.x, p.y) < 800 && (g.t < P.pushTime + 60 || p.owner === -1)) { takenBy.add(a.id); a.role = "capture"; aiGo(g, a, p.x, p.y, "advance"); }
  }
  const rest = main.filter((a) => !takenBy.has(a.id));
  const push = g.t > P.pushTime || ownTotal > START_BUDGET * 0.8 * (P.aggr > 1 ? 0.5 : 1);
  for (const a of rest) {
    if (push && g.t > 40) { a.role = "assault"; aiGo(g, a, ehq.x + (team === 0 ? -80 : 80), ehq.y + (g.rng() - 0.5) * 60, "advance"); }
    else { a.role = "stage"; aiGo(g, a, WORLD_W / 2 + (team === 0 ? -260 : 260), WORLD_H / 2 + (g.rng() - 0.5) * 200, "advance"); }
  }
}

// Headless convenience: run until finished (or maxT). Returns the game.
export function runToEnd(g, maxT = TIME_LIMIT + 10, dt = SIM_DT) {
  if (g.phase === "deploy") startBattle(g);
  while (g.phase === "battle" && g.t < maxT) stepGame(g, dt);
  return g;
}

// ====================== UI ======================

const CSS = `
.war-root .war-wrap{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:12px;align-items:start}
.war-root .war-stage{position:relative;width:100%;aspect-ratio:16/10;background:var(--panel-alt);border:1px solid var(--border);border-radius:10px;overflow:hidden;user-select:none;-webkit-user-select:none}
.war-root .war-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block;cursor:crosshair}
.war-root .war-hud{position:absolute;left:8px;top:8px;display:flex;gap:6px;flex-wrap:wrap;pointer-events:none}
.war-root .war-chip{background:color-mix(in srgb,var(--panel) 88%,transparent);border:1px solid var(--border);color:var(--text);border-radius:999px;padding:2px 10px;font-size:12px}
.war-root .war-side{display:flex;flex-direction:column;gap:10px;max-height:calc(100vh - 150px);overflow-y:auto;padding-right:2px}
.war-root .war-card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--text);font-size:13px}
.war-root .war-card h3{margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim);font-weight:600}
.war-root .war-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0}
.war-root .war-row label{color:var(--text-dim);font-size:12px;min-width:74px}
.war-root select,.war-root .war-btn{background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 9px;font-size:12px;font-family:inherit}
.war-root .war-btn{cursor:pointer}
.war-root .war-btn:hover:not(:disabled){border-color:var(--accent)}
.war-root .war-btn:disabled{opacity:.45;cursor:default}
.war-root .war-btn.on{background:var(--accent);border-color:var(--accent);color:#fff}
.war-root .war-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.war-root input[type=range]{flex:1;min-width:90px;accent-color:var(--accent)}
.war-root .war-val{min-width:38px;text-align:right;color:var(--text-dim);font-variant-numeric:tabular-nums}
.war-root .war-list{display:flex;flex-direction:column;gap:4px;max-height:230px;overflow-y:auto}
.war-root .war-arow{display:grid;grid-template-columns:12px 34px 1fr auto;gap:6px;align-items:center;padding:4px 6px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px}
.war-root .war-arow.sel{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
.war-root .war-dot{width:10px;height:10px;border-radius:50%}
.war-root .war-mini{height:4px;border-radius:2px;background:var(--border);overflow:hidden;margin-top:2px}
.war-root .war-mini>i{display:block;height:100%}
.war-root .war-dim{color:var(--text-dim);font-size:12px}
.war-root .war-banner{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:color-mix(in srgb,var(--panel) 55%,transparent);backdrop-filter:blur(2px)}
.war-root .war-banner.show{display:flex}
.war-root .war-banner>div{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px 24px;text-align:center;color:var(--text);max-width:90%}
.war-root .war-banner h2{margin:0 0 6px;font-size:26px}
.war-root .war-pop{position:absolute;display:none;background:var(--panel);border:1px solid var(--accent);border-radius:10px;padding:10px;color:var(--text);font-size:12px;width:210px;box-shadow:0 6px 24px rgba(0,0,0,.35);z-index:5}
.war-root .war-pop.show{display:block}
@media (max-width:820px){
 .war-root .war-wrap{grid-template-columns:minmax(0,1fr)}
 .war-root .war-side{max-height:none;overflow:visible}
 .war-root .war-stage{aspect-ratio:4/3}
}`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const STANCE_LABEL = { advance: "Advance", hold: "Hold", retreat: "Retreat" };

export class WarMode {
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx;
    this.built = false; this.mounted = false;
    this.mapId = "forest"; this.difficulty = "normal"; this.fog = false; this.simSpeed = 1; this.paused = false;
    this.recruit = { n: 100, arc: 25, cav: 15 };
    this.sel = new Set(); this.placing = false; this.hover = null;
    this.game = null; this.raf = 0; this.acc = 0; this.lastT = 0; this.ptr = null; this.listSig = "";
    this.splitTarget = null; this.splitFrac = 0.5;
    this.terrainImg = null; this.terrainKey = "";
    this.mode = "skirmish"; this.camp = null; this.campBattle = null; this.campSel = null; this.campMsg = "";
    this.campRecruit = { army: "new", n: 50, arc: 25, cav: 10 }; this.confirmKind = ""; this._skGame = null;
  }

  mount() {
    if (!document.getElementById("war-styles")) {
      const st = document.createElement("style"); st.id = "war-styles"; st.textContent = CSS; document.head.appendChild(st);
    }
    if (!this.built) this._build();
    if (!this.game) this._newGame(this.mapId, true);
    this.mounted = true;
    this._setMode(this.mode);
    this._onKey = (e) => this._key(e);
    window.addEventListener("keydown", this._onKey);
    this.ro = new ResizeObserver(() => this._resize());
    this.ro.observe(this.stage);
    this._resize();
    this.lastT = performance.now();
    const loop = (now) => {
      if (!this.mounted) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.lastT) / 1000); this.lastT = now;
      this._frame(dt, now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  unmount() {
    this.mounted = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this._onKey);
    this.ro?.disconnect();
  }

  // ----- structure -----
  _build() {
    const root = this.root;
    root.innerHTML = "";
    root.className = "econ-root war-root";
    root.appendChild(el("h1", "econ-title", "War"));
    this.toggle = el("div", "war-camp-toggle");
    this.tabBtns = {};
    for (const [k, label] of [["skirmish", "Skirmish"], ["campaign", "Campaign"]]) {
      const b = el("button", "war-btn", label); b.onclick = () => this._setMode(k); this.tabBtns[k] = b; this.toggle.appendChild(b);
    }
    root.appendChild(this.toggle);
    try { this.camp = CP.loadCampaign(localStorage); } catch { this.camp = null; }
    const wrap = el("div", "war-wrap"); this.wrap = wrap;
    this.campBox = el("div", "war-camp-root"); this.campBox.style.display = "none";
    this.stage = el("div", "war-stage");
    this.canvas = el("canvas", "war-canvas");
    this.hud = el("div", "war-hud");
    this.banner = el("div", "war-banner");
    this.pop = el("div", "war-pop");
    this.stage.append(this.canvas, this.hud, this.banner, this.pop);
    this.side = el("div", "war-side");
    wrap.append(this.stage, this.side);
    root.append(wrap, this.campBox);
    this.ctx2 = this.canvas.getContext("2d");
    this.fogCanvas = document.createElement("canvas");

    // game card
    const c1 = el("div", "war-card"); c1.appendChild(el("h3", null, "Battle"));
    const mapSel = el("select"); for (const m of MAPS) { const o = el("option", null, m.name); o.value = m.id; mapSel.appendChild(o); }
    mapSel.value = this.mapId; mapSel.onchange = () => { this.mapId = mapSel.value; this._newGame(this.mapId); };
    this.mapSel = mapSel;
    const rnd = el("button", "war-btn", "Random map"); rnd.onclick = () => this._newGame("random");
    const diffSel = el("select"); for (const k of Object.keys(DIFFICULTIES)) { const o = el("option", null, DIFFICULTIES[k].name); o.value = k; diffSel.appendChild(o); }
    diffSel.value = this.difficulty; diffSel.onchange = () => { this.difficulty = diffSel.value; this._newGame(this.game.mapId === this.mapId ? this.mapId : "random", false, this.game.seed); };
    const fogB = el("button", "war-btn", "Fog of war: off");
    fogB.onclick = () => { this.fog = !this.fog; if (this.game) this.game.fog = this.fog; fogB.textContent = "Fog of war: " + (this.fog ? "on" : "off"); fogB.classList.toggle("on", this.fog); };
    const r1 = el("div", "war-row"); r1.append(el("label", null, "Map"), mapSel, rnd);
    const r2 = el("div", "war-row"); r2.append(el("label", null, "Difficulty"), diffSel);
    const r3 = el("div", "war-row"); r3.append(fogB);
    c1.append(r1, r2, r3); this.fogB = fogB; this.c1 = c1;

    // phase card
    this.phaseCard = el("div", "war-card");
    // selection card
    this.selCard = el("div", "war-card");
    this.selCard.appendChild(el("h3", null, "Orders"));
    const mk = (label, fn, title) => { const b = el("button", "war-btn", label); b.onclick = fn; if (title) b.title = title; return b; };
    this.stBtns = {
      advance: mk("Advance", () => this._stance("advance"), "Attack anything in range (A)"),
      hold: mk("Hold", () => this._stance("hold"), "Defend position (H)"),
      retreat: mk("Retreat", () => this._stance("retreat"), "Fall back to HQ (R)"),
    };
    const sr = el("div", "war-row"); sr.append(...Object.values(this.stBtns));
    this.splitBtn = mk("Split", () => this._openSplit(), "Split selected army (S)");
    this.mergeBtn = mk("Merge", () => this._merge(), "Merge overlapping selected armies (M)");
    this.cancelBtn = mk("Cancel orders", () => { cancelOrders(this.game, this._selArmies()); }, "Escape");
    const sr2 = el("div", "war-row"); sr2.append(this.splitBtn, this.mergeBtn, this.cancelBtn);
    this.selInfo = el("div", "war-dim");
    this.selCard.append(sr, sr2, this.selInfo);
    // list card
    this.listCard = el("div", "war-card"); this.listCard.appendChild(el("h3", null, "Armies"));
    this.listBox = el("div", "war-list"); this.listCard.appendChild(this.listBox);
    // hint
    const hint = el("div", "war-card war-dim");
    hint.innerHTML = "Click an army to select; drag a box to select several. Click the map to move; drag from an army to draw a route; Shift adds waypoints. Click a selected army (or long-press) to split; drag one army onto another to merge them. S split, M merge, A/H/R stance, Space pause, Esc cancel. Stand on control points to capture them for reinforcements. Destroy the enemy HQ or wipe out their armies to win; if time runs out, the stronger side wins.";
    this.side.append(c1, this.phaseCard, this.selCard, this.listCard, hint);

    // pointer input
    const cv = this.canvas;
    cv.addEventListener("pointerdown", (e) => this._pdown(e));
    cv.addEventListener("pointermove", (e) => this._pmove(e));
    cv.addEventListener("pointerup", (e) => this._pup(e));
    cv.addEventListener("pointercancel", () => { this.ptr = null; clearTimeout(this.lp); });
    cv.addEventListener("contextmenu", (e) => { e.preventDefault(); const p = this._world(e); const s = this._selArmies(); if (s.length && this.game.phase === "battle") orderMove(this.game, s, [p], e.shiftKey); });
    this.built = true;
  }

  _newGame(mapId, first = false, seed) {
    this.mapId = mapId === "random" ? "random" : mapId;
    const g = createGame({ map: mapId, difficulty: this.difficulty, fog: this.fog, seed });
    this.game = g; this.sel.clear(); this.placing = false; this.paused = false; this.terrainKey = "";
    if (this.mapSel && mapId !== "random") this.mapSel.value = mapId;
    this.banner.classList.remove("show"); this.pop.classList.remove("show");
    this.listSig = ""; this._renderPhase();
    void first;
  }

  _renderPhase() {
    const g = this.game, c = this.phaseCard;
    c.innerHTML = "";
    if (this.campBattle && g.phase === "deploy") {
      const cb = this.campBattle;
      c.appendChild(el("h3", null, "Deployment"));
      c.appendChild(el("div", "war-dim", `Attacking ${cb.name} (${cb.terrainName}). Enemy commander: ${DIFFICULTIES[cb.setup.difficulty].name}.` + (cb.setup.morale ? ` Long supply line: your morale starts ${cb.setup.morale} lower.` : "")));
      c.appendChild(el("div", "war-dim", "Drag your armies inside the blue zone to set up. Survivors carry over to the campaign."));
      const r = el("div", "war-row");
      const start = el("button", "war-btn primary", "Start battle"); start.onclick = () => { startBattle(g); this._renderPhase(); };
      const wd = el("button", "war-btn", "Withdraw"); wd.title = "Call off the attack; no losses"; wd.onclick = () => this._campExitBattle();
      r.append(start, wd); c.appendChild(r);
      return;
    }
    if (g.phase === "deploy") {
      c.appendChild(el("h3", null, "Deployment"));
      // Sliders update in place: rebuilding the panel on every 'input' event
      // destroyed the slider under the pointer mid-drag, so it couldn't be dragged.
      const sliders = [];
      const mkSlider = (label, key, min, max, step, fmt) => {
        const r = el("div", "war-row"); const inp = el("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = this.recruit[key];
        const v = el("span", "war-val", fmt(this.recruit[key]));
        sliders.push({ inp, v, key, fmt });
        inp.oninput = () => { this.recruit[key] = +inp.value; if (this.recruit.arc + this.recruit.cav > 100) { if (key === "arc") this.recruit.cav = 100 - this.recruit.arc; else this.recruit.arc = 100 - this.recruit.cav; } syncDeploy(); };
        r.append(el("label", null, label), inp, v); return r;
      };
      c.append(mkSlider("Troops", "n", 20, 300, 10, (v) => v), mkSlider("Archers %", "arc", 0, 100, 5, (v) => v), mkSlider("Cavalry %", "cav", 0, 100, 5, (v) => v));
      const info = el("div", "war-dim", ""); c.appendChild(info);
      let place = null;
      const syncDeploy = () => {
        for (const sl of sliders) { if (document.activeElement !== sl.inp) sl.inp.value = this.recruit[sl.key]; sl.v.textContent = sl.fmt(this.recruit[sl.key]); }
        const comp = normComp(this.recruit.arc / 100, this.recruit.cav / 100), cost = Math.round(armyCost(this.recruit.n, comp));
        info.textContent = `Infantry ${Math.round(comp.inf * 100)}%  |  cost ${cost} pts  |  budget left ${Math.round(g.budget[0])}`;
        if (place) place.disabled = cost > g.budget[0];
      };
      syncDeploy();
      const r = el("div", "war-row");
      place = el("button", "war-btn" + (this.placing ? " on" : ""), this.placing ? "Click deployment zone..." : "Place army");
      place.onclick = () => { this.placing = !this.placing; this._renderPhase(); };
      const auto = el("button", "war-btn", "Auto deploy"); auto.onclick = () => { for (const a of g.armies.filter((x) => x.team === 0).slice()) removeArmyRefund(g, a); autoDeploy(g, 0); this._renderPhase(); };
      const start = el("button", "war-btn primary", "Start battle"); start.disabled = !g.armies.some((a) => a.team === 0);
      start.onclick = () => { startBattle(g); this.placing = false; this._renderPhase(); };
      r.append(place, auto, start); c.appendChild(r); syncDeploy();
      c.appendChild(el("div", "war-dim", "Drag your armies inside the blue zone to reposition them. Unspent points become reinforcement reserve."));
    } else {
      c.appendChild(el("h3", null, "Battle"));
      const r = el("div", "war-row");
      const p = el("button", "war-btn" + (this.paused ? " on" : ""), this.paused ? "Resume" : "Pause"); p.onclick = () => { this.paused = !this.paused; this._renderPhase(); };
      r.appendChild(p);
      for (const s of [1, 2, 4]) { const b = el("button", "war-btn" + (this.simSpeed === s ? " on" : ""), s + "x"); b.onclick = () => { this.simSpeed = s; this._renderPhase(); }; r.appendChild(b); }
      c.appendChild(r);
      this.statusLine = el("div", "war-dim"); c.appendChild(this.statusLine);
    }
  }

  // ====================== campaign ======================
  _setMode(m) {
    this.mode = m;
    for (const k of Object.keys(this.tabBtns)) this.tabBtns[k].classList.toggle("on", k === m);
    const inBattle = !!this.campBattle;
    this.wrap.style.display = m === "skirmish" || inBattle ? "" : "none";
    this.campBox.style.display = m === "campaign" && !inBattle ? "" : "none";
    if (m === "skirmish") { this.terrainKey = ""; this._resize(); this._renderPhase(); }
    else if (!inBattle) this._campRender();
  }
  _campSave() { if (this.camp) CP.saveCampaign(this.camp, localStorage); }
  _cb(label, fn, cls = "") { const b = el("button", "war-btn" + (cls ? " " + cls : ""), label); b.onclick = fn; return b; }
  _campStart(id) {
    this.camp = CP.newCampaign(id, Math.floor(Math.random() * 1e6));
    this.campSel = null; this.campMsg = ""; this.confirmKind = ""; this._campSave(); this._campRender();
  }
  _campLeave() { CP.clearCampaign(localStorage); this.camp = null; this.campSel = null; this.campMsg = ""; this.confirmKind = ""; this._campRender(); }

  _campRender() {
    const box = this.campBox; box.innerHTML = "";
    const st = this.camp;
    if (!st) return this._campMenu();
    if (st.status !== "active") return this._campSummary();
    const sc = CP.scenarioById(st.scenarioId);
    const wrap = el("div", "war-camp-wrap");
    // map
    const mapCol = el("div", "war-camp-mapcol");
    const scroll = el("div", "war-camp-mapscroll"); scroll.appendChild(this._campMap(st, sc));
    mapCol.append(scroll, el("div", "war-dim war-camp-legend", "Blue land is yours, red is enemy. Tap a red region next to your land to plan an attack. Dashed red roads show where you can attack."));
    // side
    const side = el("div", "war-camp-side");
    // status
    const c1 = el("div", "war-card"); c1.appendChild(el("h3", null, sc.name));
    const chips = el("div", "war-camp-chips");
    for (const t of [`Turn ${st.turn}`, `Gold ${st.gold}`, `+${CP.income(st)}/turn`, `Land ${CP.playerRegions(st).length}/${st.regions.length}`, `Troops ${CP.rosterTotal(st)}`]) chips.appendChild(el("span", "war-chip", t));
    const r1 = el("div", "war-camp-btnrow");
    const end = this._cb(st.attacked ? "End turn" : "End turn (skip attack)", () => { CP.endTurn(st); this._campSave(); this.campSel = null; this._campRender(); }, "primary");
    r1.appendChild(end);
    const r2 = el("div", "war-camp-btnrow");
    const nb = this._cb(this.confirmKind === "new" ? "Really start over?" : "New campaign", () => { if (this.confirmKind === "new") this._campLeave(); else { this.confirmKind = "new"; this._campRender(); } });
    const ab = this._cb(this.confirmKind === "abandon" ? "Really abandon?" : "Abandon", () => {
      if (this.confirmKind === "abandon") { st.status = "lost"; st.endReason = "You abandoned the campaign."; this.confirmKind = ""; this._campSave(); this._campRender(); }
      else { this.confirmKind = "abandon"; this._campRender(); }
    });
    r2.append(nb, ab);
    c1.append(chips, r1, r2);
    if (this.campMsg) c1.appendChild(el("div", "war-dim war-camp-msg", this.campMsg));
    // region
    const c2 = this._campRegionCard(st);
    // roster
    const c3 = this._campRosterCard(st);
    // threats
    const c4 = el("div", "war-card"); c4.appendChild(el("h3", null, "Enemy counter-attacks"));
    const th = CP.threats(st).filter((t) => t.ratio > 0.55);
    if (!th.length) c4.appendChild(el("div", "war-dim", "No enemy region is strong enough to threaten you right now."));
    for (const t of th.slice(0, 4)) c4.appendChild(el("div", "war-camp-line", `${CP.tName(st, t.from)} to ${CP.tName(st, t.to)}: about ${t.atk} vs your ${t.def}`));
    c4.appendChild(el("div", "war-dim", "Your field army adds half its strength to any region under attack. Forts and hills make defence stronger."));
    if (st.lastReport.length) { c4.appendChild(el("h3", "war-camp-sub", "Last turn")); for (const l of st.lastReport) c4.appendChild(el("div", "war-camp-line", l)); }
    // lesson
    const c5 = el("div", "war-card war-dim"); c5.textContent = sc.blurb;
    const c6 = el("div", "war-card"); c6.appendChild(el("h3", null, "Log"));
    for (const l of st.log.slice(-6).reverse()) c6.appendChild(el("div", "war-camp-line", l));
    side.append(c1, c2, c3, c4, c5, c6);
    wrap.append(mapCol, side);
    box.appendChild(wrap);
  }

  _campMenu() {
    const box = this.campBox;
    const head = el("div", "war-card"); head.appendChild(el("h3", null, "Campaign"));
    head.appendChild(el("div", "war-dim", "Lead a persistent army across ten regions to capture the enemy capital. Survivors carry over between battles, so every loss matters. Earn gold from your land and spend it on new troops between fights."));
    box.appendChild(head);
    const grid = el("div", "war-camp-menu");
    for (const sc of CP.SCENARIOS) {
      const c = el("div", "war-card war-camp-scn");
      c.append(el("h3", null, sc.level), el("div", "war-camp-scn-name", sc.name), el("div", "war-dim", sc.blurb), el("div", "war-dim", `Start: ${sc.gold} gold, ${sc.maxAttacks === 1 ? "1 enemy counter-attack" : sc.maxAttacks + " enemy counter-attacks"} per turn at most.`));
      c.appendChild(this._cb("Start", () => this._campStart(sc.id), "primary"));
      grid.appendChild(c);
    }
    box.appendChild(grid);
  }

  _campSummary() {
    const st = this.camp, s = CP.summary(st), box = this.campBox;
    const c = el("div", "war-card war-camp-sum");
    c.append(el("h2", null, s.won ? "Campaign won" : "Campaign lost"), el("div", "war-dim", st.endReason), el("div", "war-camp-scn-name", s.scenario));
    const grid = el("div", "war-camp-stats");
    for (const [k, v] of [["Turns", s.turns], ["Battles", `${s.battlesWon} won of ${s.battles}`], ["Regions held", s.regionsHeld], ["Regions captured", s.captured], ["Regions lost", s.lostRegions], ["Attacks repelled", s.defended], ["Your troops lost", s.troopsLost], ["Enemy strength destroyed", s.enemyKilled], ["Gold spent", s.goldSpent]]) {
      const d = el("div", "war-camp-stat"); d.append(el("b", null, String(v)), el("span", "war-dim", k)); grid.appendChild(d);
    }
    c.append(grid, el("div", "war-dim", s.lesson));
    const r = el("div", "war-camp-btnrow");
    r.append(this._cb("New campaign", () => this._campLeave(), "primary"));
    c.appendChild(r); box.appendChild(c);
  }

  _campMap(st, sc) {
    const NS = "http://www.w3.org/2000/svg";
    const sv = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
    const svg = sv("svg", { viewBox: "0 0 100 60", class: "war-camp-map", role: "group", "aria-label": "Campaign map" });
    sv("rect", { x: 0, y: 0, width: 100, height: 60, fill: "#efe6cf" }, svg);
    sv("rect", { x: 0.6, y: 0.6, width: 98.8, height: 58.8, fill: "none", stroke: "#8a6d3b", "stroke-width": 0.5, "stroke-dasharray": "1.5 1" }, svg);
    const atk = new Set(CP.attackableRegions(st));
    const P = CP.LAYOUT.pos;
    for (const [a, b] of CP.LAYOUT.edges) {
      const hot = (st.regions[a].owner !== st.regions[b].owner);
      sv("line", { x1: P[a][0], y1: P[a][1], x2: P[b][0], y2: P[b][1], stroke: hot ? "#b23b3b" : "#8a6d3b", "stroke-width": hot ? 0.7 : 0.5, "stroke-dasharray": "1.2 1", "stroke-linecap": "round" }, svg);
    }
    for (const r of st.regions) {
      const [cx, cy] = P[r.id], rng = mulberry32(sc.seed * 97 + r.id * 13);
      const N = 12, pts = [];
      for (let i = 0; i < N; i++) { const a = (i / N) * 6.283, rr = 6.2 * (0.86 + 0.28 * rng()); pts.push([cx + Math.cos(a) * rr * 1.15, cy + Math.sin(a) * rr]); }
      const mid = (p, q) => `${((p[0] + q[0]) / 2).toFixed(2)} ${((p[1] + q[1]) / 2).toFixed(2)}`;
      let d = "M" + mid(pts[N - 1], pts[0]);
      for (let i = 0; i < N; i++) d += ` Q${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} ${mid(pts[i], pts[(i + 1) % N])}`;
      const T = CP.TERRAINS[r.terrain], mine = r.owner === 0, sel = this.campSel === r.id;
      const g = sv("g", { class: "war-camp-region" + (atk.has(r.id) ? " atk" : ""), tabindex: 0, role: "button", "aria-label": `${sc.names[r.id]}, ${T.name}, ${mine ? "yours" : "enemy"}` }, svg);
      sv("path", { d: d + "Z", fill: T.fill, stroke: sel ? "#f59e0b" : mine ? "#2563eb" : "#dc2626", "stroke-width": sel ? 1.3 : 0.8, "stroke-linejoin": "round" }, g);
      // terrain glyph
      const ink = "#5b4a2a";
      if (r.terrain === "forest") { for (const dx of [-2.2, 0.4, 2.8]) sv("path", { d: `M${cx + dx - 1.2} ${cy - 1.6}L${cx + dx} ${cy - 4.4}L${cx + dx + 1.2} ${cy - 1.6}Z`, fill: "#3f6b3a" }, g); }
      else if (r.terrain === "hills") { sv("path", { d: `M${cx - 4} ${cy - 1.8}Q${cx - 2} ${cy - 5} ${cx} ${cy - 1.8}Q${cx + 2} ${cy - 4.6} ${cx + 4} ${cy - 1.8}`, fill: "none", stroke: ink, "stroke-width": 0.5 }, g); }
      else if (r.terrain === "river") { sv("path", { d: `M${cx - 4} ${cy - 3.4}q1.3 -1.4 2.6 0t2.6 0t2.6 0`, fill: "none", stroke: "#3d6fa8", "stroke-width": 0.7 }, g); }
      else if (r.terrain === "ruins") { for (const dx of [-2.6, 0, 2.6]) sv("rect", { x: cx + dx - 0.5, y: cy - 4.6 + (dx === 0 ? 1 : 0), width: 1, height: dx === 0 ? 2.6 : 3.6, fill: ink }, g); }
      else { for (const dx of [-3, 0, 3]) sv("path", { d: `M${cx + dx - 0.6} ${cy - 1.8}L${cx + dx} ${cy - 3.6}L${cx + dx + 0.6} ${cy - 1.8}`, fill: "none", stroke: "#5f7a3a", "stroke-width": 0.4 }, g); }
      const t1 = sv("text", { x: cx, y: cy + 1.4, "text-anchor": "middle", "font-size": 2.4, "font-weight": 700, fill: "#2b2416" }, g); t1.textContent = sc.names[r.id];
      const gl = mine ? `${r.garrison}` : `~${Math.round(CP.defenderPoints(st, r.id) / 10) * 10}`;
      const t2 = sv("text", { x: cx, y: cy + 4.4, "text-anchor": "middle", "font-size": 2.3, fill: mine ? "#1d4ed8" : "#b91c1c", "font-weight": 700 }, g); t2.textContent = gl + (r.fort ? " F" + r.fort : "");
      if (r.id === CP.LAYOUT.playerCapital || r.id === CP.LAYOUT.enemyCapital) {
        sv("path", { d: `M${cx} ${cy - 7.2}v-3.4l3 1.1l-3 1.1`, fill: mine ? "#2563eb" : "#dc2626", stroke: "#2b2416", "stroke-width": 0.3 }, g);
      }
      g.addEventListener("click", () => { this.campSel = r.id; this.campMsg = ""; this._campRender(); });
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.campSel = r.id; this._campRender(); } });
    }
    return svg;
  }

  _campRegionCard(st) {
    const c = el("div", "war-card"); c.appendChild(el("h3", null, "Region"));
    const rid = this.campSel;
    if (rid == null) { c.appendChild(el("div", "war-dim", "Tap a region on the map.")); return c; }
    const r = st.regions[rid], T = CP.TERRAINS[r.terrain], nm = CP.tName(st, rid);
    c.appendChild(el("div", "war-camp-scn-name", `${nm}: ${T.name}`));
    c.appendChild(el("div", "war-dim", T.note));
    c.appendChild(el("div", "war-camp-line", `Income ${T.income}/turn` + (r.fort ? `  |  Fort level ${r.fort}` : "")));
    if (r.owner === 0) {
      c.appendChild(el("div", "war-camp-line", `Militia strength ${r.garrison}. Held by you.`));
      const fc = CP.fortifyCost(st, rid);
      const f = this._cb(r.fort >= 2 ? "Fully fortified" : `Fortify (${fc} gold)`, () => { const res = CP.fortify(st, rid); this.campMsg = res.ok ? "Fort built. Defenders behind walls hold out against larger forces." : res.reason; this._campSave(); this._campRender(); });
      f.disabled = r.fort >= 2 || fc > st.gold; f.title = "Adds a fort level and some militia";
      const row = el("div", "war-camp-btnrow"); row.appendChild(f); c.appendChild(row);
    } else {
      const chk = CP.canAttack(st, rid);
      c.appendChild(el("div", "war-camp-line", `Enemy strength about ${Math.round(CP.defenderPoints(st, rid) / 10) * 10} points (terrain and forts included).`));
      c.appendChild(el("div", "war-camp-line", `Enemy commander: ${DIFFICULTIES[CP.regionDifficulty(st, rid)].name}.`));
      if (chk.ok) {
        const pen = CP.moralePenalty(st, rid);
        c.appendChild(el("div", "war-dim", pen ? `Supply line is ${pen / 4 + 1} regions long, so your morale starts ${pen} lower.` : "Short supply line: your troops arrive fresh."));
      }
      const a = this._cb("Attack", () => this._campAttack(rid), "primary"); a.disabled = !chk.ok;
      const row = el("div", "war-camp-btnrow"); row.appendChild(a); c.appendChild(row);
      if (!chk.ok) c.appendChild(el("div", "war-dim", chk.reason));
    }
    return c;
  }

  _campRosterCard(st) {
    const c = el("div", "war-card"); c.appendChild(el("h3", null, `Roster (${st.roster.length}/${CP.MAX_ROSTER})`));
    const list = el("div", "war-list");
    for (const a of st.roster) {
      const row = el("div", "war-camp-army");
      const top = el("div", "war-camp-armytop"); top.append(el("b", null, a.name), el("span", "war-dim", `${a.n} troops`));
      const comp = el("div", "war-dim", `Inf ${Math.round((1 - a.arc - a.cav) * 100)}%  Arc ${Math.round(a.arc * 100)}%  Cav ${Math.round(a.cav * 100)}%`);
      const bar = el("div", "war-mini"), bi = el("i"); bi.style.width = a.morale + "%"; bi.style.background = a.morale > 50 ? "#22c55e" : a.morale > 25 ? "#eab308" : "var(--danger)"; bar.appendChild(bi);
      row.append(top, comp, bar); list.appendChild(row);
    }
    if (!st.roster.length) list.appendChild(el("div", "war-dim", "No armies left. Recruit below."));
    c.appendChild(list);
    // recruit form: sliders update in place (never rebuilt during 'input')
    c.appendChild(el("h3", "war-camp-sub", "Recruit"));
    const rc = this.campRecruit;
    if (rc.army !== "new" && !st.roster.some((a) => String(a.id) === rc.army)) rc.army = "new";
    const sel = el("select"); const o0 = el("option", null, "New army"); o0.value = "new"; sel.appendChild(o0);
    for (const a of st.roster) { const o = el("option", null, "Reinforce " + a.name); o.value = String(a.id); sel.appendChild(o); }
    sel.value = rc.army;
    const sr = el("div", "war-row"); sr.append(el("label", null, "Send to"), sel);
    const sliders = [];
    const mk = (label, key, min, max, step) => {
      const r = el("div", "war-row"), inp = el("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = rc[key];
      const v = el("span", "war-val", String(rc[key])); sliders.push({ inp, v, key });
      inp.oninput = () => { rc[key] = +inp.value; if (rc.arc + rc.cav > 100) { if (key === "arc") rc.cav = 100 - rc.arc; else rc.arc = 100 - rc.cav; } sync(); };
      r.append(el("label", null, label), inp, v); return r;
    };
    const info = el("div", "war-dim");
    const btn = this._cb("Recruit", () => {
      const res = CP.recruit(st, { armyId: rc.army === "new" ? null : +rc.army, n: rc.n, arcPct: rc.arc, cavPct: rc.cav });
      this.campMsg = res.ok ? `Recruited for ${res.cost} gold.` : res.reason; this._campSave(); this._campRender();
    }, "primary");
    const sync = () => {
      for (const s of sliders) { if (document.activeElement !== s.inp) s.inp.value = rc[s.key]; s.v.textContent = rc[s.key]; }
      const cost = CP.recruitCost(rc.n, rc.arc, rc.cav);
      info.textContent = `Cost ${cost} gold (you have ${st.gold}). Fresh recruits start at 85% morale.`;
      btn.disabled = cost > st.gold || (rc.army === "new" && st.roster.length >= CP.MAX_ROSTER);
    };
    sel.onchange = () => { rc.army = sel.value; sync(); };
    c.append(sr, mk("Troops", "n", CP.MIN_RECRUIT, CP.MAX_RECRUIT, 10), mk("Archers %", "arc", 0, 100, 5), mk("Cavalry %", "cav", 0, 100, 5), info);
    const row = el("div", "war-camp-btnrow"); row.appendChild(btn); c.appendChild(row);
    sync();
    return c;
  }

  // ----- campaign battles -----
  _campAttack(rid) {
    const st = this.camp;
    if (!CP.canAttack(st, rid).ok) return;
    const setup = CP.battleSetup(st, rid);
    const g = createGame({ map: setup.map, difficulty: setup.difficulty, seed: setup.seed, fog: this.fog, aiDeploy: false });
    g.budget[0] = 0; g.budget[1] = setup.enemyBudget; autoDeploy(g, 1);
    const k = setup.armies.length;
    setup.armies.forEach((sa, i) => {
      const comp = normComp(sa.arc, sa.cav);
      for (let tries = 0; tries < 40; tries++) {
        const x = 70 + g.rng() * 200, y = 80 + ((i + 0.5) / k) * 840 + (g.rng() - 0.5) * 40;
        const a = addArmy(g, 0, x, y, sa.n, comp, { zone: true });
        if (a) { a.morale = sa.morale; a.name = sa.name; break; }
      }
    });
    const enemyStart = g.armies.filter((a) => a.team === 1).reduce((s, a) => s + a.n, 0);
    this._skGame = this.game; this.game = g;
    this.campBattle = { rid, setup, enemyStart, name: CP.tName(st, rid), terrainName: CP.TERRAINS[st.regions[rid].terrain].name };
    this.sel.clear(); this.placing = false; this.paused = false; this.terrainKey = ""; this.listSig = ""; this._lastBudget = undefined;
    this.banner.classList.remove("show"); this.pop.classList.remove("show");
    this.toggle.style.display = "none"; this.c1.style.display = "none";
    this._setMode("campaign");
    this._renderPhase(); this._resize();
  }
  _campExitBattle() {
    this.campBattle = null;
    if (this._skGame) this.game = this._skGame; this._skGame = null;
    this.sel.clear(); this.terrainKey = ""; this.listSig = ""; this.paused = false;
    this.banner.classList.remove("show"); this.pop.classList.remove("show");
    this.toggle.style.display = ""; this.c1.style.display = "";
    this._setMode("campaign");
  }
  _campBanner() {
    const g = this.game, cb = this.campBattle, win = g.winner.team === 0, b = this.banner, st = this.camp;
    const surv = g.armies.filter((a) => a.team === 0).reduce((s, a) => s + a.n, 0);
    const en = g.armies.filter((a) => a.team === 1).reduce((s, a) => s + a.n, 0);
    b.innerHTML = "";
    const box = el("div"); box.append(el("h2", null, win ? "Victory" : "Defeat"), el("div", "war-dim", win ? `${cb.name} is yours.` : `The attack on ${cb.name} failed.`));
    const s = el("div"); s.style.margin = "10px 0"; s.style.fontSize = "13px";
    s.innerHTML = `Troops before: ${Math.round(cb.setup.startTotal)}<br>Survivors: ${Math.round(Math.min(surv, cb.setup.startTotal))}`;
    const r = el("div", "war-row"); r.style.justifyContent = "center";
    const go = el("button", "war-btn primary", "Continue");
    go.onclick = () => {
      CP.applyBattle(st, cb.rid, { won: win, survivors: surv, startTotal: cb.setup.startTotal, enemyFrac: cb.enemyStart > 0 ? en / cb.enemyStart : 0 });
      this.campMsg = win ? `Captured ${cb.name}.` : `Repelled at ${cb.name}. The garrison is weakened.`;
      this.campSel = win ? null : cb.rid;
      this._campSave(); this._campExitBattle();
    };
    r.appendChild(go); box.append(s, r); b.appendChild(box); b.classList.add("show");
  }

  // ----- selection / orders -----
  _selArmies() { const g = this.game; return g.armies.filter((a) => this.sel.has(a.id) && a.team === 0); }
  _stance(s) { const g = this.game; if (g.phase !== "battle") return; setStance(g, this._selArmies(), s); }
  _merge() { const g = this.game; const s = this._selArmies(); if (g.phase !== "battle" && g.phase !== "deploy") return; const list = s.length > 1 ? s : g.armies.filter((a) => a.team === 0); if (s.length === 1) { for (const o of list) if (o !== s[0] && dist(o.x, o.y, s[0].x, s[0].y) < (armyRadius(o.n) + armyRadius(s[0].n)) * 0.9) mergeArmies(g, s[0], o); } else mergeOverlapping(g, s); }
  _openSplit() {
    const s = this._selArmies(); if (s.length !== 1 || s[0].n < 10) return;
    this.splitTarget = s[0]; this.splitFrac = 0.5; this._renderSplit();
  }
  _renderSplit() {
    const a = this.splitTarget; if (!a) return;
    const p = this.pop; p.innerHTML = "";
    p.appendChild(el("div", null, `Split ${a.name} (${Math.round(a.n)} troops)`));
    const inp = el("input"); inp.type = "range"; inp.min = 10; inp.max = 90; inp.step = 5; inp.value = Math.round(this.splitFrac * 100);
    inp.style.width = "100%";
    const lab = el("div", "war-dim", "");
    const upd = () => { const f = +inp.value / 100; this.splitFrac = f; lab.textContent = `New army ${Math.round(a.n * f)} / stays ${Math.round(a.n * (1 - f))}`; };
    inp.oninput = upd; upd();
    const r = el("div", "war-row");
    const b1 = el("button", "war-btn", "50/50"); b1.onclick = () => { inp.value = 50; upd(); };
    const b2 = el("button", "war-btn", "1/3 - 2/3"); b2.onclick = () => { inp.value = 33; this.splitFrac = 1 / 3; lab.textContent = `New army ${Math.round(a.n / 3)} / stays ${Math.round(a.n * 2 / 3)}`; };
    const ok = el("button", "war-btn primary", "Split"); ok.onclick = () => { const b = splitArmy(this.game, a, this.splitFrac); if (b) { this.sel.add(b.id); } this.pop.classList.remove("show"); this.splitTarget = null; };
    const no = el("button", "war-btn", "Cancel"); no.onclick = () => { this.pop.classList.remove("show"); this.splitTarget = null; };
    r.append(b1, b2); const r2 = el("div", "war-row"); r2.append(ok, no);
    p.append(inp, lab, r, r2);
    const sc = this._scale();
    p.style.left = clamp(sc.ox + a.x * sc.s + 20, 4, Math.max(4, this.cw - 220)) + "px";
    p.style.top = clamp(sc.oy + a.y * sc.s - 40, 4, Math.max(4, this.ch - 170)) + "px";
    p.classList.add("show");
  }

  _key(e) {
    if (!this.mounted || !this.root.offsetParent) return;
    if (this.mode === "campaign" && !this.campBattle) return;
    const tg = e.target; if (tg && (tg.tagName === "INPUT" || tg.tagName === "SELECT" || tg.tagName === "TEXTAREA")) return;
    const g = this.game; const k = e.key.toLowerCase();
    if (k === "escape") {
      if (this.pop.classList.contains("show")) { this.pop.classList.remove("show"); return; }
      if (this.placing) { this.placing = false; this._renderPhase(); return; }
      const s = this._selArmies();
      if (s.some((a) => a.route.length || a.path.length)) cancelOrders(g, s); else this.sel.clear();
    } else if (k === "s") this._openSplit();
    else if (k === "m") this._merge();
    else if (k === "a") this._stance("advance");
    else if (k === "h") this._stance("hold");
    else if (k === "r") this._stance("retreat");
    else if (k === " ") { if (g.phase === "battle") { this.paused = !this.paused; this._renderPhase(); e.preventDefault(); } }
  }

  // ----- pointer handling -----
  _scale() {
    const s = Math.min(this.cw / WORLD_W, this.ch / WORLD_H);
    return { s, ox: (this.cw - WORLD_W * s) / 2, oy: (this.ch - WORLD_H * s) / 2 };
  }
  _world(e) {
    const r = this.canvas.getBoundingClientRect(), sc = this._scale();
    return { x: clamp((e.clientX - r.left - sc.ox) / sc.s, 0, WORLD_W), y: clamp((e.clientY - r.top - sc.oy) / sc.s, 0, WORLD_H) };
  }
  _pick(p) {
    const g = this.game; let best = null, bd = 1e9;
    for (const a of g.armies) {
      if (a.team !== 0) continue;
      const d = dist(a.x, a.y, p.x, p.y);
      if (d < a.dr + 8 && d < bd) { bd = d; best = a; }
    }
    return best;
  }
  _pickOther(p, ex) {
    let best = null, bd = 1e9;
    for (const a of this.game.armies) {
      if (a.team !== 0 || a === ex) continue;
      const d = dist(a.x, a.y, p.x, p.y);
      if (d < a.dr + 8 && d < bd) { bd = d; best = a; }
    }
    return best;
  }
  // Dragging one of your armies onto another merges them: at once if they
  // already touch, otherwise the dragged army marches over and merges on arrival.
  _mergeInto(a, b) {
    const g = this.game;
    if (!b || a === b || a.team !== b.team) return false;
    if (dist(a.x, a.y, b.x, b.y) < (armyRadius(a.n) + armyRadius(b.n)) * 0.9 && mergeArmies(g, b, a)) { this.sel.clear(); this.sel.add(b.id); return true; }
    if (g.phase !== "battle") return false;
    orderMove(g, [a], [{ x: b.x, y: b.y }], false);
    a.mergeTarget = b; a.mergeRetry = 0;
    return true;
  }
  _pdown(e) {
    if (e.button === 2) return;
    const g = this.game, p = this._world(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pop.classList.remove("show");
    if (g.phase === "over") return;
    if (g.phase === "deploy") {
      if (this.placing) {
        const comp = normComp(this.recruit.arc / 100, this.recruit.cav / 100);
        const a = addArmy(g, 0, p.x, p.y, this.recruit.n, comp, { pay: true, zone: true });
        if (a) { this.sel.clear(); this.sel.add(a.id); } else { this.hintFlash = performance.now(); }
        if (g.budget[0] < armyCost(this.recruit.n, comp)) this.placing = false;
        this._renderPhase(); return;
      }
      const a = this._pick(p);
      if (a) { this.sel.clear(); this.sel.add(a.id); this.ptr = { kind: "drag", a, sx: p.x, sy: p.y }; }
      else this.sel.clear();
      return;
    }
    if (g.phase !== "battle") return;
    const a = this._pick(p);
    if (a) {
      const wasSel = this.sel.has(a.id) && this.sel.size === 1;
      if (e.shiftKey) { if (this.sel.has(a.id)) this.sel.delete(a.id); else this.sel.add(a.id); }
      else if (!this.sel.has(a.id)) { this.sel.clear(); this.sel.add(a.id); }
      this.ptr = { kind: "route", a, pts: [], last: { x: a.x, y: a.y }, wasSel, moved: false, sx: p.x, sy: p.y, shift: e.shiftKey };
      clearTimeout(this.lp);
      if (e.pointerType === "touch" || e.pointerType === "pen") this.lp = setTimeout(() => { if (this.ptr && !this.ptr.moved) { this.ptr.long = true; this.sel.clear(); this.sel.add(a.id); this._openSplit(); } }, 550);
    } else {
      this.ptr = { kind: "box", sx: p.x, sy: p.y, x: p.x, y: p.y, shift: e.shiftKey };
    }
  }
  _pmove(e) {
    const p = this._world(e); this.hover = p;
    const t = this.ptr; if (!t) return;
    if (t.kind === "drag") {
      const a = t.a, nx = a.x + (p.x - t.sx), ny = a.y + (p.y - t.sy);
      if (inZone(0, nx, ny) && !blockedAt(this.game, nx, ny)) { a.x = nx; a.y = ny; }
      t.sx = p.x; t.sy = p.y;
    } else if (t.kind === "route") {
      if (dist(p.x, p.y, t.sx, t.sy) > 14) { t.moved = true; clearTimeout(this.lp); }
      t.mergeHover = t.moved ? this._pickOther(p, t.a) : null;
      if (t.moved && dist(p.x, p.y, t.last.x, t.last.y) > 45) { t.pts.push({ x: p.x, y: p.y }); t.last = { x: p.x, y: p.y }; }
      t.cur = p;
    } else if (t.kind === "box") { t.x = p.x; t.y = p.y; }
  }
  _pup(e) {
    clearTimeout(this.lp);
    const t = this.ptr; this.ptr = null; if (!t) return;
    const g = this.game, p = this._world(e);
    if (t.kind === "drag") {
      const o = this._pickOther({ x: t.a.x, y: t.a.y }, t.a);
      if (o && dist(o.x, o.y, t.a.x, t.a.y) < (armyRadius(o.n) + armyRadius(t.a.n)) * 0.9 && mergeArmies(g, o, t.a)) { this.sel.clear(); this.sel.add(o.id); }
      return;
    }
    if (t.kind === "route") {
      if (t.long) return;
      const target = t.moved ? this._pickOther(p, t.a) : null;
      if (target && this._mergeInto(t.a, target)) return;
      if (t.moved) {
        const pts = t.pts.slice(); if (!pts.length || dist(pts[pts.length - 1].x, pts[pts.length - 1].y, p.x, p.y) > 12) pts.push({ x: p.x, y: p.y });
        orderMove(g, this._selArmies(), pts, t.shift || e.shiftKey);
      } else if (t.wasSel && !t.shift) this._openSplit();
    } else if (t.kind === "box") {
      const moved = dist(t.sx, t.sy, p.x, p.y) > 12;
      if (moved) {
        const x0 = Math.min(t.sx, p.x), x1 = Math.max(t.sx, p.x), y0 = Math.min(t.sy, p.y), y1 = Math.max(t.sy, p.y);
        if (!t.shift) this.sel.clear();
        for (const a of g.armies) if (a.team === 0 && a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1) this.sel.add(a.id);
      } else if (g.phase === "battle") {
        const s = this._selArmies();
        if (s.length) orderMove(g, s, [p], t.shift || e.shiftKey);
      }
    }
  }

  // ----- frame -----
  _resize() {
    const r = this.stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.cw = Math.max(50, r.width); this.ch = Math.max(50, r.height); this.dpr = dpr;
    this.canvas.width = Math.round(this.cw * dpr); this.canvas.height = Math.round(this.ch * dpr);
  }

  _frame(dt, now) {
    const g = this.game;
    if (!g) return;
    if (this.mode === "campaign" && !this.campBattle) return;
    if (g.phase === "battle" && !this.paused) {
      this.acc += dt * this.simSpeed;
      let n = 0;
      while (this.acc >= SIM_DT && n < 16) { stepGame(g, SIM_DT); this.acc -= SIM_DT; n++; if (g.phase !== "battle") break; }
      if (n >= 16) this.acc = 0;
    }
    if (g.phase === "battle") for (const a of g.armies) {
      const b = a.mergeTarget; if (!b) continue;
      if (!g.armies.includes(b) || a.team !== b.team) { a.mergeTarget = null; continue; }
      if (dist(a.x, a.y, b.x, b.y) < (armyRadius(a.n) + armyRadius(b.n)) * 0.9) {
        a.mergeTarget = null;
        if (mergeArmies(g, b, a)) { if (this.sel.has(a.id)) { this.sel.delete(a.id); this.sel.add(b.id); } }
        break;
      }
      a.mergeRetry = (a.mergeRetry || 0) + dt;
      if (a.mergeRetry > 0.6 && !a.engaged) { a.mergeRetry = 0; orderMove(g, [a], [{ x: b.x, y: b.y }], false); a.mergeTarget = b; }
    }
    for (const id of [...this.sel]) if (!g.armies.some((a) => a.id === id)) this.sel.delete(id);
    if (g.phase === "over" && !this.banner.classList.contains("show")) this._showBanner();
    this._render(now / 1000);
    this._updateHud(now);
  }

  _showBanner() {
    if (this.campBattle) return this._campBanner();
    const g = this.game, win = g.winner.team === 0, b = this.banner;
    b.innerHTML = "";
    const box = el("div"); box.append(el("h2", null, win ? "Victory" : "Defeat"), el("div", "war-dim", g.winReason));
    const m = Math.floor(g.t / 60), s = Math.floor(g.t % 60);
    const st = el("div"); st.style.margin = "10px 0"; st.style.fontSize = "13px";
    st.innerHTML = `Time ${m}:${String(s).padStart(2, "0")}<br>Your troops lost: ${Math.round(g.stats.lost[0])}<br>Enemies destroyed: ${Math.round(g.stats.killed[0])}`;
    const r = el("div", "war-row"); r.style.justifyContent = "center";
    const again = el("button", "war-btn primary", "Play again"); again.onclick = () => this._newGame(this.mapId, false, g.seed);
    const nm = el("button", "war-btn", "New map"); nm.onclick = () => this._newGame("random");
    r.append(again, nm); box.append(st, r); b.appendChild(box); b.classList.add("show");
  }

  _updateHud(now) {
    const g = this.game;
    if (now - (this._hudT || 0) < 200) return; this._hudT = now;
    const m = Math.floor(g.t / 60), s = Math.floor(g.t % 60);
    let held = 0; for (const p of g.points) if (p.owner === 0) held++;
    const chips = [g.phase === "deploy" ? "Deployment" : this.paused ? "Paused" : "Battle", `${m}:${String(s).padStart(2, "0")}`, `Points held ${held}/${g.points.length}`, `Reserve ${Math.round(g.phase === "deploy" ? g.budget[0] : g.reserve[0])}`];
    this.hud.innerHTML = ""; for (const c of chips) this.hud.appendChild(el("span", "war-chip", c));
    if (this.statusLine) this.statusLine.textContent = `Your HQ ${Math.round(g.hqs[0].hp / g.hqs[0].max * 100)}%  |  Enemy HQ ${Math.round(g.hqs[1].hp / g.hqs[1].max * 100)}%`;
    const mine = g.armies.filter((a) => a.team === 0);
    const sel = this._selArmies();
    const battle = g.phase === "battle";
    for (const k of Object.keys(this.stBtns)) { this.stBtns[k].disabled = !battle || !sel.length; this.stBtns[k].classList.toggle("on", sel.length > 0 && sel.every((a) => a.stance === k)); }
    this.splitBtn.disabled = !battle || sel.length !== 1 || sel[0].n < 10;
    this.mergeBtn.disabled = !battle || !mine.length;
    this.cancelBtn.disabled = !battle || !sel.length;
    this.selInfo.textContent = sel.length ? sel.map((a) => `${a.name}: ${Math.round(a.n)} troops`).join(", ") : "No army selected.";
    const rows = mine.map((a) => {
      const ord = a.routed ? "Routed" : a.engaged ? "Fighting" : a.stance === "retreat" ? "Retreating" : a.route.length ? `Moving (${a.route.length})` : a.stance === "hold" ? "Holding" : a.chasing ? "Attacking" : "Ready";
      return { a, ord };
    });
    const sig = rows.map((r) => `${r.a.id}|${Math.round(r.a.n)}|${Math.round(r.a.morale / 5)}|${r.ord}|${this.sel.has(r.a.id)}|${g.phase}`).join(";");
    if (sig !== this.listSig) {
      this.listSig = sig; this.listBox.innerHTML = "";
      for (const { a, ord } of rows) {
        const row = el("div", "war-arow" + (this.sel.has(a.id) ? " sel" : ""));
        const dot = el("span", "war-dot"); dot.style.background = TEAMS[0].color;
        const nm = el("span", null, a.name);
        const mid = el("div"); mid.append(el("span", null, `${Math.round(a.n)} troops`));
        const bar = el("div", "war-mini"), bi = el("i"); bi.style.width = a.morale + "%"; bi.style.background = a.morale > 50 ? "#22c55e" : a.morale > 25 ? "#eab308" : "var(--danger)"; bar.appendChild(bi); mid.appendChild(bar);
        const right = el("span", "war-dim", ord);
        row.append(dot, nm, mid, right);
        row.onclick = (e) => { if (e.shiftKey) { if (this.sel.has(a.id)) this.sel.delete(a.id); else this.sel.add(a.id); } else { this.sel.clear(); this.sel.add(a.id); } this.listSig = ""; };
        if (g.phase === "deploy") { const x = el("button", "war-btn", "x"); x.title = "Disband"; x.onclick = (ev) => { ev.stopPropagation(); removeArmyRefund(g, a); this._renderPhase(); }; row.appendChild(x); row.style.gridTemplateColumns = "12px 34px 1fr auto auto"; }
        this.listBox.appendChild(row);
      }
      if (!rows.length) this.listBox.appendChild(el("div", "war-dim", "No armies."));
    }
    // deployment: refresh recruit readout as budget changes
    if (g.phase === "deploy" && this._lastBudget !== Math.round(g.budget[0])) { this._lastBudget = Math.round(g.budget[0]); this._renderPhase(); }
  }

  // ----- rendering -----
  _terrainImage() {
    const g = this.game, key = g.seed + g.mapId;
    if (this.terrainKey === key && this.terrainImg) return this.terrainImg;
    const cv = document.createElement("canvas"); cv.width = WORLD_W / 2; cv.height = WORLD_H / 2;
    const c = cv.getContext("2d"); c.scale(0.5, 0.5);
    const rng = mulberry32(g.seed + 7);
    const cs = getComputedStyle(this.root);
    void cs;
    c.fillStyle = "#6f8f52"; c.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let i = 0; i < 1400; i++) { c.fillStyle = rng() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.04)"; c.fillRect(rng() * WORLD_W, rng() * WORLD_H, 30 + rng() * 60, 20 + rng() * 40); }
    const T = g.terrain;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const t = T[ci(x, y)], px = x * CELL, py = y * CELL;
      if (t === T_WATER) { c.fillStyle = "#3d6fa8"; c.fillRect(px, py, CELL + 1, CELL + 1); }
      else if (t === T_FORD) { c.fillStyle = "#6c9bb8"; c.fillRect(px, py, CELL + 1, CELL + 1); c.fillStyle = "rgba(220,205,150,0.55)"; c.fillRect(px + 2, py + 5, CELL - 4, 3); c.fillRect(px + 4, py + 16, CELL - 8, 3); }
      else if (t === T_BRIDGE) { c.fillStyle = "#3d6fa8"; c.fillRect(px, py, CELL + 1, CELL + 1); c.fillStyle = "#8b6a3e"; c.fillRect(px, py + 2, CELL + 1, CELL - 4); c.fillStyle = "rgba(0,0,0,0.25)"; for (let k = 0; k < 4; k++) c.fillRect(px + k * 6, py + 2, 1, CELL - 4); }
      else if (t === T_HILL) { c.fillStyle = "#a59a62"; c.fillRect(px, py, CELL + 1, CELL + 1); }
    }
    // hill contour hint
    c.strokeStyle = "rgba(90,75,40,0.4)"; c.lineWidth = 1.2;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (T[ci(x, y)] === T_HILL) {
      const nb = (dx, dy) => { const xx = x + dx, yy = y + dy; return xx < 0 || yy < 0 || xx >= GW || yy >= GH ? 0 : T[ci(xx, yy)] === T_HILL; };
      if (!nb(-1, 0)) { c.beginPath(); c.moveTo(x * CELL, y * CELL); c.lineTo(x * CELL, (y + 1) * CELL); c.stroke(); }
      if (!nb(1, 0)) { c.beginPath(); c.moveTo((x + 1) * CELL, y * CELL); c.lineTo((x + 1) * CELL, (y + 1) * CELL); c.stroke(); }
      if (!nb(0, -1)) { c.beginPath(); c.moveTo(x * CELL, y * CELL); c.lineTo((x + 1) * CELL, y * CELL); c.stroke(); }
      if (!nb(0, 1)) { c.beginPath(); c.moveTo(x * CELL, (y + 1) * CELL); c.lineTo((x + 1) * CELL, (y + 1) * CELL); c.stroke(); }
    }
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const t = T[ci(x, y)], px = x * CELL, py = y * CELL;
      if (t === T_FOREST) {
        c.fillStyle = "#3f6b3a"; c.fillRect(px, py, CELL + 1, CELL + 1);
        for (let k = 0; k < 3; k++) { const tx = px + rng() * CELL, ty = py + rng() * CELL, r = 6 + rng() * 5; c.fillStyle = rng() < 0.5 ? "#2f5a2e" : "#3a6c37"; c.beginPath(); c.arc(tx, ty, r, 0, 6.283); c.fill(); }
      } else if (t === T_ROCK) {
        c.fillStyle = "#6b6e73"; c.beginPath(); c.moveTo(px - 1, py + 6); c.lineTo(px + 8, py - 2); c.lineTo(px + CELL + 1, py + 4); c.lineTo(px + CELL + 2, py + CELL - 6); c.lineTo(px + 14, py + CELL + 2); c.lineTo(px - 2, py + CELL - 3); c.closePath(); c.fill();
        c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(px + 4, py + 4, 8, 5);
        c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 1; c.stroke();
      }
    }
    this.terrainImg = cv; this.terrainKey = key; return cv;
  }

  _blobPath(c, a, t) {
    const r = a.dr, N = 30;
    const sp = Math.hypot(a.vx, a.vy), st = 1 + Math.min(0.12, sp / 500), ang = Math.atan2(a.vy, a.vx);
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * 6.283;
      let rr = r * (1 + 0.045 * Math.sin(th * 3 + t * 2 + a.id) + 0.03 * Math.sin(th * 5 - t * 2.7 + a.id * 2) + (a.engaged ? 0.03 * Math.sin(th * 7 + t * 9) : 0));
      const k = 1 + (st - 1) * Math.cos(th - ang);
      rr *= k;
      const px = a.x + Math.cos(th) * rr, py = a.y + Math.sin(th) * rr;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
  }

  _render(t) {
    const g = this.game, c = this.ctx2, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.cw, this.ch);
    const sc = this._scale();
    c.save(); c.translate(sc.ox, sc.oy); c.scale(sc.s, sc.s);
    c.drawImage(this._terrainImage(), 0, 0, WORLD_W, WORLD_H);
    const css = getComputedStyle(this.root);
    void css;
    // deployment zones
    if (g.phase === "deploy") {
      c.fillStyle = "rgba(59,130,246,0.14)"; c.fillRect(40, 50, 260, WORLD_H - 100);
      c.strokeStyle = "rgba(59,130,246,0.7)"; c.setLineDash([10, 8]); c.lineWidth = 2; c.strokeRect(40, 50, 260, WORLD_H - 100); c.setLineDash([]);
      c.fillStyle = "rgba(239,68,68,0.10)"; c.fillRect(WORLD_W - 300, 50, 260, WORLD_H - 100);
    }
    // control points
    for (const p of g.points) {
      c.beginPath(); c.arc(p.x, p.y, 55, 0, 6.283);
      c.fillStyle = p.owner === -1 ? "rgba(255,255,255,0.10)" : p.owner === 0 ? "rgba(59,130,246,0.18)" : "rgba(239,68,68,0.18)"; c.fill();
      c.strokeStyle = p.owner === -1 ? "rgba(255,255,255,0.6)" : TEAMS[p.owner].color; c.lineWidth = 2.5; c.setLineDash([6, 6]); c.stroke(); c.setLineDash([]);
      c.fillStyle = p.owner === -1 ? "#ddd" : TEAMS[p.owner].color; c.fillRect(p.x - 2, p.y - 20, 3, 26); c.beginPath(); c.moveTo(p.x + 1, p.y - 20); c.lineTo(p.x + 17, p.y - 14); c.lineTo(p.x + 1, p.y - 8); c.fill();
      if (p.owner === -1 && p.prog !== 0 || Math.abs(p.prog) < 1 && p.owner !== -1) { c.strokeStyle = p.prog < 0 ? TEAMS[0].color : TEAMS[1].color; c.lineWidth = 4; c.beginPath(); c.arc(p.x, p.y, 62, -1.57, -1.57 + Math.abs(p.prog) * 6.283); c.stroke(); }
    }
    // HQs
    for (const h of g.hqs) {
      if (h.hp <= 0) continue;
      const col = TEAMS[h.team].color;
      c.fillStyle = "#33373d"; c.fillRect(h.x - 26, h.y - 26, 52, 52);
      c.fillStyle = col; c.fillRect(h.x - 20, h.y - 20, 40, 40);
      c.fillStyle = "rgba(255,255,255,0.85)"; c.fillRect(h.x - 3, h.y - 30, 3, 30); c.beginPath(); c.moveTo(h.x, h.y - 30); c.lineTo(h.x + 18, h.y - 24); c.lineTo(h.x, h.y - 18); c.fill();
      c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(h.x - 30, h.y + 32, 60, 6); c.fillStyle = col; c.fillRect(h.x - 30, h.y + 32, 60 * (h.hp / h.max), 6);
    }
    // planned routes
    const sel = this._selArmies();
    c.lineWidth = 3; c.setLineDash([2, 9]); c.lineCap = "round";
    for (const a of sel) {
      const pts = [{ x: a.x, y: a.y }, ...a.path];
      if (a.route.length) { const start = a.legActive || a.path.length ? 1 : 0; for (let i = start; i < a.route.length; i++) pts.push(a.route[i]); }
      if (pts.length < 2) continue;
      c.strokeStyle = "rgba(255,255,255,0.95)"; c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y); c.stroke();
      const e = pts[pts.length - 1], p = pts[pts.length - 2], ang = Math.atan2(e.y - p.y, e.x - p.x);
      c.setLineDash([]); c.fillStyle = "#fff"; c.beginPath(); c.moveTo(e.x + Math.cos(ang) * 12, e.y + Math.sin(ang) * 12); c.lineTo(e.x + Math.cos(ang + 2.5) * 11, e.y + Math.sin(ang + 2.5) * 11); c.lineTo(e.x + Math.cos(ang - 2.5) * 11, e.y + Math.sin(ang - 2.5) * 11); c.fill(); c.setLineDash([2, 9]);
    }
    if (this.ptr && this.ptr.kind === "route" && this.ptr.mergeHover) {
      const h = this.ptr.mergeHover; c.setLineDash([]); c.lineWidth = 4; c.strokeStyle = "#7CFC9A"; c.beginPath(); c.arc(h.x, h.y, h.dr + 10, 0, 6.283); c.stroke(); c.setLineDash([2, 9]);
    }
    // route being drawn
    if (this.ptr && this.ptr.kind === "route" && this.ptr.moved) {
      const tt = this.ptr, pts = [{ x: tt.a.x, y: tt.a.y }, ...tt.pts]; if (tt.cur) pts.push(tt.cur);
      c.strokeStyle = "rgba(255,230,120,0.95)"; c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y); c.stroke();
    }
    c.setLineDash([]);
    // fog visibility
    const vis = (a) => visibleTo(g, 0, a);
    // blobs per team: outline pass then fill pass so allies merge into one shape
    for (const team of [1, 0]) {
      const list = g.armies.filter((a) => a.team === team && vis(a));
      if (!list.length) continue;
      const col = TEAMS[team].color;
      c.beginPath(); for (const a of list) this._blobPath(c, a, t);
      c.lineWidth = 5; c.strokeStyle = "rgba(0,0,0,0.55)"; c.lineJoin = "round"; c.stroke();
      c.fillStyle = col; c.globalAlpha = 0.9; c.fill("nonzero"); c.globalAlpha = 1;
      for (const a of list) {
        const gr = c.createRadialGradient(a.x - a.dr * 0.3, a.y - a.dr * 0.3, a.dr * 0.1, a.x, a.y, a.dr);
        gr.addColorStop(0, "rgba(255,255,255,0.28)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = gr; c.beginPath(); c.arc(a.x, a.y, a.dr, 0, 6.283); c.fill();
        if (a.routed) { c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.arc(a.x, a.y, a.dr, 0, 6.283); c.fill(); }
      }
    }
    // contact sparks
    if (g.phase === "battle") for (const ct of g.contacts) {
      for (let k = 0; k < 2; k++) { const a = Math.random() * 6.283, r = Math.random() * 14; c.fillStyle = Math.random() < 0.5 ? "#fff3b0" : "#ffb347"; c.beginPath(); c.arc(ct.x + Math.cos(a) * r, ct.y + Math.sin(a) * r, 1.5 + Math.random() * 2, 0, 6.283); c.fill(); }
    }
    // labels, bars
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const a of g.armies) {
      if (!vis(a)) continue;
      const isSel = this.sel.has(a.id);
      if (isSel) { c.strokeStyle = "#fff"; c.lineWidth = 2.5; c.setLineDash([7, 5]); c.lineDashOffset = -t * 12; c.beginPath(); c.arc(a.x, a.y, a.dr + 7, 0, 6.283); c.stroke(); c.setLineDash([]); }
      c.font = `700 ${Math.round(clamp(a.dr * 0.55, 12, 26))}px system-ui,sans-serif`;
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.6)"; c.fillStyle = "#fff";
      const txt = String(Math.ceil(a.n)); c.strokeText(txt, a.x, a.y); c.fillText(txt, a.x, a.y);
      const bw = Math.max(30, a.dr * 1.4), bx = a.x - bw / 2, by = a.y - a.dr - 13;
      c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(bx - 1, by - 1, bw + 2, 8);
      const hf = clamp(a.n / a.n0, 0, 1); c.fillStyle = hf > 0.5 ? "#4ade80" : hf > 0.25 ? "#facc15" : "#f87171"; c.fillRect(bx, by, bw * hf, 3);
      c.fillStyle = "#93c5fd"; c.fillRect(bx, by + 4, bw * clamp(a.morale / 100, 0, 1), 2);
      // composition strip
      const sy = a.y + a.dr * 0.45, sw = Math.max(20, a.dr), sx = a.x - sw / 2;
      c.fillStyle = "rgba(255,255,255,0.85)"; c.fillRect(sx, sy, sw * a.inf, 3);
      c.fillStyle = "#fde047"; c.fillRect(sx + sw * a.inf, sy, sw * a.arc, 3);
      c.fillStyle = "#c084fc"; c.fillRect(sx + sw * (a.inf + a.arc), sy, sw * a.cav, 3);
    }
    // placement ghost
    if (g.phase === "deploy" && this.placing && this.hover) {
      const r = armyRadius(this.recruit.n), ok = inZone(0, this.hover.x, this.hover.y) && !blockedAt(g, this.hover.x, this.hover.y);
      c.beginPath(); c.arc(this.hover.x, this.hover.y, r, 0, 6.283); c.fillStyle = ok ? "rgba(59,130,246,0.45)" : "rgba(239,68,68,0.45)"; c.fill();
    }
    // box select
    if (this.ptr && this.ptr.kind === "box") {
      const b = this.ptr; c.strokeStyle = "rgba(255,255,255,0.9)"; c.fillStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 1.5;
      c.fillRect(b.sx, b.sy, b.x - b.sx, b.y - b.sy); c.strokeRect(b.sx, b.sy, b.x - b.sx, b.y - b.sy);
    }
    c.restore();
    // fog overlay
    if (g.fog && g.phase !== "deploy") {
      const fc = this.fogCanvas, fw = Math.ceil(this.cw / 4), fh = Math.ceil(this.ch / 4);
      if (fc.width !== fw || fc.height !== fh) { fc.width = fw; fc.height = fh; }
      const f = fc.getContext("2d");
      f.globalCompositeOperation = "source-over"; f.clearRect(0, 0, fw, fh); f.fillStyle = "rgba(10,14,22,0.62)"; f.fillRect(0, 0, fw, fh);
      f.globalCompositeOperation = "destination-out";
      const hole = (x, y, r) => { const gr = f.createRadialGradient(x, y, r * 0.6, x, y, r); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)"); f.fillStyle = gr; f.beginPath(); f.arc(x, y, r, 0, 6.283); f.fill(); };
      const k = sc.s / 4;
      for (const a of g.armies) if (a.team === 0) hole((sc.ox + a.x * sc.s) / 4, (sc.oy + a.y * sc.s) / 4, 300 * k);
      hole((sc.ox + g.hqs[0].x * sc.s) / 4, (sc.oy + g.hqs[0].y * sc.s) / 4, 320 * k);
      c.drawImage(fc, 0, 0, this.cw, this.ch);
    }
  }
}
