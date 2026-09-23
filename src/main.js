import { Renderer, openSpeedUnitMenu, currentSpeedUnitLabel } from "./render.js";
import { renderPalette } from "./palette.js";
import { renderPanel, renderPhysicsMathPanel, renderMultiPanel } from "./panel.js";
import { physicsMath, effectiveDensity } from "./physicsEdu.js";
import { PRESETS, getPreset, matchPreset, presetInfo } from "./physicsPresets.js";
import { initMeasureTools, measureOnFrame, measureOnReset, measureRefresh } from "./measureTools.js";
import { simMass } from "./measureMath.js";
import { initParamSweepUI } from "./paramSweep.js";
import { registerVariationApplier } from "./classroom.js";
import { CHALLENGES, findChallenge, ChallengeTracker } from "./challenges.js";
import { CHEMISTRY_CHALLENGES } from "./chemistryChallenges.js";
import { HISTORY_CHALLENGES } from "./historyChallenges.js";
import { CYBER_CHALLENGES } from "./cyberChallenges.js";
import { CHALLENGES as ROCKET_CHALLENGES } from "./rocketSim.js";
import { OBJECT_DEFS, createSpec, cloneSpec, makeId } from "./objectTypes.js";
import { materialOf } from "./materials.js";
import { PhysicsSim } from "./physics.js";
import { loadState, saveState, clearSave } from "./storage.js";
import { snap, WORLD } from "./world.js";
import { ChemistryMode } from "./chemistry.js";
import { AstronomyMode } from "./astronomy.js";
import { HistoryMode } from "./history.js";
import { CybersecurityMode } from "./cybersecurity.js";
import { MathematicsMode } from "./mathematics.js";
import { WhiteboardMode } from "./whiteboard.js";
import { EconomicsMode } from "./economics.js";
import { ZoologyMode } from "./zoology.js";
import { SoundMode } from "./sound.js";
import { SustainabilityMode } from "./sustainability.js";
import { WarMode } from "./war.js";
import { traceLightRays } from "./lightOptics.js";
import { openQuiz } from "./quiz.js";
import { initAuthUI, openSavesPanel, sendFeedback, fetchCommunitySimById, verifyUnlockCode, escapeHtml, getUser, onAuthChange, fetchFeaturedSims, fetchCommunitySims, fetchMyFavoriteIds, fetchItems, fetchWeeklyChallengeCount, completeWeeklyChallenge, fetchChallengeCompletions, completeChallengeRemote } from "./auth.js";
import { difficultyBadgeHtml } from "./challengeTiers.js";
import { initClassroomUI } from "./classroom.js";
import { initPlansUI } from "./plans.js";
import { initAITutorUI, openAITutor, applySharedAiChat } from "./aiTutor.js";
import { initCustomItemsUI, openCustomItemsHome } from "./customItems.js";
import { initPhysicsGraphPanel, renderPhysicsGraphPanel, pushGraphSample, resetGraphPanel } from "./physicsGraphPanel.js";
import { initNotebookUI, openNotebookHome, applySharedNotebookEntry } from "./notebook.js";
import { initModelInfoUI, openModelInfo } from "./modelInfo.js";
import { renderExperienceLevelPicker, getExperienceLevel } from "./experienceLevel.js";
import { initWorldShareUI } from "./worldShare.js";
import { initDashboardUI, registerShareApplier } from "./dashboard.js";
import { initNotificationsUI } from "./notifications.js";
import { initAchievementsUI, refreshAchievements, onChallengeCompleted } from "./achievements.js";
import { initSearchUI } from "./search.js";
import { initOnboarding } from "./onboarding.js";
import { initTutorial } from "./tutorial.js";
import { initDeviceMode, showPrompt as showDeviceModePrompt } from "./deviceMode.js";
import { toggleUnitSystem, distanceUnitSuffix, weightUnitSuffix, gridSquareInUnits } from "./units.js";
import { confirmPopup, alertPopup, promptPopup } from "./popup.js";
import { startLoadingAnimation, finishLoading } from "./loading.js";
import { generateSnapshot } from "./snapshot.js";

const state = {
  objects: [],
  selectedId: null, // set only when selectedIds has exactly one member — see syncSelectedId()
  selectedIds: new Set(),
  playing: false,
  gravity: 1,
  airFriction: 1, // multiplier on every object's air drag; 1.0 = ordinary Earth air
  frictionScale: 1, // global multiplier on every object's friction (Real-World presets like Ice)
  completedChallenges: new Set(),
  activeChallengeId: null,
  mathPanelOpen: true,
  graphPanelOpen: false,
  lightMode: false,
  showMagneticField: false,
  grabToolActive: false,
  grabShape: "ball",
  // Set whenever a world is loaded from somewhere that could carry a
  // publish-time lock code (My Worlds, Community Sims Open, a shared link)
  // — see requestUnlock() and panel.js's Locked checkbox. Null means
  // "nothing here is tied to any code," so Locked objects unlock for free.
  worldLock: null,
  simSpeed: 1,
  multiSelectMode: false, // mobile-only: tapping objects adds to selection instead of replacing it
};

let sim = null;
let tracker = null;
let clipboard = null; // in-app copy/paste buffer — an array of specs, not the OS clipboard
let chemistryMode = null;
let astronomyMode = null;
let historyMode = null;
let cybersecurityMode = null;
let mathematicsMode = null;
let whiteboardMode = null;
let economicsMode = null;
let zoologyMode = null;
let soundMode = null;
let sustainabilityMode = null;
let warMode = null;

// Old saves stored a rope as x/y + rotation + length; the current model is
// two independent endpoints (x,y) and (x2,y2). Backfill x2/y2 from the old
// fields so one saved before this change still loads with the same shape
// instead of collapsing to a zero-length default.
function migrateRopeSpecs(objects) {
  for (const spec of objects) {
    if (spec.type !== "rope") continue;
    if (spec.x2 == null) {
      const rad = (spec.rotation || 0) * (Math.PI / 180);
      const length = spec.length ?? 240;
      spec.x2 = spec.x + Math.cos(rad) * length;
      spec.y2 = spec.y + Math.sin(rad) * length;
    }
    // Rope is now rubber-only (see panel.js) — force any older save's rope
    // back to rubber rather than leaving it stuck on a material the picker
    // can no longer set.
    spec.material = "rubber";
  }
}

// The circuitry feature (battery/lightbulb/switch/resistor/transistor, and
// the old always-static circuit motor) was removed — drop any of those
// types left over in an older save rather than rendering broken objects.
// NOTE: "wire" is NOT in this set even though the old circuitry feature had
// one — that identifier was later reused for the current button/bomb/cannon
// wiring feature (see physics.js's _computeWireLinks), which is very much
// alive, so filtering it here would silently delete a real, working object
// out of anyone's saved world every time it loads.
const REMOVED_TYPES = new Set(["battery", "lightbulb", "switchComp", "resistor", "transistor", "motor", "track"]);
function dropRemovedTypes(objects) {
  return objects.filter((spec) => !REMOVED_TYPES.has(spec.type));
}

function persistWorld() {
  saveState(state);
}

function starterScene() {
  return [
    { id: "starter_ground", type: "board", x: 0, y: WORLD.groundY, rotation: 0, width: 2000, height: 60, material: "wood", fixed: true },
  ];
}

// Every modal in the app (Quiz, Challenges, Sign in, My Worlds/Saves, the
// custom confirm/alert popup, and each mode's own "X Challenges" dialog)
// shares the same .modal (dimmed backdrop) / .modal-box (content) markup —
// one delegated listener here closes any of them on a backdrop click
// (clicking the box itself never bubbles a click whose target IS .modal),
// so newly-added modals get this for free without their own wiring.
document.addEventListener("click", (e) => {
  if (e.target.classList?.contains("modal") && !e.target.classList.contains("hidden")) {
    e.target.classList.add("hidden");
  }
});

function boot() {
  initDeviceMode();
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
      else if (shiftKey || state.multiSelectMode) {
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
    onRotateMany: (moves) => {
      moves.forEach(({ id, ...patch }) => patchObjectSilent(id, patch));
      renderAll();
      scheduleSave();
    },
    onRotate: (id, deg) => { patchObject(id, { rotation: deg }); renderPanelUI(); },
    onEndpointMove: (id, { x, y, x2, y2 }) => { patchObject(id, { x, y, x2, y2 }); },
    // Hovering to right-click doesn't exist on a touchscreen, so mobile mode
    // gets its own gesture for the same jobs: double-tap an object for a
    // Copy menu, double-tap empty space for a Paste menu.
    onObjectDblClick: (id, clientX, clientY) => {
      if (state.playing || document.documentElement.dataset.device !== "mobile") return;
      state.selectedIds = new Set([id]);
      syncSelectedId();
      renderAll();
      renderPanelUI();
      showTouchMenu(clientX, clientY, [{ label: "Copy", onClick: copySelected }]);
    },
    onEmptyDblClick: (worldX, worldY, clientX, clientY) => {
      if (state.playing || document.documentElement.dataset.device !== "mobile" || !clipboard?.length) return;
      showTouchMenu(clientX, clientY, [{ label: "Paste", onClick: () => pasteClipboardAt(worldX, worldY) }]);
    },
    onLockedEditAttempt: () => showToast("Locked — uncheck Locked in the panel to edit"),
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

  window.addEventListener("beforeunload", persistWorld);
}

function renderAll() {
  const items = state.objects.map(specToRenderItem);
  window._renderer.render(items, { editable: !state.playing, selectedId: state.selectedId, selectedIds: state.selectedIds });
  updateTrajectoryPreview();
  updateLightRays(items);
  updateMagneticField(items);
}

function specToRenderItem(s) {
  return { ...s };
}

function patchObject(id, patch) {
  const spec = state.objects.find((o) => o.id === id);
  if (!spec) return;
  markUndo();
  Object.assign(spec, patch);
  // While a run is in progress, push the edit onto the live body instead
  // of re-rendering from this (stale-positioned) blueprint — the running
  // sim's own next frame already re-renders from the live bodies moments
  // later, so a renderAll() here would just flash every object back to
  // its pre-Play position for one frame before that correction lands.
  if (state.playing && sim) sim.applyLiveEdit(id, patch);
  else renderAll();
  scheduleSave();
}

// Same as patchObject but skips the render/save — for batch updates (e.g.
// dragging a multi-selection) where the caller renders once at the end.
function patchObjectSilent(id, patch) {
  const spec = state.objects.find((o) => o.id === id);
  if (!spec) return;
  markUndo();
  Object.assign(spec, patch);
}

// The multi-select panel's "mass edit" — applies one patch to every given
// id at once, as a single undo step (markUndo's own debounce merges the
// per-id calls below rather than creating one step per object).
function patchAllSelected(ids, patch) {
  for (const id of ids) {
    patchObjectSilent(id, patch);
    if (state.playing && sim) sim.applyLiveEdit(id, patch);
  }
  renderAll();
  scheduleSave();
}

// ---- Undo (physics mode) ----
// Every edit that mutates state.objects/gravity funnels through here.
// Continuous bursts (dragging a slider, dragging an object) are coalesced
// into a single undo step by capturing the "before" snapshot once and only
// committing it after things go quiet for a moment — same debounce idea as
// scheduleSave, so an undo reverts a whole drag, not one pixel of it.
const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];
let pendingUndoSnapshot = null;
let undoCommitTimer = null;

