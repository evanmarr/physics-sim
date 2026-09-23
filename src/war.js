// War Simulator: a real-time, top-down agent-based battlefield. Units are
// individual agents (nearest-enemy seeking, separation, ranged projectiles,
// artillery splash, cavalry charge, terrain effects) using a spatial hash.
// The simulation core (createSim / stepSim) is DOM-free so it can be tested
// under node; WarMode is the UI wrapper around it.

export const WORLD_W = 1600;
export const WORLD_H = 1000;
const CELL = 20; // terrain cell (world units)
const GW = WORLD_W / CELL;
const GH = WORLD_H / CELL;
const HCELL = 40; // spatial hash cell
const HW = Math.ceil(WORLD_W / HCELL);
const HH = Math.ceil(WORLD_H / HCELL);
const MAX_UNITS = 1500;
const SIM_DT = 1 / 30;

export const TEAMS = [
  { name: "Blue", color: "#3b82f6" },
  { name: "Red", color: "#ef4444" },
  { name: "Green", color: "#22c55e" },
  { name: "Gold", color: "#eab308" },
];

// ranged: "arrow" | "shell" | "bolt" | null. speed = units/sec, cd = seconds.
export const UNIT_TYPES = {
  inf: { name: "Infantry", hp: 100, dmg: 12, range: 14, speed: 34, cd: 0.8, cost: 10, squad: 10, r: 4.5, ranged: null, shape: "circle" },
  arc: { name: "Archers", hp: 55, dmg: 9, range: 150, speed: 32, cd: 1.2, cost: 14, squad: 8, r: 4, ranged: "arrow", shape: "small" },
  cav: { name: "Cavalry", hp: 130, dmg: 14, range: 16, speed: 85, cd: 0.9, cost: 25, squad: 6, r: 6, ranged: null, charge: 2.6, shape: "diamond" },
  tank: { name: "Heavy / Tank", hp: 500, dmg: 30, range: 120, speed: 22, cd: 1.6, cost: 80, squad: 3, r: 9, ranged: "bolt", shape: "square" },
  art: { name: "Artillery", hp: 70, dmg: 48, range: 340, speed: 14, cd: 4, cost: 60, squad: 3, r: 6, ranged: "shell", splash: 48, shape: "triangle" },
};
const TYPE_IDS = Object.keys(UNIT_TYPES);

export const T_GRASS = 0, T_FOREST = 1, T_HILL = 2, T_WATER = 3;

export function createSim() {
  return {
    units: [], squads: [], projs: [], fx: [],
    terrain: new Uint8Array(GW * GH),
    head: new Int32Array(HW * HH), next: new Int32Array(0),
    time: 0, nextSquadId: 1,
    stats: { kills: [0, 0, 0, 0], losses: [0, 0, 0, 0], alive: [0, 0, 0, 0] },
    hist: [[], [], [], []], histDt: 0.5, histT: 0,
    started: false, winner: null, activeTeams: [],
  };
}

export function cellAt(S, x, y) {
  const cx = Math.min(GW - 1, Math.max(0, (x / CELL) | 0));
  const cy = Math.min(GH - 1, Math.max(0, (y / CELL) | 0));
  return S.terrain[cy * GW + cx];
}

export function paintCircle(S, x, y, rad, type) {
  const x0 = Math.max(0, Math.floor((x - rad) / CELL)), x1 = Math.min(GW - 1, Math.floor((x + rad) / CELL));
  const y0 = Math.max(0, Math.floor((y - rad) / CELL)), y1 = Math.min(GH - 1, Math.floor((y + rad) / CELL));
  let changed = false;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const px = (cx + 0.5) * CELL - x, py = (cy + 0.5) * CELL - y;
      if (px * px + py * py <= rad * rad && S.terrain[cy * GW + cx] !== type) { S.terrain[cy * GW + cx] = type; changed = true; }
    }
  }
  return changed;
}

export function spawnSquad(S, team, type, x, y, opts = {}) {
  const T = UNIT_TYPES[type];
  const n = T.squad;
  if (S.units.length + n > MAX_UNITS) return null;
  const sq = {
    id: opts.id || S.nextSquadId++, team, type, x, y, cx: x, cy: y, n, cost: n * T.cost,
    stance: opts.stance || "advance", order: !!opts.order, tx: opts.tx || 0, ty: opts.ty || 0, oid: 1, alive: n,
  };
  if (sq.id >= S.nextSquadId) S.nextSquadId = sq.id + 1;
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  const sp = T.r * 2.6;
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = (i / cols) | 0;
    const ox = (c - (cols - 1) / 2) * sp, oy = (r - (rows - 1) / 2) * sp;
    S.units.push({
      x: x + ox, y: y + oy, ox, oy, hp: T.hp, team, type, t: T, sq, cd: Math.random() * T.cd,
      rt: Math.random() * 0.3, tgt: null, charge: !!T.charge, oid: 0, arrived: true,
      dx: 0, dy: 0, sx: 0, sy: 0,
    });
  }
  S.squads.push(sq);
  return sq;
}

export function removeSquad(S, sq) {
  S.squads = S.squads.filter((s) => s !== sq);
  S.units = S.units.filter((u) => u.sq !== sq);
}

export function moveSquad(S, sq, x, y) {
  const dx = x - sq.x, dy = y - sq.y;
  sq.x = x; sq.y = y; sq.cx = x; sq.cy = y;
  for (const u of S.units) if (u.sq === sq) { u.x += dx; u.y += dy; }
}

export function orderSquad(sq, x, y) { sq.order = true; sq.tx = x; sq.ty = y; sq.oid++; }
export function clearOrder(sq) { sq.order = false; sq.oid++; }

function hit(S, tgt, dmg, attackerTeam) {
  if (tgt.hp <= 0) return;
  tgt.hp -= dmg;
  if (tgt.hp <= 0) {
    S.stats.kills[attackerTeam]++;
    S.stats.losses[tgt.team]++;
  }
}

