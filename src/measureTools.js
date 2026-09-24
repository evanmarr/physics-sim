// Physics measurement tools: ruler, protractor, stopwatch, and per-object
// velocity / force / trajectory overlays. The math lives in measureMath.js
// (unit-tested); this file only wires the toolbar row, the SVG overlay layer
// on the shared renderer, and the per-frame updates from main.js.
import { distance, angleAt, elevationDeg, pxToMeters, velocityToMps, ForceEstimator, Stopwatch, formatSeconds, TrajectoryRecorder } from "./measureMath.js";
import { distanceUnitScale, distanceUnitSuffix } from "./units.js";

const COLORS = { ruler: "#f5c542", protractor: "#c084fc", velocity: "#4ade80", force: "#f87171", trajectory: "#38bdf8" };
const TOOLS = [
  { id: "ruler", label: "Ruler", tip: "Drag on the canvas to measure a distance" },
  { id: "protractor", label: "Protractor", tip: "Click a vertex, then two more points to measure the angle between them" },
  { id: "stopwatch", label: "Stopwatch", tip: "Times the simulation (respects pause and the speed slider)" },
  { id: "velocity", label: "Velocity", tip: "Arrow showing the selected object's velocity while it runs" },
  { id: "force", label: "Force", tip: "Arrow showing the selected object's net force, F = m·a" },
  { id: "trajectory", label: "Trajectory", tip: "Trace the path the selected object takes" },
];

let host, rowEl, deps;
let active = null; // "ruler" | "protractor" | null — the tool currently capturing canvas clicks
let overlays = { velocity: false, force: false, trajectory: false, stopwatch: false };
let ruler = null; // { a, b }
let protractor = []; // up to 3 points: vertex, arm A, arm B
let lastItems = [], lastSimTime = 0;
const stopwatch = new Stopwatch();
const forceEst = new Map(); // id -> ForceEstimator
const trajectories = new TrajectoryRecorder();
let layer = null, swEl = null, statusEl = null, dragging = false;

export function initMeasureTools(options) {
  deps = options; // { getRenderer, getSelectedId, getMass(id) }
  host = document.getElementById("measure-btn");
  rowEl = document.getElementById("measure-row");
  if (!host || !rowEl) return;
  host.addEventListener("click", () => {
    const open = rowEl.classList.toggle("hidden") === false;
    host.classList.toggle("active", open);
    if (!open) { setActive(null); }
  });
  buildRow();
  attachCanvasCapture();
}

function buildRow() {
  rowEl.innerHTML = `
    <span class="measure-label">Measure</span>
    ${TOOLS.map((t) => `<button class="measure-tool" data-tool="${t.id}" title="${t.tip}" style="--tool:${COLORS[t.id] || "var(--accent)"}">${t.label}</button>`).join("")}
    <button id="measure-clear" title="Remove every measurement and trace">Clear</button>
    <span class="measure-stopwatch hidden" id="measure-stopwatch">
      <span class="measure-time" id="measure-time">0.00 s</span>
      <button id="sw-toggle">Start</button><button id="sw-lap">Lap</button><button id="sw-reset">Reset</button>
      <span class="measure-laps" id="sw-laps"></span>
    </span>
    <span class="measure-status" id="measure-status"></span>
    <span class="measure-note" title="Lengths use the grid (1 square = 1 m). Speeds and forces are scaled to match, but this is a sandbox — treat them as consistent relative values, not lab measurements.">sandbox units</span>`;
  swEl = rowEl.querySelector("#measure-stopwatch");
  statusEl = rowEl.querySelector("#measure-status");
  rowEl.querySelectorAll(".measure-tool").forEach((btn) => btn.addEventListener("click", () => toggleTool(btn.dataset.tool)));
  rowEl.querySelector("#measure-clear").addEventListener("click", clearAll);
  rowEl.querySelector("#sw-toggle").addEventListener("click", () => {
    if (stopwatch.running) stopwatch.stop(lastSimTime); else stopwatch.start(lastSimTime);
    refreshStopwatch();
  });
  rowEl.querySelector("#sw-lap").addEventListener("click", () => { stopwatch.lap(lastSimTime); refreshStopwatch(); });
  rowEl.querySelector("#sw-reset").addEventListener("click", () => { stopwatch.reset(); refreshStopwatch(); });
}

