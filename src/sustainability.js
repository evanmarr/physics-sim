// A small but real city-builder: every number below (cost, energy, pollution,
// population, income) is tracked and recomputed live from what's actually
// placed on the grid, not a canned score. Saving progress requires an
// account, same as Physics worlds and Mathematics items — there's nowhere
// else for a guest's save to live.
import { openSavesPanel } from "./auth.js";

const GRID_W = 12, GRID_H = 8;

// Deliberately simple, illustrative numbers (not real-world engineering
// figures) chosen so the RELATIVE comparisons are honest and teachable:
// coal produces the most energy per building but by far the most
// pollution; renewables produce less each but at zero pollution; parks and
// water treatment actively reduce pollution instead of just avoiding it.
const BUILDINGS = [
  { id: "residential", name: "Residential", icon: "🏠", cost: 50, energyUse: 5, pollution: 1, population: 20, income: 2 },
  { id: "commercial", name: "Commercial", icon: "🏬", cost: 80, energyUse: 8, pollution: 2, population: 0, income: 6 },
  { id: "industrial", name: "Industrial", icon: "🏭", cost: 120, energyUse: 15, pollution: 9, population: 0, income: 11 },
  { id: "solar", name: "Solar Farm", icon: "☀️", cost: 150, energyProduce: 20, pollution: 0, population: 0, income: 0 },
  { id: "wind", name: "Wind Turbine", icon: "💨", cost: 130, energyProduce: 16, pollution: 0, population: 0, income: 0 },
  { id: "coal", name: "Coal Plant", icon: "🏗️", cost: 100, energyProduce: 40, pollution: 16, population: 0, income: 0 },
  { id: "park", name: "Park", icon: "🌳", cost: 30, energyUse: 0, pollution: -3, population: 0, income: 0 },
  { id: "water", name: "Water Treatment", icon: "💧", cost: 90, energyUse: 6, pollution: -4, population: 0, income: 1 },
];
const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