function snapshotForUndo() {
  return { objects: JSON.parse(JSON.stringify(state.objects)), gravity: state.gravity };
}

function commitPendingUndo() {
  clearTimeout(undoCommitTimer);
  if (!pendingUndoSnapshot) return;
  undoStack.push(pendingUndoSnapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  pendingUndoSnapshot = null;
  updateUndoButton();
}

function markUndo() {
  if (!pendingUndoSnapshot) { pendingUndoSnapshot = snapshotForUndo(); redoStack = []; }
  clearTimeout(undoCommitTimer);
  undoCommitTimer = setTimeout(commitPendingUndo, 400);
}

// For one-shot actions (delete, paste, clear, load) — commits immediately
// as its own step, so it doesn't get merged into an unrelated pending drag.
function pushUndoNow() {
  commitPendingUndo();
  undoStack.push(snapshotForUndo());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  updateUndoButton();
}

function applySnapshot(snap) {
  state.objects = snap.objects;
  state.gravity = snap.gravity;
  document.getElementById("gravity-slider").value = state.gravity;
  document.getElementById("gravity-val").textContent = state.gravity.toFixed(1);
  if (sim) sim.setGravity(state.gravity);
  state.selectedIds = new Set();
  state.selectedId = null;
  renderAll();
  renderPanelUI();
  scheduleSave();
  updateUndoButton();
}

function undo() {
  if (state.playing) return;
  commitPendingUndo();
  const snap = undoStack.pop();
  if (!snap) return;
  redoStack.push(snapshotForUndo());
  applySnapshot(snap);
}

function redo() {
  if (state.playing) return;
  const snap = redoStack.pop();
  if (!snap) return;
  undoStack.push(snapshotForUndo());
  applySnapshot(snap);
}

function updateUndoButton() {
  const undoBtn = document.getElementById("undo-btn");
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  const redoBtn = document.getElementById("redo-btn");
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// state.selectedId mirrors state.selectedIds only when it's a single
// object — that's the only case the property panel and rotate handle
// know how to show.
function syncSelectedId() {
  state.selectedId = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null;
  measureRefresh();
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistWorld, 300);
}

function renderPaletteUI() {
  renderPalette(document.getElementById("palette"), state, {
    onDragStart: (type, pointerEvent) => beginPaletteDrag(type, pointerEvent),
    onOpenCustomItems: () => openCustomItemsHome(),
  });
}

function renderPanelUI() {
  const panelEl = document.getElementById("prop-panel");
  if (state.selectedIds.size > 1) {
    const specs = state.objects.filter((o) => state.selectedIds.has(o.id));
    renderMultiPanel(panelEl, specs, state, {
      onChangeAll: (ids, patch) => patchAllSelected(ids, patch),
      onDeleteAll: () => deleteSelected(),
    });
    renderMathPanelUI();
    return;
  }
  const spec = state.objects.find((o) => o.id === state.selectedId) || null;
  renderPanel(panelEl, spec, state, {
    onChange: (id, patch) => { patchObject(id, patch); },
    onDelete: (id) => { deleteObject(id); },
    onUnlock: () => requestUnlock(),
    mathPanelOpen: state.mathPanelOpen,
    onOpenMath: () => { state.mathPanelOpen = true; renderMathPanelUI(); renderPanelUI(); },
  });
  renderMathPanelUI();
}

// The one path that clears a Locked checkbox — free when this world was
// never tied to a publish-time code (state.worldLock is null/hasLock false),
// otherwise prompts for the 6-digit code once per world-load and remembers
// a correct entry for the rest of the session (state.worldLock.verified).
async function requestUnlock() {
  if (!state.worldLock?.hasLock) return true;
  if (state.worldLock.verified) return true;
  const code = await promptPopup("Enter the 6-digit code to unlock objects in this world:", { title: "Locked", placeholder: "123456", maxLength: 6 });
  if (code === null) return false;
  if (!/^\d{6}$/.test(code.trim())) { await alertPopup("Enter exactly 6 digits.", { title: "Invalid code" }); return false; }
  const result = await verifyUnlockCode(state.worldLock.kind, state.worldLock.id, code.trim());
  if (!result?.ok) { await alertPopup("That code isn't right.", { title: "Couldn't unlock" }); return false; }
  state.worldLock.verified = true;
  return true;
}

// Equations every selected object has in common — same editable variable
// (density, friction, restitution, shatter threshold, ...), so one slider
// here really does mean the same thing on each of them. Values can differ
// between objects; the line shows the first one's and says so.
function sharedMathLines(specs) {
  const per = specs.map((s) => physicsMath(s));
  if (per.some((lines) => !lines)) return [];
  return per[0]
    .filter((line) => line.edit && per.every((lines) => lines.some((l) => l.edit?.key === line.edit.key)))
    .map((line) => {
      const values = per.map((lines) => lines.find((l) => l.edit?.key === line.edit.key).edit.value);
      const differs = values.some((v) => Math.abs(v - values[0]) > 1e-9);
      return differs ? { ...line, note: `${line.note} (These objects currently have different values — shown here is the first one's; changing it sets them all to the same.)` } : line;
    });
}

function renderMathPanelUI() {
  const panelEl = document.getElementById("physics-math-panel");
  const spec = state.objects.find((o) => o.id === state.selectedId) || null;
  panelEl.classList.toggle("hidden", !state.mathPanelOpen);
  if (state.mathPanelOpen && state.selectedIds.size > 1) {
    const specs = state.objects.filter((o) => state.selectedIds.has(o.id) && !o.locked);
    renderPhysicsMathPanel(
      panelEl, null,
      () => { state.mathPanelOpen = false; renderMathPanelUI(); renderPanelUI(); },
      (key, value) => { patchAllSelected(specs.map((o) => o.id), { [key]: value }); renderMathPanelUI(); },
      { lines: sharedMathLines(specs), count: specs.length }
    );
    return;
  }
  if (state.mathPanelOpen) {
    renderPhysicsMathPanel(
      panelEl, spec,
      () => { state.mathPanelOpen = false; renderMathPanelUI(); renderPanelUI(); },
      (key, value) => { if (spec) patchObject(spec.id, { [key]: value }); renderMathPanelUI(); }
    );
  }
}

function deleteObject(id) {
  const spec = state.objects.find((o) => o.id === id);
  if (spec?.locked) { showToast("Locked — uncheck Locked in the panel to edit"); return; }
  pushUndoNow();
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
  const locked = state.objects.filter((o) => state.selectedIds.has(o.id) && o.locked);
  const ids = new Set([...state.selectedIds].filter((id) => !locked.some((o) => o.id === id)));
  if (!ids.size) { showToast("Locked — uncheck Locked in the panel to edit"); return; }
  pushUndoNow();
  state.objects = state.objects.filter((o) => !ids.has(o.id));
  state.objects.forEach((o) => { if (o.targetId && ids.has(o.targetId)) o.targetId = null; });
  state.selectedIds = new Set();
  syncSelectedId();
  renderAll();
  renderPanelUI();
  scheduleSave();
  if (locked.length) showToast(`Deleted ${ids.size} — ${locked.length} locked object${locked.length === 1 ? "" : "s"} skipped`);
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
  sim.setAirFriction(state.airFriction);
  sim.setFrictionScale(state.frictionScale);
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

function updateMagneticField(items) {
  if (!state.showMagneticField) { window._renderer.renderMagneticField([]); return; }
  window._renderer.renderMagneticField(items.filter((it) => it.type === "magnet"));
}

// ---- Cosmetic water/wind particles (edit mode preview + during Play) ----
let particleClock = 0;
let particleRafId = null;
function startParticleLoop() {
  stopParticleLoop();
  const loop = () => {
    particleClock += 1;
    // Checking `sim` here (not state.playing) matters specifically for
    // Pause: state.playing goes false on pause too, and this decorative
    // loop used to read that as "back to editing," redrawing wind streaks
    // at their original blueprint positions and stomping the frozen paused
    // frame the real sim had just drawn — visibly "jumping" wind back on
    // every pause. `sim` staying alive (just not running) is what actually
    // distinguishes paused from truly stopped.
    const items = sim ? null : state.objects;
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

// A scanned/clicked Community Sim share link (see auth.js's showShareLink)
// lands here as ?sim=<id> — fetched and opened in the right mode, then the
// param is stripped so refreshing/sharing the resulting URL from the
// browser bar doesn't keep re-opening it.
async function _openSharedSimFromUrl() {
  const id = new URLSearchParams(location.search).get("sim");
  if (!id) return;
  history.replaceState(null, "", location.pathname);
  await openCommunitySimById(id);
}

function applyPhysicsWorldData(renderer, data, lockMeta = null) {
  if (state.playing) togglePlay(renderer);
  pushUndoNow();
  state.objects = dropRemovedTypes(data.objects || []);
  migrateRopeSpecs(state.objects);
  state.gravity = data.gravity ?? 1;
  document.getElementById("gravity-slider").value = state.gravity;
  document.getElementById("gravity-val").textContent = state.gravity.toFixed(1);
  sim?.setGravity(state.gravity);
  state.selectedIds = new Set();
  state.selectedId = null;
  state.activeChallengeId = null;
  // Each freshly-loaded world gets its own lock context — a code entered to
  // unlock the previous world's objects shouldn't carry over and silently
  // unlock this one's too.
  state.worldLock = lockMeta ? { ...lockMeta, verified: false } : null;
  renderer.fitToObjects(state.objects);
  renderAll();
  renderPanelUI();
  scheduleSave();
}

function wireTopbar(renderer) {
  const playBtn = document.getElementById("play-btn");
  playBtn.addEventListener("click", () => togglePlay(renderer));
  document.getElementById("reset-btn").addEventListener("click", () => resetPhysics(renderer));
  document.getElementById("grab-tool-btn").addEventListener("click", () => setGrabToolActive(!state.grabToolActive));
  document.getElementById("grab-shape-select").addEventListener("change", (e) => {
    state.grabShape = e.target.value;
    if (state.grabToolActive && sim) { sim.disableGrabTool(); sim.enableGrabTool(state.grabShape); }
  });
  // Only the camera — same starting pan/zoom the app opens with (line ~203
  // above), not "fit to objects", since the whole point is a known, fixed
  // place to get back to after scrolling/zooming off into nowhere.
  document.getElementById("reset-view-btn").addEventListener("click", () => {
    renderer.centerOn(0, WORLD.groundY - 700, 0.7);
  });

  const gravitySlider = document.getElementById("gravity-slider");
  const gravityVal = document.getElementById("gravity-val");
  gravitySlider.addEventListener("input", () => {
    markUndo();
    state.gravity = parseFloat(gravitySlider.value);
    gravityVal.textContent = state.gravity.toFixed(1);
    if (sim) sim.setGravity(state.gravity);
    updateTrajectoryPreview();
    syncPresetPicker();
  });

  const speedSlider = document.getElementById("speed-slider");
  const speedVal = document.getElementById("speed-val");
  speedSlider.addEventListener("input", () => {
    state.simSpeed = parseFloat(speedSlider.value);
    speedVal.textContent = state.simSpeed.toFixed(1);
    if (sim) sim.setTimeScale(state.simSpeed);
  });

  document.getElementById("speed-reset-btn").addEventListener("click", () => {
    state.simSpeed = 1;
    speedSlider.value = 1;
    speedVal.textContent = "1.0";
    if (sim) sim.setTimeScale(1);
  });

  document.getElementById("gravity-reset-btn").addEventListener("click", () => {
    markUndo();
    state.gravity = 1;
    gravitySlider.value = 1;
    gravityVal.textContent = "1.0";
    if (sim) sim.setGravity(state.gravity);
    updateTrajectoryPreview();
    syncPresetPicker();
  });

  document.getElementById("clear-btn").addEventListener("click", async () => {
    if (state.playing) togglePlay(renderer);
    if (!(await confirmPopup("Clear the whole workspace?", { title: "Clear workspace", confirmLabel: "Clear", danger: true }))) return;
    pushUndoNow();
    state.objects = starterScene();
    state.selectedIds = new Set();
    state.selectedId = null;
    state.activeChallengeId = null;
    renderAll();
    renderPanelUI();
    scheduleSave();
  });

  document.getElementById("undo-btn").addEventListener("click", () => undo());
  document.getElementById("redo-btn").addEventListener("click", () => redo());

  document.getElementById("light-mode-btn").addEventListener("click", () => {
    state.lightMode = !state.lightMode;
    document.getElementById("light-mode-btn").classList.toggle("active", state.lightMode);
    renderAll();
  });

  document.getElementById("field-mode-btn").addEventListener("click", () => {
    state.showMagneticField = !state.showMagneticField;
    document.getElementById("field-mode-btn").classList.toggle("active", state.showMagneticField);
    renderAll();
  });

  document.getElementById("quiz-btn").addEventListener("click", () => openQuiz(state.mode));

  document.getElementById("my-worlds-btn").addEventListener("click", () => {
    openSavesPanel({
      kind: "worlds",
      title: "My Physics Worlds",
      itemNoun: "world",
      serialize: () => ({ objects: state.objects, gravity: state.gravity }),
      apply: (data, lockMeta) => applyPhysicsWorldData(renderer, data, lockMeta),
      getSnapshot: () => generateSnapshot(state.objects),
    });
  });
  registerShareApplier("worlds", (data) => { window._setMode("physics"); applyPhysicsWorldData(window._renderer, data); });
  registerShareApplier("mathItems", (data) => { window._setMode("mathematics"); mathematicsMode.applySavedData(data); });
  registerShareApplier("cities", (data) => { window._setMode("sustainability"); sustainabilityMode.applySavedData(data); });
  registerShareApplier("notebookEntries", (data) => applySharedNotebookEntry(data));
  registerShareApplier("aiChats", (data) => { openAITutor(); applySharedAiChat(data); });
  registerShareApplier("whiteboards", (data) => { window._setMode("whiteboard"); whiteboardMode.applySharedSketch(data); });
  registerShareApplier("notes", (data) => { window._setMode("whiteboard"); whiteboardMode.applySharedNote(data); });
  registerShareApplier("rocketFlights", (data) => { window._setMode("astronomy"); astronomyMode.applySharedRocketFlight?.(data); });
  _openSharedSimFromUrl();

  initAuthUI();
  initClassroomUI();
  initPlansUI();
  initPhysicsViewTabs();
  wireAppsModal();
  initPresetPicker();
  initMeasureTools({
    getRenderer: () => window._renderer,
    getSelectedId: () => state.selectedId,
    getMass: (id) => { const sp = state.objects.find((o) => o.id === id); return sp ? massEstimate(sp) * 1e-3 : null; },
  });
  initParamSweepUI({
    getSpecs: () => state.objects,
    getSelectedId: () => state.selectedId,
    getEnv: () => ({ gravity: state.gravity, airFriction: state.airFriction, frictionScale: state.frictionScale }),
    openPlans: () => document.getElementById(getUser() ? "plans-btn" : "account-btn")?.click(),
  });
  registerVariationApplier(applyAssignmentVariation);
  initCustomItemsUI(placeCustomPolygon);
  initPhysicsGraphPanel(document.getElementById("physics-graph-panel"));
  initNotebookUI(() => (state.mode === "physics" ? { objects: state.objects, gravity: state.gravity } : null));
  initAITutorUI();
  document.getElementById("notebook-btn").addEventListener("click", openNotebookHome);
  initModelInfoUI();
  document.getElementById("physics-model-info-btn").addEventListener("click", () => openModelInfo(PHYSICS_MODEL_INFO));
  // Explore hides the equations panel by default (low-friction sandbox);
  // Learn/Advanced show it (per the product's Explore/Learn/Advanced
  // definitions) — a real behavioral difference, not just a label, tied to
  // a panel that already existed rather than inventing new complexity.
  state.mathPanelOpen = getExperienceLevel() !== "explore";
  const rerenderExperiencePicker = () => renderExperienceLevelPicker(document.getElementById("experience-level-picker"), (level) => {
    state.mathPanelOpen = level !== "explore";
    renderMathPanelUI();
  });
  rerenderExperiencePicker();
  // This panel is built once at startup, not per Physics-mode visit — so
  // without this, signing into (or out of) a Plus account after the app
  // has already loaded left the Advanced pill showing its stale locked/
  // unlocked state until a hard refresh happened to race the auth fetch
  // correctly. onAuthChange already exists for exactly this kind of thing
  // (see buildHomeRails's own subscription).
  onAuthChange(rerenderExperiencePicker);
  initWorldShareUI({
    getWorldData: () => ({ objects: state.objects, gravity: state.gravity }),
    applyWorldData: (data) => applyPhysicsWorldData(window._renderer, data),
    hasUnsavedWork: () => state.objects.length > 0,
  });
  document.getElementById("graph-panel-btn").addEventListener("click", () => {
    state.graphPanelOpen = !state.graphPanelOpen;
    document.getElementById("graph-panel-btn").classList.toggle("active", state.graphPanelOpen);
    renderPhysicsGraphPanel(state);
  });
  initDashboardUI();
  initNotificationsUI();
  initAchievementsUI(state);
  onChallengeCompleted(checkWeeklyCompletion);
  onChallengeCompleted(syncChallengeToAccount);
  onAuthChange(syncChallengeCompletionsFromAccount);
  initSearchUI(searchIndex);
  initOnboarding();
  initTutorial();
  document.getElementById("about-btn").addEventListener("click", () => document.getElementById("about-modal").classList.remove("hidden"));
  document.getElementById("about-close").addEventListener("click", () => document.getElementById("about-modal").classList.add("hidden"));
  wireFeedback();

  wireMenu();
  wireTheme();
  document.getElementById("device-mode-btn").addEventListener("click", () => showDeviceModePrompt(true));
  wireUnitsToggle();
  wireMobileEditControls();
  startParticleLoop();
}

function wireMobileEditControls() {
  document.getElementById("mobile-copy-btn").addEventListener("click", copySelected);
  document.getElementById("mobile-paste-btn").addEventListener("click", pasteClipboard);
  const multiBtn = document.getElementById("mobile-multiselect-btn");
  multiBtn.addEventListener("click", () => {
    state.multiSelectMode = !state.multiSelectMode;
    multiBtn.classList.toggle("active", state.multiSelectMode);
  });
}

function wireUnitsToggle() {
  const btn = document.getElementById("units-toggle-btn");
  const badge = document.getElementById("grid-scale-badge");
  function refresh() {
    btn.textContent = `${distanceUnitSuffix()}/${weightUnitSuffix()}`;
    const squares = gridSquareInUnits();
    const shown = Number(squares.toFixed(2));
    badge.textContent = `1 square = ${shown} ${distanceUnitSuffix()}`;
  }
  btn.addEventListener("click", () => {
    toggleUnitSystem();
    refresh();
    renderPanelUI();
  });
  refresh();

  // A moving object's own speed readout has always had its own unit
  // choice (double-click the label in the canvas) — this button is just a
  // second, reliable way into that same menu, since double-clicking a
  // label that's actively moving is fiddly at best.
  const speedBtn = document.getElementById("speed-unit-btn");
  speedBtn.textContent = currentSpeedUnitLabel();
  speedBtn.addEventListener("click", () => {
    const rect = speedBtn.getBoundingClientRect();
    openSpeedUnitMenu(rect.left + rect.width / 2, rect.bottom, (label) => { speedBtn.textContent = label; });
  });
}

function wireFeedback() {
  const modal = document.getElementById("feedback-modal");
  const text = document.getElementById("feedback-text");
  const open = () => { text.value = ""; modal.classList.remove("hidden"); text.focus(); };
  const close = () => modal.classList.add("hidden");

  document.getElementById("feedback-btn").addEventListener("click", open);
  document.getElementById("feedback-cancel").addEventListener("click", close);
  document.getElementById("feedback-submit").addEventListener("click", async () => {
    const message = text.value.trim();
    if (!message) { text.focus(); return; }
    const result = await sendFeedback(message);
    if (result.error) { await alertPopup(result.error, { title: "Couldn't send feedback" }); return; }
    close();
    showToast("Thanks — feedback sent.");
  });
}

function wireAppsModal() {
  const modal = document.getElementById("apps-modal");
  const open = () => modal.classList.remove("hidden");
  document.getElementById("apps-menu-btn").addEventListener("click", open);
  document.getElementById("apps-footer-btn").addEventListener("click", open);
  document.getElementById("apps-close").addEventListener("click", () => modal.classList.add("hidden"));
}

function wireMenu() {
  const btn = document.getElementById("menu-btn");
  const dropdown = document.getElementById("menu-dropdown");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  });
  // Any button inside the menu closes it once clicked, same as the account
  // dropdown — nobody wants it still hanging open over whatever just opened.
  dropdown.addEventListener("click", (e) => {
    if (e.target.closest("button")) dropdown.classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!dropdown.classList.contains("hidden") && !document.getElementById("menu-wrap").contains(e.target)) {
      dropdown.classList.add("hidden");
    }
  });
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
    document.getElementById("theme-toggle").textContent = "Light Mode";
  } else {
    delete document.documentElement.dataset.theme;
    document.getElementById("theme-toggle").textContent = "Dark Mode";
  }
  // The Particle Physics iframe demos default to a dark palette and only
  // have a "light" override block (no bare/default light rules), so the
  // light case needs an explicit data-theme="light" — deleting the
  // attribute would just fall back to their dark default. Same-origin
  // (served from this same app), so its document is reachable straight
  // through contentDocument, no postMessage needed.
  const particlesDoc = document.getElementById("particles-frame")?.contentDocument;
  if (particlesDoc) particlesDoc.documentElement.dataset.theme = theme;
}

