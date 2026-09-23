// Classrooms: gated by the account's own Title — only a Teacher account
// can create one (becomes its teacher, gets a share-able code), only a
// Student account can join one with a code (becomes a student in it). The
// UI below hides the form the account's Title doesn't allow; server.js's
// createClassroom/joinClassroom enforce the same rule server-side.
//
// Assignments live inside a classroom's own row here rather than as a
// separate modal: a teacher posts one to a classroom they teach, every
// student in it sees it in their own "Joined" row and can check it off.
// It's a pointer to something to go do, not a file-submission system —
// the actual work is whatever a student already saves or shares via the
// Dashboard's classroom sharing.
import { getUser, fetchClassrooms, createClassroom, joinClassroom, leaveClassroom, deleteClassroom, fetchAssignments, createAssignment, deleteAssignment, setAssignmentComplete, escapeHtml } from "./auth.js";
import { confirmPopup, alertPopup } from "./popup.js";
import { VARIATION_VARS, getVariationVar, sanitizeVariation, valuesFor, rangeOf, describeValues } from "./assignmentVariation.js";

// main.js registers how to actually apply a student's values to the sandbox
// (it owns the physics state); this file only computes and displays them.
let variationApplier = null;
export function registerVariationApplier(fn) { variationApplier = fn; }

let modal, box;

export function initClassroomUI() {
  modal = document.getElementById("classroom-modal");
  box = document.getElementById("classroom-modal-box");
  const btn = document.getElementById("classroom-btn");

  btn.addEventListener("click", () => {
    if (!getUser()) {
      // Same sign-in prompt My Worlds uses when signed out, rather than a
      // second, separate "please sign in" screen of our own.
      document.getElementById("account-btn").click();
      return;
    }
    modal.classList.remove("hidden");
    render();
  });
}

function assignmentsForCode(assignmentData, code) {
  const all = [...(assignmentData?.teaching || []), ...(assignmentData?.joined || [])];
  return all.find((c) => c.classroomCode === code)?.assignments || [];
}

function dueLabel(dueAt) {
  if (!dueAt) return "";
  const d = new Date(dueAt);
  return ` · Due ${d.toLocaleDateString()}`;
}

