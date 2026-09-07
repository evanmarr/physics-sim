// Two real, hands-on models economists actually use to teach this stuff:
// a linear supply/demand market (with a per-unit tax you can dial in, to
// see deadweight loss as an actual shaded region, not just a term) and a
// repeated Prisoner's Dilemma against a choice of classic strategies, with
// an editable payoff matrix so "why does everyone still defect" is
// something you can go verify yourself instead of taking on faith.
const SUB_MODES = [
  { id: "market", label: "Supply & Demand" },
  { id: "gametheory", label: "Game Theory" },
];

const STRATEGIES = {
  always_cooperate: "Always Cooperates",
  always_defect: "Always Defects",
  tit_for_tat: "Tit-for-Tat (copies your last move)",
  grudger: "Grudger (cooperates until you ever defect, then always defects)",
  random: "Random",
};

export class EconomicsMode {
  constructor(root) {
    this.root = root;
    this.sub = "market";
    this.market = { a: 100, b: 1.2, c: 10, d: 0.8, tax: 0, control: "none", controlPrice: 50 };
    this._resetGame();
    this._build();
  }

  mount() { this._renderSub(); }
  unmount() {}

  _resetGame() {
    this.game = {
      payoff: { cc: [3, 3], cd: [0, 5], dc: [5, 0], dd: [1, 1] },
      strategy: "tit_for_tat",
      history: [], // { you, opp }
      scoreYou: 0,
      scoreOpp: 0,
    };
  }

  _build() {
    this.root.innerHTML = "";
    this.root.className = "econ-root";

    const tabs = document.createElement("div");
    tabs.className = "econ-tabs";
    for (const m of SUB_MODES) {
      const btn = document.createElement("button");
      btn.className = "econ-tab" + (m.id === this.sub ? " active" : "");
      btn.textContent = m.label;
      btn.addEventListener("click", () => {
        this.sub = m.id;
        this.root.querySelectorAll(".econ-tab").forEach((b) => b.classList.toggle("active", b === btn));
        this._renderSub();
      });
      tabs.appendChild(btn);
    }
    this.root.appendChild(tabs);

    this.stage = document.createElement("div");
    this.stage.className = "econ-stage";
    this.root.appendChild(this.stage);
  }

  _renderSub() {
    this.stage.innerHTML = "";
    if (this.sub === "market") this._buildMarket();
    else this._buildGameTheory();
  }

  // ---------- Supply & Demand ----------

  _buildMarket() {
    const wrap = div("econ-market-wrap");
    const sidebar = div("econ-sidebar");
    const m = this.market;

    const slider = (label, key, min, max, step) => {
      const row = div("econ-field");
      const lab = document.createElement("label");
      const valSpan = document.createElement("span");
      valSpan.textContent = m[key];
      lab.textContent = label + " ";
      lab.appendChild(valSpan);
      const input = document.createElement("input");
      input.type = "range";
      input.min = min; input.max = max; input.step = step; input.value = m[key];
      input.addEventListener("input", () => {
        m[key] = parseFloat(input.value);
        valSpan.textContent = m[key];
        draw();
      });
      row.appendChild(lab);
      row.appendChild(input);
      return row;
    };

    sidebar.appendChild(sectionTitle("Demand: P = a − b·Q"));
    sidebar.appendChild(slider("a (choke price)", "a", 20, 200, 1));
    sidebar.appendChild(slider("b (slope)", "b", 0.1, 4, 0.1));
    sidebar.appendChild(sectionTitle("Supply: P = c + d·Q"));
    sidebar.appendChild(slider("c (base cost)", "c", 0, 100, 1));
    sidebar.appendChild(slider("d (slope)", "d", 0.1, 4, 0.1));
    sidebar.appendChild(sectionTitle("Per-unit tax on sellers"));
    sidebar.appendChild(slider("tax", "tax", 0, 60, 1));
    const taxNote = document.createElement("div");
    taxNote.className = "econ-help";
    taxNote.textContent = "A tax shifts the supply curve up by the tax amount — sellers need that much more price to supply the same quantity. The shaded triangle is the deadweight loss: trades that would have happened, and made both sides better off, that the tax wipes out.";
    sidebar.appendChild(taxNote);

    sidebar.appendChild(sectionTitle("Price control"));
    const controlRow = div("econ-field");
    const select = document.createElement("select");
    for (const [v, label] of [["none", "None"], ["ceiling", "Price ceiling (max price)"], ["floor", "Price floor (min price)"]]) {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = label;
      if (v === m.control) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => { m.control = select.value; draw(); });
    controlRow.appendChild(select);
    sidebar.appendChild(controlRow);
    const controlPriceRow = div("econ-field");
    const cpLabel = document.createElement("label");
    const cpVal = document.createElement("span");
    cpVal.textContent = m.controlPrice;
    cpLabel.textContent = "Control price ";
    cpLabel.appendChild(cpVal);
    const cpInput = document.createElement("input");
    cpInput.type = "range"; cpInput.min = 0; cpInput.max = 150; cpInput.step = 1; cpInput.value = m.controlPrice;
    cpInput.addEventListener("input", () => { m.controlPrice = parseFloat(cpInput.value); cpVal.textContent = m.controlPrice; draw(); });
    controlPriceRow.appendChild(cpLabel);
    controlPriceRow.appendChild(cpInput);
    sidebar.appendChild(controlPriceRow);

    this.marketReadout = div("econ-readout");
    sidebar.appendChild(this.marketReadout);

    wrap.appendChild(sidebar);
    const stageEl = div("econ-market-stage");
    const svg = d3.select(stageEl).append("svg").attr("class", "econ-svg");
    wrap.appendChild(stageEl);
    this.stage.appendChild(wrap);

    const draw = () => this._drawMarket(svg, stageEl);
    this._marketResizeObserver?.disconnect();
    this._marketResizeObserver = new ResizeObserver(draw);
    this._marketResizeObserver.observe(stageEl);
    draw();
  }

