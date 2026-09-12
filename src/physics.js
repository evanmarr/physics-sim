import { materialOf } from "./materials.js";
import { effectiveDensity, effectiveFriction, effectiveRestitution } from "./physicsEdu.js";
import { makeId, cannonCatchRadius } from "./objectTypes.js";
import { trianglePoints } from "./render.js";

const { Engine, World, Composite, Bodies, Body, Constraint, Events, Vector } = Matter;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DENSITY_SCALE = 0.001;
const BUOYANCY_DRAG = 0.16;
const BOMB_FORCE_SCALE = 0.02;
// Much smaller than BOMB_FORCE_SCALE: a bomb's force is a one-off impulse,
// but a fan applies its force every single tick a body stays in range, so it
// compounds — this needs to be roughly gravity-scale, not impulse-scale.
const FAN_FORCE_SCALE = 0.00025;
// A straight-ahead push alone can only ever *blow a ball through* a wind
// stream, never let one hover in it — any real air jet also pulls a
// drifting object back toward its (fastest-moving, lowest-pressure)
// centerline, which is the actual reason the classic "ball floating over a
// hair dryer" trick works. These two constants add that: a lateral
// restoring force reaching out to twice the fan's push-width, plus a
// velocity-based lateral damping so a hovering ball settles instead of
// oscillating side to side forever.
const FAN_RESTORE_SCALE = 0.00028;
const FAN_LATERAL_DAMPING = 0.0006;
const SHARD_LIFESPAN_MS = 3200;
const SHARD_FADE_MS = 900; // fade out over the last stretch of life, not a hard pop
const CANNON_LAUNCH_SCALE = 1.0;
const BUTTON_COOLDOWN_MS = 700;
const SPRING_COOLDOWN_MS = 350;
const PIVOT_ANGULAR_DAMPING = 0.25;
const MAX_BODY_SPEED = 75; // world units/step — see _clampFastBodies
const WATER_PARTICLE_RADIUS = 5;
const WATER_PARTICLE_MAX = 600; // a safety ceiling for extreme boards, not the normal count — see _buildWaterParticles
const WIND_PARTICLE_RADIUS = 3;
const WIND_PARTICLE_LIFESPAN_MS = 2200;
const WIND_SPAWN_EVERY_N_TICKS = 2;
const WIND_PARTICLES_PER_SPAWN = 3; // a fan blows a wide stream, not a thin trickle of dots
// Anything a rope end can auto-pivot onto: flat shapes via point-in-polygon,
// small round objects via point-in-circle. Includes peg/magnet/ballBearing,
// which are always static — fine for a rope end (it just becomes a fixed
// pin), but NOT fine as the thing a *ball bearing itself* pivots, since
// those types are hardcoded isStatic and can't be forced dynamic — a
// bearing "pivoting" one of them would silently never swing. That search
// uses the narrower BEARING_HOST_TYPES instead.
const PIVOTABLE_HOST_TYPES = new Set(["board", "triangle", "ball", "bomb", "ballBearing", "peg", "magnet"]);
const WIRE_SNAP_DIST = 22; // world units — how close a wire's end needs to be to a button/bomb/cannon to link them
const RING_SEGMENTS = 14; // wedges approximating a Ball's donut collision shape — see _ringParts
const BEARING_HOST_TYPES = new Set(["board", "triangle", "ball", "bomb"]);

export class PhysicsSim {
  constructor(specs, gravity, callbacks) {
    this.specs = specs;
    this.callbacks = callbacks || {};
    // A modest bump from Matter's default (2) — enough for a rope chain to
    // converge without visibly popping, but NOT pushed further: a much
    // higher iteration count actually made things worse here, since the
    // constraint solver's damping term is reapplied every iteration —
    // more iterations means damping gets compounded harder each frame,
    // which for a stiff many-segment chain with a mass on the end tipped
    // it from "settles" into "gains energy and swings wider every cycle."
    this.engine = Engine.create({ constraintIterations: 6, positionIterations: 10, velocityIterations: 8 });
    this.engine.gravity.x = 0;
    this.engine.gravity.y = gravity;
    this.running = false;
    this.rafId = null;
    this.lastTime = null;
    this.pending = [];
    this.byId = new Map(); // gameId -> body
    this.cannonMeta = new Map(); // cannonId -> {barrel, catcher, spec}
    this.buttonMeta = new Map();
    this.fanMeta = new Map(); // fanId -> {body, spec}
    this.magnetMeta = new Map(); // magnetId -> {body, spec}
    this.springMeta = new Map(); // springPadId -> {spec, cooldownUntil}
    this._lastDelta = 16; // ms, updated each frame in start() — beforeUpdate handlers need real elapsed time
    // Simulated clock, not wall-clock — advances by the *scaled* delta each
    // frame (see start()), so anything timed against it (wind particles,
    // glass shards) ages at the same rate the physics itself is running at.
    // Using performance.now() for these was the slow-motion wind bug: the
    // fan force correctly weakened with a smaller delta, but particles
    // still despawned on real time, so in 0.3x slow-mo they vanished after
    // covering barely 30% of their normal distance.
    this.simTime = 0;
    this.pivotHostBodies = []; // bodies pivoted on a ball bearing, for settling damping
    this.waterParticles = []; // real dynamic bodies that settle/collide like granular liquid
    this.windParticles = []; // real dynamic bodies, pushed by fan force fields, that physically nudge whatever they hit
    this._windNoCollideGroup = Body.nextGroup(true); // wind particles pass through each other, but not through real objects
    this._fanTick = 0;
    this._build();
    this._wireEvents();
  }

