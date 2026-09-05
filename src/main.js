import { Renderer } from "./render.js";
import { renderPalette } from "./palette.js";
import { renderPanel, renderPhysicsMathPanel } from "./panel.js";
import { CHALLENGES, findChallenge, ChallengeTracker } from "./challenges.js";
import { OBJECT_DEFS, createSpec, cloneSpec, makeId } from "./objectTypes.js";
import { PhysicsSim } from "./physics.js";
import { loadState, saveState, clearSave } from "./storage.js";
import { snap, WORLD } from "./world.js";
import { ChemistryMode } from "./chemistry.js";
import { AstronomyMode } from "./astronomy.js";
import { HistoryMode } from "./history.js";
import { CybersecurityMode } from "./cybersecurity.js";
import { MathematicsMode } from "./mathematics.js";
import { traceLightRays } from "./lightOptics.js";
import { openQuiz } from "./quiz.js";
import { initAuthUI, openSavesPanel } from "./auth.js";
import { confirmPopup } from "./popup.js";

const state = {
  objects: [],
  selectedId: null, // set only when selectedIds has exactly one member — see syncSelectedId()
  selectedIds: new Set(),
  playing: false,
  gravity: 1,
  completedChallenges: new Set(),
  activeChallengeId: null,
  mathPanelOpen: true,
  lightMode: false,
};

let sim = null;
let tracker = null;
let clipboard = null; // in-app copy/paste buffer — an array of specs, not the OS clipboard
let chemistryMode = null;
let astronomyMode = null;
let historyMode = null;
let cybersecurityMode = null;
let mathematicsMode = null;

// Old saves stored a rope as x/y + rotation + length; the current model is
// two independent endpoints (x,y) and (x2,y2). Backfill x2/y2 from the old
// fields so one saved before this change still loads with the same shape
// instead of collapsing to a zero-length default.
function migrateRopeSpecs(objects) {
  for (const spec of objects) {
    if (spec.type !== "rope" || spec.x2 != null) continue;
    const rad = (spec.rotation || 0) * (Math.PI / 180);
    const length = spec.length ?? 240;
    spec.x2 = spec.x + Math.cos(rad) * length;
    spec.y2 = spec.y + Math.sin(rad) * length;
  }
}

// The circuitry feature (wire/battery/lightbulb/switch/resistor/transistor,
// and the old always-static circuit motor) was removed — drop any of those
// types left over in an older save rather than rendering broken objects.
const REMOVED_TYPES = new Set(["wire", "battery", "lightbulb", "switchComp", "resistor", "transistor"]);
function dropRemovedTypes(objects) {
  return objects.filter((spec) => !REMOVED_TYPES.has(spec.type));
}

function starterScene() {
  return [
    { id: "starter_ground", type: "board", x: 0, y: WORLD.groundY, rotation: 0, width: 2000, height: 60, material: "wood", fixed: true },
  ];
}

function boot() {
  const saved = loadState();
  if (saved && saved.objects.length) {
    Object.assign(state, saved);
  } else {
    state.objects = starterScene();
  }
  state.objects = dropRemovedTypes(state.objects);
  migrateRopeSpecs(state.objects);

  const svg = document.getElementById("canvas");
  const renderer = new Renderer(svg, {
    onSelect: (id, shiftKey) => {
      if (state.playing) return;
      if (id == null) state.selectedIds = new Set();
      else if (shiftKey) {
        if (state.selectedIds.has(id)) state.selectedIds.delete(id);
        else state.selectedIds.add(id);
      } else {
        state.selectedIds = new Set([id]);
      }
      syncSelectedId();
      renderAll();
      renderPanelUI();
    },
    onMultiSelect: (ids) => {
      if (state.playing) return;
      ids.forEach((id) => state.selectedIds.add(id));
      syncSelectedId();
      renderAll();
      renderPanelUI();
    },
    onMoveMany: (moves) => {
      moves.forEach(({ id, ...patch }) => patchObjectSilent(id, patch));
      renderAll();
      scheduleSave();
    },
    onRotate: (id, deg) => { patchObject(id, { rotation: deg }); renderPanelUI(); },
    onEndpointMove: (id, { x, y, x2, y2 }) => { patchObject(id, { x, y, x2, y2 }); },
  });
  window._renderer = renderer;

  renderer.centerOn(0, WORLD.groundY - 700, 0.7);

  renderPaletteUI();
  renderPanelUI();
  renderAll();

  wireTopbar(renderer);
  wireChallenges();
  wireKeyboard(renderer);
  wireModeTabs();

  window.addEventListener("beforeunload", () => saveState(state));
}

function renderAll() {
  const items = state.objects.map(specToRenderItem);
  window._renderer.render(items, { editable: !state.playing, selectedId: state.selectedId, selectedIds: state.selectedIds });
  updateTrajectoryPreview();
  updateLightRays(items);
}

function specToRenderItem(s) {
  return { ...s };
}