  _drawMarket(svg, stageEl) {
    const width = stageEl.clientWidth || 500, height = stageEl.clientHeight || 400;
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    const margin = { top: 20, right: 20, bottom: 44, left: 56 };
    const w = width - margin.left - margin.right, h = height - margin.top - margin.bottom;
    const m = this.market;

    // Equilibrium without tax, and with tax (supply shifted up by tax).
    const qNoTax = (m.a - m.c) / (m.b + m.d);
    const pNoTax = m.a - m.b * qNoTax;
    const qTax = Math.max(0, (m.a - m.c - m.tax) / (m.b + m.d));
    const pBuyer = m.a - m.b * qTax; // what buyers pay
    const pSeller = pBuyer - m.tax; // what sellers keep

    const qMax = Math.max(qNoTax, qTax) * 1.4 + 1;
    const pMax = Math.max(m.a, pBuyer) * 1.1 + 1;
    const x = (q) => margin.left + (q / qMax) * w;
    const y = (p) => margin.top + h - (p / pMax) * h;

    const g = svg.append("g");
    // axes
    g.append("line").attr("x1", margin.left).attr("x2", margin.left).attr("y1", margin.top).attr("y2", margin.top + h).attr("class", "econ-axis");
    g.append("line").attr("x1", margin.left).attr("x2", margin.left + w).attr("y1", margin.top + h).attr("y2", margin.top + h).attr("class", "econ-axis");
    g.append("text").attr("x", margin.left + w / 2).attr("y", height - 8).attr("text-anchor", "middle").attr("class", "econ-axis-label").text("Quantity");
    g.append("text").attr("x", 14).attr("y", margin.top + h / 2).attr("text-anchor", "middle").attr("class", "econ-axis-label").attr("transform", `rotate(-90 14 ${margin.top + h / 2})`).text("Price");

    const demandLine = [[0, m.a], [qMax, m.a - m.b * qMax]];
    const supplyLine = [[0, m.c], [qMax, m.c + m.d * qMax]];
    const supplyTaxLine = m.tax > 0 ? [[0, m.c + m.tax], [qMax, m.c + m.tax + m.d * qMax]] : null;
    const line = d3.line().x((p) => x(p[0])).y((p) => y(Math.max(0, p[1])));

    g.append("path").attr("d", line(demandLine)).attr("class", "econ-line econ-demand");
    g.append("path").attr("d", line(supplyLine)).attr("class", "econ-line econ-supply" + (m.tax > 0 ? " econ-supply-faded" : ""));
    if (supplyTaxLine) g.append("path").attr("d", line(supplyTaxLine)).attr("class", "econ-line econ-supply-tax");

    // Deadweight loss triangle: between qTax and qNoTax, bounded by demand and original supply.
    if (m.tax > 0 && qTax < qNoTax) {
      const tri = [[qTax, pBuyer], [qTax, pSeller], [qNoTax, pNoTax]];
      g.append("path").attr("d", "M" + tri.map(([q, p]) => `${x(q)},${y(p)}`).join("L") + "Z").attr("class", "econ-dwl");
    }

    const eqQ = m.tax > 0 ? qTax : qNoTax;
    const eqPBuyer = m.tax > 0 ? pBuyer : pNoTax;
    g.append("line").attr("x1", x(eqQ)).attr("x2", x(eqQ)).attr("y1", y(0)).attr("y2", y(eqPBuyer)).attr("class", "econ-guide");
    g.append("line").attr("x1", x(0)).attr("x2", x(eqQ)).attr("y1", y(eqPBuyer)).attr("y2", y(eqPBuyer)).attr("class", "econ-guide");
    g.append("circle").attr("cx", x(eqQ)).attr("cy", y(eqPBuyer)).attr("r", 5).attr("class", "econ-eq-dot");
    if (m.tax > 0) {
      g.append("circle").attr("cx", x(eqQ)).attr("cy", y(pSeller)).attr("r", 5).attr("class", "econ-eq-dot econ-eq-dot-seller");
    }

    if (m.control !== "none") {
      const cy = y(m.controlPrice);
      g.append("line").attr("x1", margin.left).attr("x2", margin.left + w).attr("y1", cy).attr("y2", cy).attr("class", "econ-control-line");
      g.append("text").attr("x", margin.left + w - 4).attr("y", cy - 6).attr("text-anchor", "end").attr("class", "econ-axis-label").text(m.control === "ceiling" ? "Price ceiling" : "Price floor");
    }

    this._renderMarketReadout(qNoTax, pNoTax, qTax, pBuyer, pSeller);
  }

