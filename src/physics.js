import { materialOf } from "./materials.js";
import { effectiveDensity, effectiveFriction, effectiveRestitution } from "./physicsEdu.js";
import { makeId, cannonCatchRadius } from "./objectTypes.js";
import { equilateralPoints } from "./render.js";

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
const SHARD_LIFESPAN_MS = 3200;
const SHARD_FADE_MS = 900; // fade out over the last stretch of life, not a hard pop
const CANNON_LAUNCH_SCALE = 1.0;
const BUTTON_COOLDOWN_MS = 700;
const SPRING_COOLDOWN_MS = 350;
const PIVOT_ANGULAR_DAMPING = 0.25;
const WATER_PARTICLE_RADIUS = 5;
const WATER_PARTICLE_MAX = 140;
const WIND_PARTICLE_RADIUS = 3;
const WIND_PARTICLE_LIFESPAN_MS = 3000;
const WIND_SPAWN_EVERY_N_TICKS = 4;
// Anything a rope end can auto-pivot onto: flat shapes via point-in-polygon,
// small round objects via point-in-circle. Includes peg/magnet/ballBearing,
// which are always static — fine for a rope end (it just becomes a fixed
// pin), but NOT fine as the thing a *ball bearing itself* pivots, since
// those types are hardcoded isStatic and can't be forced dynamic — a
// bearing "pivoting" one of them would silently never swing. That search
// uses the narrower BEARING_HOST_TYPES instead.
const PIVOTABLE_HOST_TYPES = new Set(["board", "triangle", "ball", "bomb", "ballBearing", "peg", "magnet"]);
const BEARING_HOST_TYPES = new Set(["board", "triangle", "ball", "bomb"]);

