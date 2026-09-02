import { OBJECT_DEFS } from "./objectTypes.js";
import { materialOf } from "./materials.js";

export function renderPalette(container, state, handlers) {
  container.innerHTML = "";

  const coreSection = document.createElement("div");
  coreSection.className = "palette-section-title";
  coreSection.textContent = "Objects";
  container.appendChild(coreSection);

  for (const [type, def] of Object.entries(OBJECT_DEFS)) {
    if (def.category !== "core") continue;
    container.appendChild(buildItem(type, def, state, handlers, true));
  }

  const shopSection = document.createElement("div");
  shopSection.className = "palette-section-title";
  shopSection.textContent = "Unlocked";
  container.appendChild(shopSection);

  const shopItems = Object.entries(OBJECT_DEFS).filter(([, d]) => d.category === "shop");
  const anyUnlocked = shopItems.some(([type]) => state.unlocked.has(type));
  if (!anyUnlocked) {
    const p = document.createElement("div");
    p.style.cssText = "color:var(--text-dim);font-size:11.5px;padding:4px 6px;";
    p.textContent = "Buy items in the Shop to unlock them here.";
    container.appendChild(p);
  }
  for (const [type, def] of shopItems) {
    if (!state.unlocked.has(type)) continue;
    container.appendChild(buildItem(type, def, state, handlers, true));
  }

  const shortcuts = document.createElement("div");
  shortcuts.className = "palette-shortcuts";
  shortcuts.innerHTML = "<div>⌘C copy · ⌘V paste</div><div>Del delete · Esc deselect</div>";
  container.appendChild(shortcuts);
}

function buildItem(type, def, state, handlers, draggable) {
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