function buildHash(S) {
  const U = S.units;
  if (S.next.length < U.length) S.next = new Int32Array(Math.max(U.length, 256) * 2);
  S.head.fill(-1);
  for (let i = 0; i < U.length; i++) {
    const u = U[i];
    const c = Math.min(HH - 1, Math.max(0, (u.y / HCELL) | 0)) * HW + Math.min(HW - 1, Math.max(0, (u.x / HCELL) | 0));
    S.next[i] = S.head[c];
    S.head[c] = i;
  }
}

function findNearestEnemy(S, u, R) {
  const cx = Math.min(HW - 1, Math.max(0, (u.x / HCELL) | 0));
  const cy = Math.min(HH - 1, Math.max(0, (u.y / HCELL) | 0));
  let best = null, bd = Infinity;
  for (let r = 0; r <= R; r++) {
    for (let gy = cy - r; gy <= cy + r; gy++) {
      if (gy < 0 || gy >= HH) continue;
      const edgeRow = gy === cy - r || gy === cy + r;
      for (let gx = cx - r; gx <= cx + r; gx += edgeRow ? 1 : Math.max(1, 2 * r)) {
        if (gx < 0 || gx >= HW) continue;
        for (let i = S.head[gy * HW + gx]; i !== -1; i = S.next[i]) {
          const v = S.units[i];
          if (v.team === u.team || v.hp <= 0) continue;
          const d = (v.x - u.x) * (v.x - u.x) + (v.y - u.y) * (v.y - u.y);
          if (d < bd) { bd = d; best = v; }
        }
      }
    }
    if (best && Math.sqrt(bd) <= r * HCELL) break;
  }
  return best;
}

function canStand(S, x, y, fromWater) {
  return fromWater || cellAt(S, x, y) !== T_WATER;
}

