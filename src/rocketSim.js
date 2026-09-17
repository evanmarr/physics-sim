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

import { assertFullLadder, difficultyBadgeHtml } from "./challengeTiers.js";
import { PLANETS, planetPosition, moonOffsetFromEarth, dateToJulianDate } from "./astronomyData.js";
import { openModelInfo } from "./modelInfo.js";

const G = 6.674e-11; // universal gravitational constant
const G0 = 9.80665; // standard gravity, used by the rocket equation itself (Isp is defined against this, not local surface gravity)
const AU_METERS = 1.495978707e11;
const EARTH_ELEMENTS = PLANETS.find((p) => p.name === "Earth");
const VENUS_ELEMENTS = PLANETS.find((p) => p.name === "Venus");
const MARS_ELEMENTS = PLANETS.find((p) => p.name === "Mars");

const BODIES = {
  earth: { name: "Earth", radius: 6371000, mass: 5.972e24, atmosphere: { rho0: 1.225, scaleHeight: 8500, height: 100000 }, surfaceG: 9.8 },
  moon: { name: "Moon", radius: 1737000, mass: 7.342e22, atmosphere: null, surfaceG: 1.62 },
  mars: { name: "Mars", radius: 3390000, mass: 6.417e23, atmosphere: { rho0: 0.02, scaleHeight: 11100, height: 60000 }, surfaceG: 3.71 },
};

// Illustrative small-launcher figures (not any real flight-proven vehicle)
// for the three challenge-calibrated presets — plausible order-of-magnitude
// dry mass/fuel/thrust/Isp, chosen so a well-flown single-stage can reach a
// respectable suborbital altitude and a well-flown two-stage can actually
// reach orbit, without either being trivial. The remaining entries are real
// rockets, for free flight — approximate published first-stage figures
// (dry/propellant mass, sea-level thrust, sea-level Isp), each with its own
// real length/diameter so "zoom in on the rocket" shows something honest.
// Multi-stage real vehicles are collapsed to their first stage only here —
// this sim doesn't model a full multi-stage real ascent profile for them.
const STAGE_PRESETS = {
  // Deliberately much smaller than "single" — a real sounding rocket, not a
  // scaled-down orbital launcher. Sized so a straightforward full-throttle,
  // near-vertical burn to depletion naturally apexes in the 40-60 km band
  // used by Apogee Window, rather than needing a split-second manual
  // throttle cutoff on a rocket with 10x more fuel than the target needs.
  sounding: {
    displayName: "Sounding Rocket (challenge-tuned)",
    length: 6, diameter: 0.3,
    stages: [{ name: "Sounding Stage", dryMass: 800, fuelMass: 1600, thrust: 47000, isp: 260 }],
  },
  single: {
    displayName: "Single-Stage Launcher (challenge-tuned)",
    length: 22, diameter: 2.2,
    stages: [{ name: "Stage 1", dryMass: 4000, fuelMass: 18000, thrust: 320000, isp: 280 }],
  },
  twoStage: {
    displayName: "Two-Stage Launcher (challenge-tuned)",
    length: 32, diameter: 2.6,
    stages: [
      { name: "Stage 1", dryMass: 7000, fuelMass: 42000, thrust: 950000, isp: 265 },
      { name: "Stage 2", dryMass: 2200, fuelMass: 9500, thrust: 140000, isp: 330 },
    ],
  },
  electron: {
    displayName: "Rocket Lab Electron (real, 1st stage)",
    length: 18, diameter: 1.2,
    stages: [{ name: "Stage 1", dryMass: 950, fuelMass: 2150, thrust: 216000, isp: 303 }],
  },
  falcon9: {
    displayName: "SpaceX Falcon 9 (real, 1st stage)",
    length: 70, diameter: 3.7,
    stages: [{ name: "Stage 1", dryMass: 25600, fuelMass: 395700, thrust: 7607000, isp: 282 }],
  },
  atlasV: {
    displayName: "ULA Atlas V 401 (real, 1st stage)",
    length: 58.3, diameter: 3.81,
    stages: [{ name: "Stage 1", dryMass: 21054, fuelMass: 284089, thrust: 3827000, isp: 311 }],
  },
  saturnV: {
    displayName: "Saturn V (real, 1st stage)",
    length: 110.6, diameter: 10.1,
    stages: [{ name: "Stage 1 (S-IC)", dryMass: 130000, fuelMass: 2077000, thrust: 34020000, isp: 263 }],
  },
};

