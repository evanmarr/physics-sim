import { ELEMENTS, CATEGORY_COLORS, CATEGORY_LABELS, elementBySymbol, evaluateMix, meltingBoiling, phaseAt, ROOM_TEMP_K } from "./chemistryData.js";
import { AtomViewer } from "./atomViewer.js";
import { CHEMISTRY_CHALLENGES } from "./chemistryChallenges.js";

const WATER_SYMBOL = "H2O"; // a synthetic pseudo-element the mixing bench can use
const MIN_SLOTS = 4;
const MAX_SLOTS = 12;

export class ChemistryMode {
  constructor(root, economy) {
    this.root = root;
    this.economy = economy; // { state } — challenge completion just marks state.completedChallenges
    this.selectedSymbol = "H";
    // slots: array of { symbol, tempK } | null
    this.slots = Array.from({ length: MIN_SLOTS }, () => null);
    this._build();
  }

  _build() {
    this.root.innerHTML = "";

    this.periodicPanel = div("chem-panel chem-periodic");
    this.centerPanel = div("chem-panel chem-center");
    this.mixPanel = div("chem-panel chem-mix");

    this.root.appendChild(this.periodicPanel);
    this.root.appendChild(this.centerPanel);
    this.root.appendChild(this.mixPanel);

    this._buildPeriodicTable();
    this._buildCenter();
    this._buildMixPanel();

    this.showElement(this.selectedSymbol);
  }

  mount() {
    this.atomViewer?.start();
  }

  unmount() {
    this.atomViewer?.stop();
  }

  _buildPeriodicTable() {
    const title = div("chem-panel-title");
    title.textContent = "Periodic Table";
    this.periodicPanel.appendChild(title);

    const legend = div("chem-legend");
    for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
      const item = document.createElement("span");
      item.className = "chem-legend-item";
      item.innerHTML = `<i style="background:${CATEGORY_COLORS[cat]}"></i>${label}`;
      legend.appendChild(item);
    }
    this.periodicPanel.appendChild(legend);

    const grid = div("chem-grid");
    for (const el of ELEMENTS) {
      const tile = document.createElement("button");
      tile.className = "chem-tile";
      tile.style.background = CATEGORY_COLORS[el.category];
      tile.style.gridColumn = String(gridColumnFor(el));
      tile.style.gridRow = String(gridRowFor(el));
      tile.innerHTML = `<span class="chem-tile-num">${el.number}</span><span class="chem-tile-sym">${el.symbol}</span>`;
      tile.title = el.name;
      tile.addEventListener("click", () => this.showElement(el.symbol));
      tile.addEventListener("dblclick", () => this._addToMix(el.symbol));
      grid.appendChild(tile);
    }
    this.periodicPanel.appendChild(grid);