export class PhysicsSim {
  constructor(specs, gravity, callbacks) {
    this.specs = specs;
    this.callbacks = callbacks || {};
    this.engine = Engine.create();
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
    // A bearing sits physically embedded inside its host (that's how a pivot
    // point works), so besides the point constraint that lets the host swing
    // around it, the bearing and host must never solid-collide with each
    // other — otherwise Matter treats them as permanently overlapping bodies
    // and fights to push them apart every single step, which looks like
    // violent jitter/explosion. Give each bearing+host pair a shared
    // negative collision group (same technique as rope segments).
    const noCollideGroupById = new Map(); // specId -> group, for bearing + its host
    for (const spec of this.specs) {
      if (spec.type !== "ballBearing") continue;
      const host = this._findPivotHost(spec, specById, BEARING_HOST_TYPES);
      if (!host) continue;
      pivots.push({ bearingSpec: spec, hostSpec: host });
      pivotHostIds.add(host.id);
      const group = Body.nextGroup(true);
      noCollideGroupById.set(spec.id, group);
      noCollideGroupById.set(host.id, group);
    }

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
        this.buttonMeta.set(spec.id, { spec, cooldownUntil: 0 });
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
    const cols = Math.max(2, Math.floor(w / (r * 2.2)));
    const total = Math.min(WATER_PARTICLE_MAX, cols * Math.max(2, Math.floor(h / (r * 2.1))));
    const rows = Math.max(1, Math.ceil(total / cols));
    let count = 0;
    for (let ry = 0; ry < rows && count < total; ry++) {
      for (let cx = 0; cx < cols && count < total; cx++) {
        const jitterX = (Math.random() - 0.5) * r * 0.6;
        const jitterY = (Math.random() - 0.5) * r * 0.6;
        const px = spec.x - w / 2 + r * 1.1 + (cols > 1 ? cx * (w - r * 2.2) / (cols - 1) : 0) + jitterX;
        const py = spec.y + h / 2 - r * 1.1 - ry * r * 2.1 + jitterY;
        const body = Bodies.circle(px, py, r, {
          friction: 0.02,
          frictionAir: 0.035,
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
    const length = spec.length ?? 240;
    const thickness = Math.max(3, spec.thickness ?? 10);
    const segCount = Math.max(3, Math.min(24, Math.round(length / (thickness * 2.2))));
    const segLen = length / segCount;
    const stiffness = Math.max(0.05, 1 - (spec.elasticity ?? 0.15) * 0.9);
    const angle = (spec.rotation || 0) * RAD;
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
        render: { type: "board", material: spec.material, width: segLen * 1.05, height: thickness, fixed: false },
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
          stiffness, damping: 0.15,
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
    const hostBody = host ? this.byId.get(host.id) : null;
    let anchorConfig;
    if (hostBody) {
      const cos = Math.cos(-host.rotation * RAD), sin = Math.sin(-host.rotation * RAD);
      const dx = spec.x - host.x, dy = spec.y - host.y;
      const localX = dx * cos - dy * sin, localY = dx * sin + dy * cos;
      anchorConfig = { bodyA: hostBody, pointA: { x: localX, y: localY }, bodyB: segments[0], pointB: { x: -segLen / 2, y: 0 }, length: 0, stiffness, damping: 0.15 };
    } else {
      anchorConfig = { pointA: { x: spec.x, y: spec.y }, bodyB: segments[0], pointB: { x: -segLen / 2, y: 0 }, length: 0, stiffness, damping: 0.15 };
    }
    Composite.add(world, Constraint.create(anchorConfig));

    // The far end pivots the same way the start does — an explicit "Attach
    // end to" target wins, otherwise whatever's sitting right at the rope's
    // tip auto-attaches, exactly like a ball bearing does. No dropdown is
    // required for either end; it's just there for precise manual control.
    const tipX = spec.x + dir.x * length, tipY = spec.y + dir.y * length;
    const explicitEnd = spec.attachEndId ? specById.get(spec.attachEndId) : null;
    const endHost = explicitEnd || this._findPivotHost({ id: spec.id, x: tipX, y: tipY }, specById);
    const endBody = endHost ? this.byId.get(endHost.id) : null;
    if (endBody) {
      const cos = Math.cos(-endHost.rotation * RAD), sin = Math.sin(-endHost.rotation * RAD);
      const dx = tipX - endHost.x, dy = tipY - endHost.y;
      const localX = dx * cos - dy * sin, localY = dx * sin + dy * cos;
      const lastSeg = segments[segments.length - 1];
      Composite.add(world, Constraint.create({
        bodyA: endBody, pointA: { x: localX, y: localY },
        bodyB: lastSeg, pointB: { x: segLen / 2, y: 0 },
        length: 0, stiffness, damping: 0.15,
      }));
    }
  }

  _findPivotHost(bearing, specById, allowedTypes = PIVOTABLE_HOST_TYPES) {
    let best = null;
    for (const spec of specById.values()) {
      if (spec.id === bearing.id) continue;
      if (!allowedTypes.has(spec.type)) continue;
      if (materialOf(spec.material).isFluid) continue;
      if (pointInShape(bearing.x, bearing.y, spec)) { best = spec; break; }
    }
    return best;
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
        body = Bodies.fromVertices(spec.x, spec.y, [equilateralPoints(spec.size)], common, true);
        break;
      }
      case "cannon":
      case "fan":
      case "lens":
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, { ...common, isStatic: true });
        break;
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
      render: {
        type: spec.type,
        material: spec.material,
        width: spec.width, height: spec.height, radius: spec.radius,
        fixed: !!spec.fixed,
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
    });
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
      const cos = Math.cos(-angle), sin = Math.sin(-angle);
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
        const reach = spec.width / 2 + spec.range;
        if (lx < spec.width / 2 || lx > reach || Math.abs(ly) > spec.height / 2) continue;
        const falloff = 1 - (lx - spec.width / 2) / spec.range;
        const mag = spec.power * FAN_FORCE_SCALE * falloff * body.mass;
        Body.applyForce(body, body.position, { x: dir.x * mag, y: dir.y * mag });
      }
      if (spawnNow) this._spawnWindParticle(fan, spec, dir);
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
      spawnedAt: performance.now(),
      lifespanMs: WIND_PARTICLE_LIFESPAN_MS,
      render: { hidden: true },
    };
    Composite.add(world, body);
    this.windParticles.push(body);
  }

  _applyMagnets() {
    if (!this.magnetMeta.size) return;
    const bodies = Composite.allBodies(this.engine.world);
    for (const { body: magnet, spec } of this.magnetMeta.values()) {
      for (const body of bodies) {
        if (body === magnet || body.isStatic || body.isSensor) continue;
        if (body.plugin?.material !== "metal") continue;
        const delta = Vector.sub(magnet.position, body.position);
        const dist = Vector.magnitude(delta);
        if (dist > spec.range || dist < 0.01) continue;
        const falloff = 1 - dist / spec.range;
        const dir = Vector.normalise(delta);
        const mag = spec.power * FAN_FORCE_SCALE * falloff * body.mass;
        Body.applyForce(body, body.position, { x: dir.x * mag, y: dir.y * mag });
      }
    }
  }

  _applyBuoyancy() {
    const bodies = Composite.allBodies(this.engine.world);
    const waterBodies = bodies.filter((b) => materialOf(b.plugin?.material).isFluid);
    if (!waterBodies.length) return;
    for (const sensor of waterBodies) {
      for (const body of bodies) {
        if (body === sensor || body.isStatic || body.isSensor) continue;
        if (!boundsOverlap(sensor.bounds, body.bounds)) continue;
        this._checkWater(sensor, body);
      }
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
    if (other.isSensor) return; // water, cannon catch zones, buttons — not a hard impact
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

  _checkWater(sensor, body) {
    const objH = body.bounds.max.y - body.bounds.min.y || 1;
    const submerged = clamp(body.bounds.max.y - sensor.bounds.min.y, 0, objH);
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

    const now = performance.now();
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
    const now = performance.now();
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
    if (!meta || !meta.spec.targetId) return;
    const targetId = meta.spec.targetId;
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
    const bombBody = this.byId.get(bombId) || Composite.allBodies(this.engine.world).find((b) => b.plugin?.gameId === bombId);
    if (!bombBody) return;
    const world = this.engine.world;
    const spec = this.specs.find((s) => s.id === bombId);
    const power = spec?.power ?? 26;
    const radiusOfEffect = spec?.radiusOfEffect ?? 260;

    for (const other of Composite.allBodies(world)) {
      if (other === bombBody || other.isStatic || other.isSensor) continue;
      const delta = Vector.sub(other.position, bombBody.position);
      const dist = Vector.magnitude(delta);
      if (dist > radiusOfEffect || dist < 0.01) continue;
      const falloff = 1 - dist / radiusOfEffect;
      const dir = Vector.normalise(delta);
      const mag = power * BOMB_FORCE_SCALE * falloff * other.mass;
      Body.applyForce(other, other.position, { x: dir.x * mag, y: dir.y * mag });
    }
    Composite.remove(world, bombBody);
    this.callbacks.onEvent?.({ type: "detonate", bombId });
  }

  setGravity(scale) {
    this.engine.gravity.y = scale;
  }

  start() {
    this.running = true;
    this.lastTime = null;
    const loop = (time) => {
      if (!this.running) return;
      if (this.lastTime == null) this.lastTime = time;
      const delta = Math.min(time - this.lastTime, 33);
      this.lastTime = time;
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

  // Real physics-driven water/wind particles, in the same {id,kind,x,y,...}
  // shape the renderer's particle layer already expects — positions come
  // straight from the Matter bodies built in _buildWaterParticles /
  // _spawnWindParticle, not from a decorative animation formula.
  collectParticleItems() {
    const now = performance.now();
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
        opacity: 0.4,
      });
    }
    return items;
  }

  collectRenderItems() {
    const items = [];
    const now = performance.now();
    for (const body of Composite.allBodies(this.engine.world)) {
      const r = body.plugin?.render;
      if (!r || r.hidden) continue;
      let opacity = 1;
      if (body.plugin.spawnedAt) {
        const age = now - body.plugin.spawnedAt;
        const remaining = body.plugin.lifespanMs - age;
        opacity = clamp(remaining / SHARD_FADE_MS, 0, 1);
      }
      items.push({
        id: body.plugin.gameId,
        type: r.type,
        x: body.position.x,
        y: body.position.y,
        vx: body.velocity.x,
        vy: body.velocity.y,
        rotation: body.angle * DEG,
        width: r.width, height: r.height, radius: r.radius,
        material: r.material,
        fixed: body.isStatic,
        transient: !!body.plugin.transient,
        opacity,
      });
    }
    return items;
  }
}

function areaOf(spec) {
  if (spec.type === "ball" || spec.type === "bomb" || spec.type === "ballBearing" || spec.type === "peg" || spec.type === "magnet" || spec.type === "lightSource") {
    return Math.PI * spec.radius * spec.radius;
  }
  if (spec.type === "triangle") {
    const size = spec.size ?? 130;
    return (Math.sqrt(3) / 4) * size * size;
  }
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
    const [p0, p1, p2] = equilateralPoints(spec.size);
    return sameSide(lx, ly, p0, p1, p2) && sameSide(lx, ly, p1, p2, p0) && sameSide(lx, ly, p2, p0, p1);
  }
  if (spec.type === "ball" || spec.type === "bomb" || spec.type === "ballBearing" || spec.type === "peg" || spec.type === "magnet") {
    // A little slack past the drawn radius — snapping a rope end onto a
    // small peg/bearing shouldn't require pixel-perfect placement.
    const r = (spec.radius || 20) + 6;
    return lx * lx + ly * ly <= r * r;
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
