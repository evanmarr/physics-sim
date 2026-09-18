// Physics 2D's Live Graphs panel — tracks whichever object is currently
// selected and graphs its real position/velocity/speed plus a
// kinetic-energy estimate, using the shared src/graphs.js engine. Free
// gets a real, useful rolling window; Plus gets a longer/unlimited window
// and a data export button — see server/entitlements.js's
// graphHistorySeconds, the one place that number is decided.
import { LiveGraph } from "./graphs.js";
import { getUser } from "./auth.js";
import { materialOf } from "./materials.js";

let panelEl, graph, startTime = null;

// KE here is `0.5 * (density * area proxy) * v²` — real physics (KE ∝
// m·v²), but "mass" is a relative proxy from material density × on-screen
// area, not a calibrated real-world mass, so it's labeled as relative
// units rather than claiming an exact Joule figure the app can't actually
// back up (this sandbox has no real-world length scale for its objects).
const SERIES = [
  { key: "speed", label: "Speed", unit: "m/s" },
  { key: "vy", label: "Vertical velocity", unit: "m/s" },
  { key: "ke", label: "Kinetic energy", unit: "relative" },
];

export function initPhysicsGraphPanel(root) {
  panelEl = root;
}

export function isGraphPanelOpen(state) { return !!state.graphPanelOpen; }

export function renderPhysicsGraphPanel(state) {
  panelEl.classList.toggle("hidden", !state.graphPanelOpen);
  if (!state.graphPanelOpen) return;

  const entitlements = getUser()?.entitlements;
  const limits = entitlements?.limits;
  const historySeconds = limits ? (limits.graphHistorySeconds ?? Infinity) : 60;
  if (!graph || graph._canvas !== panelEl.querySelector("canvas")) {
    panelEl.innerHTML = `
      <div class="chem-panel-title">Live Graphs</div>
      <canvas id="physics-graph-canvas" width="520" height="260"></canvas>
      <p class="saves-hint" id="physics-graph-hint"></p>
      <button id="physics-graph-export">Export data (.csv) <span class="plus-badge">PLUS</span></button>
    `;
    const canvas = panelEl.querySelector("#physics-graph-canvas");
    graph = new LiveGraph(canvas, { seriesDefs: SERIES, historySeconds });
    graph._canvas = canvas;
    panelEl.querySelector("#physics-graph-export").addEventListener("click", () => exportCsv(entitlements));
  }
  graph.setHistorySeconds(historySeconds);
  const hint = panelEl.querySelector("#physics-graph-hint");
  if (hint) {
    hint.innerHTML = Number.isFinite(historySeconds)
      ? `Free: last ${historySeconds}s shown. <span class="plus-badge">PLUS</span> keeps the full run and lets you export it.`
      : 'Full run history <span class="plus-badge">PLUS</span>';
  }
  const exportBtn = panelEl.querySelector("#physics-graph-export");
  if (exportBtn) exportBtn.disabled = !entitlements?.isPlus;
  graph.render();
}

function exportCsv(entitlements) {
  if (!entitlements?.isPlus) return;
  const series = graph.exportData();
  const rows = ["t," + series.map((s) => s.label).join(",")];
  const len = series[0]?.data.length || 0;
  for (let i = 0; i < len; i++) {
    rows.push([series[0].data[i].t.toFixed(2), ...series.map((s) => s.data[i]?.v ?? "")].join(","));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kinetic-physics-graph.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// Called every simulation frame while the panel is open and something is
// selected — pushes ONE new real data point. Never called with synthetic
// data: if nothing is selected, this simply isn't called (see main.js).
export function pushGraphSample(t, item, mass) {
  if (!graph) return;
  if (startTime === null) startTime = t;
  const speed = Math.hypot(item.vx || 0, item.vy || 0);
  const ke = mass != null ? 0.5 * mass * speed * speed : NaN;
  graph.push(t - startTime, { speed, vy: -(item.vy || 0), ke });
  if (panelEl && !panelEl.classList.contains("hidden")) graph.render();
}

export function resetGraphPanel() {
  startTime = null;
  graph?.clear();
  graph?.render();
}
