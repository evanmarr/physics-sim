import { materialOf } from "./materials.js";
import { WORLD, GRID_SIZE, snap } from "./world.js";
import { cannonCatchRadius } from "./objectTypes.js";

const RAD = Math.PI / 180;

export class Renderer {
  constructor(svgEl, handlers) {
    this.svg = d3.select(svgEl);
    this.handlers = handlers; // { onSelect, onMove, onRotate, getSelectedId, isEditable }
    this.zoomTransform = d3.zoomIdentity;
    this._buildSkeleton();
  }

  _buildSkeleton() {
    const svg = this.svg;
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    defs.append("pattern")
      .attr("id", "grid-minor")
      .attr("width", GRID_SIZE).attr("height", GRID_SIZE)
      .attr("patternUnits", "userSpaceOnUse")
      .append("path")
      .attr("d", `M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`)
      .attr("fill", "none").attr("stroke", "var(--grid-minor)").attr("stroke-width", 1);

    defs.append("pattern")
      .attr("id", "grid-major")
      .attr("width", GRID_SIZE * 4).attr("height", GRID_SIZE * 4)
      .attr("patternUnits", "userSpaceOnUse")
      .append("path")
      .attr("d", `M ${GRID_SIZE * 4} 0 L 0 0 0 ${GRID_SIZE * 4}`)
      .attr("fill", "none").attr("stroke", "var(--grid-major)").attr("stroke-width", 1.2);

    this.viewport = svg.append("g").attr("class", "viewport");

    this.viewport.append("rect")
      .attr("class", "grid-bg")
      .attr("x", WORLD.minX).attr("y", WORLD.minY)
      .attr("width", WORLD.maxX - WORLD.minX)
      .attr("height", WORLD.maxY - WORLD.minY);
    this.viewport.append("rect")
      .attr("x", WORLD.minX).attr("y", WORLD.minY)
      .attr("width", WORLD.maxX - WORLD.minX)
      .attr("height", WORLD.maxY - WORLD.minY)
      .attr("fill", "url(#grid-minor)");
    this.viewport.append("rect")
      .attr("x", WORLD.minX).attr("y", WORLD.minY)
      .attr("width", WORLD.maxX - WORLD.minX)
      .attr("height", WORLD.maxY - WORLD.minY)
      .attr("fill", "url(#grid-major)");
    this.viewport.append("rect")
      .attr("class", "world-border")
      .attr("x", WORLD.minX).attr("y", WORLD.minY)
      .attr("width", WORLD.maxX - WORLD.minX)
      .attr("height", WORLD.maxY - WORLD.minY)
      .attr("fill", "none").attr("stroke", "#454c5a").attr("stroke-width", 3);

    this.objectLayer = this.viewport.append("g").attr("class", "object-layer");

    svg.on("click", (event) => {
      if (event.target === svg.node() || event.target.classList?.contains("grid-bg")) {
        this.handlers.onSelect(null);
      }
    });

    this.zoom = d3.zoom()
      .scaleExtent([0.25, 2.5])
      .translateExtent([[WORLD.minX - 200, WORLD.minY - 200], [WORLD.maxX + 200, WORLD.maxY + 200]])
      .filter((event) => {
        // allow wheel + drag-pan on background, but not while dragging an object
        if (event.type === "wheel") return true;
        return !event.target.closest(".world-object") && !event.target.closest(".rotate-handle");
      })
      .on("zoom", (event) => {
        this.zoomTransform = event.transform;
        this.viewport.attr("transform", event.transform);
      });

    svg.call(this.zoom);
  }

  // A one-off, non-physics visual burst — a flash, an expanding ring, and a
  // handful of glinting shards — for effects like glass shattering. Lives
  // entirely on its own timer via d3 transitions, decoupled from the physics
  // render loop, and removes itself when done.
  burst(x, y, radius = 60) {
    const g = this.objectLayer.append("g").attr("class", "burst-fx").attr("transform", `translate(${x},${y})`);

    g.append("circle")
      .attr("r", radius * 0.5).attr("fill", "#eaf7fb").attr("opacity", 0.6)
      .transition().duration(220).ease(d3.easeCubicOut)
      .attr("r", radius * 0.9).attr("opacity", 0).remove();

    g.append("circle")
      .attr("r", radius * 0.3).attr("fill", "none").attr("stroke", "#bfe6f2").attr("stroke-width", 3).attr("opacity", 0.9)
      .transition().duration(450).ease(d3.easeCubicOut)
      .attr("r", radius * 1.8).attr("stroke-width", 0.5).attr("opacity", 0).remove();

    const glints = 8;
    for (let i = 0; i < glints; i++) {
      const angle = (i / glints) * Math.PI * 2 + Math.random() * 0.6;
      const dist = radius * (0.9 + Math.random() * 0.9);
      g.append("line")
        .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 0)
        .attr("stroke", "#eaf7fb").attr("stroke-width", 2).attr("stroke-linecap", "round").attr("opacity", 0.95)
        .transition().duration(280 + Math.random() * 180).ease(d3.easeCubicOut)
        .attr("x2", Math.cos(angle) * dist).attr("y2", Math.sin(angle) * dist)
        .attr("opacity", 0);
    }

