// Kinetic Plus — Custom Physics Items. A small polygon editor (drag
// vertices, add/remove them) that produces a real Matter.js collision
// shape, not a decorative outline over a circle/rectangle — see
// physics.js's "customPolygon" case, which passes these exact vertices to
// Bodies.fromVertices. Deliberately NOT a CAD tool: one editable shape at
// a time, no boolean ops, no curves.
//
// Geometry is restricted to SIMPLE (non-self-intersecting) polygons —
// concave is allowed. Matter.Common.setDecomp (below) hands Bodies.
// fromVertices poly-decomp, which decomposes a concave-but-simple polygon
// into convex parts automatically; poly-decomp itself requires simple
// input, so a self-intersecting (bowtie) shape is the one case that's
// still rejected at save time. Keeping the visible shape and the
// collision shape identical is the one invariant this feature must never
// break, which is exactly what "simple" (vs. self-intersecting) buys us.
import { getUser, fetchItems, createItem, updateSavedItem, deleteSavedItem } from "./auth.js";
import { regularPolygon, isSimplePolygon } from "./objectTypes.js";
import { alertPopup, confirmPopup, promptPopup } from "./popup.js";
import { materialOf, MATERIAL_LIST } from "./materials.js";

if (window.decomp) Matter.Common.setDecomp(window.decomp);

let modal, box, placeFn;
const EDITOR_SIZE = 280;
const EDITOR_CENTER = EDITOR_SIZE / 2;

export function initCustomItemsUI(onPlace) {
  placeFn = onPlace;
  modal = document.getElementById("custom-item-modal");
  box = document.getElementById("custom-item-modal-box");
}

export function openCustomItemsHome() {
  const user = getUser();
  if (!user) { document.getElementById("account-btn").click(); return; }
  if (!user.entitlements?.limits?.customItemsEnabled) {
    box.innerHTML = `
      <h2>Custom Physics Items <span class="plus-badge">PLUS</span></h2>
      <p class="panel-empty">A Kinetic Plus feature — build your own polygon-shaped physics object, vertex by vertex, with real collision geometry matching exactly what you draw.</p>
      <button id="ci-see-plans" class="primary">See Plans</button>
      <button id="ci-close">Close</button>
    `;
    modal.classList.remove("hidden");
    box.querySelector("#ci-close").addEventListener("click", () => modal.classList.add("hidden"));
    box.querySelector("#ci-see-plans").addEventListener("click", () => { modal.classList.add("hidden"); document.getElementById("plans-btn").click(); });
    return;
  }
  modal.classList.remove("hidden");
  renderHome();
}