async function render() {
  box.innerHTML = `<h2>Classrooms</h2><p class="panel-empty">Loading…</p>`;
  const [data, assignmentData] = await Promise.all([
    fetchClassrooms().catch(() => null),
    fetchAssignments().catch(() => null),
  ]);
  if (!data) {
    box.innerHTML = `<h2>Classrooms</h2><p class="panel-empty">Couldn't load your classrooms right now.</p><button id="classroom-close">Close</button>`;
    box.querySelector("#classroom-close").addEventListener("click", () => modal.classList.add("hidden"));
    return;
  }

  box.innerHTML = `
    <h2>Classrooms</h2>

    <h3>Teaching</h3>
    ${data.teaching.length ? data.teaching.map((c) => {
      const assignments = assignmentsForCode(assignmentData, c.code);
      return `
      <div class="classroom-row">
        <div class="classroom-row-info">
          <div class="classroom-row-name">${escapeHtml(c.name)}</div>
          <div class="classroom-row-meta">${c.students.length} student${c.students.length === 1 ? "" : "s"}${c.students.length ? ": " + c.students.map(escapeHtml).join(", ") : ""}</div>
        </div>
        <code class="classroom-code">${c.code}</code>
        <button class="classroom-delete" data-code="${c.code}" title="Delete this classroom">Delete</button>
      </div>
      <div class="assignment-list" data-classroom="${c.code}">
        ${assignments.length ? assignments.map((a) => `
          <div class="assignment-row">
            <div class="assignment-row-info">
              <div class="assignment-row-title">${escapeHtml(a.title)}</div>
              <div class="assignment-row-meta">${a.completedBy.length} of ${c.students.length} completed${dueLabel(a.dueAt)}</div>
              ${a.instructions ? `<div class="assignment-row-instructions">${escapeHtml(a.instructions)}</div>` : ""}
              ${a.variation ? teacherVariationHtml(a, c.students) : ""}
            </div>
            <button class="assignment-delete" data-id="${a.id}" title="Delete this assignment">Delete</button>
          </div>
        `).join("") : `<p class="panel-empty">No assignments yet for this classroom.</p>`}
        <div class="assignment-form">
          <input class="assignment-title-input" type="text" maxlength="60" placeholder="Assignment title (e.g. Complete the Ramp Challenge)" />
          <input class="assignment-instructions-input" type="text" maxlength="500" placeholder="Instructions (optional)" />
          <input class="assignment-due-input" type="date" title="Due date (optional)" />
          <details class="assignment-variation-form">
            <summary>Randomize values per student</summary>
            <p class="saves-hint">Each student gets their own slightly different numbers (same idea, different answer). Tick what should vary, its middle value, and ± percent.</p>
            ${VARIATION_VARS.map((v) => `
              <div class="variation-row" data-var="${v.id}">
                <label><input type="checkbox" class="variation-on" /> ${v.label}</label>
                <span>around <input type="number" class="variation-base" step="any" value="${v.base}" style="width:64px" /> ${v.unit}</span>
                <span>±<input type="number" class="variation-pct" min="1" max="50" value="10" style="width:52px" />%</span>
              </div>`).join("")}
          </details>
          <button class="assignment-create-btn primary" data-code="${c.code}">Add assignment</button>
        </div>
      </div>
    `; }).join("") : `<p class="panel-empty">You're not teaching any classrooms yet.</p>`}
    ${getUser()?.title === "teacher" ? `
      <div class="classroom-form">
        <input id="classroom-name-input" type="text" maxlength="60" placeholder="Classroom name (e.g. 3rd Period Physics)" />
        <button id="classroom-create-btn" class="primary">Create classroom</button>
      </div>
    ` : `<p class="saves-hint">Only a Teacher account can create a classroom — switch your Title to Teacher in the account menu.</p>`}

    <h3>Joined</h3>
    ${data.joined.length ? data.joined.map((c) => {
      const assignments = assignmentsForCode(assignmentData, c.code);
      return `
      <div class="classroom-row">
        <div class="classroom-row-info">
          <div class="classroom-row-name">${escapeHtml(c.name)}</div>
          <div class="classroom-row-meta">Teacher: ${escapeHtml(c.teacherEmail)}</div>
        </div>
        <button class="classroom-leave" data-code="${c.code}">Leave</button>
      </div>
      <div class="assignment-list">
        ${assignments.length ? assignments.map((a) => `
          <div class="assignment-row">
            <label class="assignment-row-info assignment-checkbox-row">
              <input type="checkbox" class="assignment-complete-checkbox" data-id="${a.id}" ${a.completed ? "checked" : ""} />
              <div>
                <div class="assignment-row-title${a.completed ? " assignment-done" : ""}">${escapeHtml(a.title)}</div>
                <div class="assignment-row-meta">${a.completed ? "Completed" : "Not completed"}${dueLabel(a.dueAt)}</div>
                ${a.instructions ? `<div class="assignment-row-instructions">${escapeHtml(a.instructions)}</div>` : ""}
              </div>
            </label>
            ${a.variation ? studentVariationHtml(a) : ""}
          </div>
        `).join("") : `<p class="panel-empty">No assignments yet for this classroom.</p>`}
      </div>
    `; }).join("") : `<p class="panel-empty">You haven't joined a classroom yet.</p>`}
    ${getUser()?.title === "student" ? `
      <div class="classroom-form">
        <input id="classroom-code-input" type="text" maxlength="6" placeholder="Class code" style="text-transform: uppercase;" />
        <button id="classroom-join-btn" class="primary">Join classroom</button>
      </div>
    ` : `<p class="saves-hint">Only a Student account can join a classroom — switch your Title to Student in the account menu.</p>`}

    <button id="classroom-close">Close</button>
  `;

  box.querySelector("#classroom-close").addEventListener("click", () => modal.classList.add("hidden"));

  box.querySelector("#classroom-create-btn")?.addEventListener("click", async () => {
    const input = box.querySelector("#classroom-name-input");
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const result = await createClassroom(name);
    if (result.error) { await alertPopup(result.error, { title: "Couldn't create classroom" }); return; }
    render();
  });

  box.querySelector("#classroom-join-btn")?.addEventListener("click", async () => {
    const input = box.querySelector("#classroom-code-input");
    const code = input.value.trim();
    if (!code) { input.focus(); return; }
    const result = await joinClassroom(code);
    if (result.error) { await alertPopup(result.error, { title: "Couldn't join classroom" }); return; }
    render();
  });

  box.querySelectorAll(".classroom-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.code;
      if (!(await confirmPopup("Delete this classroom? Every student in it will be removed too.", { title: "Delete classroom", confirmLabel: "Delete", danger: true }))) return;
      const result = await deleteClassroom(code);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't delete classroom" }); return; }
      render();
    });
  });

  box.querySelectorAll(".classroom-leave").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.code;
      if (!(await confirmPopup("Leave this classroom?", { title: "Leave classroom", confirmLabel: "Leave" }))) return;
      const result = await leaveClassroom(code);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't leave classroom" }); return; }
      render();
    });
  });

  box.querySelectorAll(".assignment-create-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const list = btn.closest(".assignment-list");
      const titleInput = list.querySelector(".assignment-title-input");
      const instructionsInput = list.querySelector(".assignment-instructions-input");
      const dueInput = list.querySelector(".assignment-due-input");
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const dueAt = dueInput.value ? new Date(dueInput.value + "T23:59:59").getTime() : null;
      const variation = readVariationForm(list);
      const result = await createAssignment(btn.dataset.code, title, instructionsInput.value.trim(), dueAt, variation);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't add assignment" }); return; }
      render();
    });
  });

  box.querySelectorAll(".variation-apply").forEach((b) => {
    b.addEventListener("click", () => {
      if (!variationApplier) return;
      variationApplier(JSON.parse(b.dataset.values), b.dataset.title);
      modal.classList.add("hidden");
    });
  });

  box.querySelectorAll(".assignment-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!(await confirmPopup("Delete this assignment for every student?", { title: "Delete assignment", confirmLabel: "Delete", danger: true }))) return;
      const result = await deleteAssignment(btn.dataset.id);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't delete assignment" }); return; }
      render();
    });
  });

  box.querySelectorAll(".assignment-complete-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const result = await setAssignmentComplete(checkbox.dataset.id, checkbox.checked);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't update assignment" }); checkbox.checked = !checkbox.checked; return; }
      render();
    });
  });
}

function readVariationForm(list) {
  const params = [];
  list.querySelectorAll(".variation-row").forEach((row) => {
    if (!row.querySelector(".variation-on").checked) return;
    params.push({ id: row.dataset.var, base: parseFloat(row.querySelector(".variation-base").value), pct: parseFloat(row.querySelector(".variation-pct").value) });
  });
  return sanitizeVariation({ params });
}

// Teacher: what varies, plus every student's own numbers (recomputed with
// the same seeded function the student's browser uses) for grading.
function teacherVariationHtml(a, students) {
  const summary = a.variation.params.map((p) => {
    const def = getVariationVar(p.id), [lo, hi] = rangeOf(p);
    return `${escapeHtml(def.label)} ${lo.toFixed(2)}–${hi.toFixed(2)}`;
  }).join(" · ");
  return `<div class="assignment-variation">
    <div class="assignment-row-meta">Randomized: ${summary}</div>
    <details><summary>Each student's values</summary>
      ${students.length ? students.map((email) => `<div class="assignment-row-meta">${escapeHtml(email)}: ${describeValues(valuesFor(a.variation, a.id, email)).map(escapeHtml).join(", ")}</div>`).join("") : `<div class="assignment-row-meta">No students yet.</div>`}
    </details></div>`;
}

// Student: their own values for this assignment, and a button to load them.
function studentVariationHtml(a) {
  const email = getUser()?.email;
  const values = valuesFor(a.variation, a.id, email);
  return `<div class="assignment-variation">
    <div class="assignment-row-meta">Your values: ${describeValues(values).map(escapeHtml).join(", ")}</div>
    <button class="variation-apply" data-title="${escapeHtml(a.title)}" data-values="${escapeHtml(JSON.stringify(values))}">Apply my values to the sandbox</button>
  </div>`;
}
