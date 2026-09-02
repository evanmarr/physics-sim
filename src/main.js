import { Renderer } from "./render.js";
import { renderPalette } from "./palette.js";
import { renderPanel } from "./panel.js";
import { renderShop, tryPurchase } from "./economy.js";
import { CHALLENGES, findChallenge, ChallengeTracker } from "./challenges.js";
import { OBJECT_DEFS, createSpec, cloneSpec } from "./objectTypes.js";
import { PhysicsSim } from "./physics.js";
import { loadState, saveState, clearSave } from "./storage.js";
import { snap, WORLD } from "./world.js";

const state = {
  objects: [],
  selectedId: null,
  playing: false,
  gravity: 1,
  coins: 20,
  unlocked: new Set(),
  completedChallenges: new Set(),
  activeChallengeId: null,
};

let sim = null;
let tracker = null;

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
    onMove: (id, x, y) => { patchObject(id, { x, y }); },
    onRotate: (id, deg) => { patchObject(id, { rotation: deg }); },
  });
  window._renderer = renderer;

  renderer.centerOn(0, WORLD.groundY - 700, 0.7);

  renderPaletteUI();
  renderPanelUI();
  renderAll();
  updateCoinUI();

  wireTopbar(renderer);
  wireShop();
  wireChallenges();
  wireCanvasDrop(renderer);
  wireKeyboard(renderer);

  window.addEventListener("beforeunload", () => saveState(state));
}

function renderAll() {
  const items = state.objects.map(specToRenderItem);
  window._renderer.render(items, { editable: !state.playing, selectedId: state.selectedId });
}

function specToRenderItem(s) {
  return { ...s };
}

function patchObject(id, patch) {
  const spec = state.objects.find((o) => o.id === id);
  if (!spec) return;
  Object.assign(spec, patch);
  renderAll();
  renderPanelUI();
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
    onChange: (id, patch) => { patchObject(id, patch); renderPanelUI(); },
    onDelete: (id) => { deleteObject(id); },
  });
}

function deleteObject(id) {
  state.objects = state.objects.filter((o) => o.id !== id);
  state.objects.forEach((o) => { if (o.targetId === id) o.targetId = null; });
  if (state.selectedId === id) state.selectedId = null;
  renderAll();
  renderPanelUI();
  scheduleSave();
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
}

function togglePlay(renderer) {
  const playBtn = document.getElementById("play-btn");
  const banner = document.getElementById("mode-banner");

  if (!state.playing) {
    state.selectedId = null;
    renderPanelUI();
    const clones = state.objects.map(cloneSpec);
    tracker = state.activeChallengeId ? new ChallengeTracker(findChallenge(state.activeChallengeId)) : null;
    sim = new PhysicsSim(clones, state.gravity, {
      onFrame: (items) => renderer.render(items, { editable: false }),
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
  if (!tracker) return;
  const justCompleted = tracker.onEvent(event);
  if (justCompleted) {
    const challenge = tracker.challenge;
    if (!state.completedChallenges.has(challenge.id)) {
      state.completedChallenges.add(challenge.id);
      state.coins += challenge.reward;
      updateCoinUI();
      scheduleSave();
    }
    showToast(`Challenge complete: ${challenge.name} (+${challenge.reward})`);
  }
}

function updateCoinUI() {
  document.getElementById("coin-count").textContent = state.coins;
  renderPaletteUI();
}

function showToast(msg) {
  const toast = document.getElementById("challenge-toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 3500);
}

function wireShop() {
  const modal = document.getElementById("shop-modal");
  const refresh = () => {
    renderShop(document.getElementById("shop-items"), state, {
      onPurchase: (type) => {
        if (tryPurchase(state, type)) {
          updateCoinUI();
          scheduleSave();
          refresh();
        }
      },
    });
  };
  document.getElementById("shop-btn").addEventListener("click", () => {
    refresh();
    modal.classList.remove("hidden");
  });
  document.getElementById("shop-close").addEventListener("click", () => modal.classList.add("hidden"));
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
      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = `${c.description} Reward: ${c.reward} coins.`;
      info.appendChild(name);
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

function wireKeyboard(renderer) {
  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

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
    }
  });
}

function beginPaletteDrag(type, pointerEvent) {
  if (state.playing) return;
  const def = OBJECT_DEFS[type];
  if (def.category === "shop" && !state.unlocked.has(type)) return;

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

function wireCanvasDrop(renderer) {
  // reserved for future: keyboard-based nudge, context menu, etc.
}

boot();
