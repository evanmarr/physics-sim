import { MATERIAL_LIST, materialOf } from "./materials.js";
import { OBJECT_DEFS } from "./objectTypes.js";
import { physicsMath } from "./physicsEdu.js";
import { distanceUnitScale, distanceUnitSuffix, weightUnitScale, weightUnitSuffix } from "./units.js";

const ROTATABLE = new Set(["board", "triangle", "cannon", "button", "springPad", "fan", "lens", "lightSource", "mirror", "portal"]);

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

  // Read once per render — switching units (see the topbar toggle) just
  // re-renders whatever panel is showing, so this always reflects the
  // current choice without the fields needing to watch it themselves.
  const distScale = distanceUnitScale(), distUnit = distanceUnitSuffix();
  const weightScale = weightUnitScale(), weightUnit = weightUnitSuffix();

  // position
  container.appendChild(fieldRow([
    numberField("X", spec.x, (v) => set({ x: v }), -4000, 4000, 1, distScale, distUnit),
    numberField("Y", spec.y, (v) => set({ y: v }), -4000, 4000, 1, distScale, distUnit),
  ]));

  if (ROTATABLE.has(spec.type)) {
    container.appendChild(numberField("Rotation°", Math.round(spec.rotation || 0), (v) => set({ rotation: v }), -360, 360, 1));
  }

  const fields = def.fields || [];

  if (fields.includes("radius")) {
    container.appendChild(sliderField("Radius", spec.radius, 6, 90, 1, (v) => set({ radius: v }), null, distScale, distUnit));
  }
  if (fields.includes("holeRatio")) {
    container.appendChild(sliderField("Center Hole", spec.holeRatio ?? 0, 0, 0.85, 0.01, (v) => set({ holeRatio: v })));
    container.appendChild(helpText(
      "0 is a normal solid ball. Turning this up opens a real hole through the middle — the physical collision shape has the hole too, so a small enough object can actually pass through it, not just look like it can."
    ));
  }
  if (fields.includes("width") || fields.includes("height")) {
    container.appendChild(fieldRow([
      fields.includes("width") ? sliderField("Width", spec.width, 10, 600, 5, (v) => set({ width: v }), null, distScale, distUnit) : null,
      fields.includes("height") ? sliderField("Height", spec.height, 10, 400, 5, (v) => set({ height: v }), null, distScale, distUnit) : null,
    ].filter(Boolean)));
  }
  if (fields.includes("material")) {
    // Unlike every slider/checkbox/number field above, a material swatch is
    // a plain clicked <div> — nothing native keeps its own "selected" state
    // in sync, and the Weight slider below needs to pick up the new
    // material's default density too. So this one field needs a real
    // re-render after the patch, not just the state write.
    container.appendChild(materialField(spec.material, (v) => { set({ material: v }); renderPanel(container, spec, state, handlers); }));
    if (spec.type === "triangle" && spec.material === "glass") {
      container.appendChild(helpText(
        "A glass Triangle acts as a real prism in Light Mode: it splits white light into a spectrum using real (if exaggerated for visibility) wavelength-dependent refraction — each color band bends by a slightly different amount, the same reason a real prism disperses light — not a painted rainbow effect. Rotate it to change how the spectrum spreads out."
      ));
    }
    // Weight is just density with a friendlier name — mass = density × area,
    // so at a fixed size this is exactly the knob that changes how much
    // force it takes to move or stop the object. Overrides the material's
    // own density until a different value is dragged in here again.
    const mat = materialOf(spec.material);
    container.appendChild(sliderField("Weight", spec.densityOverride ?? mat.density, 0.05, 15, 0.05, (v) => set({ densityOverride: v }), null, weightScale, weightUnit));
  }
  if (fields.includes("fixed")) {
    container.appendChild(checkboxField("Fixed (ignores gravity/forces)", spec.fixed, (v) => set({ fixed: v })));
  }
  if (fields.includes("blocksMagnetism")) {
    container.appendChild(checkboxField("Blocks magnetism", spec.blocksMagnetism, (v) => set({ blocksMagnetism: v })));
    container.appendChild(helpText("Shields anything behind it from every magnet's pull/push — a real magnetic shield works the same way, by redirecting field lines through itself."));
  }
  if (fields.includes("startRotation")) {
    container.appendChild(sliderField("Rest Angle°", spec.startRotation, -180, 180, 1, (v) => set({ startRotation: v })));
  }
  if (fields.includes("launchRotation")) {
    container.appendChild(sliderField("Fire Angle°", spec.launchRotation, -180, 180, 1, (v) => set({ launchRotation: v })));
  }
  if (fields.includes("power")) {
    const powerLabel = { bomb: "Blast Power", fan: "Wind Force", magnet: "Magnet Force" }[spec.type] || "Launch Power";
    const [min, max] = spec.type === "magnet" ? [-50, 50] : [4, 50];
    if (spec.type === "magnet") {
      const magnetText = (v) => (v >= 0 ? "Positive force attracts metal objects." : "Negative force repels metal objects.");
      const magnetHelp = helpText(magnetText(spec.power));
      container.appendChild(sliderField(powerLabel, spec.power, min, max, 1, (v) => set({ power: v }), (v) => { magnetHelp.textContent = magnetText(v); }));
      container.appendChild(magnetHelp);
    } else {
      container.appendChild(sliderField(powerLabel, spec.power, min, max, 1, (v) => set({ power: v })));
    }
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
  if (fields.includes("linkedId")) {
    container.appendChild(portalLinkField(spec, state, (v) => set({ linkedId: v })));
    container.appendChild(helpText("Anything that enters this portal comes out the linked one, and vice versa — you only need to set the link on one of the pair. Rotate a portal to aim which way things exit it."));
  }
  if (fields.includes("length")) {
    container.appendChild(sliderField("Length", spec.length, 60, 800, 10, (v) => set({ length: v }), null, distScale, distUnit));
  }
  if (fields.includes("thickness")) {
    container.appendChild(sliderField("Thickness", spec.thickness, 3, 30, 1, (v) => set({ thickness: v })));
  }
  if (fields.includes("elasticity")) {
    container.appendChild(sliderField("Elasticity", spec.elasticity, 0, 1, 0.05, (v) => set({ elasticity: v })));
    container.appendChild(helpText("Low = a stiff, taut rope. High = a stretchy bungee cord."));
  }
  if (fields.includes("attachStartId")) {
    container.appendChild(attachField("Attach start to", spec, "attachStartId", state, (v) => set({ attachStartId: v })));
  }
  if (fields.includes("attachEndId")) {
    container.appendChild(attachField("Attach end to", spec, "attachEndId", state, (v) => set({ attachEndId: v })));
    container.appendChild(helpText("Pins that end to the chosen object's center — leave as (none) to have it hang or auto-anchor to whatever it's dropped on."));
  }
  if (fields.includes("curvature")) {
    const curvatureText = (v) => (v >= 0 ? "Convex — bends light rays inward to a focus (converging)." : "Concave — spreads light rays outward (diverging).");
    const curvatureHelp = helpText(curvatureText(spec.curvature));
    container.appendChild(sliderField("Curvature", spec.curvature, -1, 1, 0.05, (v) => set({ curvature: v }), (v) => { curvatureHelp.textContent = curvatureText(v); }));
    container.appendChild(curvatureHelp);
  }
  if (fields.includes("beamWidth")) {
    container.appendChild(sliderField("Beam Width", spec.beamWidth, 20, 400, 10, (v) => set({ beamWidth: v })));
  }
  if (fields.includes("rayCount")) {
    container.appendChild(sliderField("Ray Count", spec.rayCount, 1, 25, 1, (v) => set({ rayCount: v })));
  }

  const mathLines = physicsMath(spec);
  if (mathLines && mathLines.length && handlers.mathPanelOpen === false) {
    const link = document.createElement("button");
    link.className = "reopen-math-link";
    link.textContent = "▸ Show the physics panel";
    link.addEventListener("click", () => handlers.onOpenMath());
    container.appendChild(link);
  }

  const del = document.createElement("button");
  del.className = "panel-delete danger";
  del.textContent = "Delete";
  del.addEventListener("click", () => handlers.onDelete(spec.id));
  container.appendChild(del);
}