  _build() {
    const world = this.engine.world;
    const specById = new Map(this.specs.map((s) => [s.id, s]));

    // Figure out which boards/triangles get a ball-bearing pivot *before*
    // creating bodies: a pivoted object must be dynamic to actually swing,
    // so a bearing overrides that host's own "Fixed" checkbox — otherwise
    // dropping a bearing onto the default (fixed) board would silently do
    // nothing, which is exactly the "why won't this swing" trap.
    const pivots = []; // { bearingSpec, hostSpec }
    const pivotHostIds = new Set();
    // A bearing sits physically embedded inside its host(s) (that's how a
    // pivot point works), so besides the point constraint that lets each
    // host swing around it, the bearing and every one of its hosts must
    // never solid-collide with each other — otherwise Matter treats them as
    // permanently overlapping bodies and fights to push them apart every
    // single step, which looks like violent jitter/explosion. All of a
    // bearing's hosts share the SAME negative collision group as the
    // bearing itself (not one group per pair) — Matter only allows one
    // group per body, and this is what lets several boards hinged on one
    // bearing all pass through each other and the bearing's own small
    // static disc, while still colliding normally with everything else.
    const noCollideGroupById = new Map(); // specId -> group, for bearing + all its hosts
    for (const spec of this.specs) {
      if (spec.type !== "ballBearing") continue;
      const hosts = this._findPivotHosts(spec, specById, BEARING_HOST_TYPES);
      if (!hosts.length) continue;
      const group = Body.nextGroup(true);
      noCollideGroupById.set(spec.id, group);
      for (const host of hosts) {
        pivots.push({ bearingSpec: spec, hostSpec: host });
        pivotHostIds.add(host.id);
        noCollideGroupById.set(host.id, group);
      }
    }

    // A wire whose two ends sit near a Button and a Bomb/Cannon links them,
    // the same effect as picking that target from the button's "Triggers"
    // dropdown — just done by physically routing a wire between them.
    // Computed once up front (order-independent: doesn't matter whether the
    // wire or the button appears first in specs) and consulted below.
    const wireLinks = this._computeWireLinks(specById);

    for (const spec of this.specs) {
      const body = this._createBody(spec, pivotHostIds.has(spec.id), noCollideGroupById.get(spec.id));
      if (!body) continue;
      this.byId.set(spec.id, body);
      Composite.add(world, body);

      if (spec.type === "cannon") {
        const catcher = Bodies.circle(spec.x, spec.y, cannonCatchRadius(spec), {
          isStatic: true, isSensor: true, label: `cannonCatch:${spec.id}`,
        });
        catcher.plugin = { render: { hidden: true } };
        Composite.add(world, catcher);
        this.cannonMeta.set(spec.id, { barrel: body, catcher, spec });
      }
      if (spec.type === "button") {
        this.buttonMeta.set(spec.id, { spec, cooldownUntil: 0, targetId: wireLinks.get(spec.id) ?? spec.targetId });
      }
      if (spec.type === "fan") {
        this.fanMeta.set(spec.id, { body, spec });
      }
      if (spec.type === "magnet") {
        this.magnetMeta.set(spec.id, { body, spec });
      }
      if (spec.type === "springPad") {
        this.springMeta.set(spec.id, { spec, cooldownUntil: 0 });
      }
    }

    // ball bearing pivots: attach a frictionless point constraint from the
    // bearing's fixed point to the host's corresponding local point, so the
    // host can rotate/swing freely around that point.
    for (const { bearingSpec: spec, hostSpec: host } of pivots) {
      const hostBody = this.byId.get(host.id);
      if (!hostBody) continue;
      this.pivotHostBodies.push(hostBody);
      const cos = Math.cos(-host.rotation * RAD);
      const sin = Math.sin(-host.rotation * RAD);
      const dx = spec.x - host.x, dy = spec.y - host.y;
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;
      const constraint = Constraint.create({
        pointA: { x: spec.x, y: spec.y },
        bodyB: hostBody,
        pointB: { x: localX, y: localY },
        length: 0,
        stiffness: 1,
        damping: 0,
      });
      Composite.add(world, constraint);
    }

    // Join: weld every spec sharing a joinGroup together into one rigid
    // cluster. Unlike a Ball Bearing pivot (one point constraint, free to
    // rotate), a weld uses TWO point constraints per pair at distinct
    // anchor points — locking both relative translation AND rotation, the
    // same technique real 2D engines (e.g. Box2D's weld joint) use instead
    // of merging separate bodies into one. Each member keeps its own real
    // mass/density/material; under extreme force a weld can flex slightly
    // rather than being physically unbreakable, which is the honest
    // simplification of this approach versus a true single compound body.
    const joinGroups = new Map(); // joinGroup id -> [{ spec, body }]
    for (const spec of this.specs) {
      if (!spec.joinGroup) continue;
      const body = this.byId.get(spec.id);
      if (!body) continue;
      if (!joinGroups.has(spec.joinGroup)) joinGroups.set(spec.joinGroup, []);
      joinGroups.get(spec.joinGroup).push({ spec, body });
    }
    for (const members of joinGroups.values()) {
      if (members.length < 2) continue;
      // Joined members never solid-collide with each other (same
      // shared-negative-group technique as a bearing + its host) — a weld
      // that also fights its own collision response would jitter apart.
      const group = Body.nextGroup(true);
      for (const { body } of members) body.collisionFilter.group = group;
      const [primary, ...rest] = members;
      for (const { spec: otherSpec, body: otherBody } of rest) {
        for (const [ax, ay] of [[primary.spec.x, primary.spec.y], [primary.spec.x + 20, primary.spec.y + 20]]) {
          const pointA = _worldToLocalOffset(ax, ay, primary.spec.x, primary.spec.y, primary.spec.rotation || 0);
          const pointB = _worldToLocalOffset(ax, ay, otherSpec.x, otherSpec.y, otherSpec.rotation || 0);
          Composite.add(world, Constraint.create({
            bodyA: primary.body, pointA,
            bodyB: otherBody, pointB,
            length: 0, stiffness: 1, damping: 0.3,
          }));
        }
      }
    }

    // ropes: a chain of small segment bodies, anchored at the rope's placed
    // point (to a nearby static object there, if any, else to a fixed point
    // in space) and hanging/swinging freely from it.
    for (const spec of this.specs) {
      if (spec.type === "rope") this._buildRope(spec, specById);
    }

    // water: fill the zone with real small dynamic bodies (the standard
    // "granular liquid" approximation — cheap rigid circles that collide
    // with each other and anything that falls in, so it actually splashes
    // and settles instead of just animating bubble sprites).
    for (const spec of this.specs) {
      if (spec.type === "board" && materialOf(spec.material).isFluid) {
        this._buildWaterParticles(spec);
      }
    }
  }

  _buildWaterParticles(spec) {
    const world = this.engine.world;
    const w = spec.width, h = spec.height;
    const r = WATER_PARTICLE_RADIUS;
    // Fills the *whole* board, not just a fixed-size slab near the bottom —
    // a bigger board (more columns and/or rows fit) genuinely gets more
    // particles, proportional to its area. WATER_PARTICLE_MAX only kicks
    // in as a performance ceiling for an extreme board, at which point it
    // truncates back to filling from the bottom up, same as before.
    const cols = Math.max(2, Math.floor(w / (r * 2.2)));
    const rowsFit = Math.max(2, Math.floor(h / (r * 2.1)));
    const total = Math.min(WATER_PARTICLE_MAX, cols * rowsFit);
    const rows = Math.max(1, Math.min(rowsFit, Math.ceil(total / cols)));
    let count = 0;
    for (let ry = 0; ry < rows && count < total; ry++) {
      for (let cx = 0; cx < cols && count < total; cx++) {
        const jitterX = (Math.random() - 0.5) * r * 0.6;
        const jitterY = (Math.random() - 0.5) * r * 0.6;
        const px = spec.x - w / 2 + r * 1.1 + (cols > 1 ? cx * (w - r * 2.2) / (cols - 1) : 0) + jitterX;
        const py = spec.y + h / 2 - r * 1.1 - ry * r * 2.1 + jitterY;
        const body = Bodies.circle(px, py, r, {
          // Dialed back down from a stiffer, more-viscous tune — the gooey
          // render filter (see render.js's #water-goo) now absorbs the
          // small per-particle jitter that low friction used to expose, so
          // this can flow much more freely and still read as calm water.
          friction: 0.08,
          frictionAir: 0.025,
          restitution: 0,
          density: 0.9 * DENSITY_SCALE,
          label: `waterParticle:${spec.id}`,
        });
        body.plugin = {
          gameId: makeId("wp"),
          material: "waterParticleVisual", // deliberately not "water" — keeps it out of the buoyancy-source filter
          gameArea: Math.PI * r * r,
          transient: true,
          render: { hidden: true },
        };
        Composite.add(world, body);
        this.waterParticles.push(body);
        count++;
      }
    }
    // No invisible containment walls — these are real, ungated particles.
    // A "water" board still marks a buoyancy field (see _applyBuoyancy) for
    // anything that swims through that footprint, but the particles
    // themselves just fall under gravity and collide normally with
    // whatever's actually there. Pour it into a box built from real boards
    // and it stays put; pour it into empty air and it falls and spreads,
    // same as real water would.
  }