// Play/Pause toggle. Pausing freezes every body exactly where it is (the
// sim itself stays alive underneath, just not ticking) so Play resumes
// from that same frozen moment — it does NOT rewind to the blueprint.
// That's what Reset is for (see resetPhysics below).
function togglePlay(renderer) {
  const playBtn = document.getElementById("play-btn");
  const banner = document.getElementById("mode-banner");

  if (state.playing) {
    sim?.pause();
    state.playing = false;
    playBtn.textContent = "Play";
    playBtn.classList.remove("playing");
    banner.textContent = "PAUSED — space to resume";
  } else if (sim) {
    sim.resume();
    state.playing = true;
    playBtn.textContent = "Pause";
    playBtn.classList.add("playing");
    banner.textContent = "SIMULATING — space to pause";
  } else {
    // Collapses a multi-selection to nothing (editing several objects at
    // once during a live simulation doesn't make sense), but deliberately
    // keeps a single selection intact rather than clearing it outright —
    // Live Graphs (below, in onFrame) is entirely keyed off
    // state.selectedId, so nulling it here meant pressing Play right after
    // selecting an object silently broke graphing for that entire run
    // (and lost the selection highlight during simulation too).
    state.selectedIds = state.selectedId ? new Set([state.selectedId]) : new Set();
    renderPanelUI();
    window._renderer.renderTrajectory(null);
    const clones = state.objects.map(cloneSpec);
    tracker = state.activeChallengeId ? new ChallengeTracker(findChallenge(state.activeChallengeId)) : null;
    sim = new PhysicsSim(clones, state.gravity, {
      onFrame: (items) => {
        renderer.render(items, { editable: false });
        if (state.graphPanelOpen && state.selectedId) {
          const item = items.find((it) => it.id === state.selectedId);
          const spec = state.objects.find((o) => o.id === state.selectedId);
          if (item) pushGraphSample(sim.simTime, item, spec ? massEstimate(spec) : null);
        }
        checkChallengeFrame(items);
        measureOnFrame(items, sim.simTime);
        if (state.lightMode) updateLightRays(items);
        if (state.showMagneticField) updateMagneticField(items);
        window._renderer.renderParticles(sim.collectParticleItems());
        window._renderer.renderRopeTubes(sim.collectRopePaths());
      },
      onEvent: (event) => handleSimEvent(event),
    });
    sim.setAirFriction(state.airFriction);
    sim.setFrictionScale(state.frictionScale);
    sim.setTimeScale(state.simSpeed);
    sim.start();
    if (state.grabToolActive) sim.enableGrabTool(state.grabShape);
    state.playing = true;
    playBtn.textContent = "Pause";
    playBtn.classList.add("playing");
    banner.textContent = "SIMULATING — space to pause";
    banner.classList.remove("hidden");
  }
}