async function renderHome() {
  box.innerHTML = `<h2>Custom Physics Items</h2><p class="panel-empty">Loading…</p>`;
  const items = await fetchItems("custom-items").catch(() => null);
  if (items === null) {
    box.innerHTML = `<h2>Custom Physics Items</h2><p class="panel-empty">Couldn't load your items right now.</p><button id="ci-close">Close</button>`;
    box.querySelector("#ci-close").addEventListener("click", () => modal.classList.add("hidden"));
    return;
  }
  box.innerHTML = `
    <h2>Custom Physics Items</h2>
    <p class="saves-hint">A polygon-shaped physics object you design — real collision geometry, not just a picture.</p>
    <button id="ci-new" class="primary">+ Create new shape</button>
    <div class="saves-list" style="margin-top:12px">
      ${items.length === 0 ? '<p class="saves-empty">No custom items yet.</p>' : items.map((it) => `
        <div class="saves-item" data-id="${it.id}">
          <div class="saves-item-info">
            <div class="saves-item-name">${escapeHtml(it.name)}</div>
            <div class="saves-item-date">${it.data.vertices.length} vertices · ${escapeHtml(materialOf(it.data.material).label || it.data.material)}</div>
          </div>
          <div class="saves-item-actions">
            <button class="ci-place" data-id="${it.id}">Place</button>
            <button class="ci-edit" data-id="${it.id}">Edit</button>
            <button class="ci-duplicate" data-id="${it.id}">Duplicate</button>
            <button class="ci-delete" data-id="${it.id}">Delete</button>
          </div>
        </div>
      `).join("")}
    </div>
    <button id="ci-close" style="margin-top:12px">Close</button>
  `;
  box.querySelector("#ci-close").addEventListener("click", () => modal.classList.add("hidden"));
  box.querySelector("#ci-new").addEventListener("click", () => openEditor(null));
  box.querySelectorAll(".ci-place").forEach((b) => b.addEventListener("click", () => {
    const it = items.find((x) => x.id === b.dataset.id);
    placeFn({ vertices: it.data.vertices, name: it.name, material: it.data.material });
    modal.classList.add("hidden");
  }));
  box.querySelectorAll(".ci-edit").forEach((b) => b.addEventListener("click", () => {
    openEditor(items.find((x) => x.id === b.dataset.id));
  }));
  box.querySelectorAll(".ci-duplicate").forEach((b) => b.addEventListener("click", async () => {
    const it = items.find((x) => x.id === b.dataset.id);
    const result = await createItem("custom-items", `${it.name} (copy)`, it.data);
    if (result.error) { await alertPopup(result.error, { title: "Couldn't duplicate" }); return; }
    renderHome();
  }));
  box.querySelectorAll(".ci-delete").forEach((b) => b.addEventListener("click", async () => {
    const ok = await confirmPopup("Delete this custom item? This can't be undone.", { title: "Delete item", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await deleteSavedItem("custom-items", b.dataset.id);
    renderHome();
  }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- the shape editor ----------

function openEditor(existing) {
  const state = {
    id: existing?.id || null,
    name: existing?.name || "",
    material: existing?.data?.material || "wood",
    // Local editor coords: origin at EDITOR_CENTER, Y down (SVG convention).
    // Converted to centroid-relative model coords (Y still down, matching
    // every other vertex list in this app) only on save.
    vertices: existing ? existing.data.vertices.map((p) => ({ x: p.x + EDITOR_CENTER, y: p.y + EDITOR_CENTER })) : regularPolygon(6, 80).map((p) => ({ x: p.x + EDITOR_CENTER, y: p.y + EDITOR_CENTER })),
  };

  box.innerHTML = `
    <h2>${existing ? "Edit" : "Create"} Custom Item</h2>
    <p class="saves-hint">Drag any point to reshape it — concave shapes (caving-in corners) are fine, just no crossed/self-intersecting edges. That's what keeps the collision shape exactly matching what you see.</p>
    <svg id="ci-svg" width="${EDITOR_SIZE}" height="${EDITOR_SIZE}" style="background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;display:block;margin:0 auto;touch-action:none;"></svg>
    <div id="ci-validity" class="promo-feedback" style="text-align:center"></div>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:8px">
      <button id="ci-add-vertex">+ Vertex</button>
      <button id="ci-remove-vertex">− Vertex</button>
      <button id="ci-reset-shape">Reset shape</button>
    </div>
    <label>Material</label>
    <select id="ci-material"></select>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button id="ci-save" class="primary">Save</button>
      <button id="ci-cancel">Cancel</button>
    </div>
  `;

  const materialSelect = box.querySelector("#ci-material");
  for (const key of MATERIAL_LIST) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = materialOf(key).label || key;
    if (key === state.material) opt.selected = true;
    materialSelect.appendChild(opt);
  }
  materialSelect.addEventListener("change", () => { state.material = materialSelect.value; });

  const svg = box.querySelector("#ci-svg");
  const svgNS = "http://www.w3.org/2000/svg";

  function redraw() {
    svg.innerHTML = "";
    const poly = document.createElementNS(svgNS, "polygon");
    poly.setAttribute("points", state.vertices.map((p) => `${p.x},${p.y}`).join(" "));
    const valid = isSimplePolygon(state.vertices);
    poly.setAttribute("fill", valid ? "color-mix(in srgb, var(--cool-1) 35%, transparent)" : "color-mix(in srgb, var(--danger) 30%, transparent)");
    poly.setAttribute("stroke", valid ? "var(--cool-1)" : "var(--danger)");
    poly.setAttribute("stroke-width", "2");
    svg.appendChild(poly);

    state.vertices.forEach((p, i) => {
      const handle = document.createElementNS(svgNS, "circle");
      handle.setAttribute("cx", p.x);
      handle.setAttribute("cy", p.y);
      handle.setAttribute("r", "7");
      handle.setAttribute("fill", "var(--cool-2)");
      handle.setAttribute("stroke", "#fff");
      handle.setAttribute("stroke-width", "1.5");
      handle.style.cursor = "grab";
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const move = (ev) => {
          p.x = Math.max(4, Math.min(EDITOR_SIZE - 4, ev.clientX - rect.left));
          p.y = Math.max(4, Math.min(EDITOR_SIZE - 4, ev.clientY - rect.top));
          redraw();
        };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      svg.appendChild(handle);
    });

    const feedback = box.querySelector("#ci-validity");
    feedback.textContent = valid ? "" : "This shape isn't valid — edges can't cross each other. Concave (caving-in) corners are fine, just not a self-crossing outline.";
    feedback.className = "promo-feedback " + (valid ? "" : "promo-feedback-err");
    box.querySelector("#ci-save").disabled = !valid;
    box.querySelector("#ci-remove-vertex").disabled = state.vertices.length <= 3;
  }

  box.querySelector("#ci-add-vertex").addEventListener("click", () => {
    if (state.vertices.length >= 12) return;
    // Insert a new vertex at the midpoint of the longest edge — the least
    // likely place to immediately create a self-intersection.
    let longest = 0, insertAt = 0;
    for (let i = 0; i < state.vertices.length; i++) {
      const a = state.vertices[i], b = state.vertices[(i + 1) % state.vertices.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > longest) { longest = len; insertAt = i + 1; }
    }
    const a = state.vertices[insertAt - 1], b = state.vertices[insertAt % state.vertices.length];
    state.vertices.splice(insertAt, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    redraw();
  });
  box.querySelector("#ci-remove-vertex").addEventListener("click", () => {
    if (state.vertices.length <= 3) return;
    state.vertices.pop();
    redraw();
  });
  box.querySelector("#ci-reset-shape").addEventListener("click", () => {
    state.vertices = regularPolygon(state.vertices.length, 80).map((p) => ({ x: p.x + EDITOR_CENTER, y: p.y + EDITOR_CENTER }));
    redraw();
  });
  box.querySelector("#ci-cancel").addEventListener("click", renderHome);
  box.querySelector("#ci-save").addEventListener("click", async () => {
    if (!isSimplePolygon(state.vertices)) return;
    let name = state.name;
    if (!name) {
      name = await promptPopup("Name this custom item:", { title: "Save Custom Item", placeholder: "My Shape", maxLength: 60 });
      if (!name) return;
    }
    // Convert back to centroid-relative model coords (matching every other
    // vertex list in this app — see trianglePoints/regularPolygon).
    const modelVertices = state.vertices.map((p) => ({ x: Math.round(p.x - EDITOR_CENTER), y: Math.round(p.y - EDITOR_CENTER) }));
    const data = { vertices: modelVertices, material: state.material };
    const result = state.id
      ? await updateSavedItem("custom-items", state.id, name, data)
      : await createItem("custom-items", name, data);
    if (result.error) { await alertPopup(result.error, { title: "Couldn't save" }); return; }
    renderHome();
  });

  redraw();
}
