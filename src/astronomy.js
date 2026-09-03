import { PLANETS, planetPosition, moonOffsetFromEarth, dateToJulianDate, julianDateToDate, orbitalPeriodDays, findNextSolarEclipse } from "./astronomyData.js";

const AU_SCALE = 22; // scene units per AU — not to real scale, or Neptune would be a speck 30x farther than Mercury
const SPEEDS = [
  { label: "Paused", daysPerSec: 0 },
  { label: "1 hr/sec", daysPerSec: 1 / 24 },
  { label: "1 day/sec", daysPerSec: 1 },
  { label: "1 week/sec", daysPerSec: 7 },
  { label: "1 month/sec", daysPerSec: 30 },
  { label: "1 year/sec", daysPerSec: 365 },
];

export class AstronomyMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // { state, showToast }
    this.date = new Date();
    this.speedIndex = 0;
    this.selectedPlanet = null;
    this._build();
  }

  mount() { this._running = true; this._animate(); }
  unmount() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); }

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
      if (!isNaN(d)) { this.date = d; this._updatePositions(); }
    });
    this.controlsPanel.appendChild(this.dateInput);

    const nowBtn = document.createElement("button");
    nowBtn.textContent = "Jump to Now";
    nowBtn.style.width = "100%";
    nowBtn.style.margin = "8px 0";
    nowBtn.addEventListener("click", () => { this.date = new Date(); this.dateInput.value = toLocalInputValue(this.date); this._updatePositions(); });
    this.controlsPanel.appendChild(nowBtn);

    const speedLabel = div("chem-hint");
    speedLabel.textContent = "Playback speed";
    this.controlsPanel.appendChild(speedLabel);
    this.speedSelect = document.createElement("select");
    SPEEDS.forEach((s, i) => {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = s.label;
      this.speedSelect.appendChild(opt);
    });
    this.speedSelect.value = this.speedIndex;
    this.speedSelect.addEventListener("change", () => { this.speedIndex = +this.speedSelect.value; });
    this.controlsPanel.appendChild(this.speedSelect);

    const hint = div("chem-hint");
    hint.style.marginTop = "14px";
    hint.textContent = "Planet positions are computed from real orbital elements for whatever date/time is set above — not a canned animation. Distances are compressed for visibility; sizes are exaggerated so the inner planets aren't invisible specks.";
    this.controlsPanel.appendChild(hint);

    const chalBtn = document.createElement("button");
    chalBtn.textContent = "Astronomy Challenges";
    chalBtn.className = "primary";
    chalBtn.style.width = "100%";
    chalBtn.style.marginTop = "14px";
    chalBtn.addEventListener("click", () => this._openChallenges());
    this.controlsPanel.appendChild(chalBtn);
    this.challengeModal = buildChallengeModal(this.ctx, () => this.date, (d) => { this.date = d; this.dateInput.value = toLocalInputValue(d); this._updatePositions(); });
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
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 3000);
    this.camera.position.set(0, 160, 220);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    wrap.appendChild(this.renderer.domElement);
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sunLight = new THREE.PointLight(0xffffff, 2.2, 0, 0.15);
    this.scene.add(sunLight);

    const sunGeo = new THREE.SphereGeometry(4, 24, 24);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this.scene.add(new THREE.Mesh(sunGeo, sunMat));

    this.planetMeshes = {};
    this.orbitLines = {};
    for (const planet of PLANETS) {
      const size = Math.max(0.7, Math.log10(planet.radiusKm) * 0.9 - 2.2);
      const geo = new THREE.SphereGeometry(size, 18, 18);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(planet.color), roughness: 0.7 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.planet = planet;
      mesh.userData.size = size;
      this.scene.add(mesh);
      this.planetMeshes[planet.name] = mesh;

      // A small dark marker at the equator makes the sphere's own spin
      // actually visible — a uniformly-colored sphere rotating in place
      // looks identical frame to frame otherwise.
      const markerGeo = new THREE.SphereGeometry(size * 0.16, 8, 8);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0x1b1e24 });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(size, 0, 0);
      mesh.add(marker);

      const orbitGeo = new THREE.BufferGeometry();
      const points = [];
      const periodDays = orbitalPeriodDays(planet);
      const jdNow = dateToJulianDate(this.date);
      for (let i = 0; i <= 90; i++) {
        const pos = planetPosition(planet, jdNow - periodDays / 2 + (i / 90) * periodDays);
        points.push(new THREE.Vector3(pos.x * AU_SCALE, pos.z * AU_SCALE, pos.y * AU_SCALE));
      }
      orbitGeo.setFromPoints(points);
      const orbitMat = new THREE.LineBasicMaterial({ color: new THREE.Color(planet.color), transparent: true, opacity: 0.35 });
      const line = new THREE.LineLoop(orbitGeo, orbitMat);
      this.scene.add(line);
      this.orbitLines[planet.name] = line;
    }

    const moonGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const moonMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.scene.add(this.moonMesh);

    // A wireframe halo around whichever planet is selected — repositioned
    // and rescaled to that planet every frame in _updatePositions.
    const ringGeo = new THREE.SphereGeometry(1, 20, 20);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.85, depthTest: false });
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
    if (!this.selectionRing) return;
    if (!this.selectedPlanet) { this.selectionRing.visible = false; return; }
    const mesh = this.planetMeshes[this.selectedPlanet.name];
    if (!mesh) { this.selectionRing.visible = false; return; }
    this.selectionRing.visible = true;
    this.selectionRing.position.copy(mesh.position);
    const s = (mesh.userData.size || 1) * 1.6;
    this.selectionRing.scale.set(s, s, s);
  }

  _updatePositions() {
    const jd = dateToJulianDate(this.date);
    for (const planet of PLANETS) {
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
        const moon = moonOffsetFromEarth(jd);
        this.moonMesh.position.set(
          (pos.x + moon.x * 6) * AU_SCALE,
          (pos.z + moon.z * 6) * AU_SCALE,
          (pos.y + moon.y * 6) * AU_SCALE
        );
      }
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

  _animate() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(() => this._animate());
    const speed = SPEEDS[this.speedIndex].daysPerSec;
    if (speed > 0) {
      this.date = new Date(this.date.getTime() + speed * 86400000 / 60);
      if (this.dateInput) this.dateInput.value = toLocalInputValue(this.date);
      this._updatePositions();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
