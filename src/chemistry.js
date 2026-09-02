import { ELEMENTS, CATEGORY_COLORS, CATEGORY_LABELS, predictReaction, predictWaterReaction, elementBySymbol } from "./chemistryData.js";
import { AtomViewer } from "./atomViewer.js";
import { CHEMISTRY_CHALLENGES } from "./chemistryChallenges.js";

const WATER_SYMBOL = "H2O"; // a synthetic pseudo-element the mixing bench can use

export class ChemistryMode {
  constructor(root, economy) {
    this.root = root;
    this.economy = economy; // { getCoins(), spend(n), award(amount, label), state }
    this.selectedSymbol = "H";
    this.mixA = null;
    this.mixB = null;
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

    this.slotsEl = div("chem-slots");
    this.mixPanel.appendChild(this.slotsEl);

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
    this.atomViewer.showElement(el, CATEGORY_COLORS[el.category]);
    this.elementInfo.innerHTML = "";
    this.elementInfo.appendChild(elementInfoCard(el));
  }

  _addToMix(symbol) {
    if (this.mixA == null) this.mixA = symbol;
    else if (this.mixB == null) this.mixB = symbol;
    else { this.mixA = symbol; this.mixB = null; } // start a fresh pair
    this.resultEl.innerHTML = "";
    this._renderSlots();
  }

  _renderSlots() {
    this.slotsEl.innerHTML = "";
    this.slotsEl.appendChild(mixSlot(this.mixA, () => { this.mixA = null; this._renderSlots(); }));
    const plus = document.createElement("div");
    plus.className = "chem-plus";
    plus.textContent = "+";
    this.slotsEl.appendChild(plus);
    this.slotsEl.appendChild(mixSlot(this.mixB, () => { this.mixB = null; this._renderSlots(); }));
  }

  _react() {
    this.resultEl.innerHTML = "";
    if (!this.mixA || !this.mixB) {
      this.resultEl.appendChild(resultNote("Add two elements to the bench first — click a tile, then \"Add to mixing bench\" (or double-click a tile) twice."));
      return;
    }
    let result;
    if (this.mixA === WATER_SYMBOL || this.mixB === WATER_SYMBOL) {
      const elSym = this.mixA === WATER_SYMBOL ? this.mixB : this.mixA;
      result = predictWaterReaction(elementBySymbol(elSym));
      if (!result) result = { formula: null, name: "No visible reaction", type: "none", energy: "n/a", note: `${elementBySymbol(elSym).name} doesn't react with water under normal conditions.` };
    } else {
      result = predictReaction(elementBySymbol(this.mixA), elementBySymbol(this.mixB));
    }
    this.resultEl.appendChild(resultCard(result));
    this.lastResult = { a: this.mixA, b: this.mixB, result };
    this.root.dispatchEvent(new CustomEvent("chem:reaction", { detail: this.lastResult }));
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

function elementInfoCard(el) {
  const card = div("chem-info-card");
  card.innerHTML = `
    <div class="chem-info-title">${el.name} <span class="chem-info-sym">${el.symbol}</span></div>
    <div class="chem-info-row"><span>Atomic number</span><b>${el.number}</b></div>
    <div class="chem-info-row"><span>Category</span><b>${CATEGORY_LABELS[el.category]}</b></div>
    <div class="chem-info-row"><span>Atomic mass</span><b>${el.mass}</b></div>
    <div class="chem-info-row"><span>Electron shells</span><b>${el.shells.join(", ")}</b></div>
    <div class="chem-info-row"><span>Common oxidation states</span><b>${el.oxidationStates.map((s) => (s > 0 ? "+" + s : s)).join(", ")}</b></div>
  `;
  return card;
}

function mixSlot(symbol, onClear) {
  const slot = div("chem-slot" + (symbol ? " filled" : ""));
  if (!symbol) {
    slot.textContent = "empty";
    return slot;
  }
  if (symbol === WATER_SYMBOL) {
    slot.innerHTML = `<span class="chem-slot-sym">H₂O</span><span class="chem-slot-name">Water</span>`;
  } else {
    const el = elementBySymbol(symbol);
    slot.style.borderColor = CATEGORY_COLORS[el.category];
    slot.innerHTML = `<span class="chem-slot-sym">${el.symbol}</span><span class="chem-slot-name">${el.name}</span>`;
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
  const card = div("chem-result-card chem-result-" + result.type);
  if (!result.formula) {
    card.innerHTML = `<div class="chem-result-name">${result.name}</div><div class="chem-result-note">${result.note}</div>`;
    return card;
  }
  card.innerHTML = `
    <div class="chem-result-formula">${result.formula}</div>
    <div class="chem-result-name">${result.name}</div>
    <div class="chem-result-tags"><span>${result.type}</span><span>${result.energy}</span></div>
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
        <div class="desc">${c.description} Reward: ${c.reward} coins.</div>
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
            economy.award(c.reward, c.id);
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
