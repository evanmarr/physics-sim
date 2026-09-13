// Account system: sign in/up UI plus the "My Saves" panel shared by
// Physics (worlds) and Mathematics (charts). Talks to the same-origin
// /api/* routes in server/server.js — no tokens or secrets live here,
// just a session cookie the browser sends automatically.
import { confirmPopup, alertPopup, promptPopup } from "./popup.js";

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
// A trusted device (one that's already proven it can read this account's
// inbox — see beginVerification/verify-code server-side) skips the code
// step entirely: the server returns the real signed-in user directly
// instead of a pending token, so this signs them in right here rather than
// making the caller go through renderVerifyStep for no reason.
export async function signIn(email, password) {
  const data = await api("/login", { method: "POST", body: { email, password } });
  if (!data.pending) setUser(data);
  return data;
}
export async function signOut() {
  try { await api("/logout", { method: "POST" }); } catch { /* still clear client-side state */ }
  setUser(null);
}

export const fetchItems = (kind) => api(`/${kind}`).then((d) => d.items);
export const createItem = (kind, name, data, snapshot) => api(`/${kind}`, { method: "POST", body: { name, data, snapshot } }).catch((e) => ({ error: e.message }));
export const updateSavedItem = (kind, id, name, data, snapshot) => api(`/${kind}/${id}`, { method: "PUT", body: { name, data, snapshot } }).catch((e) => ({ error: e.message }));
export const deleteSavedItem = (kind, id) => api(`/${kind}/${id}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));

// ---------- Community Sims ----------
// Browsing is public (no /api session gate on GET) — these still go
// through the same `api()` helper, which just means a signed-out call
// works fine and simply won't include any of this browser's own session.
export const fetchCommunitySims = (kind) => api(`/community-sims${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`).then((d) => d.sims);
export const fetchCommunitySimById = (id) => api(`/community-sims/${id}`).then((d) => d.sim);
export const fetchFeaturedSims = () => api("/community-sims/featured").then((d) => d.sims);
export const fetchMyFavoriteIds = () => api("/community-sims?mine=1").then((d) => d.favoriteIds).catch(() => []);
export const publishCommunitySim = (kind, name, description, subject, data, snapshot) =>
  api("/community-sims", { method: "POST", body: { kind, name, description, subject, data, snapshot } }).catch((e) => ({ error: e.message }));
export const remixCommunitySim = (id) => api(`/community-sims/${id}/remix`, { method: "POST" }).catch((e) => ({ error: e.message }));
export const toggleFavoriteSim = (id) => api(`/community-sims/${id}/favorite`, { method: "POST" }).catch((e) => ({ error: e.message }));
export const reportSim = (id) => api(`/community-sims/${id}/report`, { method: "POST" }).catch((e) => ({ error: e.message }));
export const unpublishSim = (id) => api(`/community-sims/${id}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));

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
    titleBtn.classList.toggle("hidden", !u);
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
      if (pending.pending) renderVerifyStep(pending.token, pending.email);
      else authModal.classList.add("hidden"); // a trusted device — signIn() already completed sign-in above
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
// Community Sims / Featured Creator Worlds live as extra tabs in this same
// modal — only offered for kinds the server actually allows publishing
// ("worlds" / "math-items"), so Sustainability's cities panel just doesn't
// show them rather than showing a Publish button that would always 400.

const COMMUNITY_ENABLED_KINDS = new Set(["worlds", "math-items"]);

function timeAgo(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

// A community sim is public by definition once published, so the share
// link + QR code just point at it directly — no separate permission check
// needed (there's no paid-tier/entitlement system in this app to gate on).
async function showShareLink(simId) {
  const modal = document.getElementById("popup-modal");
  const box = document.getElementById("popup-modal-box");
  const link = `${location.origin}${location.pathname}?sim=${encodeURIComponent(simId)}`;
  box.innerHTML = `
    <h2>Share this sim</h2>
    <p class="popup-message">Anyone with this link (or who scans the code) opens it directly — on a phone, a classroom projector, wherever.</p>
    <input id="share-link-input" type="text" readonly value="${link}" style="width:100%;box-sizing:border-box;margin-bottom:10px;" />
    <div id="share-qr" style="display:flex;justify-content:center;margin-bottom:12px;"></div>
    <div class="popup-actions">
      <button id="popup-cancel">Close</button>
      <button id="share-copy-btn" class="primary">Copy link</button>
    </div>
  `;
  modal.classList.remove("hidden");
  box.querySelector("#popup-cancel").addEventListener("click", () => modal.classList.add("hidden"));
  box.querySelector("#share-copy-btn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); box.querySelector("#share-copy-btn").textContent = "Copied!"; }
    catch { box.querySelector("#share-link-input").select(); }
  });
  const qrHolder = box.querySelector("#share-qr");
  try {
    // Type 0 = auto-sized to fit the data; "M" = medium error correction,
    // the standard default for a URL-carrying QR code.
    const qr = window.qrcode(0, "M");
    qr.addData(link);
    qr.make();
    qrHolder.innerHTML = qr.createImgTag(5, 8);
  } catch {
    qrHolder.textContent = "(QR code unavailable)";
  }
}

