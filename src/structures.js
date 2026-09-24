// Structure Tester — build on a grid, then subject the structure to a disaster.
//
// Every grid cell is a rigid Matter.js body joined to its neighbours by stiff
// constraints that BREAK when their stretch exceeds a material-dependent limit.
// Foundation cells are welded to the ground. All material numbers are stylized
// teaching values, NOT engineering data (see STRUCTURE_MODEL_INFO).
//
// Scale: one cell = 1 m x 1 m x 1 m (20 px). Real-unit forces (N) are converted
// to Matter forces via the cell's real mass so loads are in the right ratio to
// gravity (a wind load of 0.3 g really is 0.3 g).

const COLS = 30, ROWS = 18, CS = 20;
const WORLD_W = COLS * CS, GROUND_Y = ROWS * CS; // ground top surface
const BUDGET = 15000;
const G = 9.81, RHO_AIR = 1.225, RHO_WATER = 1000;

// dens: stylized effective density kg/m3 of a solid 1 m cell; brk: joint break stretch (px)
const MATERIALS = {
  wood:       { name: "Wood",                cost: 40,  dens: 500,  brk: 0.17, color: "#b5824a", cd: 1 },
  steel:      { name: "Steel",               cost: 180, dens: 1500, brk: 0.34, color: "#7d8a9a", cd: 1 },
  concrete:   { name: "Reinforced Concrete", cost: 120, dens: 2400, brk: 0.22, color: "#9a9a94", cd: 1 },
  brick:      { name: "Brick / Masonry",     cost: 70,  dens: 1800, brk: 0.12, color: "#b5533c", cd: 1 },
  glass:      { name: "Glass",               cost: 60,  dens: 900,  brk: 0.07, color: "#8fd0e8", cd: 1 },
  foundation: { name: "Foundation Anchor",   cost: 150, dens: 2600, brk: 0.34, color: "#4a4f57", cd: 1 },
  brace:      { name: "Cross-Bracing",       cost: 90,  dens: 400,  brk: 0.34, color: "#d6a32b", cd: 1 },
};
const MAT_ORDER = ["wood", "steel", "concrete", "brick", "glass", "foundation", "brace"];

const DISASTERS = {
  earthquake: { name: "Earthquake" },
  wind:       { name: "Hurricane" },
  flood:      { name: "Flood" },
  snow:       { name: "Heavy Snow Load" },
  tsunami:    { name: "Tsunami" },
};
const SAFFIR = [ // category -> representative sustained wind (m/s), mid of Saffir-Simpson band
  { cat: 1, v: 38 }, { cat: 2, v: 46 }, { cat: 3, v: 54 }, { cat: 4, v: 64 }, { cat: 5, v: 78 },
];

// ---------- pure helpers (tested under node) ----------
export function windSpeedAtHeight(v10, h) { return v10 * Math.pow(Math.max(h, 2) / 10, 0.14); }
export function windPressure(v) { return 0.5 * RHO_AIR * v * v; } // q = 1/2 rho v^2 (Pa)
export function windForce(v, cd, area) { return windPressure(v) * cd * area; } // N
export function peakGroundAccelG(mag) { return Math.min(2, 0.03 * Math.pow(10, 0.33 * (mag - 4))); }
export function stressColor(r) {
  const x = Math.max(0, Math.min(1, r));
  return `hsl(${Math.round(120 * (1 - x))},72%,46%)`;
}
export function gridCost(grid) {
  let c = 0;
  for (const m of grid) if (m) c += MATERIALS[m].cost;
  return c;
}
const idx = (c, r) => r * COLS + c;
export function validateGrid(grid) {
  if (grid.length !== COLS * ROWS) return false;
  for (let i = 0; i < grid.length; i++) {
    const m = grid[i];
    if (m == null) continue;
    if (!MATERIALS[m]) return false;
    if (m === "foundation" && Math.floor(i / COLS) !== ROWS - 1) return false;
  }
  return true;
}

// ---------- templates ----------
function emptyGrid() { return new Array(COLS * ROWS).fill(null); }
function put(g, c, r, m) { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) g[idx(c, r)] = m; }
function rect(g, c0, r0, w, h, m, hollow) {
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) {
    if (hollow && c > c0 && c < c0 + w - 1 && r > r0 && r < r0 + h - 1) continue;
    put(g, c, r, m);
  }
}
function foundations(g, c0, w) { for (let c = c0; c < c0 + w; c++) put(g, c, ROWS - 1, "foundation"); }
function diag(g, c0, r0, w, h, m) { // corner-to-corner brace line
  const n = Math.max(w, h);
  for (let i = 0; i < n; i++) put(g, Math.round(c0 + (i * (w - 1)) / (n - 1)), Math.round(r0 + (i * (h - 1)) / (n - 1)), m);
}
const TEMPLATES = {
  house() {
    const g = emptyGrid();
    foundations(g, 10, 10);
    rect(g, 10, 12, 10, 5, "wood", true);        // walls rows 12..16
    rect(g, 9, 11, 12, 1, "wood");                // roof slab
    put(g, 14, 10, "wood"); put(g, 15, 10, "wood");
    put(g, 12, 14, "glass"); put(g, 17, 14, "glass");
    return g;
  },
  tower() {
    const g = emptyGrid();
    foundations(g, 12, 6);
    rect(g, 12, 2, 6, 15, "concrete", true);      // rows 2..16 hollow shell
    for (let r = 4; r <= 14; r += 5) rect(g, 12, r, 6, 1, "concrete");
    return g;
  },
  bridge() {
    const g = emptyGrid();
    foundations(g, 3, 3); foundations(g, 24, 3);
    rect(g, 3, 12, 3, 5, "concrete"); rect(g, 24, 12, 3, 5, "concrete");
    rect(g, 3, 11, 24, 1, "steel");               // deck
    for (let c = 6; c <= 22; c += 4) diag(g, c, 8, 5, 3, "brace");
    rect(g, 6, 8, 20, 1, "steel");                // top chord... floats on braces
    return g;
  },
  braced() {
    const g = emptyGrid();
    foundations(g, 10, 10);
    rect(g, 10, 6, 10, 11, "steel", true);
    for (let r = 6; r <= 16; r += 5) rect(g, 10, r, 10, 1, "steel");
    diag(g, 11, 7, 8, 4, "brace"); diag(g, 11, 12, 8, 4, "brace");
    return g;
  },
};
export { TEMPLATES, MATERIALS, COLS, ROWS, BUDGET };