    const hint = div("chem-hint");
    hint.textContent = "Click an element to inspect it. Double-click (or drag) to add it to the mixing bench.";
    this.periodicPanel.appendChild(hint);
  }

  _buildCenter() {
    const title = div("chem-panel-title");
    title.textContent = "Atom Viewer";
    this.centerPanel.appendChild(title);

    this.atomViewerEl = div("chem-atom-viewer");
    this.centerPanel.appendChild(this.atomViewerEl);
    this.atomViewer = new AtomViewer(this.atomViewerEl);

    this.elementInfo = div("chem-element-info");
    this.centerPanel.appendChild(this.elementInfo);

    const addBtn = document.createElement("button");
    addBtn.className = "primary chem-add-btn";
    addBtn.textContent = "Add to mixing bench";
    addBtn.addEventListener("click", () => this._addToMix(this.selectedSymbol));
    this.centerPanel.appendChild(addBtn);
  }

  _buildMixPanel() {
    const title = div("chem-panel-title");
    title.textContent = "Mixing Bench";
    this.mixPanel.appendChild(title);

    const hint = div("chem-hint");
    hint.textContent = "Combinations are exact: water is H₂O only with a 2:1 ratio of hydrogen to oxygen, not any two elements. Each slot has its own temperature, which sets whether that element is solid, liquid, or gas.";
    this.mixPanel.appendChild(hint);

    this.slotsEl = div("chem-slots");
    this.mixPanel.appendChild(this.slotsEl);

    const slotBtnRow = div("chem-slot-btn-row");
    this.addSlotBtn = document.createElement("button");
    this.addSlotBtn.textContent = "+ Add Slot";
    this.addSlotBtn.addEventListener("click", () => this._addSlotSpace());
    this.removeSlotBtn = document.createElement("button");
    this.removeSlotBtn.textContent = "− Remove Slot";
    this.removeSlotBtn.addEventListener("click", () => this._removeSlotSpace());
    slotBtnRow.appendChild(this.addSlotBtn);
    slotBtnRow.appendChild(this.removeSlotBtn);
    this.mixPanel.appendChild(slotBtnRow);

    const waterBtn = document.createElement("button");
    waterBtn.className = "chem-water-btn";
    waterBtn.textContent = "💧 Add Water (H₂O)";
    waterBtn.title = "See how a metal reacts when dropped in water";
    waterBtn.addEventListener("click", () => this._addToMix(WATER_SYMBOL));
    this.mixPanel.appendChild(waterBtn);

    const reactBtn = document.createElement("button");
    reactBtn.className = "primary chem-react-btn";
    reactBtn.textContent = "⚗ React!";
    reactBtn.addEventListener("click", () => this._react());
    this.mixPanel.appendChild(reactBtn);

    this.resultEl = div("chem-result");
    this.mixPanel.appendChild(this.resultEl);

    const chalBtn = document.createElement("button");
    chalBtn.textContent = "Chemistry Challenges";
    chalBtn.style.marginTop = "14px";
    chalBtn.addEventListener("click", () => this._openChallenges());
    this.mixPanel.appendChild(chalBtn);

    this.challengeModal = buildChallengeModal(this.economy);
    this.mixPanel.appendChild(this.challengeModal.el);

    this._renderSlots();
  }

  showElement(symbol) {
    const el = elementBySymbol(symbol);
    if (!el) return;
    this.selectedSymbol = symbol;
    this.inspectingIndex = null;
    this.atomViewer.showElement(el, CATEGORY_COLORS[el.category]);
    this.elementInfo.innerHTML = "";
    this.elementInfo.appendChild(elementInfoCard(el));

    // Inspecting an element swaps the shared viewer away from whatever
    // reaction was just shown — leave a one-click way back instead of
    // silently losing it (that's the "reaction only shows one atom" trap:
    // the last thing you *looked at* wasn't the reaction at all).
    if (this.lastMolecule) {
      const link = document.createElement("button");
      link.className = "reopen-math-link";
      link.textContent = `▸ Show last reaction (${this.lastMolecule.result.name || this.lastMolecule.result.formula})`;
      link.addEventListener("click", () => this._showLastReaction());
      this.elementInfo.appendChild(link);
    }
  }

  _showLastReaction() {
    if (!this.lastMolecule) return;
    this.atomViewer.showMolecule(this.lastMolecule.atoms);
    this.elementInfo.innerHTML = "";
    this.elementInfo.appendChild(moleculeInfoCard(this.lastMolecule.result, this.lastMolecule.atoms));
  }

  _addToMix(symbol) {
    const emptyIndex = this.slots.findIndex((s) => s == null);
    if (emptyIndex === -1) {
      this.resultEl.innerHTML = "";
      this.resultEl.appendChild(resultNote(`All ${this.slots.length} slots are full — clear one, or add more slots (up to ${MAX_SLOTS}).`));
      return;
    }
    this.slots[emptyIndex] = { symbol, tempK: ROOM_TEMP_K };
    this.resultEl.innerHTML = "";
    this._renderSlots();
  }

  _addSlotSpace() {
    if (this.slots.length >= MAX_SLOTS) return;
    this.slots.push(null);
    this._renderSlots();
  }

  _removeSlotSpace() {
    if (this.slots.length <= MIN_SLOTS) return;
    // remove the last empty slot if there is one, else just the last slot
    const lastEmpty = [...this.slots].reverse().findIndex((s) => s == null);
    if (lastEmpty !== -1) this.slots.splice(this.slots.length - 1 - lastEmpty, 1);
    else this.slots.pop();
    this._renderSlots();
  }

  _renderSlots() {
    this.slotsEl.innerHTML = "";
    this.slots.forEach((entry, i) => {
      this.slotsEl.appendChild(mixSlot(entry, {
        onClear: () => {
          this.slots[i] = null;
          this.resultEl.innerHTML = "";
          if (this.inspectingIndex === i) this.inspectingIndex = null;
          this._renderSlots();
        },
        onTemp: (tempK) => {
          entry.tempK = tempK;
          this._renderSlots();
          // Live animation: if this is the slot currently shown in the
          // viewer, re-drive it on every tick of the drag, not just when
          // you release the slider — that's the whole point of watching
          // temperature change something in real time.
          if (this.inspectingIndex === i) this._showPhase(entry, i, false);
        },
        // Fires once a temperature change settles (a phase button, or
        // letting go of the slider) — heating/cooling something in the
        // bench can push a mix across a reaction threshold without an
        // explicit "React!" click.
        onTempCommit: () => this._react(),
        onInspect: () => this._showPhase(entry, i),
      }));
    });
    this.addSlotBtn.disabled = this.slots.length >= MAX_SLOTS;
    this.removeSlotBtn.disabled = this.slots.length <= MIN_SLOTS;
  }

  // Shows this slot's substance in the atom viewer as a small cluster of
  // particles that actually *move* the way that phase does — a solid
  // vibrating in a lattice, a liquid sliding around in a blob, a gas
  // flying fast and bouncing off its container — instead of just a phase
  // label. Motion intensity scales continuously with temperature *within*
  // the current phase too (a solid right at its melting point visibly
  // shakes harder than a solid near absolute zero), not just a jump at
  // each phase boundary.
  _showPhase(entry, index, resetCamera = true) {
    if (!entry || entry.symbol === WATER_SYMBOL) return;
    const el = elementBySymbol(entry.symbol);
    if (!el) return;
    this.inspectingIndex = index;
    const phase = phaseAt(el, entry.tempK);
    const [mp, bp] = meltingBoiling(el);
    let heat;
    if (phase === "solid") heat = mp > 0 ? entry.tempK / mp : 0.5;
    else if (phase === "liquid") heat = bp > mp ? (entry.tempK - mp) / (bp - mp) : 0.5;
    else heat = (entry.tempK - bp) / 1500; // gas has no upper bound — just keeps getting more energetic
    heat = Math.max(0, Math.min(1, heat));
    this.atomViewer.showPhaseCluster(14, phase, CATEGORY_COLORS[el.category], heat, resetCamera);
    this.elementInfo.innerHTML = "";
    const card = div("chem-info-card");
    card.innerHTML = `
      <div class="chem-info-title">${el.name} <span class="chem-info-sym">${el.symbol}</span></div>
      <div class="chem-info-row"><span>Phase at ${entry.tempK} K</span><b>${phase}</b></div>
    `;
    this.elementInfo.appendChild(card);
    const note = document.createElement("div");
    note.className = "chem-molecule-note";
    note.textContent = phase === "solid"
      ? "Solid: particles are locked in place, just vibrating with heat."
      : phase === "liquid"
        ? "Liquid: particles stay close together but slide past each other freely."
        : "Gas: particles move fast and independently, filling all the space they can.";
    card.appendChild(note);
  }

  _react() {
    this.inspectingIndex = null;
    this.resultEl.innerHTML = "";
    const filled = this.slots.filter(Boolean);
    if (filled.length < 1) {
      this.resultEl.appendChild(resultNote("Add elements to the bench first — click a tile, then \"Add to mixing bench\" (or double-click a tile)."));
      return;
    }
    const result = evaluateMix(filled);
    this.resultEl.appendChild(resultCard(result));
    const counts = {};
    for (const e of filled) if (e.symbol !== WATER_SYMBOL) counts[e.symbol] = (counts[e.symbol] || 0) + 1;
    this.lastResult = { entries: filled, counts, distinct: Object.keys(counts), hasWater: filled.some((e) => e.symbol === WATER_SYMBOL), result };
    this.root.dispatchEvent(new CustomEvent("chem:reaction", { detail: this.lastResult }));

    // Show every reacted atom together in the 3D viewer instead of just the
    // last single element selected — water expands to its real O + 2H.
    // Colored by the conventional CPK palette (not category color) so
    // different elements in the same molecule are easy to tell apart.
    const moleculeAtoms = [];
    for (const e of filled) {
      if (e.symbol === WATER_SYMBOL) {
        moleculeAtoms.push({ symbol: "O", colorHex: cpkColor("O") });
        moleculeAtoms.push({ symbol: "H", colorHex: cpkColor("H") });
        moleculeAtoms.push({ symbol: "H", colorHex: cpkColor("H") });
      } else {
        moleculeAtoms.push({ symbol: e.symbol, colorHex: cpkColor(e.symbol) });
      }
    }
    this.lastMolecule = { atoms: moleculeAtoms, result };
    this.atomViewer.showMolecule(moleculeAtoms);
    this.elementInfo.innerHTML = "";
    this.elementInfo.appendChild(moleculeInfoCard(result, moleculeAtoms));
  }

  _openChallenges() {
    this.challengeModal.open(this.lastResult);
  }
}