const DRAG_COEFF_AREA = 1.1; // Cd × cross-sectional area (m²) — one illustrative constant, not a real aero model
const SUBSTEPS_PER_TICK = 20;
const DT = 0.05; // seconds per physics substep
const TICK_MS = 100; // real ms between ticks — 20 × 0.05s = 1 simulated second per tick

// How far the trajectory view can zoom: ZOOM_MAX gets close enough to see
// the rocket itself as a real rectangle, not a dot; ZOOM_MIN, combined with
// panning, is wide enough to pull Earth or the Moon down to a speck and
// actually reach the farthest companion body drawn by companionsFor()
// (roughly Mars's real current distance — which varies day to day, unlike
// the Moon's near-constant one).
const ZOOM_MIN = 0.000004;
const ZOOM_MAX = 400;

// Real companion positions (direction AND distance, both accurate for
// "now," not a fixed illustrative placement) — reuses the exact same real
// Keplerian propagation (src/astronomyData.js) as the Solar System mode,
// rather than a separate, less accurate model. This sim otherwise only
// tracks gravity around ONE body at a time, so a companion's position here
// is a real snapshot of where it actually is right now, not something this
// sim itself is simulating the motion of frame to frame.
function companionsFor(bodyId) {
  const jd = dateToJulianDate(new Date());
  const moon = moonOffsetFromEarth(jd); // AU, accurate direction; real mean distance
  const earthVec = planetPosition(EARTH_ELEMENTS, jd);
  const venusVec = planetPosition(VENUS_ELEMENTS, jd);
  const marsVec = planetPosition(MARS_ELEMENTS, jd);
  const toMeters = (au) => au * AU_METERS;

  if (bodyId === "earth") {
    return [
      { name: "Moon", x: toMeters(moon.x), y: toMeters(moon.y), radius: BODIES.moon.radius, color: "#b8bcc4" },
      { name: "Venus", x: toMeters(venusVec.x - earthVec.x), y: toMeters(venusVec.y - earthVec.y), radius: 6051800, color: "#e0c16c" },
      { name: "Mars", x: toMeters(marsVec.x - earthVec.x), y: toMeters(marsVec.y - earthVec.y), radius: BODIES.mars.radius, color: "#a5522c" },
    ];
  }
  if (bodyId === "moon") {
    return [{ name: "Earth", x: -toMeters(moon.x), y: -toMeters(moon.y), radius: BODIES.earth.radius, color: "#2c6e9e" }];
  }
  if (bodyId === "mars") {
    return [{ name: "Earth", x: toMeters(earthVec.x - marsVec.x), y: toMeters(earthVec.y - marsVec.y), radius: BODIES.earth.radius, color: "#2c6e9e" }];
  }
  return [];
}

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

