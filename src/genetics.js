// Genetics Lab: Punnett squares, a Wright-Fisher population simulator with a
// Hardy-Weinberg calculator, and a Mendelian critter-breeding game. All the
// logic lives in geneticsMath.js (pure and unit-tested); this file is UI.
import * as G from "./geneticsMath.js";
import { escapeHtml } from "./auth.js";
import { openModelInfo } from "./modelInfo.js";

const SUB_MODES = [
  { id: "punnett", label: "Punnett Square" },
  { id: "population", label: "Population Lab" },
  { id: "breeder", label: "Breeder" },
];

const PUNNETT_INFO = {
  title: "Punnett Squares",
  concept: "Each parent makes gametes by putting one of its two alleles into each sex cell at random (Mendel's law of segregation). The grid lists every equally likely gamete pairing, so each cell has the same probability. Ratios and fractions are counted exactly from the grid, not estimated.",
  equation: "P(genotype) = (cells with that genotype) / (total cells)",
  assumptions: ["Each gene is on a different chromosome, so genes are inherited independently (independent assortment); this is what gives 9:3:3:1 in a dihybrid cross.", "Every gamete and every fertilisation is equally likely; no selection against any offspring."],
  limitations: ["Genes close together on the same chromosome are linked and do NOT assort independently, so real dihybrid ratios can differ from 9:3:3:1.", "Most real traits (height, skin colour) are polygenic and environment-dependent; single-gene ratios fit only a minority of traits.", "The simulator draws with a pseudo-random number generator; the chi-square test is unreliable when expected counts are below 5."],
  sources: ["Mendel (1866), pea crosses", "Snapdragon incomplete dominance; roan cattle and MN blood group codominance", "X-linked inheritance of red-green colour blindness and hemophilia A", "Pearson's chi-square goodness-of-fit test"],
};
const POP_INFO = {
  title: "Wright-Fisher Population Model",
  concept: "One gene with two alleles, A and a, in a population of N diploid individuals (2N gene copies). Each generation, the allele frequency is first changed by selection, mutation and migration, then the next generation is formed by randomly drawing 2N copies (binomial sampling), which is genetic drift.",
  equation: "p' = [p²(1+s) + pq(1+hs)] / w̄, then mutation and migration, then Binomial(2N, p') / 2N",
  variables: [
    { symbol: "N", meaning: "number of diploid individuals" }, { symbol: "p", meaning: "frequency of allele A (q = 1 − p)" },
    { symbol: "s", meaning: "selection coefficient: fitness of AA is 1+s, aa is 1" }, { symbol: "h", meaning: "dominance: fitness of Aa is 1+hs" },
    { symbol: "μ", meaning: "mutation rate per allele per generation (both directions)" }, { symbol: "m", meaning: "fraction of each generation that are migrants from a source population" },
  ],
  assumptions: ["Constant population size, discrete non-overlapping generations, random mating, one locus.", "Migrants come from a large source population with fixed allele frequency."],
  limitations: ["No linkage, no population structure, no changing environment, no sex differences. Real populations have an effective size (Ne) smaller than the head count.", "Hardy-Weinberg test assumes a single random-mating population and uses 1 degree of freedom (3 classes, minus 1, minus 1 estimated allele frequency)."],
  sources: ["Fisher (1930), Wright (1931)", "Hardy (1908) and Weinberg (1908)", "Hartl & Clark, Principles of Population Genetics"],
};
const BREEDER_INFO = {
  title: "Breeder Game",
  concept: "Four unlinked genes, each with one dominant and one recessive allele, follow exactly the Punnett rules. A child gets one random allele from each parent for each gene. You see only the phenotype (what the creature looks like) unless you spend a limited sequencing run to reveal its genotype.",
  assumptions: ["Complete dominance at all four genes, independent assortment, equal survival of all offspring."],
  limitations: ["These are invented traits for practice. Real traits are usually polygenic, and genes on the same chromosome are linked, which the game ignores.", "Litters are only 4 kits, so ratios are noisy, just like real small samples."],
  sources: ["Mendel's laws of segregation and independent assortment", "The test cross, a standard genetics technique for revealing a hidden heterozygote"],
};

const PALETTE = ["#4f8ef7", "#f0a83c", "#4fb477", "#e0607e", "#9b6be0", "#3cb8c9", "#c98a4f", "#8a8f98"];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function p(text, cls = "econ-intro") { return el("p", cls, text); }
function button(text, onClick, cls) { const b = el("button", cls, text); b.type = "button"; b.addEventListener("click", onClick); return b; }
const esc = escapeHtml;

