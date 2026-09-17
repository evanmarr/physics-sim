import { OBJECT_DEFS } from "./objectTypes.js";
import { materialOf } from "./materials.js";

export function renderPalette(container, state, handlers) {
  container.innerHTML = "";

  for (const [type, def] of Object.entries(OBJECT_DEFS)) {
    // customPolygon (Kinetic Plus's Custom Physics Items) is deliberately
    // NOT a draggable palette primitive — dragging one out would always
    // produce the same default hexagon, and it needs Plus-gating besides.
    // It's placed instead via the dedicated Custom Items button (see
    // src/customItems.js), which calls placeCustomPolygon() directly. The
    // type stays in OBJECT_DEFS so panel.js/physics.js/render.js can still
    // work with an existing one once placed (editing, saved worlds, etc).
    if (type === "customPolygon") continue;
    container.appendChild(buildItem(type, def, handlers));
  }

  if (handlers.onOpenCustomItems) {
    const btn = document.createElement("button");
    btn.id = "open-custom-items-btn";
    btn.className = "palette-custom-items-btn";
    btn.innerHTML = `⬠ Custom Items <span class="physics-dim-plus-badge">PLUS</span>`;
    btn.addEventListener("click", handlers.onOpenCustomItems);
    container.appendChild(btn);
  }

  const shortcuts = document.createElement("div");
  shortcuts.className = "palette-shortcuts";
  shortcuts.innerHTML = "<div>⌘C copy · ⌘V paste</div><div>Del delete · Esc deselect</div><div>⇧+click or ⇧+drag: multi-select</div>";
  container.appendChild(shortcuts);
}

function buildItem(type, def, handlers) {
  const el = document.createElement("div");
  el.className = "palette-item";
  el.dataset.type = type;

  const swatch = document.createElement("div");
  swatch.className = "swatch";
  const mat = materialOf(def.defaultSpec().material);
  swatch.style.background = mat.color;
  swatch.textContent = def.icon;
  swatch.style.fontSize = "14px";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = def.label;

  el.appendChild(swatch);
  el.appendChild(label);

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    handlers.onDragStart(type, e);
  });

  return el;
}
