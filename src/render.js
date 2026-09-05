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
    // Play-mode ropes only — a rope's authored spec never becomes its own
    // Matter body (only its chain of segments does), so unlike every other
    // object type it has nothing in the normal item list to render during
    // Play. This draws the smooth tube from collectRopePaths() instead.
    this.ropeTubeLayer = this.viewport.append("g").attr("class", "rope-tube-layer").attr("pointer-events", "none");
    this.particleLayer = this.viewport.append("g").attr("class", "particle-layer").attr("pointer-events", "none");
    this.trajectoryLayer = this.viewport.append("g").attr("class", "trajectory-layer").attr("pointer-events", "none");
    this.rayLayer = this.viewport.append("g").attr("class", "ray-layer").attr("pointer-events", "none");

    svg.on("click", (event) => {
      if (event.shiftKey) return; // shift+click on background: leave the in-progress selection alone
      if (event.target === svg.node() || event.target.classList?.contains("grid-bg")) {
        this.handlers.onSelect(null);
      }
    });

    this.zoom = d3.zoom()
      .scaleExtent([0.25, 2.5])
      .translateExtent([[WORLD.minX - 200, WORLD.minY - 200], [WORLD.maxX + 200, WORLD.maxY + 200]])
      .filter((event) => {
        // allow wheel + drag-pan on background, but not while dragging an
        // object, and not while shift is held (that's a marquee-select drag)
        if (event.type === "wheel") return true;
        if (event.shiftKey) return false;
        return !event.target.closest(".world-object") && !event.target.closest(".rotate-handle");
      })
      .on("zoom", (event) => {
        this.zoomTransform = event.transform;
        this.viewport.attr("transform", event.transform);
      });

    svg.call(this.zoom);
    this._wireMarqueeSelect(svg);
  }

  // Shift+drag on empty canvas: a rubber-band rectangle that adds every
  // object it overlaps to the current selection — the "drag select"
  // counterpart to shift+click's one-at-a-time toggle.
  _wireMarqueeSelect(svg) {
    const node = svg.node();
    let startWorld = null;
    let rectEl = null;

    const toWorld = (event) => {
      const [sx, sy] = d3.pointer(event, node);
      return this.zoomTransform.invert([sx, sy]);
    };

    node.addEventListener("pointerdown", (event) => {
      if (!event.shiftKey || event.button !== 0) return;
      if (event.target.closest(".world-object") || event.target.closest(".rotate-handle")) return;
      startWorld = toWorld(event);
      rectEl = this.viewport.append("rect").attr("class", "marquee-select-box");
      event.preventDefault();

      const onMove = (e) => {
        if (!startWorld) return;
        const cur = toWorld(e);
        const x = Math.min(startWorld[0], cur[0]), y = Math.min(startWorld[1], cur[1]);
        const w = Math.abs(cur[0] - startWorld[0]), h = Math.abs(cur[1] - startWorld[1]);
        rectEl.attr("x", x).attr("y", y).attr("width", w).attr("height", h);
      };
      const onUp = (e) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (startWorld && rectEl) {
          const cur = toWorld(e);
          const x0 = Math.min(startWorld[0], cur[0]), x1 = Math.max(startWorld[0], cur[0]);
          const y0 = Math.min(startWorld[1], cur[1]), y1 = Math.max(startWorld[1], cur[1]);
          const hit = (this._lastItems || []).filter((it) => it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1).map((it) => it.id);
          if (hit.length) this.handlers.onMultiSelect(hit);
        }
        rectEl?.remove();
        rectEl = null;
        startWorld = null;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  // Light Mode: redraws every ray as a polyline. Call with [] to clear.
  renderLightRays(rays) {
    const sel = this.rayLayer.selectAll("polyline").data(rays);
    sel.exit().remove();
    sel.enter().append("polyline")
      .attr("fill", "none").attr("stroke", "#ffd76b").attr("stroke-width", 1.6).attr("stroke-opacity", 0.85)
      .merge(sel)
      .attr("points", (ray) => ray.map((p) => `${p.x},${p.y}`).join(" "));
  }

  // The cannon's predicted-trajectory preview (edit mode, selected cannon
  // only) — a dashed line through a few sampled points. Call with null to
  // clear.
  renderTrajectory(points) {
    this.trajectoryLayer.selectAll("*").remove();
    if (!points || points.length < 2) return;
    this.trajectoryLayer.append("polyline")
      .attr("points", points.map((p) => `${p.x},${p.y}`).join(" "))
      .attr("fill", "none").attr("stroke", "var(--accent-2)").attr("stroke-width", 2.5)
      .attr("stroke-dasharray", "2 8").attr("stroke-linecap", "round");
  }

  // Play-mode rope rendering — one thick, round-jointed polyline per rope
  // threaded through its live segment positions, so a swinging rope reads
  // as a continuous tube instead of its actual chain of separate rigid
  // rectangle bodies. Call with [] to clear (e.g. when Play stops).
  renderRopeTubes(paths) {
    const sel = this.ropeTubeLayer.selectAll(".rope-tube").data(paths, (p) => p.id);
    sel.exit().remove();
    const enter = sel.enter().append("path").attr("class", "rope-tube shape");
    enter.merge(sel).each(function (p) {
      const mat = materialOf(p.material);
      d3.select(this)
        .attr("d", p.points.length > 1 ? "M" + p.points.map((pt) => `${pt.x},${pt.y}`).join(" L") : null)
        .attr("fill", "none")
        .attr("stroke", mat.color)
        .attr("stroke-opacity", mat.fillOpacity ?? 1)
        .attr("stroke-width", p.thickness)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round");
    });
  }

  // Cosmetic water-bubble / wind-streak particles, purely decorative.
  renderParticles(particles) {
    const sel = this.particleLayer.selectAll(".p").data(particles, (p) => p.id);
    sel.exit().remove();
    const enter = sel.enter().append(function (d) {
      return document.createElementNS("http://www.w3.org/2000/svg", d.kind === "bubble" ? "circle" : "line");
    }).attr("class", "p");
    enter.merge(sel).each(function (d) {
      const el = d3.select(this);
      if (d.kind === "bubble") {
        el.attr("cx", d.x).attr("cy", d.y).attr("r", d.r)
          .attr("fill", "#cfe9ff").attr("fill-opacity", d.opacity ?? 0.5);
      } else {
        // Wind streaks are colored by speed — a CFD-style cold→hot gradient
        // (slow=blue, fast=yellow/red) so a fan's flow field reads like a
        // real airflow visualization instead of a flat tint.
        el.attr("x1", d.x).attr("y1", d.y).attr("x2", d.x2).attr("y2", d.y2)
          .attr("stroke", speedColor(d.speed))
          .attr("stroke-width", 1.6).attr("stroke-opacity", d.opacity ?? 0.5)
          .attr("stroke-linecap", "round");
      }
    });
  }

  // A one-off, non-physics visual burst — a flash, an expanding ring, and a
  // handful of glinting shards — for effects like glass shattering. Lives
  // entirely on its own timer via d3 transitions, decoupled from the physics
  // render loop, and removes itself when done.
  burst(x, y, radius = 60) {
    const g = this.objectLayer.append("g").attr("class", "burst-fx").attr("transform", `translate(${x},${y})`);

    g.append("circle")
      .attr("r", radius * 0.5).attr("fill", "#5fc3e0").attr("opacity", 0.55)
      .transition().duration(220).ease(d3.easeCubicOut)
      .attr("r", radius * 0.9).attr("opacity", 0).remove();

    g.append("circle")
      .attr("r", radius * 0.3).attr("fill", "none").attr("stroke", "#2f9fc9").attr("stroke-width", 3).attr("opacity", 0.9)
      .transition().duration(450).ease(d3.easeCubicOut)
      .attr("r", radius * 1.8).attr("stroke-width", 0.5).attr("opacity", 0).remove();

    const glints = 8;
    for (let i = 0; i < glints; i++) {
      const angle = (i / glints) * Math.PI * 2 + Math.random() * 0.6;
      const dist = radius * (0.9 + Math.random() * 0.9);
      g.append("line")
        .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 0)
        .attr("stroke", "#2f9fc9").attr("stroke-width", 2).attr("stroke-linecap", "round").attr("opacity", 0.95)
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
    // selectedIds: the full multi-selection (Set) — drives highlighting and
    // group-drag. selectedId: only set when exactly one object is selected
    // — drives the single-object rotate handle (rotating a whole group at
    // once isn't supported).
    const selectedIds = opts.selectedIds instanceof Set ? opts.selectedIds : new Set(opts.selectedId ? [opts.selectedId] : []);
    const selectedId = opts.selectedId ?? null;
    this._lastItems = items;
    this._selectedIds = selectedIds;

    const sel = this.objectLayer.selectAll(".world-object")
      .data(items, (d) => d.id);

    sel.exit().remove();

    const enter = sel.enter().append("g").attr("class", "world-object");
    enter.each(function (d) { buildShape(d3.select(this), d); });

    const merged = enter.merge(sel);

    merged
      .classed("selected", (d) => selectedIds.has(d.id))
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
        this.handlers.onSelect(d.id, event.shiftKey);
      });
      this.objectLayer.selectAll(".rope-end-handle").call(this._ropeEndDragBehavior());
    } else {
      merged.on(".drag", null).on("click", null);
      this.objectLayer.selectAll(".rope-end-handle").on(".drag", null);
    }
  }

  // Each rope end is its own small ball-bearing-styled handle, draggable
  // independently of the rope's body — dragging one just stretches that
  // end to the new spot; dragging the tube itself (the generic
  // _dragBehavior, since the handle isn't under the pointer there) moves
  // both ends together.
  _ropeEndDragBehavior() {
    const self = this;
    let moved = false;
    return d3.drag()
      .on("start", function (event) {
        event.sourceEvent.stopPropagation(); // don't also start the parent's whole-body drag
        moved = false;
      })
      .on("drag", function (event, d) {
        moved = true;
        const isStart = d3.select(this).classed("rope-end-start");
        if (isStart) { d.x += event.dx; d.y += event.dy; }
        else { d.x2 += event.dx; d.y2 += event.dy; }
        const g = d3.select(this.parentNode);
        g.attr("transform", `translate(${d.x},${d.y})`);
        updateShape(g, d, true);
      })
      .on("end", function (event, d) {
        if (!moved) return;
        self.handlers.onEndpointMove(d.id, { x: snap(d.x), y: snap(d.y), x2: snap(d.x2), y2: snap(d.y2) });
      });
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

  // Dragging any one selected object moves the whole selection together —
  // if only one object is selected (the common case), that's just it.
  _dragBehavior() {
    const self = this;
    let moved = false;
    let group = null; // [{node, d}] for every object being dragged this gesture
    return d3.drag()
      .on("start", function (event, d) {
        moved = false;
        const multi = self._selectedIds && self._selectedIds.size > 1 && self._selectedIds.has(d.id);
        if (multi) {
          group = [];
          self.objectLayer.selectAll(".world-object").each(function (dd) {
            if (self._selectedIds.has(dd.id)) group.push({ node: this, d: dd });
          });
        } else {
          group = [{ node: this, d }];
        }
      })
      .on("drag", (event) => {
        moved = true;
        for (const { node, d: dd } of group) {
          dd.x += event.dx;
          dd.y += event.dy;
          // A rope or track has a second point (x2,y2) — shifting it by the
          // same delta keeps its length/angle unchanged, so dragging the
          // tube itself (rather than one of its end handles) translates
          // the whole thing instead of stretching it.
          if (FLEXIBLE_ENDPOINT_TYPES.has(dd.type) && dd.x2 != null) { dd.x2 += event.dx; dd.y2 += event.dy; }
          d3.select(node).attr("transform", `translate(${dd.x},${dd.y}) rotate(${dd.rotation || 0})`);
        }
      })
      .on("end", () => {
        if (moved) {
          self.handlers.onMoveMany(group.map(({ d: dd }) => ({
            id: dd.id, x: snap(dd.x), y: snap(dd.y),
            ...(FLEXIBLE_ENDPOINT_TYPES.has(dd.type) && dd.x2 != null ? { x2: snap(dd.x2), y2: snap(dd.y2) } : {}),
          })));
        }
        group = null;
      });
  }
}