// Full 7-tier ladder, sharing the same difficulty scale and metadata shape
// as Physics (src/challenges.js): objective, startingState, successCondition,
// hint, explanation, source, plus this module's own body/stagePreset/check.
const CHALLENGES = [
  {
    id: "reach_10km", name: "Clear the Tower", difficulty: "Simple",
    concept: "Basic powered ascent",
    body: "earth", stagePreset: "single",
    objective: "Get off the pad and reach 10 km altitude.",
    startingState: "A single-stage rocket sitting on the pad at Earth, throttle and pitch both under your control before launch.",
    successCondition: "Altitude reaches at least 10,000 m.",
    hint: "Straight up (0° pitch) at full throttle clears 10 km easily — this one is about learning the controls, not fighting them.",
    explanation: "The rocket equation and inverse-square gravity are both fully real underneath, but at this altitude and burn time neither one is close to a limiting factor yet — thrust just needs to exceed weight for long enough.",
    source: "Newton's second law applied to a rocket: net upward force = thrust − weight − drag.",
    check: (s) => s.altitude >= 10000,
  },
  {
    id: "apogee_window", name: "Apogee Window", difficulty: "Easy",
    concept: "A target BAND, not just a minimum — overshoot fails too",
    body: "earth", stagePreset: "sounding",
    objective: "Fly the small sounding rocket so its peak altitude lands inside a target band, then let it fall back and confirm the peak was actually reached.",
    startingState: "A much smaller sounding rocket (far less fuel and thrust than Clear the Tower's launcher) sits on the Earth pad.",
    successCondition: "The flight's peak altitude (apogee) ends up between 40,000 m and 60,000 m — not lower, not higher — and the rocket has visibly passed that peak and started descending.",
    hint: "Full or near-full throttle, close to straight up (pitch around 0-15°), and just let the whole tank burn out — this rocket's fuel budget is sized so that flying it sensibly lands the apogee in the band, without needing an exact throttle-cutoff moment.",
    explanation: "Clear the Tower only asked for 'at least X.' This asks for a band — overshoot is a failure condition too — and pairs that with a rocket sized so hitting the band is about flying it sensibly (roughly vertical, full burn), not about split-second engine-cutoff timing.",
    source: "Vertical (or near-vertical) unpowered coast after burnout: apogee is set by the velocity and altitude the rocket has at engine cutoff (here, at fuel depletion).",
    check: (s) => !s.crashed && s.maxAltitude >= 40000 && s.maxAltitude <= 60000 && s.altitude < s.maxAltitude - 1000,
  },
  {
    id: "karman", name: "Cross the Kármán Line", difficulty: "Medium",
    concept: "Sustained thrust against real atmospheric drag",
    body: "earth", stagePreset: "single",
    objective: "Reach 100 km altitude — the conventional edge of space.",
    startingState: "Same single-stage rocket and pad start as Clear the Tower.",
    successCondition: "Altitude reaches at least 100,000 m.",
    hint: "This needs real, sustained thrust the whole way — a shallow pitch (close to straight up) minimizes the horizontal distance drag has to act over while you're still deep in the thick lower atmosphere.",
    explanation: "Ten times higher than Clear the Tower is not just '10x more of the same' — the single stage's fuel budget is fixed, and exponential atmospheric drag is strongest low down, so the ascent profile (how steep, how early you commit the fuel) starts to actually matter.",
    source: "Exponential atmosphere model ρ(h) = ρ₀·e^(−h/H); drag force = ½ρv²·Cd·A.",
    check: (s) => s.altitude >= 100000,
  },
  {
    id: "orbit_moon", name: "Orbit the Moon", difficulty: "Hard",
    concept: "Real orbital insertion — a burn-coast-circularize sequence, not one continuous burn",
    body: "moon", stagePreset: "single",
    objective: "Achieve a stable orbit (periapsis above the surface) around the Moon — no atmosphere to fight, but you still need real horizontal speed, not just altitude.",
    startingState: "A single-stage rocket on the Moon's surface — no atmosphere, much lower gravity than Earth.",
    successCondition: "Orbit status reads 'Orbiting' — a bound orbit whose periapsis stays above the lunar surface.",
    hint: "One continuous burn to fuel depletion always overshoots this rocket straight past a valid orbit into an escape trajectory — there's no single throttle/pitch setting that lands you in between. Instead fly it in two burns like a real insertion: pitch to around 65-75° and burn for roughly 95-100 seconds (watch Apoapsis climb), then cut the throttle to 0 and coast. Once Apoapsis stops climbing and the rocket is falling back (past its peak), throttle back up for a short 5-10 second burn pitched to 90° (straight sideways) — that circularizes the orbit by raising Periapsis without changing Apoapsis much. The engine can be re-lit any time fuel remains.",
    explanation: "A single ever-increasing burn keeps raising both energy and angular momentum together, and for this rocket's fuel budget the point where angular momentum is finally enough to lift periapsis above the surface arrives only after energy has already crossed into escape — there's no continuous-burn setting that lands in between. Splitting it into a burn to raise apoapsis, a coast, and a short tangential burn AT apoapsis to raise periapsis is the same two-step logic real orbital insertions use, and it works because thrust applied exactly along the velocity direction at apoapsis raises periapsis efficiently without much added energy.",
    source: "Specific orbital energy ε = v²/2 − μ/r and specific angular momentum h = x·vy − y·vx together determine the resulting orbit's periapsis and apoapsis; a tangential burn at apoapsis is the efficient way to raise periapsis (a Hohmann-style circularization).",
    check: (s) => s.status === "Orbiting",
  },
  {
    id: "orbit_earth_two_stage", name: "Two-Stage Orbit", difficulty: "Challenging",
    concept: "Staging timing combined with orbital insertion",
    body: "earth", stagePreset: "twoStage",
    objective: "Stage at least once and achieve a stable orbit around Earth.",
    startingState: "A two-stage rocket on the Earth pad — a much bigger first stage plus a smaller, more efficient second stage.",
    successCondition: "The rocket has staged at least once AND orbit status reads 'Orbiting.'",
    hint: "Let the first stage burn out completely and stage automatically, then keep pitching over toward horizontal through the second stage's burn — Earth's atmosphere and stronger gravity mean you need both stages' fuel to get there, unlike the Moon.",
    explanation: "This stacks Orbit the Moon's two-variable altitude/speed insertion on top of a THIRD moving part — the staging event itself changes the vehicle's mass and available thrust mid-flight, plus you're fighting Earth's atmosphere and stronger gravity the whole way, so the same insertion technique now has to survive a discontinuity in the middle of the burn.",
    source: "The rocket equation applied per stage (Δv = Isp·g0·ln(m0/m1)) — staging discards dead mass so the remaining fuel buys more Δv.",
    check: (s) => s.status === "Orbiting" && s.staged,
  },
  {
    id: "escape_earth", name: "Escape Velocity", difficulty: "Extreme",
    concept: "Crossing an unbound-trajectory threshold under real drag and staging",
    body: "earth", stagePreset: "twoStage",
    objective: "Reach Earth escape velocity — leave its gravity for good.",
    startingState: "Same two-stage rocket and Earth pad start as Two-Stage Orbit.",
    successCondition: "Orbit status reads 'Escaping' — specific orbital energy is zero or positive (an unbound trajectory).",
    hint: "You need more raw speed than an orbit requires, not just the right direction — burn as much of both stages as you can as steeply toward horizontal as the atmosphere allows without losing too much to drag low down; a late, aggressive pitch-over tends to waste less fuel fighting drag first.",
    explanation: "Orbiting is a bound ellipse — negative specific orbital energy. Escaping requires pushing that same energy value past zero entirely, which at Earth (deeper gravity well, real atmosphere) takes close to everything both stages have, leaving very little margin for a wasted pitch or a late stage.",
    source: "Escape velocity v_esc = √(2μ/r); the trajectory is unbound exactly when specific orbital energy ε ≥ 0.",
    check: (s) => s.status === "Escaping",
  },
  {
    id: "efficient_orbit", name: "Fuel-Efficient Orbit", difficulty: "Impossible",
    concept: "Multi-variable optimization, not just reaching a state",
    body: "earth", stagePreset: "twoStage",
    objective: "Achieve a stable Earth orbit using no more than 70% of your total starting fuel — genuinely difficult, but flyable with a well-timed pitch and throttle.",
    startingState: "Same two-stage rocket and Earth pad start as Two-Stage Orbit.",
    successCondition: "Orbit status reads 'Orbiting' AND total fuel used across both stages is at most 70% of the combined starting fuel mass.",
    hint: "Full throttle wastes fuel fighting drag low in the atmosphere. Climb closer to vertical at a lower throttle through the thick lower air, THEN pitch hard toward horizontal and open the throttle once you're higher up and drag has dropped off — the goal is minimizing gravity AND drag losses at once, not just eventually reaching orbit.",
    explanation: "Every earlier orbit challenge only asked whether you could reach the state at all. This asks for the state under a resource constraint, which means the ascent profile itself becomes the thing being optimized — burn timing, pitch profile, and throttle all trade off against each other instead of any one of them alone being 'more is better.'",
    source: "Gravity losses and drag losses are both real, separate Δv costs baked into this ascent — an efficient profile minimizes the time spent fighting either one.",
    check: (s) => s.status === "Orbiting" && s.fuelUsedFraction <= 0.7,
  },
];
assertFullLadder(CHALLENGES, "Rocket Simulator");