export function stepSim(S, dt) {
  if (S.winner) return;
  S.time += dt;
  // compact dead
  let w = 0;
  for (let i = 0; i < S.units.length; i++) if (S.units[i].hp > 0) S.units[w++] = S.units[i];
  S.units.length = w;
  const U = S.units;
  buildHash(S);

  // squad centroids
  for (const sq of S.squads) { sq.sx = 0; sq.sy = 0; sq.alive = 0; }
  for (const u of U) { u.sq.sx += u.x; u.sq.sy += u.y; u.sq.alive++; }
  for (const sq of S.squads) if (sq.alive) { sq.cx = sq.sx / sq.alive; sq.cy = sq.sy / sq.alive; }
  S.squads = S.squads.filter((s) => s.alive > 0);
  const squads = S.squads;

  // decide: target, attack, desired movement
  for (let i = 0; i < U.length; i++) {
    const u = U[i], T = u.t, sq = u.sq;
    u.sx = 0; u.sy = 0; u.dx = 0; u.dy = 0;
    u.cd -= dt; u.rt -= dt;
    const onHill = cellAt(S, u.x, u.y) === T_HILL;
    const rng = T.range * (T.ranged && onHill ? 1.25 : 1);
    if (!u.tgt || u.tgt.hp <= 0 || u.rt <= 0) {
      const R = Math.min(10, Math.max(4, Math.ceil(rng / HCELL) + 1));
      u.tgt = findNearestEnemy(S, u, R);
      u.rt = 0.3 + Math.random() * 0.3;
    }
    let d = Infinity, tx = 0, ty = 0;
    if (u.tgt) {
      tx = u.tgt.x - u.x; ty = u.tgt.y - u.y; d = Math.hypot(tx, ty);
    }
    const reach = rng + T.r + (u.tgt ? u.tgt.t.r : 0);
    const inRange = u.tgt && d <= reach;
    // attack
    if (inRange && u.cd <= 0) {
      u.cd = T.cd * (0.9 + Math.random() * 0.2);
      if (T.ranged) {
        if (S.projs.length < 700) {
          const sp = T.ranged === "shell" ? 260 : T.ranged === "bolt" ? 480 : 340;
          S.projs.push({ x: u.x, y: u.y, tx: u.tgt.x, ty: u.tgt.y, sp, dmg: T.dmg, splash: T.splash || 0, team: u.team, tgt: u.tgt, kind: T.ranged });
        }
      } else {
        let dmg = T.dmg;
        if (u.charge) { dmg *= T.charge; u.charge = false; S.fx.push({ x: u.tgt.x, y: u.tgt.y, r: 12, t: 0.25, life: 0.25 }); }
        hit(S, u.tgt, dmg, u.team);
      }
    }
    // orders / movement
    if (u.oid !== sq.oid) { u.oid = sq.oid; u.arrived = !sq.order; }
    let mx = 0, my = 0, marching = false;
    if (sq.order && !u.arrived) {
      const gx = sq.tx + u.ox - u.x, gy = sq.ty + u.oy - u.y, gd = Math.hypot(gx, gy);
      if (gd < 6) u.arrived = true;
      else if (!(inRange && !T.ranged)) { mx = gx / gd; my = gy / gd; marching = true; }
    }
    if (!marching && sq.stance !== "hold") {
      if (u.tgt) {
        if (d > rng * 0.9 + T.r && d > 0) { mx = tx / d; my = ty / d; }
      } else {
        let bd = Infinity, bx = 0, by = 0;
        for (const s of squads) {
          if (s.team === u.team) continue;
          const dd = (s.cx - u.x) * (s.cx - u.x) + (s.cy - u.y) * (s.cy - u.y);
          if (dd < bd) { bd = dd; bx = s.cx - u.x; by = s.cy - u.y; }
        }
        if (bd < Infinity && bd > 1) { const dl = Math.sqrt(bd); mx = bx / dl; my = by / dl; }
      }
    }
    if (mx || my) {
      const c = cellAt(S, u.x, u.y);
      const mult = c === T_FOREST ? 0.6 : c === T_HILL ? 0.85 : 1;
      let sp = T.speed * mult;
      if (marching && u.tgt && u.tgt.hp > 0 && sq.type === "cav") sp *= 1;
      u.dx = mx * sp; u.dy = my * sp;
    }
  }

  // separation
  for (let i = 0; i < U.length; i++) {
    const u = U[i];
    const cx = Math.min(HW - 1, Math.max(0, (u.x / HCELL) | 0));
    const cy = Math.min(HH - 1, Math.max(0, (u.y / HCELL) | 0));
    for (let gy = Math.max(0, cy - 1); gy <= Math.min(HH - 1, cy + 1); gy++) {
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(HW - 1, cx + 1); gx++) {
        for (let j = S.head[gy * HW + gx]; j !== -1; j = S.next[j]) {
          if (j === i) continue;
          const v = U[j];
          const rx = u.x - v.x, ry = u.y - v.y;
          const min = (u.t.r + v.t.r) * 1.05;
          const d2 = rx * rx + ry * ry;
          if (d2 < min * min) {
            const d = Math.sqrt(d2) || 0.01;
            const push = (min - d) / min * 60;
            if (d < 0.02) { u.sx += (Math.random() - 0.5) * 10; u.sy += (Math.random() - 0.5) * 10; }
            else { u.sx += rx / d * push; u.sy += ry / d * push; }
          }
        }
      }
    }
  }

  // integrate
  for (let i = 0; i < U.length; i++) {
    const u = U[i];
    const vx = u.dx + u.sx, vy = u.dy + u.sy;
    if (!vx && !vy) continue;
    const fromWater = cellAt(S, u.x, u.y) === T_WATER;
    let nx = Math.min(WORLD_W - 5, Math.max(5, u.x + vx * dt));
    let ny = Math.min(WORLD_H - 5, Math.max(5, u.y + vy * dt));
    if (canStand(S, nx, ny, fromWater)) { u.x = nx; u.y = ny; }
    else if (canStand(S, nx, u.y, fromWater)) u.x = nx;
    else if (canStand(S, u.x, ny, fromWater)) u.y = ny;
  }

  // projectiles
  const P = S.projs;
  let pw = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    const dxp = p.tx - p.x, dyp = p.ty - p.y, dp = Math.hypot(dxp, dyp), step = p.sp * dt;
    if (dp <= step) {
      if (p.splash) {
        S.fx.push({ x: p.tx, y: p.ty, r: p.splash, t: 0.4, life: 0.4 });
        const cx = Math.min(HW - 1, Math.max(0, (p.tx / HCELL) | 0)), cy = Math.min(HH - 1, Math.max(0, (p.ty / HCELL) | 0));
        const rc = Math.ceil(p.splash / HCELL);
        for (let gy = Math.max(0, cy - rc); gy <= Math.min(HH - 1, cy + rc); gy++) {
          for (let gx = Math.max(0, cx - rc); gx <= Math.min(HW - 1, cx + rc); gx++) {
            for (let j = S.head[gy * HW + gx]; j !== -1; j = S.next[j]) {
              const v = U[j];
              if (v.team === p.team || v.hp <= 0) continue;
              const dd = Math.hypot(v.x - p.tx, v.y - p.ty);
              if (dd <= p.splash) hit(S, v, p.dmg * (1 - 0.6 * dd / p.splash) * (cellAt(S, v.x, v.y) === T_FOREST ? 0.7 : 1), p.team);
            }
          }
        }
      } else if (p.tgt && p.tgt.hp > 0) {
        hit(S, p.tgt, p.dmg * (cellAt(S, p.tgt.x, p.tgt.y) === T_FOREST ? 0.6 : 1), p.team);
      }
    } else {
      p.x += dxp / dp * step; p.y += dyp / dp * step;
      P[pw++] = p;
    }
  }
  P.length = pw;
  let fw = 0;
  for (const f of S.fx) { f.t -= dt; if (f.t > 0) S.fx[fw++] = f; }
  S.fx.length = fw;

  // stats + history + winner
  const alive = S.stats.alive;
  alive.fill(0);
  for (const u of U) if (u.hp > 0) alive[u.team]++;
  S.histT += dt;
  if (S.histT >= S.histDt) {
    S.histT = 0;
    for (let t = 0; t < 4; t++) S.hist[t].push(alive[t]);
    if (S.hist[0].length > 400) { for (let t = 0; t < 4; t++) S.hist[t] = S.hist[t].filter((_, k) => k % 2 === 0); S.histDt *= 2; }
  }
  if (S.started) {
    const left = S.activeTeams.filter((t) => alive[t] > 0);
    if (left.length <= 1) S.winner = left.length === 1 ? { team: left[0] } : { team: -1 };
  }
}

