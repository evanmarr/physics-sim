// A small but real city-builder: every number below (cost, energy,
// pollution, population, income) is tracked and recomputed live from what's
// actually placed on the grid, not a canned score. Saving progress requires
// an account, same as Physics worlds and Mathematics items — there's
// nowhere else for a guest's save to live.
//
// EDUCATIONAL MODEL, NOT A FORECAST: every figure below is a simplified,
// order-of-magnitude number loosely based on real public data (U.S. EIA
// typical generation/capacity-factor figures and residential/commercial
// energy-use averages, circa 2023-2024) so the RELATIVE comparisons are
// honest and teachable — coal produces the most power per plant but by far
// the most emissions and has a real ongoing fuel cost, solar/wind are free
// to run but genuinely intermittent (day/night, gusty wind, not a flat
// output), storage smooths that out but costs real money and has limited
// capacity. None of this is a real facility's actual spec sheet or a
// prediction about any real city's future — it's a scenario you're
// building this session, scored against itself.
import { openSavesPanel } from "./auth.js";

const GRID_W = 12, GRID_H = 8;
const TICK_MS = 2000;
const DAY_LENGTH_TICKS = 24; // one full day/night cycle, for solar's real intermittency

const BUILDINGS = [
  { id: "residential", name: "Residential", icon: "🏠", cost: 50, energyUse: 5, pollution: 1, population: 20, income: 2, unit: "MWh/yr, tons CO₂e/yr" },
  { id: "commercial", name: "Commercial", icon: "🏬", cost: 80, energyUse: 8, pollution: 2, population: 0, income: 6 },
  { id: "industrial", name: "Industrial", icon: "🏭", cost: 120, energyUse: 15, pollution: 9, population: 0, income: 11 },
  {
    id: "solar", name: "Solar Farm", icon: "☀️", cost: 150, energyProduce: 20, pollution: 0, population: 0, income: 0,
    // Real solar panels don't run at their nameplate rating around the
    // clock — capacityFactor is the honest fraction of nameplate they
    // deliver on average (~25% is a realistic U.S. utility-scale figure),
    // and intermittent:"solar" additionally zeroes them out at night.
    capacityFactor: 0.25, intermittent: "solar",
  },
  {
    id: "wind", name: "Wind Turbine", icon: "💨", cost: 130, energyProduce: 18, pollution: 0, population: 0, income: 0,
    // ~35% capacity factor is realistic for onshore wind; intermittent:
    // "wind" also makes actual output gust tick to tick instead of being
    // a flat line, which is the real reason wind needs backup/storage too.
    capacityFactor: 0.35, intermittent: "wind",
  },
  {
    id: "coal", name: "Coal Plant", icon: "🏗️", cost: 100, energyProduce: 40, pollution: 16, population: 0, income: 0,
    // Baseload: reliably close to nameplate day or night — but that
    // reliability has a real ongoing price real renewables don't: fuel.
    capacityFactor: 0.85, fuelCostPerTick: 4,
  },
  {
    id: "battery", name: "Battery Storage", icon: "🔋", cost: 80, energyUse: 0, pollution: 0, population: 0, income: 0,
    // The actual answer to "solar does nothing at night": store daytime
    // surplus and discharge it during a shortfall, up to this much energy
    // — a real, limited-capacity tradeoff, not an infinite free fix.
    storageCapacity: 25,
  },
  { id: "park", name: "Park", icon: "🌳", cost: 30, energyUse: 0, pollution: -3, population: 0, income: 0 },
  { id: "water", name: "Water Treatment", icon: "💧", cost: 90, energyUse: 6, pollution: -4, population: 0, income: 1 },
];
const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

// A smooth 0..1 daylight curve over one DAY_LENGTH_TICKS cycle — 0 through
// the night half, rising and falling like real daylight through the day
// half, not a hard on/off switch.
function daylightFactor(tick) {
  const phase = (tick % DAY_LENGTH_TICKS) / DAY_LENGTH_TICKS; // 0..1
  const sun = Math.sin(phase * Math.PI * 2 - Math.PI / 2); // -1..1, trough at phase 0 (midnight)
  return Math.max(0, sun);
}

