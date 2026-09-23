// Two real, checkable models: an energy pyramid where the ~10% rule of
// thumb (each trophic level keeps roughly a tenth of the energy of the one
// below it) is something you compute yourself by dragging a producer
// population, and a food web builder that draws real predator-prey edges
// between whatever organisms you pick — not a static diagram.
import { ORGANISMS, TROPHIC_LEVELS, LEVEL_STYLE, WEB_PRESETS } from "./zoologyData.js";
import { feedingLinks, preyOf, predatorsOf, longestChain, mostConnected, removalEffect } from "./foodWebMath.js";
import { escapeHtml } from "./auth.js";
import { openModelInfo } from "./modelInfo.js";

const SUB_MODES = [
  { id: "pyramid", label: "Food Chains & Pyramids" },
  { id: "web", label: "Food Web Builder" },
];

const PYRAMID_MODEL_INFO = {
  title: "Energy Pyramid",
  concept: "Every trophic level's population is genuinely computed from the producer population you drag, not preset per level — each level up the pyramid keeps exactly 10% of the energy (here, population, as a stand-in for biomass/energy) of the level below it. That real ~10% rule of thumb is why food chains rarely run past 4-5 levels: there simply isn't enough energy left after that many 90% losses to support another level.",
  equation: "Pₙ = P₀ · 0.1ⁿ   (population at trophic level n, from the producer population P₀)",
  variables: [
    { symbol: "P₀", meaning: "producer (e.g. grass) population — the slider you drag" },
    { symbol: "n", meaning: "trophic level, counting up from producers (0) through top predators" },
  ],
  constants: [{ name: "Ecological efficiency", value: "10%", unit: "of energy transferred per level" }],
  assumptions: ["Exactly 10% transfer efficiency at every level — the real figure varies by ecosystem (roughly 5-20% in practice), but 10% is the standard teaching approximation."],
  limitations: ["Population is used as a direct stand-in for energy/biomass — it ignores that different organisms store wildly different amounts of energy per individual."],
  sources: ["The ecological 10% rule (energy transfer efficiency between trophic levels)"],
};
const WEB_MODEL_INFO = {
  title: "Food Web Builder",
  concept: "Predator-prey edges drawn between organisms are real relationships from this app's own organism data (src/zoologyData.js), not a generic template graph — pick a different set of organisms and you get a genuinely different web shape, including isolated nodes if you pick organisms with no predator/prey relationship among the others selected.",
  limitations: ["A static snapshot of who-eats-whom, not a population-dynamics simulation (no predator/prey population oscillation over time, e.g. Lotka-Volterra)."],
  sources: ["Real predator-prey relationships curated per organism"],
};

function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

export class ZoologyMode {
  constructor(root) {
    this.root = root;
    this.sub = "pyramid";
    this.producerPop = 100000;
    this.focus = null;
    this.selected = new Set(["grass", "grasshopper", "rabbit", "frog", "fox", "hawk"]);
    this._build();
  }

  mount() { this._renderSub(); }
  unmount() { this._stopWebSim?.(); }

  _build() {
    this.root.innerHTML = "";
    this.root.className = "econ-root"; // reuses Economics' tab/layout chrome — same shape of mode, no need for parallel CSS

    const title = document.createElement("h1");
    title.className = "econ-title";
    title.textContent = "Zoology";
    this.root.appendChild(title);

    const tabs = div("econ-tabs");
    for (const m of SUB_MODES) {
      const btn = document.createElement("button");
      btn.className = "econ-tab" + (m.id === this.sub ? " active" : "");
      btn.textContent = m.label;
      btn.addEventListener("click", () => { this.sub = m.id; this._renderSub(); });
      btn.dataset.sub = m.id;
      tabs.appendChild(btn);
    }
    const infoBtn = document.createElement("button");
    infoBtn.textContent = "How This Model Works";
    infoBtn.title = "What this simulation actually models";
    infoBtn.style.marginLeft = "8px";
    infoBtn.addEventListener("click", () => openModelInfo(this.sub === "pyramid" ? PYRAMID_MODEL_INFO : WEB_MODEL_INFO));
    tabs.appendChild(infoBtn);
    this.root.appendChild(tabs);

    this.body = div("econ-body");
    this.root.appendChild(this.body);
    this._renderSub();
  }