  _buildRope(spec, specById) {
    const world = this.engine.world;
    const mat = materialOf(spec.material);
    const x2 = spec.x2 ?? spec.x, y2 = spec.y2 ?? spec.y + 240;
    const length = Math.max(20, Math.hypot(x2 - spec.x, y2 - spec.y));
    const thickness = Math.max(3, spec.thickness ?? 10);
    const segCount = Math.max(3, Math.min(24, Math.round(length / (thickness * 2.2))));
    const segLen = length / segCount;
    // Capped just under 1 even at elasticity 0: Matter's iterative solver
    // treats stiffness>=1 as "instantly correct the full error every
    // iteration" with no easing, and for a multi-segment chain (especially
    // with a heavy object hanging off the end) that overshoots and
    // overcorrects every step — a visible, sustained vibration that more
    // solver iterations alone don't fully absorb. 0.96 is visually
    // indistinguishable from perfectly rigid but leaves the solver enough
    // give to actually converge.
    const stiffness = Math.min(0.96, Math.max(0.05, 1 - (spec.elasticity ?? 0.15) * 0.9));
    // Denser materials (metal is ~13x wood's density) put a lot more mass
    // and momentum through the exact same joints, which strains the
    // iterative solver much harder and shows up as visible jerk even at
    // the same elasticity setting — scaling damping up with density keeps
    // a metal rope's segments settling as calmly as a wood one, instead of
    // needing its own separate elasticity retuning per material.
    const damping = Math.min(0.7, 0.35 * Math.max(1, mat.density / materialOf("wood").density));
    const angle = Math.atan2(y2 - spec.y, x2 - spec.x);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    // Adjacent segments overlap slightly (the *1.05 below) so there's no
    // visible gap between chain links — but as separate rigid bodies they'd
    // then also collide with each other, and that collision response fights
    // the constraint holding them together, creeping the whole chain longer
    // every step. A shared negative collision group (Matter's standard
    // chain/rope technique) makes segments of this rope never collide with
    // each other, while still colliding normally with everything else.
    const noSelfCollideGroup = Body.nextGroup(true);

    const segments = [];
    for (let i = 0; i < segCount; i++) {
      const cx = spec.x + dir.x * segLen * (i + 0.5);
      const cy = spec.y + dir.y * segLen * (i + 0.5);
      const seg = Bodies.rectangle(cx, cy, segLen * 1.05, thickness, {
        angle,
        friction: mat.friction,
        frictionAir: mat.frictionAir ?? 0.01,
        restitution: mat.restitution,
        density: Math.max(mat.density * DENSITY_SCALE, 0.0001),
        collisionFilter: { group: noSelfCollideGroup },
        label: `ropeSegment:${spec.id}:${i}`,
      });
      seg.plugin = {
        gameId: makeId("ropeseg"),
        material: spec.material,
        gameDensity: mat.density,
        gameArea: segLen * thickness,
        shattered: false,
        transient: true,
        // Hidden from the normal per-object render list — a chain of
        // separate rectangle items is exactly the "bunch of squares" look
        // this was replaced with a smooth tube for. collectRopePaths()
        // reads these segments directly (by label) to draw that tube.
        render: { hidden: true, thickness, material: spec.material },
      };
      Composite.add(world, seg);
      segments.push(seg);
      if (i > 0) {
        Composite.add(world, Constraint.create({
          bodyA: segments[i - 1], pointA: { x: segLen / 2, y: 0 },
          bodyB: seg, pointB: { x: -segLen / 2, y: 0 },
          // Matter's auto-computed rest length ignores body rotation (it
          // doesn't rotate pointA/B by the bodies' angle at creation time,
          // even though it correctly does during simulation) — for
          // pre-rotated segments like these, that silently bakes in the
          // wrong length. Setting it explicitly avoids that entirely.
          length: 0,
          // Raised from Matter's typical rope-demo value (~0.15) — a heavy
          // object hanging off the end needs real energy dissipation or
          // the chain just keeps swinging/vibrating near-indefinitely.
          stiffness, damping,
        }));
      }
    }

    // anchor: an explicit "Attach start to" target wins; otherwise, if a
    // dynamic board/triangle sits at the rope's origin, tie the rope to it
    // (so it swings along with that host); otherwise pin to that fixed
    // point in space, same as a rope tied to a wall or ceiling. Pinning to
    // a *static* body's local point behaves exactly like a fixed-space pin
    // (it never moves), so the two cases share the same bodyA/pointA form.
    const explicitStart = spec.attachStartId ? specById.get(spec.attachStartId) : null;
    const host = explicitStart || this._findPivotHost({ id: spec.id, x: spec.x, y: spec.y }, specById);
    const startAnchor = host ? this._hostAnchor(host, spec.x, spec.y) : null;
    let anchorConfig;
    if (startAnchor) {
      anchorConfig = { bodyA: startAnchor.body, pointA: { x: startAnchor.x, y: startAnchor.y }, bodyB: segments[0], pointB: { x: -segLen / 2, y: 0 }, length: 0, stiffness, damping };
    } else {
      anchorConfig = { pointA: { x: spec.x, y: spec.y }, bodyB: segments[0], pointB: { x: -segLen / 2, y: 0 }, length: 0, stiffness, damping };
    }
    Composite.add(world, Constraint.create(anchorConfig));

    // The far end pivots the same way the start does — an explicit "Attach
    // end to" target wins, otherwise whatever's sitting right at the rope's
    // tip auto-attaches, exactly like a ball bearing does. No dropdown is
    // required for either end; it's just there for precise manual control.
    const tipX = x2, tipY = y2;
    const explicitEnd = spec.attachEndId ? specById.get(spec.attachEndId) : null;
    const endHost = explicitEnd || this._findPivotHost({ id: spec.id, x: tipX, y: tipY }, specById);
    const endAnchor = endHost ? this._hostAnchor(endHost, tipX, tipY) : null;
    if (endAnchor) {
      const lastSeg = segments[segments.length - 1];
      Composite.add(world, Constraint.create({
        bodyA: endAnchor.body, pointA: { x: endAnchor.x, y: endAnchor.y },
        bodyB: lastSeg, pointB: { x: segLen / 2, y: 0 },
        length: 0, stiffness, damping,
      }));
    }
  }