function patchObject(id, patch) {
  const spec = state.objects.find((o) => o.id === id);
  if (!spec) return;
  Object.assign(spec, patch);
  renderAll();
  scheduleSave();
}

// Same as patchObject but skips the render/save — for batch updates (e.g.
// dragging a multi-selection) where the caller renders once at the end.
function patchObjectSilent(id, patch) {
  const spec = state.objects.find((o) => o.id === id);
  if (!spec) return;
  Object.assign(spec, patch);
}

// state.selectedId mirrors state.selectedIds only when it's a single
// object — that's the only case the property panel and rotate handle
// know how to show.
function syncSelectedId() {
  state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(state), 300);
}

function renderPaletteUI() {
  renderPalette(document.getElementById("palette"), state, {
    onDragStart: (type, pointerEvent) => beginPaletteDrag(type, pointerEvent),
  });
}

function renderPanelUI() {
  const spec = state.objects.find((o) => o.id === state.selectedId) || null;
  renderPanel(document.getElementById("prop-panel"), spec, state, {
    onChange: (id, patch) => { patchObject(id, patch); },
    onDelete: (id) => { deleteObject(id); },
    mathPanelOpen: state.mathPanelOpen,
    onOpenMath: () => { state.mathPanelOpen = true; renderMathPanelUI(); renderPanelUI(); },
  });
  renderMathPanelUI();
}

function renderMathPanelUI() {
  const panelEl = document.getElementById("physics-math-panel");
  const spec = state.objects.find((o) => o.id === state.selectedId) || null;
  panelEl.classList.toggle("hidden", !state.mathPanelOpen);
  if (state.mathPanelOpen) {
    renderPhysicsMathPanel(
      panelEl, spec,
      () => { state.mathPanelOpen = false; renderMathPanelUI(); renderPanelUI(); },
      (key, value) => { if (spec) patchObject(spec.id, { [key]: value }); renderMathPanelUI(); }
    );
  }
}

function deleteObject(id) {
  state.objects = state.objects.filter((o) => o.id !== id);
  state.objects.forEach((o) => { if (o.targetId === id) o.targetId = null; });
  state.selectedIds.delete(id);
  syncSelectedId();
  renderAll();
  renderPanelUI();
  scheduleSave();
}

function deleteSelected() {
  if (!state.selectedIds.size) return;
  const ids = state.selectedIds;
  state.objects = state.objects.filter((o) => !ids.has(o.id));
  state.objects.forEach((o) => { if (o.targetId && ids.has(o.targetId)) o.targetId = null; });
  state.selectedIds = new Set();
  syncSelectedId();
  renderAll();
  renderPanelUI();
  scheduleSave();
}

// ---- Cannon predicted-trajectory preview ----
// Stepping a real physics engine (~10-15ms) is far more than the old
// hand-rolled formula cost, and the Fire Angle/Power sliders call this on
// every single `input` event while being dragged — debounce so a drag
// doesn't chain dozens of these back to back and visibly lag, while still
// updating promptly (60ms) once the user pauses or releases.
let trajectoryDebounce = null;
function updateTrajectoryPreview() {
  clearTimeout(trajectoryDebounce);
  if (state.playing) return;
  const spec = state.objects.find((o) => o.id === state.selectedId);
  if (!spec || spec.type !== "cannon") { window._renderer.renderTrajectory(null); return; }
  trajectoryDebounce = setTimeout(() => {
    window._renderer.renderTrajectory(simulateCannonTrajectory(spec, state.gravity, state.objects));
  }, 60);
}

// Runs a real, throwaway headless physics step-through of what firing this
// cannon would actually do — same gravity, same air friction, and (by
// including every other object currently in the scene, not just the
// cannon) the same collisions — instead of a hand-rolled kinematic formula.
// That formula used to guess gravity's per-tick effect as `gravity * 0.001`,
// off by roughly 280x from what Matter's own force/deltaTimeSquared
// integration actually produces (so the dashed line showed the ball
// climbing forever and never arcing back down), ignored air friction
// entirely, and never knew about anything else in the scene, so a shot that
// would really bounce off a board just drew straight through it. Reusing
// PhysicsSim's own _doCannonFire and stepping its engine directly
// guarantees the preview always matches whatever the real simulation does,
// since there's only one implementation instead of two.
function simulateCannonTrajectory(spec, gravity, allSpecs) {
  const sim = new PhysicsSim(allSpecs.map((s) => ({ ...s })), gravity, {});
  // The preview can't know in advance which ball (radius/material) will
  // actually be caught and fired — a default 26-radius rubber ball, same as
  // the palette's own default Ball, is a reasonable stand-in. _doCannonFire
  // only reads .plugin.render off this and never needs it added to the
  // world itself.
  const dummyBall = Matter.Bodies.circle(spec.x, spec.y, 26, {});
  dummyBall.plugin = { render: { radius: 26, material: "rubber" } };
  sim._doCannonFire(spec.id, dummyBall);
  const fired = Matter.Composite.allBodies(sim.engine.world).find((b) => b.label?.startsWith("ball:firedball"));
  if (!fired) { sim.stop(); return null; }

  const points = [{ x: fired.position.x, y: fired.position.y }];
  for (let t = 0; t < 240; t++) {
    sim._lastDelta = 16;
    Matter.Engine.update(sim.engine, 16);
    if (t % 4 === 0) points.push({ x: fired.position.x, y: fired.position.y });
    if (fired.position.y > WORLD.maxY || fired.position.x < WORLD.minX || fired.position.x > WORLD.maxX) break;
  }
  sim.stop();
  return points;
}