export class GeneticsMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.sub = "punnett";
    this.pun = { pattern: "complete", loci: 1, g1: [1, 1], g2: [1, 1], n: 100, sim: null, seed: G.newSeed() };
    this.pop = { N: 50, p: 0.5, s: 0, h: 0.5, mu: 0, m: 0, pm: 0.5, gens: 100, reps: 10, seed: G.newSeed(), lines: null, hw: { p: 0.6, AA: 40, Aa: 40, aa: 20 } };
    this.stable = this._loadStable();
    this.pick = { a: null, b: null };
    this.litter = null;
    this.msg = "";
    this._built = false;
  }

  mount() { if (!this._built) { this._build(); this._built = true; } this._renderSub(); }
  unmount() { /* no timers or global listeners to release */ }

  _build() {
    this.root.innerHTML = "";
    this.root.className = "econ-root";
    this.root.appendChild(el("h1", "econ-title", "Genetics Lab"));
    const tabs = el("div", "econ-tabs");
    for (const m of SUB_MODES) {
      const b = el("button", "econ-tab" + (m.id === this.sub ? " active" : ""), m.label);
      b.dataset.sub = m.id;
      b.addEventListener("click", () => { this.sub = m.id; this._renderSub(); });
      tabs.appendChild(b);
    }
    const info = el("button", "", "How This Model Works");
    info.title = "What this simulation actually models";
    info.style.marginLeft = "8px";
    info.addEventListener("click", () => openModelInfo(this.sub === "punnett" ? PUNNETT_INFO : this.sub === "population" ? POP_INFO : BREEDER_INFO));
    tabs.appendChild(info);
    this.root.appendChild(tabs);
    this.body = el("div", "econ-body");
    this.root.appendChild(this.body);
  }

  _renderSub() {
    this.root.querySelectorAll(".econ-tab").forEach((b) => b.classList.toggle("active", b.dataset.sub === this.sub));
    this.body.innerHTML = "";
    const wrap = el("div", "gen-wrap");
    this.body.appendChild(wrap);
    this.wrap = wrap;
    if (this.sub === "punnett") this._renderPunnett();
    else if (this.sub === "population") this._renderPopulation();
    else this._renderBreeder();
  }

  // ================= Punnett =================
  _renderPunnett() {
    const w = this.wrap, S = this.pun;
    w.appendChild(p("Every parent hands each offspring one of its two alleles, chosen at random. The Punnett square lists all equally likely combinations, so counting cells gives exact probabilities. Pick a pattern, choose the parents, and compare the prediction with a real random sample."));
    const controls = el("div", "gen-controls");
    const pat = G.getPattern(S.pattern);

    const patSel = el("select");
    for (const x of G.PATTERNS) { const o = el("option", "", x.label); o.value = x.id; patSel.appendChild(o); }
    patSel.value = S.pattern;
    patSel.addEventListener("change", () => { S.pattern = patSel.value; if (!G.getPattern(S.pattern).dihybrid) S.loci = 1; S.g1 = [1, 1]; S.g2 = S.pattern === "xlinked" ? [0, 0] : [1, 1]; S.sim = null; this._renderSub(); });
    controls.appendChild(this._field("Inheritance pattern", patSel));

    const lociSel = el("select");
    [[1, "Monohybrid (1 gene)"], [2, "Dihybrid (2 genes)"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = v; if (v === 2 && !pat.dihybrid) o.disabled = true; lociSel.appendChild(o); });
    lociSel.value = String(S.loci);
    lociSel.addEventListener("change", () => { S.loci = +lociSel.value; S.sim = null; this._renderSub(); });
    controls.appendChild(this._field("Cross type", lociSel));
    w.appendChild(controls);
    w.appendChild(p(pat.blurb, "econ-help"));

    const parents = el("div", "gen-controls");
    for (const [role, key, name] of [["parent1", "g1", S.pattern === "xlinked" ? "Mother" : "Parent 1"], ["parent2", "g2", S.pattern === "xlinked" ? "Father" : "Parent 2"]]) {
      for (let i = 0; i < S.loci; i++) {
        const sel = el("select");
        const choices = G.genotypeChoices(S.pattern, i, role);
        choices.forEach((c, idx) => { const o = el("option", "", G.genotypeLabel(S.pattern, i, c) + "  (" + pat.loci[i].pheno(c) + ")"); o.value = idx; sel.appendChild(o); });
        S[key][i] = Math.min(S[key][i], choices.length - 1);
        sel.value = String(S[key][i]);
        sel.addEventListener("change", () => { S[key][i] = +sel.value; S.sim = null; this._updatePunnett(); });
        parents.appendChild(this._field(S.loci > 1 ? `${name}: ${pat.loci[i].name}` : `${name}: ${pat.loci[0].name}`, sel));
      }
    }
    w.appendChild(parents);
    this.punOut = el("div", "gen-out");
    w.appendChild(this.punOut);
    this._updatePunnett();
  }

  _field(label, input) {
    const f = el("label", "gen-field");
    f.appendChild(el("span", "", label));
    f.appendChild(input);
    return f;
  }

  _parents() {
    const S = this.pun;
    const mk = (role, key) => Array.from({ length: S.loci }, (_, i) => G.genotypeChoices(S.pattern, i, role)[S[key][i]]);
    return [mk("parent1", "g1"), mk("parent2", "g2")];
  }

  _updatePunnett() {
    const S = this.pun, out = this.punOut;
    out.innerHTML = "";
    const [par1, par2] = this._parents();
    const r = G.punnett(S.pattern, par1, par2);
    S.result = r;
    const colorOf = new Map(r.phenotypes.map((x, i) => [x.label, PALETTE[i % PALETTE.length]]));
    const pat = G.getPattern(S.pattern);
    const gl = (gam) => gam.map((t, i) => pat.loci[i].tok(t)).join("");

    const scroll = el("div", "gen-scroll");
    const tbl = el("table", "gen-grid");
    const head = el("tr");
    head.appendChild(el("th", "gen-corner", ""));
    for (const c of r.cols) head.appendChild(el("th", "", gl(c)));
    tbl.appendChild(head);
    r.rows.forEach((row, ri) => {
      const tr = el("tr");
      tr.appendChild(el("th", "", gl(row)));
      r.cells[ri].forEach((c) => {
        const td = el("td", "gen-cell", c.display);
        td.style.background = colorOf.get(c.pheno);
        td.title = c.pheno;
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    scroll.appendChild(tbl);
    out.appendChild(scroll);

    const legend = el("div", "gen-legend");
    for (const ph of r.phenotypes) {
      const item = el("span", "gen-legend-item");
      const sw = el("i", "gen-swatch"); sw.style.background = colorOf.get(ph.label);
      item.appendChild(sw); item.appendChild(document.createTextNode(ph.label));
      legend.appendChild(item);
    }
    out.appendChild(legend);

    const ratios = el("div", "gen-ratios");
    ratios.innerHTML = `<div><strong>Genotype ratio</strong> ${esc(r.genoRatio)}</div><div><strong>Phenotype ratio</strong> ${esc(r.phenoRatio)}</div>`;
    out.appendChild(ratios);

    const t2 = el("div", "gen-scroll");
    const rows = (list, kind) => list.map((x) => `<tr><td>${esc(kind === "g" ? x.display : x.label)}</td><td>${G.fmtFraction(x.prob)}</td><td>${G.fmtPercent(x.prob)}</td>${kind === "g" ? `<td>${esc(x.pheno)}</td>` : ""}</tr>`).join("");
    t2.innerHTML = `<table class="gen-table"><thead><tr><th>Genotype</th><th>Fraction</th><th>Percent</th><th>Phenotype</th></tr></thead><tbody>${rows(r.genotypes, "g")}</tbody></table>
      <table class="gen-table"><thead><tr><th>Phenotype</th><th>Fraction</th><th>Percent</th></tr></thead><tbody>${rows(r.phenotypes, "p")}</tbody></table>`;
    out.appendChild(t2);
    const ratioNote = S.pattern === "complete" && S.loci === 2 && r.phenoRatio === "9 : 3 : 3 : 1"
      ? "This is Mendel's classic 9:3:3:1 dihybrid ratio, the signature of two independently assorting genes." : "";
    if (ratioNote) out.appendChild(p(ratioNote, "econ-help"));

    // Simulation
    const sim = el("div", "gen-panel");
    sim.appendChild(el("h3", "gen-h", "Simulate offspring"));
    sim.appendChild(p("Probabilities are what is expected on average. Real litters are random samples, so small numbers wobble around the prediction. Try 20 offspring, then 2000.", "econ-help"));
    const nIn = el("input"); nIn.type = "number"; nIn.min = 1; nIn.max = 100000; nIn.value = S.n;
    nIn.addEventListener("change", () => { S.n = Math.max(1, Math.min(100000, Math.round(+nIn.value) || 100)); nIn.value = S.n; });
    const row = el("div", "gen-row");
    row.appendChild(this._field("Number of offspring", nIn));
    row.appendChild(button("Simulate", () => {
      S.n = Math.max(1, Math.min(100000, Math.round(+nIn.value) || 100));
      S.seed = G.newSeed();
      S.sim = G.simulateOffspring(S.result, S.n, G.mulberry32(S.seed));
      this._showSim(simOut, colorOf);
    }, "gen-primary"));
    sim.appendChild(row);
    const simOut = el("div", "gen-simout");
    sim.appendChild(simOut);
    out.appendChild(sim);

    // Test cross
    const tc = el("div", "gen-panel");
    tc.appendChild(el("h3", "gen-h", "Test-cross helper"));
    if (S.pattern === "complete") {
      tc.appendChild(p("A dominant-looking organism could be homozygous (AA) or heterozygous (Aa). To find out, cross it with a homozygous recessive (aa) tester. If any offspring show the recessive trait, the unknown must be Aa; all-dominant offspring suggest AA (more offspring = more confidence).", "econ-help"));
      const t = G.testCrossTable(S.loci);
      const label = (u) => u.map((g, i) => G.genotypeLabel("complete", i, g)).join(" ");
      tc.insertAdjacentHTML("beforeend", `<div class="gen-scroll"><table class="gen-table"><thead><tr><th>Unknown parent</th><th>Offspring showing the recessive trait</th></tr></thead><tbody>${t.map((x) => `<tr><td>${esc(label(x.unknown))}</td><td>${G.fmtFraction(x.recessiveFraction)} (${G.fmtPercent(x.recessiveFraction)})</td></tr>`).join("")}</tbody></table></div>`);
      tc.appendChild(button("Set Parent 2 to the tester (all recessive)", () => { S.g2 = [2, 2]; S.sim = null; this._renderSub(); }));
    } else {
      tc.appendChild(p("A test cross is only needed under complete dominance, where the phenotype hides the genotype. With incomplete dominance and codominance every genotype has its own look, and for X-linked genes a male's single X shows directly. Switch to complete dominance to use it.", "econ-help"));
    }
    out.appendChild(tc);
  }

  _showSim(box, colorOf) {
    const s = this.pun.sim, r = this.pun.result;
    box.innerHTML = `<div class="gen-scroll"><table class="gen-table"><thead><tr><th>Phenotype</th><th>Expected</th><th>Observed</th></tr></thead><tbody>${r.phenotypes.map((x, i) =>
      `<tr><td>${esc(x.label)}</td><td>${s.expected[i].toFixed(1)}</td><td>${s.observed[i]} (${(100 * s.observed[i] / s.n).toFixed(1)}%)</td></tr>`).join("")}</tbody></table></div>`;
    const bars = el("div", "gen-bars");
    r.phenotypes.forEach((x, i) => {
      const pe = 100 * x.prob.n / x.prob.d, po = 100 * s.observed[i] / s.n;
      const b = el("div", "gen-bar-row");
      b.innerHTML = `<span class="gen-bar-label">${esc(x.label)}</span><span class="gen-bar-track"><span class="gen-bar-obs" style="width:${po}%;background:${colorOf.get(x.label)}"></span><span class="gen-bar-exp" style="left:${pe}%"></span></span>`;
      bars.appendChild(b);
    });
    box.appendChild(bars);
    box.appendChild(p("Bars show observed share; the tick mark is the expected share.", "econ-help"));
    box.appendChild(p(G.explainChiSquare(s.chi), "econ-help"));
  }

  // ================= Population =================
  _slider(parent, label, key, min, max, step, fmt = (v) => v) {
    const P = this.pop;
    const row = el("div", "econ-field");
    const lab = el("label");
    const val = el("span", "", fmt(P[key]));
    lab.appendChild(document.createTextNode(label + " "));
    lab.appendChild(val);
    const inp = el("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = P[key];
    inp.addEventListener("input", () => { P[key] = parseFloat(inp.value); val.textContent = fmt(P[key]); }); // label only; never rebuilds
    row.appendChild(lab); row.appendChild(inp);
    parent.appendChild(row);
    this._sliders[key] = { inp, val, fmt };
  }
  _setSlider(key, v) { const s = this._sliders[key]; this.pop[key] = v; s.inp.value = v; s.val.textContent = s.fmt(v); }

  _renderPopulation() {
    const w = this.wrap, P = this.pop;
    this._sliders = {};
    w.appendChild(p("Follow one gene with two alleles, A and a, through the generations. Each replicate line is an independent population that starts identical. Chance alone (genetic drift) makes lines wander apart, and small populations drift much faster. Set the controls, then press Run."));
    const layout = el("div", "gen-poplayout");
    const side = el("div", "gen-side");
    const f2 = (v) => (+v).toFixed(2), f3 = (v) => (+v).toFixed(3);
    this._slider(side, "Population size N", "N", 5, 1000, 5);
    this._slider(side, "Starting allele frequency p(A)", "p", 0.01, 0.99, 0.01, f2);
    this._slider(side, "Selection s (favours A)", "s", -0.3, 0.5, 0.01, f2);
    this._slider(side, "Dominance h of A", "h", 0, 1, 0.05, f2);
    this._slider(side, "Mutation rate μ", "mu", 0, 0.01, 0.0005, (v) => (+v).toFixed(4));
    this._slider(side, "Migration rate m", "m", 0, 0.2, 0.005, f3);
    this._slider(side, "Source-population p(A)", "pm", 0, 1, 0.05, f2);
    this._slider(side, "Generations", "gens", 20, 500, 10);
    this._slider(side, "Replicate lines", "reps", 1, 20, 1);
    side.appendChild(p("h = 0.5 means the heterozygote is halfway between the homozygotes; h = 0 makes A recessive, h = 1 makes it fully dominant. Migration pulls each line toward the source frequency.", "econ-help"));

    const presets = el("div", "gen-btnrow");
    const preset = (name, vals) => button(name, () => { for (const k in vals) this._setSlider(k, vals[k]); this._run(false); });
    presets.appendChild(preset("Drift only: small N", { N: 20, p: 0.5, s: 0, h: 0.5, mu: 0, m: 0, gens: 100, reps: 12 }));
    presets.appendChild(preset("Drift only: large N", { N: 1000, p: 0.5, s: 0, h: 0.5, mu: 0, m: 0, gens: 100, reps: 12 }));
    presets.appendChild(preset("Selection wins", { N: 500, p: 0.1, s: 0.1, h: 0.5, mu: 0, m: 0, gens: 200, reps: 10 }));
    side.appendChild(presets);

    const runRow = el("div", "gen-btnrow");
    runRow.appendChild(button("Run", () => this._run(true), "gen-primary"));
    runRow.appendChild(button("Re-run (same seed)", () => this._run(false)));
    runRow.appendChild(button("New seed", () => { P.seed = G.newSeed(); this._run(false); }));
    side.appendChild(runRow);
    this.seedLabel = el("div", "econ-help");
    side.appendChild(this.seedLabel);
    layout.appendChild(side);

    const main = el("div", "gen-main");
    this.chartBox = el("div", "gen-chart");
    main.appendChild(this.chartBox);
    this.popSummary = el("div", "gen-panel");
    main.appendChild(this.popSummary);
    main.appendChild(this._hwPanel());
    layout.appendChild(main);
    w.appendChild(layout);
    this._run(false);
  }

  _run() {
    const P = this.pop;
    P.lines = G.runWrightFisher({ N: P.N, p0: P.p, gens: P.gens, reps: P.reps, seed: P.seed, s: P.s, h: P.h, mu: P.mu, m: P.m, pm: P.pm });
    this.seedLabel.textContent = `Seed ${P.seed}. Re-run gives identical lines; New seed reshuffles the dice.`;
    this._drawChart(P.lines, P.gens);
    const sm = G.summarizeLines(P.lines);
    const H = G.expectedHeterozygosity(2 * P.p * (1 - P.p), P.N, P.gens);
    this.popSummary.innerHTML = `<h3 class="gen-h">After ${P.gens} generations</h3>
      <p class="econ-help">${sm.fixed} of ${P.reps} lines fixed for A (p = 1), ${sm.lost} lost A (p = 0), ${sm.segregating} still polymorphic. Mean final p(A) = ${sm.meanFinal.toFixed(3)}.</p>
      <p class="econ-help">With drift alone, expected heterozygosity shrinks by a factor (1 − 1/2N) each generation: from ${(2 * P.p * (1 - P.p)).toFixed(3)} to about ${H.toFixed(3)} here. Fixation is permanent unless mutation or migration brings the allele back.</p>`;
  }

  _drawChart(lines, gens) {
    const W = 640, H = 340, m = { l: 44, r: 12, t: 12, b: 36 };
    const x = (t) => m.l + (t / gens) * (W - m.l - m.r), y = (v) => m.t + (1 - v) * (H - m.t - m.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="gen-svg" role="img" aria-label="Allele frequency of A over generations for each replicate line">`;
    for (let i = 0; i <= 5; i++) { const v = i / 5; s += `<line class="gen-gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="gen-tick" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`; }
    for (let i = 0; i <= 5; i++) { const t = Math.round((gens * i) / 5); s += `<text class="gen-tick" x="${x(t)}" y="${H - m.b + 16}" text-anchor="middle">${t}</text>`; }
    s += `<text class="gen-tick" x="${(W + m.l) / 2}" y="${H - 4}" text-anchor="middle">Generation</text>`;
    s += `<text class="gen-tick" transform="translate(12 ${H / 2}) rotate(-90)" text-anchor="middle">Frequency of allele A</text>`;
    lines.forEach((l, i) => {
      const step = Math.max(1, Math.floor(l.length / 300));
      let d = "";
      for (let t = 0; t < l.length; t += step) d += (d ? "L" : "M") + x(t).toFixed(1) + " " + y(l[t]).toFixed(1);
      d += "L" + x(l.length - 1).toFixed(1) + " " + y(l[l.length - 1]).toFixed(1);
      s += `<path d="${d}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="1.6" opacity="0.85"/>`;
    });
    this.chartBox.innerHTML = s + "</svg>";
  }

  _hwPanel() {
    const box = el("div", "gen-panel");
    const H = this.pop.hw;
    box.appendChild(el("h3", "gen-h", "Hardy-Weinberg calculator"));
    box.appendChild(p("With random mating and no selection, mutation, migration or drift, genotype frequencies settle at p² (AA), 2pq (Aa) and q² (aa) after one generation. Enter an allele frequency for the expected values, or observed genotype counts to test the fit with chi-square.", "econ-help"));
    const out = el("div", "gen-hwout");
    const num = (label, key, min, max, step) => {
      const i = el("input"); i.type = "number"; i.min = min; i.max = max; i.step = step; i.value = H[key];
      i.addEventListener("input", () => { H[key] = parseFloat(i.value); update(); });
      return this._field(label, i);
    };
    const row = el("div", "gen-controls");
    row.appendChild(num("p (frequency of A)", "p", 0, 1, 0.05));
    row.appendChild(num("Observed AA", "AA", 0, 1e6, 1));
    row.appendChild(num("Observed Aa", "Aa", 0, 1e6, 1));
    row.appendChild(num("Observed aa", "aa", 0, 1e6, 1));
    box.appendChild(row); box.appendChild(out);
    const update = () => {
      const pp = Math.min(1, Math.max(0, H.p || 0)), e = G.hweExpected(pp);
      let html = `<p class="econ-help">For p = ${pp.toFixed(2)}, q = ${(1 - pp).toFixed(2)}: p² = <strong>${e.AA.toFixed(3)}</strong>, 2pq = <strong>${e.Aa.toFixed(3)}</strong>, q² = <strong>${e.aa.toFixed(3)}</strong> (sum = 1).</p>`;
      const t = G.hweTest(H.AA || 0, H.Aa || 0, H.aa || 0);
      if (t) {
        html += `<div class="gen-scroll"><table class="gen-table"><thead><tr><th>Genotype</th><th>Observed</th><th>Expected under HWE</th></tr></thead><tbody>${["AA", "Aa", "aa"].map((g, i) => `<tr><td>${g}</td><td>${t.observed[i]}</td><td>${t.expected[i].toFixed(1)}</td></tr>`).join("")}</tbody></table></div>`;
        html += `<p class="econ-help">Estimated p = ${t.p.toFixed(3)} from the counts. Chi-square = ${t.chi2.toFixed(2)} (1 degree of freedom), p-value = ${t.pValue < 0.001 ? "< 0.001" : t.pValue.toFixed(3)}. ${t.fits ? "The counts fit Hardy-Weinberg: no evidence that anything is disturbing this population." : "The counts do NOT fit Hardy-Weinberg. Common causes are non-random mating (inbreeding gives too few heterozygotes), selection, or population mixing."}${t.smallExpected ? " Some expected counts are below 5, so treat this test with caution." : ""}</p>`;
      }
      out.innerHTML = html;
    };
    update();
    return box;
  }

  // ================= Breeder =================
  _loadStable() {
    try { const raw = localStorage.getItem(G.STABLE_KEY); if (raw) return G.sanitizeStable(raw); } catch { /* storage unavailable */ }
    return G.starterStable();
  }
  _save() { try { localStorage.setItem(G.STABLE_KEY, JSON.stringify(this.stable)); } catch { /* ignore */ } }

  _creatureSvg(g, size = 96) {
    const ph = G.phenotypeOf(g);
    const fur = ph.color === "blue" ? "#4f8ef7" : "#f0a83c", dark = ph.color === "blue" ? "#2f5fb8" : "#b9761a";
    let s = `<svg viewBox="0 0 100 90" width="${size}" height="${size * 0.9}" class="gen-critter" role="img" aria-label="${esc(G.describe(g))}">`;
    s += ph.tail === "curly"
      ? `<path d="M80 62 C98 62 98 40 86 42 C80 44 84 52 90 50" fill="none" stroke="${dark}" stroke-width="5" stroke-linecap="round"/>`
      : `<line x1="78" y1="64" x2="98" y2="58" stroke="${dark}" stroke-width="5" stroke-linecap="round"/>`;
    s += ph.ears === "pointy"
      ? `<polygon points="26,34 30,8 44,28" fill="${dark}"/><polygon points="56,28 70,8 74,34" fill="${dark}"/>`
      : `<ellipse cx="26" cy="42" rx="8" ry="16" transform="rotate(18 26 42)" fill="${dark}"/><ellipse cx="74" cy="42" rx="8" ry="16" transform="rotate(-18 74 42)" fill="${dark}"/>`;
    s += `<ellipse cx="50" cy="56" rx="34" ry="26" fill="${fur}"/><circle cx="50" cy="38" r="20" fill="${fur}"/>`;
    if (ph.spots === "spotted") s += `<circle cx="34" cy="64" r="5" fill="#fff" opacity=".85"/><circle cx="62" cy="68" r="4" fill="#fff" opacity=".85"/><circle cx="50" cy="74" r="3.5" fill="#fff" opacity=".85"/><circle cx="66" cy="52" r="3" fill="#fff" opacity=".85"/>`;
    s += `<circle cx="43" cy="37" r="3" fill="#222"/><circle cx="57" cy="37" r="3" fill="#222"/><path d="M45 46 Q50 50 55 46" stroke="#222" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
    return s;
  }

  _card(c, opts = {}) {
    const card = el("div", "gen-card" + (opts.selected ? " selected" : ""));
    card.innerHTML = this._creatureSvg(c.g);
    card.appendChild(el("div", "gen-card-name", c.name || "Kit"));
    card.appendChild(el("div", "gen-card-pheno", G.describe(c.g)));
    card.appendChild(el("div", "gen-card-geno", c.seq ? "Genotype: " + G.genotypeString(c.g).replace(/(..)/g, "$1 ").trim() : "Genotype hidden"));
    const btns = el("div", "gen-btnrow");
    for (const b of opts.buttons || []) btns.appendChild(b);
    card.appendChild(btns);
    return card;
  }

  _renderBreeder() {
    const w = this.wrap, st = this.stable;
    this._checkGoals(); this._save();
    w.appendChild(p("Each creature has four genes with a dominant and a recessive allele: blue (B) over orange (b), pointy ears (E) over floppy (e), curly tail (T) over straight (t), spots (S) over plain (s). You only see phenotypes. A blue creature might be BB or Bb, and that hidden allele can pop up in the next generation. Pick two parents, breed, and keep the useful kits."));
    const goals = el("div", "gen-panel");
    goals.appendChild(el("h3", "gen-h", "Goals"));
    for (const g of G.GOALS) {
      const done = st.goalsDone.includes(g.id);
      const row = el("div", "gen-goal" + (done ? " done" : ""));
      row.appendChild(el("div", "gen-goal-text", (done ? "Done: " : "") + g.text));
      const hint = el("details", "gen-hint");
      hint.appendChild(el("summary", "", "Hint"));
      hint.appendChild(p(g.hint, "econ-help"));
      row.appendChild(hint);
      goals.appendChild(row);
    }
    w.appendChild(goals);

    const bar = el("div", "gen-panel");
    bar.appendChild(el("div", "gen-status", `Sequencing runs left: ${st.seqLeft} of ${G.SEQUENCE_USES}. Litters bred: ${st.bred}. Stable: ${st.creatures.length}/${G.STABLE_MAX}.`));
    if (this.msg) bar.appendChild(el("div", "econ-help", this.msg));
    const parents = el("div", "gen-parents");
    const slot = (key, label) => {
      const c = st.creatures.find((x) => x.id === this.pick[key]);
      const s = el("div", "gen-slot");
      s.appendChild(el("div", "econ-section-title", label));
      s.appendChild(c ? this._card(c) : el("div", "econ-help", "Choose from your stable below."));
      return s;
    };
    parents.appendChild(slot("a", "Parent A")); parents.appendChild(slot("b", "Parent B"));
    bar.appendChild(parents);
    const go = button("Breed a litter of " + G.LITTER_SIZE, () => {
      const a = st.creatures.find((x) => x.id === this.pick.a), b = st.creatures.find((x) => x.id === this.pick.b);
      if (!a || !b) { this.msg = "Pick two parents first (they can be the same creature)."; this._renderSub(); return; }
      this.litter = G.breedLitter(a.g, b.g, G.mulberry32(G.newSeed())).map((g) => ({ g, seq: false, name: "Kit" }));
      st.bred++; this.msg = ""; this._save(); this._renderSub();
    }, "gen-primary");
    bar.appendChild(go);
    w.appendChild(bar);

    if (this.litter) {
      const lit = el("div", "gen-panel");
      lit.appendChild(el("h3", "gen-h", "Litter"));
      lit.appendChild(p("Keep the ones you want; the rest are released. Count the phenotypes: a 3:1 or 1:1 pattern across many litters points to which alleles the parents hide.", "econ-help"));
      const grid = el("div", "gen-cards");
      this.litter.forEach((k, i) => {
        const keep = button("Keep", () => {
          if (st.creatures.length >= G.STABLE_MAX) { this.msg = "Your stable is full. Release someone first."; this._renderSub(); return; }
          st.creatures.push({ id: st.nextId++, g: k.g, seq: k.seq, name: "Kit " + st.nextId, born: true });
          this.litter.splice(i, 1); this._checkGoals(); this._save(); this._renderSub();
        });
        const seq = k.seq ? null : button("Sequence", () => this._sequence(k));
        grid.appendChild(this._card(k, { buttons: [keep, seq].filter(Boolean) }));
      });
      lit.appendChild(grid);
      if (!this.litter.length) lit.appendChild(el("div", "econ-help", "Litter is empty."));
      w.appendChild(lit);
    }

    const stable = el("div", "gen-panel");
    stable.appendChild(el("h3", "gen-h", "Your stable"));
    const grid = el("div", "gen-cards");
    for (const c of st.creatures) {
      const btns = [
        button("As A", () => { this.pick.a = c.id; this._renderSub(); }),
        button("As B", () => { this.pick.b = c.id; this._renderSub(); }),
      ];
      if (!c.seq) btns.push(button("Sequence", () => this._sequence(c)));
      btns.push(button("Release", () => {
        if (st.creatures.length <= 1) { this.msg = "Keep at least one creature."; this._renderSub(); return; }
        st.creatures = st.creatures.filter((x) => x.id !== c.id);
        for (const k of ["a", "b"]) if (this.pick[k] === c.id) this.pick[k] = null;
        this._save(); this._renderSub();
      }));
      grid.appendChild(this._card(c, { selected: this.pick.a === c.id || this.pick.b === c.id, buttons: btns }));
    }
    stable.appendChild(grid);
    stable.appendChild(button("Reset stable and progress", () => {
      this.stable = G.starterStable(); this.pick = { a: null, b: null }; this.litter = null; this.msg = ""; this._save(); this._renderSub();
    }));
    w.appendChild(stable);
    w.appendChild(p("Real-world caveats: real traits are usually polygenic (many genes, plus environment), and genes near each other on a chromosome are linked and are inherited together more often than this game assumes.", "econ-help"));
  }

  _sequence(c) {
    if (this.stable.seqLeft <= 0) { this.msg = "No sequencing runs left. Use a test cross instead: breed with a recessive creature and count the kits."; this._renderSub(); return; }
    this.stable.seqLeft--; c.seq = true; this.msg = ""; this._save(); this._renderSub();
  }

  _checkGoals() {
    const st = this.stable;
    for (const g of G.GOALS) if (!st.goalsDone.includes(g.id) && st.creatures.some((c) => c.born && G.goalMet(g, c.g))) st.goalsDone.push(g.id); // only creatures you BRED count, not the starting stock
  }
}