  // Resolves a pivot-host spec + a world attach point into the actual body
  // to constrain onto, plus that point's local-frame offset within it.
  _hostAnchor(host, px, py) {
    const body = this.byId.get(host.id);
    if (!body) return null;
    const cos = Math.cos(-host.rotation * RAD), sin = Math.sin(-host.rotation * RAD);
    const dx = px - host.x, dy = py - host.y;
    return { body, x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }

  _findPivotHost(bearing, specById, allowedTypes = PIVOTABLE_HOST_TYPES) {
    for (const spec of specById.values()) {
      if (spec.id === bearing.id) continue;
      if (!allowedTypes.has(spec.type)) continue;
      if (materialOf(spec.material).isFluid) continue;
      if (pointInShape(bearing.x, bearing.y, spec)) return spec;
    }
    return null;
  }

  // Plural version: every object overlapping the bearing's point, not just
  // the first one found — this is what lets one Ball Bearing act as a real
  // multi-arm pivot/joint (several boards/triangles all hinged at the same
  // point, each free to swing independently), not just a single pin.
  _findPivotHosts(bearing, specById, allowedTypes = PIVOTABLE_HOST_TYPES) {
    const hosts = [];
    for (const spec of specById.values()) {
      if (spec.id === bearing.id) continue;
      if (!allowedTypes.has(spec.type)) continue;
      if (materialOf(spec.material).isFluid) continue;
      if (pointInShape(bearing.x, bearing.y, spec)) hosts.push(spec);
    }
    return hosts;
  }

  // The nearest button/bomb/cannon within snap distance of a world point —
  // the same proximity-based "just touch the ends together" wiring rope
  // endpoints already use for auto-pivoting/attaching.
  _findWireEndpoint(x, y, specById) {
    let best = null, bestDist = WIRE_SNAP_DIST;
    for (const spec of specById.values()) {
      if (spec.type !== "button" && spec.type !== "bomb" && spec.type !== "cannon") continue;
      const dist = Math.hypot(spec.x - x, spec.y - y);
      if (dist <= bestDist) { best = spec; bestDist = dist; }
    }
    return best;
  }

  // buttonId -> targetId for every wire whose two ends land on one Button
  // and one Bomb/Cannon — a wire linking two buttons, two bombs, or nothing
  // at all simply does nothing functionally (it's still visible/draggable).
  _computeWireLinks(specById) {
    const links = new Map();
    for (const spec of this.specs) {
      if (spec.type !== "wire") continue;
      const x2 = spec.x2 ?? spec.x, y2 = spec.y2 ?? spec.y;
      const a = this._findWireEndpoint(spec.x, spec.y, specById);
      const b = this._findWireEndpoint(x2, y2, specById);
      if (!a || !b || a.id === b.id) continue;
      const button = a.type === "button" ? a : (b.type === "button" ? b : null);
      const target = a.type !== "button" ? a : b;
      if (button && target.type !== "button") links.set(button.id, target.id);
    }
    return links;
  }

  _createBody(spec, forceDynamic = false, noCollideGroup = null) {
    const mat = materialOf(spec.material);
    const isFluid = !!mat.isFluid;
    const common = {
      isStatic: isFluid ? true : (forceDynamic ? false : !!spec.fixed),
      isSensor: isFluid,
      angle: (spec.rotation || 0) * RAD,
      friction: effectiveFriction(spec, mat),
      frictionAir: mat.frictionAir ?? 0.01,
      restitution: effectiveRestitution(spec, mat),
      density: Math.max(effectiveDensity(spec, mat) * DENSITY_SCALE, 0.0001),
      label: `${spec.type}:${spec.id}`,
      ...(noCollideGroup != null ? { collisionFilter: { group: noCollideGroup } } : {}),
    };

    let body = null;
    switch (spec.type) {
      case "ball":
        body = spec.holeRatio > 0.05
          ? Body.create({ parts: _ringParts(spec.x, spec.y, spec.radius, spec.radius * spec.holeRatio, RING_SEGMENTS), ...common })
          : Bodies.circle(spec.x, spec.y, spec.radius, common);
        break;
      case "wheel":
        body = Bodies.circle(spec.x, spec.y, spec.radius, common);
        break;
      case "bomb":
        body = Bodies.circle(spec.x, spec.y, spec.radius, common);
        break;
      case "ballBearing":
      case "peg":
      case "magnet":
        body = Bodies.circle(spec.x, spec.y, spec.radius, { ...common, isStatic: true, isSensor: false });
        break;
      case "lightSource":
        body = Bodies.circle(spec.x, spec.y, spec.radius || 15, { ...common, isStatic: true, isSensor: true });
        break;
      case "portal":
        body = Bodies.circle(spec.x, spec.y, spec.radius || 26, { ...common, isStatic: true, isSensor: true });
        break;
      case "board":
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, common);
        break;
      case "button":
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, { ...common, isStatic: true, isSensor: true });
        break;
      case "springPad":
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, { ...common, isStatic: true });
        break;
      case "triangle": {
        body = Bodies.fromVertices(spec.x, spec.y, [trianglePoints(spec.width ?? spec.size ?? 130, spec.height)], common, true);
        break;
      }
      case "cannon":
      case "lens":
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, { ...common, isStatic: true });
        break;
      case "fan":
        // Unlike cannon/lens, a fan can be knocked around like any other
        // object (spec.fixed already drives isStatic via `common` for
        // everything else) — it still blows wind from whatever direction
        // it's currently facing, fixed or not.
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, common);
        break;
      case "mirror":
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, common);
        break;
      case "wire": {
        // Same two-endpoint rectangle-body convention as track — sensor so
        // it truly can't be collided with, and the button↔bomb/cannon link
        // it represents is resolved from the specs directly (see
        // _computeWireLinks), not from anything on this body.
        const x2 = spec.x2 ?? spec.x, y2 = spec.y2 ?? spec.y;
        const len = Math.max(4, Math.hypot(x2 - spec.x, y2 - spec.y));
        const midX = (spec.x + x2) / 2, midY = (spec.y + y2) / 2;
        const wireAngle = Math.atan2(y2 - spec.y, x2 - spec.x);
        body = Bodies.rectangle(midX, midY, len, 4, { ...common, angle: wireAngle, isStatic: true, isSensor: true });
        break;
      }
      default:
        return null;
    }

    body.plugin = {
      gameId: spec.id,
      material: spec.material,
      gameDensity: mat.density,
      gameArea: areaOf(spec),
      shattered: false,
      transient: false,
      // A fluid zone is now entirely represented by its particles (see
      // _buildWaterParticles) — this body still exists as the invisible
      // sensor _applyBuoyancy sweeps for, but drawing it too would double
      // it up as a solid rectangle sitting behind/under the particles.
      render: isFluid ? { hidden: true } : {
        type: spec.type,
        material: spec.material,
        width: spec.width, height: spec.height, radius: spec.radius,
        holeRatio: spec.holeRatio,
        fixed: !!spec.fixed,
        power: spec.power, range: spec.range,
        // A wire has no explicit length field — like rope, it's the live
        // distance between its two endpoints, needed here so
        // collectRenderItems can reconstruct x2/y2 from the body's actual
        // midpoint/angle.
        length: spec.type === "wire" ? Math.max(4, Math.hypot((spec.x2 ?? spec.x) - spec.x, (spec.y2 ?? spec.y) - spec.y)) : spec.length,
      },
    };
    return body;
  }

  _wireEvents() {
    Events.on(this.engine, "collisionStart", (evt) => {
      for (const pair of evt.pairs) {
        this._handlePair(pair, "start");
      }
    });
    Events.on(this.engine, "collisionActive", (evt) => {
      for (const pair of evt.pairs) {
        this._handlePair(pair, "active");
      }
    });
    // Continuous field forces (buoyancy) must be applied in 'beforeUpdate',
    // not from collision events: Matter integrates position/consumes forces
    // before collision events fire each step, so a force added later is
    // effectively dropped rather than lagged. beforeUpdate runs first.
    Events.on(this.engine, "beforeUpdate", () => {
      this._applyBuoyancy();
      this._applyFans();
      this._applyMagnets();
      this._dampPivots();
      this._clampFastBodies();
    });
  }

  // Matter has no continuous collision detection — a body that would cross
  // more than its own size in a single step can land fully past a thin
  // wall before any collision is ever detected, tunneling straight
  // through. A hard speed ceiling (well above anything a cannon/bomb/fan
  // is tuned to produce normally) keeps that gap smaller than any wall
  // this sandbox's objects are built at, without visibly capping normal
  // play.
  _clampFastBodies() {
    for (const body of Composite.allBodies(this.engine.world)) {
      if (body.isStatic || body.isSensor) continue;
      const speed = Vector.magnitude(body.velocity);
      if (speed > MAX_BODY_SPEED) {
        const scale = MAX_BODY_SPEED / speed;
        Body.setVelocity(body, { x: body.velocity.x * scale, y: body.velocity.y * scale });
      }
    }
  }

  // Matter's constraint `damping` barely touches angular swing on a
  // zero-length pin joint — it only damps relative velocity along the
  // constraint's own axis, not rotation about it. Without this, a pivoted
  // board just keeps windmilling on its own low frictionAir. This settles
  // it back to hanging still when nothing's actively pushing on it, while
  // still swinging freely in response to an active push.
  _dampPivots() {
    for (const body of this.pivotHostBodies) {
      Body.setAngularVelocity(body, body.angularVelocity * (1 - PIVOT_ANGULAR_DAMPING));
    }
  }

  _applyFans() {
    if (!this.fanMeta.size) return;
    const bodies = Composite.allBodies(this.engine.world);
    this._fanTick++;
    const spawnNow = this._fanTick % WIND_SPAWN_EVERY_N_TICKS === 0;
    for (const { body: fan, spec } of this.fanMeta.values()) {
      const angle = fan.angle;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const perp = { x: -dir.y, y: dir.x };
      const cos = Math.cos(-angle), sin = Math.sin(-angle);
      const halfWidth = spec.width / 2;
      const reach = halfWidth + spec.range;
      const coreHalf = spec.height / 2; // full-strength lift, like before
      const catchHalf = spec.height; // wider "still caught by the stream" region the restoring force reaches into
      // Wind particles are real dynamic bodies (isSensor so they don't shove
      // solid objects on contact, but sensors still receive applied forces —
      // only isStatic is excluded below), so this same loop naturally pushes
      // them along the field exactly like any other body: real F=ma, not an
      // animated position.
      for (const body of bodies) {
        if (body === fan || body.isStatic) continue;
        const dx = body.position.x - fan.position.x;
        const dy = body.position.y - fan.position.y;
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        if (lx < halfWidth || lx > reach || Math.abs(ly) > catchHalf) continue;
        const alongFalloff = 1 - (lx - halfWidth) / spec.range;

        // Forward lift — strongest on the centerline, fading to nothing at
        // the edge of the core, same as a real jet's fastest (and most
        // lifting) air being at its center.
        const coreFrac = clamp(1 - Math.abs(ly) / coreHalf, 0, 1);
        const liftMag = spec.power * FAN_FORCE_SCALE * alongFalloff * coreFrac * body.mass;

        // Sideways pull back toward the centerline — the simplified stand-in
        // for Bernoulli's principle (faster-moving air near the centerline
        // is lower-pressure than the slower air further out, so drifting
        // off-axis gets drawn back in). Without this, lift alone is an
        // unstable equilibrium — the smallest sideways nudge grows until
        // the object exits the stream — so this is what actually lets
        // something hover/balance in the wind instead of just blowing
        // straight through it.
        const lateralFrac = Math.abs(ly) / catchHalf;
        const restoreMag = spec.power * FAN_RESTORE_SCALE * alongFalloff * lateralFrac * body.mass;
        const restoreSign = ly > 0 ? -1 : 1;

        Body.applyForce(body, body.position, {
          x: dir.x * liftMag + perp.x * restoreMag * restoreSign,
          y: dir.y * liftMag + perp.y * restoreMag * restoreSign,
        });

        // Damp lateral (not forward) velocity specifically, so a hovering
        // object settles toward the centerline instead of oscillating
        // across it indefinitely.
        const vLat = body.velocity.x * perp.x + body.velocity.y * perp.y;
        const dampMag = vLat * FAN_LATERAL_DAMPING * body.mass;
        Body.applyForce(body, body.position, { x: -perp.x * dampMag, y: -perp.y * dampMag });
      }
      if (spawnNow) {
        for (let i = 0; i < WIND_PARTICLES_PER_SPAWN; i++) this._spawnWindParticle(fan, spec, dir);
      }
    }
  }

  _spawnWindParticle(fan, spec, dir) {
    const world = this.engine.world;
    const perp = { x: -dir.y, y: dir.x };
    const lane = (Math.random() - 0.5) * spec.height * 0.8;
    const startX = fan.position.x + dir.x * (spec.width / 2 + 4) + perp.x * lane;
    const startY = fan.position.y + dir.y * (spec.width / 2 + 4) + perp.y * lane;
    const body = Bodies.circle(startX, startY, WIND_PARTICLE_RADIUS, {
      // A real (non-sensor) body now — it physically nudges whatever it
      // hits, not just an invisible force field. Light density so it can't
      // meaningfully budge anything heavy, and its own no-collide group so
      // a dense stream of them doesn't clump/jitter against itself.
      friction: 0,
      frictionAir: 0.02,
      restitution: 0.05,
      density: 0.12 * DENSITY_SCALE,
      collisionFilter: { group: this._windNoCollideGroup },
      label: `windParticle:${spec.id}`,
    });
    Body.setVelocity(body, { x: dir.x * 4, y: dir.y * 4 });
    body.plugin = {
      gameId: makeId("wind"),
      transient: true,
      spawnedAt: this.simTime,
      lifespanMs: WIND_PARTICLE_LIFESPAN_MS,
      render: { hidden: true },
    };
    Composite.add(world, body);
    this.windParticles.push(body);
  }

  _applyMagnets() {
    if (!this.magnetMeta.size) return;
    const bodies = Composite.allBodies(this.engine.world);
    // Live position/angle for each blocking object, not its authored spec
    // position — a blocker that's fallen or been knocked aside should stop
    // shielding from wherever it actually ended up.
    const blockers = this.specs
      .filter((s) => s.blocksMagnetism)
      .map((s) => {
        const b = this.byId.get(s.id);
        return b ? { type: s.type, x: b.position.x, y: b.position.y, rotation: b.angle * DEG, width: s.width, height: s.height, size: s.size } : null;
      })
      .filter(Boolean);
    for (const { body: magnet, spec } of this.magnetMeta.values()) {
      for (const body of bodies) {
        if (body === magnet || body.isStatic || body.isSensor) continue;
        if (body.plugin?.material !== "metal") continue;
        const delta = Vector.sub(magnet.position, body.position);
        const dist = Vector.magnitude(delta);
        if (dist > spec.range || dist < 0.01) continue;
        if (blockers.length && isMagnetismBlocked(magnet.position, body.position, blockers)) continue;
        // A real permanent magnet's pull on ferrous metal falls off as
        // roughly the inverse 4th power of distance (steeper than gravity's
        // inverse square, since it's the *gradient* of a dipole field acting
        // on a field-induced dipole) — not the straight-line taper this used
        // to have. `range` still caps it at zero so the sim stays bounded;
        // a real field technically never reaches exactly zero.
        const refDist = 40;
        const falloff = Math.min(1, (refDist / Math.max(dist, refDist)) ** 4);
        const dir = Vector.normalise(delta);
        const mag = spec.power * FAN_FORCE_SCALE * falloff * body.mass;
        Body.applyForce(body, body.position, { x: dir.x * mag, y: dir.y * mag });
      }
    }
  }

  // Buoyancy/drag is driven by actual nearby water *particles*, not the
  // original water zone's footprint — water that's flowed, splashed, or
  // drained away from where it was poured no longer acts on anything back
  // at that empty spot, and conversely water that's spread somewhere new
  // does. An object with no particles touching it gets no force at all
  // (that's the "only act slowly if in contact with water particles" bit —
  // no lingering drag once it's actually clear of the water).
  _applyBuoyancy() {
    if (!this.waterParticles.length) return;
    const margin = 6; // small contact tolerance, not a hair-trigger on/off
    for (const body of Composite.allBodies(this.engine.world)) {
      if (body.isStatic || body.isSensor) continue;
      if (body.plugin?.material === "waterParticleVisual") continue; // water doesn't get buoyancy from itself
      const b = body.bounds;
      const nearby = this.waterParticles.filter((p) =>
        p.position.x >= b.min.x - margin && p.position.x <= b.max.x + margin &&
        p.position.y >= b.min.y - margin && p.position.y <= b.max.y + margin
      );
      if (nearby.length) this._checkWaterParticles(body, nearby);
    }
  }

  _handlePair(pair, phase) {
    const a = pair.bodyA, b = pair.bodyB;
    if (phase === "start" && a.plugin?.gameId && b.plugin?.gameId) {
      this.callbacks.onEvent?.({ type: "collision", a: a.plugin.gameId, b: b.plugin.gameId });
    }
    this._checkGlass(a, b, phase);
    this._checkGlass(b, a, phase);
    this._checkCannonCatch(a, b, phase);
    this._checkCannonCatch(b, a, phase);
    this._checkButton(a, b, phase);
    this._checkButton(b, a, phase);
    this._checkBomb(a, b, phase);
    this._checkBomb(b, a, phase);
    this._checkSpring(a, b, phase);
    this._checkSpring(b, a, phase);
    this._checkPortal(a, b, phase);
    this._checkPortal(b, a, phase);
  }

  // Teleports anything (except another portal) that touches a portal to
  // wherever its linked partner is, carrying its speed through but rotated
  // to match the *exit* portal's own facing — so a ball can go in falling
  // straight down and come out launched sideways, if that's how the exit
  // is aimed. A per-body cooldown (not per-portal) stops it immediately
  // re-triggering the exit the instant it arrives there.
  _checkPortal(body, other, phase) {
    if (phase !== "start") return;
    if (!body.plugin || body.plugin.render?.type !== "portal") return;
    if (other.isSensor || other.plugin?.render?.type === "portal") return;
    if (other.plugin && this.simTime < (other.plugin._portalCooldownUntil || 0)) return;
    const spec = this.specs.find((s) => s.id === body.plugin.gameId);
    if (!spec) return;
    const partnerSpec = this._findPortalPartner(spec);
    if (!partnerSpec) return;
    const exitBody = this.byId.get(partnerSpec.id);
    if (!exitBody) return;
    this.pending.push({ type: "teleport", body: other, entryAngle: body.angle, exitBody, exitAngle: exitBody.angle });
  }

  _findPortalPartner(spec) {
    if (spec.linkedId) {
      const linked = this.specs.find((s) => s.id === spec.linkedId);
      if (linked) return linked;
    }
    // No outgoing link set on this one — maybe the *other* portal points
    // back at it instead (linking only needs to be set on one side).
    return this.specs.find((s) => s.type === "portal" && s.linkedId === spec.id) || null;
  }

  _doTeleport(body, entryAngle, exitBody, exitAngle) {
    if (!Composite.allBodies(this.engine.world).includes(body)) return;
    Body.setPosition(body, { x: exitBody.position.x, y: exitBody.position.y });
    const turn = exitAngle - entryAngle;
    const cos = Math.cos(turn), sin = Math.sin(turn);
    const v = body.velocity;
    Body.setVelocity(body, { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos });
    if (body.plugin) body.plugin._portalCooldownUntil = this.simTime + 300;
    if (body.plugin?.gameId) this.callbacks.onEvent?.({ type: "teleport", bodyId: body.plugin.gameId });
  }

  _checkSpring(body, other, phase) {
    if (phase !== "start") return;
    if (!body.plugin || body.plugin.render?.type !== "springPad") return;
    if (other.isStatic || other.isSensor) return;
    const meta = this.springMeta.get(body.plugin.gameId);
    if (!meta) return;
    const now = performance.now();
    if (now < meta.cooldownUntil) return;
    meta.cooldownUntil = now + SPRING_COOLDOWN_MS;
    const dir = { x: Math.sin(body.angle), y: -Math.cos(body.angle) }; // local "up" off the pad's face
    Body.setVelocity(other, { x: dir.x * meta.spec.power, y: dir.y * meta.spec.power });
    this.callbacks.onEvent?.({ type: "springLaunch", padId: body.plugin.gameId, ballGameId: other.plugin?.gameId });
  }

  _checkGlass(body, other, phase) {
    if (phase !== "start") return;
    if (!body.plugin || body.plugin.material !== "glass" || body.plugin.shattered) return;
    if (body.isSensor) return; // a sensor (portal, lightSource, cannon catch zone...) never physically breaks
    if (other.isSensor) return; // water, cannon catch zones, buttons — not a hard impact
    // Flying shards (or another glass object) hitting this one shouldn't
    // chain-shatter it — only a non-glass impact, or a bomb blast
    // (handled directly in _doDetonate), should break glass.
    if (other.plugin?.material === "glass") return;
    const mat = materialOf("glass");
    const rv = Vector.sub(body.velocity, other.velocity);
    const speed = Vector.magnitude(rv);
    if (speed >= mat.shatterImpactThreshold) {
      this.pending.push({ type: "shatter", body });
    }
  }

  _checkCannonCatch(body, other, phase) {
    if (phase !== "start") return;
    if (!body.label?.startsWith("cannonCatch:")) return;
    if (!other.plugin || other.plugin.render?.type !== "ball") return;
    const cannonId = body.label.split(":")[1];
    this.pending.push({ type: "cannonFire", cannonId, ballBody: other });
  }

  _checkButton(body, other, phase) {
    if (phase !== "start") return;
    if (!body.plugin || body.plugin.render?.type !== "button") return;
    if (other.isSensor) return;
    const meta = this.buttonMeta.get(body.plugin.gameId);
    if (!meta) return;
    const now = performance.now();
    if (now < meta.cooldownUntil) return;
    meta.cooldownUntil = now + BUTTON_COOLDOWN_MS;
    this.pending.push({ type: "buttonPress", buttonId: body.plugin.gameId });
  }

  _checkBomb(body, other, phase) {
    if (phase !== "start") return;
    if (!body.plugin || body.plugin.render?.type !== "bomb" || body.plugin.detonating) return;
    if (other.isSensor) return;
    body.plugin.detonating = true;
    const bombId = body.plugin.gameId;
    setTimeout(() => this.pending.push({ type: "detonate", bombId }), 90);
  }

  _checkWaterParticles(body, nearby) {
    const objH = body.bounds.max.y - body.bounds.min.y || 1;
    // The local water "surface" is however high the nearest particles
    // actually reach right now, not a fixed zone boundary.
    const waterTopY = Math.min(...nearby.map((p) => p.position.y));
    const submerged = clamp(body.bounds.max.y - waterTopY, 0, objH);
    const fraction = clamp(submerged / objH, 0, 1);
    if (fraction <= 0) return;

    const g = this.engine.gravity;
    const effGravity = g.y * g.scale;
    const waterDensity = materialOf("water").density * DENSITY_SCALE;
    const area = body.plugin?.gameArea || 1000;
    const buoyantMass = waterDensity * fraction * area;
    const forceY = -buoyantMass * effGravity;
    Body.applyForce(body, body.position, { x: 0, y: forceY });

    const drag = 1 - BUOYANCY_DRAG * fraction;
    Body.setVelocity(body, { x: body.velocity.x * drag, y: body.velocity.y * drag });
  }

  processPending() {
    if (!this.pending.length) return;
    const actions = this.pending;
    this.pending = [];
    for (const action of actions) {
      try {
        if (action.type === "shatter") this._doShatter(action.body);
        else if (action.type === "cannonFire") this._doCannonFire(action.cannonId, action.ballBody);
        else if (action.type === "buttonPress") this._doButtonPress(action.buttonId);
        else if (action.type === "detonate") this._doDetonate(action.bombId);
        else if (action.type === "teleport") this._doTeleport(action.body, action.entryAngle, action.exitBody, action.exitAngle);
      } catch (e) {
        console.warn("pending action failed", action.type, e);
      }
    }
  }

  _doShatter(body) {
    if (!body.plugin || body.plugin.shattered) return;
    if (!Composite.allBodies(this.engine.world).includes(body)) return;
    body.plugin.shattered = true;
    const world = this.engine.world;
    const cx = body.position.x, cy = body.position.y;
    const bounds = body.bounds;
    const w = Math.max(bounds.max.x - bounds.min.x, 20);
    const h = Math.max(bounds.max.y - bounds.min.y, 20);

    Composite.allConstraints(world).forEach((c) => {
      if (c.bodyA === body || c.bodyB === body) Composite.remove(world, c);
    });
    Composite.remove(world, body);

    const now = this.simTime;
    const shardCount = 12;
    for (let i = 0; i < shardCount; i++) {
      const sx = cx + (Math.random() - 0.5) * w * 0.7;
      const sy = cy + (Math.random() - 0.5) * h * 0.7;
      const size = 4 + Math.random() * 11;
      const shard = Bodies.polygon(sx, sy, 3, size, {
        friction: materialOf("glass").friction,
        restitution: materialOf("glass").restitution,
        density: materialOf("glass").density * DENSITY_SCALE,
        angle: Math.random() * Math.PI * 2,
      });
      const dir = Vector.normalise({ x: sx - cx || 0.01, y: sy - cy || 0.01 });
      const speed = 5 + Math.random() * 9;
      Body.setVelocity(shard, {
        x: dir.x * speed + body.velocity.x * 0.5,
        y: dir.y * speed + body.velocity.y * 0.5 - 2,
      });
      Body.setAngularVelocity(shard, (Math.random() - 0.5) * 0.6);
      shard.plugin = {
        gameId: makeId("shard"),
        material: "glass",
        gameDensity: materialOf("glass").density,
        gameArea: size * size,
        shattered: true,
        transient: true,
        spawnedAt: now,
        lifespanMs: SHARD_LIFESPAN_MS,
        render: { type: "shard", material: "glass", radius: size, fixed: false },
      };
      Composite.add(world, shard);
    }
    this.callbacks.onEvent?.({ type: "shatter", gameId: body.plugin.gameId, x: cx, y: cy, radius: Math.max(w, h) / 2 });
  }

  _cullExpiredShards() {
    const now = this.simTime;
    const world = this.engine.world;
    for (const body of Composite.allBodies(world)) {
      const p = body.plugin;
      if (p?.spawnedAt && now - p.spawnedAt > p.lifespanMs) {
        Composite.remove(world, body);
      }
    }
  }

  _doCannonFire(cannonId, ballBody) {
    const meta = this.cannonMeta.get(cannonId);
    if (!meta) return;
    const world = this.engine.world;
    if (Composite.allBodies(world).includes(ballBody)) {
      Composite.remove(world, ballBody);
    }
    const spec = meta.spec;
    const launchRad = spec.launchRotation * RAD;
    Body.setAngle(meta.barrel, launchRad);
    Body.setAngle(meta.catcher, 0);

    const radius = ballBody.plugin?.render?.radius || 20;
    const material = ballBody.plugin?.material || "rubber";
    const muzzleDist = spec.width / 2 + radius + 4;
    const mx = spec.x + Math.cos(launchRad) * muzzleDist;
    const my = spec.y + Math.sin(launchRad) * muzzleDist;

    const mat = materialOf(material);
    const fired = Bodies.circle(mx, my, radius, {
      friction: mat.friction, restitution: mat.restitution,
      density: mat.density * DENSITY_SCALE, frictionAir: mat.frictionAir ?? 0.01,
      label: `ball:${makeId("firedball")}`,
    });
    fired.plugin = {
      gameId: makeId("firedball"), material, gameDensity: mat.density,
      gameArea: Math.PI * radius * radius, shattered: false, transient: true,
      render: { type: "ball", material, radius, fixed: false },
    };
    const speed = spec.power * CANNON_LAUNCH_SCALE;
    Body.setVelocity(fired, { x: Math.cos(launchRad) * speed, y: Math.sin(launchRad) * speed });
    Composite.add(world, fired);

    setTimeout(() => {
      if (this.cannonMeta.get(cannonId) === meta) {
        Body.setAngle(meta.barrel, spec.startRotation * RAD);
      }
    }, 650);

    this.callbacks.onEvent?.({ type: "cannonFire", cannonId, ballGameId: fired.plugin.gameId });
  }

  _doButtonPress(buttonId) {
    const meta = this.buttonMeta.get(buttonId);
    if (!meta || !meta.targetId) return;
    const targetId = meta.targetId;
    if (this.cannonMeta.has(targetId)) {
      const cm = this.cannonMeta.get(targetId);
      const world = this.engine.world;
      const nearBall = Composite.allBodies(world).find((b) =>
        b.plugin?.render?.type === "ball" &&
        Vector.magnitude(Vector.sub(b.position, cm.catcher.position)) <= cm.catcher.circleRadius
      );
      if (nearBall) this._doCannonFire(targetId, nearBall);
      else Body.setAngle(cm.barrel, cm.spec.launchRotation * RAD);
    } else {
      this._doDetonate(targetId);
    }
    this.callbacks.onEvent?.({ type: "buttonPress", buttonId });
  }

  _doDetonate(bombId) {
    const world = this.engine.world;
    const bombBody = this.byId.get(bombId) || Composite.allBodies(world).find((b) => b.plugin?.gameId === bombId);
    // this.byId isn't cleaned up on removal, so a button wired to an
    // already-exploded bomb (pressed again, or pressed while the 90ms
    // detonation delay from a collision is still pending) would otherwise
    // find that stale reference and detonate it a second time — blast
    // force and glass-shattering fired again from a bomb that's long gone.
    if (!bombBody || !Composite.allBodies(world).includes(bombBody)) return;
    const spec = this.specs.find((s) => s.id === bombId);
    const power = spec?.power ?? 26;
    const radiusOfEffect = spec?.radiusOfEffect ?? 260;

    const glassToShatter = [];
    for (const other of Composite.allBodies(world)) {
      if (other === bombBody || other.isStatic || other.isSensor) continue;
      const delta = Vector.sub(other.position, bombBody.position);
      const dist = Vector.magnitude(delta);
      if (dist > radiusOfEffect || dist < 0.01) continue;
      const falloff = 1 - dist / radiusOfEffect;
      const dir = Vector.normalise(delta);
      const mag = power * BOMB_FORCE_SCALE * falloff * other.mass;
      Body.applyForce(other, other.position, { x: dir.x * mag, y: dir.y * mag });
      // A blast is a direct, player-caused break — unlike _checkGlass's
      // impact-collision check (which ignores glass-on-glass so shards from
      // one break don't chain into others), any glass caught in the blast
      // radius shatters outright.
      if (other.plugin?.material === "glass" && !other.plugin.shattered) {
        glassToShatter.push(other);
      }
    }
    Composite.remove(world, bombBody);
    this.byId.delete(bombId);
    for (const glass of glassToShatter) this.pending.push({ type: "shatter", body: glass });
    this.callbacks.onEvent?.({ type: "detonate", bombId });
  }

  setGravity(scale) {
    this.engine.gravity.y = scale;
  }

  // Turns the pointer into a real ball: a genuine dynamic body that
  // collides with everything else in the scene, connected to the live
  // pointer position by a spring (the same technique Matter's own
  // MouseConstraint uses) rather than being teleported there every frame.
  // That distinction is the whole point — a teleported body cheats through
  // walls and can never itself be deflected, while a spring-pulled one gets
  // physically blocked by anything solid in its way and can be knocked off
  // course by whatever it hits, exactly like a ball you're pushing around
  // with an invisible leash.
  enableGrabTool(radius = 18) {
    if (this.grabBody) return;
    const pos = this.grabTarget || { x: 0, y: 0 };
    this.grabBody = Bodies.circle(pos.x, pos.y, radius, {
      label: "grabTool",
      density: 0.025,
      friction: 0.05,
      frictionAir: 0.02,
      restitution: 0.3,
      plugin: {
        gameId: makeId("grabTool"),
        // "cursor" is a dedicated render type (see render.js's updateShape)
        // — an outline-only circle, not styled like any real material, so
        // it always reads as "this is your pointer" rather than another
        // object sitting in the scene.
        render: { type: "cursor", radius },
      },
    });
    this.grabConstraint = Constraint.create({
      pointA: { x: pos.x, y: pos.y },
      bodyB: this.grabBody,
      stiffness: 0.2,
      damping: 0.4,
      length: 0,
    });
    Composite.add(this.engine.world, [this.grabBody, this.grabConstraint]);
  }

  disableGrabTool() {
    if (!this.grabBody) return;
    Composite.remove(this.engine.world, this.grabConstraint);
    Composite.remove(this.engine.world, this.grabBody);
    this.grabBody = null;
    this.grabConstraint = null;
  }

  setGrabTarget(x, y) {
    this.grabTarget = { x, y };
  }

  setTimeScale(scale) {
    this.timeScale = scale;
  }

  start() {
    this.running = true;
    this.lastTime = null;
    this.timeScale = this.timeScale ?? 1;
    const loop = (time) => {
      if (!this.running) return;
      if (this.lastTime == null) this.lastTime = time;
      const delta = Math.min(time - this.lastTime, 33) * this.timeScale;
      this.lastTime = time;
      this._lastDelta = delta;
      this.simTime += delta;
      // Grab tool: just move the spring's anchor to the live pointer
      // position — Matter's own constraint solver (inside Engine.update
      // below) is what actually moves grabBody toward it, the same as
      // every other constraint in the scene, so it's genuinely subject to
      // collisions the whole way there instead of being forced through them.
      if (this.grabConstraint && this.grabTarget) {
        this.grabConstraint.pointA.x = this.grabTarget.x;
        this.grabConstraint.pointA.y = this.grabTarget.y;
      }
      Engine.update(this.engine, delta);
      this.processPending();
      this._cullExpiredShards();
      this.callbacks.onFrame?.(this.collectRenderItems());
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    Events.off(this.engine);
    World.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }

  // Freezes the simulation exactly where it is — every body stays at its
  // current position/velocity, unlike stop() which tears the whole engine
  // down. Only the rAF loop halts, so nothing moves until resume() restarts
  // it (with a fresh lastTime, so the frozen gap isn't counted as elapsed
  // time and the next frame doesn't jump).
  pause() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  resume() {
    if (this.running) return;
    this.start();
  }

  // Real physics-driven water/wind particles, in the same {id,kind,x,y,...}
  // shape the renderer's particle layer already expects — positions come
  // straight from the Matter bodies built in _buildWaterParticles /
  // _spawnWindParticle, not from a decorative animation formula.
  collectParticleItems() {
    const now = this.simTime;
    this.windParticles = this.windParticles.filter((b) => now - b.plugin.spawnedAt <= b.plugin.lifespanMs);
    const items = [];
    for (const body of this.waterParticles) {
      items.push({ id: body.plugin.gameId, kind: "bubble", x: body.position.x, y: body.position.y, r: WATER_PARTICLE_RADIUS, opacity: 0.6 });
    }
    for (const body of this.windParticles) {
      const vx = body.velocity.x, vy = body.velocity.y;
      items.push({
        id: body.plugin.gameId, kind: "streak",
        x: body.position.x, y: body.position.y,
        x2: body.position.x - vx * 3, y2: body.position.y - vy * 3,
        opacity: 0.5,
        speed: Math.hypot(vx, vy),
      });
    }
    return items;
  }

  // One smooth polyline per rope, threaded through its segments' live
  // centers — this is what lets a simulated rope render as a continuous
  // tube instead of the chain of separate rectangle bodies it's actually
  // built from.
  collectRopePaths() {
    const byRope = new Map(); // ropeSpecId -> { points: [], thickness, material }
    for (const body of Composite.allBodies(this.engine.world)) {
      const label = body.label || "";
      if (!label.startsWith("ropeSegment:")) continue;
      const [, ropeId, idxStr] = label.split(":");
      if (!byRope.has(ropeId)) {
        byRope.set(ropeId, { points: [], thickness: body.plugin.render?.thickness ?? 10, material: body.plugin.render?.material });
      }
      byRope.get(ropeId).points[+idxStr] = { x: body.position.x, y: body.position.y };
    }
    const out = [];
    for (const [id, g] of byRope) {
      out.push({ id, points: g.points.filter(Boolean), thickness: g.thickness, material: g.material });
    }
    return out;
  }

  collectRenderItems() {
    const items = [];
    const now = this.simTime;
    for (const body of Composite.allBodies(this.engine.world)) {
      const r = body.plugin?.render;
      if (!r || r.hidden) continue;
      let opacity = 1;
      if (body.plugin.spawnedAt) {
        const age = now - body.plugin.spawnedAt;
        const remaining = body.plugin.lifespanMs - age;
        opacity = clamp(remaining / SHARD_FADE_MS, 0, 1);
      }
      // A wire's own body is centered at its midpoint (Matter bodies are
      // always positioned by their geometric center), but every other part
      // of the app — the editor, the property panel, the braid renderer —
      // treats its x/y and x2/y2 as its two fixed ends, matching rope's
      // convention. Reconstruct both from the body's live position/angle so
      // Play-mode rendering sees the same convention edit mode does.
      let px = body.position.x, py = body.position.y;
      let x2, y2;
      const isFlexEndpoint = r.type === "wire";
      if (isFlexEndpoint) {
        const rad = body.angle;
        const half = (r.length || 200) / 2;
        px -= Math.cos(rad) * half;
        py -= Math.sin(rad) * half;
        x2 = px + Math.cos(rad) * (r.length || 200);
        y2 = py + Math.sin(rad) * (r.length || 200);
      }
      items.push({
        id: body.plugin.gameId,
        type: r.type,
        x: px,
        y: py,
        ...(isFlexEndpoint ? { x2, y2 } : {}),
        vx: body.velocity.x,
        vy: body.velocity.y,
        // A track/wire's body angle is already fully baked into the x2/y2
        // reconstruction above (its line direction, in local coordinates
        // assuming zero group rotation) — carrying body.angle through as
        // `rotation` too would have the renderer's own
        // translate()+rotate() transform apply that same angle a *second*
        // time on top, visibly turning e.g. a vertical track horizontal.
        rotation: isFlexEndpoint ? 0 : body.angle * DEG,
        width: r.width, height: r.height, radius: r.radius,
        material: r.material,
        holeRatio: r.holeRatio,
        fixed: body.isStatic,
        transient: !!body.plugin.transient,
        opacity,
        length: r.length,
        power: r.power, range: r.range,
      });
    }
    return items;
  }
}

