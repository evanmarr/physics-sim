import { Renderer } from "./render.js";
import { renderPalette } from "./palette.js";
import { renderPanel, renderPhysicsMathPanel } from "./panel.js";
import { CHALLENGES, findChallenge, ChallengeTracker } from "./challenges.js";
import { OBJECT_DEFS, createSpec, cloneSpec, makeId } from "./objectTypes.js";
import { PhysicsSim } from "./physics.js";
import { loadState, saveState, clearSave } from "./storage.js";
import { snap, WORLD } from "./world.js";
import { ChemistryMode } from "./chemistry.js";
import { AnatomyMode } from "./anatomy.js";
import { AstronomyMode } from "./astronomy.js";
import { traceLightRays } from "./lightOptics.js";
import { openQuiz } from "./quiz.js";

const state = {
  objects: [],
  selectedId: null,
  playing: false,
  gravity: 1,
  completedChallenges: new Set(),
  activeChallengeId: null,
  mathPanelOpen: true,
  lightMode: false,
};

let sim = null;
let tracker = null;
let clipboard = null; // in-app copy/paste buffer — a spec, not the OS clipboard
let chemistryMode = null;
let anatomyMode = null;
let astronomyMode = null;

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

  const svg = document.getElementById("canvas");
  const renderer = new Renderer(svg, {
    onSelect: (id) => { if (!state.playing) { state.selectedId = id; renderAll(); renderPanelUI(); } },
    onMove: (id, x, y) => { patchObject(id, { x, y }); renderPanelUI(); },
    onRotate: (id, deg) => { patchObject(id, { rotation: deg }); renderPanelUI(); },
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
  window._renderer.render(items, { editable: !state.playing, selectedId: state.selectedId });
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
    renderPhysicsMathPanel(panelEl, spec, () => { state.mathPanelOpen = false; renderMathPanelUI(); renderPanelUI(); });
  }
}

function deleteObject(id) {
  state.objects = state.objects.filter((o) => o.id !== id);
  state.objects.forEach((o) => { if (o.targetId === id) o.targetId = null; });
  if (state.selectedId === id) state.selectedId = null;
  renderAll();
  renderPanelUI();
  scheduleSave();
}