// ---------- presets ----------
const PRESETS = [
  { id: "even", label: "Even skirmish (inspired-by)", teams: 2, build(S, add) {
    for (const [t, x, dir] of [[0, 450, 1], [1, 1150, -1]]) {
      for (const y of [300, 500, 700]) add(t, "inf", x, y);
      for (const y of [250, 400, 600, 750]) add(t, "arc", x - 100 * dir, y);
      add(t, "cav", x, 140); add(t, "cav", x, 860);
    }
  } },
  { id: "hill", label: "Outnumbered defenders on a hill (inspired-by)", teams: 2, build(S, add) {
    paintCircle(S, 420, 500, 170, T_HILL);
    paintCircle(S, 520, 330, 70, T_FOREST);
    paintCircle(S, 520, 680, 70, T_FOREST);
    for (const y of [400, 500, 600]) add(0, "inf", 470, y);
    for (const y of [430, 570]) add(0, "arc", 380, y);
    add(0, "art", 330, 500);
    for (const y of [200, 320, 440, 560, 680, 800]) add(1, "inf", 1150, y);
    for (const y of [260, 500, 740]) add(1, "arc", 1250, y);
    add(1, "cav", 1080, 140); add(1, "cav", 1080, 860); add(1, "cav", 1080, 500);
    add(1, "tank", 1050, 380); add(1, "tank", 1050, 620);
  } },
  { id: "flank", label: "Cavalry flank (inspired-by)", teams: 2, build(S, add) {
    for (const y of [300, 440, 560, 700]) add(0, "inf", 550, y);
    for (const y of [360, 640]) add(0, "arc", 460, y);
    add(0, "cav", 620, 120); add(0, "cav", 620, 880); add(0, "cav", 620, 60); add(0, "cav", 620, 940);
    for (const y of [280, 420, 560, 700]) add(1, "inf", 1000, y);
    for (const y of [340, 500, 660]) add(1, "arc", 1100, y);
  } },
  { id: "art", label: "Artillery duel (inspired-by)", teams: 2, build(S, add) {
    paintCircle(S, 800, 200, 1, 0);
    for (let y = 0; y < WORLD_H; y += 10) if (y < 420 || y > 580) paintCircle(S, 800, y, 22, T_WATER);
    for (const [t, xa, xi] of [[0, 150, 400], [1, 1450, 1200]]) {
      for (const y of [300, 500, 700]) add(t, "art", xa, y);
      for (const y of [250, 400, 600, 750]) add(t, "inf", xi, y);
      add(t, "tank", xi - (t ? -60 : 60), 500);
    }
    for (const y of [150, 850]) { add(0, "cav", 500, y); add(1, "cav", 1100, y); }
  } },
  { id: "four", label: "Four-way melee (inspired-by)", teams: 4, build(S, add) {
    paintCircle(S, 800, 500, 90, T_HILL);
    paintCircle(S, 800, 200, 80, T_FOREST);
    paintCircle(S, 800, 800, 80, T_FOREST);
    for (const [t, x, y] of [[0, 260, 230], [1, 1340, 230], [2, 260, 770], [3, 1340, 770]]) {
      add(t, "inf", x, y); add(t, "inf", x + (x < 800 ? 110 : -110), y);
      add(t, "arc", x, y + (y < 500 ? 90 : -90));
      add(t, "cav", x + (x < 800 ? 90 : -90), y + (y < 500 ? 90 : -90));
      add(t, "tank", x + (x < 800 ? 200 : -200), y + (y < 500 ? 40 : -40));
    }
  } },
];

