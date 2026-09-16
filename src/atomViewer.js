// A small, self-contained rotatable 3D atom model: a nucleus of protons and
// neutrons, with electrons orbiting on tilted rings, one ring per shell.
// Built on the Three.js UMD build + its classic (non-module) OrbitControls,
// both loaded globally via <script> tags in index.html.

export class AtomViewer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(5, 8, 6);
    this.scene.add(key);

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.electronDots = []; // { mesh, radius, speed, tilt, phase }
    this.phaseParticles = []; // { mesh, phase, home, vel, box } — see showPhaseCluster

    this._resize();
    window.addEventListener("resize", () => this._resize());
    this._animate = this._animate.bind(this);
    this._running = false;
  }

  _resize() {
    const w = this.container.clientWidth || 300;
    const h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._animate();
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _animate() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._animate);
    const t = performance.now() / 1000;
    for (const e of this.electronDots) {
      const angle = t * e.speed + e.phase;
      const x = Math.cos(angle) * e.radius;
      const z = Math.sin(angle) * e.radius;
      e.mesh.position.set(x, 0, z);
    }
    for (const p of this.phaseParticles || []) this._stepPhaseParticle(p, t);
    if (this.moleculeAnim && this.moleculeAnim.length) this._stepMoleculeAnim();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Drives showMolecule()'s fly-in-and-bond animation: atoms ease from
  // their scattered `from` position to their bonded `to` position, bonds
  // ease their length in from zero a beat later. Finished entries are
  // dropped (their mesh is already sitting at the final value, so this is
  // just bookkeeping, not a visual change).
  _stepMoleculeAnim() {
    const now = performance.now();
    for (const a of this.moleculeAnim) {
      const t = Math.min(1, Math.max(0, (now - a.start) / a.duration));
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      if (a.bondGrow) a.mesh.scale.y = Math.max(0.001, eased);
      else a.mesh.position.lerpVectors(a.from, a.to, eased);
    }
    this.moleculeAnim = this.moleculeAnim.filter((a) => now - a.start < a.duration);
  }

  _stepPhaseParticle(p, t) {
    const half = p.box / 2;
    if (p.phase === "solid") {
      // Fixed lattice position, just vibrating in place — the per-particle
      // phase offset (from its own home position) keeps every atom
      // jittering slightly out of sync instead of breathing in unison.
      // Amplitude (p.jitter) scales with how hot this solid is.
      const j = p.jitter;
      p.mesh.position.set(
        p.home.x + Math.sin(t * 11 + p.home.x * 7) * j,
        p.home.y + Math.cos(t * 13 + p.home.y * 7) * j,
        p.home.z + Math.sin(t * 9 + p.home.z * 7) * j
      );
      return;
    }
    // Liquid and gas both drift by velocity and bounce off the box walls —
    // gas is just faster and started with more speed. Liquid occasionally
    // nudges its direction so it looks like it's slipping past neighbors
    // rather than coasting in a straight line forever.
    if (p.phase === "liquid" && Math.random() < 0.02) {
      p.vel.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).normalize().multiplyScalar(p.speed);
    }
    p.mesh.position.addScaledVector(p.vel, 0.016);
    for (const ax of ["x", "y", "z"]) {
      if (p.mesh.position[ax] > half) { p.mesh.position[ax] = half; p.vel[ax] *= -1; }
      if (p.mesh.position[ax] < -half) { p.mesh.position[ax] = -half; p.vel[ax] *= -1; }
    }
  }

  // A cluster of small spheres whose *motion* — not just their layout —
  // shows what phase this substance is in: a solid vibrates in a fixed
  // lattice, a liquid drifts and slides within a loose blob, a gas flies
  // fast and bounces off the walls of its container. `phase` is
  // "solid" | "liquid" | "gas". `heat` (0–1) is how far through that
  // phase's own temperature range you are — scales the vibration/speed
  // continuously, so nudging the temperature slider visibly changes the
  // motion even when it doesn't cross a phase boundary. `resetCamera`
  // false keeps whatever framing the user already dragged/zoomed to,
  // for live updates while dragging the slider — only the very first call
  // (clicking the slot) recenters the view.
  showPhaseCluster(count, phase, colorHex, heat = 0.5, resetCamera = true) {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.electronDots = [];
    this.phaseParticles = [];
    const color = new THREE.Color(colorHex || "#4f8cff");
    const n = Math.max(6, Math.min(30, count || 12));
    const box = phase === "gas" ? 8 : phase === "liquid" ? 4.6 : 3.4;
    const h = Math.max(0, Math.min(1, heat));
    const jitter = phase === "solid" ? 0.04 + h * 0.28 : 0;
    const speed = phase === "gas" ? 2.5 + h * 7 : phase === "liquid" ? 0.3 + h * 2.2 : 0;
    const cols = Math.ceil(Math.sqrt(n));

    for (let i = 0; i < n; i++) {
      const geo = new THREE.SphereGeometry(0.32, 12, 12);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 });
      const mesh = new THREE.Mesh(geo, mat);
      let home;
      if (phase === "solid") {
        const gx = (i % cols) - (cols - 1) / 2;
        const gy = Math.floor(i / cols) - (cols - 1) / 2;
        home = new THREE.Vector3(gx * 0.9, gy * 0.9, (Math.random() - 0.5) * 0.9);
      } else {
        home = new THREE.Vector3((Math.random() - 0.5) * box, (Math.random() - 0.5) * box, (Math.random() - 0.5) * box);
      }
      mesh.position.copy(home);
      this.group.add(mesh);
      const vel = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5));
      if (vel.lengthSq() > 0) vel.normalize().multiplyScalar(speed);
      this.phaseParticles.push({ mesh, phase, home: home.clone(), vel, box, jitter, speed });
    }

    if (!resetCamera) return;
    const span = box * 1.5;
    this.camera.position.set(0, span * 0.5, span * 1.5);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 3;
    this.controls.update();
  }

  // element: { number, symbol, shells }, color: category color hex string
  showElement(element, colorHex) {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.electronDots = [];
    this.phaseParticles = [];

    const protonCount = element.number;
    const neutronCount = Math.max(0, Math.round(element.mass) - element.number);
    const color = new THREE.Color(colorHex || "#4f8cff");

    // Nucleus: small cluster of proton/neutron spheres packed near center.
    const nucleusGroup = new THREE.Group();
    const nucleonRadius = 0.34;
    const total = Math.min(protonCount + neutronCount, 60); // cap for sanity on huge nuclei
    const protonShare = total > 0 ? protonCount / (protonCount + neutronCount) : 1;
    for (let i = 0; i < total; i++) {
      const isProton = i < Math.round(total * protonShare);
      const geo = new THREE.SphereGeometry(nucleonRadius, 12, 12);
      const mat = new THREE.MeshStandardMaterial({
        color: isProton ? 0xff5c5c : 0xdfe3ea,
        roughness: 0.5, metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const packRadius = 0.55 * Math.cbrt(total);
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r = Math.random() * packRadius;
      mesh.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      nucleusGroup.add(mesh);
    }
    this.group.add(nucleusGroup);

    // Electron shells: one tilted ring per shell, electrons distributed
    // evenly around it and animated orbiting.
    const shells = element.shells;
    shells.forEach((count, i) => {
      const shellRadius = 2.2 + i * 1.7;
      const tilt = (i % 2 === 0 ? 1 : -1) * (0.25 + (i % 3) * 0.12);

      const ringGeo = new THREE.TorusGeometry(shellRadius, 0.02, 8, 96);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2 + tilt;
      this.group.add(ring);

      const ringGroup = new THREE.Group();
      ringGroup.rotation.x = Math.PI / 2 + tilt;
      this.group.add(ringGroup);

      for (let e = 0; e < count; e++) {
        const geo = new THREE.SphereGeometry(0.22, 12, 12);
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.3 });
        const mesh = new THREE.Mesh(geo, mat);
        ringGroup.add(mesh);
        this.electronDots.push({
          mesh,
          radius: shellRadius,
          speed: 0.35 / Math.sqrt(i + 1),
          phase: (e / count) * Math.PI * 2,
        });
      }
    });

    const maxRadius = Math.max(2.2 + Math.max(0, shells.length - 1) * 1.7, 3.5);
    this.camera.position.set(0, maxRadius * 0.6, maxRadius * 1.7);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  // A simplified ball-and-stick view of a reacted molecule — shows every
  // atom involved together, not full VSEPR-accurate bond angles (the
  // outer atoms are spread evenly around the central one via a Fibonacci
  // sphere rather than each molecule's real geometry).
  // atoms: [{ symbol, colorHex }], one entry per atom in the molecule.
  // Atoms fly in from outside and settle into place, bonds growing in right
  // after — plays automatically every time a reaction result comes in
  // (no separate button), so "elements combining" actually reads as a
  // reaction happening, not just a finished diagram appearing.
  showMolecule(atoms) {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.electronDots = [];
    this.phaseParticles = [];
    this.moleculeAnim = []; // { mesh, from, to, start, duration, bondGrow? } — stepped in _animate()
    if (!atoms.length) return;

    const counts = {};
    atoms.forEach((a) => { counts[a.symbol] = (counts[a.symbol] || 0) + 1; });
    const distinctSymbols = Object.keys(counts);
    const bondLength = 2.6;
    const atomRadius = 0.55;
    const animStart = performance.now();
    const flyDuration = 650;

    // targetPos: where this atom ends up. It starts scattered further out
    // along that same direction from the origin, so it visibly flies inward
    // to its bonded spot rather than just fading in.
    const makeAtomMesh = (colorHex, targetPos) => {
      const geo = new THREE.SphereGeometry(atomRadius, 20, 20);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || "#4f8cff"), roughness: 0.4, metalness: 0.1 });
      const mesh = new THREE.Mesh(geo, mat);
      const dir = targetPos.lengthSq() > 0.0001
        ? targetPos.clone().normalize()
        : new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const from = targetPos.clone().add(dir.multiplyScalar(5 + Math.random() * 3));
      mesh.position.copy(from);
      this.moleculeAnim.push({ mesh, from, to: targetPos.clone(), start: animStart, duration: flyDuration });
      return mesh;
    };
    const makeBond = (p1, p2) => {
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(0.09, 0.09, len, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(p1).add(dir.clone().multiplyScalar(0.5));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      // Bonds only make sense once both atoms have actually arrived — grown
      // in place (scaled along its own length) rather than visible from the
      // first frame, and started a beat after the fly-in so it reads as
      // "then they bond," not simultaneous.
      mesh.scale.y = 0.001;
      this.moleculeAnim.push({ mesh, bondGrow: true, start: animStart + flyDuration * 0.7, duration: 250 });
      return mesh;
    };

    if (distinctSymbols.length === 1) {
      // A pure diatomic/molecule of one element — line them up and bond
      // consecutive atoms.
      atoms.forEach((atom, i) => {
        const x = (i - (atoms.length - 1) / 2) * bondLength;
        const pos = new THREE.Vector3(x, 0, 0);
        const mesh = makeAtomMesh(atom.colorHex, pos);
        this.group.add(mesh);
        if (i > 0) {
          const prevX = (i - 1 - (atoms.length - 1) / 2) * bondLength;
          this.group.add(makeBond(new THREE.Vector3(prevX, 0, 0), pos));
        }
      });
    } else {
      // Central atom = the element with the fewest atoms (matches real
      // chemistry surprisingly often for simple molecules: O in H2O, C in
      // CO2/CH4, N in NH3...); everything else arranged around it.
      const centerSymbol = distinctSymbols.slice().sort((a, b) => counts[a] - counts[b])[0];
      const centerIdx = atoms.findIndex((a) => a.symbol === centerSymbol);
      const center = atoms[centerIdx];
      const outer = atoms.filter((_, i) => i !== centerIdx);

      const centerMesh = makeAtomMesh(center.colorHex, new THREE.Vector3(0, 0, 0));
      this.group.add(centerMesh);

      const n = outer.length;
      outer.forEach((atom, i) => {
        // Fibonacci sphere distribution for a reasonably even spread.
        const yFrac = n > 1 ? 1 - (2 * i) / (n - 1) : 0;
        const radiusAtY = Math.sqrt(Math.max(0, 1 - yFrac * yFrac));
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const theta = goldenAngle * i;
        const pos = new THREE.Vector3(
          Math.cos(theta) * radiusAtY * bondLength,
          yFrac * bondLength,
          Math.sin(theta) * radiusAtY * bondLength
        );
        const mesh = makeAtomMesh(atom.colorHex, pos);
        this.group.add(mesh);
        this.group.add(makeBond(new THREE.Vector3(0, 0, 0), pos));
      });
    }

    const span = bondLength * 2.2;
    this.camera.position.set(0, span * 0.5, span * 1.4);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 3;
    this.controls.update();
  }

  dispose() {
    this.stop();
    window.removeEventListener("resize", this._resize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}
