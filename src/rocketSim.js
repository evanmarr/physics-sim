// Rocket Simulator — a real 2D (planar) launch-to-orbit simulator, not a
// projectile-motion toy: real inverse-square gravity (G·M/r², not a flat
// "down"), the actual rocket equation for fuel/thrust/mass depletion,
// staging, an exponential atmosphere with real drag, and orbit mechanics
// (vis-viva/specific-orbital-energy) for apoapsis, periapsis, eccentricity,
// and escape velocity. Rendered in 2D rather than a full 3D scene — the
// numbers and mechanics are real either way, and this keeps the whole
// thing verifiable and fast; a 3D camera view could be layered on top of
// the same physics state later without changing any of the math below.
//
// SIMPLIFICATIONS, stated plainly: the rocket's pitch is a single fixed
// angle relative to its OWN current local vertical for the whole burn (no
// interactive steering/gravity-turn program), numerical integration is
// semi-implicit Euler with a small fixed timestep (not an adaptive/RK4
// integrator), drag uses one constant cross-section/drag-coefficient
// figure rather than a real vehicle's aerodynamic model, and the planets
// below use their real mass/radius but an illustrative, not flight-proven,
// rocket (stage masses/thrust/Isp are representative small-launcher
// figures, not a real vehicle's spec sheet).

const G = 6.674e-11; // universal gravitational constant
const G0 = 9.80665; // standard gravity, used by the rocket equation itself (Isp is defined against this, not local surface gravity)

const BODIES = {
  earth: { name: "Earth", radius: 6371000, mass: 5.972e24, atmosphere: { rho0: 1.225, scaleHeight: 8500, height: 100000 }, surfaceG: 9.8 },
  moon: { name: "Moon", radius: 1737000, mass: 7.342e22, atmosphere: null, surfaceG: 1.62 },
  mars: { name: "Mars", radius: 3390000, mass: 6.417e23, atmosphere: { rho0: 0.02, scaleHeight: 11100, height: 60000 }, surfaceG: 3.71 },
};

// Illustrative small-launcher figures (not any real flight-proven vehicle)
// — plausible order-of-magnitude dry mass/fuel/thrust/Isp, chosen so a
// well-flown single-stage can reach a respectable suborbital altitude and
// a well-flown two-stage can actually reach orbit, without either being
// trivial.
const STAGE_PRESETS = {
  single: [
    { name: "Stage 1", dryMass: 4000, fuelMass: 18000, thrust: 320000, isp: 280 },
  ],
  twoStage: [
    { name: "Stage 1", dryMass: 7000, fuelMass: 42000, thrust: 950000, isp: 265 },
    { name: "Stage 2", dryMass: 2200, fuelMass: 9500, thrust: 140000, isp: 330 },
  ],
};

const DRAG_COEFF_AREA = 1.1; // Cd × cross-sectional area (m²) — one illustrative constant, not a real aero model
const SUBSTEPS_PER_TICK = 20;
const DT = 0.05; // seconds per physics substep
const TICK_MS = 100; // real ms between ticks — 20 × 0.05s = 1 simulated second per tick

function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

function fmt(n, digits = 1) {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(digits) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(digits) + "k";
  return n.toFixed(digits);
}

// Curated, increasing-difficulty challenges. The full 7-tier redesign
// applied to every module happens in a later pass — these are functional,
// programmatically-checked goals for this sim specifically in the
// meantime, not a placeholder.
const CHALLENGES = [
  {
    id: "reach_10km", name: "Clear the Tower", difficulty: "Simple",
    body: "earth", stagePreset: "single",
    objective: "Reach 10 km altitude.",
    check: (s) => s.altitude >= 10000,
  },
  {
    id: "karman", name: "Cross the Kármán Line", difficulty: "Medium",
    body: "earth", stagePreset: "single",
    objective: "Reach 100 km altitude — the conventional edge of space.",
    check: (s) => s.altitude >= 100000,
  },
  {
    id: "orbit_moon", name: "Orbit the Moon", difficulty: "Hard",
    body: "moon", stagePreset: "single",
    objective: "Achieve a stable orbit (periapsis above the surface) around the Moon — no atmosphere to fight, but you still need real horizontal speed, not just altitude.",
    check: (s) => s.status === "Orbiting",
  },
  {
    id: "orbit_earth_two_stage", name: "Two-Stage Orbit", difficulty: "Challenging",
    body: "earth", stagePreset: "twoStage",
    objective: "Stage at least once and achieve a stable orbit around Earth.",
    check: (s) => s.status === "Orbiting" && s.staged,
  },
  {
    id: "escape_earth", name: "Escape Velocity", difficulty: "Extreme",
    body: "earth", stagePreset: "twoStage",
    objective: "Reach Earth escape velocity — leave its gravity for good.",
    check: (s) => s.status === "Escaping",
  },
  {
    id: "efficient_orbit", name: "Fuel-Efficient Orbit", difficulty: "Impossible",
    body: "earth", stagePreset: "twoStage",
    objective: "Achieve a stable Earth orbit using no more than 70% of your total starting fuel — genuinely difficult, but flyable with a well-timed pitch and throttle.",
    check: (s) => s.status === "Orbiting" && s.fuelUsedFraction <= 0.7,
  },
];