const ROTATABLE = new Set(["board", "triangle", "cannon", "button", "springPad", "fan", "lens", "lightSource", "mirror", "motor"]);
const FLEXIBLE_ENDPOINT_TYPES = new Set(["rope", "track", "wire"]); // two independently-draggable ball-bearing ends

// Cold→hot 4-stop gradient (blue → cyan → yellow → red), same family as a
// CFD velocity-field plot — used to color wind streaks by their speed.
const SPEED_STOPS = [
  { t: 0, c: [58, 110, 220] },
  { t: 0.35, c: [80, 200, 230] },
  { t: 0.7, c: [250, 220, 80] },
  { t: 1, c: [235, 80, 60] },
];
function speedColor(speed) {
  const t = Math.max(0, Math.min(1, (speed || 0) / 7));
  let a = SPEED_STOPS[0], b = SPEED_STOPS[SPEED_STOPS.length - 1];
  for (let i = 0; i < SPEED_STOPS.length - 1; i++) {
    if (t >= SPEED_STOPS[i].t && t <= SPEED_STOPS[i + 1].t) { a = SPEED_STOPS[i]; b = SPEED_STOPS[i + 1]; break; }
  }
  const span = b.t - a.t || 1;
  const localT = (t - a.t) / span;
  const rgb = a.c.map((v, i) => Math.round(v + (b.c[i] - v) * localT));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function handleDistance(d) {
  if (d.type === "board" || d.type === "button" || d.type === "springPad" || d.type === "fan" || d.type === "lens" || d.type === "mirror") return d.height / 2 + 26;
  if (d.type === "lightSource") return 40;
  if (d.type === "triangle") return ((d.size ?? 130) * Math.sqrt(3)) / 3 + 26;
  if (d.type === "cannon") return d.height / 2 + 26;
  if (d.type === "motor") return (d.radius ?? 24) + 26;
  return 40;
}

// One strand of a wire's braided-cord look: a sine wave riding perpendicular
// to the wire's own direction (so it reads as a twist regardless of the
// wire's angle), sampled into a polyline. `phaseDeg` staggers the three
// strands 120° apart around that same wave so they interleave like an
// actual twisted cord instead of drawing on top of each other.
function braidStrandPath(ex, ey, phaseDeg) {
  const len = Math.hypot(ex, ey) || 1;
  const ux = ex / len, uy = ey / len; // unit vector along the wire
  const perpX = -uy, perpY = ux; // unit vector perpendicular to it
  const waveLen = 14, amp = 3.5;
  const steps = Math.max(2, Math.round(len / 4));
  const phase = (phaseDeg * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * len;
    const off = amp * Math.sin((2 * Math.PI * t) / waveLen + phase);
    pts.push(`${(ux * t + perpX * off).toFixed(1)},${(uy * t + perpY * off).toFixed(1)}`);
  }
  return "M" + pts.join(" L");
}

function buildShape(g, d) {
  switch (d.type) {
    case "ball":
    case "bomb":
      g.append("circle").attr("class", "shape").attr("r", d.radius);
      if (d.type === "bomb") g.append("text").attr("class", "icon-label").text("💣").attr("text-anchor", "middle").attr("dy", 5).attr("font-size", d.radius);
      break;
    case "ballBearing":
    case "trackBall":
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
    case "rope": {
      g.append("line").attr("class", "shape rope-preview").attr("x1", 0).attr("y1", 0);
      for (const end of ["start", "end"]) {
        const handle = g.append("g").attr("class", `rope-end-handle rope-end-${end}`);
        handle.append("circle").attr("class", "rope-end-outer");
        handle.append("circle").attr("class", "rope-end-dot").attr("r", 2.5);
      }
      break;
    }
    case "track": {
      g.append("line").attr("class", "shape track-rail").attr("x1", 0).attr("y1", 0);
      for (const end of ["start", "end"]) {
        const handle = g.append("g").attr("class", `rope-end-handle rope-end-${end}`);
        handle.append("circle").attr("class", "rope-end-outer");
        handle.append("circle").attr("class", "rope-end-dot").attr("r", 2.5);
      }
      // Decorative preview of the ball bearing resting at the track's
      // midpoint — hidden once Play starts, when the real moving ball
      // bearing (a separate render item, see physics.js's _buildTrack)
      // takes over.
      const preview = g.append("g").attr("class", "track-ball-preview");
      preview.append("circle").attr("class", "track-ball-outer");
      preview.append("circle").attr("class", "track-ball-dot").attr("r", 2.5);
      break;
    }
    case "wire": {
      // Three braided strands, not a single line — deliberately not tagged
      // "shape", so the generic material-color block above leaves their
      // fixed red/blue/green alone. Same draggable-end handles as rope.
      for (const color of ["red", "green", "blue"]) {
        g.append("path").attr("class", `wire-strand wire-strand-${color}`);
      }
      for (const end of ["start", "end"]) {
        const handle = g.append("g").attr("class", `rope-end-handle rope-end-${end}`);
        handle.append("circle").attr("class", "rope-end-outer");
        handle.append("circle").attr("class", "rope-end-dot").attr("r", 2.5);
      }
      break;
    }
    case "lens": {
      g.append("path").attr("class", "shape");
      break;
    }
    case "lightSource": {
      g.append("rect").attr("class", "shape").attr("width", 26).attr("height", 18).attr("x", -13).attr("y", -9).attr("rx", 3);
      g.append("polygon").attr("class", "light-arrow").attr("fill", "#ffd76b").attr("points", "13,-8 30,0 13,8");
      break;
    }
    case "mirror": {
      g.append("rect").attr("class", "shape mirror-body");
      g.append("line").attr("class", "mirror-highlight");
      break;
    }
    case "motor": {
      g.append("circle").attr("class", "shape motor-body");
      // A single spoke + hub, not a symmetric marker — the whole point is
      // that it visibly reads as rotating once Play sets its live angle.
      g.append("line").attr("class", "motor-spoke");
      g.append("circle").attr("class", "motor-hub").attr("r", 3);
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
    case "trackBall":
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
    case "rope": {
      // (x2,y2) are absolute like (x,y) — this group's own transform is
      // already translated to (x,y), so the far end's *local* position is
      // the offset between them. No rotation on this group; the line
      // itself carries the angle.
      const ex = (d.x2 ?? d.x) - d.x, ey = (d.y2 ?? d.y + 240) - d.y;
      const thickness = d.thickness ?? 10;
      g.select(".shape")
        .attr("x2", ex).attr("y2", ey)
        .attr("stroke-width", thickness)
        .attr("stroke-linecap", "round")
        .style("--rope-width", `${thickness}px`);
      const handleR = Math.max(7, thickness * 0.85);
      g.select(".rope-end-start").attr("transform", "translate(0,0)");
      g.select(".rope-end-end").attr("transform", `translate(${ex},${ey})`);
      g.selectAll(".rope-end-outer").attr("r", handleR);
      break;
    }
    case "track": {
      const ex = (d.x2 ?? d.x) - d.x, ey = (d.y2 ?? d.y + 200) - d.y;
      g.select(".shape")
        .attr("x2", ex).attr("y2", ey)
        .attr("stroke-width", 3)
        .attr("stroke-linecap", "round");
      g.select(".rope-end-start").attr("transform", "translate(0,0)");
      g.select(".rope-end-end").attr("transform", `translate(${ex},${ey})`);
      g.selectAll(".rope-end-outer").attr("r", 7);
      // Both the static end-grips and the resting-ball preview are editor
      // decorations — hide them once Play starts, when the real moving
      // ball bearing (a separate render item) takes over. Otherwise the
      // real ball is easy to mistake for just another motionless handle,
      // since it starts out sitting right on top of one.
      g.selectAll(".rope-end-handle").style("display", editable && !d.transient ? null : "none");
      g.select(".track-ball-preview")
        .attr("transform", `translate(${ex / 2},${ey / 2})`)
        .style("display", editable && !d.transient ? null : "none");
      g.select(".track-ball-outer").attr("r", 9);
      break;
    }
    case "wire": {
      const ex = (d.x2 ?? d.x) - d.x, ey = (d.y2 ?? d.y) - d.y;
      g.select(".wire-strand-red").attr("d", braidStrandPath(ex, ey, 0));
      g.select(".wire-strand-green").attr("d", braidStrandPath(ex, ey, 120));
      g.select(".wire-strand-blue").attr("d", braidStrandPath(ex, ey, 240));
      g.select(".rope-end-start").attr("transform", "translate(0,0)");
      g.select(".rope-end-end").attr("transform", `translate(${ex},${ey})`);
      g.selectAll(".rope-end-outer").attr("r", 6);
      g.selectAll(".rope-end-handle").style("display", editable && !d.transient ? null : "none");
      break;
    }
    case "lens": {
      const w = d.width, h = d.height;
      const k = Math.max(-1, Math.min(1, d.curvature ?? 0.6));
      let path;
      if (k >= 0) {
        const bulge = (w / 2) * (0.25 + 0.75 * k);
        path = `M0,${-h / 2} Q${bulge},0 0,${h / 2} Q${-bulge},0 0,${-h / 2} Z`;
      } else {
        const pinch = (w / 2) * (0.25 + 0.75 * -k);
        const edge = w / 4;
        path = `M${edge},${-h / 2} Q${edge - pinch},0 ${edge},${h / 2} L${-edge},${h / 2} Q${-edge + pinch},0 ${-edge},${-h / 2} Z`;
      }
      g.select(".shape").attr("d", path);
      break;
    }
    case "lightSource": {
      break;
    }
    case "mirror": {
      g.select(".shape")
        .attr("x", -d.width / 2).attr("y", -d.height / 2)
        .attr("width", d.width).attr("height", d.height);
      g.select(".mirror-highlight")
        .attr("x1", -d.width / 2 + 4).attr("x2", d.width / 2 - 4)
        .attr("y1", -d.height / 2 + 2.5).attr("y2", -d.height / 2 + 2.5);
      break;
    }
    case "motor": {
      g.select(".motor-body").attr("r", d.radius).attr("fill", mat.color).attr("stroke", mat.strokeColor);
      g.select(".motor-spoke").attr("x1", 0).attr("y1", 0).attr("x2", d.radius * 0.85).attr("y2", 0);
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