// ---------- physics simulation (no DOM) ----------
export class StructureSim {
  constructor(grid, dis) {
    const M = globalThis.Matter;
    this.M = M;
    this.dis = dis;
    this.t = -1.0; // settle phase before the disaster begins
    this.engine = M.Engine.create({ positionIterations: 10, velocityIterations: 8, constraintIterations: 20, enableSleeping: false });
    this.world = this.engine.world;
    this.ground = M.Bodies.rectangle(WORLD_W / 2, GROUND_Y + 40, 6000, 80, { isStatic: true, friction: 0.8, label: "ground" });
    M.World.add(this.world, this.ground);
    this.grid = grid.slice();
    this.bodies = new Array(grid.length).fill(null);
    this.found = [];
    this.joints = [];
    this.debris = [];
    this.totalMass = 0;
    this.groundDx = 0;
    this.noise = 0;
    this.maxDrift = 0;
    this.nextDebris = 1.5;
    this.height = 0;
    let topRow = ROWS;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const id = this.grid[idx(c, r)];
      if (!id) continue;
      const mat = MATERIALS[id];
      const x = c * CS + CS / 2, y = r * CS + CS / 2;
      let b;
      if (id === "foundation") {
        b = M.Bodies.rectangle(x, y, CS, CS, { isStatic: true, friction: 0.9 });
        this.found.push(b);
      } else {
        b = M.Bodies.rectangle(x, y, CS, CS, { density: mat.dens / 10000, friction: id === "glass" ? 0.3 : 0.7, restitution: 0.05, frictionAir: 0.01 });
      }
      b.cell = { c, r, id, x0: x, y0: y, ratio: 0 };
      this.bodies[idx(c, r)] = b;
      if (id !== "foundation") this.totalMass += b.mass;
      topRow = Math.min(topRow, r);
      M.World.add(this.world, b);
    }
    this.height = topRow < ROWS ? (ROWS - topRow) : 0;
    this.topRow = topRow;
    this.topCells = this.bodies.filter((b) => b && b.cell.r === topRow && b.cell.id !== "foundation");
    // joints
    const h = CS / 2, hh = CS / 2;
    const link = (a, b, pa, pb) => {
      const brk = Math.min(MATERIALS[a.cell.id].brk, MATERIALS[b.cell.id].brk);
      return { a, b, brk, cons: [M.Constraint.create({ bodyA: a, bodyB: b, pointA: pa, pointB: pb, stiffness: 1, damping: 0.3 })], broken: false, ratio: 0 };
    };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const a = this.bodies[idx(c, r)];
      if (!a) continue;
      const ha = a.cell.id === "foundation" ? hh : h;
      const pairs = [[1, 0], [0, 1]];
      if (a.cell.id === "brace") pairs.push([1, 1], [1, -1]);
      for (const [dc, dr] of pairs) {
        const b = this.bodies[idx(c + dc, r + dr)];
        if (!b || c + dc >= COLS || r + dr >= ROWS || r + dr < 0) continue;
        if (a.cell.id === "foundation" && b.cell.id === "foundation") continue;
        const hb = b.cell.id === "foundation" ? hh : h;
        let j;
        if (dc && dr) {
          j = link(a, b, { x: dc * ha, y: dr * ha }, { x: -dc * hb, y: -dr * hb });
        } else if (dc) { // side by side: two anchors on the shared face
          j = link(a, b, { x: ha, y: -ha }, { x: -hb, y: -hb });
          j.cons.push(M.Constraint.create({ bodyA: a, bodyB: b, pointA: { x: ha, y: ha }, pointB: { x: -hb, y: hb }, stiffness: 1, damping: 0.3 }));
        } else {
          j = link(a, b, { x: -ha, y: ha }, { x: -hb, y: -hb });
          j.cons.push(M.Constraint.create({ bodyA: a, bodyB: b, pointA: { x: ha, y: ha }, pointB: { x: hb, y: -hb } , stiffness: 1, damping: 0.3 }));
        }
        j.len0 = j.cons.map((k) => this._len(k));
        this.joints.push(j);
        M.World.add(this.world, j.cons);
      }
    }
  }
  _len(k) {
    const M = this.M;
    const pa = M.Vector.add(k.bodyA.position, M.Vector.rotate(k.pointA, k.bodyA.angle));
    const pb = M.Vector.add(k.bodyB.position, M.Vector.rotate(k.pointB, k.bodyB.angle));
    return M.Vector.magnitude(M.Vector.sub(pa, pb));
  }
  // Apply a real-unit force (N) to a body via its real mass, so accel is right relative to gravity.
  _force(b, fxN, fyN) {
    const realMass = MATERIALS[b.cell.id].dens; // 1 m^3
    const k = (b.mass * 0.001) / (realMass * G);
    this.M.Body.applyForce(b, b.position, { x: fxN * k, y: fyN * k });
  }
  get duration() { return this.dis.duration; }
  get finished() { return this.t > this.dis.duration + 4; }
  step(dtMs = 1000 / 60) {
    const M = this.M, dt = dtMs / 1000;
    const t = this.t;
    if (t >= 0) this._disaster(t, dt);
    this.t += dt;
    this.engine.timing.timestamp += dtMs;
    M.Engine.update(this.engine, dtMs);
    for (const c of this.bodies) if (c) c.cell.ratio *= 0.97;
    // stress & breaking
    for (const j of this.joints) {
      if (j.broken) continue;
      let worst = 0;
      if (this.t <= 0) { j.len0 = j.cons.map((k) => this._len(k)); j.pre = 0; }  // settle: re-zero under self-weight
      for (let i = 0; i < j.cons.length; i++) worst = Math.max(worst, Math.abs(this._len(j.cons[i]) - j.len0[i]));
      j.ratio = worst / j.brk;
      j.a.cell.ratio = Math.max(j.a.cell.ratio, j.ratio);
      j.b.cell.ratio = Math.max(j.b.cell.ratio, j.ratio);
      if (this.t > 0 && j.ratio >= 1) {
        j.broken = true;
        M.World.remove(this.world, j.cons);
      }
    }
    // drift of roof relative to ground
    if (this.topCells.length && this.t > 0) {
      let s = 0;
      for (const b of this.topCells) s += b.position.x - b.cell.x0;
      const d = Math.abs(s / this.topCells.length - this.groundDx) / CS; // metres
      if (d > this.maxDrift) this.maxDrift = d;
    }
    // debris cleanup
    this.debris = this.debris.filter((d) => {
      if (this.t - d.born > 9 || d.position.x > WORLD_W + 400) { M.World.remove(this.world, d); return false; }
      return true;
    });
  }
  _disaster(t, dt) {
    const M = this.M, d = this.dis, D = d.duration;
    const ramp = (x) => Math.min(1, Math.max(0, x));
    if (d.type === "earthquake") {
      const f = d.freq, w = 2 * Math.PI * f;
      const a = peakGroundAccelG(d.mag) * G; // m/s^2
      const A = (a / (w * w)) * CS; // px
      const env = Math.pow(Math.sin(Math.PI / 2 * ramp(t / (0.15 * D))), 2) * ramp((D - t) / (0.25 * D));
      this.noise = this.noise * 0.9 + (Math.random() - 0.5) * 0.5;
      const x = A * env * (Math.sin(w * t) + 0.35 * Math.sin(w * 1.7 * t + 1.3) + this.noise);
      const dx = x - this.groundDx;
      this.groundDx = x;
      this.groundAccelG = a * env / G;
      M.Body.setPosition(this.ground, { x: WORLD_W / 2 + x, y: GROUND_Y + 40 }, true);
      for (const b of this.found) M.Body.setPosition(b, { x: b.cell.x0 + x, y: b.cell.y0 }, true);
      void dx;
    } else if (d.type === "wind") {
      const v10 = d.v * ramp(t / 8);
      const gust = 1 + 0.2 * Math.sin(t * 2.3) + 0.12 * Math.sin(t * 5.1 + 2) + (Math.random() - 0.5) * 0.1;
      this.windNow = v10 * gust;
      for (const b of this.bodies) {
        if (!b || b.isStatic) continue;
        const { c, r } = b.cell;
        const left = c === 0 || !this.grid[idx(c - 1, r)];
        const right = c === COLS - 1 || !this.grid[idx(c + 1, r)];
        const hgt = (ROWS - r - 0.5);
        const v = windSpeedAtHeight(this.windNow, hgt);
        const cd = ((left ? 1.0 : 0) + (right ? 0.7 : 0)) * 1.4; // Cp incl. internal pressure, x gust factor 1.4
        const up = r === 0 || !this.grid[idx(c, r - 1)] ? windForce(v, 0.9, 1) : 0; // roof suction (Cp ~ -0.9)
        if (cd || up) this._force(b, windForce(v, cd, 1), -up);
      }
      if (d.cat >= 3 && t > this.nextDebris) {
        this.nextDebris = t + (d.cat === 3 ? 1.6 : d.cat === 4 ? 1.0 : 0.6);
        const size = 9;
        const y = GROUND_Y - (1 + Math.random() * Math.max(2, this.height)) * CS;
        const deb = M.Bodies.rectangle(-30, y, size, size, { density: 0.006, friction: 0.3 });
        deb.born = this.t;
        M.Body.setVelocity(deb, { x: Math.min(9, this.windNow * 0.2 * 20 / 60 * 1.3), y: -0.5 });
        this.debris.push(deb);
        M.World.add(this.world, deb);
      }
    } else if (d.type === "flood") {
      this.waterH = d.depth * ramp(t / 8);
      this._water(t, 3);
    } else if (d.type === "tsunami") {
      // a bore that arrives, peaks, then recedes
      const u = t / D;
      const shape = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.1) / 0.6)));
      this.waterH = d.depth * shape;
      this._water(t, Math.sqrt(G * Math.max(0.1, this.waterH)) * 0.9, shape > 0.02);
    } else if (d.type === "snow") {
      const kpa = d.load * ramp(t / 6);
      this.snowNow = kpa;
      for (const b of this.bodies) {
        if (!b || b.isStatic) continue;
        const { c, r } = b.cell;
        if (r === 0 || !this.grid[idx(c, r - 1)]) this._force(b, 0, kpa * 1000);
      }
    }
  }
  _water(t, v, on = true) {
    if (!on) return;
    for (const b of this.bodies) {
      if (!b || b.isStatic) continue;
      const depthHere = this.waterH - (GROUND_Y - b.position.y) / CS; // m of water above this cell centre
      if (depthHere <= -0.5) continue;
      const sub = Math.max(0, Math.min(1, depthHere + 0.5));
      const { c, r } = b.cell;
      const left = c === 0 || !this.grid[idx(c - 1, r)];
      const fx = left ? 0.5 * RHO_WATER * v * v * 1.3 * sub : 0;
      const buoy = RHO_WATER * G * 0.5 * sub; // porous/hollow cells: half volume displaced
      this._force(b, fx, -buoy);
    }
  }
  stats() {
    let intact = 0, broken = 0;
    for (const j of this.joints) j.broken ? broken++ : intact++;
    let standing = 0;
    for (const b of this.bodies) {
      if (!b || b.isStatic) continue;
      const c = b.cell;
      if (Math.abs(b.position.y - c.y0) < 1.5 * CS && Math.abs(b.position.x - c.x0 - this.groundDx) < 4 * CS) standing += b.mass;
    }
    const standPct = this.totalMass > 0 ? (100 * standing) / this.totalMass : 100;
    return { intact, broken, total: this.joints.length, standPct, drift: this.maxDrift };
  }
  verdict(cost) {
    const s = this.stats();
    const brokenFrac = s.total ? s.broken / s.total : 0;
    let label = "Collapsed";
    if (s.standPct >= 90 && brokenFrac < 0.15) label = "Survived with minor damage";
    else if (s.standPct >= 50) label = "Partial collapse";
    const score = Math.max(0, Math.round(s.standPct * 0.8 + (1 - brokenFrac) * 20 - Math.min(10, s.drift)));
    const eff = cost > 0 ? (score / (cost / 1000)) : 0;
    return { label, score, eff, ...s };
  }
  destroy() {
    const M = this.M;
    try { M.World.clear(this.world, false); M.Engine.clear(this.engine); } catch (e) { /* ignore */ }
    this.bodies = []; this.joints = []; this.debris = []; this.found = [];
  }
}

