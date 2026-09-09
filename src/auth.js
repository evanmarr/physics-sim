// Account system: sign in/up UI plus the "My Saves" panel shared by
// Physics (worlds) and Mathematics (charts). Talks to the same-origin
// /api/* routes in server/server.js — no tokens or secrets live here,
// just a session cookie the browser sends automatically.
import { confirmPopup, alertPopup } from "./popup.js";

let user = null; // { email, subscribed } | null
const listeners = [];

export function getUser() { return user; }
export function onAuthChange(fn) { listeners.push(fn); }
function setUser(next) { user = next; listeners.forEach((fn) => fn(user)); }

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    method: options?.method || "GET",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body, e.g. some error pages */ }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export async function refreshUser() {
  try { setUser(await api("/me")); }
  catch { setUser(null); }
  return user;
}

// Signup/login no longer create a session directly — both now return a
// { pending, token } to be resolved by verifyCode() once the emailed code
// comes back, closing the gap where a leaked/guessed password alone would
// be enough to get in.
export async function signUp(email, password, subscribe, firstName, lastName, title) {
  return api("/signup", { method: "POST", body: { email, password, subscribe, firstName, lastName, title } });
}
export async function verifyCode(token, code) {
  const data = await api("/verify-code", { method: "POST", body: { token, code } });
  setUser(data);
  return data;
}
export async function resendCode(token) {
  return api("/resend-code", { method: "POST", body: { token } });
}

// "Title" is teacher / student / independent — set at signup, changeable
// any time from the account dropdown. Purely descriptive (used by the
// classroom-sharing dashboard to decide what to show) — it's never used as
// a permission check, since a real person can be more than one of these.
export async function setTitle(title) {
  const data = await api("/title", { method: "POST", body: { title } });
  setUser(data);
  return data;
}
export async function signIn(email, password) {
  return api("/login", { method: "POST", body: { email, password } });
}
export async function signOut() {
  try { await api("/logout", { method: "POST" }); } catch { /* still clear client-side state */ }
  setUser(null);
}

export const fetchItems = (kind) => api(`/${kind}`).then((d) => d.items);
export const createItem = (kind, name, data) => api(`/${kind}`, { method: "POST", body: { name, data } }).catch((e) => ({ error: e.message }));
export const updateSavedItem = (kind, id, name, data) => api(`/${kind}/${id}`, { method: "PUT", body: { name, data } }).catch((e) => ({ error: e.message }));
export const deleteSavedItem = (kind, id) => api(`/${kind}/${id}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));

// Works whether or not anyone is signed in — the server attaches the
// session email automatically if there is one.
export const sendFeedback = (message) => api("/feedback", { method: "POST", body: { message } }).catch((e) => ({ error: e.message }));

// ---------- classrooms ----------
export const fetchClassrooms = () => api("/classrooms"); // { teaching: [...], joined: [...] }
export const createClassroom = (name) => api("/classrooms", { method: "POST", body: { name } }).catch((e) => ({ error: e.message }));
export const joinClassroom = (code) => api("/classrooms/join", { method: "POST", body: { code } }).catch((e) => ({ error: e.message }));
export const leaveClassroom = (code) => api(`/classrooms/${code}/leave`, { method: "POST" }).catch((e) => ({ error: e.message }));
export const deleteClassroom = (code) => api(`/classrooms/${code}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Sign in / sign up modal ----------

let authModal, authBox;

export function initAuthUI() {
  authModal = document.getElementById("auth-modal");
  authBox = document.getElementById("auth-modal-box");
  const accountBtn = document.getElementById("account-btn");
  const emailWrap = document.getElementById("account-email-wrap");
  const emailLabel = document.getElementById("account-email");
  const dropdown = document.getElementById("account-dropdown");
  const signoutBtn = document.getElementById("signout-btn");
  const titleBtn = document.getElementById("title-btn");

  accountBtn.addEventListener("click", () => {
    renderAuthModal("signin");
    authModal.classList.remove("hidden");
  });

  // Tapping the email itself opens a small dropdown with Sign Out in it,
  // instead of a permanent Sign Out button sitting in the top bar.
  emailLabel.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!dropdown.classList.contains("hidden") && !emailWrap.contains(e.target)) {
      dropdown.classList.add("hidden");
    }
  });
  signoutBtn.addEventListener("click", async () => {
    dropdown.classList.add("hidden");
    if (await confirmPopup(`Sign out of ${user.email}?`, { title: "Sign out", confirmLabel: "Sign out" })) await signOut();
  });

  const TITLE_ORDER = ["independent", "teacher", "student"];
  const TITLE_LABELS = { independent: "Independent", teacher: "Teacher", student: "Student" };
  titleBtn.addEventListener("click", async () => {
    const next = TITLE_ORDER[(TITLE_ORDER.indexOf(user.title) + 1) % TITLE_ORDER.length];
    await setTitle(next);
  });

  onAuthChange((u) => {
    emailLabel.textContent = u ? (u.firstName ? `${u.firstName} ${u.lastName}`.trim() : u.email) : "";
    emailWrap.classList.toggle("hidden", !u);
    dropdown.classList.add("hidden");
    accountBtn.classList.toggle("hidden", !!u);
    if (u) titleBtn.textContent = `Title: ${TITLE_LABELS[u.title] || "Independent"}`;
  });

  refreshUser();
}

