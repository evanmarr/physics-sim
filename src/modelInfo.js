// A standardized "How This Model Works" panel — reusable across modules.
// Accuracy/sources are never gated by plan (see server/entitlements.js's
// comment on this): every field here is free for every user, always.
//
// Content is data, not generated — each module supplies a real config
// object describing ITS OWN actual implementation (the equations/constants
// it actually uses, the simplifications it actually makes). This file only
// renders that data; it never invents facts about a simulation on its own.
import { escapeHtml } from "./auth.js";

let modal, box;

export function initModelInfoUI() {
  modal = document.getElementById("model-info-modal");
  box = document.getElementById("model-info-modal-box");
}

// config: { title, concept, equation, variables: [{symbol, meaning, unit}],
//   constants: [{name, value, unit}], assumptions: [str], limitations: [str],
//   sources: [str] }
export function openModelInfo(config) {
  const esc = escapeHtml;
  box.innerHTML = `
    <h2>How This Model Works</h2>
    <h3 style="margin-bottom:2px">${esc(config.title)}</h3>
    <p class="saves-hint" style="margin-top:0">${esc(config.concept)}</p>
    ${config.equation ? `<div class="model-info-equation">${esc(config.equation)}</div>` : ""}
    ${config.variables?.length ? `
      <h4>Variables</h4>
      <ul class="model-info-list">${config.variables.map((v) => `<li><strong>${esc(v.symbol)}</strong> — ${esc(v.meaning)}${v.unit ? ` (${esc(v.unit)})` : ""}</li>`).join("")}</ul>
    ` : ""}
    ${config.constants?.length ? `
      <h4>Constants used</h4>
      <ul class="model-info-list">${config.constants.map((c) => `<li>${esc(c.name)} = ${esc(String(c.value))}${c.unit ? ` ${esc(c.unit)}` : ""}</li>`).join("")}</ul>
    ` : ""}
    ${config.assumptions?.length ? `<h4>Assumptions</h4><ul class="model-info-list">${config.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
    ${config.limitations?.length ? `<h4>Simplifications &amp; limitations</h4><ul class="model-info-list">${config.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    ${config.sources?.length ? `<h4>Sources</h4><ul class="model-info-list">${config.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    <button id="model-info-close" style="margin-top:10px">Close</button>
  `;
  box.querySelector("#model-info-close").addEventListener("click", () => modal.classList.add("hidden"));
  modal.classList.remove("hidden");
}
