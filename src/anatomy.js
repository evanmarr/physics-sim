import { SYSTEMS, ORGANS, BODY_OUTLINE, VIEWBOX, organById, organsForSystem, BRAIN_VIEWBOX, BRAIN_PARTS_LOBES, BRAIN_PARTS_CROSS_SECTION } from "./anatomyData.js";

export class AnatomyMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx || {}; // { state, showToast }
    this.activeSystems = new Set(["skin"]);
    this.selectedOrganId = null;
    this.inBrain = false;
    this.brainCrossSection = false;
    this.selectedBrainPartId = null;
    this.activeChallenge = null; // { targets, index, score }
    this._build();
  }

  mount() {}
  unmount() {}

  _build() {
    this.root.innerHTML = "";
    this.layersPanel = div("anat-panel anat-layers");
    this.viewerPanel = div("anat-panel anat-viewer");
    this.infoPanel = div("anat-panel anat-info");
    this.root.appendChild(this.layersPanel);
    this.root.appendChild(this.viewerPanel);
    this.root.appendChild(this.infoPanel);

    this.challengeModal = buildAnatomyChallengeModal(this);
    this.root.appendChild(this.challengeModal.el);

    this._buildLayers();
    this._buildViewer();
    this._renderInfo();
  }

  _buildLayers() {
    this.layersPanel.innerHTML = "";
    const title = div("chem-panel-title");
    title.textContent = "Body Systems";
    this.layersPanel.appendChild(title);

    const hint = div("chem-hint");
    hint.textContent = "Toggle layers on/off, or click an organ (then click its system name in the right panel) to isolate just that system.";
    this.layersPanel.appendChild(hint);

    for (const sys of SYSTEMS) {
      const row = div("anat-layer-row");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "layer_" + sys.id;
      cb.checked = this.activeSystems.has(sys.id);
      cb.addEventListener("change", () => {
        if (cb.checked) this.activeSystems.add(sys.id);
        else this.activeSystems.delete(sys.id);
        this._renderBody();
      });
      const swatch = document.createElement("span");
      swatch.className = "anat-swatch";
      swatch.style.background = sys.color;
      const label = document.createElement("label");
      label.htmlFor = cb.id;
      label.textContent = sys.label;
      row.appendChild(cb);
      row.appendChild(swatch);
      row.appendChild(label);
      this.layersPanel.appendChild(row);
    }

    const allBtn = document.createElement("button");
    allBtn.textContent = "Show all systems";
    allBtn.style.marginTop = "10px";
    allBtn.addEventListener("click", () => {
      SYSTEMS.forEach((s) => this.activeSystems.add(s.id));
      this._buildLayers();
      this._renderBody();
    });
    this.layersPanel.appendChild(allBtn);

    const challengeBtn = document.createElement("button");
    challengeBtn.textContent = "🏆 Anatomy Challenges";
    challengeBtn.className = "primary";
    challengeBtn.style.marginTop = "8px";
    challengeBtn.addEventListener("click", () => this.challengeModal.open());
    this.layersPanel.appendChild(challengeBtn);
  }

  // ---- "Find These Organs" challenge: click the named organ directly on
  // the body, one at a time, instead of picking from multiple choice (that's
  // what Quiz mode is for) — a spatial-recall task instead of recognition.
  startOrganHunt() {
    this.inBrain = false;
    this.activeSystems = new Set(SYSTEMS.map((s) => s.id));
    this._buildLayers();
    this._buildViewer();
    const pool = shuffleArr(ORGANS).slice(0, 6);
    this.activeChallenge = { targets: pool, index: 0, score: 0 };
    this._renderChallengeBanner();
  }

  _handleHuntClick(organ) {
    const c = this.activeChallenge;
    if (!c || c.index >= c.targets.length) return;
    const target = c.targets[c.index];
    const correct = organ.id === target.id;
    if (correct) c.score++;
    this._flashOrgan(organ.id, correct);
    c.index++;
    this._renderChallengeBanner();
  }

  _flashOrgan(organId, correct) {
    const el = this.svg?.querySelector(`[data-organ-id="${organId}"]`);
    if (!el) return;
    el.classList.add(correct ? "anat-hunt-correct" : "anat-hunt-incorrect");
    setTimeout(() => el.classList.remove("anat-hunt-correct", "anat-hunt-incorrect"), 500);
  }

  _renderChallengeBanner() {
    this._challengeBanner?.remove();
    if (!this.activeChallenge || !this.viewerPanel) return;
    const c = this.activeChallenge;
    const banner = div("anat-challenge-banner");
    if (c.index >= c.targets.length) {
      const passed = c.score >= Math.ceil(c.targets.length * 0.7);
      banner.innerHTML = `<b>Hunt complete!</b> Score: ${c.score} / ${c.targets.length}`;
      if (passed) {
        this.ctx.state?.completedChallenges?.add("anat_organ_hunt");
        this.ctx.showToast?.("Challenge complete: found the organs!");
      }
      const doneBtn = document.createElement("button");
      doneBtn.textContent = "Done";
      doneBtn.addEventListener("click", () => { this.activeChallenge = null; this._renderChallengeBanner(); });
      banner.appendChild(doneBtn);
    } else {
      const target = c.targets[c.index];
      const text = document.createElement("span");
      text.innerHTML = `<b>Find:</b> ${target.name} <span class="anat-challenge-progress">(${c.index + 1}/${c.targets.length} · Score ${c.score})</span>`;
      banner.appendChild(text);
      const endBtn = document.createElement("button");
      endBtn.textContent = "End";
      endBtn.addEventListener("click", () => { this.activeChallenge = null; this._renderChallengeBanner(); });
      banner.appendChild(endBtn);
    }
    this._challengeBanner = banner;
    this.viewerPanel.prepend(banner);
  }

  _buildViewer() {
    this.viewerPanel.innerHTML = "";
    const title = div("chem-panel-title");
    title.textContent = this.inBrain ? "Brain" : "Body";
    this.viewerPanel.appendChild(title);

    if (this.inBrain) {
      this._buildBrainViewer();
    } else {
      this._buildBodyViewer();
    }
  }

  _buildBodyViewer() {
    const wrap = div("anat-svg-wrap");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("viewBox", VIEWBOX);
    this.svg.setAttribute("class", "anat-svg");
    wrap.appendChild(this.svg);
    this.viewerPanel.appendChild(wrap);

    this.tooltip = div("anat-tooltip hidden");
    this.viewerPanel.appendChild(this.tooltip);

    this._renderBody();
  }

  _renderBody() {
    if (!this.svg) return;
    this.svg.innerHTML = "";

    // faint reference outline, always present
    const outlineG = svgEl("g", { class: "anat-outline" });
    BODY_OUTLINE.forEach((s) => outlineG.appendChild(shapeEl(s)));
    this.svg.appendChild(outlineG);

    for (const sys of SYSTEMS) {
      if (!this.activeSystems.has(sys.id)) continue;
      const g = svgEl("g", { class: "anat-system-layer" });
      for (const organ of organsForSystem(sys.id)) {
        const el = this._buildOrganEl(organ, sys.color);
        g.appendChild(el);
      }
      this.svg.appendChild(g);
    }
  }

  _buildOrganEl(organ, color) {
    const g = svgEl("g", { class: "anat-organ", "data-organ-id": organ.id });
    if (organ.shape.tag === "g") {
      organ.shape.shapes.forEach((s) => g.appendChild(shapeEl(s, color)));
    } else {
      g.appendChild(shapeEl(organ.shape, color));
    }
    g.classList.toggle("selected", this.selectedOrganId === organ.id);
    g.addEventListener("mouseenter", (e) => this._showTooltip(organ.name, e));
    g.addEventListener("mousemove", (e) => this._moveTooltip(e));
    g.addEventListener("mouseleave", () => this._hideTooltip());
    g.addEventListener("click", () => {
      if (this.activeChallenge) {
        this._handleHuntClick(organ);
        return;
      }
      if (organ.isolatable && organ.id === "brain") {
        this._enterBrain();
        return;
      }
      this.selectedOrganId = organ.id;
      this._renderBody();
      this._renderInfo();
    });
    return g;
  }

  _showTooltip(name, e) {
    this.tooltip.textContent = name;
    this.tooltip.classList.remove("hidden");
    this._moveTooltip(e);
  }
  _moveTooltip(e) {
    const rect = this.viewerPanel.getBoundingClientRect();
    this.tooltip.style.left = e.clientX - rect.left + 14 + "px";
    this.tooltip.style.top = e.clientY - rect.top + 10 + "px";
  }
  _hideTooltip() {
    this.tooltip.classList.add("hidden");
  }

  _renderInfo() {
    this.infoPanel.innerHTML = "";
    const title = div("chem-panel-title");
    title.textContent = "Details";
    this.infoPanel.appendChild(title);

    if (this.inBrain) {
      this._renderBrainInfo();
      return;
    }

    const organ = this.selectedOrganId ? organById(this.selectedOrganId) : null;
    if (!organ) {
      const empty = div("panel-empty");
      empty.textContent = "Click an organ in the body to see details here.";
      this.infoPanel.appendChild(empty);
      return;
    }
    this.infoPanel.appendChild(organInfoCard(organ, {
      onIsolate: () => {
        this.activeSystems = new Set([organ.system]);
        this._buildLayers();
        this._renderBody();
      },
    }));
  }

  // ---- Brain isolation ----
  _enterBrain() {
    this.inBrain = true;
    this.selectedBrainPartId = null;
    this.brainCrossSection = false;
    this._buildViewer();
    this._renderInfo();
  }

  _exitBrain() {
    this.inBrain = false;
    this._buildViewer();
    this._renderInfo();
  }

  _buildBrainViewer() {
    const backBtn = document.createElement("button");
    backBtn.textContent = "← Back to full body";
    backBtn.addEventListener("click", () => this._exitBrain());
    this.viewerPanel.appendChild(backBtn);

    const controls = div("anat-brain-controls");
    const wholeBtn = document.createElement("button");
    wholeBtn.textContent = "Whole brain";
    wholeBtn.className = this.brainCrossSection ? "" : "primary";
    wholeBtn.addEventListener("click", () => { this.brainCrossSection = false; this._renderBrain(); this._updateBrainButtons(); });
    const crossBtn = document.createElement("button");
    crossBtn.textContent = "✂ Cut in half";
    crossBtn.className = this.brainCrossSection ? "primary" : "";
    crossBtn.addEventListener("click", () => { this.brainCrossSection = true; this._renderBrain(); this._updateBrainButtons(); });
    controls.appendChild(wholeBtn);
    controls.appendChild(crossBtn);
    this.viewerPanel.appendChild(controls);
    this._wholeBtn = wholeBtn;
    this._crossBtn = crossBtn;

    const wrap = div("anat-svg-wrap");
    this.brainSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.brainSvg.setAttribute("viewBox", BRAIN_VIEWBOX);
    this.brainSvg.setAttribute("class", "anat-svg");
    wrap.appendChild(this.brainSvg);
    this.viewerPanel.appendChild(wrap);

    const hemiLabels = div("anat-hemi-labels");
    hemiLabels.innerHTML = `<span>Front</span><span>Back</span>`;
    this.viewerPanel.appendChild(hemiLabels);

    this._renderBrain();
  }

  _updateBrainButtons() {
    this._wholeBtn.className = this.brainCrossSection ? "" : "primary";
    this._crossBtn.className = this.brainCrossSection ? "primary" : "";
  }

  _renderBrain() {
    this.brainSvg.innerHTML = "";
    const parts = this.brainCrossSection ? BRAIN_PARTS_CROSS_SECTION : BRAIN_PARTS_LOBES;

    if (!this.brainCrossSection) {
      // simple whole-brain silhouette behind the lobes
      const outline = svgEl("path", {
        d: "M50,150 C50,80 130,40 220,40 C300,40 340,90 340,150 C340,220 300,260 220,265 C130,270 50,220 50,150 Z",
        class: "anat-outline",
      });
      this.brainSvg.appendChild(outline);
    }

    parts.forEach((part) => {
      const g = svgEl("g", { class: "anat-organ", "data-part-id": part.id });
      g.appendChild(shapeEl(part.shape, "#f2c744"));
      g.classList.toggle("selected", this.selectedBrainPartId === part.id);
      g.addEventListener("mouseenter", (e) => this._showTooltip(part.name, e));
      g.addEventListener("mousemove", (e) => this._moveTooltip(e));
      g.addEventListener("mouseleave", () => this._hideTooltip());
      g.addEventListener("click", () => {
        this.selectedBrainPartId = part.id;
        this._renderBrain();
        this._renderInfo();
      });
      this.brainSvg.appendChild(g);
    });

    this.tooltip = this.tooltip || div("anat-tooltip hidden");
    if (!this.tooltip.parentNode) this.viewerPanel.appendChild(this.tooltip);
  }

  _renderBrainInfo() {
    const parts = this.brainCrossSection ? BRAIN_PARTS_CROSS_SECTION : BRAIN_PARTS_LOBES;
    const part = parts.find((p) => p.id === this.selectedBrainPartId);
    if (!part) {
      const empty = div("panel-empty");
      empty.textContent = "Click a region of the brain to see details.";
      this.infoPanel.appendChild(empty);
      return;
    }
    const card = div("chem-info-card");
    card.innerHTML = `
      <div class="chem-info-title">${part.name}</div>
      <div class="chem-info-row"><span>Hemisphere</span><b>${part.hemisphere === "both" ? "Both (paired)" : part.hemisphere === "center" ? "Midline (unpaired)" : part.hemisphere}</b></div>
      <div class="anat-function"><b>Function</b><p>${part.function}</p></div>
      <div class="anat-facts"><b>Fun facts</b><ul>${part.facts.map((f) => `<li>${f}</li>`).join("")}</ul></div>
    `;
    this.infoPanel.appendChild(card);
  }
}

