// Checkout — pricing and plan config only. NO payment processor is
// connected anywhere in this app: there is no Stripe/PayPal/etc. key, no
// real charge is ever created, and nothing in the client or server routes
// that reference this file moves real money. This exists so the actual
// checkout UI (plan pick -> billing period -> review) has real, consistent
// numbers to show while a real processor isn't wired up yet, and so that
// wiring one in later means replacing the (currently empty) `processor`
// section below rather than hunting down price strings across the UI.
//
// Prices are illustrative launch pricing, not finalized — update here only,
// never inline in src/plans.js.
export const PLAN_PRICING = {
  plus: { monthlyUsd: 6, annualUsd: 60 }, // annual = 2 months free
  teacher: { monthlyUsd: 12, annualUsd: 120 },
};

// Populate this when a real processor is chosen (e.g. Stripe): priceIds
// per plan/period, publishable key, etc. `connected: false` is the one
// flag every checkout route/UI actually checks — everything else here is
// inert until that flips.
export const PAYMENT_PROCESSOR = {
  connected: false,
  provider: "unconfigured",
};

export function annualSavingsPct(plan) {
  const p = PLAN_PRICING[plan];
  if (!p) return 0;
  const fullYearAtMonthly = p.monthlyUsd * 12;
  return Math.round((1 - p.annualUsd / fullYearAtMonthly) * 100);
}