  _renderSub() {
    this._stopWebSim?.();
    this._stopWebSim = null;
    this.root.querySelectorAll(".econ-tab").forEach((b) => b.classList.toggle("active", b.dataset.sub === this.sub));
    this.body.innerHTML = "";
    if (this.sub === "pyramid") this._renderPyramid();
    else this._renderWeb();
  }

  // ---------- Energy pyramid ----------
  _renderPyramid() {
    const wrap = div("zoo-pyramid-wrap");

    const intro = document.createElement("p");
    intro.className = "econ-intro";
    intro.textContent = "Roughly 90% of the energy at each level is lost as heat, movement, and waste before it ever reaches the next level up — only about 10% transfers on average. That's why apex predators are always rare compared to the plants at the bottom, and why a food chain rarely has more than 4-5 links. Drag the producer population below and watch the levels above it recompute.";
    wrap.appendChild(intro);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "1000"; slider.max = "1000000"; slider.step = "1000";
    slider.value = String(this.producerPop);
    slider.className = "zoo-pyramid-slider";
    wrap.appendChild(slider);

    const pyramidEl = div("zoo-pyramid");
    wrap.appendChild(pyramidEl);

    const draw = () => {
      pyramidEl.innerHTML = "";
      let pop = this.producerPop;
      const widths = [100, 78, 56, 34];
      TROPHIC_LEVELS.forEach((lvl, i) => {
        const row = div("zoo-pyramid-level");
        row.style.width = `${widths[i]}%`;
        row.innerHTML = `<strong>${lvl.name}</strong><span>${Math.round(pop).toLocaleString()} units of energy</span>`;
        row.title = lvl.desc;
        pyramidEl.appendChild(row);
        pop *= 0.1;
      });
    };
    slider.addEventListener("input", () => { this.producerPop = Number(slider.value); draw(); });
    draw();

    const levelNotes = div("zoo-level-notes");
    for (const lvl of TROPHIC_LEVELS) {
      const p = document.createElement("p");
      p.innerHTML = `<strong>${lvl.name}:</strong> ${lvl.desc}`;
      levelNotes.appendChild(p);
    }
    wrap.appendChild(levelNotes);

    this.body.appendChild(wrap);
  }

