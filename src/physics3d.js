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
    note.textContent = "Drag to orbit · scroll to zoom · right-drag to pan";

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

    // Raycasting to select an object by click (a short drag is treated as
    // an orbit gesture, not a selection — same "did the pointer actually
    // move" distinction astronomy.js's planet-picking uses).
    let downPos = null;
    this.renderer.domElement.addEventListener("pointerdown", (e) => { downPos = { x: e.clientX, y: e.clientY }; });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved < 6) this._pick(e);
    });

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

  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const meshes = this.objects.map((o) => o.mesh);
    const hits = raycaster.intersectObjects(meshes);
    this.selectedId = hits.length ? this.objects.find((o) => o.mesh === hits[0].object)?.id ?? null : null;
    this._renderPanel();
  }

  _addObject(type) {
    const id = this.nextId++;
    const color = ["#38bdf8", "#8b5cf6", "#10b981", "#f97316", "#f43f5e"][id % 5];
    const spawn = { x: (Math.random() - 0.5) * 4, y: 4 + Math.random() * 2, z: (Math.random() - 0.5) * 4 };
    const obj = { id, type, color, mass: 1, friction: 0.3, restitution: 0.5, radius: 0.5, size: 0.8, spawn };
    this._instantiate(obj);
    this.objects.push(obj);
    this.selectedId = id;
    this._renderPanel();
  }

  // Builds (or rebuilds, after a property edit) the actual mesh + body for
  // one object spec. Split out from _addObject so editing mass/friction/etc
  // can just re-instantiate rather than mutating a live cannon body's shape.
  _instantiate(obj) {
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
      mesh = new THREE.Mesh(new THREE.BoxGeometry(obj.size, obj.size, obj.size), new THREE.MeshStandardMaterial({ color: obj.color }));
      shape = new CANNON.Box(new CANNON.Vec3(obj.size / 2, obj.size / 2, obj.size / 2));
    }
    mesh.position.set(obj.spawn.x, obj.spawn.y, obj.spawn.z);
    this.scene.add(mesh);

    const body = new CANNON.Body({ mass: obj.mass, shape, material });
    body.position.set(obj.spawn.x, obj.spawn.y, obj.spawn.z);
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
    for (const obj of this.objects) this._instantiate(obj);
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
