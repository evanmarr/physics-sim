// Reusable live-graph engine — built once, used by any module with real
// per-tick numeric state to show (Physics 2D's selected-object telemetry,
// Rocket Simulator's flight telemetry, and any future module). Draws
// actual pushed data points only; never invents or interpolates fake
// values to make a graph "look interesting" when a series has no data yet.
//
// Free vs Plus is expressed here as a plain constructor option
// (`historySeconds`, `maxSeries`) driven by the caller's own resolved
// entitlements — this file has no opinion about plans, it just respects
// whatever limit it's given.
const COLORS = ["#38bdf8", "#8b5cf6", "#10b981", "#f97316", "#f43f5e", "#eab308"];

export class LiveGraph {
  // seriesDefs: [{ key, label, unit }]
  constructor(canvas, { seriesDefs, historySeconds = 60, title = "" }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.seriesDefs = seriesDefs;
    this.historySeconds = historySeconds; // Infinity for unlimited (Plus)
    this.title = title;
    this.points = []; // [{ t, [key]: value, ... }]
  }

  setHistorySeconds(s) { this.historySeconds = s; }

  push(t, values) {
    this.points.push({ t, ...values });
    const cutoff = t - this.historySeconds;
    if (Number.isFinite(cutoff)) {
      while (this.points.length > 1 && this.points[0].t < cutoff) this.points.shift();
    }
    // Hard cap regardless of time window — a runaway session shouldn't
    // grow this array unboundedly even under "unlimited" history.
    if (this.points.length > 5000) this.points.shift();
  }

  clear() { this.points = []; }

  // Returns the visible series as [{time, value}] arrays, for export or
  // for the Notebook to snapshot alongside an experiment.
  exportData() {
    return this.seriesDefs.map((s) => ({
      key: s.key, label: s.label, unit: s.unit,
      data: this.points.map((p) => ({ t: p.t, v: p[s.key] })),
    }));
  }

  render() {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (this.points.length < 2) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "11px sans-serif";
      ctx.fillText("Waiting for data…", 8, h / 2);
      return;
    }
    const tMin = this.points[0].t, tMax = this.points[this.points.length - 1].t;
    const tSpan = Math.max(tMax - tMin, 0.001);

    const padL = 6, padR = 6, padT = 16, padB = 6;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    this.seriesDefs.forEach((s, i) => {
      const values = this.points.map((p) => p[s.key]).filter((v) => Number.isFinite(v));
      if (!values.length) return;
      const vMin = Math.min(...values), vMax = Math.max(...values);
      const vSpan = Math.max(vMax - vMin, 1e-9);
      ctx.beginPath();
      ctx.strokeStyle = COLORS[i % COLORS.length];
      ctx.lineWidth = 1.5;
      let started = false;
      for (const p of this.points) {
        const v = p[s.key];
        if (!Number.isFinite(v)) { started = false; continue; }
        const sx = padL + ((p.t - tMin) / tSpan) * plotW;
        const sy = padT + plotH - ((v - vMin) / vSpan) * plotH;
        if (!started) { ctx.moveTo(sx, sy); started = true; } else { ctx.lineTo(sx, sy); }
      }
      ctx.stroke();
    });

    // Legend — text labels, not just color, since color alone isn't a
    // reliable way to distinguish series (colorblind users, print/export).
    ctx.font = "10px sans-serif";
    let lx = padL;
    this.seriesDefs.forEach((s, i) => {
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillText(`${s.label}${s.unit ? ` (${s.unit})` : ""}`, lx, 11);
      lx += ctx.measureText(`${s.label}${s.unit ? ` (${s.unit})` : ""}`).width + 14;
    });
  }
}