  // ---------- Food web builder ----------
  _renderWeb() {
    const wrap = div("zoo-web-wrap");
    const byId = new Map(ORGANISMS.map((o) => [o.id, o]));
    const esc = escapeHtml;
    const sel = [...this.selected];
    if (this.focus && !this.selected.has(this.focus)) this.focus = null;

    const intro = document.createElement("p");
    intro.className = "econ-intro";
    intro.textContent = "Build a food web from real predator–prey relationships. Arrows point from predator to prey; every organism you add can connect to the others it eats or is eaten by. Click an organism in the web to see what it eats, what eats it, and what would happen if it disappeared.";
    wrap.appendChild(intro);

    // --- picker sidebar + stage side by side
    const layout = div("zoo-web-layout");
    const side = div("zoo-side");

    const presets = div("zoo-presets");
    presets.innerHTML = `<span class="zoo-side-label">Start from</span>`;
    for (const pr of WEB_PRESETS) {
      const b = document.createElement("button");
      b.textContent = pr.label;
      b.addEventListener("click", () => { this.selected = new Set(pr.ids); this.focus = null; this._renderSub(); });
      presets.appendChild(b);
    }
    const clear = document.createElement("button");
    clear.textContent = "Clear";
    clear.addEventListener("click", () => { this.selected = new Set(); this.focus = null; this._renderSub(); });
    presets.appendChild(clear);
    side.appendChild(presets);

    const groups = [[1, "Producers"], [2, "Primary consumers"], [3, "Secondary consumers"], [4, "Apex consumers"], [0.5, "Recyclers & energy"]];
    for (const [lvl, label] of groups) {
      const members = ORGANISMS.filter((o) => (lvl === 0.5 ? o.level === 0.5 || o.level === 0 : o.level === lvl));
      const g = div("zoo-group");
      g.innerHTML = `<div class="zoo-side-label">${label}</div>`;
      const row = div("zoo-chips");
      for (const org of members) {
        const chip = document.createElement("button");
        const on = this.selected.has(org.id);
        chip.className = "zoo-organism-chip" + (on ? " active" : "");
        chip.style.setProperty("--dot", LEVEL_STYLE[org.level].color);
        chip.textContent = org.name;
        chip.title = org.note;
        chip.setAttribute("aria-pressed", on ? "true" : "false");
        chip.addEventListener("click", () => {
          if (on) this.selected.delete(org.id); else this.selected.add(org.id);
          this._renderSub();
        });
        row.appendChild(chip);
      }
      g.appendChild(row);
      side.appendChild(g);
    }
    layout.appendChild(side);

    // --- main column: stats, stage, legend, detail card
    const main = div("zoo-main");
    const links = feedingLinks(ORGANISMS, sel).filter((l) => l.kind === "food");
    const chain = longestChain(ORGANISMS, sel);
    const hub = mostConnected(ORGANISMS, sel);
    const stats = div("zoo-stats");
    const stat = (n, l) => `<div class="zoo-stat"><b>${n}</b><span>${l}</span></div>`;
    stats.innerHTML = stat(sel.length, "organisms") + stat(links.length, "feeding links") + stat(chain || "–", "longest food chain") + stat(hub ? esc(byId.get(hub.id).name) : "–", hub ? `most connected (${hub.links} links)` : "most connected");
    main.appendChild(stats);

    const stageWrap = div("zoo-web-stage-wrap");
    const stage = div("zoo-web-stage");
    stageWrap.appendChild(stage);
    main.appendChild(stageWrap);

    const legend = div("zoo-legend");
    legend.innerHTML = [1, 2, 3, 4, 0.5].map((l) => `<span><i style="background:${LEVEL_STYLE[l].color}"></i>${LEVEL_STYLE[l].name}</span>`).join("") +
      `<span class="zoo-legend-note">Solid arrow: eats · dashed gold: sunlight · dotted brown: decomposed by</span>`;
    main.appendChild(legend);

    const detail = div("zoo-detail");
    main.appendChild(detail);
    layout.appendChild(main);
    wrap.appendChild(layout);
    this.body.appendChild(wrap);

    this._drawWeb(stage, (id) => { this.focus = this.focus === id ? null : id; this._renderDetail(detail, byId); this._highlight?.(); });
    this._renderDetail(detail, byId);
  }

