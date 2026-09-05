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

export async function signUp(email, password, subscribe) {
  const data = await api("/signup", { method: "POST", body: { email, password, subscribe } });
  setUser(data);
  return data;
}
export async function signIn(email, password) {
  const data = await api("/login", { method: "POST", body: { email, password } });
  setUser(data);
  return data;
}
export async function signOut() {
  try { await api("/logout", { method: "POST" }); } catch { /* still clear client-side state */ }
  setUser(null);
}

export const fetchItems = (kind) => api(`/${kind}`).then((d) => d.items);
export const createItem = (kind, name, data) => api(`/${kind}`, { method: "POST", body: { name, data } }).catch((e) => ({ error: e.message }));
export const updateSavedItem = (kind, id, name, data) => api(`/${kind}/${id}`, { method: "PUT", body: { name, data } }).catch((e) => ({ error: e.message }));
export const deleteSavedItem = (kind, id) => api(`/${kind}/${id}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Sign in / sign up modal ----------

let authModal, authBox;

export function initAuthUI() {
  authModal = document.getElementById("auth-modal");
  authBox = document.getElementById("auth-modal-box");
  const accountBtn = document.getElementById("account-btn");
  const signoutBtn = document.getElementById("signout-btn");
  const emailLabel = document.getElementById("account-email");

  accountBtn.addEventListener("click", () => {
    renderAuthModal("signin");
    authModal.classList.remove("hidden");
  });
  signoutBtn.addEventListener("click", async () => {
    if (await confirmPopup(`Sign out of ${user.email}?`, { title: "Sign out", confirmLabel: "Sign out" })) await signOut();
  });

  onAuthChange((u) => {
    emailLabel.textContent = u ? u.email : "";
    emailLabel.classList.toggle("hidden", !u);
    accountBtn.classList.toggle("hidden", !!u);
    signoutBtn.classList.toggle("hidden", !u);
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
    <label class="auth-label">Email</label>
    <input id="auth-email" type="email" autocomplete="email" maxlength="254" />
    <label class="auth-label">Password</label>
    <input id="auth-password" type="password" autocomplete="${mode === "signin" ? "current-password" : "new-password"}" maxlength="200" />
    ${mode === "signup" ? `
      <p class="auth-hint">At least 8 characters, with a letter and a number.</p>
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
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password, authBox.querySelector("#auth-subscribe").checked);
      authModal.classList.add("hidden");
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}

// ---------- My Saves panel (shared by Physics worlds + Mathematics charts) ----------

export async function openSavesPanel({ kind, title, itemNoun, serialize, apply }) {
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
    const atMax = items.length >= 6;
    box.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <div class="saves-new-row">
        <input id="saves-new-name" type="text" placeholder="Name this ${escapeHtml(itemNoun || "save")}" maxlength="60" ${atMax ? "disabled" : ""} />
        <button id="saves-new-btn" class="primary" ${atMax ? "disabled" : ""}>Save current</button>
      </div>
      ${atMax ? '<p class="saves-hint">You have 6 saved — delete one to save a new one.</p>' : ""}
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