// Reset always reverts to the original blueprint and leaves it stopped —
// unlike Play/Pause, it never resumes running on its own. Bound to both
// the Reset button and the R key.
function resetPhysics(renderer) {
  sim?.stop();
  sim = null;
  state.playing = false;
  resetGraphPanel();
  measureOnReset();
  const playBtn = document.getElementById("play-btn");
  playBtn.textContent = "Play";
  playBtn.classList.remove("playing");
  document.getElementById("mode-banner").classList.add("hidden");
  window._renderer.renderRopeTubes([]);
  window._renderer.renderParticles([]);
  setGrabToolActive(false);
  renderAll();
}

// Grab tool: while active during Play, the pointer drives a real Matter
// body (see PhysicsSim.enableGrabTool) so moving the mouse can bump other
// objects around with real momentum, not just a visual cursor.
function setGrabToolActive(active) {
  state.grabToolActive = active;
  const btn = document.getElementById("grab-tool-btn");
  btn.classList.toggle("active", active);
  const svg = document.getElementById("canvas");
  window._renderer.setGrabActive(active);
  if (active) {
    sim?.enableGrabTool(state.grabShape);
    svg.addEventListener("pointerdown", onGrabPointerDown);
    svg.addEventListener("pointermove", onGrabPointerMove);
  } else {
    sim?.disableGrabTool();
    svg.removeEventListener("pointerdown", onGrabPointerDown);
    svg.removeEventListener("pointermove", onGrabPointerMove);
  }
}

// Captures the pointer to the canvas on touch-down so a fast finger swipe
// that briefly slips past the SVG's edge keeps generating pointermove
// events on it instead of silently losing tracking mid-drag.
function onGrabPointerDown(ev) {
  try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
}

function onGrabPointerMove(ev) {
  if (!sim) return;
  const { x, y } = window._renderer.screenToWorld(ev.clientX, ev.clientY);
  sim.setGrabTarget(x, y);
}

// Real facts about THIS sandbox's actual implementation (src/physics.js) —
// every figure here is verified against that file, not asserted from
// general physics knowledge. Where something can't be stated precisely
// (e.g. the exact real-world equivalence of the gravity slider's "1.0x"),
// it's left as an adjustable multiplier rather than a specific claimed value.
const PHYSICS_MODEL_INFO = {
  title: "Physics 2D Sandbox",
  concept: "A real 2D rigid-body physics simulation — every object is a genuine Matter.js physics body with real mass, friction, and restitution, not a scripted animation.",
  equation: "F = ma   (Newton's second law, applied every simulation step)",
  variables: [
    { symbol: "F", meaning: "net force on a body", unit: "N (Matter.js internal units)" },
    { symbol: "m", meaning: "mass, from material density × the object's own area", unit: "kg-equivalent" },
    { symbol: "a", meaning: "resulting acceleration" },
  ],
  constants: [
    { name: "Wood density / friction / restitution", value: "0.6 / 0.45 / 0.25" },
    { name: "Metal density / friction / restitution", value: "7.8 / 0.3 / 0.1" },
    { name: "Rubber density / friction / restitution", value: "1.1 / 0.95 / 0.92" },
    { name: "Glass density / friction / restitution", value: "2.5 / 0.1 / 0.15" },
  ],
  assumptions: [
    "Gravity is a constant downward acceleration, adjustable as a multiplier (default 1.0x) rather than varying with height.",
    "Collisions are resolved by Matter.js's iterative constraint solver (10 position, 8 velocity, 6 constraint iterations per step).",
  ],
  limitations: [
    "Two-dimensional only — no motion or rotation out of the plane.",
    "Uses a fixed, discrete timestep (semi-implicit Euler integration), not a continuous/analytic solution — fast-moving thin objects can occasionally tunnel through each other in one frame.",
    "Material presets (wood/metal/rubber/glass) are illustrative relative values chosen to feel right, not measured samples of a specific real material.",
  ],
  sources: ["Newtonian mechanics (F = ma, momentum, restitution)", "Matter.js — the actual physics engine this sandbox runs on"],
};

// A relative mass proxy for the Live Graphs panel's kinetic-energy series
// — material density × on-screen area. Real ratios (denser material really
// does weigh more here), but not a calibrated real-world kilogram figure,
// which is why that series is labeled "relative units," not Joules.
function massEstimate(spec) {
  const density = effectiveDensity(spec, materialOf(spec.material));
  const area = spec.radius ? Math.PI * spec.radius * spec.radius : (spec.width || 40) * (spec.height || 40);
  return density * area;
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
    refreshAchievements(challenge.id);
    scheduleSave();
  }
  showToast(`Challenge complete: ${challenge.name}`);
}

