// Admin-only panel for manually curating Featured Creator Worlds. Visibility
// is entirely a convenience — the server re-checks ADMIN_EMAILS on every
// request here regardless of whether this button is even shown.
import { onAuthChange, fetchAdminCommunitySims, setSimFeatured, escapeHtml } from "./auth.js";
import { alertPopup } from "./popup.js";

let modal, box;

export function initAdminUI() {
  modal = document.getElementById("admin-modal");
  box = document.getElementById("admin-modal-box");
  const btn = document.getElementById("admin-btn");

  btn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    render();
  });

  onAuthChange((u) => {
    btn.classList.toggle("hidden", !u?.isAdmin);
  });
}

async function render() {
  box.innerHTML = `<h2>Admin</h2><p class="panel-empty">Loading…</p>`;
  let sims;
  try { sims = await fetchAdminCommunitySims(); }
  catch (e) {
    box.innerHTML = `<h2>Admin</h2><p class="panel-empty">${escapeHtml(e.message || "Couldn't load community sims.")}</p><button id="admin-close">Close</button>`;
    box.querySelector("#admin-close").addEventListener("click", () => modal.classList.add("hidden"));
    return;
  }

  box.innerHTML = `
    <h2>Admin — Community Sims</h2>
    <p class="saves-hint">Feature a sim to surface it in every viewer's Featured Creator Worlds tab.</p>
    <div class="saves-list">
      ${sims.length === 0 ? '<p class="saves-empty">Nothing published yet.</p>' : sims.map((s) => `
        <div class="saves-item community-card">
          <div class="saves-item-info">
            <div class="saves-item-name">${escapeHtml(s.name)}${s.isFeatured ? " ★" : ""}</div>
            <div class="saves-item-date">by ${escapeHtml(s.creatorName)} (${escapeHtml(s.ownerEmail)}) · ${escapeHtml(s.kind)}${s.subject ? ` · ${escapeHtml(s.subject)}` : ""}</div>
            ${s.description ? `<div class="saves-item-date">${escapeHtml(s.description)}</div>` : ""}
            <div class="saves-item-date">★ ${s.favoriteCount} favorites · 🔀 ${s.remixCount} remixes${s.reportCount ? ` · ⚠ ${s.reportCount} report${s.reportCount === 1 ? "" : "s"}` : ""}</div>
          </div>
          <div class="saves-item-actions">
            <button class="admin-feature-toggle" data-id="${s.id}" data-featured="${s.isFeatured}">${s.isFeatured ? "Unfeature" : "Feature"}</button>
          </div>
        </div>
      `).join("")}
    </div>
    <button id="admin-close">Close</button>
  `;

  box.querySelector("#admin-close").addEventListener("click", () => modal.classList.add("hidden"));
  box.querySelectorAll(".admin-feature-toggle").forEach((btn) => btn.addEventListener("click", async () => {
    const nextFeatured = btn.dataset.featured !== "true";
    const result = await setSimFeatured(btn.dataset.id, nextFeatured);
    if (result?.error) { await alertPopup(result.error, { title: "Couldn't update" }); return; }
    render();
  }));
}