// ---- Cannon predicted-trajectory preview ----
function updateTrajectoryPreview() {
  if (state.playing) return;
  const spec = state.objects.find((o) => o.id === state.selectedId);
  if (!spec || spec.type !== "cannon") { window._renderer.renderTrajectory(null); return; }
  const rad = (spec.launchRotation ?? 0) * Math.PI / 180;
  const speed = spec.power ?? 22;
  const muzzleDist = spec.width / 2 + 20;
  let x = spec.x + Math.cos(rad) * muzzleDist;
  let y = spec.y + Math.sin(rad) * muzzleDist;
  let vx = Math.cos(rad) * speed, vy = Math.sin(rad) * speed;
  const g = state.gravity * 0.001; // matches PhysicsSim's DENSITY_SCALE-consistent gravity units
  const points = [{ x, y }];
  for (let t = 0; t < 220; t++) {
    vy += g;
    x += vx; y += vy;
    if (t % 4 === 0) points.push({ x, y });
    if (y > WORLD.maxY || x < WORLD.minX || x > WORLD.maxX) break;
  }
  window._renderer.renderTrajectory(points);
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

  document.getElementById("clear-btn").addEventListener("click", () => {
    if (state.playing) togglePlay(renderer);
    if (!confirm("Clear the whole workspace? This can't be undone.")) return;
    state.objects = starterScene();
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
}

function togglePlay(renderer) {
  const playBtn = document.getElementById("play-btn");
  const banner = document.getElementById("mode-banner");

  if (!state.playing) {
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
        window._renderer.renderParticles(buildParticles(items, particleClock));
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
      btn.addEventListener("click", () => {
        if (!confirm(`Load "${c.name}"? This replaces your current workspace.`)) return;
        state.objects = c.build();
        state.activeChallengeId = c.id;
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

function wireModeTabs() {
  const physicsBtn = document.getElementById("mode-physics-btn");
  const chemistryBtn = document.getElementById("mode-chemistry-btn");
  const anatomyBtn = document.getElementById("mode-anatomy-btn");
  const astronomyBtn = document.getElementById("mode-astronomy-btn");
  const modeButtons = { physics: physicsBtn, chemistry: chemistryBtn, anatomy: anatomyBtn, astronomy: astronomyBtn };

  const workspace = document.getElementById("workspace");
  const chemRoot = document.getElementById("chemistry-root");
  const anatomyRoot = document.getElementById("anatomy-root");
  const astronomyRoot = document.getElementById("astronomy-root");
  const roots = { physics: workspace, chemistry: chemRoot, anatomy: anatomyRoot, astronomy: astronomyRoot };

  const physicsOnlyControls = [
    document.getElementById("run-controls"),
    document.getElementById("gravity-controls"),
    document.getElementById("light-mode-toggle-wrap"),
    document.getElementById("clear-btn"),
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
    challengeBtn.style.display = mode === "astronomy" ? "" : (mode === "physics" ? "" : "none");
    quizBtn.style.display = mode === "chemistry" || mode === "anatomy" ? "" : "none";

    if (mode === "physics") startParticleLoop(); else stopParticleLoop();

    if (mode === "chemistry") {
      if (!chemistryMode) chemistryMode = new ChemistryMode(chemRoot, { state });
      chemistryMode.mount();
    } else {
      chemistryMode?.unmount();
    }

    if (mode === "anatomy") {
      if (!anatomyMode) anatomyMode = new AnatomyMode(anatomyRoot);
      anatomyMode.mount();
    } else {
      anatomyMode?.unmount();
    }

    if (mode === "astronomy") {
      if (!astronomyMode) astronomyMode = new AstronomyMode(astronomyRoot, { state, showToast });
      astronomyMode.mount();
    } else {
      astronomyMode?.unmount();
    }
  }

  physicsBtn.addEventListener("click", () => setMode("physics"));
  chemistryBtn.addEventListener("click", () => setMode("chemistry"));
  anatomyBtn.addEventListener("click", () => setMode("anatomy"));
  astronomyBtn.addEventListener("click", () => setMode("astronomy"));

  state.mode = null;
  setMode("physics");
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
    } else if ((e.code === "Delete" || e.code === "Backspace") && state.selectedId && !state.playing) {
      e.preventDefault();
      deleteObject(state.selectedId);
    } else if (e.code === "Escape") {
      state.selectedId = null;
      renderAll();
      renderPanelUI();
    } else if (cmd && e.code === "KeyC" && state.selectedId && !state.playing) {
      e.preventDefault();
      copySelected();
    } else if (cmd && e.code === "KeyV" && clipboard && !state.playing) {
      e.preventDefault();
      pasteClipboard();
    }
  });
}

function copySelected() {
  const spec = state.objects.find((o) => o.id === state.selectedId);
  if (!spec) return;
  clipboard = cloneSpec(spec);
  showToast("Copied");
}

function pasteClipboard() {
  if (!clipboard) return;
  const spec = cloneSpec(clipboard);
  spec.id = makeId(spec.type);
  spec.x = snap(spec.x + 40);
  spec.y = snap(spec.y + 40);
  if (spec.targetId) spec.targetId = null; // don't silently share a trigger link with the original
  state.objects.push(spec);
  state.selectedId = spec.id;
  renderAll();
  renderPanelUI();
  scheduleSave();
  // paste again from the same spot, so repeated ⌘V lays out a diagonal trail
  clipboard = cloneSpec(spec);
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
    spec.x = snap(x);
    spec.y = snap(y);
    state.objects.push(spec);
    state.selectedId = spec.id;
    renderAll();
    renderPanelUI();
    scheduleSave();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

boot();
