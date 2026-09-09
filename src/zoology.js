// Two real, checkable models: an energy pyramid where the ~10% rule of
// thumb (each trophic level keeps roughly a tenth of the energy of the one
// below it) is something you compute yourself by dragging a producer
// population, and a food web builder that draws real predator-prey edges
// between whatever organisms you pick — not a static diagram.
import { ORGANISMS, TROPHIC_LEVELS } from "./zoologyData.js";

const SUB_MODES = [
  { id: "pyramid", label: "Food Chains & Pyramids" },
  { id: "web", label: "Food Web Builder" },
];

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
      tabs.appendChild(btn);
    }
    this.root.appendChild(tabs);

    this.body = div("econ-body");
    this.root.appendChild(this.body);
    this._renderSub();
  }

  _renderSub() {
    this._stopWebSim?.();
    this._stopWebSim = null;
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

    const intro = document.createElement("p");
    intro.className = "econ-intro";
    intro.textContent = "Pick any organisms below — the web automatically draws a real arrow from predator to prey for every eating relationship that exists between organisms you've actually selected (an arrow only appears if both ends are picked). Try removing foxes and watch what mice and rabbits are left connected to.";
    wrap.appendChild(intro);

    const palette = div("zoo-organism-palette");
    for (const org of ORGANISMS) {
      const chip = document.createElement("button");
      chip.className = "zoo-organism-chip" + (this.selected.has(org.id) ? " active" : "");
      chip.textContent = `${org.icon || "🔹"} ${org.name}`;
      chip.title = org.note;
      chip.addEventListener("click", () => {
        if (this.selected.has(org.id)) this.selected.delete(org.id);
        else this.selected.add(org.id);
        this._renderSub();
      });
      palette.appendChild(chip);
    }
    wrap.appendChild(palette);

    const stageWrap = div("zoo-web-stage-wrap");
    const stage = div("zoo-web-stage");
    stageWrap.appendChild(stage);
    wrap.appendChild(stageWrap);

    this.body.appendChild(wrap);
    this._drawWeb(stage);
  }

  _drawWeb(stage) {
    const nodes = ORGANISMS.filter((o) => this.selected.has(o.id)).map((o) => ({ ...o }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = [];
    for (const n of nodes) {
      for (const preyId of n.eats) {
        if (nodeIds.has(preyId)) links.push({ source: n.id, target: preyId });
      }
    }
    if (!nodes.length) {
      stage.innerHTML = `<div class="panel-empty">Pick at least one organism above.</div>`;
      return;
    }

    const width = stage.clientWidth || 600, height = 420;
    const svg = d3.select(stage).append("svg").attr("width", width).attr("height", height);
    svg.append("defs").append("marker")
      .attr("id", "zoo-arrow").attr("viewBox", "0 -5 10 10").attr("refX", 22).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "var(--text-dim)");

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance(110).strength(0.6))
      .force("charge", d3.forceManyBody().strength(-260))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(42));

    const link = svg.append("g").selectAll("line").data(links).join("line")
      .attr("stroke", "var(--text-dim)").attr("stroke-width", 1.5).attr("marker-end", "url(#zoo-arrow)");

    const node = svg.append("g").selectAll("g").data(nodes).join("g").call(
      d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );
    node.append("circle").attr("r", 30).attr("fill", "var(--panel)").attr("stroke", "var(--accent)").attr("stroke-width", 2);
    node.append("text").attr("text-anchor", "middle").attr("dy", "-2px").attr("font-size", "18px").text((d) => d.icon || "🔹");
    node.append("text").attr("text-anchor", "middle").attr("dy", "16px").attr("font-size", "10px").attr("fill", "var(--text)").text((d) => d.name);
    node.append("title").text((d) => d.note);

    sim.on("tick", () => {
      link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });
    this._stopWebSim = () => sim.stop();
  }
}