// Content here is drawn directly from this file's own top-of-file
// implementation comment — the same claims stated there, just structured
// for the panel, not new/separate claims about the sandbox.
const ROCKET_MODEL_INFO = {
  title: "Rocket Simulator",
  concept: "A real 2D launch-to-orbit simulator: genuine inverse-square gravity, the actual rocket equation for fuel/thrust/mass depletion, exponential-atmosphere drag, staging, and real orbital mechanics — not a projectile-motion toy.",
  equation: "a = F_thrust/m − GM/r²·r̂ − F_drag/m,     ṁ = F_thrust/(Isp·g₀)",
  variables: [
    { symbol: "G", meaning: "universal gravitational constant", unit: "6.674×10⁻¹¹ m³/(kg·s²)" },
    { symbol: "M, r", meaning: "the body's mass and your current distance from its center" },
    { symbol: "Isp, g₀", meaning: "specific impulse and standard gravity (9.80665 m/s²) — Isp is always defined against g₀, not local surface gravity" },
  ],
  assumptions: [
    "Pitch is a single fixed angle relative to the rocket's OWN current local vertical for the whole burn — no interactive steering/gravity-turn program.",
    "Atmosphere density falls off exponentially with altitude (ρ = ρ₀·e^(−h/H)); the Moon has none at all.",
  ],
  limitations: [
    "Numerical integration is semi-implicit Euler with a small fixed timestep, not an adaptive/RK4 integrator.",
    "Drag uses one constant cross-section/drag-coefficient figure, not a real vehicle's full aerodynamic model.",
    "Planets use real mass/radius; the rocket itself (stage mass/thrust/Isp) is an illustrative small-launcher figure, not any specific real vehicle's spec sheet.",
    "Companion body (Moon/Venus/Mars) positions are real current ephemeris (direction AND distance), but this sim only tracks gravity around ONE body at a time — it isn't a full N-body solar system.",
  ],
  sources: ["Newton's law of universal gravitation", "The Tsiolkovsky rocket equation", "Vis-viva / specific orbital energy for apoapsis, periapsis, and escape velocity"],
};