// ---------- UI ----------
const CSS = `
.war-wrap{display:flex;gap:12px;height:calc(100vh - 130px);min-height:480px;}
.war-stage{flex:1;min-width:0;position:relative;background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;overflow:hidden;}
.war-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block;cursor:crosshair;}
.war-banner{position:absolute;left:50%;top:14px;transform:translateX(-50%);background:var(--panel);color:var(--text);border:2px solid var(--accent);border-radius:8px;padding:8px 18px;font-weight:700;font-size:1.05rem;display:none;pointer-events:none;}
.war-side{width:320px;flex:none;overflow-y:auto;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:0.85rem;display:flex;flex-direction:column;gap:10px;}
.war-side h3{margin:0 0 4px;font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim);}
.war-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.war-btn{background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit;}
.war-btn:hover:not(:disabled){border-color:var(--accent);}
.war-btn:disabled{opacity:.45;cursor:default;}
.war-btn.on{background:var(--accent);border-color:var(--accent);color:#fff;}
.war-btn.danger{border-color:var(--danger);color:var(--danger);}
.war-side select,.war-side input[type=number]{background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font:inherit;}
.war-side input[type=number]{width:80px;}
.war-team,.war-unit{display:flex;align-items:center;gap:8px;width:100%;text-align:left;}
.war-sw{width:12px;height:12px;border-radius:50%;flex:none;}
.war-dim{color:var(--text-dim);font-size:0.78rem;}
.war-table{width:100%;border-collapse:collapse;}
.war-table td,.war-table th{padding:2px 4px;text-align:right;}
.war-table th:first-child,.war-table td:first-child{text-align:left;}
.war-spark{width:100%;height:90px;background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;display:block;}
@media (max-width:820px){
  .war-wrap{flex-direction:column;height:auto;min-height:0;}
  .war-stage{height:60vh;min-height:300px;flex:none;}
  .war-side{width:auto;overflow-y:auto;max-height:none;}
}
`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class WarMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.S = createSim();
    this.phase = "place"; // place | battle
    this.running = false;
    this.speed = 1;
    this.teamCount = 2;
    this.team = 0;
    this.utype = "inf";
    this.tool = "place"; // place | select | paint
    this.brush = T_FOREST;
    this.brushSize = 2;
    this.budget = 1500;
    this.selected = null;
    this.snapshot = null;
    this.terrDirty = true;
    this.raf = 0;
    this.last = 0;
    this.acc = 0;
    this.drag = null;
    this.colors = { bg: "#eef0f3", text: "#1c1f26", dim: "#6b7280", border: "#d8dce2" };
    this.colorTick = 0;
    this.scoreTick = 0;
    this.view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
    this.terrCanvas = document.createElement("canvas");
    this.terrCanvas.width = GW; this.terrCanvas.height = GH;
    this._loop = this._loop.bind(this);
    this._onResize = () => this._resize();
    this._build();
  }

  mount() {
    this._resize();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this._resize());
      this.ro.observe(this.stage);
    }
    window.addEventListener("resize", this._onResize);
    this._refreshColors();
    this._refreshUI();
    this.last = 0;
    if (!this.raf) this.raf = requestAnimationFrame(this._loop);
  }

  unmount() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    window.removeEventListener("resize", this._onResize);
    if (this.running) { this.running = false; this._refreshUI(); }
  }

  // ----- DOM -----
  _build() {
    if (!document.getElementById("war-styles")) {
      const st = document.createElement("style");
      st.id = "war-styles";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const root = this.root;
    root.innerHTML = "";
    root.className = "econ-root";
    root.appendChild(el("h1", "econ-title", "War Simulator"));

    const wrap = el("div", "war-wrap");
    this.stage = el("div", "war-stage");
    this.canvas = el("canvas", "war-canvas");
    this.banner = el("div", "war-banner");
    this.stage.append(this.canvas, this.banner);
    this.g = this.canvas.getContext("2d");
    const side = el("div", "war-side");
    wrap.append(this.stage, side);
    root.appendChild(wrap);

    // battle controls
    const sec = (title) => { const s = el("div"); s.appendChild(el("h3", null, title)); side.appendChild(s); return s; };
    const btn = (label, fn, cls) => { const b = el("button", "war-btn" + (cls ? " " + cls : ""), label); b.type = "button"; b.addEventListener("click", fn); return b; };
    this._btn = btn;

    let s = sec("Battle");
    this.phaseLbl = el("div", "war-dim");
    const r1 = el("div", "war-row");
    this.bStart = btn("Start Battle", () => this._start());
    this.bPause = btn("Pause", () => this._togglePause());
    this.bReset = btn("Reset (keep armies)", () => this._reset());
    this.bClear = btn("Clear All", () => this._clearAll(), "danger");
    r1.append(this.bStart, this.bPause, this.bReset, this.bClear);
    const r2 = el("div", "war-row");
    r2.style.marginTop = "6px";
    r2.appendChild(el("span", "war-dim", "Speed"));
    this.speedSel = el("select");
    for (const v of [0.5, 1, 2, 4]) { const o = el("option", null, v + "x"); o.value = v; if (v === 1) o.selected = true; this.speedSel.appendChild(o); }
    this.speedSel.addEventListener("change", () => { this.speed = parseFloat(this.speedSel.value); });
    r2.appendChild(this.speedSel);
    r2.appendChild(el("span", "war-dim", "Teams"));
    this.teamSel = el("select");
    for (const v of [2, 3, 4]) { const o = el("option", null, String(v)); o.value = v; this.teamSel.appendChild(o); }
    this.teamSel.addEventListener("change", () => { this.teamCount = parseInt(this.teamSel.value, 10); if (this.team >= this.teamCount) this.team = 0; this._refreshUI(); });
    r2.appendChild(this.teamSel);
    s.append(this.phaseLbl, r1, r2);

    s = sec("Scenario preset");
    this.presetSel = el("select");
    const o0 = el("option", null, "Choose a preset..."); o0.value = ""; this.presetSel.appendChild(o0);
    for (const p of PRESETS) { const o = el("option", null, p.label); o.value = p.id; this.presetSel.appendChild(o); }
    this.presetSel.addEventListener("change", () => { this._loadPreset(this.presetSel.value); this.presetSel.value = ""; });
    s.append(this.presetSel, el("div", "war-dim", "Stylized armies loosely inspired by famous battle shapes, not literal recreations."));

    s = sec("Tool");
    const tr = el("div", "war-row");
    this.toolBtns = {};
    for (const [id, label] of [["place", "Place squads"], ["select", "Select / orders"], ["paint", "Paint terrain"]]) {
      const b = btn(label, () => { this.tool = id; this._refreshUI(); });
      this.toolBtns[id] = b; tr.appendChild(b);
    }
    this.toolHint = el("div", "war-dim");
    this.toolHint.style.marginTop = "4px";
    s.append(tr, this.toolHint);

    this.placeSec = sec("Team and budget");
    this.budgetIn = el("input"); this.budgetIn.type = "number"; this.budgetIn.min = 0; this.budgetIn.step = 100; this.budgetIn.value = this.budget;
    this.budgetIn.addEventListener("change", () => { this.budget = Math.max(0, parseInt(this.budgetIn.value, 10) || 0); this._refreshUI(); });
    const br = el("div", "war-row"); br.append(el("span", "war-dim", "Points per team"), this.budgetIn);
    this.teamBox = el("div"); this.teamBox.style.cssText = "display:flex;flex-direction:column;gap:4px;margin-top:6px";
    this.placeSec.append(br, this.teamBox);

    this.unitSec = sec("Unit type");
    this.unitBox = el("div"); this.unitBox.style.cssText = "display:flex;flex-direction:column;gap:4px";
    this.unitBtns = {};
    for (const id of TYPE_IDS) {
      const T = UNIT_TYPES[id];
      const b = btn("", () => { this.utype = id; this._refreshUI(); });
      b.className += " war-unit";
      const sp = el("span"); sp.innerHTML = "";
      const name = el("strong", null, T.name);
      const det = el("div", "war-dim", `${T.squad} units, ${T.cost} pts each. HP ${T.hp}, dmg ${T.dmg}, range ${T.range}, speed ${T.speed}, cooldown ${T.cd}s` + (T.charge ? ", charge bonus" : "") + (T.splash ? ", splash" : ""));
      const wrapb = el("div"); wrapb.append(name, det);
      b.appendChild(wrapb);
      this.unitBtns[id] = b; this.unitBox.appendChild(b);
    }
    this.unitSec.appendChild(this.unitBox);

    this.paintSec = sec("Terrain brush");
    const pr = el("div", "war-row");
    this.brushBtns = {};
    for (const [id, label] of [[T_FOREST, "Forest"], [T_HILL, "Hill"], [T_WATER, "Water"], [T_GRASS, "Erase"]]) {
      const b = btn(label, () => { this.brush = id; this._refreshUI(); });
      this.brushBtns[id] = b; pr.appendChild(b);
    }
    const sz = el("input"); sz.type = "range"; sz.min = 1; sz.max = 8; sz.value = this.brushSize;
    sz.addEventListener("input", () => { this.brushSize = parseInt(sz.value, 10); });
    const szr = el("div", "war-row"); szr.style.marginTop = "6px"; szr.append(el("span", "war-dim", "Brush size"), sz);
    this.paintSec.append(pr, szr, el("div", "war-dim", "Forest: slows movement, cuts ranged damage taken. Hill: +25% range for ranged units. Water: impassable."));

    this.selSec = sec("Selected squad");
    this.selInfo = el("div", "war-dim");
    const sr = el("div", "war-row"); sr.style.marginTop = "6px";
    this.bAdv = btn("Advance", () => { if (this.selected) { this.selected.stance = "advance"; this._refreshUI(); } });
    this.bHold = btn("Hold position", () => { if (this.selected) { this.selected.stance = "hold"; this._refreshUI(); } });
    this.bDel = btn("Delete", () => this._deleteSel(), "danger");
    this.bNoOrd = btn("Cancel order", () => { if (this.selected) { clearOrder(this.selected); this._refreshUI(); } });
    this.bDesel = btn("Deselect", () => { this.selected = null; this._refreshUI(); });
    sr.append(this.bAdv, this.bHold, this.bNoOrd, this.bDel, this.bDesel);
    this.selSec.append(this.selInfo, sr);

    s = sec("Scoreboard");
    this.table = el("table", "war-table");
    this.spark = el("canvas", "war-spark");
    s.append(this.table, el("div", "war-dim", "Army strength over time"), this.spark);

    // pointer events
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this._pdown(e));
    c.addEventListener("pointermove", (e) => this._pmove(e));
    const up = (e) => this._pup(e);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _refreshColors() {
    try {
      const cs = getComputedStyle(this.root);
      const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
      this.colors = { bg: v("--panel-alt", "#eef0f3"), text: v("--text", "#1c1f26"), dim: v("--text-dim", "#6b7280"), border: v("--border", "#d8dce2"), accent: v("--accent", "#3b6fe0") };
    } catch (e) { /* keep defaults */ }
  }

  _resize() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const s = Math.min(w / WORLD_W, h / WORLD_H);
    this.view = { s, ox: (w - WORLD_W * s) / 2, oy: (h - WORLD_H * s) / 2, w, h, dpr };
    const sw = this.spark.clientWidth || 280, sh = this.spark.clientHeight || 90;
    this.spark.width = Math.round(sw * dpr); this.spark.height = Math.round(sh * dpr);
    this.sparkDirty = true;
  }

  _world(e) {
    const r = this.canvas.getBoundingClientRect();
    const v = this.view;
    return { x: (e.clientX - r.left - v.ox) / v.s, y: (e.clientY - r.top - v.oy) / v.s };
  }

  // ----- pointer handling -----
  _pickSquad(p) {
    let best = null, bd = (36 / Math.max(this.view.s, 0.2)) ** 2;
    for (const sq of this.S.squads) {
      const d = (sq.cx - p.x) ** 2 + (sq.cy - p.y) ** 2;
      if (d < bd) { bd = d; best = sq; }
    }
    return best;
  }

  _pdown(e) {
    if (e.button > 0 && e.pointerType === "mouse") return;
    const p = this._world(e);
    if (p.x < 0 || p.y < 0 || p.x > WORLD_W || p.y > WORLD_H) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const S = this.S;
    if (this.tool === "paint") {
      this.drag = { kind: "paint" };
      this._paintAt(p);
    } else if (this.tool === "place") {
      if (this.phase !== "place") return;
      this._placeAt(p);
    } else {
      const sq = this._pickSquad(p);
      if (sq) {
        this.selected = sq;
        if (this.phase === "place") this.drag = { kind: "move", sq, dx: sq.x - p.x, dy: sq.y - p.y };
        this._refreshUI();
      } else if (this.selected && S.squads.includes(this.selected)) {
        orderSquad(this.selected, p.x, p.y);
        this._refreshUI();
      } else {
        this.selected = null;
        this._refreshUI();
      }
    }
  }

  _pmove(e) {
    if (!this.drag) return;
    const p = this._world(e);
    if (this.drag.kind === "paint") this._paintAt(p);
    else if (this.drag.kind === "move") {
      const x = Math.min(WORLD_W - 10, Math.max(10, p.x + this.drag.dx));
      const y = Math.min(WORLD_H - 10, Math.max(10, p.y + this.drag.dy));
      moveSquad(this.S, this.drag.sq, x, y);
      if (this.drag.sq.order) { /* keep target */ }
    }
  }

  _pup(e) {
    this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  _paintAt(p) {
    if (paintCircle(this.S, p.x, p.y, this.brushSize * CELL * 0.6, this.brush)) this.terrDirty = true;
  }

  _spent(t) {
    let n = 0;
    for (const sq of this.S.squads) if (sq.team === t) n += sq.cost;
    return n;
  }

  _placeAt(p) {
    const S = this.S, T = UNIT_TYPES[this.utype];
    if (cellAt(S, p.x, p.y) === T_WATER) return;
    if (this.budget - this._spent(this.team) < T.squad * T.cost) { this._flash("Not enough points"); return; }
    if (S.units.length + T.squad > MAX_UNITS) { this._flash("Unit cap reached (" + MAX_UNITS + ")"); return; }
    spawnSquad(S, this.team, this.utype, p.x, p.y);
    this._refreshUI();
  }

  _flash(msg) {
    this.banner.textContent = msg;
    this.banner.style.display = "block";
    clearTimeout(this._ft);
    this._ft = setTimeout(() => { this._updateBanner(); }, 1400);
  }

  // ----- actions -----
  _teamsWithUnits() {
    const set = new Set();
    for (const sq of this.S.squads) set.add(sq.team);
    return [...set];
  }

  _start() {
    if (this.phase !== "place") return;
    const teams = this._teamsWithUnits();
    if (teams.length < 2) { this._flash("Place armies for at least two teams"); return; }
    const S = this.S;
    this.snapshot = S.squads.map((q) => ({ id: q.id, team: q.team, type: q.type, x: q.x, y: q.y, stance: q.stance, order: q.order, tx: q.tx, ty: q.ty }));
    S.started = true; S.winner = null; S.activeTeams = teams;
    S.time = 0; S.histT = 0; S.histDt = 0.5;
    S.hist = [[], [], [], []];
    S.stats = { kills: [0, 0, 0, 0], losses: [0, 0, 0, 0], alive: [0, 0, 0, 0] };
    for (const u of S.units) S.stats.alive[u.team]++;
    for (let t = 0; t < 4; t++) S.hist[t].push(S.stats.alive[t]);
    for (const sq of S.squads) { sq.oid++; }
    this.phase = "battle"; this.running = true;
    this.acc = 0;
    this._refreshUI();
  }

  _togglePause() {
    if (this.phase !== "battle" || this.S.winner) return;
    this.running = !this.running;
    this._refreshUI();
  }

  _reset() {
    if (!this.snapshot) { this.phase = "place"; this.running = false; this._refreshUI(); return; }
    const S = this.S;
    S.units = []; S.squads = []; S.projs = []; S.fx = [];
    for (const d of this.snapshot) spawnSquad(S, d.team, d.type, d.x, d.y, { id: d.id, stance: d.stance, order: d.order, tx: d.tx, ty: d.ty });
    S.started = false; S.winner = null; S.time = 0; S.histT = 0;
    S.hist = [[], [], [], []];
    S.stats = { kills: [0, 0, 0, 0], losses: [0, 0, 0, 0], alive: [0, 0, 0, 0] };
    this.selected = null;
    this.phase = "place"; this.running = false;
    this._refreshUI();
  }

  _clearAll() {
    const S = this.S;
    S.units = []; S.squads = []; S.projs = []; S.fx = [];
    S.terrain.fill(0); this.terrDirty = true;
    S.started = false; S.winner = null; S.time = 0; S.histT = 0;
    S.hist = [[], [], [], []];
    S.stats = { kills: [0, 0, 0, 0], losses: [0, 0, 0, 0], alive: [0, 0, 0, 0] };
    this.snapshot = null; this.selected = null;
    this.phase = "place"; this.running = false;
    this._refreshUI();
  }

  _deleteSel() {
    if (!this.selected || this.phase !== "place") return;
    removeSquad(this.S, this.selected);
    this.selected = null;
    this._refreshUI();
  }

  _loadPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    this._clearAll();
    this.teamCount = p.teams; this.teamSel.value = String(p.teams);
    if (this.team >= p.teams) this.team = 0;
    p.build(this.S, (t, type, x, y) => spawnSquad(this.S, t, type, x, y));
    this.terrDirty = true;
    let mx = 0;
    for (let t = 0; t < 4; t++) mx = Math.max(mx, this._spent(t));
    this.budget = Math.max(1500, Math.ceil(mx / 100) * 100 + 300);
    this.budgetIn.value = this.budget;
    this._refreshUI();
  }

  // ----- UI refresh -----
  _updateBanner() {
    const w = this.S.winner;
    if (w) {
      this.banner.textContent = w.team < 0 ? "Mutual destruction: no survivors" : TEAMS[w.team].name + " team wins";
      this.banner.style.borderColor = w.team < 0 ? "var(--danger)" : TEAMS[w.team].color;
      this.banner.style.display = "block";
    } else this.banner.style.display = "none";
  }

  _refreshUI() {
    const inPlace = this.phase === "place";
    this.phaseLbl.textContent = inPlace ? "Placement phase. Place armies, then start the battle." : this.S.winner ? "Battle over." : this.running ? "Battle in progress." : "Battle paused.";
    this.bStart.disabled = !inPlace;
    this.bPause.disabled = inPlace || !!this.S.winner;
    this.bPause.textContent = this.running || inPlace ? "Pause" : "Resume";
    this.bReset.disabled = !this.snapshot && inPlace;
    for (const id in this.toolBtns) this.toolBtns[id].classList.toggle("on", this.tool === id);
    this.toolHint.textContent = this.tool === "place" ? (inPlace ? "Click the battlefield to place a squad of the chosen type." : "Placement is only available before battle. Use Reset to edit armies.")
      : this.tool === "select" ? "Click a squad to select it (drag to reposition before battle). With a squad selected, click empty ground to order it to march there."
      : "Drag on the battlefield to paint terrain.";
    this.placeSec.style.display = this.tool === "place" ? "" : "none";
    this.unitSec.style.display = this.tool === "place" ? "" : "none";
    this.paintSec.style.display = this.tool === "paint" ? "" : "none";

    this.teamBox.innerHTML = "";
    for (let t = 0; t < this.teamCount; t++) {
      const rem = this.budget - this._spent(t);
      const b = this._btn("", () => { this.team = t; this._refreshUI(); }, this.team === t ? "on" : "");
      b.classList.add("war-team");
      const sw = el("span", "war-sw"); sw.style.background = TEAMS[t].color;
      b.append(sw, el("span", null, `${TEAMS[t].name}: ${rem} pts left`));
      this.teamBox.appendChild(b);
    }
    for (const id in this.unitBtns) this.unitBtns[id].classList.toggle("on", this.utype === id);
    for (const id in this.brushBtns) this.brushBtns[id].classList.toggle("on", this.brush === Number(id));

    const sq = this.selected && this.S.squads.includes(this.selected) ? this.selected : null;
    if (!sq) this.selected = null;
    this.selSec.style.display = sq ? "" : "none";
    if (sq) {
      this.selInfo.textContent = `${TEAMS[sq.team].name} ${UNIT_TYPES[sq.type].name}, ${sq.alive} units. Stance: ${sq.stance === "hold" ? "Hold position" : "Advance"}. ${sq.order ? "March order active." : "No march order."}`;
      this.bAdv.classList.toggle("on", sq.stance !== "hold");
      this.bHold.classList.toggle("on", sq.stance === "hold");
      this.bDel.disabled = !inPlace;
      this.bNoOrd.disabled = !sq.order;
    }
    this._updateBanner();
    this._renderScore();
  }

  _renderScore() {
    const S = this.S, st = S.stats;
    this.table.innerHTML = "";
    const hr = el("tr");
    for (const h of ["Team", "Alive", "Kills", "Lost"]) hr.appendChild(el("th", "war-dim", h));
    this.table.appendChild(hr);
    for (let t = 0; t < this.teamCount; t++) {
      const alive = this.phase === "place" ? S.units.filter((u) => u.team === t).length : st.alive[t];
      const tr = el("tr");
      const td = el("td");
      const sw = el("span", "war-sw"); sw.style.cssText = `display:inline-block;margin-right:6px;background:${TEAMS[t].color}`;
      td.append(sw, TEAMS[t].name);
      tr.append(td, el("td", null, String(alive)), el("td", null, String(st.kills[t])), el("td", null, String(st.losses[t])));
      this.table.appendChild(tr);
    }
    this._drawSpark();
  }

  _drawSpark() {
    const c = this.spark, g = c.getContext("2d");
    if (!g || !c.width) return;
    const w = c.width, h = c.height, S = this.S, dpr = this.view.dpr;
    g.clearRect(0, 0, w, h);
    const n = S.hist[0].length;
    if (n < 2) return;
    let mx = 1;
    for (let t = 0; t < this.teamCount; t++) for (const v of S.hist[t]) if (v > mx) mx = v;
    const pad = 4 * dpr;
    g.lineWidth = 2 * dpr;
    for (let t = 0; t < this.teamCount; t++) {
      g.strokeStyle = TEAMS[t].color;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = pad + (w - 2 * pad) * i / (n - 1);
        const y = h - pad - (h - 2 * pad) * S.hist[t][i] / mx;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
  }

  // ----- loop -----
  _loop(ts) {
    this.raf = requestAnimationFrame(this._loop);
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    if (this.running && this.phase === "battle") {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 10) {
        stepSim(this.S, SIM_DT);
        this.acc -= SIM_DT; steps++;
        if (this.S.winner) { this.running = false; this._refreshUI(); break; }
      }
      if (steps === 10) this.acc = 0;
      this.scoreTick += dt;
      if (this.scoreTick > 0.25) { this.scoreTick = 0; this._renderScore(); }
    }
    if (++this.colorTick > 90) { this.colorTick = 0; this._refreshColors(); }
    this._draw();
  }

  _terrImage() {
    const g = this.terrCanvas.getContext("2d");
    const img = g.createImageData(GW, GH);
    const cols = { [T_FOREST]: [34, 130, 70, 150], [T_HILL]: [190, 150, 80, 130], [T_WATER]: [60, 130, 220, 170] };
    for (let i = 0; i < GW * GH; i++) {
      const c = cols[this.S.terrain[i]];
      if (c) { img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = c[3]; }
    }
    g.putImageData(img, 0, 0);
    this.terrDirty = false;
  }

  _draw() {
    const g = this.g, v = this.view, S = this.S;
    if (!v.w) return;
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    g.fillStyle = this.colors.border;
    g.fillRect(0, 0, v.w, v.h);
    g.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
    g.fillStyle = this.colors.bg;
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    if (this.terrDirty) this._terrImage();
    g.imageSmoothingEnabled = false;
    g.drawImage(this.terrCanvas, 0, 0, WORLD_W, WORLD_H);

    // selection + orders
    const sel = this.selected;
    if (sel && S.squads.includes(sel)) {
      g.strokeStyle = this.colors.text; g.lineWidth = 2 / v.s;
      g.beginPath(); g.arc(sel.cx, sel.cy, 26, 0, Math.PI * 2); g.stroke();
      if (sel.order) {
        g.setLineDash([8 / v.s, 6 / v.s]);
        g.beginPath(); g.moveTo(sel.cx, sel.cy); g.lineTo(sel.tx, sel.ty); g.stroke();
        g.setLineDash([]);
        g.beginPath(); g.arc(sel.tx, sel.ty, 8, 0, Math.PI * 2); g.stroke();
      }
    }

    // units batched per team/shape
    for (let t = 0; t < this.teamCount; t++) {
      g.fillStyle = TEAMS[t].color;
      for (const shape of ["circle", "small", "diamond", "square", "triangle"]) {
        g.beginPath();
        let any = false;
        for (const u of S.units) {
          if (u.team !== t || u.t.shape !== shape || u.hp <= 0) continue;
          any = true;
          const r = u.t.r, x = u.x, y = u.y;
          if (shape === "circle" || shape === "small") { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
          else if (shape === "diamond") { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
          else if (shape === "square") g.rect(x - r, y - r, r * 2, r * 2);
          else { g.moveTo(x, y - r); g.lineTo(x + r, y + r * 0.8); g.lineTo(x - r, y + r * 0.8); g.closePath(); }
        }
        if (any) g.fill();
      }
    }
    // projectiles
    g.lineWidth = 1.5;
    for (const p of S.projs) {
      g.strokeStyle = this.colors.text; g.fillStyle = this.colors.text;
      if (p.kind === "arrow") { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - (p.tx - p.x) * 0.02, p.y - (p.ty - p.y) * 0.02); g.stroke(); }
      else { g.beginPath(); g.arc(p.x, p.y, p.kind === "shell" ? 3 : 2, 0, Math.PI * 2); g.fill(); }
    }
    for (const f of S.fx) {
      g.strokeStyle = "#f59e0b"; g.globalAlpha = Math.max(0, f.t / f.life);
      g.lineWidth = 2;
      g.beginPath(); g.arc(f.x, f.y, f.r * (1.3 - f.t / f.life * 0.5), 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
  }
}
