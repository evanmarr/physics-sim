// Asked once, on first visit: mobile or computer? The answer only changes
// CSS (bigger touch targets, hidden keyboard-only hints) via a
// data-device attribute — every interaction underneath (drag, draw, pinch)
// already runs on Pointer Events, which mouse and touch both fire, so nothing
// about the actual event wiring needs to branch on this.
const STORAGE_KEY = "continuum-device-mode";

export function getDeviceMode() {
  return localStorage.getItem(STORAGE_KEY);
}

export function initDeviceMode() {
  const saved = getDeviceMode();
  if (saved === "mobile" || saved === "computer") {
    applyDeviceMode(saved);
    return;
  }
  showPrompt();
}

function applyDeviceMode(mode) {
  document.documentElement.dataset.device = mode;
}

// Shown on first visit, and again any time the user wants to switch (a
// "Change device mode" control elsewhere calls this directly). `isChange`
// just tweaks the copy so it doesn't say "Welcome" on a repeat visit.
export function showPrompt(isChange = false) {
  const overlay = document.createElement("div");
  overlay.className = "device-prompt-overlay";
  overlay.innerHTML = `
    <div class="device-prompt-box">
      <h2>${isChange ? "Change device mode" : "Welcome to Continuum"}</h2>
      <p>Are you on a mobile device or a computer? This just resizes buttons and controls for touch — everything still works the same either way.</p>
      <div class="device-prompt-actions">
        <button class="primary" data-mode="mobile">📱 Mobile device</button>
        <button class="primary" data-mode="computer">🖥 Computer</button>
      </div>
      <label class="device-prompt-remember">
        <input type="checkbox" checked />
        Remember my choice
      </label>
    </div>
  `;
  document.body.appendChild(overlay);
  const remember = overlay.querySelector(".device-prompt-remember input");
  overlay.querySelectorAll("button[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (remember.checked) localStorage.setItem(STORAGE_KEY, mode);
      else localStorage.removeItem(STORAGE_KEY);
      applyDeviceMode(mode);
      overlay.remove();
    });
  });
}