// ---------- model info ----------
const STRUCTURE_MODEL_INFO = {
  title: "Structure Tester",
  concept: "Each grid cell is a 1 m rigid block joined to its neighbours by stiff constraints. Loads are applied as real forces scaled by each block's mass, and a joint snaps when its stretch exceeds a material limit. Collapse is what the physics engine does next, not a scripted outcome.",
  equation: "Wind: q = 0.5·rho·v², F = q·Cd·A (v rises with height as (h/10)^0.14). Seismic: base shear V = C_s·W with C_s ≈ PGA/g; ground x(t) = (a/ω²)·sin(ωt), ω = 2πf. Flood/tsunami drag: F = 0.5·rho_w·v²·Cd·A.",
  constants: [
    { name: "Air density rho", value: 1.225, unit: "kg/m³" },
    { name: "Water density rho_w", value: 1000, unit: "kg/m³" },
    { name: "Pressure coefficient windward / leeward (incl. internal pressure)", value: "1.0 / 0.7", unit: "× gust factor 1.4; roof suction 0.9" },
    { name: "Peak ground accel (approx.)", value: "0.03·10^(0.33·(M−4))", unit: "g, capped at 2" },
    { name: "Wood / Steel / Concrete density", value: "500 / 1500 / 2400", unit: "kg/m³ (stylized effective values for a 1 m cell; real solid steel is ~7850 kg/m³, but real steel structures are mostly open frames)" },
    { name: "Joint break stretch: Wood / Steel / Concrete / Brick / Glass", value: "0.17 / 0.34 / 0.22 / 0.12 / 0.07", unit: "px of joint stretch (stylized)" },
    { name: "Saffir-Simpson Cat 1-5 speeds used", value: "38 / 46 / 54 / 64 / 78", unit: "m/s" },
  ],
  assumptions: [
    "One cell is 1 m × 1 m × 1 m of unit depth; the structure is a 2D slice.",
    "Blocks are treated as solid at the listed effective density; a flooded cell displaces half its volume.",
    "Joint failure is a stretch threshold, a stand-in for tension, shear and bending capacity together.",
  ],
  limitations: [
    "Material strengths, densities and costs are STYLIZED TEACHING VALUES, not engineering data. Do not use them to judge a real building.",
    "No plasticity, fatigue, soil-structure interaction, torsion, 3D effects, resonance tuning or code-based load factors.",
    "The earthquake is a simple sinusoid plus noise, not a recorded ground motion; the magnitude-to-PGA map is a rough illustration (real PGA also depends strongly on distance from the fault, depth and soil, which this ignores).",
    "Flood and tsunami are simplified drag-plus-buoyancy loads; debris is a few small blocks.",
  ],
  sources: [
    "Saffir-Simpson Hurricane Wind Scale (NOAA/NHC)",
    "ASCE 7 minimum design loads (concepts: velocity pressure, seismic base shear V = Cs·W)",
    "USGS earthquake magnitude and shaking intensity references",
  ],
};

