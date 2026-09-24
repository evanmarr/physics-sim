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
    credentials: "same-origin",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body, e.g. some error pages */ }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// Only a real "not signed in" answer (401) signs the page out. A network
// hiccup, a cold serverless start or a transient 5xx used to land here too
// and silently drop you to the signed-out state on reload even though the
// session cookie was perfectly valid — so anything else is retried, and
// whatever user we already had is kept.
export async function refreshUser() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (res.status === 401) { setUser(null); return user; }
      if (res.ok) { setUser(await res.json()); return user; }
    } catch { /* network error — retry below */ }
    await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
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
// any time from the account dropdown. It decides who can create a
// classroom (Teacher) or join one (Student), and what the Dashboard shows.
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

// Every call below hits a single flat path segment (/api/<name>), with any
// id/action carried as a query param or request body — a hosting quirk on
// this project only routes single-segment /api/* paths correctly, silently
// 404ing anything with an extra /<id>/<action> path segment. See the
// matching comment in server/server.js.
export const fetchItems = (kind) => api(`/${kind}`).then((d) => d.items);
export const createItem = (kind, name, data, snapshot) => api(`/${kind}`, { method: "POST", body: { name, data, snapshot } }).catch((e) => ({ error: e.message }));
export const updateSavedItem = (kind, id, name, data, snapshot) => api(`/${kind}?id=${encodeURIComponent(id)}`, { method: "PUT", body: { name, data, snapshot } }).catch((e) => ({ error: e.message }));
export const deleteSavedItem = (kind, id) => api(`/${kind}?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));

// ---------- Community Sims ----------
// Browsing is public (no /api session gate on GET) — these still go
// through the same `api()` helper, which just means a signed-out call
// works fine and simply won't include any of this browser's own session.
export const fetchCommunitySims = (kind) => api(`/community-sims${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`).then((d) => d.sims);
export const fetchCommunitySimById = (id) => api(`/community-sims?id=${encodeURIComponent(id)}`).then((d) => d.sim);
export const fetchFeaturedSims = () => api("/community-sims-featured").then((d) => d.sims);
export const fetchMyFavoriteIds = () => api("/community-sims?mine=1").then((d) => d.favoriteIds).catch(() => []);
export const publishCommunitySim = (kind, name, description, subject, data, snapshot, lockCode, sourceItemId) =>
  api("/community-sims", { method: "POST", body: { kind, name, description, subject, data, snapshot, lockCode, sourceItemId } }).catch((e) => ({ error: e.message }));
export const remixCommunitySim = (id) => api(`/community-sim-remix?id=${encodeURIComponent(id)}`, { method: "POST" }).catch((e) => ({ error: e.message }));
export const toggleFavoriteSim = (id) => api(`/community-sim-favorite?id=${encodeURIComponent(id)}`, { method: "POST" }).catch((e) => ({ error: e.message }));
export const reportSim = (id) => api(`/community-sim-report?id=${encodeURIComponent(id)}`, { method: "POST" }).catch((e) => ({ error: e.message }));
export const unpublishSim = (id) => api(`/community-sims?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));

// ---------- Notification Center ----------
// An inbox, not a feed — see src/notifications.js. `subscribeToCreator`
// says "Subscribe", deliberately never "Follow": it drives exactly one
// thing (a notification when that creator publishes a new public world),
// nothing social-graph-shaped like a visible follower count.
export const fetchNotifications = () => api("/notifications").then((d) => ({ notifications: d.notifications, unreadCount: d.unreadCount }));
export const markNotificationsRead = (ids) => api("/notifications-read", { method: "POST", body: { ids } }).catch((e) => ({ error: e.message }));
export const markNotificationsUnread = (ids) => api("/notifications-read", { method: "POST", body: { ids, read: false } }).catch((e) => ({ error: e.message }));
export const markAllNotificationsRead = () => api("/notifications-read", { method: "POST", body: { all: true } }).catch((e) => ({ error: e.message }));
export const fetchSubscribedCreatorEmails = () => api("/creator-subscribe").then((d) => d.creatorEmails).catch(() => []);
export const toggleCreatorSubscription = (creatorEmail) => api("/creator-subscribe", { method: "POST", body: { creatorEmail } }).catch((e) => ({ error: e.message }));

// ---------- Weekly Challenge completion count ----------
// Public read (no sign-in needed to see "N people completed this," same as
// a community sim's favorite count) — recording a completion does need an
// account, since counting anonymous clients honestly would need its own
// device-id scheme this app doesn't otherwise have.
export const fetchWeeklyChallengeCount = (week) => api(`/weekly-challenge-count?week=${encodeURIComponent(week)}`).then((d) => d.count).catch(() => null);
export const completeWeeklyChallenge = (week, challengeId) => api("/weekly-challenge-complete", { method: "POST", body: { week, challengeId } }).then((d) => d.count).catch(() => null);

