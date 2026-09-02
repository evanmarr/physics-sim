import { OBJECT_DEFS } from "./objectTypes.js";
import { materialOf } from "./materials.js";

export function renderShop(container, state, handlers) {
  container.innerHTML = "";
  const shopTypes = Object.entries(OBJECT_DEFS).filter(([, d]) => d.category === "shop");

  for (const [type, def] of shopTypes) {
    const owned = state.unlocked.has(type);
    const row = document.createElement("div");
    row.className = "shop-item";

    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = materialOf(def.defaultSpec().material).color;
    swatch.style.display = "flex";
    swatch.style.alignItems = "center";
    swatch.style.justifyContent = "center";
    swatch.textContent = def.icon;

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = def.label;
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = shopDescription(type);
    info.appendChild(name);
    info.appendChild(desc);

    const btn = document.createElement("button");
    if (owned) {
      btn.textContent = "Owned";
      btn.disabled = true;
    } else {
      btn.textContent = `Buy · ${def.price}`;
      btn.className = "primary";
      btn.disabled = state.coins < def.price;
      btn.addEventListener("click", () => handlers.onPurchase(type));
    }

    row.appendChild(swatch);
    row.appendChild(info);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

function shopDescription(type) {
  if (type === "bomb") return "Explodes on impact, blasting nearby objects outward.";
  if (type === "button") return "A pressure switch — link it to a cannon or bomb to trigger it.";
  return "";
}

export function tryPurchase(state, type) {
  const def = OBJECT_DEFS[type];
  if (!def || def.category !== "shop") return false;
  if (state.unlocked.has(type)) return false;
  if (state.coins < def.price) return false;
  state.coins -= def.price;
  state.unlocked.add(type);
  return true;
}
