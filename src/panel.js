import { MATERIAL_LIST, materialOf } from "./materials.js";
import { OBJECT_DEFS } from "./objectTypes.js";

const ROTATABLE = new Set(["board", "triangle", "cannon", "button"]);

export function renderPanel(container, spec, state, handlers) {
  container.innerHTML = "";
  if (!spec) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.textContent = "Select an object to edit its properties.";
    container.appendChild(empty);
    return;
  }

  const def = OBJECT_DEFS[spec.type];

  const title = document.createElement("div");
  title.className = "panel-title";
  title.innerHTML = `<span>${def.label}</span>`;
  container.appendChild(title);

  if (spec.type === "cannon") {
    container.appendChild(
      helpText(
        "A ball that falls into the dashed circle (shown while editing) is caught and re-fired at the Fire Angle/Power. Rest Angle is how it sits before catching one."
      )
    );
  }

  const set = (patch) => handlers.onChange(spec.id, patch);

  // position
  container.appendChild(fieldRow([
    numberField("X", spec.x, (v) => set({ x: v })),
    numberField("Y", spec.y, (v) => set({ y: v })),
  ]));

  if (ROTATABLE.has(spec.type)) {
    container.appendChild(numberField("Rotation°", Math.round(spec.rotation || 0), (v) => set({ rotation: v }), -360, 360, 1));
  }

  const fields = def.fields || [];

  if (fields.includes("radius")) {
    container.appendChild(sliderField("Radius", spec.radius, 6, 90, 1, (v) => set({ radius: v })));
  }
  if (fields.includes("size")) {
    container.appendChild(sliderField("Size", spec.size, 30, 400, 5, (v) => set({ size: v })));
  }
  if (fields.includes("width") || fields.includes("height")) {
    container.appendChild(fieldRow([
      fields.includes("width") ? sliderField("Width", spec.width, 10, 600, 5, (v) => set({ width: v })) : null,
      fields.includes("height") ? sliderField("Height", spec.height, 10, 400, 5, (v) => set({ height: v })) : null,
    ].filter(Boolean)));
  }
  if (fields.includes("material")) {
    container.appendChild(materialField(spec.material, (v) => set({ material: v })));
  }
  if (fields.includes("fixed")) {
    container.appendChild(checkboxField("Fixed (ignores gravity/forces)", spec.fixed, (v) => set({ fixed: v })));
  }
  if (fields.includes("startRotation")) {
    container.appendChild(sliderField("Rest Angle°", spec.startRotation, -180, 180, 1, (v) => set({ startRotation: v })));
  }
  if (fields.includes("launchRotation")) {
    container.appendChild(sliderField("Fire Angle°", spec.launchRotation, -180, 180, 1, (v) => set({ launchRotation: v })));
  }
  if (fields.includes("power")) {
    const powerLabel = { bomb: "Blast Power", fan: "Wind Force" }[spec.type] || "Launch Power";
    container.appendChild(sliderField(powerLabel, spec.power, 4, 50, 1, (v) => set({ power: v })));
  }
  if (fields.includes("radiusOfEffect")) {
    container.appendChild(sliderField("Blast Radius", spec.radiusOfEffect, 60, 600, 10, (v) => set({ radiusOfEffect: v })));
  }
  if (fields.includes("range")) {
    container.appendChild(sliderField("Range", spec.range, 80, 1000, 10, (v) => set({ range: v })));
  }
  if (fields.includes("targetId")) {
    container.appendChild(targetField(spec, state, (v) => set({ targetId: v })));
  }

  const del = document.createElement("button");
  del.className = "panel-delete danger";
  del.textContent = "Delete";
  del.addEventListener("click", () => handlers.onDelete(spec.id));
  container.appendChild(del);
}

function helpText(text) {
  const p = document.createElement("div");
  p.className = "panel-help";
  p.textContent = text;
  return p;
}

function fieldRow(fields) {
  const row = document.createElement("div");
  row.className = "field-row";
  fields.forEach((f) => row.appendChild(f));
  return row;
}

function numberField(label, value, onChange, min = -4000, max = 4000, step = 1) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.value = Math.round(value * 100) / 100;
  input.step = step;
  input.min = min;
  input.max = max;
  input.addEventListener("change", () => onChange(parseFloat(input.value) || 0));
  wrap.appendChild(l);
  wrap.appendChild(input);
  return wrap;
}

function sliderField(label, value, min, max, step, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  const valSpan = document.createElement("span");
  valSpan.textContent = Math.round(value * 10) / 10;
  l.textContent = label + " ";
  l.appendChild(valSpan);
  const input = document.createElement("input");
  input.type = "range";
  input.min = min; input.max = max; input.step = step;
  input.value = value;
  input.addEventListener("input", () => {
    valSpan.textContent = input.value;
    onChange(parseFloat(input.value));
  });
  wrap.appendChild(l);
  wrap.appendChild(input);
  return wrap;
}

function checkboxField(label, checked, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.id = "cb_" + Math.random().toString(36).slice(2);
  input.addEventListener("change", () => onChange(input.checked));
  const l = document.createElement("label");
  l.textContent = label;
  l.htmlFor = input.id;
  wrap.appendChild(input);
  wrap.appendChild(l);
  return wrap;
}

function materialField(current, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = "Material";
  wrap.appendChild(l);
  const row = document.createElement("div");
  row.className = "material-swatches";
  MATERIAL_LIST.forEach((m) => {
    const item = document.createElement("div");
    item.className = "material-option" + (m === current ? " selected" : "");
    item.title = materialOf(m).label;
    item.addEventListener("click", () => onChange(m));

    const sw = document.createElement("div");
    sw.className = "material-swatch";
    sw.style.background = materialOf(m).color;

    const name = document.createElement("span");
    name.className = "material-name";
    name.textContent = materialOf(m).label;

    item.appendChild(sw);
    item.appendChild(name);
    row.appendChild(item);
  });
  wrap.appendChild(row);
  return wrap;
}

function targetField(spec, state, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = "Triggers";
  wrap.appendChild(l);
  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = ""; none.textContent = "(none)";
  select.appendChild(none);
  state.objects
    .filter((o) => o.id !== spec.id && (o.type === "cannon" || o.type === "bomb"))
    .forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = `${OBJECT_DEFS[o.type].label} (${o.id.split("_")[1]})`;
      if (spec.targetId === o.id) opt.selected = true;
      select.appendChild(opt);
    });
  select.addEventListener("change", () => onChange(select.value || null));
  wrap.appendChild(select);
  return wrap;
}
