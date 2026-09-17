// Physics world share codes (Kinetic Plus) — a short, typeable code that
// loads a specific world snapshot, separate from Community Sims (a
// permanent public gallery) and classroom sharing (membership-scoped).
// Generating a code needs Plus; loading one is open to anyone, including
// a free/signed-out visitor, matching "Free users can see the Plus
// feature but cannot generate... Promo Plus CAN use world share codes."
import { getUser } from "./auth.js";
import { alertPopup, confirmPopup, promptPopup } from "./popup.js";

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    method: opts?.method || "GET",
    headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function formatCode(code) { return `${code.slice(0, 4)}-${code.slice(4)}`; }
function normalizeCode(input) { return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

export function initWorldShareUI({ getWorldData, applyWorldData, hasUnsavedWork }) {
  document.getElementById("world-share-btn").addEventListener("click", async () => {
    if (!getUser()) { document.getElementById("account-btn").click(); return; }

    const wantsToLoad = !(await confirmPopup(
      "Generate a share code for your CURRENT world, or load a code someone shared with you?",
      { title: "World Share Code", confirmLabel: "Generate code", cancelLabel: "Load a code" }
    ));

    if (!wantsToLoad) {
      if (!getUser().entitlements?.limits?.shareCodesEnabled) {
        const seePlans = await confirmPopup("Generating a share code is a Kinetic Plus feature.", { title: "Kinetic Plus", confirmLabel: "See Plans", cancelLabel: "Close" });
        if (seePlans) document.getElementById("plans-btn").click();
        return;
      }
      try {
        const { code } = await api("/world-share", { method: "POST", body: { kind: "worlds", data: getWorldData() } });
        const formatted = formatCode(code);
        try { await navigator.clipboard.writeText(formatted); } catch { /* clipboard permission denied — still shown below */ }
        await alertPopup(`Share code: ${formatted}\n\n(Copied to your clipboard if your browser allowed it.) Anyone with this code can load a copy of your current world.`, { title: "Code generated" });
      } catch (e) {
        await alertPopup(e.message, { title: "Couldn't generate code" });
      }
      return;
    }

    const raw = await promptPopup("Enter a share code:", { title: "Load Shared World", placeholder: "K7P4-X2", maxLength: 7 });
    if (!raw) return;
    const code = normalizeCode(raw);
    if (!/^[A-Z0-9]{6}$/.test(code)) { await alertPopup("That's not a valid 6-character code.", { title: "Invalid code" }); return; }

    let found;
    try {
      found = await api(`/world-share?code=${encodeURIComponent(code)}`);
    } catch (e) {
      await alertPopup(e.message, { title: "Couldn't load code" });
      return;
    }
    if (found.schemaVersion > 1) {
      await alertPopup("This code was saved by a newer version of Kinetic and can't be safely loaded here yet.", { title: "Version mismatch" });
      return;
    }
    if (hasUnsavedWork()) {
      const ok = await confirmPopup("Loading this shared world will replace your current one. Anything unsaved will be lost — continue?", { title: "Replace current world?", confirmLabel: "Replace it" });
      if (!ok) return;
    }
    applyWorldData(found.data);
  });
}