    g.transition().delay(500).remove();
  }

  centerOn(worldX, worldY, scale) {
    const rect = this.svg.node().getBoundingClientRect();
    const t = d3.zoomIdentity
      .translate(rect.width / 2, rect.height / 2)
      .scale(scale)
      .translate(-worldX, -worldY);
    this.svg.call(this.zoom.transform, t);
  }

  screenToWorld(clientX, clientY) {
    const rect = this.svg.node().getBoundingClientRect();
    const [x, y] = this.zoomTransform.invert([clientX - rect.left, clientY - rect.top]);
    return { x, y };
  }

  currentScale() {
    return this.zoomTransform.k;
  }

  // items: [{id,type,x,y,rotation,width,height,radius,material,fixed,transient,selected,label?}]
  render(items, opts = {}) {
    const editable = !!opts.editable;
    const selectedId = opts.selectedId ?? null;

    const sel = this.objectLayer.selectAll(".world-object")
      .data(items, (d) => d.id);

    sel.exit().remove();

    const enter = sel.enter().append("g").attr("class", "world-object");
    enter.each(function (d) { buildShape(d3.select(this), d); });

    const merged = enter.merge(sel);

    merged
      .classed("selected", (d) => d.id === selectedId)
      .classed("fixed", (d) => d.fixed)
      .attr("transform", (d) => `translate(${d.x},${d.y}) rotate(${d.rotation || 0})`)
      .style("cursor", editable ? "grab" : "default")
      .style("opacity", (d) => d.opacity ?? 1);

    merged.each((d, i, nodes) => updateShape(d3.select(nodes[i]), d, editable));

    // rotate handle for editable, rotatable, selected, non-transient items
    this.objectLayer.selectAll(".rotate-handle").remove();
    if (editable && selectedId) {
      const d = items.find((it) => it.id === selectedId);
      if (d && !d.transient && ROTATABLE.has(d.type)) {
        this._addRotateHandle(d);
      }
    }

    if (editable) {
      merged.call(this._dragBehavior());
      merged.on("click", (event, d) => {
        event.stopPropagation();
        this.handlers.onSelect(d.id);
      });
    } else {
      merged.on(".drag", null).on("click", null);
    }
  }

  _addRotateHandle(d) {
    const dist = handleDistance(d);
    const angle = (d.rotation || 0) * RAD;
    const hx = d.x + Math.sin(angle) * dist;
    const hy = d.y - Math.cos(angle) * dist;

    const g = this.objectLayer.append("g").attr("class", "rotate-handle");
    g.append("line").attr("x1", d.x).attr("y1", d.y).attr("x2", hx).attr("y2", hy);
    g.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 7);

    const self = this;
    g.call(d3.drag().on("drag", function (event) {
      const dx = event.x - d.x;
      const dy = event.y - d.y;
      let deg = Math.atan2(dx, -dy) / RAD;
      deg = Math.round(deg / 5) * 5;
      self.handlers.onRotate(d.id, deg);
    }));
  }

  _dragBehavior() {
    const self = this;
    let moved = false;
    return d3.drag()
      .on("start", () => { moved = false; })
      .on("drag", function (event, d) {
        moved = true;
        d.x += event.dx;
        d.y += event.dy;
        d3.select(this).attr("transform", `translate(${d.x},${d.y}) rotate(${d.rotation || 0})`);
      })
      .on("end", (event, d) => {
        if (!moved) return;
        const sx = snap(d.x), sy = snap(d.y);
        self.handlers.onMove(d.id, sx, sy);
      });
  }
}

const ROTATABLE = new Set(["board", "triangle", "cannon", "button", "springPad", "fan"]);

function handleDistance(d) {
  if (d.type === "board" || d.type === "button" || d.type === "springPad" || d.type === "fan") return d.height / 2 + 26;
  if (d.type === "triangle") return ((d.size ?? 130) * Math.sqrt(3)) / 3 + 26;
  if (d.type === "cannon") return d.height / 2 + 26;
  return 40;
}