function div(className) {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

function gridColumnFor(el) {
  if (el.category === "lanthanide") return 3 + (el.number - 57);
  if (el.category === "actinide") return 3 + (el.number - 89);
  return el.group || 1;
}
function gridRowFor(el) {
  if (el.category === "lanthanide") return 9;
  if (el.category === "actinide") return 10;
  return el.period;
}

// Standard CPK atom-coloring convention for the molecule viewer, so
// different elements in one molecule are distinguishable at a glance —
// falls back to the element's category color for anything not listed.
const CPK_COLORS = {
  H: "#f2f2f2", C: "#404040", N: "#3050f8", O: "#ff3030", F: "#90e050",
  Cl: "#1fc01f", Br: "#a62929", I: "#940094", S: "#ffc832", P: "#ff8000",
  Na: "#ab5cf2", K: "#8f40d4", Ca: "#3dff00", Mg: "#8aff00", Fe: "#e06633",
  Cu: "#c88033", Zn: "#7d80b0", Ag: "#c0c0c0", Au: "#ffd123", He: "#d9ffff",
};
function cpkColor(symbol) {
  return CPK_COLORS[symbol] || CATEGORY_COLORS[elementBySymbol(symbol)?.category] || "#4f8cff";
}

function moleculeInfoCard(result, atoms) {
  const card = div("chem-info-card");
  const counts = {};
  atoms.forEach((a) => { counts[a.symbol] = (counts[a.symbol] || 0) + 1; });
  const composition = Object.entries(counts).map(([sym, n]) => (n === 1 ? sym : `${sym}${n}`)).join(" + ");
  card.innerHTML = `
    <div class="chem-info-title">${result.name || "Result"}</div>
    <div class="chem-info-row"><span>Atoms shown</span><b>${composition}</b></div>
    ${result.formula ? `<div class="chem-info-row"><span>Formula</span><b>${result.formula}</b></div>` : ""}
  `;
  const note = document.createElement("div");
  note.className = "chem-molecule-note";
  note.textContent = "Simplified ball-and-stick view — atoms are spread evenly around the central one, not each molecule's real bond angles.";
  card.appendChild(note);
  return card;
}

function elementInfoCard(el) {
  const card = div("chem-info-card");
  const [mp, bp] = meltingBoiling(el);
  const phase = phaseAt(el, ROOM_TEMP_K);
  card.innerHTML = `
    <div class="chem-info-title">${el.name} <span class="chem-info-sym">${el.symbol}</span></div>
    <div class="chem-info-row"><span>Atomic number</span><b>${el.number}</b></div>
    <div class="chem-info-row"><span>Category</span><b>${CATEGORY_LABELS[el.category]}</b></div>
    <div class="chem-info-row"><span>Atomic mass</span><b>${el.mass}</b></div>
    <div class="chem-info-row"><span>Electron shells</span><b>${el.shells.join(", ")}</b></div>
    <div class="chem-info-row"><span>Common oxidation states</span><b>${el.oxidationStates.map((s) => (s > 0 ? "+" + s : s)).join(", ")}</b></div>
    <div class="chem-info-row"><span>Melting / boiling point</span><b>${mp} K / ${bp} K</b></div>
    <div class="chem-info-row"><span>Phase at room temp (298 K)</span><b>${phase}</b></div>
  `;
  return card;
}

function mixSlot(entry, { onClear, onTemp, onTempCommit, onInspect }) {
  const slot = div("chem-slot" + (entry ? " filled" : ""));
  if (!entry) {
    slot.textContent = "empty";
    return slot;
  }
  if (entry.symbol === WATER_SYMBOL) {
    slot.innerHTML = `<span class="chem-slot-sym">H₂O</span><span class="chem-slot-name">Water</span>`;
  } else {
    const el = elementBySymbol(entry.symbol);
    const phase = phaseAt(el, entry.tempK);
    slot.style.borderColor = CATEGORY_COLORS[el.category];
    slot.innerHTML = `<span class="chem-slot-sym">${el.symbol}</span><span class="chem-slot-name">${el.name} · ${phase}</span>`;
    slot.title = "Click to see this substance's particles move";
    slot.addEventListener("click", () => onInspect?.());

    const [mp, bp] = meltingBoiling(el);
    const phaseRow = div("chem-slot-phase-row");
    const PHASE_TARGET_K = { solid: Math.max(0, mp - 50), liquid: Math.round((mp + bp) / 2), gas: bp + 50 };
    for (const p of ["solid", "liquid", "gas"]) {
      const btn = document.createElement("button");
      btn.className = "chem-phase-btn" + (phase === p ? " active" : "");
      btn.textContent = p;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onTemp(PHASE_TARGET_K[p]);
        onTempCommit?.();
      });
      phaseRow.appendChild(btn);
    }
    slot.appendChild(phaseRow);

    const tempRow = div("chem-slot-temp");
    const tempLabel = document.createElement("span");
    tempLabel.textContent = `${entry.tempK} K`;
    const tempInput = document.createElement("input");
    tempInput.type = "range";
    tempInput.min = "0";
    tempInput.max = "3000";
    tempInput.step = "10";
    tempInput.value = String(entry.tempK);
    tempInput.addEventListener("click", (e) => e.stopPropagation());
    tempInput.addEventListener("input", (e) => {
      e.stopPropagation();
      tempLabel.textContent = `${tempInput.value} K`;
      onTemp(parseInt(tempInput.value, 10));
    });
    // "change" fires once, when the slider is released — unlike "input"
    // (which fires continuously while dragging), this is the right moment
    // to re-run the reaction check without the 3D view jumping every tick.
    tempInput.addEventListener("change", (e) => { e.stopPropagation(); onTempCommit?.(); });
    tempRow.appendChild(tempInput);
    tempRow.appendChild(tempLabel);
    slot.appendChild(tempRow);
  }
  const x = document.createElement("button");
  x.className = "chem-slot-clear";
  x.textContent = "×";
  x.addEventListener("click", (e) => { e.stopPropagation(); onClear(); });
  slot.appendChild(x);
  return slot;
}