function toggleTool(id) {
  if (id === "ruler" || id === "protractor") { setActive(active === id ? null : id); return; }
  overlays[id] = !overlays[id];
  if (id === "stopwatch") swEl.classList.toggle("hidden", !overlays.stopwatch);
  rowEl.querySelector(`[data-tool="${id}"]`).classList.toggle("active", overlays[id]);
  if (id === "trajectory" && !overlays.trajectory) { trajectories.clear(); }
  if ((id === "velocity" || id === "force" || id === "trajectory") && overlays[id] && !deps.getSelectedId()) {
    setStatus("Select an object, then press Play.");
  } else setStatus("");
  draw();
}

function setActive(id) {
  active = id;
  dragging = false;
  rowEl?.querySelectorAll(".measure-tool").forEach((b) => {
    if (b.dataset.tool === "ruler" || b.dataset.tool === "protractor") b.classList.toggle("active", b.dataset.tool === id);
  });
  const canvas = document.getElementById("canvas");
  canvas?.classList.toggle("measuring", !!id);
  if (id === "protractor") { protractor = []; setStatus("Click the vertex, then the end of each arm."); }
  else if (id === "ruler") setStatus("Drag on the canvas to measure.");
  else setStatus("");
  draw();
}

function setStatus(text) { if (statusEl) statusEl.textContent = text; }

function clearAll() {
  ruler = null; protractor = []; trajectories.clear(); forceEst.clear();
  stopwatch.reset(); refreshStopwatch(); setStatus(""); draw();
}

// While Ruler/Protractor is on, the canvas belongs to it: capture-phase
// listeners swallow the pointer events before object dragging, selection or
// the d3 pan/zoom handlers (which listen for mouse/touch) ever see them.
function attachCanvasCapture() {
  const svg = document.getElementById("canvas");
  const swallow = (e) => { if (active) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); return true; } return false; };
  for (const type of ["mousedown", "touchstart", "click", "dblclick"]) svg.addEventListener(type, swallow, true);
  const world = (e) => deps.getRenderer().screenToWorld(e.clientX, e.clientY);
  svg.addEventListener("pointerdown", (e) => {
    if (!swallow(e)) return;
    const p = world(e);
    if (active === "ruler") { ruler = { a: p, b: p }; dragging = true; svg.setPointerCapture?.(e.pointerId); }
    else if (active === "protractor") {
      if (protractor.length >= 3) protractor = [];
      protractor.push(p);
      setStatus(protractor.length < 3 ? `Point ${protractor.length} of 3 placed.` : "");
    }
    draw();
  }, true);
  svg.addEventListener("pointermove", (e) => {
    if (!active) return;
    const p = world(e);
    if (active === "ruler" && dragging && ruler) { ruler.b = e.shiftKey ? snapAxis(ruler.a, p) : p; draw(); }
    else if (active === "protractor" && protractor.length && protractor.length < 3) { draw(p); }
  }, true);
  const end = (e) => { if (active === "ruler" && dragging) { dragging = false; swallow(e); } };
  svg.addEventListener("pointerup", end, true);
  svg.addEventListener("pointercancel", end, true);
}

// Shift while dragging the ruler locks it to horizontal or vertical.
function snapAxis(a, p) {
  return Math.abs(p.x - a.x) >= Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
}

function ensureLayer() {
  const renderer = deps.getRenderer();
  if (!renderer?.viewport) return null;
  if (!layer || !layer.node().isConnected) {
    layer = renderer.viewport.append("g").attr("class", "measure-layer").attr("pointer-events", "none");
  }
  return layer;
}

function scale() { return Math.max(0.25, deps.getRenderer().currentScale?.() || 1); }

function fmtLen(px) {
  const v = px / distanceUnitScale();
  return `${v.toFixed(2)} ${distanceUnitSuffix()}`;
}