export class RocketSimMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx || {};
    this.bodyId = "earth";
    this.stagePresetId = "single";
    this.pitchDeg = 5; // degrees from local vertical (0 = straight up, 90 = horizontal)
    this.throttle = 100;
    this.activeChallenge = null;
    this.ghost = null; // [{x,y}, ...] real position trail from the previous flight
    this.viewZoom = 1; // user-controlled multiplier on top of the auto-fit camera — see _renderCanvas
    this.viewPanX = 0; // world-meter camera offset from the central body, from click-dragging the canvas
    this.viewPanY = 0;
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
  _preset() { return STAGE_PRESETS[this.stagePresetId]; }
  _stages() { return this._preset().stages; }

  _resetFlight() {
    const body = this._body();
    this.launched = false;
    this.time = 0;
    this.x = 0;
    this.y = body.radius;
    this.vx = 0;
    this.vy = 0;
    this.maxAltitude = 0;
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
    this.maxAltitude = Math.max(this.maxAltitude, this._altitude());
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
    // Eccentricity vector — points from the focus (the planet) toward
    // periapsis, magnitude e. Used only to orient the dotted orbit ellipse
    // drawn in _renderCanvas; e itself (the scalar above) already has what
    // the telemetry panel needs.
    const rDotV = this.x * this.vx + this.y * this.vy;
    const evX = ((v2 - mu / r) * this.x - rDotV * this.vx) / mu;
    const evY = ((v2 - mu / r) * this.y - rDotV * this.vy) / mu;
    const periapsisAngle = Math.atan2(evY, evX);
    return { bound: true, a, e, periapsis, apoapsis, energy, escapeV, currentV: Math.sqrt(v2), periapsisAngle };
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
      maxAltitude: this.maxAltitude,
      crashed: this.crashed,
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
    for (const [id, preset] of Object.entries(STAGE_PRESETS)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = preset.displayName;
      stageSelect.appendChild(opt);
    }
    stageSelect.value = this.stagePresetId;
    this.rocketSpecEl = div("chem-hint");
    const updateRocketSpec = () => {
      const preset = this._preset();
      const totalFuel = preset.stages.reduce((sum, s) => sum + s.fuelMass, 0);
      const totalDry = preset.stages.reduce((sum, s) => sum + s.dryMass, 0);
      const maxThrust = Math.max(...preset.stages.map((s) => s.thrust));
      this.rocketSpecEl.textContent = `${preset.stages.length} stage(s) · ${fmt(totalFuel)}kg fuel · ${fmt(totalDry)}kg dry · ${fmt(maxThrust)}N max thrust · ${preset.length}m × ${preset.diameter}m`;
    };
    stageSelect.addEventListener("change", () => {
      this.stagePresetId = stageSelect.value;
      updateRocketSpec();
      this._resetFlight();
      this._render();
    });
    p.appendChild(stageSelect);
    updateRocketSpec();
    p.appendChild(this.rocketSpecEl);

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
      // Keep the just-flown path (the real position trail, not just an
      // altitude number) as a faint dotted ghost so the next attempt can be
      // compared against the actual shape of the old trajectory.
      if (this.posLog && this.posLog.length > 1) this.ghost = this.posLog.map((p) => ({ x: p.x, y: p.y }));
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

    const infoBtn = document.createElement("button");
    infoBtn.textContent = "ℹ️ How This Model Works";
    infoBtn.style.marginTop = "10px";
    infoBtn.addEventListener("click", () => openModelInfo(ROCKET_MODEL_INFO));
    p.appendChild(infoBtn);
  }

  _renderChallengePanel() {
    this.challengeList.innerHTML = "";
    for (const ch of CHALLENGES) {
      const card = div();
      card.style.border = "1px solid rgba(128,128,128,0.25)";
      card.style.borderRadius = "8px";
      card.style.padding = "8px";
      card.style.marginBottom = "8px";
      card.style.background = this.activeChallenge?.id === ch.id ? "rgba(100,140,255,0.12)" : "transparent";

      card.innerHTML = `
        <div><strong>${ch.name}</strong> ${difficultyBadgeHtml(ch.difficulty)}</div>
        <div style="font-size:11px;opacity:.85;margin-top:4px">${ch.objective}</div>
        <div style="font-size:11px;opacity:.7;margin-top:4px"><em>Success:</em> ${ch.successCondition}</div>
      `;

      const armBtn = document.createElement("button");
      armBtn.textContent = this.activeChallenge?.id === ch.id ? "Armed ✓" : "Arm this challenge";
      armBtn.style.marginTop = "6px";
      armBtn.addEventListener("click", () => {
        this.activeChallenge = ch;
        this.bodyId = ch.body;
        this.stagePresetId = ch.stagePreset;
        this._resetFlight();
        this._buildControls();
        this._render();
        this.ctx.showToast?.(`Challenge armed: ${ch.name}`);
      });
      card.appendChild(armBtn);

      const hintBtn = document.createElement("button");
      hintBtn.textContent = "Show hint";
      hintBtn.style.marginTop = "6px";
      hintBtn.style.marginLeft = "4px";
      const hintText = div("chem-hint");
      hintText.style.display = "none";
      hintText.textContent = ch.hint;
      hintBtn.addEventListener("click", () => {
        const showing = hintText.style.display !== "none";
        hintText.style.display = showing ? "none" : "block";
        hintBtn.textContent = showing ? "Show hint" : "Hide hint";
      });
      card.appendChild(hintBtn);
      card.appendChild(hintText);

      const whyBtn = document.createElement("button");
      whyBtn.textContent = "Why this works";
      whyBtn.style.marginTop = "6px";
      whyBtn.style.marginLeft = "4px";
      const whyText = div("chem-hint");
      whyText.style.display = "none";
      whyText.innerHTML = `${ch.explanation}<br><em>${ch.source}</em>`;
      whyBtn.addEventListener("click", () => {
        const showing = whyText.style.display !== "none";
        whyText.style.display = showing ? "none" : "block";
        whyBtn.textContent = showing ? "Why this works" : "Hide";
      });
      card.appendChild(whyBtn);
      card.appendChild(whyText);

      this.challengeList.appendChild(card);
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

    // Scroll/pinch to zoom in on the trajectory canvas — layered on top of
    // the auto-fit camera in _renderCanvas rather than replacing it, so
    // "Reset View" can always get back to a sane default. The range is wide
    // on purpose: zoomed all the way in shows the rocket itself close-up;
    // zoomed all the way out from Earth or the Moon reaches far enough to
    // reveal the other one at its true distance (see _renderCanvas's moon
    // marker) — real astronomical distances, not a decorative prop.
    this.canvas.style.cursor = "grab";
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.001);
      this.viewZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.viewZoom * factor));
      this._renderCanvas();
    }, { passive: false });

    // Click-drag to pan — independent of zoom, so you can recenter the view
    // on the rocket, the planet's limb, or empty space out toward the Moon
    // without that also changing scale.
    let dragging = false, dragStart = null, panStart = null;
    this.canvas.addEventListener("mousedown", (e) => {
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      panStart = { x: this.viewPanX, y: this.viewPanY };
      this.canvas.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const scale = this._currentScale();
      this.viewPanX = panStart.x - (e.clientX - dragStart.x) / scale;
      this.viewPanY = panStart.y + (e.clientY - dragStart.y) / scale;
      this._renderCanvas();
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      this.canvas.style.cursor = "grab";
    });

    // Touch equivalents of the mouse pan/zoom above — one finger drags to
    // pan (same math as the mouse path), two fingers pinch to zoom (scaling
    // viewZoom by the change in finger-to-finger distance since the last
    // move, same clamp range as wheel/buttons).
    let pinchStartDist = null, pinchStartZoom = null;
    const touchDist = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    this.canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        dragging = true;
        dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        panStart = { x: this.viewPanX, y: this.viewPanY };
      } else if (e.touches.length === 2) {
        dragging = false;
        pinchStartDist = touchDist(e.touches[0], e.touches[1]);
        pinchStartZoom = this.viewZoom;
      }
    }, { passive: false });
    this.canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && dragging) {
        const scale = this._currentScale();
        this.viewPanX = panStart.x - (e.touches[0].clientX - dragStart.x) / scale;
        this.viewPanY = panStart.y + (e.touches[0].clientY - dragStart.y) / scale;
        this._renderCanvas();
      } else if (e.touches.length === 2 && pinchStartDist) {
        const factor = touchDist(e.touches[0], e.touches[1]) / pinchStartDist;
        this.viewZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinchStartZoom * factor));
        this._renderCanvas();
      }
    }, { passive: false });
    const touchEnd = (e) => {
      if (e.touches.length === 0) { dragging = false; pinchStartDist = null; }
      else if (e.touches.length === 1) { pinchStartDist = null; }
    };
    this.canvas.addEventListener("touchend", touchEnd);
    this.canvas.addEventListener("touchcancel", touchEnd);

    const zoomRow = div("chem-hint");
    zoomRow.style.display = "flex";
    zoomRow.style.gap = "6px";
    zoomRow.style.marginTop = "6px";
    const zoomOutBtn = document.createElement("button");
    zoomOutBtn.textContent = "−";
    zoomOutBtn.title = "Zoom out";
    zoomOutBtn.addEventListener("click", () => { this.viewZoom = Math.max(ZOOM_MIN, this.viewZoom / 1.7); this._renderCanvas(); });
    const zoomInBtn = document.createElement("button");
    zoomInBtn.textContent = "+";
    zoomInBtn.title = "Zoom in";
    zoomInBtn.addEventListener("click", () => { this.viewZoom = Math.min(ZOOM_MAX, this.viewZoom * 1.7); this._renderCanvas(); });
    const zoomResetBtn = document.createElement("button");
    zoomResetBtn.textContent = "Reset View";
    zoomResetBtn.addEventListener("click", () => { this.viewZoom = 1; this.viewPanX = 0; this.viewPanY = 0; this._renderCanvas(); });
    zoomRow.appendChild(zoomOutBtn);
    zoomRow.appendChild(zoomInBtn);
    zoomRow.appendChild(zoomResetBtn);
    wrap.appendChild(zoomRow);

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
    const scale = ((Math.min(w, h) / 2 - 10) / viewRadius) * this.viewZoom;
    this._lastScale = scale;
    const cx = w / 2, cy = h / 2;
    const toScreen = (x, y) => ({ sx: cx + (x - this.viewPanX) * scale, sy: cy - (y - this.viewPanY) * scale });
    const planetPt = toScreen(0, 0);

    // Planet body — drawn through toScreen (not fixed at the canvas center)
    // so panning actually moves it, the same as everything else in the view.
    ctx.beginPath();
    ctx.arc(planetPt.sx, planetPt.sy, body.radius * scale, 0, Math.PI * 2);
    ctx.fillStyle = this.bodyId === "earth" ? "#2c6e9e" : this.bodyId === "mars" ? "#a5522c" : "#8a8a8f";
    ctx.fill();
    if (body.atmosphere) {
      ctx.beginPath();
      ctx.arc(planetPt.sx, planetPt.sy, (body.radius + body.atmosphere.height) * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120,180,255,0.25)";
      ctx.stroke();
    }

    this._drawCompanions(ctx, toScreen, planetPt);
    this._drawOrbitEllipse(ctx, toScreen);

    // Ghost trajectory from the previous flight — the real position trail,
    // drawn dotted so it reads clearly as a past attempt, not the live path.
    if (this.ghost && this.ghost.length > 1) {
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < this.ghost.length; i++) {
        const { sx, sy } = toScreen(this.ghost[i].x, this.ghost[i].y);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Current position marker + a short recent trail via the real position log.
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

    this._drawRocket(ctx, toScreen, scale);
  }

  // Drawn as a real rectangle (length × diameter, from the active rocket
  // preset) rather than a fixed-size dot, so zooming all the way in (see
  // ZOOM_MAX) actually reveals the rocket's shape. A screen-size floor keeps
  // it visible as a small marker at low zoom instead of disappearing.
  _drawRocket(ctx, toScreen, scale) {
    const { x, y } = this;
    const r = Math.hypot(x, y) || 1;
    const rHat = { x: x / r, y: y / r };
    const tHat = { x: -rHat.y, y: rHat.x };
    const pitchRad = (this.pitchDeg * Math.PI) / 180;
    const dirX = rHat.x * Math.cos(pitchRad) + tHat.x * Math.sin(pitchRad);
    const dirY = rHat.y * Math.cos(pitchRad) + tHat.y * Math.sin(pitchRad);
    const angle = Math.atan2(dirY, dirX);

    const preset = this._preset();
    const lengthPx = Math.max(6, preset.length * scale);
    const diamPx = Math.max(3, preset.diameter * scale);

    const { sx, sy } = toScreen(x, y);
    ctx.save();
    ctx.translate(sx, sy);
    // Canvas y grows downward while world y (and thus dirY) grows upward,
    // so screen-space rotation is the negated world angle, offset by 90°
    // since the rectangle's local "length" axis is drawn along local +y.
    ctx.rotate(-angle + Math.PI / 2);
    ctx.fillStyle = this.launched && !this.crashed && this.throttle > 0 && this._activeStageHasFuel() ? "#f97316" : "#ffffff";
    ctx.fillRect(-diamPx / 2, -lengthPx / 2, diamPx, lengthPx);
    ctx.restore();
  }

  // The Moon (Earth ↔ Moon) plus a small set of other planets, each shown
  // as a marker at its real current position (see companionsFor — actual
  // ephemeris, not a fixed placement). No ring/orbit line is drawn around
  // these — the dotted line in this view is reserved for the ROCKET's own
  // orbit (see _drawOrbitEllipse just below), not another planet's.
  _drawCompanions(ctx, toScreen, planetPt) {
    for (const c of companionsFor(this.bodyId)) {
      const { sx, sy } = toScreen(c.x, c.y);
      const r = Math.max(1.5, c.radius * this._lastScale);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(c.name, sx, sy - r - 6);
      ctx.textAlign = "left";
    }
  }

  // The rocket's OWN current orbit around whichever body it's at — a real
  // Keplerian ellipse (one focus at the planet's center), reconstructed
  // from the live state vector via _orbitalElements()'s eccentricity
  // vector, not a canned decoration. Only drawn once there's an actual
  // bound orbit to show; an escaping or still-on-the-pad rocket has none.
  _drawOrbitEllipse(ctx, toScreen) {
    if (!this.launched || this.crashed) return;
    const els = this._orbitalElements();
    if (!els.bound) return;
    const { a, e, periapsisAngle } = els;

    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.strokeStyle = "rgba(120,220,140,0.55)";
    ctx.lineWidth = 1.5;
    const STEPS = 90;
    for (let i = 0; i <= STEPS; i++) {
      const nu = (i / STEPS) * Math.PI * 2; // true anomaly
      const rOrb = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
      const angle = periapsisAngle + nu;
      const wx = Math.cos(angle) * rOrb, wy = Math.sin(angle) * rOrb;
      const { sx, sy } = toScreen(wx, wy);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  _currentScale() {
    return this._lastScale || 1;
  }

  _activeStageHasFuel() {
    const s = this.stages[this.activeStageIndex];
    return s && s.fuelMass > 0;
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
