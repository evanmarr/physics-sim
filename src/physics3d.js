// Kinetic Plus — Physics 3D. Deliberately simpler than Physics 2D: a small
// set of real rigid bodies (balls, boxes), real gravity, real collisions,
// a floor and four walls, and an orbit/pan/zoom camera — not a feature-for-
// feature 3D port of the 2D sandbox. Physics 2D remains the primary,
// full-featured environment; this is a separate, intentionally smaller
// space students unlock with Plus.
//
// Rendering: Three.js (already loaded globally for Astronomy/atomViewer —
// see index.html's script tags), same OrbitControls pattern as
// src/astronomy.js. Physics: cannon-es, a real, stable, actively
// maintained rigid-body engine — not a hand-rolled 3D collision system.
// Loaded as a genuine ES module straight from a CDN URL (this project has
// no bundler for its own code, but ES module `import` of a full URL works
// natively in every current browser, no build step required).
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js";
import { getUser, onAuthChange } from "./auth.js";

const ROOM_HALF = 8; // meters — floor is ROOM_HALF*2 square, walls this far out
const WALL_HEIGHT = 4;

function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

export class Physics3DMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx || {};
    this.objects = []; // { id, type, mesh, body, color, mass, friction, restitution, radius/size }
    this.selectedId = null;
    this.playing = false;
    this.nextId = 1;
    this._built = false;
    this._authUnsub = onAuthChange(() => this._syncAccess());
  }

  mount() {
    this._running = true;
    this._syncAccess();
  }

  unmount() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._keydownHandler) {
      window.removeEventListener("keydown", this._keydownHandler);
      this._keydownHandler = null;
    }
  }

  _hasAccess() {
    return !!getUser()?.entitlements?.limits?.physics3dEnabled;
  }

  // Re-checks entitlement on every mount/auth change and swaps between the
  // real sandbox and a locked preview accordingly — never renders (or
  // steps physics for) the real sandbox for a non-Plus account.
  _syncAccess() {
    const allowed = this._hasAccess();
    if (allowed === this._lastAllowed && this._built) return;
    this._lastAllowed = allowed;
    this.root.innerHTML = "";
    this._built = false;
    if (!this._raf) cancelAnimationFrame(this._raf);
    if (allowed) this._buildSandbox();
    else this._buildLockedPreview();
  }

  _buildLockedPreview() {
    this.root.className = "physics3d-locked";
    const box = div("physics3d-locked-box");
    box.innerHTML = `
      <div class="physics3d-locked-badge">KINETIC PLUS</div>
      <h2>Physics 3D</h2>
      <p>Real 3D rigid bodies — balls and boxes with gravity, collisions, friction, and restitution — in a space you orbit, pan, and zoom around. A Plus feature, simpler than the full 2D sandbox on purpose.</p>
      <button id="physics3d-see-plans" class="primary">See Plans</button>
    `;
    this.root.appendChild(box);
    box.querySelector("#physics3d-see-plans").addEventListener("click", () => {
      document.getElementById("plans-btn")?.click();
    });
  }

  // ---------- the real sandbox (Plus only) ----------

  _buildSandbox() {
    this.root.className = "physics3d-wrap";
    this._built = true;

    this.toolbar = div("physics3d-toolbar");
    this.viewerWrap = div("physics3d-viewer");
    this.panel = div("physics3d-panel");
    this.root.appendChild(this.toolbar);
    this.root.appendChild(this.viewerWrap);
    this.root.appendChild(this.panel);

    this._buildToolbar();
    this._buildScene();
    this._buildPhysicsWorld();
    this._renderPanel();
    this._animate();
    this._wireKeyboard();
  }

  // Space to play/pause, R to reset — same keys as Physics 2D. Scoped to
  // this instance's own window listener (added on build, removed on
  // unmount) rather than the app's global handler, since that one only
  // fires while state.mode === "physics" and has no idea Physics 3D exists.
  _wireKeyboard() {
    if (this._keydownHandler) window.removeEventListener("keydown", this._keydownHandler);
    this._keydownHandler = (e) => {
      if (!this._built) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey) return;
      if (e.code === "Space") { e.preventDefault(); this._togglePlay(); }
      else if (e.code === "KeyR") { e.preventDefault(); this._reset(); }
    };
    window.addEventListener("keydown", this._keydownHandler);
  }

  _buildToolbar() {
    const p = this.toolbar;
    const addBallBtn = document.createElement("button");
    addBallBtn.textContent = "+ Ball";
    addBallBtn.addEventListener("click", () => this._addObject("ball"));
    const addBoxBtn = document.createElement("button");
    addBoxBtn.textContent = "+ Box";
    addBoxBtn.addEventListener("click", () => this._addObject("box"));

    this.playBtn = document.createElement("button");
    this.playBtn.className = "primary";
    this.playBtn.textContent = "▶ Play";
    this.playBtn.addEventListener("click", () => this._togglePlay());

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => this._reset());

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => this._clear());

    const note = div("physics3d-note");
    note.textContent = "Drag empty space to orbit · drag an object to move it · scroll to zoom · right-drag or shift+two-finger to pan · space to play/pause · R to reset";

    p.appendChild(addBallBtn);
    p.appendChild(addBoxBtn);
    p.appendChild(this.playBtn);
    p.appendChild(resetBtn);
    p.appendChild(clearBtn);
    p.appendChild(note);
  }

  _buildScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1220);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    this.camera.position.set(10, 9, 14);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.viewerWrap.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.5, 0);
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    // Two-finger touch defaults to combined dolly+pan; holding Shift swaps
    // it to a plain two-finger pan instead (checked fresh at the start of
    // every two-finger touch, via the capture-phase touchstart below, so it
    // can change mid-session without rebuilding OrbitControls).
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.minDistance = 2;
    this.controls.maxDistance = 60;

    this.scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x1a1a20, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(8, 14, 6);
    this.scene.add(sun);

    const floorGeo = new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x232a3b, roughness: 0.95 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    this.scene.add(floorMesh);

    const grid = new THREE.GridHelper(ROOM_HALF * 2, ROOM_HALF * 2, 0x38bdf8, 0x2b3550);
    grid.position.y = 0.001;
    this.scene.add(grid);

    // Four low walls so a launched/rolled object stays in view instead of
    // sailing off into the distance forever — visually thin, physically
    // real static boxes.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2f3a52, transparent: true, opacity: 0.35 });
    const wallGeo = (len) => new THREE.BoxGeometry(len, WALL_HEIGHT, 0.2);
    const walls = [
      { pos: [0, WALL_HEIGHT / 2, -ROOM_HALF], len: ROOM_HALF * 2, rot: 0 },
      { pos: [0, WALL_HEIGHT / 2, ROOM_HALF], len: ROOM_HALF * 2, rot: 0 },
      { pos: [-ROOM_HALF, WALL_HEIGHT / 2, 0], len: ROOM_HALF * 2, rot: Math.PI / 2 },
      { pos: [ROOM_HALF, WALL_HEIGHT / 2, 0], len: ROOM_HALF * 2, rot: Math.PI / 2 },
    ];
    for (const w of walls) {
      const mesh = new THREE.Mesh(wallGeo(w.len), wallMat);
      mesh.position.set(...w.pos);
      mesh.rotation.y = w.rot;
      this.scene.add(mesh);
    }
    this._wallSpecs = walls;

    // Click-drag on an object moves it (same feel as Physics 2D's object
    // dragging); click-drag on empty space orbits the camera (OrbitControls'
    // own job, untouched). Both start on the same pointerdown, so this
    // listener runs in the CAPTURE phase — before OrbitControls' own
    // bubble-phase pointerdown handler — specifically so it can set
    // `controls.enabled = false` before OrbitControls ever begins a rotate
    // gesture for the same press.
    this._dragObj = null;
    this._dragPlane = new THREE.Plane();
    this._dragOffset = new THREE.Vector3();
    let downPos = null;
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      downPos = { x: e.clientX, y: e.clientY };
      const hit = this._hitTestObject(e);
      if (!hit) return;
      this.selectedId = hit.id;
      this._renderPanel();
      this._dragObj = hit;
      this.controls.enabled = false;
      this._dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hit.mesh.position);
      const hitPoint = this._raycastPlane(e, this._dragPlane);
      this._dragOffset.copy(hitPoint ? hit.mesh.position.clone().sub(hitPoint) : new THREE.Vector3());
    }, { capture: true });

    this.renderer.domElement.addEventListener("pointermove", (e) => {
      if (!this._dragObj) return;
      const hitPoint = this._raycastPlane(e, this._dragPlane);
      if (!hitPoint) return;
      const obj = this._dragObj;
      const nx = hitPoint.x + this._dragOffset.x, nz = hitPoint.z + this._dragOffset.z;
      obj.mesh.position.x = nx;
      obj.mesh.position.z = nz;
      obj.body.position.x = nx;
      obj.body.position.z = nz;
      obj.body.velocity.set(0, 0, 0);
      obj.body.angularVelocity.set(0, 0, 0);
    });

    const endDrag = (e) => {
      if (this._dragObj) {
        this._dragObj = null;
        this.controls.enabled = true;
        downPos = null;
        return;
      }
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved < 6) this._pick(e);
    };
    this.renderer.domElement.addEventListener("pointerup", endDrag);
    this.renderer.domElement.addEventListener("pointercancel", endDrag);

    // Shift + two-finger drag pans instead of the default dolly+pan blend —
    // checked fresh at the start of each two-finger touch (capture phase,
    // same reasoning as above) so OrbitControls picks it up for that gesture.
    this.renderer.domElement.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) this.controls.touches.TWO = e.shiftKey ? THREE.TOUCH.PAN : THREE.TOUCH.DOLLY_PAN;
    }, { capture: true, passive: true });

    const resize = () => {
      const w = this.viewerWrap.clientWidth || 400, h = this.viewerWrap.clientHeight || 400;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);
    this._resize = resize;
  }

  _buildPhysicsWorld() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

    for (const w of this._wallSpecs) {
      const half = w.rot === 0 ? [w.len / 2, WALL_HEIGHT / 2, 0.1] : [0.1, WALL_HEIGHT / 2, w.len / 2];
      const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(...half)) });
      body.position.set(...w.pos);
      this.world.addBody(body);
    }
  }

  // Shared by both click-to-select/deselect (_pick) and the drag-start
  // check in _buildScene's pointerdown listener.
  _raycasterFromEvent(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    return raycaster;
  }

  _hitTestObject(e) {
    const raycaster = this._raycasterFromEvent(e);
    const meshes = this.objects.map((o) => o.mesh);
    const hits = raycaster.intersectObjects(meshes);
    return hits.length ? this.objects.find((o) => o.mesh === hits[0].object) ?? null : null;
  }

  // Where the pointer's ray crosses a given horizontal plane — used to drag
  // an object along the ground-parallel plane it's currently sitting at.
  _raycastPlane(e, plane) {
    const raycaster = this._raycasterFromEvent(e);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  _pick(e) {
    const hit = this._hitTestObject(e);
    this.selectedId = hit?.id ?? null;
    this._renderPanel();
  }

  _addObject(type) {
    const id = this.nextId++;
    const color = ["#38bdf8", "#8b5cf6", "#10b981", "#f97316", "#f43f5e"][id % 5];
    const spawn = { x: (Math.random() - 0.5) * 4, y: 4 + Math.random() * 2, z: (Math.random() - 0.5) * 4 };
    // Balls only ever get bigger/smaller (radius) — a sphere has no
    // separate shape to speak of. Boxes get independent X/Y/Z dimensions,
    // so "shape" (not just size) is real: a 2x0.5x2 box is a genuinely
    // different shape from a 1x1x1 cube, not just a scaled copy.
    const obj = { id, type, color, mass: 1, friction: 0.3, restitution: 0.5, radius: 0.5, sizeX: 0.8, sizeY: 0.8, sizeZ: 0.8, spawn };
    this._instantiate(obj);
    this.objects.push(obj);
    this.selectedId = id;
    this._renderPanel();
  }

  // Builds (or rebuilds, after a property edit) the actual mesh + body for
  // one object spec. Split out from _addObject so editing mass/friction/etc
  // can just re-instantiate rather than mutating a live cannon body's shape.
  // Preserves the object's current position/rotation (if it already has a
  // mesh) instead of snapping back to its original spawn point — editing a
  // property mid-fall shouldn't teleport the object.
  _instantiate(obj, { toSpawn = false } = {}) {
    const pos = (obj.mesh && !toSpawn) ? obj.mesh.position.clone() : new THREE.Vector3(obj.spawn.x, obj.spawn.y, obj.spawn.z);
    const quat = (obj.mesh && !toSpawn) ? obj.mesh.quaternion.clone() : new THREE.Quaternion();
    if (obj.mesh) this.scene.remove(obj.mesh);
    if (obj.body) this.world.removeBody(obj.body);

    const material = new CANNON.Material();
    material.friction = obj.friction;
    material.restitution = obj.restitution;

    let mesh, shape;
    if (obj.type === "ball") {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(obj.radius, 24, 16), new THREE.MeshStandardMaterial({ color: obj.color }));
      shape = new CANNON.Sphere(obj.radius);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(obj.sizeX, obj.sizeY, obj.sizeZ), new THREE.MeshStandardMaterial({ color: obj.color }));
      shape = new CANNON.Box(new CANNON.Vec3(obj.sizeX / 2, obj.sizeY / 2, obj.sizeZ / 2));
    }
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.scene.add(mesh);

    const body = new CANNON.Body({ mass: obj.mass, shape, material });
    body.position.set(pos.x, pos.y, pos.z);
    body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    this.world.addBody(body);

    obj.mesh = mesh;
    obj.body = body;
  }

  _togglePlay() {
    this.playing = !this.playing;
    this.playBtn.textContent = this.playing ? "⏸ Pause" : "▶ Play";
  }

  _reset() {
    this.playing = false;
    this.playBtn.textContent = "▶ Play";
    for (const obj of this.objects) this._instantiate(obj, { toSpawn: true });
  }

  _clear() {
    for (const obj of this.objects) {
      this.scene.remove(obj.mesh);
      this.world.removeBody(obj.body);
    }
    this.objects = [];
    this.selectedId = null;
    this._renderPanel();
  }

  _deleteSelected() {
    const obj = this.objects.find((o) => o.id === this.selectedId);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    this.world.removeBody(obj.body);
    this.objects = this.objects.filter((o) => o.id !== obj.id);
    this.selectedId = null;
    this._renderPanel();
  }

  _renderPanel() {
    const p = this.panel;
    const obj = this.objects.find((o) => o.id === this.selectedId);
    if (!obj) {
      p.innerHTML = `<p class="panel-empty">Click an object to edit its properties.</p>`;
      return;
    }
    // Balls only ever change size (radius) — there's no separate "shape" to
    // speak of for a sphere. Boxes get independent X/Y/Z dimensions, so
    // this is real shape editing (a flat slab vs. a tall pillar vs. a cube
    // are genuinely different shapes), not just a uniform scale slider.
    const sizeFields = obj.type === "ball"
      ? `<label>Radius (m)</label>
         <input type="number" id="p3d-radius" min="0.1" step="0.1" value="${obj.radius}" />`
      : `<label>Size X / Y / Z (m)</label>
         <div class="physics3d-size-row">
           <input type="number" id="p3d-size-x" min="0.1" step="0.1" value="${obj.sizeX}" />
           <input type="number" id="p3d-size-y" min="0.1" step="0.1" value="${obj.sizeY}" />
           <input type="number" id="p3d-size-z" min="0.1" step="0.1" value="${obj.sizeZ}" />
         </div>`;
    p.innerHTML = `
      <h3>${obj.type === "ball" ? "Ball" : "Box"}</h3>
      <label>Fixed (mass = 0)</label>
      <input type="checkbox" id="p3d-fixed" ${obj.mass === 0 ? "checked" : ""} />
      <label>Mass</label>
      <input type="number" id="p3d-mass" min="0" step="0.1" value="${obj.mass}" ${obj.mass === 0 ? "disabled" : ""} />
      <label>Friction</label>
      <input type="range" id="p3d-friction" min="0" max="1" step="0.05" value="${obj.friction}" />
      <label>Restitution (bounciness)</label>
      <input type="range" id="p3d-restitution" min="0" max="1" step="0.05" value="${obj.restitution}" />
      ${sizeFields}
      <label>Color</label>
      <input type="color" id="p3d-color" value="${obj.color}" />
      <button id="p3d-delete">Delete</button>
    `;
    p.querySelector("#p3d-fixed").addEventListener("change", (e) => {
      obj.mass = e.target.checked ? 0 : 1;
      this._instantiate(obj);
      this._renderPanel();
    });
    p.querySelector("#p3d-mass").addEventListener("input", (e) => {
      obj.mass = Math.max(0, Number(e.target.value) || 0);
      this._instantiate(obj);
    });
    p.querySelector("#p3d-friction").addEventListener("input", (e) => {
      obj.friction = Number(e.target.value);
      this._instantiate(obj);
    });
    p.querySelector("#p3d-restitution").addEventListener("input", (e) => {
      obj.restitution = Number(e.target.value);
      this._instantiate(obj);
    });
    if (obj.type === "ball") {
      p.querySelector("#p3d-radius").addEventListener("input", (e) => {
        obj.radius = Math.max(0.1, Number(e.target.value) || 0.1);
        this._instantiate(obj);
      });
    } else {
      const sizeKeys = { "#p3d-size-x": "sizeX", "#p3d-size-y": "sizeY", "#p3d-size-z": "sizeZ" };
      for (const [sel, key] of Object.entries(sizeKeys)) {
        p.querySelector(sel).addEventListener("input", (e) => {
          obj[key] = Math.max(0.1, Number(e.target.value) || 0.1);
          this._instantiate(obj);
        });
      }
    }
    p.querySelector("#p3d-color").addEventListener("input", (e) => {
      obj.color = e.target.value;
      obj.mesh.material.color.set(obj.color);
    });
    p.querySelector("#p3d-delete").addEventListener("click", () => this._deleteSelected());
  }

  _animate() {
    if (!this._running || !this._built) return;
    this._raf = requestAnimationFrame(() => this._animate());
    if (this.playing) {
      this.world.step(1 / 60);
      for (const obj of this.objects) {
        obj.mesh.position.copy(obj.body.position);
        obj.mesh.quaternion.copy(obj.body.quaternion);
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
