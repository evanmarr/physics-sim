// Experiment Notebook — Prediction → Experiment → Observation →
// Explanation → Save, the same generic saved-items backend every other
// "your stuff" feature uses (kind "notebookEntries"). Free gets a real,
// useful 8 entries; Plus gets unlimited (server/entitlements.js).
//
// State capture is real, not fabricated: "Capture current Physics state"
// grabs the live world's actual object array via the same generateSnapshot
// used for saved-world thumbnails — an entry with a capture attached shows
// what was ACTUALLY on the canvas, never a placeholder.
import { getUser, fetchItems, createItem, updateSavedItem, deleteSavedItem } from "./auth.js";
import { alertPopup, confirmPopup } from "./popup.js";
import { generateSnapshot } from "./snapshot.js";

let modal, box, getPhysicsState; // getPhysicsState(): { objects, gravity } | null (null outside Physics mode)
const MODULES = ["Physics", "Chemistry", "Astronomy", "Rocket Simulator", "Sound", "Sustainability", "Economics", "Zoology", "Mathematics", "History", "Cybersecurity"];

export function initNotebookUI(getPhysicsStateFn) {
  modal = document.getElementById("notebook-modal");
  box = document.getElementById("notebook-modal-box");
  getPhysicsState = getPhysicsStateFn;
}