export class SustainabilityMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx || {};
    this._newCity();
    this._build();
  }

  mount() { this._renderView(); }
  unmount() { this._tickInterval && clearInterval(this._tickInterval); this._tickInterval = null; }

  _newCity() {
    this.grid = new Array(GRID_W * GRID_H).fill(null);
    this.budget = 500;
    this.armed = null;
    this.tick = 0;
    // Population and pollution are no longer instant recomputes of the grid
    // — a real city doesn't teleport to its capacity the moment you place a
    // house, and smog doesn't vanish the instant you stop producing it.
    // Both evolve tick by tick in _runTick toward/away from what the grid
    // currently supports.
    this.population = 0;
    this.pollutionLevel = 0;
  }

  _build() {
    this.root.innerHTML = "";
    this.root.className = "econ-root";

    const title = document.createElement("h1");
    title.className = "econ-title";
    title.textContent = "Sustainability";
    this.root.appendChild(title);

    const intro = document.createElement("p");
    intro.className = "econ-intro";
    intro.style.padding = "0 20px";
    intro.textContent = "Build a city on the grid below by picking a building and clicking a tile — click an occupied tile to bulldoze it for half its cost back. Every number in the dashboard (energy, pollution, population, budget) is computed live from exactly what's placed, not a hidden score.";
    this.root.appendChild(intro);

    this.body = div("sustain-body");
    this.root.appendChild(this.body);
    this._renderView();

    this._tickInterval = setInterval(() => this._runTick(), 2000);
  }

  _runTick() {
    this.tick++;
    const cap = this._capacity();
    const energyOk = cap.energyProduce >= cap.energyUse;

    // Pollution accumulates instead of being read straight off the grid: a
    // net-polluting city keeps building up smog tick after tick, and a
    // net-clean one (parks/water treatment outweighing the rest) only
    // slowly clears what's already in the air — matching how a real
    // pollution problem lingers well after its source is capped.
    if (cap.pollutionRate > 0) this.pollutionLevel += cap.pollutionRate * 0.5;
    else this.pollutionLevel *= 0.92;
    this.pollutionLevel = Math.max(0, this.pollutionLevel);

    // Population chases housing capacity rather than snapping to it —
    // growth stalls under a brownout (no power for new residents) and
    // reverses into emigration once pollution gets bad enough that people
    // actually leave, not just "stop moving in."
    const smogDrivesPeopleAway = this.pollutionLevel > 40;
    if (smogDrivesPeopleAway) {
      this.population *= 0.96;
    } else if (energyOk) {
      this.population += (cap.populationCapacity - this.population) * 0.15;
    }
    this.population = Math.max(0, Math.min(cap.populationCapacity, this.population));

    // A brownout doesn't just warn you — commercial and industrial income
    // actually depends on having power to run on, so it's halved whenever
    // demand outstrips supply, same as the lights (and registers) actually
    // going out.
    const income = energyOk ? cap.income : cap.income * 0.5;
    this.budget += income;
    this._updateDashboard();
  }

  // Structural numbers the grid supports RIGHT NOW — what _runTick uses
  // each tick to pull population/pollution toward. Renamed from the old
  // _stats to make clear these are capacities/rates, not the city's actual
  // current population or pollution (see this.population/this.pollutionLevel).
  _capacity() {
    let energyUse = 0, energyProduce = 0, pollutionRate = 0, populationCapacity = 0, income = 0;
    for (const b of this.grid) {
      if (!b) continue;
      const def = BUILDING_BY_ID[b];
      energyUse += def.energyUse || 0;
      energyProduce += def.energyProduce || 0;
      pollutionRate += def.pollution || 0;
      populationCapacity += def.population || 0;
      income += def.income || 0;
    }
    const renewableEnergy = this.grid.filter((b) => b === "solar" || b === "wind").reduce((sum, b) => sum + BUILDING_BY_ID[b].energyProduce, 0);
    const renewableShare = energyProduce > 0 ? Math.round((renewableEnergy / energyProduce) * 100) : 0;
    return { energyUse, energyProduce, pollutionRate, populationCapacity, income, renewableShare };
  }

  _stats() {
    const cap = this._capacity();
    const energyMet = cap.energyProduce >= cap.energyUse;
    // Same transparent composite as before, but now scored against the
    // city's actual lived-in population/pollution rather than its instant
    // grid capacity — a city that just built a coal plant this tick hasn't
    // suffered the smog for it yet, and shouldn't be scored as if it had.
    const fillRate = cap.populationCapacity > 0 ? this.population / cap.populationCapacity : 1;
    const score = Math.max(0, Math.min(100, Math.round(
      (energyMet ? 30 : 5) + cap.renewableShare * 0.3 + Math.max(0, 25 - this.pollutionLevel * 0.5) + fillRate * 15
    )));
    return { ...cap, population: this.population, pollution: Math.round(this.pollutionLevel), score };
  }

  _renderView() {
    this.body.innerHTML = "";

    const palette = div("sustain-palette");
    for (const b of BUILDINGS) {
      const chip = document.createElement("button");
      chip.className = "sustain-chip" + (this.armed === b.id ? " active" : "");
      chip.innerHTML = `<span>${b.icon}</span><span>${b.name}</span><span class="sustain-chip-cost">$${b.cost}</span>`;
      chip.title = [
        b.energyProduce ? `Produces ${b.energyProduce} energy` : `Uses ${b.energyUse} energy`,
        `Pollution: ${b.pollution >= 0 ? "+" : ""}${b.pollution}`,
        b.population ? `Houses ${b.population} people` : null,
        b.income ? `Income: +$${b.income}/tick` : null,
      ].filter(Boolean).join(" · ");
      chip.addEventListener("click", () => { this.armed = this.armed === b.id ? null : b.id; this._renderView(); });
      palette.appendChild(chip);
    }
    this.body.appendChild(palette);

    const layout = div("sustain-layout");
    const gridEl = div("sustain-grid");
    gridEl.style.gridTemplateColumns = `repeat(${GRID_W}, 1fr)`;
    for (let i = 0; i < this.grid.length; i++) {
      const cell = document.createElement("button");
      cell.className = "sustain-cell";
      const occupied = this.grid[i];
      if (occupied) {
        const def = BUILDING_BY_ID[occupied];
        cell.textContent = def.icon;
        cell.title = def.name;
      }
      cell.addEventListener("click", () => this._clickCell(i));
      gridEl.appendChild(cell);
    }
    layout.appendChild(gridEl);

    this.dashboard = div("sustain-dashboard");
    layout.appendChild(this.dashboard);
    this.body.appendChild(layout);

    const actions = div("sustain-actions");
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save progress";
    saveBtn.addEventListener("click", () => this._openSaves());
    actions.appendChild(saveBtn);
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "New city";
    resetBtn.addEventListener("click", async () => {
      const { confirmPopup } = await import("./popup.js");
      if (await confirmPopup("Start a new city? Unsaved progress will be lost.", { title: "New city", confirmLabel: "Start over", danger: true })) {
        this._newCity();
        this._renderView();
      }
    });
    actions.appendChild(resetBtn);
    this.body.appendChild(actions);

    this._updateDashboard();
  }

  _clickCell(i) {
    const cellEls = this.body.querySelectorAll(".sustain-cell");
    if (this.grid[i]) {
      // Bulldoze — refund half the original cost, a standard city-builder
      // convention (never a full refund, or building+demolishing would be
      // a free way to reshuffle the grid).
      const def = BUILDING_BY_ID[this.grid[i]];
      this.budget += Math.round(def.cost / 2);
      this.grid[i] = null;
      cellEls[i].textContent = "";
      cellEls[i].title = "";
      this._updateDashboard();
      return;
    }
    if (!this.armed) return;
    const def = BUILDING_BY_ID[this.armed];
    if (this.budget < def.cost) {
      this.dashboard.querySelector(".sustain-warning")?.remove();
      const warn = div("sustain-warning");
      warn.textContent = `Not enough budget for a ${def.name} (needs $${def.cost}).`;
      this.dashboard.prepend(warn);
      return;
    }
    this.budget -= def.cost;
    this.grid[i] = this.armed;
    cellEls[i].textContent = def.icon;
    cellEls[i].title = def.name;
    this._updateDashboard();
  }

  _updateDashboard() {
    if (!this.dashboard) return;
    const s = this._stats();
    const energyOk = s.energyProduce >= s.energyUse;
    this.dashboard.innerHTML = `
      <div class="sustain-stat"><span>Budget</span><strong>$${Math.round(this.budget).toLocaleString()}</strong></div>
      <div class="sustain-stat"><span>Population</span><strong>${Math.round(s.population).toLocaleString()} / ${s.populationCapacity.toLocaleString()}</strong>
        ${this.pollutionLevel > 40 ? "<div class=\"sustain-stat-note\">Smog is bad enough that people are actually leaving.</div>" : (energyOk && s.population < s.populationCapacity ? "<div class=\"sustain-stat-note\">Moving in gradually toward capacity.</div>" : "")}
      </div>
      <div class="sustain-stat ${energyOk ? "" : "sustain-stat-bad"}">
        <span>Energy</span><strong>${s.energyProduce} / ${s.energyUse} produced/used</strong>
        ${energyOk ? "" : "<div class=\"sustain-stat-note\">Brownouts — growth has stalled and commercial/industrial income is halved until power catches up.</div>"}
      </div>
      <div class="sustain-stat"><span>Renewable share</span><strong>${s.renewableShare}%</strong></div>
      <div class="sustain-stat ${s.pollution > 20 ? "sustain-stat-bad" : ""}"><span>Pollution (accumulated)</span><strong>${s.pollution}</strong></div>
      <div class="sustain-stat"><span>Sustainability score</span><strong>${s.score} / 100</strong></div>
      <div class="sustain-stat-note">Score = 30 pts for meeting energy demand (5 if not) + up to 30 for renewable share + up to 25 for low accumulated pollution + up to 15 for filled housing capacity.</div>
    `;
  }

  _openSaves() {
    openSavesPanel({
      kind: "cities",
      title: "My Cities",
      itemNoun: "city",
      max: 3,
      serialize: () => ({ grid: this.grid, budget: this.budget, population: this.population, pollutionLevel: this.pollutionLevel }),
      apply: (data) => {
        this.grid = data.grid || new Array(GRID_W * GRID_H).fill(null);
        this.budget = data.budget ?? 500;
        this.population = data.population ?? 0;
        this.pollutionLevel = data.pollutionLevel ?? 0;
        this._renderView();
      },
    });
  }
}