// Matter has no native ring/annulus primitive, and a true ring isn't even
// expressible as one simple (non-self-intersecting) polygon — so this
// approximates a donut's collision shape the standard way: a ring of
// trapezoid wedges, combined into one compound Body.create({parts}). That
// makes the hole a REAL gap in the collision geometry (something small
// enough genuinely passes through it), not just a visual overlay — each
// wedge is built at its own true centroid via Bodies.fromVertices so the
// compound body's parts end up actually arranged in a ring, not bunched at
// the center.
function _ringParts(cx, cy, outerR, innerR, segments) {
  const parts = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const raw = [
      { x: Math.cos(a0) * outerR, y: Math.sin(a0) * outerR },
      { x: Math.cos(a1) * outerR, y: Math.sin(a1) * outerR },
      { x: Math.cos(a1) * innerR, y: Math.sin(a1) * innerR },
      { x: Math.cos(a0) * innerR, y: Math.sin(a0) * innerR },
    ];
    const centroidX = raw.reduce((s, v) => s + v.x, 0) / raw.length;
    const centroidY = raw.reduce((s, v) => s + v.y, 0) / raw.length;
    const relative = raw.map((v) => ({ x: v.x - centroidX, y: v.y - centroidY }));
    parts.push(Bodies.fromVertices(cx + centroidX, cy + centroidY, [relative], {}, true));
  }
  return parts;
}

