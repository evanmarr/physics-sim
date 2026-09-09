// The Dashboard is where sharing a saved Physics world or Mathematics item
// with a classroom actually happens — a student sends one up to their
// teacher, a teacher sends one down to every student in a class they
// teach. Only signed-in Teachers/Students get it; an Independent user has
// no classroom relationship for a share to travel along, so there's
// nothing here for them.
import { getUser, onAuthChange, fetchItems, fetchClassrooms, escapeHtml } from "./auth.js";
import { alertPopup } from "./popup.js";

const KIND_LABELS = { worlds: "Physics world", mathItems: "Math item" };
const KIND_TO_URL = { worlds: "worlds", mathItems: "math-items" };

const appliers = {}; // kind -> (data) => void, filled in by main.js via registerShareApplier
export function registerShareApplier(kind, fn) { appliers[kind] = fn; }

let modal, box, btn;

export function initDashboardUI() {
  modal = document.getElementById("dashboard-modal");
  box = document.getElementById("dashboard-modal-box");
  btn = document.getElementById("dashboard-btn");

  btn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    render();
  });

  onAuthChange((u) => {
    btn.classList.toggle("hidden", !u || u.title === "independent");
  });
}

async function shareApi(path, opts) {
  const res = await fetch(`/api/shared-items${path}`, {
    method: opts?.method || "GET",
    headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

async function render() {
  box.innerHTML = `<h2>Dashboard</h2><p class="panel-empty">Loading…</p>`;
  const user = getUser();
  const [{ received, sent }, classrooms] = await Promise.all([
    shareApi("").catch(() => ({ received: [], sent: [] })),
    fetchClassrooms().catch(() => ({ teaching: [], joined: [] })),
  ]);
  const isTeacher = classrooms.teaching.length > 0;
  const isStudent = classrooms.joined.length > 0;

  box.innerHTML = `
    <h2>Dashboard</h2>
    <p class="dashboard-hint">Signed in as ${escapeHtml(user.firstName || user.email)} (${escapeHtml(user.title)}).</p>

    <div class="dashboard-share-actions">
      ${isStudent ? `<button id="dash-share-teacher" class="primary">Share with teacher</button>` : ""}
      ${isTeacher ? `<button id="dash-share-students" class="primary">Share with student(s)</button>` : ""}
      ${!isStudent && !isTeacher ? `<p class="panel-empty">Join or create a classroom first (see Classroom in the menu) — sharing travels along a classroom relationship.</p>` : ""}
    </div>

    <h3>Received</h3>
    ${received.length ? received.map((it) => `
      <div class="dashboard-row">
        <div class="dashboard-row-info">
          <div class="dashboard-row-name">${escapeHtml(it.name)} <span class="dashboard-row-kind">${KIND_LABELS[it.kind] || it.kind}</span></div>
          <div class="dashboard-row-meta">From ${escapeHtml(it.fromEmail)} · ${escapeHtml(it.classroomName)} · ${new Date(it.createdAt).toLocaleString()}</div>
        </div>
        <button class="dashboard-load" data-id="${it.id}" data-kind="${it.kind}">Load</button>
      </div>
    `).join("") : `<p class="panel-empty">Nothing shared with you yet.</p>`}

    <h3>Sent</h3>
    ${sent.length ? sent.map((it) => `
      <div class="dashboard-row">
        <div class="dashboard-row-info">
          <div class="dashboard-row-name">${escapeHtml(it.name)} <span class="dashboard-row-kind">${KIND_LABELS[it.kind] || it.kind}</span></div>
          <div class="dashboard-row-meta">To ${escapeHtml(it.classroomName)} (${it.direction === "to-teacher" ? "teacher" : "students"}) · ${new Date(it.createdAt).toLocaleString()}</div>
        </div>
      </div>
    `).join("") : `<p class="panel-empty">You haven't shared anything yet.</p>`}

    <button id="dashboard-close">Close</button>
  `;

  box.querySelector("#dashboard-close").addEventListener("click", () => modal.classList.add("hidden"));

  box.querySelector("#dash-share-teacher")?.addEventListener("click", () => renderShareForm("to-teacher", classrooms.joined));
  box.querySelector("#dash-share-students")?.addEventListener("click", () => renderShareForm("to-students", classrooms.teaching));

  box.querySelectorAll(".dashboard-load").forEach((loadBtn) => {
    loadBtn.addEventListener("click", async () => {
      try {
        const { item } = await shareApi(`/${loadBtn.dataset.id}`);
        const applier = appliers[loadBtn.dataset.kind];
        if (!applier) { await alertPopup("This item's mode isn't loaded yet — visit that mode once, then try again."); return; }
        applier(item.data);
        modal.classList.add("hidden");
      } catch (e) {
        await alertPopup(e.message, { title: "Couldn't load" });
      }
    });
  });
}

async function renderShareForm(direction, availableClassrooms) {
  if (!availableClassrooms.length) {
    await alertPopup(direction === "to-teacher" ? "You haven't joined a classroom yet." : "You aren't teaching a classroom yet.", { title: "No classroom" });
    return;
  }
  const kindOptions = Object.keys(KIND_LABELS);
  const formBox = document.createElement("div");
  formBox.className = "dashboard-share-form";
  formBox.innerHTML = `
    <h3>${direction === "to-teacher" ? "Share with teacher" : "Share with student(s)"}</h3>
    <label class="auth-label">Item type</label>
    <select id="dash-kind">${kindOptions.map((k) => `<option value="${k}">${KIND_LABELS[k]}</option>`).join("")}</select>
    <label class="auth-label">Which saved item?</label>
    <select id="dash-item"><option>Loading…</option></select>
    <label class="auth-label">Classroom</label>
    <select id="dash-classroom">${availableClassrooms.map((c) => `<option value="${c.code}">${escapeHtml(c.name)} (${c.code})</option>`).join("")}</select>
    <div id="dash-share-error" class="auth-error"></div>
    <div class="about-actions">
      <button id="dash-share-submit" class="primary">Share</button>
      <button id="dash-share-cancel">Cancel</button>
    </div>
  `;
  box.appendChild(formBox);
  formBox.scrollIntoView({ block: "nearest" });

  const kindSel = formBox.querySelector("#dash-kind");
  const itemSel = formBox.querySelector("#dash-item");
  let items = [];
  async function loadItems() {
    itemSel.innerHTML = `<option>Loading…</option>`;
    items = await fetchItems(KIND_TO_URL[kindSel.value]).catch(() => []);
    itemSel.innerHTML = items.length
      ? items.map((it) => `<option value="${it.id}">${escapeHtml(it.name)}</option>`).join("")
      : `<option value="">Nothing saved of this type yet</option>`;
  }
  kindSel.addEventListener("change", loadItems);
  await loadItems();

  formBox.querySelector("#dash-share-cancel").addEventListener("click", () => formBox.remove());
  formBox.querySelector("#dash-share-submit").addEventListener("click", async () => {
    const errorEl = formBox.querySelector("#dash-share-error");
    const item = items.find((it) => it.id === itemSel.value);
    if (!item) { errorEl.textContent = "Nothing to share."; return; }
    try {
      await shareApi("", { method: "POST", body: { kind: kindSel.value, name: item.name, data: item.data, classroomCode: formBox.querySelector("#dash-classroom").value, direction } });
      formBox.remove();
      render();
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}
