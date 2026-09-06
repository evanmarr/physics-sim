import { compileExpression } from "./mathExpr.js";
import { openSavesPanel } from "./auth.js";

// A small math-visualization suite: a real graphing calculator (type y =
// f(x), pan/zoom/hover like an actual calculator) plus three data-chart
// types built on the same sidebar/stage shell. Only one visualization is
// shown at a time — switching type doesn't try to merge unrelated data
// models (a function and a bar chart don't share axes) into one screen.
const CURVE_COLORS = ["#4f8cff", "#ff5c7a", "#2ecc71", "#ffb84f", "#a78bfa", "#34d399"];
const SAMPLES = 480; // per visible width — plenty smooth without recomputing thousands of points every pan tick
const MAX_DATA_ROWS = 10;

const CHART_TYPES = [
  { id: "function", label: "Graph" },
  { id: "bar", label: "Bar Chart" },
  { id: "pie", label: "Pie Chart" },
  { id: "venn", label: "Venn Diagram" },
];

export class MathematicsMode {
  constructor(root) {
    this.root = root;
    this.chartType = "function";

    this.func = { expr: "sin(x)", color: CURVE_COLORS[0], error: null };
    this.view = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }; // world-space visible window

    this.rows = [
      { id: 1, label: "A", value: 4, color: CURVE_COLORS[0] },
      { id: 2, label: "B", value: 7, color: CURVE_COLORS[1] },
      { id: 3, label: "C", value: 3, color: CURVE_COLORS[2] },
    ];
    this.nextRowId = 4;

    // Venn diagrams here are schematic (fixed circle layout), not
    // proportional-area — exact proportional Venn diagrams don't exist in
    // general for more than 2 sets, so showing true counts per region,
    // labeled plainly, is the mathematically honest choice.
    //
    // Region totals aren't typed directly — each is the sum of whatever
    // "value" chips have been dragged into it. An item's region stays
    // remembered even if you switch to 2 sets while it's sitting in a
    // 3-sets-only region (e.g. "c") — it just shows back up in the
    // unassigned pool until you switch back or drag it somewhere valid.
    this.venn = {
      sets: 2,
      labels: ["A", "B", "C"],
      items: [
        { id: 1, value: 6, color: CURVE_COLORS[3], region: "a" },
        { id: 2, value: 5, color: CURVE_COLORS[4], region: "b" },
        { id: 3, value: 3, color: CURVE_COLORS[5], region: "ab" },
        { id: 4, value: 4, color: CURVE_COLORS[3], region: "c" },
        { id: 5, value: 2, color: CURVE_COLORS[4], region: "ac" },
        { id: 6, value: 2, color: CURVE_COLORS[5], region: "bc" },
        { id: 7, value: 1, color: CURVE_COLORS[0], region: "abc" },
      ],
      nextItemId: 8,
    };
    this._vennRegionRects = null; // populated by _drawVenn, read by the drag/drop hit-test

