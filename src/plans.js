// Kinetic Plans — Free / Plus / Teacher structure, plus promo code
// redemption. No real payments here (see server/server.js's promo-redeem
// route and README.md): "Upgrade" is an intentional placeholder button
// until real billing exists. The tiny square in the top-right corner opens
// promo code entry — a client-side format check only; the server (see
// server/entitlements.js) is the actual source of truth for what a code
// grants and never trusts anything sent from here.
import { getUser, redeemPromoCode, fetchCheckoutConfig, recordUpgradeInterest } from "./auth.js";

let modal, box;

export function initPlansUI() {
  modal = document.getElementById("plans-modal");
  box = document.getElementById("plans-modal-box");
  const btn = document.getElementById("plans-btn");

  btn.addEventListener("click", () => {
    if (!getUser()) {
      document.getElementById("account-btn").click();
      return;
    }
    modal.classList.remove("hidden");
    render();
  });
}

const PLAN_COPY = {
  free: {
    name: "Free", price: "$0",
    features: [
      "All subjects and every core 2D simulation",
      "Physics sandbox with core tools",
      "Explore mode + most of Learn mode",
      "Daily challenges, tutorials, quizzes",
      "Limited saved worlds (6)",
      "Basic graphs",
      "How This Works + sources — always free",
      "Limited Experiment Notebook",
    ],
  },
  plus: {
    name: "Kinetic Plus",
    features: [
      "Everything in Free, plus:",
      "Custom Physics Items (build your own shapes)",
      "More saved worlds (40), plus unlimited Notebook history",
      "Advanced graphs, export, full Compare Runs",
      "Physics world sharing codes",
      "Advanced mode across simulations",
      "Parameter Sweep, and Text labels in the Physics sandbox",
    ],
  },
  teacher: {
    name: "Teacher",
    features: [
      "Everything in Plus, plus:",
      "Classrooms, rosters, assignments",
      "Randomized per-student assignment values",
      "Share worlds, notebooks and more with your class from the Dashboard",
      "Students never need Plus to participate",
    ],
  },
};

// Fetched once per modal open — see server/checkoutConfig.js. Falls back to
// these illustrative numbers if the request fails, so the Plans page never
// shows a broken price while still making clear nothing is actually billed
// (checkout always ends at the "not connected yet" screen regardless).
let checkoutConfig = { pricing: { plus: { monthlyUsd: 6, annualUsd: 60 }, teacher: { monthlyUsd: 12, annualUsd: 120 } }, annualSavingsPct: { plus: 17, teacher: 17 }, processorConnected: false };

function priceLabel(planKey) {
  const p = checkoutConfig.pricing[planKey];
  return p ? `$${p.monthlyUsd}/mo` : "";
}

function planBadge(planKey, current) {
  const isCurrent = current.plan === planKey;
  return `
    <div class="plan-card ${planKey === "plus" ? "plan-card-plus" : ""}">
      <div class="plan-card-head">
        <div class="plan-card-name">${PLAN_COPY[planKey].name}</div>
        ${isCurrent ? `<span class="plan-pill plan-pill-current">Your plan</span>` : ""}
      </div>
      <div class="plan-card-price">${planKey === "free" ? PLAN_COPY.free.price : priceLabel(planKey)}</div>
      <ul class="plan-card-features">
        ${PLAN_COPY[planKey].features.map((f) => `<li>${f}</li>`).join("")}
      </ul>
      ${planKey === "free"
        ? ""
        : isCurrent
          ? `<button disabled class="plan-cta plan-cta-current">Active${current.planSource === "promo_plus" ? " — Promo" : ""}</button>`
          : `<button class="plan-cta primary plan-upgrade-btn" data-plan="${planKey}">Upgrade</button>`
      }
    </div>
  `;
}