function arrow(g, x1, y1, x2, y2, color, s) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 2) return;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const head = Math.min(len * 0.6, 12 / s), half = 5 / s;
  g.append("line").attr("x1", x1).attr("y1", y1).attr("x2", x2 - ux * head * 0.6).attr("y2", y2 - uy * head * 0.6)
    .attr("stroke", color).attr("stroke-width", 3 / s).attr("stroke-linecap", "round");
  g.append("polygon")
    .attr("points", `${x2},${y2} ${x2 - ux * head - uy * half},${y2 - uy * head + ux * half} ${x2 - ux * head + uy * half},${y2 - uy * head - ux * half}`)
    .attr("fill", color);
}

function label(g, x, y, text, color, s) {
  g.append("text").attr("x", x).attr("y", y).text(text).attr("fill", color)
    .attr("font-size", 13 / s).attr("font-weight", 700).attr("paint-order", "stroke")
    .attr("stroke", "var(--bg, #0d1117)").attr("stroke-width", 3 / s).attr("stroke-linejoin", "round");
}

function draw(hoverPoint) {
  const g0 = ensureLayer();
  if (!g0) return;
  g0.selectAll("*").remove();
  const s = scale();

  if (ruler) {
    const { a, b } = ruler, c = COLORS.ruler;
    g0.append("line").attr("x1", a.x).attr("y1", a.y).attr("x2", b.x).attr("y2", b.y).attr("stroke", c).attr("stroke-width", 2.5 / s);
    for (const p of [a, b]) g0.append("circle").attr("cx", p.x).attr("cy", p.y).attr("r", 4 / s).attr("fill", c);
    const px = distance(a, b);
    // Tick marks every grid square along the line
    const n = Math.floor(px / 20);
    for (let i = 1; i <= n && i < 200; i++) {
      const t = (i * 20) / px, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const nx = -(b.y - a.y) / px, ny = (b.x - a.x) / px, len = (i % 5 === 0 ? 8 : 4) / s;
      g0.append("line").attr("x1", x - nx * len).attr("y1", y - ny * len).attr("x2", x + nx * len).attr("y2", y + ny * len).attr("stroke", c).attr("stroke-width", 1.5 / s);
    }
    const dx = pxToMeters(b.x - a.x), dy = -pxToMeters(b.y - a.y);
    label(g0, (a.x + b.x) / 2 + 8 / s, (a.y + b.y) / 2 - 8 / s,
      `${fmtLen(px)}   Δx ${dx.toFixed(1)}  Δy ${dy.toFixed(1)}  ∠${elevationDeg(a, b).toFixed(1)}°`, c, s);
  }

  const pts = protractor.slice();
  if (hoverPoint && pts.length && pts.length < 3) pts.push(hoverPoint);
  if (pts.length >= 2) {
    const [v, p1, p2] = pts, c = COLORS.protractor;
    g0.append("line").attr("x1", v.x).attr("y1", v.y).attr("x2", p1.x).attr("y2", p1.y).attr("stroke", c).attr("stroke-width", 2.5 / s);
    if (p2) {
      g0.append("line").attr("x1", v.x).attr("y1", v.y).attr("x2", p2.x).attr("y2", p2.y).attr("stroke", c).attr("stroke-width", 2.5 / s);
      const deg = angleAt(v, p1, p2);
      if (!Number.isNaN(deg)) {
        const r = Math.min(60 / s, distance(v, p1) * 0.6, distance(v, p2) * 0.6);
        const a1 = Math.atan2(p1.y - v.y, p1.x - v.x), a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
        let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const end = { x: v.x + r * Math.cos(a1 + d), y: v.y + r * Math.sin(a1 + d) };
        g0.append("path").attr("d", `M ${v.x + r * Math.cos(a1)} ${v.y + r * Math.sin(a1)} A ${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${end.x} ${end.y}`)
          .attr("fill", "none").attr("stroke", c).attr("stroke-width", 2 / s);
        const mid = a1 + d / 2;
        label(g0, v.x + (r + 8 / s) * Math.cos(mid), v.y + (r + 8 / s) * Math.sin(mid), `${deg.toFixed(1)}°`, c, s);
      }
    }
  }
  if (pts.length) for (const p of pts) g0.append("circle").attr("cx", p.x).attr("cy", p.y).attr("r", 4 / s).attr("fill", COLORS.protractor);

  drawObjectOverlays(g0, s);
}

