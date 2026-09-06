import { PLANETS, DWARF_PLANETS, MOONS, planetPosition, moonOffsetFromEarth, moonPhaseAngleRad, dateToJulianDate, julianDateToDate, orbitalPeriodDays, findNextSolarEclipse } from "./astronomyData.js";

// One linear world-units-per-km factor applied to EVERY body — Sun
// included — so relative sizes are all physically accurate at once:
// Jupiter really does end up ~11x Earth's radius, and the Sun really is
// ~10x Jupiter's, not the other way around. The floor below only exists so
// the smallest dwarf planets stay clickable.
const RADIUS_SCALE = 0.00019;
const MIN_BODY_SIZE = 0.12;
const SUN_RADIUS_KM = 696000;
// Scene units per AU. Distances are still compressed for visibility (a
// real-scale Neptune would be unnavigably far away), but this can't be
// picked independently of RADIUS_SCALE any more — once the Sun is sized
// accurately (huge), Mercury's orbit has to clear its surface with real
// clearance or the inner planets end up literally inside/behind it,
// invisible and unclickable. 850 keeps Mercury's compressed orbit at about
// 2.5 Sun-radii out — comfortably clear, while still far more compact than
// true astronomical scale (which would put Neptune ~850,000 units out).
const AU_SCALE = 850;
const SPEEDS = [
  { label: "Paused", daysPerSec: 0 },
  { label: "1 sec/sec (real time)", daysPerSec: 1 / 86400 },
  { label: "1 hr/sec", daysPerSec: 1 / 24 },
  { label: "1 day/sec", daysPerSec: 1 },
  { label: "1 week/sec", daysPerSec: 7 },
  { label: "1 month/sec", daysPerSec: 30 },
  { label: "1 year/sec", daysPerSec: 365 },
];
const DEFAULT_SPEED_INDEX = 1; // "1 sec/sec (real time)"

