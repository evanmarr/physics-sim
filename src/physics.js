import { materialOf } from "./materials.js";
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
const CANNON_LAUNCH_SCALE = 1.0;
const BUTTON_COOLDOWN_MS = 700;

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
    for (const spec of this.specs) {
      if (spec.type !== "ballBearing") continue;
      const host = this._findPivotHost(spec, specById);
      if (!host) continue;
      pivots.push({ bearingSpec: spec, hostSpec: host });
      pivotHostIds.add(host.id);
    }

    for (const spec of this.specs) {
      const body = this._createBody(spec, pivotHostIds.has(spec.id));
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
    }

    // ball bearing pivots: attach a frictionless point constraint from the
    // bearing's fixed point to the host's corresponding local point, so the
    // host can rotate/swing freely around that point.
    for (const { bearingSpec: spec, hostSpec: host } of pivots) {
      const hostBody = this.byId.get(host.id);
      if (!hostBody) continue;
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
  }

  _findPivotHost(bearing, specById) {
    let best = null;
    for (const spec of specById.values()) {
      if (spec.id === bearing.id) continue;
      if (spec.type !== "board" && spec.type !== "triangle") continue;
      if (materialOf(spec.material).isFluid) continue;
      if (pointInShape(bearing.x, bearing.y, spec)) { best = spec; break; }
    }
    return best;
  }

  _createBody(spec, forceDynamic = false) {
    const mat = materialOf(spec.material);
    const isFluid = !!mat.isFluid;
    const common = {
      isStatic: isFluid ? true : (forceDynamic ? false : !!spec.fixed),
      isSensor: isFluid,
      angle: (spec.rotation || 0) * RAD,
      friction: mat.friction,
      frictionAir: mat.frictionAir ?? 0.01,
      restitution: mat.restitution,
      density: Math.max(mat.density * DENSITY_SCALE, 0.0001),
      label: `${spec.type}:${spec.id}`,
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
        body = Bodies.circle(spec.x, spec.y, spec.radius, { ...common, isStatic: true, isSensor: false });
        break;
      case "board":
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, common);
        break;
      case "button":
        body = Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, { ...common, isStatic: true, isSensor: true });
        break;
      case "triangle": {
        body = Bodies.fromVertices(spec.x, spec.y, [equilateralPoints(spec.size)], common, true);
        break;
      }
      case "cannon":
      case "fan":
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
    });
  }

  _applyFans() {
    if (!this.fanMeta.size) return;
    const bodies = Composite.allBodies(this.engine.world);
    for (const { body: fan, spec } of this.fanMeta.values()) {
      const angle = fan.angle;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const cos = Math.cos(-angle), sin = Math.sin(-angle);
      for (const body of bodies) {
        if (body === fan || body.isStatic || body.isSensor) continue;
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
  }

  _checkGlass(body, other, phase) {
    if (phase !== "start") return;
    if (!body.plugin || body.plugin.material !== "glass" || body.plugin.shattered) return;
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

    const shardCount = 6;
    for (let i = 0; i < shardCount; i++) {
      const sx = cx + (Math.random() - 0.5) * w * 0.6;
      const sy = cy + (Math.random() - 0.5) * h * 0.6;
      const size = 6 + Math.random() * 10;
      const shard = Bodies.polygon(sx, sy, 3, size, {
        friction: materialOf("glass").friction,
        restitution: materialOf("glass").restitution,
        density: materialOf("glass").density * DENSITY_SCALE,
        angle: Math.random() * Math.PI * 2,
      });
      const dir = Vector.normalise({ x: sx - cx || 0.01, y: sy - cy || 0.01 });
      const speed = 4 + Math.random() * 5;
      Body.setVelocity(shard, { x: dir.x * speed + body.velocity.x, y: dir.y * speed + body.velocity.y - 2 });
      shard.plugin = {
        gameId: makeId("shard"),
        material: "glass",
        gameDensity: materialOf("glass").density,
        gameArea: size * size,
        shattered: true,
        transient: true,
        render: { type: "shard", material: "glass", radius: size, fixed: false },
      };
      Composite.add(world, shard);
    }
    this.callbacks.onEvent?.({ type: "shatter", gameId: body.plugin.gameId });
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

  collectRenderItems() {
    const items = [];
    for (const body of Composite.allBodies(this.engine.world)) {
      const r = body.plugin?.render;
      if (!r || r.hidden) continue;
      items.push({
        id: body.plugin.gameId,
        type: r.type,
        x: body.position.x,
        y: body.position.y,
        rotation: body.angle * DEG,
        width: r.width, height: r.height, radius: r.radius,
        material: r.material,
        fixed: body.isStatic,
        transient: !!body.plugin.transient,
      });
    }
    return items;
  }
}

function areaOf(spec) {
  if (spec.type === "ball" || spec.type === "bomb" || spec.type === "ballBearing" || spec.type === "peg") {
    return Math.PI * spec.radius * spec.radius;
  }
  if (spec.type === "triangle") return (Math.sqrt(3) / 4) * spec.size * spec.size;
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