// ---------- UI ----------
const CSS = `
.st-root{display:flex;gap:12px;padding:0 20px 20px;box-sizing:border-box;height:calc(100vh - 170px);min-height:460px;color:var(--text)}
.st-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.st-canvas-wrap{flex:1;min-height:260px;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;position:relative}
.st-canvas-wrap canvas{width:100%;height:100%;display:block;touch-action:none;cursor:crosshair}
.st-side{width:300px;flex:none;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px}
.st-card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px}
.st-card h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim)}
.st-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.st-mat{display:flex;align-items:center;gap:6px;flex:1 1 130px;padding:5px 7px;border:1px solid var(--border);border-radius:6px;background:var(--panel-alt);color:var(--text);cursor:pointer;font-size:12px;text-align:left}
.st-mat.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.st-sw{width:14px;height:14px;border-radius:3px;flex:none;border:1px solid rgba(0,0,0,.3)}
.st-mat small{color:var(--text-dim);margin-left:auto}
.st-btn{padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--panel-alt);color:var(--text);cursor:pointer;font-size:12px}
.st-btn.on{border-color:var(--accent);color:var(--accent)}
.st-btn.go{background:var(--accent);color:#fff;border-color:var(--accent)}
.st-btn.stop{background:var(--danger);color:#fff;border-color:var(--danger)}
.st-btn:disabled{opacity:.5;cursor:default}
.st-side select{padding:5px;border:1px solid var(--border);border-radius:6px;background:var(--panel-alt);color:var(--text);width:100%}
.st-param{display:flex;flex-direction:column;gap:2px;font-size:12px;margin-top:6px}
.st-param input{width:100%}
.st-param b{color:var(--accent)}
.st-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px}
.st-stat{background:var(--panel-alt);border-radius:6px;padding:6px}
.st-stat span{display:block;color:var(--text-dim);font-size:11px}
.st-stat b{font-size:15px}
.st-verdict{border-left:4px solid var(--accent);font-size:13px}
.st-verdict.bad{border-left-color:var(--danger)}
.st-verdict.mid{border-left-color:var(--cool-2)}
.st-verdict h4{margin:0 0 4px;font-size:15px}
.st-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--text-dim)}
.st-bar b{color:var(--text)}
@media (max-width:820px){.st-root{flex-direction:column;height:auto}.st-side{width:auto;overflow-y:visible}.st-canvas-wrap{height:56vw;min-height:240px;flex:none}}
`;