// Wind is gusty in real life, not a flat line — a bounded random walk
// (rather than pure noise) so it wanders smoothly tick to tick instead of
// flickering, staying within a realistic-feeling band around its rating.
function windGustFactor(prev) {
  const wandered = (prev ?? 0.6) + (Math.random() - 0.5) * 0.25;
  return Math.max(0.1, Math.min(1, wandered));
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
    this.windFactor = 0.6;
    this.batteryStored = 0;
    this.lastBrownout = false;
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
    intro.textContent = "Build a city on the grid below by picking a building and clicking a tile — click an occupied tile to bulldoze it for half its cost back. Every number in the dashboard is computed live from exactly what's placed, including real day/night solar and gusty wind output, not a hidden score. This is a simplified educational model (order-of-magnitude figures loosely based on real U.S. energy data) — a scenario to explore, not a forecast for any real city.";
    this.root.appendChild(intro);

    this.body = div("sustain-body");
    this.root.appendChild(this.body);
    this._renderView();

    this._tickInterval = setInterval(() => this._runTick(), TICK_MS);
  }

  _runTick() {
    this.tick++;
    const cap = this._capacity();
    this.windFactor = windGustFactor(this.windFactor);
    const daylight = daylightFactor(this.tick);

    // Delivered energy, not nameplate: solar scales with actual daylight,
    // wind with the live gust factor, coal with its own capacity factor
    // (reliable, but never quite 100% in real plants either).
    let delivered = 0;
    for (const b of this.grid) {
      if (!b) continue;
      const def = BUILDING_BY_ID[b];
      if (!def.energyProduce) continue;
      if (def.intermittent === "solar") delivered += def.energyProduce * def.capacityFactor * daylight * 2;
      else if (def.intermittent === "wind") delivered += def.energyProduce * def.capacityFactor * this.windFactor * 1.6;
      else delivered += def.energyProduce * (def.capacityFactor ?? 1);
    }

    let shortfall = cap.energyUse - delivered;
    if (shortfall > 0 && this.batteryStored > 0) {
      const drawn = Math.min(shortfall, this.batteryStored);
      this.batteryStored -= drawn;
      shortfall -= drawn;
    } else if (shortfall < 0) {
      // Surplus renewable generation charges the battery instead of just
      // being wasted — up to whatever storage capacity is actually built.
      this.batteryStored = Math.min(cap.storageCapacity, this.batteryStored - shortfall);
    }
    const energyOk = shortfall <= 0.001;
    this.lastBrownout = !energyOk;

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
    // going out. Coal's fuel cost is a real ongoing expense on top of its
    // upfront build cost — the tradeoff for being the one source that
    // doesn't care what time it is or how hard the wind is blowing.
    const income = (energyOk ? cap.income : cap.income * 0.5) - cap.fuelCost;
    this.budget += income;
    this._updateDashboard();
  }

  // Structural/nameplate numbers the grid supports — capacity, not live
  // delivery (see _runTick for the actual day/night + gust + battery
  // simulation). Used for the dashboard's design-time numbers and tooltips.
  _capacity() {
    let energyUse = 0, energyProduce = 0, pollutionRate = 0, populationCapacity = 0, income = 0, fuelCost = 0, storageCapacity = 0;
    for (const b of this.grid) {
      if (!b) continue;
      const def = BUILDING_BY_ID[b];
      energyUse += def.energyUse || 0;
      energyProduce += def.energyProduce || 0;
      pollutionRate += def.pollution || 0;
      populationCapacity += def.population || 0;
      income += def.income || 0;
      fuelCost += def.fuelCostPerTick || 0;
      storageCapacity += def.storageCapacity || 0;
    }
    const renewableEnergy = this.grid.filter((b) => b === "solar" || b === "wind").reduce((sum, b) => sum + BUILDING_BY_ID[b].energyProduce, 0);
    const renewableShare = energyProduce > 0 ? Math.round((renewableEnergy / energyProduce) * 100) : 0;
    return { energyUse, energyProduce, pollutionRate, populationCapacity, income, renewableShare, fuelCost, storageCapacity };
  }

  _stats() {
    const cap = this._capacity();
    // Same transparent composite as before, but now scored against the
    // city's actual lived-in population/pollution rather than its instant
    // grid capacity — a city that just built a coal plant this tick hasn't
    // suffered the smog for it yet, and shouldn't be scored as if it had.
    // A live snapshot of THIS run, not a forecast — see the intro copy.
    const fillRate = cap.populationCapacity > 0 ? this.population / cap.populationCapacity : 1;
    const score = Math.max(0, Math.min(100, Math.round(
      (this.lastBrownout ? 5 : 30) + cap.renewableShare * 0.3 + Math.max(0, 25 - this.pollutionLevel * 0.5) + fillRate * 15
    )));
    return { ...cap, population: this.population, pollution: Math.round(this.pollutionLevel), score };
  }

  _renderView() {
    this.body.innerHTML = "";

    const palette = div("sustain-palette");
    for (const b of BUILDINGS) {
      const chip = document.createElement("button");
      chip.className = "sustain-chip" + (this.armed === b.id ? " active" : "");
      chip.innerHTML = `<span>${b.icon}</span><span>${b.name}</span><span class="sustain-chip-cost">$${b.cost}k</span>`;
      chip.title = [
        b.energyProduce ? `Nameplate ${b.energyProduce} MWh/yr${b.capacityFactor ? ` (~${Math.round(b.capacityFactor * 100)}% capacity factor)` : ""}` : (b.energyUse ? `Uses ${b.energyUse} MWh/yr` : null),
        b.intermittent === "solar" ? "Zero output at night — real solar intermittency" : null,
        b.intermittent === "wind" ? "Output gusts up and down with a live wind factor" : null,
        b.fuelCostPerTick ? `Fuel cost: $${b.fuelCostPerTick}k/tick, ongoing` : null,
        b.storageCapacity ? `Stores up to ${b.storageCapacity} MWh of surplus for later` : null,
        `Pollution: ${b.pollution >= 0 ? "+" : ""}${b.pollution} tons CO₂e/yr`,
        b.population ? `Houses ${b.population} people` : null,
        b.income ? `Income: +$${b.income}k/tick` : null,
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
      warn.textContent = `Not enough budget for a ${def.name} (needs $${def.cost}k).`;
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
    const hour = this.tick % DAY_LENGTH_TICKS;
    const isNight = daylightFactor(this.tick) <= 0.01;
    this.dashboard.innerHTML = `
      <div class="sustain-stat"><span>Budget</span><strong>$${Math.round(this.budget).toLocaleString()}k</strong>${s.fuelCost ? `<div class="sustain-stat-note">Coal fuel cost: -$${s.fuelCost}k/tick, on top of what it cost to build.</div>` : ""}</div>
      <div class="sustain-stat"><span>Population</span><strong>${Math.round(s.population).toLocaleString()} / ${s.populationCapacity.toLocaleString()}</strong>
        ${this.pollutionLevel > 40 ? "<div class=\"sustain-stat-note\">Smog is bad enough that people are actually leaving.</div>" : (!this.lastBrownout && s.population < s.populationCapacity ? "<div class=\"sustain-stat-note\">Moving in gradually toward capacity.</div>" : "")}
      </div>
      <div class="sustain-stat ${this.lastBrownout ? "sustain-stat-bad" : ""}">
        <span>Energy (this tick)</span><strong>${s.energyUse} MWh/yr used, ${isNight ? "night" : `hour ${hour}/${DAY_LENGTH_TICKS}`}</strong>
        ${this.lastBrownout ? "<div class=\"sustain-stat-note\">Brownout — solar/wind output and battery reserves couldn't cover demand this tick. Growth has stalled and commercial/industrial income is halved.</div>" : "<div class=\"sustain-stat-note\">Demand covered — including by battery discharge, if any was needed.</div>"}
      </div>
      <div class="sustain-stat"><span>Battery reserve</span><strong>${this.batteryStored.toFixed(1)} / ${s.storageCapacity} MWh</strong></div>
      <div class="sustain-stat"><span>Renewable share (nameplate)</span><strong>${s.renewableShare}%</strong></div>
      <div class="sustain-stat ${s.pollution > 20 ? "sustain-stat-bad" : ""}"><span>Pollution (accumulated)</span><strong>${s.pollution} tons CO₂e</strong></div>
      <div class="sustain-stat"><span>Sustainability score</span><strong>${s.score} / 100</strong></div>
      <div class="sustain-stat-note">Score = 30 pts for meeting THIS tick's energy demand (5 if not) + up to 30 for renewable nameplate share + up to 25 for low accumulated pollution + up to 15 for filled housing capacity. A live snapshot of this run, not a forecast — see the intro above.</div>
      <div class="sustain-stat-note">Figures are simplified, order-of-magnitude estimates loosely based on real U.S. generation capacity-factor and typical energy-use data (EIA-style, circa 2023-2024) — illustrative for comparing tradeoffs, not exact facility specs or a real emissions/cost prediction.</div>
    `;
  }

  _openSaves() {
    openSavesPanel({
      kind: "cities",
      title: "My Cities",
      itemNoun: "city",
      max: 3,
      serialize: () => ({ grid: this.grid, budget: this.budget, population: this.population, pollutionLevel: this.pollutionLevel, tick: this.tick, batteryStored: this.batteryStored }),
      apply: (data) => {
        this.grid = data.grid || new Array(GRID_W * GRID_H).fill(null);
        this.budget = data.budget ?? 500;
        this.population = data.population ?? 0;
        this.pollutionLevel = data.pollutionLevel ?? 0;
        this.tick = data.tick ?? 0;
        this.batteryStored = data.batteryStored ?? 0;
        this._renderView();
      },
    });
  }
}