  _renderMarketReadout(qNoTax, pNoTax, qTax, pBuyer, pSeller) {
    const m = this.market;
    const lines = [];
    if (m.tax > 0) {
      lines.push(`Equilibrium without tax: Q=${qNoTax.toFixed(1)}, P=${pNoTax.toFixed(1)}`);
      lines.push(`With a ${m.tax}-per-unit tax: Q=${qTax.toFixed(1)} — buyers pay ${pBuyer.toFixed(1)}, sellers keep ${pSeller.toFixed(1)} (the gap is the tax).`);
      const dwl = 0.5 * m.tax * Math.max(0, qNoTax - qTax);
      lines.push(`Deadweight loss ≈ ${dwl.toFixed(1)} — value that would've been created by trades the tax now prevents.`);
    } else {
      lines.push(`Equilibrium: Q=${qNoTax.toFixed(1)}, P=${pNoTax.toFixed(1)}`);
    }
    if (m.control === "ceiling") {
      if (m.controlPrice < pNoTax) {
        const qDemanded = (m.a - m.controlPrice) / m.b;
        const qSupplied = Math.max(0, (m.controlPrice - m.c) / m.d);
        lines.push(`Ceiling is below equilibrium: shortage of ${(qDemanded - qSupplied).toFixed(1)} units (buyers want more than sellers will supply at that price).`);
      } else {
        lines.push("Ceiling is above equilibrium, so it isn't actually binding — the market clears normally.");
      }
    } else if (m.control === "floor") {
      if (m.controlPrice > pNoTax) {
        const qDemanded = Math.max(0, (m.a - m.controlPrice) / m.b);
        const qSupplied = (m.controlPrice - m.c) / m.d;
        lines.push(`Floor is above equilibrium: surplus of ${(qSupplied - qDemanded).toFixed(1)} units (sellers want to sell more than buyers will buy at that price).`);
      } else {
        lines.push("Floor is below equilibrium, so it isn't actually binding — the market clears normally.");
      }
    }
    this.marketReadout.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  }

  // ---------- Game Theory ----------