// A tiny floating menu at a screen point — the touch equivalent of a
// desktop right-click menu, used for double-tap copy/paste on mobile.
let touchMenuEl = null;
function showTouchMenu(clientX, clientY, items) {
  touchMenuEl?.remove();
  const menu = document.createElement("div");
  menu.className = "touch-menu";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    btn.addEventListener("click", () => { item.onClick(); closeTouchMenu(); });
    menu.appendChild(btn);
  }
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  document.body.appendChild(menu);
  touchMenuEl = menu;
  setTimeout(() => document.addEventListener("pointerdown", closeTouchMenuOutside, true), 0);
}
function closeTouchMenu() {
  touchMenuEl?.remove();
  touchMenuEl = null;
  document.removeEventListener("pointerdown", closeTouchMenuOutside, true);
}
function closeTouchMenuOutside(e) {
  if (!touchMenuEl?.contains(e.target)) closeTouchMenu();
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
      name.innerHTML = `${escapeHtml(c.name)}${c.difficulty ? " " + difficultyBadgeHtml(c.difficulty) : ""}${state.completedChallenges.has(c.id) ? " ✓" : ""}`;
      const concept = document.createElement("div");
      concept.className = "concept-tag";
      concept.textContent = c.concept;
      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = c.objective;
      info.appendChild(name);
      info.appendChild(concept);
      info.appendChild(desc);
      if (c.startingState) {
        const starting = document.createElement("div");
        starting.className = "challenge-hint-text";
        starting.innerHTML = `<strong>Starting state:</strong> ${escapeHtml(c.startingState)}`;
        info.appendChild(starting);
      }
      if (c.successCondition) {
        const success = document.createElement("div");
        success.className = "challenge-hint-text";
        success.innerHTML = `<strong>Success:</strong> ${escapeHtml(c.successCondition)}`;
        info.appendChild(success);
      }
      if (c.hint) {
        const hintToggle = document.createElement("button");
        hintToggle.className = "challenge-hint-toggle";
        hintToggle.textContent = "Show hint";
        const hintText = document.createElement("div");
        hintText.className = "challenge-hint-text hidden";
        hintText.textContent = c.hint;
        hintToggle.addEventListener("click", () => {
          hintText.classList.toggle("hidden");
          hintToggle.textContent = hintText.classList.contains("hidden") ? "Show hint" : "Hide hint";
        });
        info.appendChild(hintToggle);
        info.appendChild(hintText);
      }
      if (c.explanation) {
        const expToggle = document.createElement("button");
        expToggle.className = "challenge-hint-toggle";
        expToggle.textContent = "Why this works";
        const expText = document.createElement("div");
        expText.className = "challenge-hint-text hidden";
        expText.innerHTML = `${escapeHtml(c.explanation)}${c.source ? `<br><em>${escapeHtml(c.source)}</em>` : ""}`;
        expToggle.addEventListener("click", () => {
          expText.classList.toggle("hidden");
          expToggle.textContent = expText.classList.contains("hidden") ? "Why this works" : "Hide explanation";
        });
        info.appendChild(expToggle);
        info.appendChild(expText);
      }
      const btn = document.createElement("button");
      btn.className = "primary";
      btn.textContent = "Load";
      btn.addEventListener("click", async () => {
        if (!(await confirmPopup(`Load "${c.name}"? This replaces your current workspace.`, { title: "Load challenge", confirmLabel: "Load" }))) return;
        pushUndoNow();
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
  { mode: "physics", title: "Physics", blurb: "Build contraptions with real 2D physics — ramps, cannons, springs, portals, and more.", kind: "physics", hues: [22, 205] },
  { mode: "chemistry", title: "Chemistry", blurb: "Explore the periodic table, mix real reactions, and watch atoms bond in 3D.", kind: "chemistry", hues: [355, 150] },
  { mode: "astronomy", title: "Astronomy", blurb: "Real orbital mechanics for the whole solar system, at any date you choose.", kind: "astronomy", hues: [45, 285] },
  { mode: "history", title: "History", blurb: "Browse a timeline of landmark moments across physics, chemistry, and more.", kind: "history", hues: [35, 45] },
  { mode: "cybersecurity", title: "Cybersecurity", blurb: "Search and filter well-documented malware, hackers, hacker groups, and breaches.", kind: "cybersecurity", hues: [0, 340] },
  { mode: "particles", title: "Particle Physics", blurb: "A gallery of real D3 force simulations — drag anything you see.", kind: "particles", hues: [190, 270] },
  { mode: "mathematics", title: "Mathematics", blurb: "A real graphing calculator — plot any expression, pan and zoom the graph.", kind: "mathematics", hues: [230, 350] },
  { mode: "whiteboard", title: "Whiteboard", blurb: "A draw surface for sketching ideas and equations, plus a simple notebook for text notes.", kind: "whiteboard", hues: [160, 40] },
  { mode: "economics", title: "Economics", blurb: "A real supply-and-demand market (with taxes and price controls) and a repeated Prisoner's Dilemma sandbox.", kind: "economics", hues: [140, 20] },
  { mode: "zoology", title: "Zoology", blurb: "Explore food chains and energy pyramids, then build your own food web from real predator-prey relationships.", kind: "zoology", hues: [95, 30] },
  { mode: "sound", title: "Sound", blurb: "Record your voice and watch the real waveform, or build your own tones with a live oscillator.", kind: "sound", hues: [260, 190] },
  { mode: "war", title: "War", blurb: "Place armies, paint terrain, give orders, and watch real agent-based battles play out.", kind: "war", hues: [5, 30] },
  { mode: "sustainability", title: "Sustainability", blurb: "Run a city — route energy, manage pollution, and grow your population without wrecking either.", kind: "sustainability", hues: [150, 210] },
];

// A few of Physics's own easier challenge scenes, reused as one-click
// "starting points" on the home page — real, already-verified contraptions
// rather than an empty canvas, but framed as something to tweak and explore
// instead of a puzzle to solve.
const HOME_TEMPLATE_IDS = ["float_test", "fan_lift", "glass_breaker"];

// Recently-viewed sections: purely local (per-browser) navigation history,
// not anything the server tracks — just enough to let "pick back up where
// you left off" mean something without inventing fake activity data.
const RECENTLY_VIEWED_KEY = "kinetic-recently-viewed-v1";
function loadRecentlyViewed() {
  try { return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY)) || []; } catch { return []; }
}
function recordRecentlyViewed(mode) {
  const section = HOME_SECTIONS.find((s) => s.mode === mode);
  if (!section) return; // "home" itself, or anything not a real launcher section
  const list = loadRecentlyViewed().filter((r) => r.mode !== mode);
  list.unshift({ mode, title: section.title, ts: Date.now() });
  try { localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* private browsing, quota, etc. — just skip persisting */ }
}

// Same challenge deterministically for everyone, all day — a hash of
// today's UTC date selects the index, so it rotates once every 24 hours
// without needing a server-side scheduler or any stored state.
function dailyChallenge() {
  if (!CHALLENGES.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  let h = 0;
  for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) | 0;
  return CHALLENGES[Math.abs(h) % CHALLENGES.length];
}

// Same deterministic-hash idea as the Physics-only Daily Challenge above,
// but drawn from a pool spanning every sandbox with its own challenge
// system, and rotating once a week (an ISO-ish year+week key) instead of
// once a day — a reason to check back on a sandbox you don't visit often,
// without needing a server-side scheduler here either.
//
// `id` on every entry is the EXACT string that ends up in
// state.completedChallenges for that challenge (see achievements.js's own
// comment on this same per-sandbox prefixing) — that's what lets
// checkWeeklyCompletion() below recognize "the challenge that was just
// completed happens to be this week's pick" and report it to the server.
function weeklyPool() {
  return [
    ...CHALLENGES.map((c) => ({ sandbox: "Physics", name: c.name, detail: c.objective, id: c.id, go: () => openPhysicsChallengeById(c.id) })),
    ...CHEMISTRY_CHALLENGES.map((c) => ({ sandbox: "Chemistry", name: c.name, detail: c.description, id: "chem_" + c.id, go: () => { window._setMode("chemistry"); chemistryMode.openChallenges(); } })),
    ...HISTORY_CHALLENGES.map((c) => ({ sandbox: "History", name: c.title, detail: c.hint, id: c.id, go: () => { window._setMode("history"); historyMode.openChallenges(); } })),
    ...CYBER_CHALLENGES.map((c) => ({ sandbox: "Cybersecurity", name: c.hint, detail: "", id: c.id, go: () => { window._setMode("cybersecurity"); cybersecurityMode.openChallenges(); } })),
    ...ROCKET_CHALLENGES.map((c) => ({ sandbox: "Rocket Simulator", name: c.name, detail: c.objective, id: "rocket_" + c.id, go: () => { window._setMode("astronomy"); astronomyMode.openRocketChallenges(); } })),
    { sandbox: "Astronomy", name: "Find the Next Solar Eclipse", detail: "Search forward from today for the next real solar eclipse alignment.", id: "astro_find_eclipse", go: () => { window._setMode("astronomy"); astronomyMode.openChallenges(); } },
  ];
}

function weekKey(date = new Date()) {
  const jan1 = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - jan1) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

function weeklyChallenge() {
  const pool = weeklyPool();
  if (!pool.length) return null;
  const key = weekKey();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length];
}

// Fired (via achievements.js's onChallengeCompleted, which every sandbox's
// own completion call site already reports to) whenever anything completes
// anywhere — checks whether it happens to be THIS week's pick, and if so
// reports it to the server and refreshes the on-screen count so it updates
// live without needing a page reload.
function checkWeeklyCompletion(id) {
  const weekly = weeklyChallenge();
  if (!weekly || weekly.id !== id) return;
  // Recording it needs an account (see auth.js's comment on this same
  // function) — completing challenges themselves never has, so plenty of
  // people hit this signed out. Without this, completeWeeklyChallenge's
  // 401 gets swallowed silently and the count on screen just never moves,
  // with nothing telling you why.
  if (!getUser()) {
    showToast("Sign in to have this count toward the shared Weekly Challenge total.");
    return;
  }
  completeWeeklyChallenge(weekKey(), id).then((count) => {
    if (count != null) setWeeklyChallengeCountUI(count);
    else showToast("Couldn't record that toward the Weekly Challenge total — check your connection.");
  });
}

// Same "fires on every completion, anywhere" hook checkWeeklyCompletion
// uses, for a different job: mirroring it to the account so Achievements
// and every sandbox's own "(Completed)" markers follow the SIGNED-IN
// ACCOUNT instead of being stuck on whichever device/browser first earned
// them. Silently does nothing signed out — completing challenges locally
// has never required an account, and there's no device identity worth
// syncing progress against, so it just stays local (as it always has)
// until a sign-in triggers syncChallengeCompletionsFromAccount below.
function syncChallengeToAccount(id) {
  if (!getUser()) return;
  completeChallengeRemote(id);
}

// Pulls this account's full completion history down and merges it into
// the LOCAL set (union, never removes anything already completed on this
// device) — called once right after sign-in resolves. A brand new device
// signing into an existing account picks up every challenge/achievement
// that account already earned elsewhere; nothing already completed here
// but not yet synced (e.g. earned signed-out, just signed in) is lost.
async function syncChallengeCompletionsFromAccount() {
  if (!getUser()) return;
  const completed = await fetchChallengeCompletions();
  if (!completed) return;
  let changed = false;
  for (const id of completed) {
    if (!state.completedChallenges.has(id)) { state.completedChallenges.add(id); changed = true; }
  }
  if (changed) { refreshAchievements(); scheduleSave(); }
}

function setWeeklyChallengeCountUI(count) {
  const el = document.getElementById("weekly-challenge-count");
  if (el) el.textContent = countLabel(count);
}

function countLabel(count) {
  return `${count.toLocaleString()} ${count === 1 ? "person has" : "people have"} completed this`;
}

// Global search's index: all 12 sandboxes (so typing a subject name jumps
// straight there) plus every challenge each one defines (reusing
// weeklyPool()'s same {sandbox, name, detail, go} shape — one list of
// "everything you can search for," not two separately maintained ones).
const SEARCH_SANDBOXES = [
  { mode: "physics", label: "Physics" },
  { mode: "chemistry", label: "Chemistry" },
  { mode: "astronomy", label: "Astronomy" },
  { mode: "history", label: "History" },
  { mode: "cybersecurity", label: "Cybersecurity" },
  { mode: "particles", label: "Particle Physics" },
  { mode: "mathematics", label: "Mathematics" },
  { mode: "whiteboard", label: "Whiteboard" },
  { mode: "economics", label: "Economics" },
  { mode: "zoology", label: "Zoology" },
  { mode: "sound", label: "Sound" },
  { mode: "sustainability", label: "Sustainability" },
  { mode: "war", label: "War" },
];

function searchIndex() {
  const sandboxItems = SEARCH_SANDBOXES.map((s) => ({ title: s.label, subtitle: "Sandbox", go: () => window._setMode(s.mode) }));
  const challengeItems = weeklyPool().map((w) => ({ title: w.name || w.sandbox, subtitle: `${w.sandbox} challenge`, go: w.go }));
  return [...sandboxItems, ...challengeItems];
}

// Shared by the home page's Daily Challenge/Templates cards and (via a
// small wrapper) the Physics Challenges modal's own Load button — one
// definition of "what loading a challenge actually does."
function openPhysicsChallengeById(id) {
  const c = findChallenge(id);
  if (!c) return;
  window._setMode("physics");
  pushUndoNow();
  state.objects = c.build();
  state.activeChallengeId = c.id;
  state.selectedIds = new Set();
  state.selectedId = null;
  renderAll();
  renderPanelUI();
  scheduleSave();
}