// Converts a world point into a spec's own local (unrotated) frame — used
// to bind a Join weld constraint's anchor points so they stay fixed
// relative to each body as it rotates, the same math the Ball Bearing
// pivot already uses for its own single anchor point.
function _worldToLocalOffset(worldX, worldY, originX, originY, rotationDeg) {
  const dx = worldX - originX, dy = worldY - originY;
  const cos = Math.cos(-rotationDeg * RAD), sin = Math.sin(-rotationDeg * RAD);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

// Samples points along the magnet→target segment and checks each against
// every blocking object's shape — cheap, and good enough for "is there a
// wall in the way" without needing real line/polygon intersection math.
function isMagnetismBlocked(a, b, blockers) {
  const steps = 8;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
    for (const blocker of blockers) {
      if (pointInShape(px, py, blocker)) return true;
    }
  }
  return false;
}

function areaOf(spec) {
  if (spec.type === "ball" || spec.type === "wheel" || spec.type === "bomb" || spec.type === "ballBearing" || spec.type === "peg" || spec.type === "magnet" || spec.type === "lightSource") {
    // A donut has less actual material than a solid disc of the same
    // outer radius — subtracting the hole's area is what keeps its mass
    // (and therefore how much force it takes to move) honest as the
    // Center Hole slider opens it up, instead of a lighter-looking ring
    // that still weighs like a solid ball.
    const hole = spec.type === "ball" ? (spec.holeRatio || 0) : 0;
    return Math.PI * spec.radius * spec.radius * (1 - hole * hole);
  }
  if (spec.type === "triangle") {
    const width = spec.width ?? spec.size ?? 130;
    const height = spec.height ?? (width * Math.sqrt(3)) / 2;
    return (width * height) / 2;
  }
  if (spec.type === "wire") return Math.max(4, Math.hypot((spec.x2 ?? spec.x) - spec.x, (spec.y2 ?? spec.y) - spec.y)) * 4;
  return (spec.width || 40) * (spec.height || 40);
}