  _renderDetail(box, byId) {
    const esc = escapeHtml;
    const id = this.focus;
    if (!id || !byId.has(id)) {
      box.innerHTML = `<div class="zoo-detail-empty">${this.selected.size ? "Click an organism in the web for its diet, predators, a fun fact, and what happens if it disappears." : "Pick some organisms on the left, or start from a preset."}</div>`;
      return;
    }
    const org = byId.get(id), sel = [...this.selected];
    const chips = (ids) => ids.length ? ids.map((x) => `<span class="zoo-tag${this.selected.has(x) ? "" : " dim"}" title="${this.selected.has(x) ? "In your web" : "Not in your web yet"}">${esc(byId.get(x).name)}</span>`).join("") : `<span class="zoo-none">nothing here</span>`;
    const eff = removalEffect(ORGANISMS, sel, id);
    const names = (ids) => ids.map((x) => esc(byId.get(x).name)).join(", ");
    const lines = [];
    if (org.level === 0 || org.level === 0.5) lines.push("This one is an energy source or recycler rather than a predator or prey, so removing it isn't modeled as a feeding cascade.");
    else {
      if (eff.starved.length) lines.push(`<b>Would starve</b> (no food left in this web): ${names(eff.starved)}.`);
      if (eff.stressed.length) lines.push(`<b>Lose a food source:</b> ${eff.stressed.map((s) => `${esc(byId.get(s.id).name)} (no more ${names(s.lost).toLowerCase()})`).join("; ")}.`);
      if (eff.boom.length) lines.push(`<b>Could boom</b> (nothing left to eat them): ${names(eff.boom)}.`);
      if (!lines.length) lines.push("Nothing else in this web depends on it — the rest would carry on. Add its predators or prey to see the effects.");
    }
    box.innerHTML = `
      <div class="zoo-detail-head"><i style="background:${LEVEL_STYLE[org.level].color}"></i><h3>${esc(org.name)}</h3><span class="zoo-role">${LEVEL_STYLE[org.level].name}</span></div>
      <p class="zoo-note">${esc(org.note)}</p>
      <div class="zoo-cols">
        <div><div class="zoo-side-label">Eats</div>${chips(org.level === 1 ? [] : preyOf(ORGANISMS, id))}${org.level === 1 ? `<span class="zoo-none">sunlight (makes its own food)</span>` : ""}</div>
        <div><div class="zoo-side-label">Eaten by</div>${chips(predatorsOf(ORGANISMS, id))}</div>
      </div>
      <p class="zoo-fact"><b>Did you know?</b> ${esc(org.fact || "")}</p>
      <div class="zoo-side-label">If it disappeared</div>
      <p class="zoo-effect">${lines.join("<br>")}</p>
      <button class="zoo-remove">Remove ${esc(org.name)} from the web</button>`;
    box.querySelector(".zoo-remove").addEventListener("click", () => { this.selected.delete(id); this.focus = null; this._renderSub(); });
  }

  _drawWeb(stage, onPick) {
    const nodes = ORGANISMS.filter((o) => this.selected.has(o.id)).map((o) => ({ ...o }));
    const links = feedingLinks(ORGANISMS, nodes.map((n) => n.id));
    if (!nodes.length) {
      stage.innerHTML = `<div class="panel-empty">Pick at least one organism on the left.</div>`;
      this._highlight = null;
      return;
    }

    const width = stage.clientWidth || 600, height = 540;
    const R = 26, PAD = R + 8, MIN_SEP = R * 2 + 10;
    const svg = d3.select(stage).append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet")
      .attr("width", "100%").attr("height", height).attr("role", "img").attr("aria-label", "Food web diagram");
    const defs = svg.append("defs");
    for (const [id, col] of [["food", "var(--text-dim)"], ["energy", "#f5b942"], ["decay", "#a0785a"]]) {
      defs.append("marker").attr("id", `zoo-arrow-${id}`).attr("viewBox", "0 -5 10 10").attr("refX", R + 9).attr("refY", 0)
        .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto").append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", col);
    }