function organInfoCard(organ, { onIsolate }) {
  const sys = SYSTEMS.find((s) => s.id === organ.system);
  const card = div("chem-info-card");
  card.innerHTML = `<div class="chem-info-title">${organ.name}</div>`;
  const sysRow = document.createElement("div");
  sysRow.className = "chem-info-row";
  sysRow.innerHTML = `<span>System</span>`;
  const sysBtn = document.createElement("button");
  sysBtn.className = "anat-system-link";
  sysBtn.textContent = sys.label;
  sysBtn.addEventListener("click", onIsolate);
  sysRow.appendChild(sysBtn);
  card.appendChild(sysRow);

  const fn = document.createElement("div");
  fn.className = "anat-function";
  fn.innerHTML = `<b>Function</b><p>${organ.function}</p>`;
  card.appendChild(fn);

  const facts = document.createElement("div");
  facts.className = "anat-facts";
  facts.innerHTML = `<b>Fun facts</b><ul>${organ.facts.map((f) => `<li>${f}</li>`).join("")}</ul>`;
  card.appendChild(facts);

  return card;
}

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildAnatomyChallengeModal(mode) {
  const el = div("modal hidden");
  const box = div("modal-box");
  box.innerHTML = `<h2>Anatomy Challenges</h2><div class="anat-challenge-list"></div>`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => el.classList.add("hidden"));
  box.appendChild(closeBtn);
  el.appendChild(box);
  const list = box.querySelector(".anat-challenge-list");

  function render() {
    list.innerHTML = "";
    const row = div("shop-item");
    row.innerHTML = `
      <div class="info">
        <div class="name">Find These Organs</div>
        <div class="concept-tag">Spatial identification</div>
        <div class="desc">You'll be shown organ names one at a time — click directly on the body to find each one. All systems are shown for the hunt.</div>
      </div>
    `;
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Start Hunt";
    btn.addEventListener("click", () => {
      el.classList.add("hidden");
      mode.startOrganHunt();
    });
    row.appendChild(btn);
    list.appendChild(row);
  }

  return {
    el,
    open() { render(); el.classList.remove("hidden"); },
  };
}

function div(className) {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function shapeEl(s, color) {
  let el;
  if (s.tag === "circle") el = svgEl("circle", { cx: s.cx, cy: s.cy, r: s.r });
  else if (s.tag === "ellipse") el = svgEl("ellipse", { cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry });
  else if (s.tag === "rect") el = svgEl("rect", { x: s.x, y: s.y, width: s.width, height: s.height, rx: s.rx || 0 });
  else if (s.tag === "path") el = svgEl("path", { d: s.d });
  else el = svgEl("g");

  if (color) el.setAttribute("fill", s.strokeOnly ? "none" : color);
  if (s.fillOpacity != null) el.setAttribute("fill-opacity", s.fillOpacity);
  if (s.strokeOnly) {
    el.setAttribute("stroke", color || "#888");
    el.setAttribute("stroke-width", s.strokeWidth || 4);
    el.setAttribute("fill", "none");
  }
  return el;
}