export async function openSavesPanel({ kind, title, itemNoun, serialize, apply, max = 6, getSnapshot }) {
  if (!user) {
    renderAuthModal("signin");
    authModal.classList.remove("hidden");
    return;
  }
  const modal = document.getElementById("saves-modal");
  const box = document.getElementById("saves-modal-box");
  const communityEnabled = COMMUNITY_ENABLED_KINDS.has(kind);
  let tab = "mine";
  let favoriteIds = new Set();

  function tabsHtml() {
    if (!communityEnabled) return "";
    return `
      <div class="econ-tabs" style="margin-bottom:10px;">
        <button class="econ-tab saves-tab ${tab === "mine" ? "active" : ""}" data-tab="mine">${escapeHtml(title)}</button>
        <button class="econ-tab saves-tab ${tab === "community" ? "active" : ""}" data-tab="community">Community Sims</button>
        <button class="econ-tab saves-tab ${tab === "featured" ? "active" : ""}" data-tab="featured">Featured Creator Worlds</button>
      </div>`;
  }

  function simCardHtml(sim, { mine }) {
    const isFavorited = favoriteIds.has(sim.id);
    return `
      <div class="saves-item community-card">
        ${sim.snapshot ? `<img class="community-snapshot" src="${sim.snapshot}" alt="" />` : `<div class="community-snapshot community-snapshot-empty"></div>`}
        <div class="saves-item-info">
          <div class="saves-item-name">${escapeHtml(sim.name)}</div>
          <div class="saves-item-date">by ${escapeHtml(sim.creatorName)}${sim.subject ? ` · ${escapeHtml(sim.subject)}` : ""} · ${timeAgo(sim.createdAt)}</div>
          ${sim.description ? `<div class="saves-item-date">${escapeHtml(sim.description)}</div>` : ""}
          <div class="saves-item-date">★ ${sim.favoriteCount} · 🔀 ${sim.remixCount} remix${sim.remixCount === 1 ? "" : "es"}</div>
        </div>
        <div class="saves-item-actions">
          <button class="community-open" data-id="${sim.id}">Open</button>
          <button class="community-remix" data-id="${sim.id}">Remix</button>
          <button class="community-favorite" data-id="${sim.id}">${isFavorited ? "★ Favorited" : "☆ Favorite"}</button>
          <button class="community-share" data-id="${sim.id}">🔗 Share</button>
          ${mine ? `<button class="community-unpublish danger" data-id="${sim.id}">Unpublish</button>` : `<button class="community-report" data-id="${sim.id}">Report</button>`}
        </div>
      </div>`;
  }

  async function render() {
    if (tab === "mine") return renderMine();
    if (tab === "community") return renderCommunity();
    return renderFeatured();
  }

  async function renderMine() {
    let items;
    try { items = await fetchItems(kind); } catch { items = []; }
    const atMax = items.length >= max;
    box.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      ${tabsHtml()}
      <div class="saves-new-row">
        <input id="saves-new-name" type="text" placeholder="Name this ${escapeHtml(itemNoun || "save")}" maxlength="60" ${atMax ? "disabled" : ""} />
        <button id="saves-new-btn" class="primary" ${atMax ? "disabled" : ""}>Save current</button>
      </div>
      ${atMax ? `<p class="saves-hint">You have ${max} saved — delete one to save a new one.</p>` : ""}
      <div class="saves-list">
        ${items.length === 0 ? '<p class="saves-empty">Nothing saved yet.</p>' : items.map((it) => `
          <div class="saves-item">
            ${it.snapshot ? `<img class="community-snapshot" src="${it.snapshot}" alt="" />` : ""}
            <div class="saves-item-info">
              <div class="saves-item-name">${escapeHtml(it.name)}</div>
              <div class="saves-item-date">${new Date(it.updatedAt).toLocaleString()}</div>
            </div>
            <div class="saves-item-actions">
              <button class="saves-load" data-id="${it.id}">Load</button>
              <button class="saves-overwrite" data-id="${it.id}">Overwrite</button>
              ${communityEnabled ? `<button class="saves-publish" data-id="${it.id}">Publish</button>` : ""}
              <button class="saves-delete danger" data-id="${it.id}">Delete</button>
            </div>
          </div>`).join("")}
      </div>
      <button id="saves-close">Close</button>
    `;

    wireCommon();
    box.querySelector("#saves-new-btn")?.addEventListener("click", async () => {
      const name = box.querySelector("#saves-new-name").value.trim() || "Untitled";
      const result = await createItem(kind, name, serialize(), getSnapshot?.());
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
      await updateSavedItem(kind, item.id, item.name, serialize(), getSnapshot?.());
      render();
    }));
    box.querySelectorAll(".saves-delete").forEach((btn) => btn.addEventListener("click", async () => {
      if (!(await confirmPopup("Delete this save? This can't be undone.", { title: "Delete save", confirmLabel: "Delete", danger: true }))) return;
      await deleteSavedItem(kind, btn.dataset.id);
      render();
    }));
    box.querySelectorAll(".saves-publish").forEach((btn) => btn.addEventListener("click", async () => {
      const item = items.find((it) => it.id === btn.dataset.id);
      const description = await promptPopup("Describe this sim for the Community gallery (optional):", { title: "Publish to Community" });
      if (description === null) return; // cancelled
      const result = await publishCommunitySim(kind, item.name, description, "", item.data, item.snapshot);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't publish" }); return; }
      await alertPopup(`Published "${item.name}" to Community Sims.`, { title: "Published" });
    }));
  }

  async function renderCommunity() {
    let sims;
    try { sims = await fetchCommunitySims(kind); favoriteIds = new Set(await fetchMyFavoriteIds()); } catch { sims = []; }
    box.innerHTML = `
      <h2>Community Sims</h2>
      ${tabsHtml()}
      <p class="saves-hint">Published by other creators — Open to try one, Remix to make your own editable copy (never edits the original).</p>
      <div class="saves-list">
        ${sims.length === 0 ? '<p class="saves-empty">Nothing published yet — be the first from the "' + escapeHtml(title) + '" tab.</p>' : sims.map((s) => simCardHtml(s, { mine: s.ownerEmail === user.email })).join("")}
      </div>
      <button id="saves-close">Close</button>
    `;
    wireCommon();
    wireCommunityActions(sims);
  }

  async function renderFeatured() {
    let sims;
    try { sims = await fetchFeaturedSims(); favoriteIds = new Set(await fetchMyFavoriteIds()); } catch { sims = []; }
    box.innerHTML = `
      <h2>Featured Creator Worlds</h2>
      ${tabsHtml()}
      <p class="saves-hint">Hand-picked by the Kinetic team.</p>
      <div class="saves-list">
        ${sims.length === 0 ? '<p class="saves-empty">Nothing featured yet.</p>' : sims.map((s) => simCardHtml(s, { mine: s.ownerEmail === user.email })).join("")}
      </div>
      <button id="saves-close">Close</button>
    `;
    wireCommon();
    wireCommunityActions(sims);
  }

  function wireCommon() {
    box.querySelector("#saves-close").addEventListener("click", () => modal.classList.add("hidden"));
    box.querySelectorAll(".saves-tab").forEach((btn) => btn.addEventListener("click", () => { tab = btn.dataset.tab; render(); }));
  }

  function wireCommunityActions(sims) {
    box.querySelectorAll(".community-open").forEach((btn) => btn.addEventListener("click", async () => {
      const full = await api(`/community-sims/${btn.dataset.id}`).catch(() => null);
      if (full?.sim) { apply(full.sim.data); modal.classList.add("hidden"); }
    }));
    box.querySelectorAll(".community-remix").forEach((btn) => btn.addEventListener("click", async () => {
      const result = await remixCommunitySim(btn.dataset.id);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't remix" }); return; }
      await alertPopup(`Added "${result.item.name}" to your own ${escapeHtml(title)}.`, { title: "Remixed" });
      tab = "mine";
      render();
    }));
    box.querySelectorAll(".community-favorite").forEach((btn) => btn.addEventListener("click", async () => {
      await toggleFavoriteSim(btn.dataset.id);
      render();
    }));
    box.querySelectorAll(".community-share").forEach((btn) => btn.addEventListener("click", () => showShareLink(btn.dataset.id)));
    box.querySelectorAll(".community-report").forEach((btn) => btn.addEventListener("click", async () => {
      if (!(await confirmPopup("Report this sim for review?", { confirmLabel: "Report" }))) return;
      await reportSim(btn.dataset.id);
      await alertPopup("Thanks — this has been reported for review.", { title: "Reported" });
    }));
    box.querySelectorAll(".community-unpublish").forEach((btn) => btn.addEventListener("click", async () => {
      if (!(await confirmPopup("Unpublish this from Community Sims? Your own saved copy (if any) is unaffected.", { confirmLabel: "Unpublish", danger: true }))) return;
      await unpublishSim(btn.dataset.id);
      render();
    }));
  }

  await render();
  modal.classList.remove("hidden");
}
