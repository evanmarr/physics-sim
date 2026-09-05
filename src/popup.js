// Custom in-app confirm/alert dialogs, styled like the rest of the app,
// instead of the browser's native confirm()/alert() — those are unstyled,
// block the whole tab, and read as jarring next to a themed UI.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function els() {
  return { modal: document.getElementById("popup-modal"), box: document.getElementById("popup-modal-box") };
}

export function confirmPopup(message, { title = "Are you sure?", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  const { modal, box } = els();
  return new Promise((resolve) => {
    box.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <p class="popup-message">${escapeHtml(message)}</p>
      <div class="popup-actions">
        <button id="popup-cancel">${escapeHtml(cancelLabel)}</button>
        <button id="popup-confirm" class="${danger ? "danger" : "primary"}">${escapeHtml(confirmLabel)}</button>
      </div>
    `;
    modal.classList.remove("hidden");
    const finish = (result) => { modal.classList.add("hidden"); resolve(result); };
    box.querySelector("#popup-cancel").addEventListener("click", () => finish(false));
    box.querySelector("#popup-confirm").addEventListener("click", () => finish(true));
  });
}

export function alertPopup(message, { title = "Notice" } = {}) {
  const { modal, box } = els();
  return new Promise((resolve) => {
    box.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <p class="popup-message">${escapeHtml(message)}</p>
      <button id="popup-ok" class="primary">OK</button>
    `;
    modal.classList.remove("hidden");
    box.querySelector("#popup-ok").addEventListener("click", () => { modal.classList.add("hidden"); resolve(); });
  });
}