function drawObjectOverlays(g, s) {
  const id = deps.getSelectedId();
  if (overlays.trajectory) {
    for (const [tid, track] of trajectories.tracks) {
      if (track.length < 2) continue;
      g.append("polyline").attr("points", track.map((p) => `${p.x},${p.y}`).join(" "))
        .attr("fill", "none").attr("stroke", COLORS.trajectory).attr("stroke-width", 2.5 / s).attr("stroke-linejoin", "round");
      let nextMark = 0;
      for (const p of track) if (p.t >= nextMark) {
        g.append("circle").attr("cx", p.x).attr("cy", p.y).attr("r", 3.5 / s).attr("fill", COLORS.trajectory);
        nextMark = (Math.floor(p.t / 500) + 1) * 500;
      }
      if (tid === id) {
        const sum = trajectories.summary(tid), end = track[track.length - 1];
        label(g, end.x + 8 / s, end.y - 8 / s, `path ${sum.pathMeters.toFixed(1)} m · displacement ${sum.displacementMeters.toFixed(1)} m · dots every 0.5 s`, COLORS.trajectory, s);
      }
    }
  }
  const item = id && lastItems.find((it) => it.id === id);
  if (!item) return;
  if (overlays.velocity) {
    const speed = Math.hypot(item.vx || 0, item.vy || 0);
    if (speed > 0.02) {
      const len = Math.min(220, speed * 14) / s;
      arrow(g, item.x, item.y, item.x + (item.vx / speed) * len, item.y + (item.vy / speed) * len, COLORS.velocity, s);
    }
    label(g, item.x + 14 / s, item.y - 14 / s, `v = ${velocityToMps(speed).toFixed(2)} m/s`, COLORS.velocity, s);
  }
  if (overlays.force) {
    const est = forceEst.get(id), mass = deps.getMass(id);
    const f = est && mass ? est.force(mass) : null;
    if (f) {
      const mag = Math.hypot(f.fx, f.fy);
      if (mag > 0.5) {
        const len = Math.min(220, 6 * Math.sqrt(mag)) / s;
        arrow(g, item.x, item.y, item.x + (f.fx / mag) * len, item.y + (f.fy / mag) * len, COLORS.force, s);
        label(g, item.x + 14 / s, item.y + 22 / s, `ΣF = ${mag.toFixed(1)} N`, COLORS.force, s);
      } else label(g, item.x + 14 / s, item.y + 22 / s, "ΣF ≈ 0 (balanced)", COLORS.force, s);
    }
  }
}

function refreshStopwatch() {
  if (!swEl) return;
  swEl.querySelector("#measure-time").textContent = formatSeconds(stopwatch.elapsed(lastSimTime));
  swEl.querySelector("#sw-toggle").textContent = stopwatch.running ? "Stop" : "Start";
  swEl.querySelector("#sw-laps").textContent = stopwatch.laps.length ? "Laps: " + stopwatch.laps.map(formatSeconds).join(" · ") : "";
}

// Called every simulation frame from main.js's onFrame.
export function measureOnFrame(items, simTimeMs) {
  lastItems = items; lastSimTime = simTimeMs;
  const id = deps?.getSelectedId?.();
  const item = id && items.find((it) => it.id === id);
  if (item) {
    if (overlays.force) {
      if (!forceEst.has(id)) forceEst.set(id, new ForceEstimator());
      forceEst.get(id).push(simTimeMs, item.vx || 0, item.vy || 0);
    }
    if (overlays.trajectory) trajectories.push(id, simTimeMs, item.x, item.y);
  }
  if (overlays.stopwatch) refreshStopwatch();
  if (overlays.velocity || overlays.force || overlays.trajectory) draw();
}

// Reset/Stop: traces and vector state clear (they describe one run), but a
// ruler or protractor placed in the world stays where the user put it.
export function measureOnReset() {
  lastItems = []; lastSimTime = 0;
  trajectories.clear(); forceEst.clear();
  stopwatch.reset(); refreshStopwatch();
  if (layer) draw();
}

// Selection changed (or the camera zoomed) — repaint at the current state.
export function measureRefresh() { if (layer || overlays.velocity || overlays.force || overlays.trajectory) draw(); }