function renderAuthModal(mode) {
  authBox.innerHTML = `
    <h2>${mode === "signin" ? "Sign In" : "Create Account"}</h2>
    <div class="auth-tabs">
      <button type="button" class="auth-tab ${mode === "signin" ? "active" : ""}" data-mode="signin">Sign In</button>
      <button type="button" class="auth-tab ${mode === "signup" ? "active" : ""}" data-mode="signup">Sign Up</button>
    </div>
    ${mode === "signup" ? `
      <div class="auth-name-row">
        <div><label class="auth-label">First name</label><input id="auth-first-name" type="text" autocomplete="given-name" maxlength="60" /></div>
        <div><label class="auth-label">Last name</label><input id="auth-last-name" type="text" autocomplete="family-name" maxlength="60" /></div>
      </div>
    ` : ""}
    <label class="auth-label">Email</label>
    <input id="auth-email" type="email" autocomplete="email" maxlength="254" />
    <label class="auth-label">Password</label>
    <input id="auth-password" type="password" autocomplete="${mode === "signin" ? "current-password" : "new-password"}" maxlength="200" />
    ${mode === "signup" ? `
      <p class="auth-hint">At least 8 characters, with a letter and a number.</p>
      <label class="auth-label">I am a...</label>
      <select id="auth-title">
        <option value="independent">Independent user</option>
        <option value="teacher">Teacher</option>
        <option value="student">Student</option>
      </select>
      <p class="auth-hint">You can always change this later from your account menu.</p>
      <label class="auth-checkbox"><input type="checkbox" id="auth-subscribe" checked /> Send me occasional updates (about monthly)</label>
    ` : ""}
    <div id="auth-error" class="auth-error"></div>
    <button id="auth-submit" class="primary">${mode === "signin" ? "Sign In" : "Create Account"}</button>
    <button id="auth-close">Cancel</button>
  `;

  authBox.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => renderAuthModal(tab.dataset.mode));
  });
  authBox.querySelector("#auth-close").addEventListener("click", () => authModal.classList.add("hidden"));
  authBox.querySelector("#auth-submit").addEventListener("click", async () => {
    const email = authBox.querySelector("#auth-email").value;
    const password = authBox.querySelector("#auth-password").value;
    const errorEl = authBox.querySelector("#auth-error");
    errorEl.textContent = "";
    try {
      let pending;
      if (mode === "signin") {
        pending = await signIn(email, password);
      } else {
        const firstName = authBox.querySelector("#auth-first-name").value;
        const lastName = authBox.querySelector("#auth-last-name").value;
        const title = authBox.querySelector("#auth-title").value;
        pending = await signUp(email, password, authBox.querySelector("#auth-subscribe").checked, firstName, lastName, title);
      }
      renderVerifyStep(pending.token, pending.email);
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}

// Not set up to actually send email yet (see server/newsletter/mailer.js's
// stub) — every "sent" code is written to server/outbox/ as an HTML file
// you can open directly, same as the newsletter does, until a real
// provider is wired in.
function renderVerifyStep(token, email) {
  authBox.innerHTML = `
    <h2>Check your email</h2>
    <p class="auth-hint">We sent a 6-digit code to <strong>${escapeHtml(email)}</strong>. Enter it below to finish signing in.</p>
    <label class="auth-label">Code</label>
    <input id="auth-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
    <div id="auth-error" class="auth-error"></div>
    <button id="auth-verify-submit" class="primary">Verify</button>
    <button id="auth-resend">Resend code</button>
    <button id="auth-close">Cancel</button>
  `;
  const codeInput = authBox.querySelector("#auth-code");
  codeInput.focus();
  authBox.querySelector("#auth-close").addEventListener("click", () => authModal.classList.add("hidden"));
  authBox.querySelector("#auth-resend").addEventListener("click", async () => {
    const errorEl = authBox.querySelector("#auth-error");
    try { await resendCode(token); errorEl.textContent = "Sent a new code."; errorEl.classList.add("auth-notice"); }
    catch (e) { errorEl.textContent = e.message; errorEl.classList.remove("auth-notice"); }
  });
  authBox.querySelector("#auth-verify-submit").addEventListener("click", async () => {
    const errorEl = authBox.querySelector("#auth-error");
    errorEl.textContent = ""; errorEl.classList.remove("auth-notice");
    try {
      await verifyCode(token, codeInput.value.trim());
      authModal.classList.add("hidden");
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}

// ---------- My Saves panel (shared by Physics worlds + Mathematics charts) ----------

export async function openSavesPanel({ kind, title, itemNoun, serialize, apply, max = 6 }) {
  if (!user) {
    renderAuthModal("signin");
    authModal.classList.remove("hidden");
    return;
  }
  const modal = document.getElementById("saves-modal");
  const box = document.getElementById("saves-modal-box");

  async function render() {
    let items;
    try { items = await fetchItems(kind); } catch { items = []; }
    const atMax = items.length >= max;
    box.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <div class="saves-new-row">
        <input id="saves-new-name" type="text" placeholder="Name this ${escapeHtml(itemNoun || "save")}" maxlength="60" ${atMax ? "disabled" : ""} />
        <button id="saves-new-btn" class="primary" ${atMax ? "disabled" : ""}>Save current</button>
      </div>
      ${atMax ? `<p class="saves-hint">You have ${max} saved — delete one to save a new one.</p>` : ""}
      <div class="saves-list">
        ${items.length === 0 ? '<p class="saves-empty">Nothing saved yet.</p>' : items.map((it) => `
          <div class="saves-item">
            <div class="saves-item-info">
              <div class="saves-item-name">${escapeHtml(it.name)}</div>
              <div class="saves-item-date">${new Date(it.updatedAt).toLocaleString()}</div>
            </div>
            <div class="saves-item-actions">
              <button class="saves-load" data-id="${it.id}">Load</button>
              <button class="saves-overwrite" data-id="${it.id}">Overwrite</button>
              <button class="saves-delete danger" data-id="${it.id}">Delete</button>
            </div>
          </div>`).join("")}
      </div>
      <button id="saves-close">Close</button>
    `;

    box.querySelector("#saves-close").addEventListener("click", () => modal.classList.add("hidden"));
    box.querySelector("#saves-new-btn")?.addEventListener("click", async () => {
      const name = box.querySelector("#saves-new-name").value.trim() || "Untitled";
      const result = await createItem(kind, name, serialize());
      if (result.error) { await alertPopup(result.error, { title: "Couldn't save" }); return; }
      render();
    });
    box.querySelectorAll(".saves-load").forEach((btn) => btn.addEventListener("click", () => {
      const item = items.find((it) => it.id === btn.dataset.id);
      if (item) { apply(item.data); modal.classList.add("hidden"); }
    }));
    box.querySelectorAll(".saves-overwrite").forEach((btn) => btn.addEventListener("click", async () => {
      const item = items.find((it) => it.id === btn.dataset.id);
      if (!(await confirmPopup(`Overwrite "${item.name}" with the current one?`, { confirmLabel: "Overwrite" }))) return;
      await updateSavedItem(kind, item.id, item.name, serialize());
      render();
    }));
    box.querySelectorAll(".saves-delete").forEach((btn) => btn.addEventListener("click", async () => {
      if (!(await confirmPopup("Delete this save? This can't be undone.", { title: "Delete save", confirmLabel: "Delete", danger: true }))) return;
      await deleteSavedItem(kind, btn.dataset.id);
      render();
    }));
  }

  await render();
  modal.classList.remove("hidden");
}