export function openNotebookHome() {
  if (!getUser()) { document.getElementById("account-btn").click(); return; }
  modal.classList.remove("hidden");
  renderHome();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let compareMode = false;
let compareSelection = new Set();

async function renderHome() {
  box.innerHTML = `<h2>Experiment Notebook</h2><p class="panel-empty">Loading…</p>`;
  const items = await fetchItems("notebook").catch(() => null);
  if (items === null) {
    box.innerHTML = `<h2>Experiment Notebook</h2><p class="panel-empty">Couldn't load your notebook right now.</p><button id="nb-close">Close</button>`;
    box.querySelector("#nb-close").addEventListener("click", () => modal.classList.add("hidden"));
    return;
  }
  const limits = getUser()?.entitlements?.limits;
  const cap = limits?.notebookEntries;
  box.innerHTML = `
    <h2>Experiment Notebook</h2>
    <p class="saves-hint">Prediction → Experiment → Observation → Explanation. ${cap != null ? `Free: ${items.length}/${cap} entries used.` : "Kinetic Plus: unlimited entries."}</p>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button id="nb-new" class="primary">+ New Entry</button>
      <button id="nb-compare-toggle">${compareMode ? "Cancel compare" : "Compare two entries"}</button>
    </div>
    <div class="saves-list">
      ${items.length === 0 ? '<p class="saves-empty">No entries yet.</p>' : items.map((it) => `
        <div class="saves-item" data-id="${it.id}">
          ${compareMode ? `<input type="checkbox" class="nb-compare-check" data-id="${it.id}" ${compareSelection.has(it.id) ? "checked" : ""} />` : ""}
          <div class="saves-item-info">
            <div class="saves-item-name">${escapeHtml(it.name)} <span class="dashboard-row-kind">${escapeHtml(it.data.module || "General")}</span></div>
            <div class="saves-item-date">${new Date(it.updatedAt).toLocaleString()}${it.data.prediction ? ` · "${escapeHtml(it.data.prediction.slice(0, 60))}${it.data.prediction.length > 60 ? "…" : ""}"` : ""}</div>
          </div>
          <div class="saves-item-actions">
            ${compareMode ? "" : `<button class="nb-open" data-id="${it.id}">Open</button><button class="nb-duplicate" data-id="${it.id}">Duplicate</button><button class="nb-delete" data-id="${it.id}">Delete</button>`}
          </div>
        </div>
      `).join("")}
    </div>
    ${compareMode ? `<button id="nb-compare-go" class="primary" ${compareSelection.size === 2 ? "" : "disabled"}>Compare selected (${compareSelection.size}/2)</button>` : ""}
    <button id="nb-close" style="margin-top:10px">Close</button>
  `;
  box.querySelector("#nb-close").addEventListener("click", () => { modal.classList.add("hidden"); compareMode = false; compareSelection = new Set(); });
  box.querySelector("#nb-new").addEventListener("click", () => openEditor(items, null));
  box.querySelector("#nb-compare-toggle").addEventListener("click", () => { compareMode = !compareMode; compareSelection = new Set(); renderHome(); });
  box.querySelectorAll(".nb-open").forEach((b) => b.addEventListener("click", () => openEditor(items, items.find((x) => x.id === b.dataset.id))));
  box.querySelectorAll(".nb-duplicate").forEach((b) => b.addEventListener("click", async () => {
    const it = items.find((x) => x.id === b.dataset.id);
    const result = await createItem("notebook", `${it.name} (copy)`, it.data);
    if (result.error) { await alertPopup(result.error, { title: "Couldn't duplicate" }); return; }
    renderHome();
  }));
  box.querySelectorAll(".nb-delete").forEach((b) => b.addEventListener("click", async () => {
    const ok = await confirmPopup("Delete this notebook entry? This can't be undone.", { title: "Delete entry", confirmLabel: "Delete" });
    if (!ok) return;
    await deleteSavedItem("notebook", b.dataset.id);
    renderHome();
  }));
  box.querySelectorAll(".nb-compare-check").forEach((cb) => cb.addEventListener("change", () => {
    if (cb.checked) {
      if (compareSelection.size >= 2) { cb.checked = false; return; }
      compareSelection.add(cb.dataset.id);
    } else {
      compareSelection.delete(cb.dataset.id);
    }
    renderHome();
  }));
  box.querySelector("#nb-compare-go")?.addEventListener("click", () => {
    const [a, b2] = [...compareSelection].map((id) => items.find((x) => x.id === id));
    renderCompare(a, b2);
  });
}

function openEditor(items, existing) {
  const entry = existing?.data || { module: "Physics", prediction: "", variablesChanged: "", observation: "", conclusion: "", initialState: null, finalState: null, schemaVersion: 1 };
  const name = existing?.name || "";

  box.innerHTML = `
    <h2>${existing ? "Edit" : "New"} Entry</h2>
    <label>Title</label>
    <input id="nb-name" type="text" maxlength="80" value="${escapeHtml(name)}" placeholder="What are you testing?" />
    <label>Module</label>
    <select id="nb-module">${MODULES.map((m) => `<option ${m === entry.module ? "selected" : ""}>${m}</option>`).join("")}</select>
    <label>Prediction — what do you think will happen?</label>
    <textarea id="nb-prediction" rows="2">${escapeHtml(entry.prediction || "")}</textarea>
    <label>Variables changed</label>
    <textarea id="nb-variables" rows="2">${escapeHtml(entry.variablesChanged || "")}</textarea>
    <div style="display:flex;gap:8px;margin:6px 0">
      <button id="nb-capture-initial">📸 Capture current world as Initial State</button>
    </div>
    <div id="nb-initial-preview">${entry.initialState ? `<img src="${entry.initialState.snapshot}" style="width:100%;border-radius:6px;border:1px solid var(--border)" />` : '<p class="saves-hint">No initial state captured yet.</p>'}</div>
    <label>Observation — what actually happened?</label>
    <textarea id="nb-observation" rows="2">${escapeHtml(entry.observation || "")}</textarea>
    <div style="display:flex;gap:8px;margin:6px 0">
      <button id="nb-capture-final">📸 Capture current world as Final State</button>
    </div>
    <div id="nb-final-preview">${entry.finalState ? `<img src="${entry.finalState.snapshot}" style="width:100%;border-radius:6px;border:1px solid var(--border)" />` : '<p class="saves-hint">No final state captured yet.</p>'}</div>
    <label>Explanation / conclusion</label>
    <textarea id="nb-conclusion" rows="3">${escapeHtml(entry.conclusion || "")}</textarea>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button id="nb-save" class="primary">Save</button>
      <button id="nb-cancel">Cancel</button>
    </div>
  `;

  const captureState = (which) => {
    const state = getPhysicsState?.();
    if (!state || !state.objects?.length) { alertPopup("Switch to Physics mode with objects on the canvas first.", { title: "Nothing to capture" }); return; }
    const snapshot = generateSnapshot(state.objects);
    entry[which] = { objects: state.objects, gravity: state.gravity, snapshot, capturedAt: Date.now() };
    document.getElementById(which === "initialState" ? "nb-initial-preview" : "nb-final-preview").innerHTML =
      `<img src="${snapshot}" style="width:100%;border-radius:6px;border:1px solid var(--border)" />`;
  };
  box.querySelector("#nb-capture-initial").addEventListener("click", () => captureState("initialState"));
  box.querySelector("#nb-capture-final").addEventListener("click", () => captureState("finalState"));
  box.querySelector("#nb-cancel").addEventListener("click", () => renderHome());
  box.querySelector("#nb-save").addEventListener("click", async () => {
    const title = box.querySelector("#nb-name").value.trim();
    if (!title) { await alertPopup("Give this entry a title.", { title: "Title required" }); return; }
    const data = {
      module: box.querySelector("#nb-module").value,
      prediction: box.querySelector("#nb-prediction").value,
      variablesChanged: box.querySelector("#nb-variables").value,
      observation: box.querySelector("#nb-observation").value,
      conclusion: box.querySelector("#nb-conclusion").value,
      initialState: entry.initialState, finalState: entry.finalState,
      schemaVersion: 1,
    };
    const result = existing
      ? await updateSavedItem("notebook", existing.id, title, data)
      : await createItem("notebook", title, data);
    if (result.error) { await alertPopup(result.error, { title: "Couldn't save" }); return; }
    renderHome();
  });
}

function renderCompare(a, b) {
  const rows = [
    ["Title", a.name, b.name],
    ["Module", a.data.module, b.data.module],
    ["Prediction", a.data.prediction, b.data.prediction],
    ["Variables changed", a.data.variablesChanged, b.data.variablesChanged],
    ["Observation", a.data.observation, b.data.observation],
    ["Conclusion", a.data.conclusion, b.data.conclusion],
  ];
  box.innerHTML = `
    <h2>Compare Runs</h2>
    <table class="compare-table">
      <tr><th></th><th>${escapeHtml(a.name)}</th><th>${escapeHtml(b.name)}</th></tr>
      ${rows.map(([label, av, bv]) => `
        <tr>
          <td class="compare-label">${label}</td>
          <td class="${av !== bv ? "compare-diff" : ""}"></td>
          <td class="${av !== bv ? "compare-diff" : ""}"></td>
        </tr>
      `).join("")}
    </table>
    ${(a.data.finalState || b.data.finalState) ? `
      <div style="display:flex;gap:10px;margin-top:10px">
        ${a.data.finalState ? `<div><div class="saves-hint">${escapeHtml(a.name)} final state</div><img src="${a.data.finalState.snapshot}" style="width:100%;border-radius:6px" /><div class="saves-hint">${a.data.finalState.objects.length} objects</div></div>` : ""}
        ${b.data.finalState ? `<div><div class="saves-hint">${escapeHtml(b.name)} final state</div><img src="${b.data.finalState.snapshot}" style="width:100%;border-radius:6px" /><div class="saves-hint">${b.data.finalState.objects.length} objects</div></div>` : ""}
      </div>
    ` : ""}
    <button id="nb-back" style="margin-top:12px">Back</button>
  `;
  // textContent for every cell that holds user-authored text, not innerHTML.
  box.querySelectorAll(".compare-table td:not(.compare-label)").forEach((td, i) => {
    const rowIdx = Math.floor(i / 2), col = i % 2;
    td.textContent = rows[rowIdx][col + 1] || "—";
  });
  box.querySelector("#nb-back").addEventListener("click", () => { compareMode = false; compareSelection = new Set(); renderHome(); });
}