function resultNote(text) {
  const p = div("chem-result-note");
  p.textContent = text;
  return p;
}

function resultCard(result) {
  const statusClass = result.matched === false ? " chem-result-wrong-ratio" : "";
  const card = div("chem-result-card chem-result-" + result.type + statusClass);
  const badge = result.matched === false ? `<div class="chem-result-badge">Wrong ratio</div>` : "";
  if (!result.formula) {
    card.innerHTML = `${badge}<div class="chem-result-name">${result.name}</div><div class="chem-result-note">${result.note}</div>`;
    return card;
  }
  card.innerHTML = `
    ${badge}
    <div class="chem-result-formula">${result.formula}</div>
    <div class="chem-result-name">${result.name}</div>
    <div class="chem-result-tags"><span>${result.type}</span><span>${result.energy}</span></div>
    ${result.structure ? `<div class="chem-result-structure-label">Structural formula</div><div class="chem-result-structure">${result.structure}</div>` : ""}
    <div class="chem-result-note">${result.note}</div>
  `;
  return card;
}

function buildChallengeModal(economy) {
  const el = div("modal hidden");
  el.id = "chem-challenges-modal";
  const box = div("modal-box");
  box.innerHTML = `<h2>Chemistry Challenges</h2><div class="chem-challenge-list"></div>`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => el.classList.add("hidden"));
  box.appendChild(closeBtn);
  el.appendChild(box);
  const list = box.querySelector(".chem-challenge-list");

  function render(lastResult) {
    list.innerHTML = "";
    for (const c of CHEMISTRY_CHALLENGES) {
      const row = div("shop-item");
      const completed = economy.state.completedChallenges.has("chem_" + c.id);
      const info = div("info");
      info.innerHTML = `
        <div class="name">${c.name}${completed ? " ✓" : ""}</div>
        <div class="concept-tag">${c.concept}</div>
        <div class="desc">${c.description}</div>
      `;
      row.appendChild(info);
      const btn = document.createElement("button");
      btn.className = "primary";
      if (completed) {
        btn.textContent = "Done";
        btn.disabled = true;
      } else {
        btn.textContent = "Check";
        btn.addEventListener("click", () => {
          const ok = lastResult && c.check(lastResult);
          if (ok) {
            economy.state.completedChallenges.add("chem_" + c.id);
            render(lastResult);
          } else {
            btn.textContent = "Not yet — try again";
            setTimeout(() => { btn.textContent = "Check"; }, 1600);
          }
        });
      }
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  return {
    el,
    open(lastResult) {
      render(lastResult);
      el.classList.remove("hidden");
    },
  };
}