// ---------- Per-account challenge completions (Achievements/badges) ----------
// Both require a signed-in session (unlike the weekly count above) —
// there's no meaningful "device" identity to key an anonymous visitor's
// progress on, so a signed-out player's completions stay local-only until
// they sign in, same as everything else in state.completedChallenges.
export const fetchChallengeCompletions = () => api("/challenge-completions").then((d) => d.completed).catch(() => null);
export const completeChallengeRemote = (challengeId) => api("/challenge-complete", { method: "POST", body: { challengeId } }).then(() => true).catch(() => false);

// Onboarding quiz answers (src/onboarding.js) — writing them back through
// api("/me")'s own shape keeps `user` in sync immediately, same as
// title/subscribed changes elsewhere in this file.
export const savePreferences = (preferences) =>
  api("/preferences", { method: "POST", body: { preferences } }).then((u) => { setUser(u); return u; }).catch((e) => ({ error: e.message }));

// Checks a Locked object's unlock code — see panel.js's Locked checkbox and
// main.js's requestUnlock(). Never sees or stores the actual code/hash
// itself; the server does the comparison and only says yes/no.
export const verifyUnlockCode = (kind, id, code) =>
  api("/unlock-code", { method: "POST", body: { kind, id, code } }).catch((e) => ({ error: e.message }));

// Works whether or not anyone is signed in — the server attaches the
// session email automatically if there is one.
export const sendFeedback = (payload) => api("/feedback", { method: "POST", body: typeof payload === "string" ? { message: payload } : payload }).catch((e) => ({ error: e.message }));

// Server validates and applies the redemption; on success it returns the
// full updated user object (setUser here so `entitlements` everywhere else
// in the app updates immediately, same as savePreferences above) — see
// src/plans.js for the UI and server/entitlements.js for what this can and
// can't grant (Promo Plus never includes AI).
export const redeemPromoCode = (code) =>
  api("/promo-redeem", { method: "POST", body: { code } })
    .then((res) => { if (res.ok && res.user) setUser(res.user); return res; })
    .catch((e) => ({ ok: false, reason: "error", error: e.message }));

// ---------- checkout (no payment processor connected — see server/checkoutConfig.js) ----------
export const fetchCheckoutConfig = () => api("/checkout-config");
export const recordUpgradeInterest = (plan, billingPeriod) =>
  api("/upgrade-interest", { method: "POST", body: { plan, billingPeriod } }).catch((e) => ({ error: e.message }));