export class StructureTester {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx || {};
    this.grid = emptyGrid();
    this.undo = []; this.redo = [];
    this.mat = "wood";
    this.tool = "place";
    this.disaster = "earthquake";
    this.p = { mag: 7, freq: 2, quakeDur: 12, cat: 3, depth: 4, snow: 4, wave: 5 };
    this.sim = null;
    this.result = null;
    this.raf = 0;
    this.built = false;
    this.painting = false;
    this.hover = null;
  }

  mount() {
    if (!document.getElementById("structures-styles")) {
      const st = document.createElement("style");
      st.id = "structures-styles";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!this.built) { this._build(); this.built = true; }
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener("resize", this._onResize);
    this.last = performance.now();
    this.acc = 0;
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      this._frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  unmount() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this._onResize) window.removeEventListener("resize", this._onResize);
    this._teardownSim();
    this.result = null;
    if (this.built) this._refresh();
  }

  _teardownSim() {
    if (this.sim) { this.sim.destroy(); this.sim = null; }
    if (this.frozenSim) { this.frozenSim.destroy(); this.frozenSim = null; }
  }

  // ----- DOM -----
  _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  _build() {
    const root = this.root;
    root.innerHTML = "";
    root.classList.add("st-root");
    const main = this._el("div", "st-main");
    const bar = this._el("div", "st-bar");
    this.budgetEl = this._el("span");
    this.liveEl = this._el("span");
    bar.append(this.budgetEl, this.liveEl);
    const wrap = this._el("div", "st-canvas-wrap");
    this.canvas = this._el("canvas");
    wrap.appendChild(this.canvas);
    main.append(bar, wrap);
    this.wrap = wrap;
    this.ctx2 = this.canvas.getContext("2d");
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this._pdown(e));
    c.addEventListener("pointermove", (e) => this._pmove(e));
    c.addEventListener("pointerup", (e) => this._pup(e));
    c.addEventListener("pointercancel", (e) => this._pup(e));
    c.addEventListener("pointerleave", () => { this.hover = null; });

    const side = this._el("div", "st-side");
    // materials
    const cm = this._el("div", "st-card");
    cm.appendChild(this._el("h3", null, "Materials"));
    const mrow = this._el("div", "st-row");
    this.matBtns = {};
    for (const id of MAT_ORDER) {
      const m = MATERIALS[id];
      const b = this._el("button", "st-mat");
      const sw = this._el("span", "st-sw"); sw.style.background = m.color;
      b.append(sw, this._el("span", null, m.name), this._el("small", null, "$" + m.cost));
      b.addEventListener("click", () => { this.mat = id; this.tool = "place"; this._refresh(); });
      this.matBtns[id] = b;
      mrow.appendChild(b);
    }
    cm.appendChild(mrow);
    side.appendChild(cm);
    // tools
    const ct = this._el("div", "st-card");
    ct.appendChild(this._el("h3", null, "Tools"));
    const trow = this._el("div", "st-row");
    const mk = (label, fn) => { const b = this._el("button", "st-btn", label); b.addEventListener("click", fn); trow.appendChild(b); return b; };
    this.placeBtn = mk("Place", () => { this.tool = "place"; this._refresh(); });
    this.eraseBtn = mk("Erase", () => { this.tool = "erase"; this._refresh(); });
    this.undoBtn = mk("Undo", () => this._undo());
    this.redoBtn = mk("Redo", () => this._redo());
    this.clearBtn = mk("Clear", () => { if (this.grid.some(Boolean)) { this._push(); this.grid = emptyGrid(); this._refresh(); } });
    ct.appendChild(trow);
    const sel = this._el("select");
    sel.appendChild(new Option("Load a template...", ""));
    for (const [k, n] of [["house", "Simple house"], ["tower", "Tower"], ["bridge", "Bridge"], ["braced", "Braced frame"]]) sel.appendChild(new Option(n, k));
    sel.style.marginTop = "8px";
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      this._push(); this.grid = TEMPLATES[sel.value](); sel.value = ""; this.result = null; this._refresh();
    });
    ct.appendChild(sel);
    side.appendChild(ct);
    // disaster
    const cd = this._el("div", "st-card");
    cd.appendChild(this._el("h3", null, "Disaster"));
    this.disSel = this._el("select");
    for (const k of Object.keys(DISASTERS)) this.disSel.appendChild(new Option(DISASTERS[k].name, k));
    this.disSel.addEventListener("change", () => { this.disaster = this.disSel.value; this._renderParams(); });
    cd.appendChild(this.disSel);
    this.paramBox = this._el("div");
    cd.appendChild(this.paramBox);
    const brow = this._el("div", "st-row"); brow.style.marginTop = "10px";
    this.testBtn = this._el("button", "st-btn go", "Test");
    this.testBtn.addEventListener("click", () => this._startTest());
    this.stopBtn = this._el("button", "st-btn stop", "Stop / Reset");
    this.stopBtn.addEventListener("click", () => this._reset());
    brow.append(this.testBtn, this.stopBtn);
    cd.appendChild(brow);
    side.appendChild(cd);
    // stats
    const cs = this._el("div", "st-card");
    cs.appendChild(this._el("h3", null, "Live results"));
    const g = this._el("div", "st-stats");
    this.statEls = {};
    for (const [k, n] of [["intact", "Intact joints"], ["broken", "Broken joints"], ["drift", "Max roof drift"], ["stand", "Mass standing"]]) {
      const s = this._el("div", "st-stat"); s.append(this._el("span", null, n)); const b = this._el("b", null, "-"); s.appendChild(b);
      this.statEls[k] = b; g.appendChild(s);
    }
    cs.appendChild(g);
    this.verdictEl = this._el("div", "st-card st-verdict");
    this.verdictEl.style.display = "none";
    cs.appendChild(this.verdictEl);
    this.verdictEl.style.marginTop = "8px";
    side.appendChild(cs);
    const info = this._el("button", "st-btn", "How this works");
    info.addEventListener("click", async () => {
      const { openModelInfo } = await import("./modelInfo.js");
      openModelInfo(STRUCTURE_MODEL_INFO);
    });
    side.appendChild(info);
    root.append(main, side);
    this._renderParams();
    this._refresh();
  }

  _renderParams() {
    const box = this.paramBox;
    box.innerHTML = "";
    const slider = (label, key, min, max, step, fmt) => {
      const w = this._el("div", "st-param");
      const l = this._el("label"); const v = this._el("b");
      const inp = this._el("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = this.p[key];
      const upd = () => { this.p[key] = Number(inp.value); l.textContent = label + ": "; v.textContent = fmt(this.p[key]); l.appendChild(v); };
      inp.addEventListener("input", upd); upd();
      w.append(l, inp); box.appendChild(w);
    };
    const d = this.disaster;
    if (d === "earthquake") {
      slider("Magnitude", "mag", 4, 9, 0.1, (x) => `M${x.toFixed(1)} (~${(peakGroundAccelG(x)).toFixed(2)} g peak)`);
      slider("Frequency", "freq", 0.5, 8, 0.1, (x) => x.toFixed(1) + " Hz");
      slider("Duration", "quakeDur", 5, 30, 1, (x) => x + " s");
    } else if (d === "wind") slider("Category", "cat", 1, 5, 1, (x) => `Cat ${x} (${SAFFIR[x - 1].v} m/s)`);
    else if (d === "flood") slider("Water depth", "depth", 1, 10, 0.5, (x) => x + " m");
    else if (d === "tsunami") slider("Wave height", "wave", 2, 12, 0.5, (x) => x + " m");
    else slider("Snow load", "snow", 1, 20, 0.5, (x) => x + " kPa");
  }

  _dis() {
    const p = this.p, d = this.disaster;
    if (d === "earthquake") return { type: d, mag: p.mag, freq: p.freq, duration: p.quakeDur };
    if (d === "wind") return { type: d, cat: p.cat, v: SAFFIR[p.cat - 1].v, duration: 18 };
    if (d === "flood") return { type: d, depth: p.depth, duration: 14 };
    if (d === "tsunami") return { type: d, depth: p.wave, duration: 12 };
    return { type: d, load: p.snow, duration: 14 };
  }

  // ----- editing -----
  _push() { this.undo.push(this.grid.slice()); if (this.undo.length > 100) this.undo.shift(); this.redo = []; }
  _undo() { if (this.sim || !this.undo.length) return; this.redo.push(this.grid); this.grid = this.undo.pop(); this._refresh(); }
  _redo() { if (this.sim || !this.redo.length) return; this.undo.push(this.grid); this.grid = this.redo.pop(); this._refresh(); }

  _cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const v = this.view;
    if (!v) return null;
    const x = ((e.clientX - r.left) - v.ox) / v.s, y = ((e.clientY - r.top) - v.oy) / v.s;
    const c = Math.floor(x / CS), rr = Math.floor(y / CS);
    if (c < 0 || c >= COLS || rr < 0 || rr >= ROWS) return null;
    return { c, r: rr };
  }
  _paint(cell) {
    if (!cell) return;
    const i = idx(cell.c, cell.r);
    if (this.tool === "erase") { if (this.grid[i]) { this.grid[i] = null; this._dirty = true; } return; }
    if (this.mat === "foundation" && cell.r !== ROWS - 1) return; // anchors only at ground level
    if (this.grid[i] === this.mat) return;
    const cur = this.grid[i] ? MATERIALS[this.grid[i]].cost : 0;
    if (gridCost(this.grid) - cur + MATERIALS[this.mat].cost > BUDGET) return;
    this.grid[i] = this.mat; this._dirty = true;
  }
  _pdown(e) {
    if (this.sim) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    this.painting = true; this._dirty = false;
    this._push();
    this._paint(this._cellAt(e));
  }
  _pmove(e) {
    this.hover = this._cellAt(e);
    if (this.painting) this._paint(this.hover);
  }
  _pup() {
    if (!this.painting) return;
    this.painting = false;
    if (!this._dirty) this.undo.pop();
    else this.result = null;
    this._refresh();
  }

  // ----- test lifecycle -----
  _startTest() {
    if (this.sim || !this.grid.some(Boolean) || !globalThis.Matter) return;
    this._teardownSim();
    this.result = null;
    this.startCost = gridCost(this.grid);
    this.sim = new StructureSim(this.grid, this._dis());
    this.hist = [];
    this.acc = 0; this.last = performance.now();
    this._refresh();
  }
  _reset() {
    this._teardownSim();
    this.result = null;
    this._refresh();
  }

  _refresh() {
    if (!this.built) return;
    const cost = gridCost(this.grid), testing = !!this.sim;
    this.budgetEl.innerHTML = "";
    const b1 = this._el("b", null, `$${cost} / $${BUDGET}`);
    this.budgetEl.append("Budget: ", b1, `  ($${BUDGET - cost} left)`);
    for (const id of MAT_ORDER) this.matBtns[id].classList.toggle("on", this.tool === "place" && this.mat === id);
    this.placeBtn.classList.toggle("on", this.tool === "place");
    this.eraseBtn.classList.toggle("on", this.tool === "erase");
    this.undoBtn.disabled = testing || !this.undo.length;
    this.redoBtn.disabled = testing || !this.redo.length;
    this.clearBtn.disabled = testing;
    this.testBtn.disabled = testing;
    this.disSel.disabled = testing;
    const v = this.result;
    this.verdictEl.style.display = v ? "block" : "none";
    if (v) {
      this.verdictEl.className = "st-card st-verdict" + (v.label === "Collapsed" ? " bad" : v.label === "Partial collapse" ? " mid" : "");
      this.verdictEl.innerHTML = "";
      this.verdictEl.append(this._el("h4", null, v.label),
        this._el("div", null, `Score ${v.score} / 100`),
        this._el("div", null, `Cost efficiency ${v.eff.toFixed(1)} points per $1000 (cost $${this.startCost})`));
    }
    if (!testing && !v) for (const k in this.statEls) this.statEls[k].textContent = "-";
  }

  // ----- frame loop -----
  _frame(now) {
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (this.sim) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1000 / 60 && n < 3) { this.sim.step(1000 / 60); this.acc -= 1000 / 60; n++; }
      if (this.acc > 100) this.acc = 0;
      this.hist.push(this.sim.groundDx);
      if (this.hist.length > 240) this.hist.shift();
      const s = this.sim.stats();
      this.statEls.intact.textContent = s.intact;
      this.statEls.broken.textContent = s.broken;
      this.statEls.drift.textContent = s.drift.toFixed(2) + " m";
      this.statEls.stand.textContent = s.standPct.toFixed(0) + "%";
      this.liveEl.textContent = `t = ${Math.max(0, this.sim.t).toFixed(1)} s / ${this.sim.duration} s`;
      if (this.sim.finished) {
        this.result = this.sim.verdict(this.startCost);
        this.frozenSim = this.sim; // keep the final picture until reset / next test
        this.sim = null;
        this._refresh();
      }
    }
    this._draw();
  }

  _resize() {
    if (!this.canvas) return;
    const r = this.wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(50, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(50, Math.floor(r.height * dpr));
    this.dpr = dpr; this.cw = r.width; this.ch = r.height;
  }

  _draw() {
    const ctx = this.ctx2;
    if (!ctx || !this.cw) return;
    const cs = getComputedStyle(this.root);
    const col = (n, d) => (cs.getPropertyValue(n) || d).trim() || d;
    const text = col("--text", "#222"), dim = col("--text-dim", "#777"), border = col("--border", "#ccc"), panelAlt = col("--panel-alt", "#eee");
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    const margin = 30;
    const s = Math.min(this.cw / (WORLD_W + margin * 2), this.ch / (GROUND_Y + 50));
    const ox = (this.cw - WORLD_W * s) / 2, oy = Math.max(4, this.ch - (GROUND_Y + 40) * s);
    this.view = { s, ox, oy };
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(s, s);
    const sim = this.sim || this.frozenSim;
    // sky grid
    ctx.strokeStyle = border; ctx.globalAlpha = 0.35; ctx.lineWidth = 0.5 / s;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) { ctx.moveTo(c * CS, 0); ctx.lineTo(c * CS, GROUND_Y); }
    for (let r = 0; r <= ROWS; r++) { ctx.moveTo(0, r * CS); ctx.lineTo(WORLD_W, r * CS); }
    ctx.stroke(); ctx.globalAlpha = 1;
    const dx = sim ? sim.groundDx : 0;
    // water
    if (sim && sim.waterH > 0) {
      ctx.fillStyle = "rgba(60,130,220,0.35)";
      const h = sim.waterH * CS;
      ctx.fillRect(-margin, GROUND_Y - h, WORLD_W + margin * 2, h);
    }
    // ground
    ctx.fillStyle = panelAlt; ctx.fillRect(-margin + dx, GROUND_Y, WORLD_W + margin * 2, 40);
    ctx.strokeStyle = dim; ctx.lineWidth = 1.5 / s;
    ctx.beginPath(); ctx.moveTo(-margin + dx, GROUND_Y); ctx.lineTo(WORLD_W + margin + dx, GROUND_Y); ctx.stroke();
    if (!sim) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const id = this.grid[idx(c, r)];
        if (!id) continue;
        this._cell(ctx, id, c * CS + CS / 2, r * CS + CS / 2, 0, CS - 1, null, s);
      }
      if (this.hover && !this.sim) {
        ctx.strokeStyle = this.tool === "erase" ? "#d93a3a" : "#3b6fe0"; ctx.lineWidth = 2 / s;
        ctx.strokeRect(this.hover.c * CS, this.hover.r * CS, CS, CS);
      }
    } else {
      for (const b of sim.bodies) {
        if (!b) continue;
        const ang = b.angle;
        this._cell(ctx, b.cell.id, b.position.x, b.position.y, ang, CS - 0.5, b.cell.ratio, s);
      }
      ctx.fillStyle = "#555";
      for (const d of sim.debris) ctx.fillRect(d.position.x - 4.5, d.position.y - 4.5, 9, 9);
      for (const j of sim.joints) if (j.broken) {
        ctx.fillStyle = "#d93a3a";
        const mx = (j.a.position.x + j.b.position.x) / 2, my = (j.a.position.y + j.b.position.y) / 2;
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }
    ctx.restore();
    // seismograph / status overlays
    ctx.fillStyle = text; ctx.font = "12px sans-serif";
    if (this.sim && this.hist && this.sim.dis.type === "earthquake" && this.hist.length > 1) {
      const w = 140, h = 36, x0 = this.cw - w - 10, y0 = 10;
      ctx.strokeStyle = dim; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h);
      ctx.strokeStyle = "#d93a3a"; ctx.beginPath();
      const amp = Math.max(0.5, ...this.hist.map(Math.abs));
      this.hist.forEach((v, i) => { const x = x0 + (i / 240) * w, y = y0 + h / 2 - (v / amp) * (h / 2 - 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = dim; ctx.fillText("ground motion", x0, y0 + h + 12);
    }
    if (this.sim && this.sim.dis.type === "wind" && this.sim.windNow) {
      ctx.fillStyle = dim; ctx.fillText(`wind ${this.sim.windNow.toFixed(0)} m/s  q = ${(windPressure(this.sim.windNow) / 1000).toFixed(2)} kPa`, 10, 16);
    }
    if (!sim && !this.grid.some(Boolean)) {
      ctx.fillStyle = dim; ctx.textAlign = "center";
      ctx.fillText("Pick a material and click or drag on the grid, or load a template.", this.cw / 2, this.ch / 2);
      ctx.textAlign = "start";
    }
  }

  _cell(ctx, id, x, y, ang, size, ratio, s) {
    const m = MATERIALS[id];
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    const h = size / 2;
    if (id === "brace") {
      ctx.fillStyle = ratio != null ? stressColor(ratio) : m.color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-h, -h, size, size);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#7a5a10"; ctx.lineWidth = 2 / s;
      ctx.beginPath(); ctx.moveTo(-h, -h); ctx.lineTo(h, h); ctx.moveTo(h, -h); ctx.lineTo(-h, h); ctx.stroke();
    } else {
      ctx.fillStyle = ratio != null && id !== "foundation" ? stressColor(ratio) : m.color;
      if (id === "glass" && ratio == null) ctx.globalAlpha = 0.75;
      ctx.fillRect(-h, -h, size, size);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = m.color; ctx.lineWidth = 2 / s;
      ctx.strokeRect(-h + 1, -h + 1, size - 2, size - 2);
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1 / s;
      ctx.strokeRect(-h, -h, size, size);
    }
    ctx.restore();
  }
}