function pointInShape(px, py, spec) {
  const cos = Math.cos(-spec.rotation * RAD), sin = Math.sin(-spec.rotation * RAD);
  const dx = px - spec.x, dy = py - spec.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  if (spec.type === "board") {
    return Math.abs(lx) <= spec.width / 2 && Math.abs(ly) <= spec.height / 2;
  }
  if (spec.type === "triangle") {
    const [p0, p1, p2] = trianglePoints(spec.width ?? spec.size ?? 130, spec.height);
    return sameSide(lx, ly, p0, p1, p2) && sameSide(lx, ly, p1, p2, p0) && sameSide(lx, ly, p2, p0, p1);
  }
  if (spec.type === "ball" || spec.type === "wheel" || spec.type === "bomb" || spec.type === "ballBearing" || spec.type === "peg" || spec.type === "magnet") {
    // A little slack past the drawn radius — snapping a rope end onto a
    // small peg/bearing shouldn't require pixel-perfect placement.
    const r = (spec.radius || 20) + 6;
    const distSq = lx * lx + ly * ly;
    if (distSq > r * r) return false;
    // A donut's actual hole isn't "inside" the object for hit-testing
    // purposes either — a rope dropped exactly through the middle should
    // fall through, not snag on material that isn't there.
    if (spec.type === "ball" && spec.holeRatio > 0.02) {
      const innerR = spec.radius * spec.holeRatio;
      if (distSq < innerR * innerR) return false;
    }
    return true;
  }
  return false;
}

function sameSide(px, py, a, b, c) {
  const cp1 = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
  const cp2 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return cp1 * cp2 >= 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function boundsOverlap(a, b) {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
}
