// Parameter Sweep (Kinetic Plus): pick one variable, give it a range, and the
// sandbox runs the current world once per value — headless, on the same
// PhysicsSim the real Play button uses — then graphs one tracked object's
// result against the swept value. The variable/metric definitions and the
// maths are in sweepMath.js; this file is the runner plus the modal.
import { PhysicsSim } from "./physics.js";
import { getUser, escapeHtml } from "./auth.js";
import { VARIABLES, METRICS, MAX_RUNS, MAX_DURATION_S, getVariable, sweepValues, validateSweep, computeMetrics, sweepToCsv, bestRow } from "./sweepMath.js";

const FIRED = "__fired"; // "the ball a cannon fires" — it doesn't exist as a spec until the run starts
const STEP_MS = 16;
const SAMPLE_EVERY = 2;

// specs: the world's blueprint. Returns one row per value:
// { value, metrics, trace }. The same clone/apply/step path runs every
// value, so runs differ only by the variable being swept.
export async function runSweep({ specs, gravity, airFriction, frictionScale = 1, variable, varyId, trackId, values, durationS, onProgress, shouldCancel }) {
  const v = getVariable(variable);
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    if (shouldCancel?.()) break;
    const value = values[i];
    const clones = specs.map((s) => ({ ...s }));
    let g = gravity, air = airFriction;
    if (v.scope === "world") {
      if (v.id === "gravity") g = value; else air = value;
    } else {
      const target = clones.find((s) => s.id === varyId);
      if (target) target[v.key] = value;
    }
    const trace = simulateOne(clones, g, air, frictionScale, trackId, durationS);
    rows.push({ value, metrics: computeMetrics(trace), trace });
    onProgress?.(i + 1, values.length);
    // Yield to the browser between runs so the progress bar can paint
    await new Promise((r) => setTimeout(r, 0));
  }
  return rows;
}

function simulateOne(specs, gravity, airFriction, frictionScale, trackId, durationS) {
  const sim = new PhysicsSim(specs, gravity, {});
  sim.setAirFriction(airFriction);
  sim.setFrictionScale(frictionScale);
  const trace = [];
  const steps = Math.round((durationS * 1000) / STEP_MS);
  try {
    for (let n = 0; n < steps; n++) {
      sim._lastDelta = STEP_MS;
      Matter.Engine.update(sim.engine, STEP_MS);
      sim.simTime += STEP_MS;
      sim.processPending();
      sim._cullExpiredShards?.();
      if (n % SAMPLE_EVERY === 0) {
        const item = sim.collectRenderItems().find((it) => trackId === FIRED ? String(it.id).startsWith("firedball") : it.id === trackId);
        if (item) trace.push({ t: sim.simTime, x: item.x, y: item.y, vx: item.vx || 0, vy: item.vy || 0 });
      }
    }
  } finally {
    sim.stop();
  }
  return trace;
}

// ---------------- modal UI ----------------
let modal, box, deps;
let opts = null; // the form's last state, kept between openings
let history = []; // completed sweeps this session, for overlay comparison
let cancelFlag = false;

export function initParamSweepUI(options) {
  deps = options; // { getSpecs, getSelectedId, getEnv: () => ({gravity, airFriction, frictionScale}), showToast, openPlans }
  modal = document.getElementById("sweep-modal");
  box = document.getElementById("sweep-modal-box");
  document.getElementById("sweep-btn")?.addEventListener("click", open);
  modal?.addEventListener("click", (e) => { if (e.target === modal) close(); });
}

function close() { cancelFlag = true; modal.classList.add("hidden"); }

function trackable(specs) { return specs.filter((s) => !s.fixed && s.type !== "text" && s.type !== "rope" && s.type !== "wire"); }

function open() {
  const specs = deps.getSpecs();
  const sel = deps.getSelectedId();
  const dynamic = trackable(specs);
  const tracked = opts?.trackId && (opts.trackId === FIRED || specs.some((s) => s.id === opts.trackId)) ? opts.trackId : (dynamic.find((s) => s.id === sel) || dynamic[0])?.id;
  const varyId = opts?.varyId && specs.some((s) => s.id === opts.varyId) ? opts.varyId : (sel || tracked);
  opts = { variable: "gravity", min: 0.5, max: 2.5, runs: 6, duration: 6, metric: "range", ...opts, trackId: tracked, varyId };
  modal.classList.remove("hidden");
  cancelFlag = false;
  if (!getUser()?.entitlements?.isPlus) { renderLocked(); return; }
  renderForm();
}

function renderLocked() {
  box.innerHTML = `
    <h2>Parameter Sweep <span class="plus-badge">PLUS</span></h2>
    <p class="saves-hint">Pick one variable — gravity, air drag, mass, bounciness, a ramp's angle, a cannon's power — give it a range, and Kinetic automatically runs your world once per value, then graphs and compares the results.</p>
    <p class="saves-hint">Sweeps are a Kinetic Plus feature.</p>
    <div style="display:flex;gap:8px"><button id="sweep-plans" class="primary">See Plus</button><button id="sweep-close">Close</button></div>`;
  box.querySelector("#sweep-close").addEventListener("click", close);
  box.querySelector("#sweep-plans").addEventListener("click", () => { close(); deps.openPlans?.(); });
}