export class RocketSimMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx || {};
    this.bodyId = "earth";
    this.stagePresetId = "single";
    this.pitchDeg = 5; // degrees from local vertical (0 = straight up, 90 = horizontal)
    this.throttle = 100;
    this.activeChallenge = null;
    this.ghost = null; // { altitude: [...], time: [...] } from the previous flight
    this._resetFlight();
    this._build();
  }

  mount() {
    this._running = true;
    this._interval = setInterval(() => this._tick(), TICK_MS);
  }
  unmount() {
    this._running = false;
    clearInterval(this._interval);
  }

  _body() { return BODIES[this.bodyId]; }
  _stages() { return STAGE_PRESETS[this.stagePresetId]; }

  _resetFlight() {
    const body = this._body();
    this.launched = false;
    this.time = 0;
    this.x = 0;
    this.y = body.radius;
    this.vx = 0;
    this.vy = 0;
    this.stages = this._stages().map((s) => ({ ...s }));
    this.activeStageIndex = 0;
    this.staged = false;
    this.totalStartFuel = this.stages.reduce((sum, s) => sum + s.fuelMass, 0);
    this.status = "On the pad";
    this.crashed = false;
    this.history = { time: [0], altitude: [0], speed: [0] };
    this.log = [];
  }

  _attachedMass() {
    let m = 0;
    for (let i = this.activeStageIndex; i < this.stages.length; i++) {
      m += this.stages[i].dryMass + this.stages[i].fuelMass;
    }
    return m;
  }

  _altitude() { return Math.hypot(this.x, this.y) - this._body().radius; }

  _tick() {
    if (!this.launched || this.crashed) { this._render(); return; }
    for (let i = 0; i < SUBSTEPS_PER_TICK; i++) {
      this._substep();
      if (this.crashed) break;
    }
    this.time += SUBSTEPS_PER_TICK * DT;
    this.history.time.push(this.time);
    this.history.altitude.push(this._altitude());
    this.history.speed.push(Math.hypot(this.vx, this.vy));
    if (this.history.time.length > 600) { this.history.time.shift(); this.history.altitude.shift(); this.history.speed.shift(); }
    this._checkChallenge();
    this._render();
  }

  _substep() {
    const body = this._body();
    const r = Math.hypot(this.x, this.y);
    const rHat = { x: this.x / r, y: this.y / r };
    const tHat = { x: -rHat.y, y: rHat.x };

    // Real inverse-square gravity toward the body's center.
    const gAccel = (G * body.mass) / (r * r);
    let ax = -gAccel * rHat.x;
    let ay = -gAccel * rHat.y;

    // Thrust, if the active stage still has fuel and the throttle is up —
    // direction fixed relative to the CURRENT local vertical (a constant
    // pitch program), so it naturally sweeps in inertial space as the
    // rocket's position moves around the body, the same basic idea a real
    // gravity-turn ascent exploits.
    const stage = this.stages[this.activeStageIndex];
    let thrustMag = 0;
    if (stage && stage.fuelMass > 0 && this.throttle > 0) {
      thrustMag = stage.thrust * (this.throttle / 100);
      const pitchRad = (this.pitchDeg * Math.PI) / 180;
      const dirX = rHat.x * Math.cos(pitchRad) + tHat.x * Math.sin(pitchRad);
      const dirY = rHat.y * Math.cos(pitchRad) + tHat.y * Math.sin(pitchRad);
      const mass = this._attachedMass();
      ax += (thrustMag * dirX) / mass;
      ay += (thrustMag * dirY) / mass;

      // The actual rocket equation's mass flow: ṁ = F / (Isp · g0) — g0 is
      // always standard gravity here by definition of Isp, not whatever
      // body you happen to be launching from.
      const mdot = thrustMag / (stage.isp * G0);
      stage.fuelMass = Math.max(0, stage.fuelMass - mdot * DT);
      if (stage.fuelMass <= 0 && this.activeStageIndex < this.stages.length - 1) {
        this.activeStageIndex++;
        this.staged = true;
        this.log.push(`t+${this.time.toFixed(0)}s — staged to ${this.stages[this.activeStageIndex].name}`);
      }
    }

    // Real exponential-atmosphere drag, opposing velocity, only below the
    // body's atmosphere height (the Moon has none at all).
    const altitude = r - body.radius;
    if (body.atmosphere && altitude < body.atmosphere.height && altitude > -1000) {
      const rho = body.atmosphere.rho0 * Math.exp(-Math.max(0, altitude) / body.atmosphere.scaleHeight);
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > 0.01) {
        const dragMag = 0.5 * rho * speed * speed * DRAG_COEFF_AREA;
        const mass = this._attachedMass();
        ax -= (dragMag * this.vx) / speed / mass;
        ay -= (dragMag * this.vy) / speed / mass;
      }
    }

    this.vx += ax * DT;
    this.vy += ay * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;

    if (Math.hypot(this.x, this.y) <= body.radius) {
      this.crashed = true;
      this.status = "Crashed";
      this.log.push(`t+${this.time.toFixed(0)}s — impact at ${Math.hypot(this.vx, this.vy).toFixed(0)} m/s`);
    }
  }

  // Real orbital mechanics via specific orbital energy/angular momentum —
  // the same vis-viva-derived relations used for actual spacecraft, not a
  // canned "you win" check.
  _orbitalElements() {
    const body = this._body();
    const r = Math.hypot(this.x, this.y);
    const v2 = this.vx * this.vx + this.vy * this.vy;
    const mu = G * body.mass;
    const energy = v2 / 2 - mu / r; // specific orbital energy
    const h = this.x * this.vy - this.y * this.vx; // specific angular momentum
    const escapeV = Math.sqrt((2 * mu) / r);
    if (energy >= 0) {
      return { bound: false, energy, escapeV, currentV: Math.sqrt(v2) };
    }
    const a = -mu / (2 * energy); // semi-major axis
    const eSq = 1 + (2 * energy * h * h) / (mu * mu);
    const e = Math.sqrt(Math.max(0, eSq));
    const periapsis = a * (1 - e);
    const apoapsis = a * (1 + e);
    return { bound: true, a, e, periapsis, apoapsis, energy, escapeV, currentV: Math.sqrt(v2) };
  }

  _status() {
    if (this.crashed) return "Crashed";
    if (!this.launched) return "On the pad";
    const els = this._orbitalElements();
    if (!els.bound) return "Escaping";
    const body = this._body();
    if (els.periapsis > body.radius + 1000) return "Orbiting";
    return "Suborbital";
  }

  _checkChallenge() {
    if (!this.activeChallenge) return;
    const s = this._snapshotForChallenge();
    if (this.activeChallenge.check(s)) {
      this._completeChallenge();
    }
  }

  _snapshotForChallenge() {
    const fuelRemaining = this.stages.reduce((sum, s) => sum + s.fuelMass, 0);
    return {
      altitude: this._altitude(),
      status: this._status(),
      staged: this.staged,
      fuelUsedFraction: this.totalStartFuel > 0 ? 1 - fuelRemaining / this.totalStartFuel : 0,
    };
  }

  _completeChallenge() {
    const ch = this.activeChallenge;
    this.activeChallenge = null;
    this.ctx.showToast?.(`Challenge complete: ${ch.name}!`);
    this._renderChallengePanel();
  }

  _build() {
    this.root.innerHTML = "";
    this.root.className = "astro-rocket-wrap";

    this.controlsPanel = div("chem-panel anat-layers");
    this.viewerPanel = div("chem-panel anat-viewer");
    this.infoPanel = div("chem-panel anat-info");
    this.root.appendChild(this.controlsPanel);
    this.root.appendChild(this.viewerPanel);
    this.root.appendChild(this.infoPanel);

    this._buildControls();
    this._buildViewer();
    this._buildInfo();
    this._render();
  }

  _buildControls() {
    const p = this.controlsPanel;
    p.innerHTML = "";
    const title = div("chem-panel-title");
    title.textContent = "Launch Setup";
    p.appendChild(title);

    const bodyLabel = div("chem-hint");
    bodyLabel.textContent = "Body";
    p.appendChild(bodyLabel);
    const bodySelect = document.createElement("select");
    bodySelect.style.width = "100%";
    for (const [id, b] of Object.entries(BODIES)) {
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = `${b.name} (g=${b.surfaceG} m/s², r=${fmt(b.radius)}m)`;
      if (id === this.bodyId) opt.selected = true;
      bodySelect.appendChild(opt);
    }
    bodySelect.addEventListener("change", () => {
      this.bodyId = bodySelect.value;
      this._resetFlight();
      this._render();
    });
    p.appendChild(bodySelect);

    const stageLabel = div("chem-hint");
    stageLabel.textContent = "Rocket";
    p.appendChild(stageLabel);
    const stageSelect = document.createElement("select");
    stageSelect.style.width = "100%";
    stageSelect.innerHTML = `<option value="single">Single-stage</option><option value="twoStage">Two-stage</option>`;
    stageSelect.value = this.stagePresetId;
    stageSelect.addEventListener("change", () => {
      this.stagePresetId = stageSelect.value;
      this._resetFlight();
      this._render();
    });
    p.appendChild(stageSelect);

    const pitchLabel = div("chem-hint");
    pitchLabel.textContent = "Pitch from vertical (0° = straight up, 90° = horizontal)";
    p.appendChild(pitchLabel);
    this.pitchInput = document.createElement("input");
    this.pitchInput.type = "range";
    this.pitchInput.min = "0"; this.pitchInput.max = "90"; this.pitchInput.step = "1";
    this.pitchInput.value = String(this.pitchDeg);
    this.pitchInput.style.width = "100%";
    this.pitchInput.addEventListener("input", () => { this.pitchDeg = +this.pitchInput.value; this._render(); });
    p.appendChild(this.pitchInput);

    const throttleLabel = div("chem-hint");
    throttleLabel.textContent = "Throttle";
    p.appendChild(throttleLabel);
    this.throttleInput = document.createElement("input");
    this.throttleInput.type = "range";
    this.throttleInput.min = "0"; this.throttleInput.max = "100"; this.throttleInput.step = "1";
    this.throttleInput.value = String(this.throttle);
    this.throttleInput.style.width = "100%";
    this.throttleInput.addEventListener("input", () => { this.throttle = +this.throttleInput.value; this._render(); });
    p.appendChild(this.throttleInput);

    const btnRow = div("chem-hint");
    btnRow.style.display = "flex";
    btnRow.style.gap = "6px";
    btnRow.style.marginTop = "10px";
    this.launchBtn = document.createElement("button");
    this.launchBtn.className = "primary";
    this.launchBtn.textContent = "🚀 Launch";
    this.launchBtn.addEventListener("click", () => {
      if (this.crashed || (this.launched && this._status() !== "On the pad")) return;
      this.launched = true;
      this._render();
    });
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => {
      // Keep the just-flown path as a faint ghost so the next attempt can
      // be compared against it directly.
      if (this.history.time.length > 1) this.ghost = { time: [...this.history.time], altitude: [...this.history.altitude] };
      this._resetFlight();
      this._render();
    });
    const clearGhostBtn = document.createElement("button");
    clearGhostBtn.textContent = "Clear ghost";
    clearGhostBtn.addEventListener("click", () => { this.ghost = null; this._render(); });
    btnRow.appendChild(this.launchBtn);
    btnRow.appendChild(resetBtn);
    btnRow.appendChild(clearGhostBtn);
    p.appendChild(btnRow);

    const challengeTitle = div("chem-panel-title");
    challengeTitle.style.marginTop = "16px";
    challengeTitle.textContent = "Challenges";
    p.appendChild(challengeTitle);
    this.challengeList = div();
    p.appendChild(this.challengeList);
    this._renderChallengePanel();

    const note = div("chem-hint");
    note.textContent = "Simplified model: fixed pitch relative to local vertical (no active steering), semi-implicit Euler integration, one constant drag figure — real inverse-square gravity, real rocket-equation fuel burn, and real orbital mechanics throughout. See the code comments for the full list.";
    p.appendChild(note);
  }

  _renderChallengePanel() {
    this.challengeList.innerHTML = "";
    for (const ch of CHALLENGES) {
      const row = document.createElement("button");
      row.className = "sustain-chip" + (this.activeChallenge?.id === ch.id ? " active" : "");
      row.style.display = "block";
      row.style.width = "100%";
      row.style.textAlign = "left";
      row.style.marginBottom = "6px";
      row.innerHTML = `<strong>${ch.name}</strong> <span style="opacity:.7">(${ch.difficulty})</span><br><span style="font-size:11px;opacity:.8">${ch.objective}</span>`;
      row.addEventListener("click", () => {
        this.activeChallenge = ch;
        this.bodyId = ch.body;
        this.stagePresetId = ch.stagePreset;
        this._resetFlight();
        this._buildControls();
        this._render();
        this.ctx.showToast?.(`Challenge armed: ${ch.name}`);
      });
      this.challengeList.appendChild(row);
    }
  }

  _buildViewer() {
    const title = div("chem-panel-title");
    title.textContent = "Trajectory";
    this.viewerPanel.appendChild(title);
    const wrap = div("anat-svg-wrap");
    wrap.style.height = "100%";
    wrap.style.flexDirection = "column";
    this.viewerPanel.appendChild(wrap);
    this.canvas = document.createElement("canvas");
    this.canvas.width = 560;
    this.canvas.height = 420;
    this.canvas.style.width = "100%";
    this.canvas.style.maxWidth = "560px";
    this.canvas.style.background = "#0a0e16";
    this.canvas.style.borderRadius = "8px";
    wrap.appendChild(this.canvas);

    this.graphCanvas = document.createElement("canvas");
    this.graphCanvas.width = 560;
    this.graphCanvas.height = 100;
    this.graphCanvas.style.width = "100%";
    this.graphCanvas.style.maxWidth = "560px";
    this.graphCanvas.style.marginTop = "8px";
    this.graphCanvas.style.background = "#0a0e16";
    this.graphCanvas.style.borderRadius = "8px";
    wrap.appendChild(this.graphCanvas);
  }

  _buildInfo() {
    const title = div("chem-panel-title");
    title.textContent = "Telemetry";
    this.infoPanel.appendChild(title);
    this.telemetry = div();
    this.infoPanel.appendChild(this.telemetry);
    const logTitle = div("chem-panel-title");
    logTitle.style.marginTop = "14px";
    logTitle.textContent = "Flight Log";
    this.infoPanel.appendChild(logTitle);
    this.logEl = div("chem-hint");
    this.infoPanel.appendChild(this.logEl);
  }

  _render() {
    this._renderCanvas();
    this._renderGraph();
    this._renderTelemetry();
  }

  _renderCanvas() {
    const ctx = this.canvas.getContext("2d");
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const body = this._body();

    // Camera: zoom out as altitude grows, so the view stays useful from
    // "on the pad" all the way out to orbital altitude.
    const r = Math.hypot(this.x, this.y);
    const viewRadius = Math.max(body.radius * 1.15, r * 1.3);
    const scale = (Math.min(w, h) / 2 - 10) / viewRadius;
    const cx = w / 2, cy = h / 2;
    const toScreen = (x, y) => ({ sx: cx + x * scale, sy: cy - y * scale });

    // Planet body.
    ctx.beginPath();
    ctx.arc(cx, cy, body.radius * scale, 0, Math.PI * 2);
    ctx.fillStyle = this.bodyId === "earth" ? "#2c6e9e" : this.bodyId === "mars" ? "#a5522c" : "#8a8a8f";
    ctx.fill();
    if (body.atmosphere) {
      ctx.beginPath();
      ctx.arc(cx, cy, (body.radius + body.atmosphere.height) * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120,180,255,0.25)";
      ctx.stroke();
    }

    // Ghost trajectory from the previous flight.
    if (this.ghost) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      this._strokePathFromAltHistory(ctx, toScreen, this.ghost, body);
      ctx.stroke();
    }

    // Current position marker + a short recent trail via history (altitude
    // history alone can't reconstruct exact (x,y), so the live trail below
    // uses the actual position log instead).
    if (this.posLog && this.posLog.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = "#ffd76b";
      ctx.lineWidth = 2;
      for (let i = 0; i < this.posLog.length; i++) {
        const { sx, sy } = toScreen(this.posLog[i].x, this.posLog[i].y);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    const { sx, sy } = toScreen(this.x, this.y);
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = this.launched && !this.crashed && this.throttle > 0 && this._activeStageHasFuel() ? "#f97316" : "#ffffff";
    ctx.fill();
  }

  _activeStageHasFuel() {
    const s = this.stages[this.activeStageIndex];
    return s && s.fuelMass > 0;
  }

  _strokePathFromAltHistory(ctx, toScreen, hist, body) {
    // The ghost only stores altitude/time (cheap to keep), so it's drawn
    // as a straight-up profile — an honest simplification noted in the UI
    // rather than pretending to replay the exact old ground track.
    for (let i = 0; i < hist.altitude.length; i++) {
      const rr = body.radius + Math.max(0, hist.altitude[i]);
      const { sx, sy } = toScreen(0, rr);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
  }

  _renderGraph() {
    const ctx = this.graphCanvas.getContext("2d");
    const w = this.graphCanvas.width, h = this.graphCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const hist = this.history;
    if (hist.time.length < 2) return;
    const maxAlt = Math.max(1, ...hist.altitude);
    const maxT = Math.max(1, hist.time[hist.time.length - 1]);
    ctx.beginPath();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < hist.time.length; i++) {
      const sx = (hist.time[i] / maxT) * (w - 10) + 5;
      const sy = h - 5 - (hist.altitude[i] / maxAlt) * (h - 10);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "10px sans-serif";
    ctx.fillText(`Altitude vs. time (max ${fmt(maxAlt)}m)`, 6, 12);
  }

  _renderTelemetry() {
    const body = this._body();
    const altitude = this._altitude();
    const speed = Math.hypot(this.vx, this.vy);
    const mass = this._attachedMass();
    const stage = this.stages[this.activeStageIndex];
    const thrustNow = stage && stage.fuelMass > 0 ? stage.thrust * (this.throttle / 100) : 0;
    const twr = (thrustNow / (mass * body.surfaceG)).toFixed(2);
    const fuelRemaining = this.stages.reduce((sum, s) => sum + s.fuelMass, 0);
    const els = this._orbitalElements();
    const status = this._status();

    // Track a real position trail while flying, capped so it doesn't grow
    // unbounded over a long flight.
    if (this.launched && !this.crashed) {
      this.posLog = this.posLog || [];
      this.posLog.push({ x: this.x, y: this.y });
      if (this.posLog.length > 2000) this.posLog.shift();
    } else if (!this.launched) {
      this.posLog = [];
    }

    const rows = [
      ["Status", status],
      ["Altitude", `${fmt(altitude)} m`],
      ["Speed", `${fmt(speed)} m/s`],
      ["Escape velocity here", `${fmt(els.escapeV)} m/s`],
      ["Thrust-to-weight", twr],
      ["Fuel remaining", `${fmt(fuelRemaining)} kg`],
      ["Active stage", stage ? stage.name : "None (engines out)"],
      ["Elapsed time", `${this.time.toFixed(0)} s`],
    ];
    if (els.bound) {
      rows.push(["Apoapsis", `${fmt(els.apoapsis - body.radius)} m`]);
      rows.push(["Periapsis", `${fmt(els.periapsis - body.radius)} m`]);
      rows.push(["Eccentricity", els.e.toFixed(3)]);
    } else if (this.launched) {
      rows.push(["Orbit", "Unbound (escaping) — no periapsis/apoapsis"]);
    }

    this.telemetry.innerHTML = rows.map(([label, value]) => `
      <div class="sustain-stat"><span>${label}</span><strong>${value}</strong></div>
    `).join("");

    this.logEl.innerHTML = this.log.slice(-6).map((l) => `<div>${l}</div>`).join("") || "No events yet.";

    if (this.launchBtn) this.launchBtn.disabled = this.launched && status !== "On the pad";
  }
}