// ---------- classrooms ----------
export const fetchClassrooms = () => api("/classrooms"); // { teaching: [...], joined: [...] }
export const createClassroom = (name) => api("/classrooms", { method: "POST", body: { name } }).catch((e) => ({ error: e.message }));
export const joinClassroom = (code) => api("/classroom-join", { method: "POST", body: { code } }).catch((e) => ({ error: e.message }));
export const leaveClassroom = (code) => api(`/classroom-leave?code=${encodeURIComponent(code)}`, { method: "POST" }).catch((e) => ({ error: e.message }));
export const deleteClassroom = (code) => api(`/classrooms?code=${encodeURIComponent(code)}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));

// ---------- assignments ----------
export const fetchAssignments = () => api("/assignments"); // { teaching: [...], joined: [...] }
export const createAssignment = (classroomCode, title, instructions, dueAt, variation = null) =>
  api("/assignments", { method: "POST", body: { classroomCode, title, instructions, dueAt, variation } }).catch((e) => ({ error: e.message }));
export const deleteAssignment = (id) => api(`/assignments?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => ({ error: e.message }));
export const setAssignmentComplete = (id, completed) =>
  api("/assignment-complete", { method: "POST", body: { id, completed } }).catch((e) => ({ error: e.message }));

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
  const titleWrap = document.getElementById("title-wrap");
  const titleBtn = document.getElementById("title-btn");
  const titleDropdown = document.getElementById("title-dropdown");

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

  // Clicking the title no longer cycles through all three on every click —
  // it opens a small dropdown (flown out to the left, since this sits
  // inside the "..." menu already anchored at the right edge) listing just
  // the OTHER titles, the same click-to-toggle/click-outside-to-close
  // pattern as the account email dropdown above.
  titleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!titleDropdown.classList.contains("hidden")) { titleDropdown.classList.add("hidden"); return; }
    titleDropdown.innerHTML = "";
    for (const t of TITLE_ORDER) {
      if (t === user.title) continue;
      const opt = document.createElement("button");
      opt.textContent = TITLE_LABELS[t];
      opt.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        titleDropdown.classList.add("hidden");
        await setTitle(t);
      });
      titleDropdown.appendChild(opt);
    }
    titleDropdown.classList.remove("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!titleDropdown.classList.contains("hidden") && !titleWrap.contains(e.target)) {
      titleDropdown.classList.add("hidden");
    }
  });

  onAuthChange((u) => {
    emailLabel.textContent = u ? (u.firstName ? `${u.firstName} ${u.lastName}`.trim() : u.email) : "";
    emailWrap.classList.toggle("hidden", !u);
    dropdown.classList.add("hidden");
    accountBtn.classList.toggle("hidden", !!u);
    titleWrap.classList.toggle("hidden", !u);
    titleDropdown.classList.add("hidden");
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
    <form id="auth-form" novalidate>
    <label class="auth-label">Email</label>
    <input id="auth-email" name="email" type="email" autocomplete="${mode === "signin" ? "username" : "email"}" maxlength="254" value="${escapeHtml(localStorage.getItem("kinetic-last-email") || "")}" />
    <label class="auth-label">Password</label>
    <input id="auth-password" name="password" type="password" autocomplete="${mode === "signin" ? "current-password" : "new-password"}" maxlength="200" />
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
    <button id="auth-submit" type="submit" class="primary">${mode === "signin" ? "Sign In" : "Create Account"}</button>
    <button id="auth-close" type="button">Cancel</button>
    </form>
  `;

  authBox.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => renderAuthModal(tab.dataset.mode));
  });
  authBox.querySelector("#auth-close").addEventListener("click", () => authModal.classList.add("hidden"));
  authBox.querySelector("#auth-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
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
      try { localStorage.setItem("kinetic-last-email", email.trim().toLowerCase()); } catch { /* private mode */ }
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

export async function openSavesPanel({ kind, title, itemNoun, serialize, apply, max: maxOverride, getSnapshot }) {
  if (!user) {
    renderAuthModal("signin");
    authModal.classList.remove("hidden");
    return;
  }
  const modal = document.getElementById("saves-modal");
  const box = document.getElementById("saves-modal-box");
  const communityEnabled = COMMUNITY_ENABLED_KINDS.has(kind);
  // The plan's own limit (server/entitlements.js) — Plus gets far more than Free's 6.
  const LIMIT_KEYS = { worlds: "maxWorlds", "math-items": "maxMathItems", cities: "maxCities", "ai-chats": "maxAiChats", whiteboards: "maxWhiteboards", notes: "maxNotes", "rocket-flights": "maxRocketFlights" };
  const planLimit = user.entitlements?.limits?.[LIMIT_KEYS[kind]];
  const max = maxOverride ?? (planLimit === null ? Infinity : (planLimit ?? 6));
  let tab = "mine";
  let favoriteIds = new Set();
  let subscribedCreatorEmails = new Set();

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
    const isSubscribed = subscribedCreatorEmails.has(sim.ownerEmail);
    return `
      <div class="saves-item community-card">
        ${sim.snapshot ? `<img class="community-snapshot" src="${sim.snapshot}" alt="" />` : `<div class="community-snapshot community-snapshot-empty"></div>`}
        <div class="saves-item-info">
          <div class="saves-item-name">${escapeHtml(sim.name)}</div>
          <div class="saves-item-date">by ${escapeHtml(sim.creatorName)}${sim.subject ? ` · ${escapeHtml(sim.subject)}` : ""} · ${timeAgo(sim.createdAt)}</div>
          ${sim.description ? `<div class="saves-item-date">${escapeHtml(sim.description)}</div>` : ""}
          <div class="saves-item-date">★ ${sim.favoriteCount} · ${sim.remixCount} remix${sim.remixCount === 1 ? "" : "es"}</div>
        </div>
        <div class="saves-item-actions">
          <button class="community-open" data-id="${sim.id}">Open</button>
          <button class="community-remix" data-id="${sim.id}">Remix</button>
          <button class="community-favorite" data-id="${sim.id}">${isFavorited ? "★ Favorited" : "☆ Favorite"}</button>
          ${mine ? "" : `<button class="community-subscribe" data-owner="${escapeHtml(sim.ownerEmail)}">${isSubscribed ? "Subscribed" : "Subscribe to creator"}</button>`}
          <button class="community-share" data-id="${sim.id}">Share</button>
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
      if (item) { apply(item.data, { kind, id: item.id, hasLock: !!item.hasLock }); modal.classList.add("hidden"); }
    }));
    box.querySelectorAll(".saves-overwrite").forEach((btn) => btn.addEventListener("click", async () => {
      const item = items.find((it) => it.id === btn.dataset.id);
      if (!(await confirmPopup(`Overwrite "${item.name}" with the current one? If you've published it to Community Sims, the published copy updates too.`, { confirmLabel: "Overwrite" }))) return;
      const result = await updateSavedItem(kind, item.id, item.name, serialize(), getSnapshot?.());
      if (result?.error) { await alertPopup(result.error, { title: "Couldn't overwrite" }); return; }
      render();
    }));
    box.querySelectorAll(".saves-delete").forEach((btn) => btn.addEventListener("click", async () => {
      if (!(await confirmPopup("Delete this save? This can't be undone. If it's published to Community Sims, that published copy is taken down too.", { title: "Delete save", confirmLabel: "Delete", danger: true }))) return;
      const result = await deleteSavedItem(kind, btn.dataset.id);
      if (result?.error) { await alertPopup(result.error, { title: "Couldn't delete" }); return; }
      render();
    }));
    box.querySelectorAll(".saves-publish").forEach((btn) => btn.addEventListener("click", async () => {
      const item = items.find((it) => it.id === btn.dataset.id);
      const description = await promptPopup("Describe this sim for the Community gallery (optional):", { title: "Publish to Community" });
      if (description === null) return; // cancelled

      // Only Physics worlds have lockable objects (see panel.js) — a
      // published world with any still carries real risk of a remixer
      // undoing the careful setup, so offer a code before it goes public.
      let lockCode = "";
      const hasLockedObjects = kind === "worlds" && Array.isArray(item.data?.objects) && item.data.objects.some((o) => o.locked);
      if (hasLockedObjects) {
        while (true) {
          const entered = await promptPopup(
            "This world has locked objects. Set a 6-digit code others will need to unlock and edit them? Leave blank to publish with no protection.",
            { title: "Protect locked objects", placeholder: "e.g. 482913", maxLength: 6 }
          );
          const trimmed = (entered ?? "").trim();
          if (!trimmed) { lockCode = ""; break; }
          if (!/^\d{6}$/.test(trimmed)) { await alertPopup("Enter exactly 6 digits, or leave it blank.", { title: "Invalid code" }); continue; }
          lockCode = trimmed;
          break;
        }
      }

      const result = await publishCommunitySim(kind, item.name, description, "", item.data, item.snapshot, lockCode, item.id);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't publish" }); return; }
      await alertPopup(`Published "${item.name}" to Community Sims.`, { title: "Published" });
    }));
  }

  async function renderCommunity() {
    let sims;
    try {
      sims = await fetchCommunitySims(kind);
      favoriteIds = new Set(await fetchMyFavoriteIds());
      subscribedCreatorEmails = new Set(await fetchSubscribedCreatorEmails());
    } catch { sims = []; }
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
    try {
      sims = await fetchFeaturedSims();
      favoriteIds = new Set(await fetchMyFavoriteIds());
      subscribedCreatorEmails = new Set(await fetchSubscribedCreatorEmails());
    } catch { sims = []; }
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
      const sim = await fetchCommunitySimById(btn.dataset.id).catch(() => null);
      if (sim) { apply(sim.data, { kind: "community-sim", id: sim.id, hasLock: !!sim.hasLock }); modal.classList.add("hidden"); }
    }));
    box.querySelectorAll(".community-remix").forEach((btn) => btn.addEventListener("click", async () => {
      const result = await remixCommunitySim(btn.dataset.id);
      if (result.error) { await alertPopup(result.error, { title: "Couldn't remix" }); return; }
      await alertPopup(`Added "${result.item.name}" to your own ${title}.`, { title: "Remixed" });
      tab = "mine";
      render();
    }));
    box.querySelectorAll(".community-favorite").forEach((btn) => btn.addEventListener("click", async () => {
      await toggleFavoriteSim(btn.dataset.id);
      render();
    }));
    box.querySelectorAll(".community-subscribe").forEach((btn) => btn.addEventListener("click", async () => {
      const result = await toggleCreatorSubscription(btn.dataset.owner);
      if (result?.error) { await alertPopup(result.error, { title: "Couldn't subscribe" }); return; }
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
      const result = await unpublishSim(btn.dataset.id);
      if (result?.error) { await alertPopup(result.error, { title: "Couldn't unpublish" }); return; }
      render();
    }));
  }

  await render();
  modal.classList.remove("hidden");
}