// The standalone "physics math" panel, shown between the canvas and the
// property panel — open by default, closable via the × in its title.
// `onEdit(key, value)` fires when the user drags one of the editable
// variables (density/friction/restitution) — it writes an override onto the
// object's spec, so the equation shown here is exactly what physics.js uses.
export function renderPhysicsMathPanel(container, spec, onClose, onEdit) {
  container.innerHTML = "";
  const mathLines = spec ? physicsMath(spec) : null;
  if (!mathLines || !mathLines.length) {
    const empty = document.createElement("div");
    empty.className = "math-panel-empty";
    empty.textContent = spec ? "No physics notes for this object." : "Select an object to see the physics behind it.";
    container.appendChild(empty);
    return;
  }

  const title = document.createElement("div");
  title.className = "math-panel-title";
  const label = document.createElement("span");
  label.textContent = "Physics";
  const closeBtn = document.createElement("button");
  closeBtn.className = "math-panel-close";
  closeBtn.textContent = "×";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", onClose);
  title.appendChild(label);
  title.appendChild(closeBtn);
  container.appendChild(title);

  mathLines.forEach(({ formula, note, edit }) => {
    const row = document.createElement("div");
    row.className = "math-row";
    const f = document.createElement("div");
    f.className = "math-formula";
    f.textContent = formula;
    const n = document.createElement("div");
    n.className = "math-note";
    n.textContent = note;
    row.appendChild(f);
    row.appendChild(n);

    if (edit && onEdit) {
      const editRow = document.createElement("div");
      editRow.className = "math-edit-row";
      const input = document.createElement("input");
      input.type = "range";
      input.min = edit.min; input.max = edit.max; input.step = edit.step;
      input.value = edit.value;
      const valSpan = document.createElement("span");
      valSpan.className = "math-edit-value";
      valSpan.textContent = Math.round(edit.value * 100) / 100;
      input.addEventListener("input", () => {
        valSpan.textContent = Math.round(parseFloat(input.value) * 100) / 100;
        onEdit(edit.key, parseFloat(input.value));
      });
      const resetBtn = document.createElement("button");
      resetBtn.className = "math-edit-reset";
      resetBtn.textContent = "↺";
      // Density/friction/restitution are material *overrides* — undefined
      // correctly falls back to the material preset (see effectiveDensity
      // etc.). Type-specific values like a bomb's power aren't overrides of
      // anything, so those edit descriptors carry an explicit resetValue
      // instead of relying on undefined to mean something sensible.
      resetBtn.title = edit.resetValue !== undefined ? "Reset to default" : "Reset to material default";
      resetBtn.addEventListener("click", () => onEdit(edit.key, edit.resetValue));
      editRow.appendChild(input);
      editRow.appendChild(valSpan);
      editRow.appendChild(resetBtn);
      row.appendChild(editRow);
    }

    container.appendChild(row);
  });
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

// `unitScale` (raw units per 1 displayed unit — see units.js) and `unitSuffix`
// (e.g. "m") are optional — omitted, a field behaves exactly as before.
function numberField(label, value, onChange, min = -4000, max = 4000, step = 1, unitScale = 1, unitSuffix = "") {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = unitSuffix ? `${label} (${unitSuffix})` : label;
  const input = document.createElement("input");
  input.type = "number";
  input.value = Math.round((value / unitScale) * 100) / 100;
  input.step = step / unitScale;
  input.min = min / unitScale;
  input.max = max / unitScale;
  input.addEventListener("change", () => onChange((parseFloat(input.value) || 0) * unitScale));
  wrap.appendChild(l);
  wrap.appendChild(input);
  return wrap;
}

// onLiveChange (optional) fires synchronously on every drag tick, same as
// the value label does — for a help/description line elsewhere in the
// panel that depends on this value (e.g. "Convex"/"Concave" text), since
// patchObject deliberately doesn't re-render the whole panel on every
// slider tick (that would interrupt an in-progress drag).
// `unitScale`/`unitSuffix` work like numberField's: the slider itself still
// drags in raw units (so existing min/max/step tuning is untouched), but the
// live readout next to the label shows the converted, human-scale number.
function sliderField(label, value, min, max, step, onChange, onLiveChange, unitScale = 1, unitSuffix = "") {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  const valSpan = document.createElement("span");
  const format = (raw) => Math.round((raw / unitScale) * 10) / 10 + (unitSuffix ? ` ${unitSuffix}` : "");
  valSpan.textContent = format(value);
  l.textContent = label + " ";
  l.appendChild(valSpan);
  const input = document.createElement("input");
  input.type = "range";
  input.min = min; input.max = max; input.step = step;
  input.value = value;
  input.addEventListener("input", () => {
    valSpan.textContent = format(input.value);
    const v = parseFloat(input.value);
    onChange(v);
    onLiveChange?.(v);
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

function attachField(label, spec, key, state, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  wrap.appendChild(l);
  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = ""; none.textContent = "(none)";
  select.appendChild(none);
  state.objects
    .filter((o) => o.id !== spec.id)
    .forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = `${OBJECT_DEFS[o.type].label} (${o.id.split("_")[1]})`;
      if (spec[key] === o.id) opt.selected = true;
      select.appendChild(opt);
    });
  select.addEventListener("change", () => onChange(select.value || null));
  wrap.appendChild(select);
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

function portalLinkField(spec, state, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = "Linked to";
  wrap.appendChild(l);
  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = ""; none.textContent = "(none)";
  select.appendChild(none);
  state.objects
    .filter((o) => o.type === "portal" && o.id !== spec.id)
    .forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = `Portal (${o.id.split("_")[1]})`;
      if (spec.linkedId === o.id) opt.selected = true;
      select.appendChild(opt);
    });
  select.addEventListener("change", () => onChange(select.value || null));
  wrap.appendChild(select);
  return wrap;
}
