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
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // element: { number, symbol, shells }, color: category color hex string
  showElement(element, colorHex) {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.electronDots = [];

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

  dispose() {
    this.stop();
    window.removeEventListener("resize", this._resize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}