function varsFor(spec) { return VARIABLES.filter((v) => v.scope === "world" || (spec && v.appliesTo(spec))); }

function renderForm(result) {
  const specs = deps.getSpecs();
  const dynamic = trackable(specs);
  const hasCannon = specs.some((s) => s.type === "cannon");
  const varySpec = specs.find((s) => s.id === opts.varyId);
  const vars = varsFor(varySpec);
  if (!vars.some((v) => v.id === opts.variable)) opts.variable = vars[0].id;
  const v = getVariable(opts.variable);
  const name = (s) => `${s.type}${s.material ? " · " + s.material : ""} (${Math.round(s.x)}, ${Math.round(s.y)})`;
  const esc = escapeHtml;
  box.innerHTML = `
    <h2>Parameter Sweep <span class="plus-badge">PLUS</span></h2>
    <p class="saves-hint">Runs your current world once for each value below (without pressing Play) and records one object's motion.</p>
    <div class="sweep-grid">
      <label>Vary an object<select id="sw-vary">${specs.filter((s) => s.type !== "text").map((s) => `<option value="${s.id}" ${s.id === opts.varyId ? "selected" : ""}>${esc(name(s))}</option>`).join("")}</select></label>
      <label>Variable<select id="sw-variable">${vars.map((x) => `<option value="${x.id}" ${x.id === opts.variable ? "selected" : ""}>${esc(x.label)}${x.unit ? " (" + esc(x.unit) + ")" : ""}</option>`).join("")}</select></label>
      <label>From<input id="sw-min" type="number" step="any" value="${opts.min}"></label>
      <label>To<input id="sw-max" type="number" step="any" value="${opts.max}"></label>
      <label>Experiments<input id="sw-runs" type="number" min="2" max="${MAX_RUNS}" value="${opts.runs}"></label>
      <label>Seconds per run<input id="sw-duration" type="number" min="1" max="${MAX_DURATION_S}" value="${opts.duration}"></label>
      <label>Track this object<select id="sw-track">
        ${hasCannon ? `<option value="${FIRED}" ${opts.trackId === FIRED ? "selected" : ""}>The ball a cannon fires</option>` : ""}
        ${dynamic.map((s) => `<option value="${s.id}" ${s.id === opts.trackId ? "selected" : ""}>${esc(name(s))}</option>`).join("")}</select></label>
      <label>Graph<select id="sw-metric">${METRICS.map((m) => `<option value="${m.id}" ${m.id === opts.metric ? "selected" : ""}>${esc(m.label)} (${m.unit})</option>`).join("")}</select></label>
    </div>
    <p class="saves-hint" id="sw-hint">${v.scope === "world" ? "This changes the whole world's setting for every object." : "Only the object chosen above changes; everything else stays as built."} Allowed: ${v.min} to ${v.max}${v.unit ? " " + esc(v.unit) : ""} (you can type outside it, but the sliders' own limits are a good guide).</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button id="sw-run" class="primary">Run sweep</button>
      <button id="sw-close">Close</button>
      <span id="sw-progress" class="saves-hint"></span>
    </div>
    <div id="sw-result"></div>`;
  const $ = (id) => box.querySelector(id);
  const read = () => {
    opts.varyId = $("#sw-vary").value; opts.variable = $("#sw-variable").value;
    opts.min = parseFloat($("#sw-min").value); opts.max = parseFloat($("#sw-max").value);
    opts.runs = parseInt($("#sw-runs").value, 10); opts.duration = parseFloat($("#sw-duration").value);
    opts.trackId = $("#sw-track").value; opts.metric = $("#sw-metric").value;
  };
  $("#sw-vary").addEventListener("change", () => { read(); const vs = varsFor(deps.getSpecs().find((s) => s.id === opts.varyId)); if (!vs.some((x) => x.id === opts.variable)) opts.variable = vs[0].id; applyDefaults(); renderForm(); });
  $("#sw-variable").addEventListener("change", () => { read(); applyDefaults(); renderForm(); });
  $("#sw-metric").addEventListener("change", () => { read(); if (result) drawResult(result); });
  $("#sw-close").addEventListener("click", close);
  $("#sw-run").addEventListener("click", async () => {
    read();
    const err = validateSweep({ variable: opts.variable, min: opts.min, max: opts.max, runs: opts.runs, duration: opts.duration });
    if (err) { $("#sw-progress").textContent = err; return; }
    if (!opts.trackId) { $("#sw-progress").textContent = "Add an object that moves to track."; return; }
    const runBtn = $("#sw-run"); runBtn.disabled = true; cancelFlag = false;
    const values = sweepValues(opts.min, opts.max, opts.runs);
    const env = deps.getEnv();
    const rows = await runSweep({
      specs: deps.getSpecs(), ...env, variable: opts.variable, varyId: opts.varyId, trackId: opts.trackId, values, durationS: opts.duration,
      onProgress: (n, total) => { const el = box.querySelector("#sw-progress"); if (el) el.textContent = `Running ${n} of ${total}…`; },
      shouldCancel: () => cancelFlag || modal.classList.contains("hidden"),
    });
    if (cancelFlag) return;
    const set = { id: history.length + 1, variable: opts.variable, varyId: opts.varyId, trackId: opts.trackId, rows, at: Date.now() };
    history.push(set); history = history.slice(-4);
    renderForm(set);
  });
  if (result) drawResult(result);
}