// ---- Light Mode ----
function updateLightRays(items) {
  if (!state.lightMode) { window._renderer.renderLightRays([]); return; }
  const rays = traceLightRays(items, WORLD);
  window._renderer.renderLightRays(rays);
}

// ---- Cosmetic water/wind particles (edit mode preview + during Play) ----
let particleClock = 0;
let particleRafId = null;
function startParticleLoop() {
  stopParticleLoop();
  const loop = () => {
    particleClock += 1;
    const items = state.playing ? null : state.objects; // during Play, particles are driven by onFrame instead
    if (items) window._renderer.renderParticles(buildParticles(items, particleClock));
    particleRafId = requestAnimationFrame(loop);
  };
  particleRafId = requestAnimationFrame(loop);
}
function stopParticleLoop() {
  if (particleRafId) cancelAnimationFrame(particleRafId);
  particleRafId = null;
}

function buildParticles(items, clock) {
  const particles = [];
  for (const it of items) {
    if (it.material === "water") {
      const w = it.width ?? it.radius * 2 ?? 100, h = it.height ?? it.radius * 2 ?? 100;
      const count = Math.max(3, Math.round((w * h) / 9000));
      for (let i = 0; i < count; i++) {
        const seed = hashSeed(it.id, i);
        const cx = it.x - w / 2 + ((seed * 97) % w);
        const cycle = ((clock * 0.6 + seed * 37) % h);
        particles.push({ id: `${it.id}_b${i}`, kind: "bubble", x: cx, y: it.y + h / 2 - cycle, r: 2 + (seed % 3), opacity: 0.35 });
      }
    }
    if (it.type === "fan") {
      const w = it.width, h = it.height, range = it.range ?? 400;
      const rad = (it.rotation || 0) * Math.PI / 180;
      const dir = { x: Math.cos(rad), y: Math.sin(rad) };
      const perp = { x: -dir.y, y: dir.x };
      const count = 6;
      for (let i = 0; i < count; i++) {
        const seed = hashSeed(it.id, i);
        const lane = (seed % 100) / 100 * h - h / 2;
        const dist = w / 2 + ((clock * 6 + seed * 53) % range);
        const streakLen = 22;
        const bx = it.x + dir.x * dist + perp.x * lane;
        const by = it.y + dir.y * dist + perp.y * lane;
        particles.push({
          id: `${it.id}_w${i}`, kind: "streak",
          x: bx, y: by, x2: bx - dir.x * streakLen, y2: by - dir.y * streakLen,
          opacity: 0.35 * (1 - dist / (w / 2 + range)),
        });
      }
    }
  }
  return particles;
}
function hashSeed(id, i) {
  let h = i * 2654435761;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) | 0;
  return Math.abs(h) % 997;
}

function wireTopbar(renderer) {
  const playBtn = document.getElementById("play-btn");
  playBtn.addEventListener("click", () => togglePlay(renderer));

  const gravitySlider = document.getElementById("gravity-slider");
  const gravityVal = document.getElementById("gravity-val");
  gravitySlider.addEventListener("input", () => {
    state.gravity = parseFloat(gravitySlider.value);
    gravityVal.textContent = state.gravity.toFixed(1);
    if (sim) sim.setGravity(state.gravity);
    updateTrajectoryPreview();
  });

  document.getElementById("clear-btn").addEventListener("click", async () => {
    if (state.playing) togglePlay(renderer);
    if (!(await confirmPopup("Clear the whole workspace? This can't be undone.", { title: "Clear workspace", confirmLabel: "Clear", danger: true }))) return;
    state.objects = starterScene();
    state.selectedIds = new Set();
    state.selectedId = null;
    state.activeChallengeId = null;
    renderAll();
    renderPanelUI();
    scheduleSave();
  });

  document.getElementById("light-mode-btn").addEventListener("click", () => {
    state.lightMode = !state.lightMode;
    document.getElementById("light-mode-btn").classList.toggle("active", state.lightMode);
    renderAll();
  });

  document.getElementById("quiz-btn").addEventListener("click", () => openQuiz(state.mode));

  document.getElementById("my-worlds-btn").addEventListener("click", () => {
    openSavesPanel({
      kind: "worlds",
      title: "My Physics Worlds",
      itemNoun: "world",
      serialize: () => ({ objects: state.objects, gravity: state.gravity }),
      apply: (data) => {
        if (state.playing) togglePlay(renderer);
        state.objects = dropRemovedTypes(data.objects || []);
        migrateRopeSpecs(state.objects);
        state.gravity = data.gravity ?? 1;
        document.getElementById("gravity-slider").value = state.gravity;
        document.getElementById("gravity-val").textContent = state.gravity.toFixed(1);
        sim?.setGravity(state.gravity);
        state.selectedIds = new Set();
        state.selectedId = null;
        state.activeChallengeId = null;
        renderAll();
        renderPanelUI();
        scheduleSave();
      },
    });
  });

  initAuthUI();

  wireTheme();
  startParticleLoop();
}