  _buildGameTheory() {
    const wrap = div("econ-game-wrap");
    const sidebar = div("econ-sidebar");

    sidebar.appendChild(sectionTitle("Payoff matrix (your score, opponent's score)"));
    const table = document.createElement("table");
    table.className = "econ-payoff-table";
    table.innerHTML = `<tr><th></th><th>Opp: Cooperate</th><th>Opp: Defect</th></tr>`;
    const rowDef = [["You: Cooperate", "cc", "cd"], ["You: Defect", "dc", "dd"]];
    for (const [label, keyA, keyB] of rowDef) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = label;
      tr.appendChild(th);
      for (const key of [keyA, keyB]) {
        const td = document.createElement("td");
        const you = numberInput(this.game.payoff[key][0], (v) => { this.game.payoff[key][0] = v; });
        const opp = numberInput(this.game.payoff[key][1], (v) => { this.game.payoff[key][1] = v; });
        td.appendChild(you);
        td.appendChild(document.createTextNode(", "));
        td.appendChild(opp);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    sidebar.appendChild(table);

    sidebar.appendChild(sectionTitle("Opponent's strategy"));
    const stratSelect = document.createElement("select");
    for (const [v, label] of Object.entries(STRATEGIES)) {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = label;
      if (v === this.game.strategy) opt.selected = true;
      stratSelect.appendChild(opt);
    }
    stratSelect.addEventListener("change", () => { this.game.strategy = stratSelect.value; });
    sidebar.appendChild(stratSelect);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset game";
    resetBtn.style.marginTop = "10px";
    resetBtn.addEventListener("click", () => { this._resetGame(); this._renderSub(); });
    sidebar.appendChild(resetBtn);

    wrap.appendChild(sidebar);

    const main = div("econ-game-main");
    const scoreRow = div("econ-score-row");
    scoreRow.innerHTML = `<div>Your score: <b>${this.game.scoreYou}</b></div><div>Opponent's score: <b>${this.game.scoreOpp}</b></div>`;
    main.appendChild(scoreRow);

    const moveRow = div("econ-move-row");
    const coopBtn = document.createElement("button");
    coopBtn.className = "primary";
    coopBtn.textContent = "Cooperate";
    coopBtn.addEventListener("click", () => this._playRound("cooperate"));
    const defectBtn = document.createElement("button");
    defectBtn.className = "danger";
    defectBtn.textContent = "Defect";
    defectBtn.addEventListener("click", () => this._playRound("defect"));
    moveRow.appendChild(coopBtn);
    moveRow.appendChild(defectBtn);
    main.appendChild(moveRow);

    const history = div("econ-history");
    this.game.history.forEach((r, i) => {
      const row = div("econ-history-row");
      row.textContent = `Round ${i + 1}: you ${r.you}, opponent ${r.opp} → +${r.youScore} / +${r.oppScore}`;
      history.appendChild(row);
    });
    main.appendChild(history);

    if (this.game.history.length >= 6) {
      const insight = div("econ-help");
      const mutualCoop = this.game.history.filter((r) => r.you === "cooperate" && r.opp === "cooperate").length;
      const mutualDefect = this.game.history.filter((r) => r.you === "defect" && r.opp === "defect").length;
      insight.textContent = mutualDefect > mutualCoop
        ? "Notice how often you both end up defecting, even though mutual cooperation (3,3) beats mutual defection (1,1) for both of you — that's the Prisoner's Dilemma: defecting is each player's individually best move regardless of what the other does, so rational self-interest lands you on a worse outcome than cooperating would have."
        : "You're finding more mutual cooperation than mutual defection — that usually only holds up against a strategy like Tit-for-Tat, which punishes defection immediately, making cooperation the individually rational choice too.";
      main.appendChild(insight);
    }

    wrap.appendChild(main);
    this.stage.appendChild(wrap);
  }

  _playRound(you) {
    const opp = this._opponentMove();
    const key = (you === "cooperate" ? "c" : "d") + (opp === "cooperate" ? "c" : "d");
    const [youScore, oppScore] = this.game.payoff[key];
    this.game.history.push({ you, opp, youScore, oppScore });
    this.game.scoreYou += youScore;
    this.game.scoreOpp += oppScore;
    this._renderSub();
  }

  _opponentMove() {
    const h = this.game.history;
    switch (this.game.strategy) {
      case "always_cooperate": return "cooperate";
      case "always_defect": return "defect";
      case "tit_for_tat": return h.length ? h[h.length - 1].you : "cooperate";
      case "grudger": return h.some((r) => r.you === "defect") ? "defect" : "cooperate";
      case "random": return Math.random() < 0.5 ? "cooperate" : "defect";
      default: return "cooperate";
    }
  }
}

function sectionTitle(text) {
  const d = document.createElement("div");
  d.className = "econ-section-title";
  d.textContent = text;
  return d;
}

function numberInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "econ-payoff-input";
  input.value = value;
  input.addEventListener("input", () => onChange(parseFloat(input.value) || 0));
  return input;
}

function div(className) {
  const d = document.createElement("div");
  d.className = className;
  return d;
}