function buildShape(g, d) {
  switch (d.type) {
    case "ball":
    case "bomb":
      g.append("circle").attr("class", "shape").attr("r", d.radius);
      if (d.type === "bomb") g.append("text").attr("class", "icon-label").text("💣").attr("text-anchor", "middle").attr("dy", 5).attr("font-size", d.radius);
      break;
    case "ballBearing":
      g.append("circle").attr("class", "shape").attr("r", d.radius);
      g.append("circle").attr("r", 2.5).attr("fill", "#1b1e24");
      break;
    case "peg":
      g.append("circle").attr("class", "shape").attr("r", d.radius);
      break;
    case "magnet":
      g.append("circle").attr("class", "shape").attr("r", d.radius);
      g.append("text").attr("class", "icon-label").text("🧲").attr("text-anchor", "middle").attr("dy", 5);
      break;
    case "shard":
      g.append("polygon").attr("class", "shape");
      break;
    case "board":
      g.append("rect").attr("class", "shape");
      break;
    case "button":
      g.append("rect").attr("class", "shape").attr("rx", 4);
      break;
    case "springPad":
      g.append("rect").attr("class", "shape").attr("rx", 3);
      g.append("polygon").attr("class", "spring-arrow").attr("fill", "#1b1e24");
      break;
    case "triangle":
      g.append("polygon").attr("class", "shape");
      break;
    case "cannon": {
      g.append("circle").attr("class", "catch-zone")
        .attr("fill", "none").attr("stroke", "var(--accent-2)")
        .attr("stroke-width", 1.5).attr("stroke-dasharray", "5 4").attr("pointer-events", "none");
      g.append("rect").attr("class", "shape barrel");
      g.append("polygon").attr("class", "muzzle-arrow").attr("fill", "#1b1e24");
      break;
    }
    case "fan": {
      g.append("rect").attr("class", "wind-zone")
        .attr("fill", "var(--accent)").attr("fill-opacity", 0.08)
        .attr("stroke", "var(--accent)").attr("stroke-width", 1).attr("stroke-dasharray", "4 4")
        .attr("pointer-events", "none");
      g.append("rect").attr("class", "shape body");
      g.append("text").attr("class", "icon-label").text("🌀").attr("text-anchor", "middle")
        .attr("dominant-baseline", "central");
      break;
    }
  }
}

function updateShape(g, d, editable) {
  const mat = materialOf(d.material);
  const fillOpacity = mat.fillOpacity ?? 1;
  const isFluid = !!mat.isFluid;

  g.select(".shape")
    .attr("fill", mat.color)
    .attr("fill-opacity", fillOpacity)
    .attr("stroke", isFluid ? "none" : mat.strokeColor)
    .attr("stroke-width", isFluid ? 0 : 2)
    .attr("stroke-dasharray", d.fixed && !isFluid ? null : (isFluid ? null : "0"));

  switch (d.type) {
    case "ball":
    case "bomb":
    case "ballBearing":
    case "peg":
    case "magnet":
      g.select(".shape").attr("r", d.radius);
      g.select("text.icon-label").attr("font-size", d.radius);
      break;
    case "board":
    case "button":
      g.select(".shape")
        .attr("x", -d.width / 2).attr("y", -d.height / 2)
        .attr("width", d.width).attr("height", d.height);
      break;
    case "springPad": {
      g.select(".shape")
        .attr("x", -d.width / 2).attr("y", -d.height / 2)
        .attr("width", d.width).attr("height", d.height);
      const ay = -d.height / 2;
      g.select(".spring-arrow").attr("points", `-10,${ay} 10,${ay} 0,${ay - 16}`);
      break;
    }
    case "triangle": {
      const pts = equilateralPoints(d.size).map((p) => `${p.x},${p.y}`).join(" ");
      g.select(".shape").attr("points", pts);
      break;
    }
    case "shard": {
      const pts = equilateralPoints(d.radius * 1.8).map((p) => `${p.x},${p.y}`).join(" ");
      g.select(".shape").attr("points", pts);
      break;
    }
    case "cannon": {
      g.select(".barrel")
        .attr("x", -d.width / 2).attr("y", -d.height / 2)
        .attr("width", d.width).attr("height", d.height)
        .attr("fill", mat.color).attr("stroke", mat.strokeColor).attr("stroke-width", 2);
      const mx = d.width / 2;
      g.select(".muzzle-arrow").attr("points", `${mx},-10 ${mx + 16},0 ${mx},10`);
      g.select(".catch-zone")
        .attr("r", cannonCatchRadius(d))
        .style("display", editable && !d.transient ? null : "none");
      break;
    }
    case "fan": {
      g.select(".body")
        .attr("x", -d.width / 2).attr("y", -d.height / 2)
        .attr("width", d.width).attr("height", d.height)
        .attr("fill", mat.color).attr("stroke", mat.strokeColor).attr("stroke-width", 2);
      g.select("text.icon-label").attr("font-size", Math.min(d.width, d.height) * 0.6);
      g.select(".wind-zone")
        .attr("x", d.width / 2).attr("y", -d.height / 2)
        .attr("width", d.range ?? 400).attr("height", d.height)
        .style("display", editable && !d.transient ? null : "none");
      break;
    }
  }

  // fixed objects get a subtle hatch stroke to distinguish from dynamic
  g.classed("is-fixed", !!d.fixed);
}

// Equilateral triangle (all sides = size), centroid at the origin, apex up.
export function equilateralPoints(size = 130) {
  const h = (size * Math.sqrt(3)) / 2;
  return [
    { x: 0, y: (-2 * h) / 3 },
    { x: size / 2, y: h / 3 },
    { x: -size / 2, y: h / 3 },
  ];
}
