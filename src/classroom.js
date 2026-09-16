// Classrooms: any signed-in account can create one (becomes its teacher,
// gets a share-able code) and/or join one with a code (becomes a student
// in it). No separate account "type" — see server.js's classrooms comment
// for why.
import { getUser, fetchClassrooms, createClassroom, joinClassroom, leaveClassroom, deleteClassroom, escapeHtml } from "./auth.js";
import { confirmPopup, alertPopup } from "./popup.js";

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

async function render() {
  box.innerHTML = `<h2>Classrooms</h2><p class="panel-empty">Loading…</p>`;
  const data = await fetchClassrooms().catch(() => null);
  if (!data) {
    box.innerHTML = `<h2>Classrooms</h2><p class="panel-empty">Couldn't load your classrooms right now.</p><button id="classroom-close">Close</button>`;
    box.querySelector("#classroom-close").addEventListener("click", () => modal.classList.add("hidden"));
    return;
  }

  box.innerHTML = `
    <h2>Classrooms</h2>

    <h3>Teaching</h3>
    ${data.teaching.length ? data.teaching.map((c) => `
      <div class="classroom-row">
        <div class="classroom-row-info">
          <div class="classroom-row-name">${escapeHtml(c.name)}</div>
          <div class="classroom-row-meta">${c.students.length} student${c.students.length === 1 ? "" : "s"}${c.students.length ? ": " + c.students.map(escapeHtml).join(", ") : ""}</div>
        </div>
        <code class="classroom-code">${c.code}</code>
        <button class="classroom-delete" data-code="${c.code}" title="Delete this classroom">Delete</button>
      </div>
    `).join("") : `<p class="panel-empty">You're not teaching any classrooms yet.</p>`}
    <div class="classroom-form">
      <input id="classroom-name-input" type="text" maxlength="60" placeholder="Classroom name (e.g. 3rd Period Physics)" />
      <button id="classroom-create-btn" class="primary">Create classroom</button>
    </div>

    <h3>Joined</h3>
    ${data.joined.length ? data.joined.map((c) => `
      <div class="classroom-row">
        <div class="classroom-row-info">
          <div class="classroom-row-name">${escapeHtml(c.name)}</div>
          <div class="classroom-row-meta">Teacher: ${escapeHtml(c.teacherEmail)}</div>
        </div>
        <button class="classroom-leave" data-code="${c.code}">Leave</button>
      </div>
    `).join("") : `<p class="panel-empty">You haven't joined a classroom yet.</p>`}
    <div class="classroom-form">
      <input id="classroom-code-input" type="text" maxlength="6" placeholder="Class code" style="text-transform: uppercase;" />
      <button id="classroom-join-btn" class="primary">Join classroom</button>
    </div>

    <button id="classroom-close">Close</button>
  `;

  box.querySelector("#classroom-close").addEventListener("click", () => modal.classList.add("hidden"));

  box.querySelector("#classroom-create-btn").addEventListener("click", async () => {
    const input = box.querySelector("#classroom-name-input");
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const result = await createClassroom(name);
    if (result.error) { await alertPopup(result.error, { title: "Couldn't create classroom" }); return; }
    render();
  });

  box.querySelector("#classroom-join-btn").addEventListener("click", async () => {
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
}