function wireTheme() {
  const btn = document.getElementById("theme-toggle");
  const saved = localStorage.getItem("contraption-theme") || "light";
  applyTheme(saved);
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("contraption-theme", next);
  });
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
    document.getElementById("theme-toggle").textContent = "☀";
  } else {
    delete document.documentElement.dataset.theme;
    document.getElementById("theme-toggle").textContent = "🌙";
  }
  // The Particle Physics iframe reads localStorage for its theme once, at
  // its own load time — that's enough for opening it fresh already
  // matching, but a toggle while it's already loaded needs pushing in
  // directly. Same-origin (served from this same app), so its document is
  // reachable straight through contentDocument, no postMessage needed.
  const particlesDoc = document.getElementById("particles-frame")?.contentDocument;
  if (particlesDoc) {
    if (theme === "dark") particlesDoc.documentElement.dataset.theme = "dark";
    else delete particlesDoc.documentElement.dataset.theme;
  }
}

function togglePlay(renderer) {
  const playBtn = document.getElementById("play-btn");
  const banner = document.getElementById("mode-banner");

  if (!state.playing) {
    state.selectedIds = new Set();
    state.selectedId = null;
    renderPanelUI();
    window._renderer.renderTrajectory(null);
    const clones = state.objects.map(cloneSpec);
    tracker = state.activeChallengeId ? new ChallengeTracker(findChallenge(state.activeChallengeId)) : null;
    sim = new PhysicsSim(clones, state.gravity, {
      onFrame: (items) => {
        renderer.render(items, { editable: false });
        checkChallengeFrame(items);
        if (state.lightMode) updateLightRays(items);
        window._renderer.renderParticles(sim.collectParticleItems());
        window._renderer.renderRopeTubes(sim.collectRopePaths());
      },
      onEvent: (event) => handleSimEvent(event),
    });
    sim.start();
    state.playing = true;
    playBtn.textContent = "■ Stop";
    playBtn.classList.add("playing");
    banner.classList.remove("hidden");
  } else {
    sim?.stop();
    sim = null;
    state.playing = false;
    playBtn.textContent = "▶ Play";
    playBtn.classList.remove("playing");
    banner.classList.add("hidden");
    window._renderer.renderRopeTubes([]);
    renderAll();
  }
}

function handleSimEvent(event) {
  if (event.type === "shatter") window._renderer.burst(event.x, event.y, event.radius);
  if (!tracker) return;
  if (tracker.onEvent(event)) awardChallenge(tracker.challenge);
}

function checkChallengeFrame(items) {
  if (!tracker) return;
  if (tracker.onFrame(items)) awardChallenge(tracker.challenge);
}

function awardChallenge(challenge) {
  if (!state.completedChallenges.has(challenge.id)) {
    state.completedChallenges.add(challenge.id);
    scheduleSave();
  }
  showToast(`Challenge complete: ${challenge.name}`);
}