async function render() {
  const user = getUser();
  const current = user?.entitlements || { plan: "free", planSource: "free", aiEnabled: false };
  checkoutConfig = await fetchCheckoutConfig().catch(() => checkoutConfig) || checkoutConfig;

  box.innerHTML = `
    <div class="plans-header">
      <h2>Plans</h2>
      <button id="promo-open-btn" class="promo-trigger" title="Have a promo code?" aria-label="Enter a promo code">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.59 13.41 12 22l-9-9 8.59-8.59A2 2 0 0 1 13 4h6a2 2 0 0 1 2 2v6a2 2 0 0 1-.41 1.41Z"/>
          <circle cx="16.5" cy="7.5" r="1.25" fill="currentColor" stroke="none"/>
        </svg>
      </button>
    </div>
    <p class="plans-sub">Build it. Change it. See what happens. — pick how far you want to take it.</p>
    <div class="plans-grid">
      ${planBadge("free", current)}
      ${planBadge("plus", current)}
      ${planBadge("teacher", current)}
    </div>
    ${current.plan !== "free" ? `<p class="plans-source-note">Access source: ${describeSource(current.planSource)}${current.aiEnabled ? "" : " · AI Tutor: not enabled"}</p>` : ""}
    <div class="ai-tutor-preview">
      <strong>Kinetic AI Tutor</strong> — <em>real chat UI in the top bar (AI Tutor), not connected to a real AI yet.</em>
      <p>Hint → Bigger Hint → Explain It, aware of your current simulation and challenge, once it's live — try it now and it'll tell you honestly it isn't connected yet, from anywhere in the app, not just Physics. Planned for paid Plus, capped around $3/month in estimated usage — not unlimited, and never promised as unlimited. <strong>Promo Plus does not include AI</strong>, even once it's live for paid Plus.</p>
    </div>
    <button id="plans-close">Close</button>
  `;

  box.querySelector("#plans-close").addEventListener("click", () => modal.classList.add("hidden"));
  box.querySelector("#promo-open-btn").addEventListener("click", renderPromoEntry);
  box.querySelectorAll(".plan-upgrade-btn").forEach((btn) => btn.addEventListener("click", () => renderCheckout(btn.dataset.plan)));
}

// ---------- checkout flow (no payment processor connected yet) ----------
// Plan pick -> billing period -> review, ending at an explicit "payments
// aren't live yet" screen rather than a real charge — see
// server/checkoutConfig.js. "Notify me" records real interest (a DB row)
// so demand isn't lost while billing isn't wired up.
function renderCheckout(planKey, billingPeriod = "monthly") {
  const pricing = checkoutConfig.pricing[planKey];
  const savings = checkoutConfig.annualSavingsPct[planKey] || 0;
  const price = billingPeriod === "annual" ? pricing.annualUsd : pricing.monthlyUsd;
  const per = billingPeriod === "annual" ? "/yr" : "/mo";

  box.innerHTML = `
    <div class="plans-header"><h2>Upgrade to ${PLAN_COPY[planKey].name}</h2></div>
    <div class="checkout-period-toggle">
      <button class="checkout-period-btn ${billingPeriod === "monthly" ? "active" : ""}" data-period="monthly">Monthly</button>
      <button class="checkout-period-btn ${billingPeriod === "annual" ? "active" : ""}" data-period="annual">Annual${savings ? ` — save ${savings}%` : ""}</button>
    </div>
    <div class="checkout-price">$${price}<span class="checkout-price-per">${per}</span></div>
    <ul class="plan-card-features">
      ${PLAN_COPY[planKey].features.map((f) => `<li>${f}</li>`).join("")}
    </ul>
    <div class="plans-promo-actions">
      <button id="checkout-continue" class="primary">Continue</button>
      <button id="checkout-back">Back</button>
    </div>
  `;

  box.querySelectorAll(".checkout-period-btn").forEach((btn) =>
    btn.addEventListener("click", () => renderCheckout(planKey, btn.dataset.period))
  );
  box.querySelector("#checkout-back").addEventListener("click", render);
  box.querySelector("#checkout-continue").addEventListener("click", () => renderCheckoutPlaceholder(planKey, billingPeriod, price, per));
}

