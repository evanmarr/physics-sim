// Explore / Learn / Advanced — formalizes what was previously only
// marketing copy in the Plans modal into a real, working preference.
//
// Reuses the onboarding quiz's existing "How much science background do
// you have?" answer (src/onboarding.js) as the default, rather than
// asking a second, redundant question — that answer already maps
// naturally onto these three levels and was otherwise collected and never
// used anywhere (write-only). A per-session override (localStorage) lets
// someone switch levels without editing their onboarding answer.
//
// Advanced is Plus-gated per the product spec; Explore/Learn are free for
// everyone, including a signed-out visitor.
import { getUser } from "./auth.js";

export const LEVELS = ["explore", "learn", "advanced"];

const BACKGROUND_TO_LEVEL = {
  "New to this": "explore",
  "Some background": "learn",
  "Very experienced": "advanced",
};

function isPlus() {
  return !!getUser()?.entitlements?.isPlus;
}

function defaultLevel() {
  const bg = getUser()?.preferences?.background;
  const mapped = BACKGROUND_TO_LEVEL[bg] || "learn";
  return mapped === "advanced" && !isPlus() ? "learn" : mapped;
}

export function getExperienceLevel() {
  const stored = localStorage.getItem("kinetic-experience-level");
  if (stored && LEVELS.includes(stored)) {
    if (stored === "advanced" && !isPlus()) return "learn"; // never silently grant Advanced past an expired/downgraded Plus
    return stored;
  }
  return defaultLevel();
}

export function setExperienceLevel(level) {
  if (!LEVELS.includes(level)) return;
  if (level === "advanced" && !isPlus()) return; // caller's UI should already prevent this; enforced here too
  try { localStorage.setItem("kinetic-experience-level", level); } catch { /* private browsing, etc. — falls back to the default each load */ }
}

// A small reusable 3-pill selector — appended wherever a module wants to
// expose it (currently the Physics 2D toolbar; other modules can reuse
// this same function). Calling `onChange` lets the caller react (e.g.
// Physics 2D shows/hides its equations panel by default based on level).
export function renderExperienceLevelPicker(container, onChange) {
  container.innerHTML = "";
  const current = getExperienceLevel();
  const plus = isPlus();
  const labels = { explore: "Explore", learn: "Learn", advanced: "Advanced" };
  for (const level of LEVELS) {
    const btn = document.createElement("button");
    btn.textContent = labels[level] + (level === "advanced" && !plus ? " (Plus)" : "");
    btn.className = "experience-level-pill" + (level === current ? " active" : "");
    btn.title = level === "advanced" && !plus ? "Advanced is a Kinetic Plus feature" : "";
    btn.addEventListener("click", () => {
      if (level === "advanced" && !plus) { document.getElementById("plans-btn")?.click(); return; }
      setExperienceLevel(level);
      renderExperienceLevelPicker(container, onChange);
      onChange?.(level);
    });
    container.appendChild(btn);
  }
}