    // Trophic bands: producers along the bottom, apex on top — the layout itself teaches the pyramid.
    const bandY = (lvl) => PAD + (1 - (lvl === 0.5 ? 0.5 : lvl) / 4.6) * (height - PAD * 2);
    // Spread each band's organisms evenly across the width so nothing bunches up
    const bands = new Map();
    for (const n of nodes) { const k = n.level === 0 ? 0.5 : n.level; if (!bands.has(k)) bands.set(k, []); bands.get(k).push(n); }
    for (const list of bands.values()) list.forEach((n, i) => { n.tx = PAD + ((i + 0.5) / list.length) * (width - PAD * 2); });
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance(110).strength(0.08))
      .force("charge", d3.forceManyBody().strength(-260))
      .force("x", d3.forceX((d) => d.tx).strength(0.3))
      .force("y", d3.forceY((d) => bandY(d.level)).strength(1))
      .force("collide", d3.forceCollide(R + 10));

    const style = { food: { c: "var(--text-dim)", d: null }, energy: { c: "#f5b942", d: "5 4" }, decay: { c: "#a0785a", d: "2 4" } };
    const link = svg.append("g").selectAll("line").data(links).join("line")
      .attr("stroke", (d) => style[d.kind].c).attr("stroke-width", 1.6).attr("stroke-dasharray", (d) => style[d.kind].d)
      .attr("marker-end", (d) => `url(#zoo-arrow-${d.kind})`).attr("opacity", 0.75);

    const node = svg.append("g").selectAll("g").data(nodes).join("g").attr("class", "zoo-node").attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", (d) => `${d.name}, ${LEVEL_STYLE[d.level].name}`).style("cursor", "pointer")
      .on("click", (e, d) => { if (e.defaultPrevented) return; onPick(d.id); })
      .on("keydown", (e, d) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(d.id); } })
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => {
          let fx = Math.max(PAD, Math.min(width - PAD, e.x)), fy = Math.max(PAD, Math.min(height - PAD, e.y));
          for (const other of nodes) {
            if (other === d) continue;
            const dx = fx - other.x, dy = fy - other.y, dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < MIN_SEP) { const push = MIN_SEP - dist; fx += (dx / dist) * push; fy += (dy / dist) * push; }
          }
          d.fx = Math.max(PAD, Math.min(width - PAD, fx)); d.fy = Math.max(PAD, Math.min(height - PAD, fy));
        })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    node.append("circle").attr("r", R).attr("fill", (d) => LEVEL_STYLE[d.level].color).attr("fill-opacity", 0.22)
      .attr("stroke", (d) => LEVEL_STYLE[d.level].color).attr("stroke-width", 2.5);
    // Name under the circle so long names never overflow it
    node.append("text").attr("text-anchor", "middle").attr("dy", R + 14).attr("font-size", 11.5).attr("font-weight", 600).attr("fill", "var(--text)")
      .attr("paint-order", "stroke").attr("stroke", "var(--panel)").attr("stroke-width", 3).text((d) => d.name);
    node.append("text").attr("text-anchor", "middle").attr("dy", 5).attr("font-size", 15).text((d) => EMOJI[d.id] || "");
    node.append("title").text((d) => `${d.name} — ${d.note}`);

    // Highlight the focused organism, its prey and predators; dim the rest.
    this._highlight = () => {
      const f = this.focus;
      const near = new Set(f ? [f] : []);
      if (f) for (const l of links) { if (l.source.id === f) near.add(l.target.id); if (l.target.id === f) near.add(l.source.id); }
      node.attr("opacity", (d) => (!f || near.has(d.id) ? 1 : 0.28)).select("circle").attr("stroke-width", (d) => (d.id === f ? 5 : 2.5));
      link.attr("opacity", (l) => (!f ? 0.75 : l.source.id === f || l.target.id === f ? 1 : 0.12)).attr("stroke-width", (l) => (f && (l.source.id === f || l.target.id === f) ? 2.6 : 1.6));
    };
    this._highlight();

    sim.on("tick", () => {
      for (const d of nodes) { d.x = Math.max(PAD, Math.min(width - PAD, d.x)); d.y = Math.max(PAD, Math.min(height - PAD - 14, d.y)); }
      link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });
    this._stopWebSim = () => sim.stop();
  }
}

const EMOJI = { sun: "☀️", grass: "🌾", oak: "🌳", algae: "🟢", grasshopper: "🦗", rabbit: "🐇", mouse: "🐁", deer: "🦌", tadpole: "🐛", frog: "🐸", fox: "🦊", snake: "🐍", fish: "🐟", hawk: "🦅", owl: "🦉", wolf: "🐺", decomposer: "🍄" };