function showToast(msg) {
  const toast = document.getElementById("challenge-toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 3500);
}

function wireChallenges() {
  const modal = document.getElementById("challenges-modal");
  const list = document.getElementById("challenges-items");
  document.getElementById("challenges-btn").addEventListener("click", () => {
    list.innerHTML = "";
    for (const c of CHALLENGES) {
      const row = document.createElement("div");
      row.className = "shop-item";
      const info = document.createElement("div");
      info.className = "info";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = c.name + (state.completedChallenges.has(c.id) ? " ✓" : "");
      const concept = document.createElement("div");
      concept.className = "concept-tag";
      concept.textContent = c.concept;
      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = c.description;
      info.appendChild(name);
      info.appendChild(concept);
      info.appendChild(desc);
      const btn = document.createElement("button");
      btn.className = "primary";
      btn.textContent = "Load";
      btn.addEventListener("click", async () => {
        if (!(await confirmPopup(`Load "${c.name}"? This replaces your current workspace.`, { title: "Load challenge", confirmLabel: "Load" }))) return;
        state.objects = c.build();
        state.activeChallengeId = c.id;
        state.selectedIds = new Set();
        state.selectedId = null;
        renderAll();
        renderPanelUI();
        scheduleSave();
        modal.classList.add("hidden");
      });
      row.appendChild(info);
      row.appendChild(btn);
      list.appendChild(row);
    }
    modal.classList.remove("hidden");
  });
  document.getElementById("challenges-close").addEventListener("click", () => modal.classList.add("hidden"));
}

// The app's front door — a launcher card per section, in the same
// hero-plus-grid shape as the Particle Physics gallery's own home page (and
// reusing History's .home-card pattern), so all three read as one family
// of "pick where to go" screens rather than one being a special case.
const HOME_SECTIONS = [
  { mode: "physics", title: "Physics", blurb: "Build contraptions with real 2D physics — ramps, cannons, springs, motors, and more.", kind: "physics", hues: [22, 205] },
  { mode: "chemistry", title: "Chemistry", blurb: "Explore the periodic table, mix real reactions, and watch atoms bond in 3D.", kind: "chemistry", hues: [355, 150] },
  { mode: "astronomy", title: "Astronomy", blurb: "Real orbital mechanics for the whole solar system, at any date you choose.", kind: "astronomy", hues: [45, 285] },
  { mode: "history", title: "History", blurb: "Browse a timeline of landmark moments across physics, chemistry, and more.", kind: "history", hues: [35, 45] },
  { mode: "cybersecurity", title: "Cybersecurity", blurb: "Search and filter well-documented malware, hackers, hacker groups, and breaches.", kind: "cybersecurity", hues: [0, 340] },
  { mode: "particles", title: "Particle Physics", blurb: "A gallery of real D3 force simulations — drag anything you see.", kind: "particles", hues: [190, 270] },
  { mode: "mathematics", title: "Mathematics", blurb: "A real graphing calculator — plot any expression, pan and zoom the graph.", kind: "mathematics", hues: [230, 350] },
];

function buildHomePage(root, onNavigate) {
  root.innerHTML = `
    <div class="home-wrap">
      <div class="home-hero">
        <svg class="home-logo" viewBox="0 0 24 24" width="48" height="48" aria-hidden="true">
          <ellipse cx="12" cy="12" rx="10" ry="4.2" fill="none" style="stroke: var(--cool-1)" stroke-width="1.3" />
          <ellipse cx="12" cy="12" rx="10" ry="4.2" fill="none" style="stroke: var(--cool-2)" stroke-width="1.3" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4.2" fill="none" style="stroke: var(--cool-3)" stroke-width="1.3" transform="rotate(120 12 12)" />
          <circle cx="12" cy="12" r="2.1" style="fill: var(--text)" />
        </svg>
        <div class="home-kicker">seven sandboxes · one app</div>
        <h1>Continuum</h1>
        <p class="home-tagline">Real simulations, not animations — physics, chemistry, astronomy,
          mathematics, and the history and security behind them all. Pick a section to start.</p>
      </div>
      <div class="home-cards"></div>
    </div>
  `;
  const grid = root.querySelector(".home-cards");
  for (const section of HOME_SECTIONS) {
    const card = document.createElement("button");
    card.className = "home-card";
    card.innerHTML = `
      <div class="home-card-thumb"></div>
      <div class="home-card-title">${section.title}</div>
      <div class="home-card-blurb">${section.blurb}</div>
    `;
    card.addEventListener("click", () => onNavigate(section.mode));
    grid.appendChild(card);
    buildHomeThumbnail(card.querySelector(".home-card-thumb"), section);
  }
}

// A small, genuinely representative illustration per card — a ball on a
// ramp for Physics, a bent water-style molecule for Chemistry, a sun with
// orbits for Astronomy, tick marks on a line for History, a padlock for
// Cybersecurity — rather than one generic visual reused six times with
// different color palettes. Particle Physics is the one exception where a
// frozen D3 force layout *is* the accurate picture, since that's literally
// what all 8 of its demos look like — the same technique (and the same
// d3.forceSimulation this app's own physics canvas already loads) the
// original standalone gallery used for its own demo thumbnails.
function buildHomeThumbnail(el, section) {
  const w = el.clientWidth || 260, h = 84;
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`);
  const [hueA, hueB] = section.hues;
  const colorA = `hsl(${hueA}, 80%, 62%)`, colorB = `hsl(${hueB}, 80%, 62%)`;

  if (section.kind === "physics") {
    // A ramp with a ball at its foot and a dashed launch arc — the same
    // board+ball shapes this sim's own palette icons use.
    svg.append("line").attr("x1", 40).attr("y1", 24).attr("x2", 150).attr("y2", 62)
      .attr("stroke", colorB).attr("stroke-width", 5).attr("stroke-linecap", "round");
    const arc = d3.path();
    arc.moveTo(150, 62);
    arc.bezierCurveTo(185, 40, 215, 40, 235, 68);
    svg.append("path").attr("d", arc.toString()).attr("fill", "none")
      .attr("stroke", "rgba(148,163,184,0.55)").attr("stroke-width", 2).attr("stroke-dasharray", "4 4");
    svg.append("circle").attr("cx", 235).attr("cy", 68).attr("r", 7).attr("fill", colorA);
    svg.append("circle").attr("cx", 40).attr("cy", 24).attr("r", 7).attr("fill", colorA);
  } else if (section.kind === "chemistry") {
    // A bent triatomic molecule, like water: one bigger central atom, two
    // smaller ones off at real-ish bond angles.
    const cx = 130, cy = 46, bond = 26;
    const a1 = -125 * Math.PI / 180, a2 = -55 * Math.PI / 180;
    const p1 = [cx + Math.cos(a1) * bond, cy + Math.sin(a1) * bond];
    const p2 = [cx + Math.cos(a2) * bond, cy + Math.sin(a2) * bond];
    svg.append("line").attr("x1", cx).attr("y1", cy).attr("x2", p1[0]).attr("y2", p1[1]).attr("stroke", "rgba(148,163,184,0.6)").attr("stroke-width", 3);
    svg.append("line").attr("x1", cx).attr("y1", cy).attr("x2", p2[0]).attr("y2", p2[1]).attr("stroke", "rgba(148,163,184,0.6)").attr("stroke-width", 3);
    svg.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 13).attr("fill", colorA);
    svg.append("circle").attr("cx", p1[0]).attr("cy", p1[1]).attr("r", 8).attr("fill", colorB);
    svg.append("circle").attr("cx", p2[0]).attr("cy", p2[1]).attr("r", 8).attr("fill", colorB);
  } else if (section.kind === "astronomy") {
    // A sun with a couple of elliptical orbits and planets sitting on them.
    const cx = w / 2, cy = h / 2 + 4;
    svg.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 9).attr("fill", colorA);
    for (const [rx, ry, angle] of [[46, 16, 20], [70, 24, -12]]) {
      svg.append("ellipse").attr("cx", cx).attr("cy", cy).attr("rx", rx).attr("ry", ry)
        .attr("transform", `rotate(${angle} ${cx} ${cy})`)
        .attr("fill", "none").attr("stroke", "rgba(148,163,184,0.45)").attr("stroke-width", 1.5);
      const t = Math.random() * Math.PI * 2;
      const rad = angle * Math.PI / 180;
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      const px = cx + ex * Math.cos(rad) - ey * Math.sin(rad);
      const py = cy + ex * Math.sin(rad) + ey * Math.cos(rad);
      svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", colorB);
    }
  } else if (section.kind === "history") {
    // The real timeline UI, shrunk down: an axis with tick marks, one lit
    // up as "selected."
    const y = h / 2 + 6;
    svg.append("line").attr("x1", 20).attr("y1", y).attr("x2", w - 20).attr("y2", y).attr("stroke", "var(--border)").attr("stroke-width", 2);
    const count = 7, activeIdx = 3;
    for (let i = 0; i < count; i++) {
      const x = 20 + (i / (count - 1)) * (w - 40);
      const active = i === activeIdx;
      svg.append("line").attr("x1", x).attr("y1", y - (active ? 14 : 9)).attr("x2", x).attr("y2", y)
        .attr("stroke", active ? colorA : "rgba(148,163,184,0.6)").attr("stroke-width", active ? 3 : 2);
    }
  } else if (section.kind === "cybersecurity") {
    // A simple padlock: a shackle arc over a rounded body.
    const cx = w / 2, topY = 22;
    svg.append("path")
      .attr("d", `M ${cx - 12} ${topY + 14} v-8 a12 12 0 0 1 24 0 v8`)
      .attr("fill", "none").attr("stroke", colorB).attr("stroke-width", 4).attr("stroke-linecap", "round");
    svg.append("rect").attr("x", cx - 18).attr("y", topY + 10).attr("width", 36).attr("height", 28)
      .attr("rx", 5).attr("fill", colorA);
    svg.append("circle").attr("cx", cx).attr("cy", topY + 22).attr("r", 3.5).attr("fill", "rgba(0,0,0,0.35)");
  } else if (section.kind === "mathematics") {
    // A real sine curve plotted against real axes — genuinely what opening
    // the calculator with its default y = sin(x) looks like, not a
    // decorative squiggle.
    const originX = w / 2, originY = h / 2 + 6;
    svg.append("line").attr("x1", 10).attr("x2", w - 10).attr("y1", originY).attr("y2", originY).attr("stroke", "rgba(148,163,184,0.4)");
    svg.append("line").attr("x1", originX).attr("x2", originX).attr("y1", 8).attr("y2", h - 8).attr("stroke", "rgba(148,163,184,0.4)");
    const pxPerUnit = 16;
    const pts = [];
    for (let px = 10; px <= w - 10; px += 3) {
      const x = (px - originX) / pxPerUnit;
      const y = Math.sin(x);
      pts.push([px, originY - y * 22]);
    }
    svg.append("path").attr("d", d3.line()(pts)).attr("fill", "none").attr("stroke", colorA).attr("stroke-width", 2.5);
    svg.append("circle").attr("cx", originX + Math.PI / 2 * pxPerUnit).attr("cy", originY - 22).attr("r", 3.5).attr("fill", colorB);
  } else {
    // Particle Physics: a small frozen force-directed graph, exactly the
    // shape every one of its 8 real demos takes.
    const n = 22;
    const nodes = Array.from({ length: n }, (_, i) => ({ hue: i % 2 ? hueB : hueA }));
    const links = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.random() < 0.09) links.push({ source: i, target: j });
    const sim = d3.forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(-16))
      .force("link", d3.forceLink(links).distance(15))
      .force("x", d3.forceX(w / 2).strength(0.04))
      .force("y", d3.forceY(h / 2).strength(0.04))
      .stop();
    for (let i = 0; i < 200; i++) sim.tick();
    svg.append("g").attr("stroke", "rgba(148,163,184,0.35)").selectAll("line").data(links).join("line")
      .attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
    svg.append("g").selectAll("circle").data(nodes).join("circle")
      .attr("r", 3).attr("cx", (d) => d.x).attr("cy", (d) => d.y)
      .attr("fill", (d) => `hsl(${d.hue}, 80%, 62%)`);
  }
}

function wireModeTabs() {
  const homeBtn = document.getElementById("mode-home-btn");
  const physicsBtn = document.getElementById("mode-physics-btn");
  const chemistryBtn = document.getElementById("mode-chemistry-btn");
  const astronomyBtn = document.getElementById("mode-astronomy-btn");
  const historyBtn = document.getElementById("mode-history-btn");
  const cybersecurityBtn = document.getElementById("mode-cybersecurity-btn");
  const particlesBtn = document.getElementById("mode-particles-btn");
  const mathematicsBtn = document.getElementById("mode-mathematics-btn");
  const modeButtons = { home: homeBtn, physics: physicsBtn, chemistry: chemistryBtn, astronomy: astronomyBtn, history: historyBtn, cybersecurity: cybersecurityBtn, particles: particlesBtn, mathematics: mathematicsBtn };

  const homeRoot = document.getElementById("home-root");
  buildHomePage(homeRoot, (mode) => setMode(mode));

  const workspace = document.getElementById("workspace");
  const chemRoot = document.getElementById("chemistry-root");
  const astronomyRoot = document.getElementById("astronomy-root");
  const historyRoot = document.getElementById("history-root");
  const cybersecurityRoot = document.getElementById("cybersecurity-root");
  const particlesRoot = document.getElementById("particles-root");
  const mathematicsRoot = document.getElementById("mathematics-root");
  const roots = { home: homeRoot, physics: workspace, chemistry: chemRoot, astronomy: astronomyRoot, history: historyRoot, cybersecurity: cybersecurityRoot, particles: particlesRoot, mathematics: mathematicsRoot };

  const physicsOnlyControls = [
    document.getElementById("run-controls"),
    document.getElementById("gravity-controls"),
    document.getElementById("light-mode-toggle-wrap"),
    document.getElementById("clear-btn"),
    document.getElementById("my-worlds-btn"),
  ];
  const challengeBtn = document.getElementById("challenges-btn");
  const quizBtn = document.getElementById("quiz-btn");

  function setMode(mode) {
    if (state.mode === mode) return;
    if (state.mode === "physics" && state.playing) togglePlay(window._renderer);
    state.mode = mode;

    for (const [m, btn] of Object.entries(modeButtons)) btn.classList.toggle("active", mode === m);
    for (const [m, el] of Object.entries(roots)) el.classList.toggle("hidden", mode !== m);
    physicsOnlyControls.forEach((el) => el && (el.style.display = mode === "physics" ? "" : "none"));
    // Chemistry, Astronomy, and History each have their own mode-specific
    // Challenges entry point built into their own panel (a mixing-bench
    // button, an "Astronomy Challenges" button, a "History Challenges"
    // button) — this shared topbar one is Physics-only.
    challengeBtn.style.display = mode === "physics" ? "" : "none";
    // Home is just a launcher, and Particle Physics is a gallery of
    // embedded external demos — neither is a knowledge domain with quiz
    // content the way the other modes are.
    quizBtn.style.display = mode === "particles" || mode === "home" || mode === "mathematics" ? "none" : "";

    if (mode === "physics") startParticleLoop(); else stopParticleLoop();

    if (mode === "chemistry") {
      if (!chemistryMode) chemistryMode = new ChemistryMode(chemRoot, { state });
      chemistryMode.mount();
    } else {
      chemistryMode?.unmount();
    }

    if (mode === "astronomy") {
      if (!astronomyMode) astronomyMode = new AstronomyMode(astronomyRoot, { state, showToast });
      astronomyMode.mount();
    } else {
      astronomyMode?.unmount();
    }

    if (mode === "history") {
      if (!historyMode) historyMode = new HistoryMode(historyRoot, { state, showToast });
      historyMode.mount();
    } else {
      historyMode?.unmount();
    }

    if (mode === "cybersecurity") {
      if (!cybersecurityMode) cybersecurityMode = new CybersecurityMode(cybersecurityRoot, { state, showToast });
      cybersecurityMode.mount();
    } else {
      cybersecurityMode?.unmount();
    }

    if (mode === "mathematics") {
      if (!mathematicsMode) mathematicsMode = new MathematicsMode(mathematicsRoot);
      mathematicsMode.mount();
    } else {
      mathematicsMode?.unmount();
    }
  }

  homeBtn.addEventListener("click", () => setMode("home"));
  physicsBtn.addEventListener("click", () => setMode("physics"));
  chemistryBtn.addEventListener("click", () => setMode("chemistry"));
  astronomyBtn.addEventListener("click", () => setMode("astronomy"));
  historyBtn.addEventListener("click", () => setMode("history"));
  cybersecurityBtn.addEventListener("click", () => setMode("cybersecurity"));
  particlesBtn.addEventListener("click", () => setMode("particles"));
  mathematicsBtn.addEventListener("click", () => setMode("mathematics"));

  // Each individual demo's own top bar was removed (it duplicated this
  // app's nav one level up) — this subnav is the only way left to switch
  // between the 8 demos, so it drives the iframe's src directly.
  const particlesFrame = document.getElementById("particles-frame");
  const particlesTabs = Array.from(document.querySelectorAll(".particles-tab"));
  for (const tab of particlesTabs) {
    tab.addEventListener("click", () => {
      particlesFrame.src = `particle-physics/${tab.dataset.demo}`;
      for (const t of particlesTabs) t.classList.toggle("active", t === tab);
    });
  }

  state.mode = null;
  setMode("home");
}

function wireKeyboard(renderer) {
  window.addEventListener("keydown", (e) => {
    if (state.mode !== "physics") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    const cmd = e.metaKey || e.ctrlKey;

    if (e.code === "Space") {
      e.preventDefault();
      togglePlay(renderer);
    } else if ((e.code === "Delete" || e.code === "Backspace") && state.selectedIds.size && !state.playing) {
      e.preventDefault();
      deleteSelected();
    } else if (e.code === "Escape") {
      state.selectedIds = new Set();
      state.selectedId = null;
      renderAll();
      renderPanelUI();
    } else if (cmd && e.code === "KeyC" && state.selectedIds.size && !state.playing) {
      e.preventDefault();
      copySelected();
    } else if (cmd && e.code === "KeyV" && clipboard && !state.playing) {
      e.preventDefault();
      pasteClipboard();
    }
  });
}

function copySelected() {
  const specs = state.objects.filter((o) => state.selectedIds.has(o.id));
  if (!specs.length) return;
  clipboard = specs.map(cloneSpec);
  showToast(specs.length > 1 ? `Copied ${specs.length}` : "Copied");
}

function pasteClipboard() {
  if (!clipboard || !clipboard.length) return;
  const pasted = clipboard.map((spec) => {
    const s = cloneSpec(spec);
    s.id = makeId(s.type);
    s.x = snap(s.x + 40);
    s.y = snap(s.y + 40);
    if (s.x2 != null) { s.x2 = snap(s.x2 + 40); s.y2 = snap(s.y2 + 40); } // flexible-endpoint objects (rope/track): shift both ends together
    if (s.targetId) s.targetId = null; // don't silently share a trigger link with the original
    return s;
  });
  state.objects.push(...pasted);
  state.selectedIds = new Set(pasted.map((s) => s.id));
  syncSelectedId();
  renderAll();
  renderPanelUI();
  scheduleSave();
  // paste again from the same spot, so repeated ⌘V lays out a diagonal trail
  clipboard = pasted.map(cloneSpec);
}

function beginPaletteDrag(type, pointerEvent) {
  if (state.playing) return;
  const def = OBJECT_DEFS[type];

  const ghost = document.createElement("div");
  ghost.style.cssText = `
    position: fixed; pointer-events: none; z-index: 100;
    width: 34px; height: 34px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; opacity: .85;
    background: rgba(79,140,255,.25); border: 2px solid var(--accent);
    transform: translate(-50%, -50%);
  `;
  ghost.textContent = def.icon;
  document.body.appendChild(ghost);

  const move = (ev) => {
    ghost.style.left = ev.clientX + "px";
    ghost.style.top = ev.clientY + "px";
  };
  move(pointerEvent);

  const canvasWrap = document.getElementById("canvas-wrap");

  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    ghost.remove();

    const rect = canvasWrap.getBoundingClientRect();
    const inside = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
    if (!inside) return;

    const { x, y } = window._renderer.screenToWorld(ev.clientX, ev.clientY);
    const spec = createSpec(type);
    const dx = snap(x) - spec.x, dy = snap(y) - spec.y;
    spec.x += dx;
    spec.y += dy;
    if (spec.x2 != null) { spec.x2 += dx; spec.y2 += dy; } // flexible-endpoint objects (rope/track): shift the far end by the same delta
    state.objects.push(spec);
    state.selectedIds = new Set([spec.id]);
    syncSelectedId();
    renderAll();
    renderPanelUI();
    scheduleSave();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

boot();