    this._build();
  }

  mount() { this._resize(); this._draw(); }
  unmount() {}

  _build() {
    this.root.innerHTML = "";
    this.root.className = "math-root";

    const sidebar = div("math-sidebar");
    const title = div("chem-panel-title");
    title.textContent = "Mathematics";
    sidebar.appendChild(title);
    const sub = document.createElement("p");
    sub.className = "chem-hint";
    sub.textContent = "Graph a function, or switch to a bar chart, pie chart, or Venn diagram.";
    sidebar.appendChild(sub);

    const typeRow = div("math-type-row");
    this._typeButtons = {};
    CHART_TYPES.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "math-type-btn";
      btn.textContent = t.label;
      btn.addEventListener("click", () => this._setChartType(t.id));
      typeRow.appendChild(btn);
      this._typeButtons[t.id] = btn;
    });
    sidebar.appendChild(typeRow);

    const savesBtn = document.createElement("button");
    savesBtn.textContent = "My Saved Items";
    savesBtn.style.marginBottom = "10px";
    savesBtn.addEventListener("click", () => this._openSaves());
    sidebar.appendChild(savesBtn);

    this.controlsEl = div("math-controls");
    sidebar.appendChild(this.controlsEl);

    this.coordReadout = div("math-coord-readout");
    sidebar.appendChild(this.coordReadout);

    this.root.appendChild(sidebar);

    const stage = div("math-stage");
    this.svg = d3.select(stage).append("svg").attr("class", "math-svg");
    this.gGrid = this.svg.append("g").attr("class", "math-grid");
    this.gAxes = this.svg.append("g").attr("class", "math-axes");
    this.gCurves = this.svg.append("g").attr("class", "math-curves");
    this.gTrace = this.svg.append("g").attr("class", "math-trace").style("display", "none");
    this.root.appendChild(stage);
    this.stageEl = stage;

    this._wireInteraction();
    window.addEventListener("resize", () => { this._resize(); this._draw(); });
    this._setChartType("function");
  }

  _setChartType(type) {
    this.chartType = type;
    for (const [id, btn] of Object.entries(this._typeButtons)) btn.classList.toggle("active", id === type);
    this.gTrace.style("display", "none");
    this.coordReadout.textContent = "";
    this._buildControls();
    this._draw();
  }

  _buildControls() {
    this.controlsEl.innerHTML = "";
    if (this.chartType === "function") this._buildFunctionControls();
    else if (this.chartType === "bar" || this.chartType === "pie") this._buildDataControls();
    else this._buildVennControls();
  }

  // ---------- Function graph ----------

  _buildFunctionControls() {
    const wrap = div("math-func-row");
    const inputRow = div("math-func-input-row");
    const swatch = colorSwatchInput(this.func.color, (color) => { this.func.color = color; this._draw(); });
    inputRow.appendChild(swatch);
    const label = document.createElement("span");
    label.className = "math-func-label";
    label.textContent = "y =";
    inputRow.appendChild(label);
    const input = document.createElement("input");
    input.type = "text";
    input.value = this.func.expr;
    input.placeholder = "e.g. x^2 - 3, sin(x), 1/x";
    input.addEventListener("input", () => { this.func.expr = input.value; this._draw(); });
    inputRow.appendChild(input);
    wrap.appendChild(inputRow);
    const err = div("math-func-error");
    wrap.appendChild(err);
    this.func._errorEl = err;
    this.controlsEl.appendChild(wrap);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset view";
    resetBtn.style.marginTop = "8px";
    resetBtn.addEventListener("click", () => { this.view = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }; this._draw(); });
    this.controlsEl.appendChild(resetBtn);
  }

  // ---------- Bar / pie shared data editor ----------

  _buildDataControls() {
    const list = div("math-data-list");
    this.rows.forEach((r, i) => {
      const row = div("math-data-row");
      const swatch = colorSwatchInput(r.color, (color) => { r.color = color; this._draw(); });
      row.appendChild(swatch);
      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.className = "math-data-label-input";
      labelInput.value = r.label;
      labelInput.placeholder = "Label";
      labelInput.addEventListener("input", () => { r.label = labelInput.value; this._draw(); });
      row.appendChild(labelInput);
      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.step = "any";
      valueInput.className = "math-data-value-input";
      valueInput.value = r.value;
      valueInput.addEventListener("input", () => { r.value = parseFloat(valueInput.value) || 0; this._draw(); });
      row.appendChild(valueInput);
      if (this.rows.length > 1) {
        const rm = document.createElement("button");
        rm.textContent = "×";
        rm.className = "math-func-remove";
        rm.addEventListener("click", () => { this.rows.splice(i, 1); this._buildControls(); this._draw(); });
        row.appendChild(rm);
      }
      list.appendChild(row);
    });
    this.controlsEl.appendChild(list);

    const addBtn = document.createElement("button");
    addBtn.textContent = this.rows.length >= MAX_DATA_ROWS ? "Max 10 data points" : "+ Add data point";
    addBtn.className = "primary";
    addBtn.disabled = this.rows.length >= MAX_DATA_ROWS;
    addBtn.addEventListener("click", () => {
      if (this.rows.length >= MAX_DATA_ROWS) return;
      const color = CURVE_COLORS[this.rows.length % CURVE_COLORS.length];
      this.rows.push({ id: this.nextRowId++, label: `Item ${this.rows.length + 1}`, value: 1, color });
      this._buildControls();
      this._draw();
    });
    this.controlsEl.appendChild(addBtn);
  }

  // ---------- Venn diagram ----------

  // Which region keys actually exist for the current set count — an item
  // parked in a 3-sets-only region (e.g. "c") when sets===2 is neither
  // drawn nor counted, but isn't deleted either; it just falls back into
  // "unassigned" below until it's valid again.
  _vennRegionKeys() {
    return this.venn.sets === 2 ? ["a", "b", "ab"] : ["a", "b", "c", "ab", "ac", "bc", "abc"];
  }

  _vennItemsIn(key) {
    return this.venn.items.filter((it) => it.region === key);
  }

  _buildVennControls() {
    const toggle = div("math-venn-toggle");
    [2, 3].forEach((n) => {
      const btn = document.createElement("button");
      btn.textContent = `${n} sets`;
      btn.className = "math-type-btn" + (this.venn.sets === n ? " active" : "");
      btn.addEventListener("click", () => { this.venn.sets = n; this._buildControls(); this._draw(); });
      toggle.appendChild(btn);
    });
    this.controlsEl.appendChild(toggle);

    const n = this.venn.sets;
    const labelWrap = div("math-venn-labels");
    for (let i = 0; i < n; i++) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "math-venn-label-input";
      input.value = this.venn.labels[i];
      input.style.setProperty("--swatch", CURVE_COLORS[i]);
      input.addEventListener("input", () => { this.venn.labels[i] = input.value || String.fromCharCode(65 + i); this._draw(); });
      labelWrap.appendChild(input);
    }
    this.controlsEl.appendChild(labelWrap);

    const hint = div("math-venn-hint");
    hint.textContent = "Drag a value onto a circle (or where circles overlap) to place it there — drag it back here to unplace it.";
    this.controlsEl.appendChild(hint);

    const validKeys = new Set(this._vennRegionKeys());
    const pool = div("math-venn-pool");
    const unassigned = this.venn.items.filter((it) => !it.region || !validKeys.has(it.region));
    if (!unassigned.length) {
      const empty = div("math-venn-pool-empty");
      empty.textContent = "All values are placed — drag one out of the diagram to move it.";
      pool.appendChild(empty);
    } else {
      for (const item of unassigned) pool.appendChild(this._buildVennChip(item));
    }
    this._vennPoolEl = pool;
    this.controlsEl.appendChild(pool);

    const addRow = div("math-venn-add-row");
    const addColor = colorSwatchInput(CURVE_COLORS[this.venn.items.length % CURVE_COLORS.length], () => {});
    addRow.appendChild(addColor);
    const addValue = document.createElement("input");
    addValue.type = "number";
    addValue.min = "0";
    addValue.step = "any";
    addValue.value = "1";
    addValue.className = "math-data-value-input";
    addRow.appendChild(addValue);
    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add value";
    addBtn.className = "primary";
    addBtn.addEventListener("click", () => {
      const value = Math.max(0, parseFloat(addValue.value) || 0);
      this.venn.items.push({ id: this.venn.nextItemId++, value, color: addColor.value, region: null });
      this._buildControls();
      this._draw();
    });
    addRow.appendChild(addBtn);
    this.controlsEl.appendChild(addRow);
  }

  // One draggable chip in the unassigned-values pool — its color and value
  // stay editable in place, and pressing down anywhere else on it starts a
  // drag toward the diagram (mirrors main.js's palette-drag pattern: a
  // ghost follows the pointer, and pointerup hit-tests the drop point).
  _buildVennChip(item) {
    const chip = div("math-venn-chip");
    const swatch = colorSwatchInput(item.color, (color) => { item.color = color; this._draw(); });
    chip.appendChild(swatch);
    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.step = "any";
    valueInput.className = "math-venn-chip-value";
    valueInput.value = item.value;
    valueInput.addEventListener("input", () => { item.value = parseFloat(valueInput.value) || 0; this._draw(); });
    chip.appendChild(valueInput);
    const rm = document.createElement("button");
    rm.textContent = "×";
    rm.className = "math-func-remove";
    rm.title = "Delete this value";
    rm.addEventListener("click", () => {
      this.venn.items = this.venn.items.filter((it) => it.id !== item.id);
      this._buildControls();
      this._draw();
    });
    chip.appendChild(rm);
    chip.addEventListener("pointerdown", (e) => {
      if (e.target === valueInput || e.target === swatch || e.target === rm) return;
      this._beginVennDrag(item, e);
    });
    return chip;
  }

  // Picks up `item` and follows the pointer with a small ghost until
  // release, then assigns it to whichever region circle (or the pool) the
  // pointer was over — a miss (dropped somewhere else entirely) leaves the
  // item's region unchanged, same as a cancelled drag.
  _beginVennDrag(item, pointerEvent) {
    pointerEvent.preventDefault();
    const ghost = document.createElement("div");
    ghost.className = "math-venn-drag-ghost";
    ghost.style.background = item.color;
    ghost.textContent = item.value;
    document.body.appendChild(ghost);

    const move = (ev) => {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    };
    move(pointerEvent);

    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ghost.remove();

      const stageRect = this.stageEl.getBoundingClientRect();
      const inStage = ev.clientX >= stageRect.left && ev.clientX <= stageRect.right && ev.clientY >= stageRect.top && ev.clientY <= stageRect.bottom;
      if (inStage && this._vennRegionRects) {
        const lx = ev.clientX - stageRect.left, ly = ev.clientY - stageRect.top;
        let best = null, bestDist = Infinity;
        for (const r of this._vennRegionRects) {
          const d = Math.hypot(lx - r.x, ly - r.y);
          if (d <= r.hitR && d < bestDist) { best = r.key; bestDist = d; }
        }
        if (best) item.region = best;
      } else {
        const poolRect = this._vennPoolEl?.getBoundingClientRect();
        const inPool = poolRect && ev.clientX >= poolRect.left && ev.clientX <= poolRect.right && ev.clientY >= poolRect.top && ev.clientY <= poolRect.bottom;
        if (inPool) item.region = null;
      }
      this._buildControls();
      this._draw();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  _openSaves() {
    openSavesPanel({
      kind: "math-items",
      title: "My Saved Math Items",
      itemNoun: "chart",
      serialize: () => ({
        chartType: this.chartType,
        func: { expr: this.func.expr, color: this.func.color },
        view: { ...this.view },
        rows: this.rows.map(({ id, label, value, color }) => ({ id, label, value, color })),
        nextRowId: this.nextRowId,
        venn: JSON.parse(JSON.stringify(this.venn)),
      }),
      apply: (data) => {
        this.chartType = data.chartType || "function";
        if (data.func) this.func = { ...data.func, error: null };
        if (data.view) this.view = data.view;
        if (Array.isArray(data.rows) && data.rows.length) this.rows = data.rows;
        if (data.nextRowId) this.nextRowId = data.nextRowId;
        if (data.venn) this.venn = migrateVennData(data.venn);
        for (const [id, btn] of Object.entries(this._typeButtons)) btn.classList.toggle("active", id === this.chartType);
        this._buildControls();
        this._draw();
      },
    });
  }

  _updateErrors() {
    if (this.func._errorEl) this.func._errorEl.textContent = this.func.error || "";
  }

  _resize() {
    const rect = this.stageEl.getBoundingClientRect();
    this.width = Math.max(200, rect.width);
    this.height = Math.max(200, rect.height);
    this.svg.attr("width", this.width).attr("height", this.height);
  }

  // World (math) coordinates <-> screen pixels for the current view window.
  _sx(x) { return ((x - this.view.xMin) / (this.view.xMax - this.view.xMin)) * this.width; }
  _sy(y) { return this.height - ((y - this.view.yMin) / (this.view.yMax - this.view.yMin)) * this.height; }
  _wx(px) { return this.view.xMin + (px / this.width) * (this.view.xMax - this.view.xMin); }
  _wy(py) { return this.view.yMin + ((this.height - py) / this.height) * (this.view.yMax - this.view.yMin); }

  _wireInteraction() {
    let dragging = false, startX = 0, startY = 0, startView = null;
    this.stageEl.addEventListener("pointerdown", (e) => {
      if (this.chartType !== "function") return;
      dragging = true; startX = e.clientX; startY = e.clientY; startView = { ...this.view };
      this.stageEl.setPointerCapture(e.pointerId);
      this.stageEl.style.cursor = "grabbing";
    });
    this.stageEl.addEventListener("pointermove", (e) => {
      if (this.chartType !== "function") return;
      const rect = this.stageEl.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (dragging) {
        const dxWorld = (e.clientX - startX) / this.width * (startView.xMax - startView.xMin);
        const dyWorld = (e.clientY - startY) / this.height * (startView.yMax - startView.yMin);
        this.view = {
          xMin: startView.xMin - dxWorld, xMax: startView.xMax - dxWorld,
          yMin: startView.yMin + dyWorld, yMax: startView.yMax + dyWorld,
        };
        this._draw();
      } else {
        this._updateTrace(px);
      }
    });
    const endDrag = () => { dragging = false; this.stageEl.style.cursor = "grab"; };
    this.stageEl.addEventListener("pointerup", endDrag);
    this.stageEl.addEventListener("pointercancel", endDrag);
    this.stageEl.addEventListener("pointerleave", () => { this.gTrace.style("display", "none"); this.coordReadout.textContent = ""; });
    this.stageEl.style.cursor = "grab";

    this.stageEl.addEventListener("wheel", (e) => {
      if (this.chartType !== "function") return;
      e.preventDefault();
      const rect = this.stageEl.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const wx = this._wx(px), wy = this._wy(py);
      const factor = Math.pow(1.0015, e.deltaY);
      this.view = {
        xMin: wx + (this.view.xMin - wx) * factor, xMax: wx + (this.view.xMax - wx) * factor,
        yMin: wy + (this.view.yMin - wy) * factor, yMax: wy + (this.view.yMax - wy) * factor,
      };
      this._draw();
    }, { passive: false });
  }

  _updateTrace(px) {
    let compiled = null;
    try { compiled = compileExpression(this.func.expr); } catch { compiled = null; }
    if (!compiled) { this.gTrace.style("display", "none"); this.coordReadout.textContent = ""; return; }
    const wx = this._wx(px);
    let y; try { y = compiled(wx); } catch { y = NaN; }
    if (!Number.isFinite(y)) { this.gTrace.style("display", "none"); this.coordReadout.textContent = ""; return; }
    this.gTrace.style("display", null).selectAll("*").remove();
    this.gTrace.append("line").attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", this.height)
      .attr("stroke", "var(--text-dim)").attr("stroke-width", 1).attr("stroke-dasharray", "3 3");
    this.gTrace.append("circle").attr("cx", this._sx(wx)).attr("cy", this._sy(y)).attr("r", 4).attr("fill", this.func.color);
    this.coordReadout.innerHTML = `<div style="color:${this.func.color}">x=${wx.toFixed(2)}, y=${y.toFixed(3)}</div>`;
  }

  // "Nice" gridline spacing (1/2/5 × a power of ten) — the same rule real
  // graphing calculators and charting libraries use so labels land on
  // round numbers instead of arbitrary fractions.
  _niceStep(span, targetCount) {
    const raw = span / targetCount;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    return step * mag;
  }

  _draw() {
    if (!this.width) this._resize();
    this.gGrid.selectAll("*").remove();
    this.gAxes.selectAll("*").remove();
    this.gCurves.selectAll("*").remove();

    if (this.chartType === "function") this._drawFunction();
    else if (this.chartType === "bar") this._drawBar();
    else if (this.chartType === "pie") this._drawPie();
    else this._drawVenn();
  }

  _drawFunction() {
    const { xMin, xMax, yMin, yMax } = this.view;
    const xStep = this._niceStep(xMax - xMin, 10);
    const yStep = this._niceStep(yMax - yMin, 8);

    for (let gx = Math.ceil(xMin / xStep) * xStep; gx <= xMax; gx += xStep) {
      const px = this._sx(gx);
      this.gGrid.append("line").attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", this.height).attr("class", "math-gridline");
    }
    for (let gy = Math.ceil(yMin / yStep) * yStep; gy <= yMax; gy += yStep) {
      const py = this._sy(gy);
      this.gGrid.append("line").attr("x1", 0).attr("x2", this.width).attr("y1", py).attr("y2", py).attr("class", "math-gridline");
    }

    // Axes clamped into the visible area even if the origin has been
    // panned off-screen, the way a real calculator keeps its axes visible.
    const axisX = this._sy(0) >= 0 && this._sy(0) <= this.height ? this._sy(0) : (yMin > 0 ? this.height : 0);
    const axisY = this._sx(0) >= 0 && this._sx(0) <= this.width ? this._sx(0) : (xMin > 0 ? 0 : this.width);
    this.gAxes.append("line").attr("x1", 0).attr("x2", this.width).attr("y1", axisX).attr("y2", axisX).attr("class", "math-axis");
    this.gAxes.append("line").attr("x1", axisY).attr("x2", axisY).attr("y1", 0).attr("y2", this.height).attr("class", "math-axis");
    for (let gx = Math.ceil(xMin / xStep) * xStep; gx <= xMax; gx += xStep) {
      if (Math.abs(gx) < xStep / 1000) continue;
      this.gAxes.append("text").attr("x", this._sx(gx)).attr("y", axisX + 14).attr("class", "math-axis-label").text(+gx.toFixed(6));
    }
    for (let gy = Math.ceil(yMin / yStep) * yStep; gy <= yMax; gy += yStep) {
      if (Math.abs(gy) < yStep / 1000) continue;
      this.gAxes.append("text").attr("x", axisY + 6).attr("y", this._sy(gy) + 4).attr("class", "math-axis-label").text(+gy.toFixed(6));
    }

    let compiled;
    try { compiled = compileExpression(this.func.expr); this.func.error = null; }
    catch (e) { this.func.error = e.message; compiled = null; }
    if (compiled) {
      const points = [];
      for (let i = 0; i <= SAMPLES; i++) {
        const x = xMin + (i / SAMPLES) * (xMax - xMin);
        let y; try { y = compiled(x); } catch { y = NaN; }
        points.push(Number.isFinite(y) ? { x, y } : null);
      }
      // Break the line at discontinuities/asymptotes (1/x, tan(x)...)
      // instead of drawing a wrong-looking near-vertical connector across
      // the gap — a real calculator shows the gap, not a fake line through it.
      const yRange = yMax - yMin;
      const segments = [[]];
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const prev = points[i - 1];
        if (!p) { if (segments[segments.length - 1].length) segments.push([]); continue; }
        if (prev && Math.abs(p.y - prev.y) > yRange * 4) segments.push([]);
        segments[segments.length - 1].push(p);
      }
      const line = d3.line().x((p) => this._sx(p.x)).y((p) => this._sy(p.y));
      for (const seg of segments) {
        if (seg.length < 2) continue;
        this.gCurves.append("path").attr("d", line(seg)).attr("fill", "none").attr("stroke", this.func.color).attr("stroke-width", 2.4);
      }
    }
    this._updateErrors();
  }

  _drawBar() {
    const margin = { top: 24, right: 20, bottom: 36, left: 44 };
    const w = this.width - margin.left - margin.right;
    const h = this.height - margin.top - margin.bottom;
    const rows = this.rows;
    const values = rows.map((r) => r.value);
    const vMax = Math.max(0, ...values);
    const vMin = Math.min(0, ...values);
    const span = vMax - vMin || 1;
    const yStep = this._niceStep(span, 6);
    const yScale = (v) => margin.top + h - ((v - vMin) / span) * h;
    const baseline = yScale(0);

    for (let gy = Math.ceil(vMin / yStep) * yStep; gy <= vMax; gy += yStep) {
      const py = yScale(gy);
      this.gGrid.append("line").attr("x1", margin.left).attr("x2", margin.left + w).attr("y1", py).attr("y2", py).attr("class", "math-gridline");
      this.gAxes.append("text").attr("x", margin.left - 8).attr("y", py + 4).attr("class", "math-axis-label").attr("text-anchor", "end").text(+gy.toFixed(4));
    }
    this.gAxes.append("line").attr("x1", margin.left).attr("x2", margin.left + w).attr("y1", baseline).attr("y2", baseline).attr("class", "math-axis");

    const bandW = w / rows.length;
    const barW = Math.min(70, bandW * 0.6);
    rows.forEach((r, i) => {
      const cx = margin.left + bandW * (i + 0.5);
      const y0 = yScale(Math.max(0, r.value));
      const y1 = yScale(Math.min(0, r.value));
      this.gCurves.append("rect")
        .attr("x", cx - barW / 2).attr("y", y0).attr("width", barW).attr("height", Math.max(0.5, y1 - y0))
        .attr("fill", r.color).attr("rx", 3);
      this.gCurves.append("text").attr("x", cx).attr("y", r.value >= 0 ? y0 - 6 : y0 + 16)
        .attr("class", "math-axis-label").attr("text-anchor", "middle").text(r.value);
      this.gAxes.append("text").attr("x", cx).attr("y", margin.top + h + 18)
        .attr("class", "math-axis-label").attr("text-anchor", "middle").text(r.label || "—");
    });
  }

  _drawPie() {
    const total = this.rows.reduce((s, r) => s + Math.max(0, r.value), 0);
    const cx = this.width * 0.36, cy = this.height / 2;
    const radius = Math.max(20, Math.min(cx - 20, cy - 20, 160));
    if (total <= 0) {
      this.gCurves.append("text").attr("x", this.width / 2).attr("y", this.height / 2)
        .attr("text-anchor", "middle").attr("class", "math-axis-label").text("Add at least one positive value to see a pie chart.");
      return;
    }
    const pie = d3.pie().value((r) => Math.max(0, r.value)).sort(null);
    const arc = d3.arc().innerRadius(0).outerRadius(radius);
    const g = this.gCurves.append("g").attr("transform", `translate(${cx},${cy})`);
    pie(this.rows).forEach((slice) => {
      const r = slice.data;
      if (r.value <= 0) return;
      g.append("path").attr("d", arc(slice)).attr("fill", r.color).attr("stroke", "var(--bg)").attr("stroke-width", 1.5);
      const [lx, ly] = arc.centroid(slice);
      const pct = (r.value / total) * 100;
      if (pct >= 5) {
        g.append("text").attr("x", lx).attr("y", ly).attr("text-anchor", "middle")
          .attr("class", "math-axis-label").attr("fill", "#fff").text(`${pct.toFixed(0)}%`);
      }
    });
    const legend = this.gCurves.append("g").attr("transform", `translate(${cx + radius + 40}, ${cy - (this.rows.length * 22) / 2})`);
    this.rows.forEach((r, i) => {
      const row = legend.append("g").attr("transform", `translate(0, ${i * 22})`);
      row.append("rect").attr("width", 12).attr("height", 12).attr("y", -10).attr("fill", r.color).attr("rx", 2);
      const pct = total > 0 ? (Math.max(0, r.value) / total) * 100 : 0;
      row.append("text").attr("x", 18).attr("y", 0).attr("class", "math-axis-label").text(`${r.label || "—"}: ${r.value} (${pct.toFixed(1)}%)`);
    });
  }

  _drawVenn() {
    const cx = this.width / 2, cy = this.height / 2;
    const R = Math.max(30, Math.min(this.width, this.height) * 0.22);
    const sum = (key) => this._vennItemsIn(key).reduce((s, it) => s + it.value, 0);
    const [labelA, labelB, labelC] = this.venn.labels;
    const g = this.gCurves;
    const hitR = R * 0.38;
    const regionRects = [];

    const circle = (x, y, color) =>
      g.append("circle").attr("cx", x).attr("cy", y).attr("r", R).attr("fill", color).attr("fill-opacity", 0.35).attr("stroke", color).attr("stroke-width", 2);
    const text = (x, y, str, opts = {}) =>
      g.append("text").attr("x", x).attr("y", y).attr("text-anchor", "middle").attr("class", "math-axis-label")
        .style("font-weight", opts.bold ? "600" : null).style("font-size", opts.big ? "13px" : null).text(str);
    // Drop tokens (small draggable circles for whatever values already sit
    // in this region) wrapped into rows of 3, starting just below the
    // region's total-so-far number.
    const tokens = (key, x, y) => {
      const items = this._vennItemsIn(key);
      const tr = 7;
      items.forEach((it, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const tx = x + (col - 1) * tr * 2.4;
        const ty = y + 15 + row * tr * 2.4;
        const token = g.append("circle").attr("cx", tx).attr("cy", ty).attr("r", tr)
          .attr("fill", it.color).attr("stroke", "var(--bg)").attr("stroke-width", 1.5)
          .attr("class", "math-venn-token");
        token.node().addEventListener("pointerdown", (e) => this._beginVennDrag(it, e));
      });
      regionRects.push({ key, x, y, hitR });
    };

    if (this.venn.sets === 2) {
      const cA = { x: cx - R * 0.55, y: cy }, cB = { x: cx + R * 0.55, y: cy };
      circle(cA.x, cA.y, CURVE_COLORS[0]);
      circle(cB.x, cB.y, CURVE_COLORS[1]);
      text(cA.x, cA.y - R - 12, labelA, { bold: true, big: true });
      text(cB.x, cB.y - R - 12, labelB, { bold: true, big: true });
      text(cA.x - R * 0.55, cy, sum("a"));
      text(cB.x + R * 0.55, cy, sum("b"));
      text(cx, cy, sum("ab"));
      tokens("a", cA.x - R * 0.55, cy);
      tokens("b", cB.x + R * 0.55, cy);
      tokens("ab", cx, cy);
      const total = sum("a") + sum("b") + sum("ab");
      text(cx, cy + R + 26, `Total: ${total}`, { bold: true });
    } else {
      const cA = { x: cx, y: cy - R * 0.55 };
      const cB = { x: cx - R * 0.55, y: cy + R * 0.35 };
      const cC = { x: cx + R * 0.55, y: cy + R * 0.35 };
      circle(cA.x, cA.y, CURVE_COLORS[0]);
      circle(cB.x, cB.y, CURVE_COLORS[1]);
      circle(cC.x, cC.y, CURVE_COLORS[2]);
      text(cA.x, cA.y - R - 12, labelA, { bold: true, big: true });
      text(cB.x - R * 0.85, cB.y + R * 0.75, labelB, { bold: true, big: true });
      text(cC.x + R * 0.85, cC.y + R * 0.75, labelC, { bold: true, big: true });
      const pA = { x: cA.x, y: cA.y - R * 0.55 };
      const pB = { x: cB.x - R * 0.6, y: cB.y + R * 0.35 };
      const pC = { x: cC.x + R * 0.6, y: cC.y + R * 0.35 };
      const pAB = { x: cx - R * 0.35, y: cy - R * 0.1 };
      const pAC = { x: cx + R * 0.35, y: cy - R * 0.1 };
      const pBC = { x: cx, y: cy + R * 0.5 };
      const pABC = { x: cx, y: cy + R * 0.12 };
      text(pA.x, pA.y, sum("a"));
      text(pB.x, pB.y, sum("b"));
      text(pC.x, pC.y, sum("c"));
      text(pAB.x, pAB.y, sum("ab"));
      text(pAC.x, pAC.y, sum("ac"));
      text(pBC.x, pBC.y, sum("bc"));
      text(pABC.x, pABC.y, sum("abc"));
      tokens("a", pA.x, pA.y); tokens("b", pB.x, pB.y); tokens("c", pC.x, pC.y);
      tokens("ab", pAB.x, pAB.y); tokens("ac", pAC.x, pAC.y); tokens("bc", pBC.x, pBC.y); tokens("abc", pABC.x, pABC.y);
      const total = sum("a") + sum("b") + sum("c") + sum("ab") + sum("ac") + sum("bc") + sum("abc");
      text(cx, cy + R + 40, `Total: ${total}`, { bold: true });
    }

    this._vennRegionRects = regionRects;
  }
}

function div(className) {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

// Charts saved before Venn diagrams became drag-and-drop stored one typed
// number per region (`values: {a, b, ...}`) instead of a list of items —
// loading one of those turns each nonzero region into a single item with
// that value, so an old save still opens with the right totals in place.
function migrateVennData(venn) {
  if (Array.isArray(venn.items)) return venn;
  const keys = ["a", "b", "c", "ab", "ac", "bc", "abc"];
  const items = [];
  let id = 1;
  for (const key of keys) {
    const value = venn.values?.[key];
    if (value) items.push({ id: id++, value, color: CURVE_COLORS[(id - 2) % CURVE_COLORS.length], region: key });
  }
  return { sets: venn.sets ?? 2, labels: venn.labels ?? ["A", "B", "C"], items, nextItemId: id };
}

// A real <input type="color"> styled to look like the old decorative
// swatch dot — clicking it opens the browser's native color picker, so any
// function/bar/pie color can be changed to literally anything, not just
// cycled through the CURVE_COLORS presets.
function colorSwatchInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "math-func-swatch-input";
  input.value = value;
  input.title = "Change color";
  input.addEventListener("input", () => onChange(input.value));
  return input;
}