function renderCheckoutPlaceholder(planKey, billingPeriod, price, per) {
  box.innerHTML = `
    <div class="plans-header"><h2>Almost there</h2></div>
    <div class="checkout-placeholder">
      <p><strong>${PLAN_COPY[planKey].name}</strong> — $${price}${per}</p>
      <p class="checkout-placeholder-note">Payments aren't connected yet — this won't charge you anything. Let us know you're interested and we'll email you the moment real billing goes live.</p>
    </div>
    <div id="checkout-notify-feedback" class="promo-feedback"></div>
    <div class="plans-promo-actions">
      <button id="checkout-notify" class="primary">Notify me when it's ready</button>
      <button id="checkout-back2">Back</button>
    </div>
  `;
  box.querySelector("#checkout-back2").addEventListener("click", () => renderCheckout(planKey, billingPeriod));
  box.querySelector("#checkout-notify").addEventListener("click", async () => {
    const btn = box.querySelector("#checkout-notify");
    const feedback = box.querySelector("#checkout-notify-feedback");
    btn.disabled = true;
    const result = await recordUpgradeInterest(planKey, billingPeriod);
    btn.disabled = false;
    if (result?.error) {
      feedback.textContent = "Something went wrong — try again.";
      feedback.className = "promo-feedback promo-feedback-err";
      return;
    }
    feedback.textContent = "Thanks — we'll email you when it's ready.";
    feedback.className = "promo-feedback promo-feedback-ok";
    btn.textContent = "You're on the list";
  });
}

function describeSource(source) {
  const labels = {
    paid_plus: "Paid subscription",
    promo_plus: "Promo code (non-AI Plus access)",
    teacher: "Teacher grant",
    classroom_assignment: "Assignment (temporary)",
    admin: "Admin grant",
  };
  return labels[source] || source;
}

function renderPromoEntry() {
  box.innerHTML = `
    <div class="plans-header">
      <h2>Promo Code</h2>
    </div>
    <p class="plans-sub">Enter your 6-digit code. Promo codes unlock Kinetic Plus features (not including AI).</p>
    <input id="promo-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" class="promo-input" autocomplete="off" />
    <div id="promo-feedback" class="promo-feedback"></div>
    <div class="plans-promo-actions">
      <button id="promo-submit" class="primary">Redeem</button>
      <button id="promo-back">Back</button>
    </div>
  `;

  const input = box.querySelector("#promo-input");
  const feedback = box.querySelector("#promo-feedback");
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
    feedback.textContent = "";
  });
  input.focus();

  box.querySelector("#promo-back").addEventListener("click", render);
  box.querySelector("#promo-submit").addEventListener("click", async () => {
    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) {
      feedback.textContent = "Enter all 6 digits.";
      feedback.className = "promo-feedback promo-feedback-err";
      return;
    }
    const submitBtn = box.querySelector("#promo-submit");
    submitBtn.disabled = true;
    const result = await redeemPromoCode(code);
    submitBtn.disabled = false;

    if (result.ok) {
      feedback.textContent = "Code redeemed — Kinetic Plus (non-AI) unlocked!";
      feedback.className = "promo-feedback promo-feedback-ok";
      setTimeout(render, 1200);
      return;
    }
    const messages = {
      invalid: "That code isn't valid.",
      deactivated: "This code has been deactivated.",
      expired: "This code has expired.",
      already_redeemed: "You've already redeemed this code.",
      limit_reached: "This code has reached its redemption limit.",
      error: "Something went wrong — try again.",
    };
    feedback.textContent = messages[result.reason] || "That code isn't valid.";
    feedback.className = "promo-feedback promo-feedback-err";
  });
}