function applyDefaults() { const v = getVariable(opts.variable); opts.min = v.min; opts.max = v.max; }

function drawResult(result) {
  const metric = METRICS.find((m) => m.id === opts.metric);
  const v = getVariable(result.variable);
  const out = box.querySelector("#sw-result");
  const overlay = history.filter((h) => h.variable === result.variable);
  const hi = bestRow(result.rows, metric.id, "max"), lo = bestRow(result.rows, metric.id, "min");
  out.innerHTML = `
    <h3>${escapeHtml(metric.label)} vs ${escapeHtml(v.label)}</h3>
    <canvas id="sw-chart" width="560" height="260" style="width:100%;max-width:560px;background:var(--panel-alt);border-radius:8px"></canvas>
    <p class="saves-hint">${overlay.length > 1 ? `Comparing ${overlay.length} sweeps of ${escapeHtml(v.label)} — the newest is the bright line.` : "Run again with a different setup to overlay the two."}</p>
    <p class="saves-hint">Highest: <b>${hi.metrics[metric.id].toFixed(2)} ${metric.unit}</b> at ${escapeHtml(v.label)} = ${hi.value}. Lowest: <b>${lo.metrics[metric.id].toFixed(2)} ${metric.unit}</b> at ${lo.value}.</p>
    <div style="overflow-x:auto"><table class="sweep-table"><thead><tr><th>${escapeHtml(v.label)}</th>${METRICS.map((m) => `<th>${escapeHtml(m.label)} (${m.unit})</th>`).join("")}</tr></thead>
    <tbody>${result.rows.map((r) => `<tr><td>${r.value}</td>${METRICS.map((m) => `<td class="${m.id === metric.id && (r === hi || r === lo) ? "sweep-best" : ""}">${r.metrics[m.id].toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div style="display:flex;gap:8px;margin-top:8px"><button id="sw-csv">Export CSV</button><button id="sw-clear-history">Clear comparisons</button></div>
    <p class="saves-hint">Units are the sandbox's (1 grid square = 1 m, sim seconds). Every run uses the same physics engine as Play, sampled every ${STEP_MS * SAMPLE_EVERY} ms.</p>`;
  drawChart(out.querySelector("#sw-chart"), overlay, metric, result);
  out.querySelector("#sw-csv").addEventListener("click", () => {
    const blob = new Blob([sweepToCsv(v.label, result.rows)], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `kinetic-sweep-${v.id}.csv`; a.click(); URL.revokeObjectURL(a.href);
  });
  out.querySelector("#sw-clear-history").addEventListener("click", () => { history = [result]; drawResult(result); });
}

function drawChart(canvas, sets, metric, current) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, pad = { l: 52, r: 14, t: 14, b: 34 };
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue("--text-dim").trim() || "#8b98a9";
  ctx.clearRect(0, 0, W, H);
  const xs = sets.flatMap((s) => s.rows.map((r) => r.value)), ys = sets.flatMap((s) => s.rows.map((r) => r.metrics[metric.id]));
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; } else { const m = (y1 - y0) * 0.08; y0 -= m; y1 += m; }
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const X = (x) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (y) => H - pad.b - ((y - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = text; ctx.strokeStyle = "rgba(128,140,160,.25)"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + ((y1 - y0) * i) / 4, yy = Y(yv), xv = x0 + ((x1 - x0) * i) / 4, xx = X(xv);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(yv.toFixed(1), pad.l - 6, yy + 4);
    ctx.textAlign = "center"; ctx.fillText(Number(xv.toPrecision(3)).toString(), xx, H - pad.b + 16);
  }
  ctx.textAlign = "left"; ctx.fillText(`${metric.unit}`, 4, pad.t + 4);
  sets.forEach((set, idx) => {
    const isCurrent = set === current || set.id === current.id;
    ctx.globalAlpha = isCurrent ? 1 : 0.45;
    ctx.strokeStyle = isCurrent ? (css.getPropertyValue("--accent").trim() || "#5aa2ff") : (idx % 2 ? "#f5c542" : "#c084fc");
    ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = isCurrent ? 2.5 : 1.8;
    ctx.beginPath();
    set.rows.forEach((r, i) => { const px = X(r.value), py = Y(r.metrics[metric.id]); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
    for (const r of set.rows) { ctx.beginPath(); ctx.arc(X(r.value), Y(r.metrics[metric.id]), isCurrent ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  });
}