// Shared by the home page's sim cards and the ?sim=<id> share-link opener
// (see _openSharedSimFromUrl) — one definition of "what opening a
// published Community Sim actually does."
async function openCommunitySimById(id) {
  try {
    const sim = await fetchCommunitySimById(id);
    if (!sim) { showToast("That sim couldn't be found — it may have been unpublished."); return; }
    if (sim.kind === "worlds") { window._setMode("physics"); applyPhysicsWorldData(window._renderer, sim.data, { kind: "community-sim", id: sim.id, hasLock: sim.hasLock }); }
    else if (sim.kind === "math-items") { window._setMode("mathematics"); mathematicsMode.applySavedData(sim.data); }
    showToast(`Opened "${sim.name}" by ${sim.creatorName}`);
  } catch {
    showToast("Couldn't load that sim.");
  }
}
// Exposed so the Notification Center (src/notifications.js) can open a
// "someone favorited/remixed your world" or "new world from a creator you
// subscribed to" link with the exact same graceful-if-deleted handling
// the home page's own sim cards get — not a second implementation of it.
window._openCommunitySimById = openCommunitySimById;

function buildHomePage(root, onNavigate) {
  root.innerHTML = `
    <canvas class="home-bg" aria-hidden="true"></canvas>
    <div class="home-wrap">
      <div class="home-hero">
        <img class="home-logo" src="icons/kinetic-logo-transparent.png" width="48" height="48" alt="" aria-hidden="true" />
        <div class="home-kicker">thirteen sandboxes · one app</div>
        <h1>Kinetic</h1>
        <p class="home-slogan">Build it. Change it. See what happens.</p>
        <p class="home-tagline">Real simulations, not animations — physics, chemistry, astronomy,
          mathematics, economics, zoology, sound, a city to run sustainably, a whiteboard for your own
          ideas, and the history and security behind them all. Pick a section to start.</p>
        <div class="home-hero-ctas">
          <button class="home-cta home-cta-primary" id="home-cta-create">Create</button>
          <button class="home-cta home-cta-secondary" id="home-cta-explore">Explore</button>
          <button class="home-cta home-cta-surprise" id="home-cta-surprise">Surprise Me</button>
        </div>
      </div>
      <div class="home-rails"></div>
      <div class="home-all-sandboxes">
        <h2 class="home-section-title">All Sandboxes</h2>
        <div class="home-cards"></div>
      </div>
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
  initHomeBackground(root.querySelector(".home-bg"), root);

  root.querySelector("#home-cta-create").addEventListener("click", () => onNavigate("physics"));
  root.querySelector("#home-cta-explore").addEventListener("click", () => {
    root.querySelector(".home-all-sandboxes").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  root.querySelector("#home-cta-surprise").addEventListener("click", () => surpriseMe(onNavigate));

  buildHomeRails(root.querySelector(".home-rails"), onNavigate);
  onAuthChange(() => buildHomeRails(root.querySelector(".home-rails"), onNavigate));
}

// A real random pick across whatever's actually available right now — the
// 12 sandboxes always count, and once the Featured/Community rails have
// loaded their random pool grows to include real published sims too, so
// this stays an honest "surprise" instead of a fixed rotation.
let _surprisePool = [];
// buildHomeRails is async and re-triggered by onAuthChange (which fires
// once refreshUser()'s initial /me check resolves, shortly after the home
// page's own direct call already kicked one off) — without this guard, the
// first (now-stale) call's later `await`s resolve after the second call has
// already cleared and started repopulating the same container, so both
// end up appending their own copies of every rail. Each call captures its
// own generation number and bails as soon as a newer call has started.
let _homeRailsGen = 0;
function surpriseMe(onNavigate) {
  const pool = [...HOME_SECTIONS.map((s) => ({ kind: "mode", mode: s.mode })), ..._surprisePool];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (!pick) return;
  if (pick.kind === "mode") onNavigate(pick.mode);
  else if (pick.kind === "sim") openCommunitySimById(pick.id);
  else if (pick.kind === "challenge") openPhysicsChallengeById(pick.id);
}

// The dynamic rails below the hero: some are always-available real content
// (Daily Challenge, Featured Templates, Featured Creator Worlds, Community
// Sims), others only make sense signed in (Continue Experimenting,
// Favorites) and simply don't render when there's nothing real to show —
// no placeholder/empty-state filler standing in for a section with no data.
async function buildHomeRails(container, onNavigate) {
  const myGen = ++_homeRailsGen;
  container.innerHTML = "";
  _surprisePool = [];
  const user = getUser();

  const simCard = (sim) => {
    const card = document.createElement("button");
    card.className = "home-rail-card home-rail-card-sim";
    card.innerHTML = `
      ${sim.snapshot ? `<img class="home-rail-thumb" src="${sim.snapshot}" alt="" />` : `<div class="home-rail-thumb home-rail-thumb-blank"></div>`}
      <div class="home-rail-card-title">${escapeHtml(sim.name)}</div>
      <div class="home-rail-card-sub">by ${escapeHtml(sim.creatorName)}</div>
    `;
    card.addEventListener("click", () => openCommunitySimById(sim.id));
    return card;
  };

  // Continue Experimenting — your own most-recently-updated Physics world.
  if (user) {
    try {
      const items = await fetchItems("worlds");
      if (myGen !== _homeRailsGen) return;
      if (items[0]) {
        const item = items[0];
        addRail(container, "Continue Experimenting", [(() => {
          const card = document.createElement("button");
          card.className = "home-rail-card home-rail-card-sim";
          card.innerHTML = `
            ${item.snapshot ? `<img class="home-rail-thumb" src="${item.snapshot}" alt="" />` : `<div class="home-rail-thumb home-rail-thumb-blank"></div>`}
            <div class="home-rail-card-title">${escapeHtml(item.name)}</div>
            <div class="home-rail-card-sub">Resume where you left off</div>
          `;
          card.addEventListener("click", () => { onNavigate("physics"); applyPhysicsWorldData(window._renderer, item.data, { kind: "worlds", id: item.id, hasLock: !!item.hasLock }); });
          return card;
        })()]);
      }
    } catch { /* not signed in / offline — just skip this rail */ }
  }

  // Favorites — the small number of Community Sims you've hearted, fetched
  // individually by id since favoriting doesn't return full sim records.
  if (user) {
    try {
      const ids = (await fetchMyFavoriteIds()).slice(0, 10);
      const sims = (await Promise.all(ids.map((id) => fetchCommunitySimById(id).catch(() => null)))).filter(Boolean);
      if (myGen !== _homeRailsGen) return;
      if (sims.length) addRail(container, "Favorites", sims.map(simCard));
      _surprisePool.push(...sims.map((s) => ({ kind: "sim", id: s.id })));
    } catch { /* ignore */ }
  }

  // Recently Viewed — this browser's own navigation history, not anything
  // the server knows about.
  const recent = loadRecentlyViewed();
  if (recent.length) {
    addRail(container, "Recently Viewed", recent.map((r) => {
      const card = document.createElement("button");
      card.className = "home-rail-card home-rail-card-recent";
      card.innerHTML = `<div class="home-rail-card-title">${escapeHtml(r.title)}</div>`;
      card.addEventListener("click", () => onNavigate(r.mode));
      return card;
    }));
  }

  // Featured Creator Worlds — hand-curated via the local admin dashboard
  // (~/physics-sim-admin), not from anything on this site.
  try {
    const sims = await fetchFeaturedSims();
    if (myGen !== _homeRailsGen) return;
    if (sims.length) addRail(container, "Featured Creator Worlds", sims.map(simCard));
    _surprisePool.push(...sims.map((s) => ({ kind: "sim", id: s.id })));
  } catch { /* ignore */ }

  // Community Sims — everything published, most recent first.
  try {
    const sims = (await fetchCommunitySims()).slice(0, 10);
    if (myGen !== _homeRailsGen) return;
    if (sims.length) addRail(container, "Community Sims", sims.map(simCard));
    _surprisePool.push(...sims.map((s) => ({ kind: "sim", id: s.id })));
  } catch { /* ignore */ }

  // Daily Challenge — one real Physics challenge, the same one for
  // everyone, that changes once every 24 hours (see dailyChallenge()).
  const daily = dailyChallenge();
  if (daily) {
    const card = document.createElement("button");
    card.className = "home-rail-card home-rail-card-challenge";
    card.innerHTML = `
      <div class="home-rail-card-badge">${difficultyBadgeHtml(daily.difficulty)}</div>
      <div class="home-rail-card-title">${escapeHtml(daily.name)}</div>
      <div class="home-rail-card-sub">${escapeHtml(daily.concept)}</div>
    `;
    card.addEventListener("click", () => openPhysicsChallengeById(daily.id));
    addRail(container, "Daily Challenge", [card]);
    _surprisePool.push({ kind: "challenge", id: daily.id });
  }

  // Weekly Challenge — same idea, but drawn from every sandbox's own
  // challenge pool (not just Physics) and rotating once every 7 days
  // instead of every 24 hours (see weeklyChallenge()).
  const weekly = weeklyChallenge();
  if (weekly) {
    const card = document.createElement("button");
    card.className = "home-rail-card home-rail-card-challenge";
    card.innerHTML = `
      <div class="home-rail-card-badge"><span class="sandbox-badge">${escapeHtml(weekly.sandbox)}</span></div>
      <div class="home-rail-card-title">${escapeHtml(weekly.name || "")}</div>
      ${weekly.detail ? `<div class="home-rail-card-sub">${escapeHtml(weekly.detail)}</div>` : ""}
      <div class="home-rail-card-count" id="weekly-challenge-count">…</div>
    `;
    card.addEventListener("click", () => weekly.go());
    addRail(container, "Weekly Challenge", [card]);
    fetchWeeklyChallengeCount(weekKey()).then((count) => { if (count != null) setWeeklyChallengeCountUI(count); });
  }

  // Featured Templates — a few of Physics's own easier scenes, reused as
  // one-click starting points rather than a blank canvas.
  const templates = HOME_TEMPLATE_IDS.map((id) => findChallenge(id)).filter(Boolean);
  if (templates.length) {
    addRail(container, "Featured Templates", templates.map((t) => {
      const card = document.createElement("button");
      card.className = "home-rail-card home-rail-card-challenge";
      card.innerHTML = `
        <div class="home-rail-card-title">${escapeHtml(t.name)}</div>
        <div class="home-rail-card-sub">${escapeHtml(t.objective)}</div>
      `;
      card.addEventListener("click", () => openPhysicsChallengeById(t.id));
      return card;
    }));
  }
}

function addRail(container, title, cards) {
  const section = document.createElement("div");
  section.className = "home-rail";
  const heading = document.createElement("h2");
  heading.className = "home-section-title";
  heading.textContent = title;
  const track = document.createElement("div");
  track.className = "home-rail-track";
  for (const card of cards) track.appendChild(card);
  section.appendChild(heading);
  section.appendChild(track);
  container.appendChild(section);
}

// Ambient background: a living D3 force graph behind the *entire* home
// page (fixed, so it stays put while the page scrolls), livelier and more
// prominent than a typical dimmed hero decoration — more nodes, brighter,
// tinted with the app's own brand colors, and gently pushed around by the
// pointer, closer to the constantly-alive backgrounds on sites like
// seeing-theory.brown.edu than a static illustration.
function initHomeBackground(canvas, root) {
  const ctx = canvas.getContext("2d");
  let width = 0, height = 0;

  function resize() {
    const rect = root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  // The container can measure 0×0 for a tick right after the page's own
  // innerHTML is set, before layout has actually run — seed nothing until
  // a real size shows up, or the whole simulation starts collapsed at (0,0).
  resize();
  if (!(width > 0 && height > 0)) {
    requestAnimationFrame(() => initHomeBackground(canvas, root));
    return;
  }

  const n = 90;
  // Reads the app's own --cool-1/2/3 brand variables (cyan/purple/green —
  // #38bdf8/#8b5cf6/#10b981 in light mode, a softened variant in dark) so
  // this stays in sync with the theme instead of a separately hardcoded copy.
  const rootStyle = getComputedStyle(document.documentElement);
  const hexToRgbTriplet = (hex) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    return m ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` : null;
  };
  const hues = ["--cool-1", "--cool-2", "--cool-3"]
    .map((v) => hexToRgbTriplet(rootStyle.getPropertyValue(v)))
    .filter(Boolean);
  if (hues.length < 3) hues.push("125,211,252", "167,139,250", "52,211,153"); // fallback if the vars aren't defined for some reason
  const nodes = Array.from({ length: n }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    hue: hues[Math.floor(Math.random() * hues.length)],
  }));
  const links = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.random() < 0.03) links.push({ source: i, target: j });

  // The canvas has pointer-events:none (clicks must reach the cards behind
  // it), so the pointer is tracked from `root` instead — pointermove/leave
  // both bubble up from whatever's actually under the cursor.
  const pointer = { x: -9999, y: -9999, active: false };
  root.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.active = true;
  });
  root.addEventListener("pointerleave", () => { pointer.active = false; });

  function forcePointer() {
    let list;
    function force(alpha) {
      if (!pointer.active) return;
      const radius = 140;
      for (const d of list) {
        const dx = d.x - pointer.x, dy = d.y - pointer.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        if (dist >= radius) continue;
        const f = ((radius - dist) / radius) * 6 * alpha;
        d.vx += (dx / dist) * f;
        d.vy += (dy / dist) * f;
      }
    }
    force.initialize = (_nodes) => { list = _nodes; };
    return force;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    for (const l of links) {
      ctx.strokeStyle = `rgba(${l.source.hue},0.3)`;
      ctx.beginPath();
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
      ctx.stroke();
    }
    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${node.hue},0.95)`;
      ctx.shadowColor = `rgba(${node.hue},0.8)`;
      ctx.shadowBlur = 8;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  d3.forceSimulation(nodes)
    .force("charge", d3.forceManyBody().strength(-32))
    .force("link", d3.forceLink(links).distance(85).strength(0.3))
    .force("x", d3.forceX(() => width / 2).strength(0.015))
    .force("y", d3.forceY(() => height / 2).strength(0.015))
    .force("pointer", forcePointer())
    .alphaDecay(0)
    .velocityDecay(0.4)
    .on("tick", draw);
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
  } else if (section.kind === "whiteboard") {
    // A loose freehand squiggle plus a couple of sticky-note rectangles —
    // sketching and note-taking, the two most literal things this mode does.
    const path = d3.path();
    path.moveTo(24, 50);
    path.bezierCurveTo(50, 20, 70, 70, 96, 40);
    path.bezierCurveTo(112, 20, 122, 45, 138, 30);
    svg.append("path").attr("d", path.toString()).attr("fill", "none")
      .attr("stroke", colorA).attr("stroke-width", 3.5).attr("stroke-linecap", "round");
    svg.append("rect").attr("x", w - 62).attr("y", 18).attr("width", 40).attr("height", 34).attr("rx", 3)
      .attr("fill", colorB).attr("opacity", 0.85).attr("transform", `rotate(-6 ${w - 42} 35)`);
    svg.append("rect").attr("x", w - 44).attr("y", 40).attr("width", 34).attr("height", 30).attr("rx", 3)
      .attr("fill", colorA).attr("opacity", 0.7).attr("transform", `rotate(5 ${w - 27} 55)`);
  } else if (section.kind === "economics") {
    // A classic supply/demand X — downward demand line, upward supply
    // line, crossing at the equilibrium point, genuinely what this mode's
    // default market chart looks like.
    const margin = 16;
    svg.append("line").attr("x1", margin).attr("x2", margin).attr("y1", margin).attr("y2", h - margin).attr("stroke", "rgba(148,163,184,0.5)");
    svg.append("line").attr("x1", margin).attr("x2", w - margin).attr("y1", h - margin).attr("y2", h - margin).attr("stroke", "rgba(148,163,184,0.5)");
    svg.append("line").attr("x1", margin).attr("y1", margin).attr("x2", w - margin).attr("y2", h - margin).attr("stroke", colorA).attr("stroke-width", 2.5);
    svg.append("line").attr("x1", margin).attr("y1", h - margin).attr("x2", w - margin).attr("y2", margin).attr("stroke", colorB).attr("stroke-width", 2.5);
    svg.append("circle").attr("cx", (margin + w - margin) / 2).attr("cy", h / 2).attr("r", 4.5).attr("fill", "var(--text)");
  } else if (section.kind === "zoology") {
    // A tiny 3-node food chain: producer -> consumer -> predator.
    const positions = [[w * 0.22, h * 0.7], [w * 0.5, h * 0.35], [w * 0.78, h * 0.7]];
    for (let i = 0; i < positions.length - 1; i++) {
      svg.append("line").attr("x1", positions[i][0]).attr("y1", positions[i][1])
        .attr("x2", positions[i + 1][0]).attr("y2", positions[i + 1][1]).attr("stroke", "rgba(148,163,184,0.5)").attr("stroke-width", 2);
    }
    positions.forEach((p, i) => {
      svg.append("circle").attr("cx", p[0]).attr("cy", p[1]).attr("r", 9).attr("fill", i === 0 ? colorA : i === 1 ? colorB : colorA).attr("opacity", 0.85);
    });
  } else if (section.kind === "sound") {
    // A little sine-ish waveform, genuinely what the live canvas draws.
    const pts = [];
    for (let x = 8; x <= w - 8; x += 4) pts.push([x, h / 2 + Math.sin((x / w) * Math.PI * 4) * (h * 0.28)]);
    const line = d3.line();
    svg.append("path").attr("d", line(pts)).attr("fill", "none").attr("stroke", colorA).attr("stroke-width", 2.5).attr("stroke-linecap", "round");
  } else if (section.kind === "sustainability") {
    // A tiny 3x2 city grid with a couple of "buildings" filled in.
    const cols = 4, rows = 3, cell = Math.min((w - 16) / cols, (h - 16) / rows);
    const ox = (w - cell * cols) / 2, oy = (h - cell * rows) / 2;
    const filled = new Set([1, 3, 5, 8, 9]);
    let i = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      svg.append("rect").attr("x", ox + c * cell + 1).attr("y", oy + r * cell + 1).attr("width", cell - 2).attr("height", cell - 2)
        .attr("rx", 2).attr("fill", filled.has(i) ? colorA : "rgba(148,163,184,0.25)").attr("opacity", filled.has(i) ? 0.85 : 1);
      i++;
    }
  } else if (section.kind === "war") {
    // Two little armies facing off across the card.
    for (let i = 0; i < 12; i++) {
      const row = i % 4, col = Math.floor(i / 4);
      svg.append("circle").attr("cx", w * (0.16 + col * 0.07)).attr("cy", h * (0.25 + row * 0.16)).attr("r", 4.5).attr("fill", colorA).attr("opacity", 0.85);
      svg.append("circle").attr("cx", w * (0.84 - col * 0.07)).attr("cy", h * (0.25 + row * 0.16)).attr("r", 4.5).attr("fill", colorB).attr("opacity", 0.85);
    }
    svg.append("line").attr("x1", w / 2).attr("x2", w / 2).attr("y1", h * 0.12).attr("y2", h * 0.88).attr("stroke", "rgba(148,163,184,0.4)").attr("stroke-dasharray", "4 4");
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

function initPhysicsViewTabs() {

  const airSlider = document.getElementById("air-slider");
  const airVal = document.getElementById("air-val");
  const setAir = (v) => {
    state.airFriction = v;
    airSlider.value = v;
    airVal.textContent = v.toFixed(1);
    sim?.setAirFriction(v);
    updateTrajectoryPreview();
    syncPresetPicker();
  };
  airSlider.addEventListener("input", () => setAir(parseFloat(airSlider.value)));
  document.getElementById("air-reset-btn").addEventListener("click", () => setAir(1));

}

// ---- Environment: real-world presets + assignment values ----
const fmtEnv = (v) => (Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? v.toFixed(1) : v.toFixed(2));

// One place that changes gravity / air / surface / friction, so the sliders,
// the live sim and the preset picker never disagree.
function setEnvironment(env) {
  if (env.gravity != null) {
    state.gravity = env.gravity;
    document.getElementById("gravity-slider").value = env.gravity;
    document.getElementById("gravity-val").textContent = fmtEnv(env.gravity);
    sim?.setGravity(env.gravity);
  }
  if (env.airFriction != null) {
    state.airFriction = env.airFriction;
    document.getElementById("air-slider").value = env.airFriction;
    document.getElementById("air-val").textContent = fmtEnv(env.airFriction);
    sim?.setAirFriction(env.airFriction);
  }
  if (env.frictionScale != null) {
    state.frictionScale = env.frictionScale;
    sim?.setFrictionScale(env.frictionScale);
  }
  updateTrajectoryPreview();
  syncPresetPicker();
}

function syncPresetPicker() {
  const select = document.getElementById("preset-select");
  if (!select) return;
  const match = matchPreset({ gravity: state.gravity, airFriction: state.airFriction, frictionScale: state.frictionScale });
  select.value = match ? match.id : "custom";
}

function initPresetPicker() {
  const select = document.getElementById("preset-select");
  if (!select) return;
  select.innerHTML = `<option value="custom" disabled>Custom</option>` + PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  select.addEventListener("change", () => {
    const preset = getPreset(select.value);
    if (!preset) return;
    markUndo();
    setEnvironment(preset.settings);
    showToast(`${preset.label}: ${preset.facts[0]}`);
  });
  document.getElementById("preset-info-btn").addEventListener("click", () => {
    const preset = getPreset(select.value) || getPreset("earth");
    openModelInfo(presetInfo(preset));
  });
  syncPresetPicker();
}

// A teacher's randomized assignment: loads this student's own numbers into
// the sandbox. Idempotent — mass/power scale from the object's ORIGINAL value
// (remembered on first apply), so applying twice never compounds.
const SCALABLE_POWER_TYPES = new Set(["cannon", "bomb", "fan", "springPad", "magnet"]);
function applyAssignmentVariation(values, title) {
  window._setMode?.("physics");
  if (state.playing) togglePlay(window._renderer);
  pushUndoNow();
  const env = {};
  if (values.gravity != null) env.gravity = values.gravity;
  if (values.airFriction != null) env.airFriction = values.airFriction;
  if (values.frictionScale != null) env.frictionScale = values.frictionScale;
  setEnvironment(env);
  for (const spec of state.objects) {
    if (spec.fixed || spec.type === "text" || spec.type === "rope" || spec.type === "wire") continue;
    if (values.massScale != null) {
      spec.varBaseDensity = spec.varBaseDensity ?? effectiveDensity(spec, materialOf(spec.material));
      spec.densityOverride = Number((spec.varBaseDensity * values.massScale).toFixed(3));
    }
    if (values.launchPower != null && SCALABLE_POWER_TYPES.has(spec.type) && spec.power != null) {
      spec.varBasePower = spec.varBasePower ?? spec.power;
      spec.power = Math.round(spec.varBasePower * values.launchPower * 10) / 10;
    }
  }
  renderAll();
  renderPanelUI();
  scheduleSave();
  showToast(`Applied your values${title ? ` for "${title}"` : ""}`);
}

function wireModeTabs() {
  window._setMode = (mode) => setMode(mode); // exposed so code outside this closure (the dashboard's "load a shared item" flow) can switch modes too
  const brandHomeBtn = document.getElementById("brand-home-btn");
  const physicsBtn = document.getElementById("mode-physics-btn");
  const chemistryBtn = document.getElementById("mode-chemistry-btn");
  const astronomyBtn = document.getElementById("mode-astronomy-btn");
  const historyBtn = document.getElementById("mode-history-btn");
  const cybersecurityBtn = document.getElementById("mode-cybersecurity-btn");
  const particlesBtn = document.getElementById("mode-particles-btn");
  const mathematicsBtn = document.getElementById("mode-mathematics-btn");
  const whiteboardBtn = document.getElementById("mode-whiteboard-btn");
  const economicsBtn = document.getElementById("mode-economics-btn");
  const zoologyBtn = document.getElementById("mode-zoology-btn");
  const soundBtn = document.getElementById("mode-sound-btn");
  const sustainabilityBtn = document.getElementById("mode-sustainability-btn");
  const warBtn = document.getElementById("mode-war-btn");
  const modeButtons = { physics: physicsBtn, chemistry: chemistryBtn, astronomy: astronomyBtn, history: historyBtn, cybersecurity: cybersecurityBtn, particles: particlesBtn, mathematics: mathematicsBtn, whiteboard: whiteboardBtn, economics: economicsBtn, zoology: zoologyBtn, sound: soundBtn, sustainability: sustainabilityBtn, war: warBtn };

  const homeRoot = document.getElementById("home-root");
  buildHomePage(homeRoot, (mode) => setMode(mode));

  const workspace = document.getElementById("workspace");
  const chemRoot = document.getElementById("chemistry-root");
  const astronomyRoot = document.getElementById("astronomy-root");
  const historyRoot = document.getElementById("history-root");
  const cybersecurityRoot = document.getElementById("cybersecurity-root");
  const particlesRoot = document.getElementById("particles-root");
  const mathematicsRoot = document.getElementById("mathematics-root");
  const whiteboardRoot = document.getElementById("whiteboard-root");
  const economicsRoot = document.getElementById("economics-root");
  const zoologyRoot = document.getElementById("zoology-root");
  const soundRoot = document.getElementById("sound-root");
  const sustainabilityRoot = document.getElementById("sustainability-root");
  const warRoot = document.getElementById("war-root");
  const roots = { home: homeRoot, physics: workspace, chemistry: chemRoot, astronomy: astronomyRoot, history: historyRoot, cybersecurity: cybersecurityRoot, particles: particlesRoot, mathematics: mathematicsRoot, whiteboard: whiteboardRoot, economics: economicsRoot, zoology: zoologyRoot, sound: soundRoot, sustainability: sustainabilityRoot, war: warRoot };

  const physicsOnlyControls = [
    document.getElementById("run-controls"),
    document.getElementById("graph-controls"),
    document.getElementById("experience-level-picker"),
    document.getElementById("gravity-controls"),
    document.getElementById("speed-controls"),
    document.getElementById("light-mode-toggle-wrap"),
    document.getElementById("clear-btn"),
    document.getElementById("my-worlds-btn"),
    document.getElementById("undo-btn"),
    document.getElementById("redo-btn"),
  ];
  const challengeBtn = document.getElementById("challenges-btn");
  const quizBtn = document.getElementById("quiz-btn");

  function setMode(mode) {
    if (state.mode === mode) return;
    if (state.mode === "physics" && state.playing) togglePlay(window._renderer);
    state.mode = mode;
    recordRecentlyViewed(mode);

    for (const [m, btn] of Object.entries(modeButtons)) btn.classList.toggle("active", mode === m);
    brandHomeBtn.classList.toggle("active", mode === "home");
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
    const NO_QUIZ_MODES = new Set(["particles", "home", "mathematics", "whiteboard", "economics", "zoology", "sound", "sustainability", "war"]);
    quizBtn.style.display = NO_QUIZ_MODES.has(mode) ? "none" : "";

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

    if (mode === "whiteboard") {
      if (!whiteboardMode) whiteboardMode = new WhiteboardMode(whiteboardRoot);
      whiteboardMode.mount();
    } else {
      whiteboardMode?.unmount();
    }

    if (mode === "economics") {
      if (!economicsMode) economicsMode = new EconomicsMode(economicsRoot);
      economicsMode.mount();
    } else {
      economicsMode?.unmount();
    }

    if (mode === "zoology") {
      if (!zoologyMode) zoologyMode = new ZoologyMode(zoologyRoot);
      zoologyMode.mount();
    } else {
      zoologyMode?.unmount();
    }

    if (mode === "sound") {
      if (!soundMode) soundMode = new SoundMode(soundRoot);
      soundMode.mount();
    } else {
      soundMode?.unmount();
    }

    if (mode === "sustainability") {
      if (!sustainabilityMode) sustainabilityMode = new SustainabilityMode(sustainabilityRoot, { state });
      sustainabilityMode.mount();
    } else {
      sustainabilityMode?.unmount();
    }

    if (mode === "war") {
      if (!warMode) warMode = new WarMode(warRoot, { state });
      warMode.mount();
    } else {
      warMode?.unmount();
    }
  }

  brandHomeBtn.addEventListener("click", () => setMode("home"));
  physicsBtn.addEventListener("click", () => setMode("physics"));
  chemistryBtn.addEventListener("click", () => setMode("chemistry"));
  astronomyBtn.addEventListener("click", () => setMode("astronomy"));
  historyBtn.addEventListener("click", () => setMode("history"));
  cybersecurityBtn.addEventListener("click", () => setMode("cybersecurity"));
  particlesBtn.addEventListener("click", () => setMode("particles"));
  mathematicsBtn.addEventListener("click", () => setMode("mathematics"));
  whiteboardBtn.addEventListener("click", () => setMode("whiteboard"));
  economicsBtn.addEventListener("click", () => setMode("economics"));
  zoologyBtn.addEventListener("click", () => setMode("zoology"));
  soundBtn.addEventListener("click", () => setMode("sound"));
  sustainabilityBtn.addEventListener("click", () => setMode("sustainability"));
  warBtn.addEventListener("click", () => setMode("war"));

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
  // Switching demos reloads the iframe from scratch, which would otherwise
  // reset it to its own default (dark) palette regardless of the site's
  // current theme.
  particlesFrame.addEventListener("load", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  });

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
    } else if (e.code === "KeyR" && !cmd) {
      e.preventDefault();
      resetPhysics(renderer);
    } else if (e.code === "KeyG" && !cmd) {
      e.preventDefault();
      setGrabToolActive(!state.grabToolActive);
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
    } else if (cmd && e.code === "KeyZ" && !state.playing) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
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
  const pasted = _pasteWithOffset(40, 40);
  // paste again from the same spot, so repeated ⌘V lays out a diagonal trail
  clipboard = pasted.map(cloneSpec);
}

// Touch double-tap paste: same clipboard, but dropped centered on the
// tapped point instead of the keyboard shortcut's fixed diagonal offset.
function pasteClipboardAt(x, y) {
  if (!clipboard || !clipboard.length) return;
  const cx = clipboard.reduce((s, o) => s + o.x, 0) / clipboard.length;
  const cy = clipboard.reduce((s, o) => s + o.y, 0) / clipboard.length;
  _pasteWithOffset(x - cx, y - cy);
}

function _pasteWithOffset(dx, dy) {
  pushUndoNow();
  const pasted = clipboard.map((spec) => {
    const s = cloneSpec(spec);
    s.id = makeId(s.type);
    s.x = snap(s.x + dx);
    s.y = snap(s.y + dy);
    if (s.x2 != null) { s.x2 = snap(s.x2 + dx); s.y2 = snap(s.y2 + dy); } // flexible-endpoint objects (rope/track): shift both ends together
    if (s.targetId) s.targetId = null; // don't silently share a trigger link with the original
    return s;
  });
  state.objects.push(...pasted);
  state.selectedIds = new Set(pasted.map((s) => s.id));
  syncSelectedId();
  renderAll();
  renderPanelUI();
  scheduleSave();
  return pasted;
}

// Places a Custom Physics Item (see src/customItems.js) at the center of
// the current view — the same end state as a palette drag-drop
// (createSpec → undo snapshot → push → select → re-render → autosave),
// just without an actual drag gesture, since this is invoked from the
// Custom Item editor's "Place in world" button instead.
export function placeCustomPolygon({ vertices, name, material }) {
  const spec = createSpec("customPolygon");
  spec.vertices = vertices;
  spec.customItemName = name || spec.customItemName;
  if (material) spec.material = material;
  const rect = document.getElementById("canvas-wrap").getBoundingClientRect();
  const center = window._renderer.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  spec.x = snap(center.x);
  spec.y = snap(center.y);
  pushUndoNow();
  state.objects.push(spec);
  state.selectedIds = new Set([spec.id]);
  syncSelectedId();
  renderAll();
  renderPanelUI();
  scheduleSave();
}

function beginPaletteDrag(type, pointerEvent) {
  if (state.playing) return;
  const def = OBJECT_DEFS[type];
  if (def.plus && !getUser()?.entitlements?.isPlus) {
    showToast("Text is a Kinetic Plus feature");
    if (getUser()) document.getElementById("plans-btn")?.click();
    else document.getElementById("account-btn")?.click();
    return;
  }

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
    pushUndoNow();
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

startLoadingAnimation();
boot();
finishLoading();