export class AstronomyMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // { state, showToast }
    this.date = new Date();
    this.speedIndex = DEFAULT_SPEED_INDEX;
    this.selectedPlanet = null;
    this._build();
  }

  mount() { this._running = true; this._animate(); }
  unmount() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); this._lastFrameMs = null; }

  _build() {
    this.root.innerHTML = "";
    this.controlsPanel = div("chem-panel anat-layers");
    this.viewerPanel = div("chem-panel anat-viewer");
    this.infoPanel = div("chem-panel anat-info");
    this.root.appendChild(this.controlsPanel);
    this.root.appendChild(this.viewerPanel);
    this.root.appendChild(this.infoPanel);

    this._buildControls();
    this._buildViewer();
    this._buildInfo();
  }

  _buildControls() {
    const title = div("chem-panel-title");
    title.textContent = "Time Controls";
    this.controlsPanel.appendChild(title);

    this.dateInput = document.createElement("input");
    this.dateInput.type = "datetime-local";
    this.dateInput.className = "astro-date-input";
    this.dateInput.value = toLocalInputValue(this.date);
    this.dateInput.addEventListener("change", () => {
      const d = new Date(this.dateInput.value);
      if (!isNaN(d)) { this.date = d; this._updatePositions(); this._syncTimeSlider(); }
    });
    this.controlsPanel.appendChild(this.dateInput);

    const nowBtn = document.createElement("button");
    nowBtn.textContent = "Jump to Now";
    nowBtn.style.width = "100%";
    nowBtn.style.margin = "8px 0";
    nowBtn.addEventListener("click", () => {
      this.date = new Date();
      this.dateInput.value = toLocalInputValue(this.date);
      this._updatePositions();
      this._syncTimeSlider();
    });
    this.controlsPanel.appendChild(nowBtn);

    // A direct ±50-year scrub, anchored to the date this panel was opened —
    // separate from the datetime field above (exact date/time entry) and
    // the playback speed below (animates forward automatically); this is
    // for freely dragging back and forth by hand.
    const sliderLabel = div("chem-hint");
    sliderLabel.textContent = "Scrub time (±50 years)";
    this.controlsPanel.appendChild(sliderLabel);
    this._timeReference = new Date(this.date);
    const maxDays = 50 * 365.25;
    this.timeSlider = document.createElement("input");
    this.timeSlider.type = "range";
    this.timeSlider.className = "astro-time-slider";
    this.timeSlider.min = String(-maxDays);
    this.timeSlider.max = String(maxDays);
    this.timeSlider.step = "1";
    this.timeSlider.value = "0";
    this.timeSliderReadout = div("astro-time-slider-readout");
    this.timeSliderReadout.textContent = "today";
    this.timeSlider.addEventListener("input", () => {
      const days = +this.timeSlider.value;
      this.date = new Date(this._timeReference.getTime() + days * 86400000);
      this.dateInput.value = toLocalInputValue(this.date);
      this._updatePositions();
      const years = Math.abs(days / 365.25).toFixed(1);
      this.timeSliderReadout.textContent = days === 0 ? "today" : `${years} yr ${days > 0 ? "ahead" : "back"}`;
    });
    this.controlsPanel.appendChild(this.timeSlider);
    this.controlsPanel.appendChild(this.timeSliderReadout);

    const speedLabel = div("chem-hint");
    speedLabel.textContent = "Playback speed (space to pause)";
    this.controlsPanel.appendChild(speedLabel);
    const speedRow = div("astro-speed-row");
    this.speedButtons = SPEEDS.map((s, i) => {
      const btn = document.createElement("button");
      btn.textContent = s.label;
      btn.className = "astro-speed-btn" + (i === this.speedIndex ? " active" : "");
      btn.addEventListener("click", () => this._setSpeedIndex(i));
      speedRow.appendChild(btn);
      return btn;
    });
    this.controlsPanel.appendChild(speedRow);

    const hint = div("chem-hint");
    hint.style.marginTop = "14px";
    hint.textContent = "Planet positions are computed from real orbital elements for whatever date/time is set above — not a canned animation. Every body here — Sun included — is sized on one consistent real-world scale, so the Sun really is this dramatically bigger than Jupiter, and Jupiter really is bigger than Earth. Distances between orbits are still compressed for visibility (true-to-scale would put Neptune far off-screen), so start zoomed in on the inner planets and scroll out to reach the rest. Drag to rotate the view, scroll to zoom, and right-click-drag (or hold Shift while dragging) to pan.";
    this.controlsPanel.appendChild(hint);

    const chalBtn = document.createElement("button");
    chalBtn.textContent = "Astronomy Challenges";
    chalBtn.className = "primary";
    chalBtn.style.width = "100%";
    chalBtn.style.marginTop = "14px";
    chalBtn.addEventListener("click", () => this._openChallenges());
    this.controlsPanel.appendChild(chalBtn);
    this.challengeModal = buildChallengeModal(this.ctx, () => this.date, (d) => { this.date = d; this.dateInput.value = toLocalInputValue(d); this._updatePositions(); this._syncTimeSlider(); });
    this.controlsPanel.appendChild(this.challengeModal.el);
  }

  _buildViewer() {
    const title = div("chem-panel-title");
    title.textContent = "Solar System";
    this.viewerPanel.appendChild(title);

    const wrap = div("anat-svg-wrap");
    wrap.style.height = "100%";
    this.viewerPanel.appendChild(wrap);

    this.scene = new THREE.Scene();
    // Far plane and starting distance are both driven by the Sun's now
    // real-scale size and AU_SCALE — a real-scale Sun plus real-clearance
    // orbits makes for a much bigger scene than before. The starting
    // position frames the Sun through Mars by default (Jupiter onward
    // needs scrolling out to reach, same as any solar-system model at this
    // dynamic range).
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 40000);
    this.camera.position.set(0, 900, 1600);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    wrap.appendChild(this.renderer.domElement);
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    // Defaults (minDistance 0, zoomSpeed 1) let OrbitControls dolly the
    // camera essentially on top of its own target with no meaningful
    // change in framing once close, which reads as "zoom barely does
    // anything" — a wider zoom speed plus an explicit near/far range fixes
    // that and lets you get close enough to inspect a real-scale Mercury
    // or dwarf planet, or pull back past Neptune's orbit.
    this.controls.zoomSpeed = 2.2;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 30000;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    // Right-click-drag already pans by default, but that's easy to miss —
    // hold Shift to pan with the primary drag too, so the view doesn't stay
    // locked orbiting the sun forever.
    this._onPanKeyDown = (e) => { if (e.key === "Shift") this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN; };
    this._onPanKeyUp = (e) => { if (e.key === "Shift") this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; };
    window.addEventListener("keydown", this._onPanKeyDown);
    window.addEventListener("keyup", this._onPanKeyUp);

    // Space toggles play/pause, same shortcut Physics mode uses — gated on
    // this mode actually being the visible one, and skipped while a text
    // field has focus, so it doesn't fight typing a date or steal the page
    // scroll (Space's default action) elsewhere in the app.
    this._onSpaceDown = (e) => {
      if (e.code !== "Space" || this.ctx.state?.mode !== "astronomy") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      this._togglePause();
    };
    window.addEventListener("keydown", this._onSpaceDown);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sunLight = new THREE.PointLight(0xffffff, 2.2, 0, 0.15);
    this.scene.add(sunLight);

    const sunRadius = SUN_RADIUS_KM * RADIUS_SCALE;
    const sunGeo = new THREE.SphereGeometry(sunRadius, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sunMesh);

    this.planetMeshes = {};
    this.orbitLines = {};
    const jdNow = dateToJulianDate(this.date);
    const buildPlanetLike = (planet, { dwarf = false } = {}) => {
      const size = Math.max(MIN_BODY_SIZE, planet.radiusKm * RADIUS_SCALE);
      const geo = new THREE.SphereGeometry(size, dwarf ? 10 : 18, dwarf ? 10 : 18);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(planet.color), roughness: 0.7 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.planet = planet;
      mesh.userData.size = size;
      mesh.userData.dwarf = dwarf;
      this.scene.add(mesh);
      this.planetMeshes[planet.name] = mesh;

      // A lat/long wireframe grid, a hair larger than the sphere itself and
      // parented to it, makes the spin actually visible — a uniformly-
      // colored sphere rotating in place looks identical frame to frame
      // otherwise. Being a child of the mesh, it inherits its rotation for
      // free. It also doubles as a selection indicator: brightens to the
      // accent color while this planet is the selected one.
      const gridGeo = new THREE.SphereGeometry(size * 1.015, 12, 8);
      const gridMat = new THREE.MeshBasicMaterial({ color: 0x8a94a3, wireframe: true, transparent: true, opacity: 0.45 });
      const grid = new THREE.Mesh(gridGeo, gridMat);
      mesh.add(grid);
      mesh.userData.gridMat = gridMat;

      const orbitGeo = new THREE.BufferGeometry();
      const points = [];
      const periodDays = orbitalPeriodDays(planet);
      for (let i = 0; i <= 90; i++) {
        const pos = planetPosition(planet, jdNow - periodDays / 2 + (i / 90) * periodDays);
        points.push(new THREE.Vector3(pos.x * AU_SCALE, pos.z * AU_SCALE, pos.y * AU_SCALE));
      }
      orbitGeo.setFromPoints(points);
      const orbitMat = new THREE.LineBasicMaterial({ color: new THREE.Color(planet.color), transparent: true, opacity: dwarf ? 0.18 : 0.35 });
      const line = new THREE.LineLoop(orbitGeo, orbitMat);
      this.scene.add(line);
      this.orbitLines[planet.name] = line;
    };
    for (const planet of PLANETS) buildPlanetLike(planet);
    for (const dwarf of DWARF_PLANETS) buildPlanetLike(dwarf, { dwarf: true });

    // Main asteroid belt — a scattered field of points between Mars (~1.52
    // AU) and Jupiter (~5.2 AU), roughly matching the real belt's 2.1–3.3 AU
    // span. Purely decorative (no individual orbital elements per rock —
    // there are hundreds of thousands of real ones), but it does slowly
    // rotate as a whole at a representative belt orbital rate.
    const beltCount = 1400;
    const beltPositions = new Float32Array(beltCount * 3);
    for (let i = 0; i < beltCount; i++) {
      const r = (2.1 + Math.random() * 1.2) * AU_SCALE;
      const angle = Math.random() * Math.PI * 2;
      const height = (Math.random() - 0.5) * 0.35 * AU_SCALE;
      beltPositions[i * 3] = Math.cos(angle) * r;
      beltPositions[i * 3 + 1] = height;
      beltPositions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const beltGeo = new THREE.BufferGeometry();
    beltGeo.setAttribute("position", new THREE.BufferAttribute(beltPositions, 3));
    const beltMat = new THREE.PointsMaterial({ color: 0x9a8f7d, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.75 });
    this.asteroidBelt = new THREE.Points(beltGeo, beltMat);
    // ~4.6-year average belt orbital period (a ≈ 2.7 AU) — one slow spin
    // stands in for the whole field drifting together.
    this.asteroidBeltPeriodDays = 4.6 * 365.25;
    this.scene.add(this.asteroidBelt);

    const moonGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const moonMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.scene.add(this.moonMesh);

    // Other major moons — simple circular orbits around their host planet,
    // spaced outward so multiple moons of the same planet don't overlap.
    // Size uses the same RADIUS_SCALE as planets (so e.g. Ganymede still
    // reads as ~26x smaller than Jupiter, matching reality), but orbit
    // distance is deliberately exaggerated relative to the host planet's
    // own radius — real moon orbits are tiny enough that at true scale
    // they'd render inside their planet's own sphere.
    this.moonMeshes = [];
    const moonIndexByHost = {};
    for (const moon of MOONS) {
      const idx = moonIndexByHost[moon.host] || 0;
      moonIndexByHost[moon.host] = idx + 1;
      const size = Math.max(MIN_BODY_SIZE, moon.radiusKm * RADIUS_SCALE);
      const geo = new THREE.SphereGeometry(size, 10, 10);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(moon.color), roughness: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh);
      const hostMesh = this.planetMeshes[moon.host];
      const visualDist = (hostMesh?.userData.size || 1) * (3.2 + idx * 1.3);

      // A faint guide ring at the moon's orbit radius around its host, so
      // "this planet has moons" is visible even before you zoom in on one.
      const ringGeo = new THREE.BufferGeometry();
      const ringPts = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        ringPts.push(new THREE.Vector3(Math.cos(a) * visualDist, 0, Math.sin(a) * visualDist));
      }
      ringGeo.setFromPoints(ringPts);
      const ringMat = new THREE.LineBasicMaterial({ color: new THREE.Color(moon.color), transparent: true, opacity: 0.3 });
      const ring = new THREE.LineLoop(ringGeo, ringMat);
      this.scene.add(ring);

      this.moonMeshes.push({ moon, mesh, ring, visualDist });
    }

    // A sparse wireframe halo around whichever planet is selected —
    // repositioned and rescaled to that planet every frame in
    // _updatePositions.
    const ringGeo = new THREE.SphereGeometry(1, 8, 6);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6, depthTest: false });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 10;
    this.scene.add(this.selectionRing);

    this.renderer.domElement.addEventListener("click", (e) => this._pickPlanet(e));

    const resize = () => {
      const w = wrap.clientWidth || 400, h = wrap.clientHeight || 400;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);
    this._resize = resize;

    this._updatePositions();
  }

  _pickPlanet(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const hits = raycaster.intersectObjects(Object.values(this.planetMeshes));
    if (hits.length) {
      this.selectedPlanet = hits[0].object.userData.planet;
      this._buildInfo();
      this._updateSelectionRing();
    }
  }

  _updateSelectionRing() {
    // Reset every planet's own rotation grid back to its resting color,
    // then brighten only the selected one — cheaper than tracking which
    // one was previously lit.
    for (const mesh of Object.values(this.planetMeshes)) {
      mesh.userData.gridMat?.color.set(0x8a94a3);
      if (mesh.userData.gridMat) mesh.userData.gridMat.opacity = 0.45;
    }
    if (!this.selectionRing) return;
    if (!this.selectedPlanet) { this.selectionRing.visible = false; return; }
    const mesh = this.planetMeshes[this.selectedPlanet.name];
    if (!mesh) { this.selectionRing.visible = false; return; }
    this.selectionRing.visible = true;
    this.selectionRing.position.copy(mesh.position);
    const s = (mesh.userData.size || 1) * 1.6;
    this.selectionRing.scale.set(s, s, s);
    if (mesh.userData.gridMat) {
      mesh.userData.gridMat.color.set(0xffd76b);
      mesh.userData.gridMat.opacity = 0.9;
    }
  }

  _updatePositions() {
    const jd = dateToJulianDate(this.date);
    for (const planet of [...PLANETS, ...DWARF_PLANETS]) {
      const pos = planetPosition(planet, jd);
      const mesh = this.planetMeshes[planet.name];
      mesh.position.set(pos.x * AU_SCALE, pos.z * AU_SCALE, pos.y * AU_SCALE);
      // Axial spin is a pure function of the date too, same as orbital
      // position — no accumulated per-frame state, so scrubbing the date
      // instantly (not just animating forward) still shows the right phase.
      // Reduce mod 2π in JS's double precision *before* handing it to
      // Three.js, whose rotation matrices are float32 internally — jd*24
      // in the thousands of years since J2000 divided by a planet's short
      // rotation period accumulates a raw angle in the tens of millions of
      // radians, which float32 can no longer represent to sub-radian
      // accuracy (its ~7 significant digits run out around 1e7) and the
      // spin would visibly stutter/jump instead of turning smoothly.
      const spinTurns = (jd * 24) / planet.rotationHours;
      mesh.rotation.y = (spinTurns - Math.floor(spinTurns)) * Math.PI * 2;
      if (planet.name === "Earth") {
        // The real Earth-Moon distance (0.00257 AU) is honest but useless
        // here: Earth's own sphere is already log-exaggerated to ~1.2 scene
        // units for visibility, so that real distance places the Moon's
        // center well *inside* Earth's mesh — same problem the other
        // planets' moons avoid by orbiting at a multiple of their host's
        // rendered size, not their host's real size. Keep the Moon's real
        // direction (still astronomically accurate) but rescale its
        // distance the same way.
        const moon = moonOffsetFromEarth(jd);
        const realDist = Math.hypot(moon.x, moon.y, moon.z) || 1;
        const dir = { x: moon.x / realDist, y: moon.y / realDist, z: moon.z / realDist };
        const visualDist = (mesh.userData.size || 1) * 3.2;
        this.moonMesh.position.set(
          pos.x * AU_SCALE + dir.x * visualDist,
          pos.z * AU_SCALE + dir.z * visualDist,
          pos.y * AU_SCALE + dir.y * visualDist
        );
      }
    }

    for (const { moon, mesh, ring, visualDist } of this.moonMeshes) {
      const hostMesh = this.planetMeshes[moon.host];
      if (!hostMesh) continue;
      const angle = moonPhaseAngleRad(moon, jd);
      mesh.position.set(
        hostMesh.position.x + Math.cos(angle) * visualDist,
        hostMesh.position.y,
        hostMesh.position.z + Math.sin(angle) * visualDist
      );
      ring.position.copy(hostMesh.position);
    }

    if (this.asteroidBelt) {
      const turns = jd / this.asteroidBeltPeriodDays;
      this.asteroidBelt.rotation.y = (turns - Math.floor(turns)) * Math.PI * 2;
    }

    this._updateSelectionRing();
    if (this.dateLabel) this.dateLabel.textContent = this.date.toUTCString();
    if (this.selectedPlanet) this._refreshInfoNumbers();
  }

  _buildInfo() {
    this.infoPanel.innerHTML = "";
    const title = div("chem-panel-title");
    title.textContent = "Details";
    this.infoPanel.appendChild(title);

    this.dateLabel = div("astro-date-label");
    this.dateLabel.textContent = this.date.toUTCString();
    this.infoPanel.appendChild(this.dateLabel);

    if (!this.selectedPlanet) {
      const empty = div("panel-empty");
      empty.textContent = "Click a planet in the view to see details.";
      this.infoPanel.appendChild(empty);
      return;
    }
    this.infoCard = div("chem-info-card");
    this.infoPanel.appendChild(this.infoCard);
    this._refreshInfoNumbers();
  }

  _refreshInfoNumbers() {
    if (!this.infoCard || !this.selectedPlanet) return;
    const p = this.selectedPlanet;
    const jd = dateToJulianDate(this.date);
    const pos = planetPosition(p, jd);
    const dist = Math.hypot(pos.x, pos.y, pos.z);
    this.infoCard.innerHTML = `
      <div class="chem-info-title">${p.name}</div>
      <div class="chem-info-row"><span>Distance from Sun</span><b>${dist.toFixed(3)} AU</b></div>
      <div class="chem-info-row"><span>Orbital period</span><b>${(orbitalPeriodDays(p) / 365.25).toFixed(2)} years</b></div>
      <div class="chem-info-row"><span>Orbital eccentricity</span><b>${pos.e.toFixed(3)}</b></div>
      <div class="chem-info-row"><span>Radius</span><b>${p.radiusKm.toLocaleString()} km</b></div>
    `;
  }

  _setSpeedIndex(i) {
    this.speedIndex = i;
    this.speedButtons?.forEach((b, idx) => b.classList.toggle("active", idx === i));
  }

  _togglePause() {
    if (this.speedIndex === 0) {
      this._setSpeedIndex(this._lastActiveSpeedIndex ?? DEFAULT_SPEED_INDEX);
    } else {
      this._lastActiveSpeedIndex = this.speedIndex;
      this._setSpeedIndex(0);
    }
  }

  _animate() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(() => this._animate());
    // Real elapsed time since the last frame, not an assumed fixed 60fps —
    // "1 sec/sec (real time)" only actually runs at real-world speed if
    // this accounts for the display's actual refresh rate (120Hz+ displays,
    // or a throttled/backgrounded tab, would otherwise run faster or
    // slower than intended).
    const now = performance.now();
    const realDtSec = this._lastFrameMs ? Math.min((now - this._lastFrameMs) / 1000, 0.25) : 1 / 60;
    this._lastFrameMs = now;
    const speed = SPEEDS[this.speedIndex].daysPerSec;
    if (speed > 0) {
      this.date = new Date(this.date.getTime() + speed * 86400000 * realDtSec);
      if (this.dateInput) this.dateInput.value = toLocalInputValue(this.date);
      this._updatePositions();
      this._syncTimeSlider();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Keeps the ±50-year scrub slider showing the right offset whenever the
  // date changes from somewhere else (typing a date, Jump to Now, playback,
  // or jumping to a challenge result) — clamped to the slider's own range
  // rather than erroring if the date lands outside it.
  _syncTimeSlider() {
    if (!this.timeSlider) return;
    const maxDays = +this.timeSlider.max;
    const days = (this.date.getTime() - this._timeReference.getTime()) / 86400000;
    const clamped = Math.max(-maxDays, Math.min(maxDays, days));
    this.timeSlider.value = String(clamped);
    const years = Math.abs(clamped / 365.25).toFixed(1);
    this.timeSliderReadout.textContent = Math.abs(days) < 0.5 ? "today" : `${years} yr ${days > 0 ? "ahead" : "back"}${Math.abs(days) > maxDays ? " (off slider)" : ""}`;
  }

  _openChallenges() {
    this.challengeModal.open();
  }
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function div(className) {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

function buildChallengeModal(ctx, getDate, setDate) {
  const el = div("modal hidden");
  const box = div("modal-box");
  box.innerHTML = `<h2>Astronomy Challenges</h2><div class="astro-challenge-list"></div>`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => el.classList.add("hidden"));
  box.appendChild(closeBtn);
  el.appendChild(box);
  const list = box.querySelector(".astro-challenge-list");

  function render() {
    list.innerHTML = "";
    const row = div("shop-item");
    row.innerHTML = `
      <div class="info">
        <div class="name">Find the Next Solar Eclipse</div>
        <div class="concept-tag">Orbital alignment (syzygy)</div>
        <div class="desc">A solar eclipse needs a new moon that also happens to fall near one of the Moon's orbital nodes — where its tilted orbit crosses the Sun-Earth plane. Search forward from the current date to find the next one.</div>
      </div>
    `;
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Search";
    btn.addEventListener("click", () => {
      const result = findNextSolarEclipse(getDate());
      const resultEl = div("astro-eclipse-result");
      resultEl.innerHTML = `
        <div class="chem-result-formula" style="font-size:16px">${result.date.toDateString()}</div>
        <div class="chem-result-note">
          Predicted new moon around ${result.date.toUTCString()}, ${Math.abs(result.moonLatitude).toFixed(2)}° from the ecliptic
          (closer to 0° means a stronger chance of an actual eclipse — real solar eclipses happen when this is roughly under 1.5°).
          ${result.likely ? "This one lines up closely — a real eclipse is likely somewhere on Earth around this date." : "This is the closest alignment found, but it's not a particularly tight one — a partial eclipse at best, if any, is more likely than total."}
          <br><br><em>Estimated with a simplified (Meeus low-precision) lunar model, accurate to roughly a day — not a to-the-minute NASA-grade prediction.</em>
        </div>
        <button class="primary" id="astro-jump-btn">Jump the calendar to this date</button>
      `;
      list.appendChild(resultEl);
      resultEl.querySelector("#astro-jump-btn").addEventListener("click", () => {
        setDate(result.date);
        if (result.likely) {
          ctx.state.completedChallenges.add("astro_find_eclipse");
          ctx.showToast("Challenge complete: Found the next solar eclipse!");
        }
      });
    });
    row.appendChild(btn);
    list.appendChild(row);
  }

  return {
    el,
    open() { render(); el.classList.remove("hidden"); },
  };
}
