// Notification Center — an inbox, not a feed. Every row here is something
// that actually happened (someone favorited/remixed your world, a creator
// you subscribed to published a new one, or an admin broadcast — a
// product update, a newsletter notice, a donor thank-you), rendered
// newest-first with a real persistent read/unread state. Deliberately
// absent: follower counts, popularity rankings, streaks, trending, DMs —
// none of that belongs in a science-sandbox app's notifications.
import { getUser, onAuthChange, fetchNotifications, markNotificationsRead, markNotificationsUnread, markAllNotificationsRead, escapeHtml } from "./auth.js";

const KIND_LABELS = {
  interaction: "Activity", new_world: "New world", new_subscriber: "Subscriber",
  product_update: "Product update", newsletter: "Newsletter", donor_thanks: "Thank you",
};

let modal, box, btn, badgeEl;
let pollTimer = null;

export function initNotificationsUI() {
  modal = document.getElementById("notifications-modal");
  box = document.getElementById("notifications-modal-box");
  btn = document.getElementById("notifications-btn");
  badgeEl = document.getElementById("notifications-badge");
  const wrap = document.getElementById("notifications-wrap");

  btn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    render();
  });

  onAuthChange((user) => {
    wrap.classList.toggle("hidden", !user);
    clearInterval(pollTimer);
    pollTimer = null;
    if (user) {
      refreshBadge();
      // A light poll, not a live feed — just enough that the bell's
      // unread count doesn't go stale for a whole session without a
      // reload. No push/websocket infrastructure here by design.
      pollTimer = setInterval(refreshBadge, 45000);
    } else {
      badgeEl.classList.add("hidden");
    }
  });
}

async function refreshBadge() {
  if (!getUser()) return;
  try {
    const { unreadCount } = await fetchNotifications();
    setBadge(unreadCount);
  } catch { /* transient network hiccup — next poll tries again */ }
}

function setBadge(count) {
  badgeEl.textContent = count > 99 ? "99+" : String(count);
  badgeEl.classList.toggle("hidden", count === 0);
}

function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

async function render() {
  box.innerHTML = `<h2>Notifications</h2><p class="panel-empty">Loading…</p>`;
  let notifications = [], unreadCount = 0;
  try { ({ notifications, unreadCount } = await fetchNotifications()); }
  catch {
    box.innerHTML = `<h2>Notifications</h2><p class="panel-empty">Couldn't load notifications right now.</p><button id="notif-close">Close</button>`;
    box.querySelector("#notif-close").addEventListener("click", () => modal.classList.add("hidden"));
    return;
  }
  setBadge(unreadCount);

  box.innerHTML = `
    <div class="notif-header">
      <h2>Notifications</h2>
      <button id="notif-mark-all" ${unreadCount === 0 ? "disabled" : ""}>Mark All as Read</button>
    </div>
    <div class="notif-list">
      ${notifications.length ? notifications.map(rowHtml).join("") : `<p class="saves-empty">Nothing yet — activity on your published worlds, new worlds from creators you subscribe to, and Kinetic updates will show up here.</p>`}
    </div>
    <button id="notif-close">Close</button>
  `;

  box.querySelector("#notif-close").addEventListener("click", () => modal.classList.add("hidden"));
  box.querySelector("#notif-mark-all").addEventListener("click", async () => {
    await markAllNotificationsRead();
    render();
  });
  // Clicking anywhere on an unread row is a quick "I've seen this" (marks
  // read); the explicit toggle link below is what covers BOTH directions,
  // including reopening something you read by mistake.
  box.querySelectorAll(".notif-row").forEach((row) => {
    row.addEventListener("click", async (e) => {
      if (e.target.closest(".notif-open") || e.target.closest(".notif-toggle-read")) return;
      const id = row.dataset.id;
      const n = notifications.find((x) => x.id === id);
      if (n?.readAt == null) { await markNotificationsRead([id]); render(); }
    });
  });
  box.querySelectorAll(".notif-toggle-read").forEach((link) => {
    link.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = link.closest(".notif-row").dataset.id;
      const n = notifications.find((x) => x.id === id);
      if (n?.readAt == null) await markNotificationsRead([id]);
      else await markNotificationsUnread([id]);
      render();
    });
  });
  box.querySelectorAll(".notif-open").forEach((link) => {
    link.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = link.closest(".notif-row");
      const id = row.dataset.id;
      const n = notifications.find((x) => x.id === id);
      if (n?.readAt == null) await markNotificationsRead([id]);
      modal.classList.add("hidden");
      // Every link so far points at a community sim; graceful "no longer
      // available" handling lives in window._openCommunitySimById itself
      // (see main.js), the same place the home page's own sim cards use.
      if (n?.linkKind === "community-sim" && n.linkId) window._openCommunitySimById?.(n.linkId);
    });
  });
}

const KIND_INITIALS = {
  interaction: "A", new_world: "W", new_subscriber: "S",
  product_update: "U", newsletter: "N", donor_thanks: "T",
};

function rowHtml(n) {
  const unread = n.readAt == null;
  const kindLabel = KIND_LABELS[n.kind] || n.kind;
  return `
    <div class="notif-row ${unread ? "notif-unread" : ""}" data-id="${n.id}">
      <div class="notif-icon" data-kind="${escapeHtml(n.kind)}" title="${escapeHtml(kindLabel)}">${KIND_INITIALS[n.kind] || "?"}</div>
      <div class="notif-row-main">
        <div class="notif-row-top">
          <span class="notif-row-title">${escapeHtml(n.title)}</span>
          <span class="notif-row-time">${timeAgo(n.updatedAt)}</span>
        </div>
        ${n.body ? `<div class="notif-row-body">${escapeHtml(n.body)}</div>` : ""}
        <div class="notif-row-actions">
          <span class="notif-kind-pill">${escapeHtml(kindLabel)}</span>
          ${n.linkKind === "community-sim" && n.linkId ? `<a href="#" class="notif-action-link notif-open">Open</a>` : ""}
          <a href="#" class="notif-action-link notif-toggle-read">${unread ? "Mark as read" : "Mark as unread"}</a>
        </div>
      </div>
    </div>
  `;
}
