// AI Tutor — architecture only. NOTHING in this file (or anywhere else in
// the app) calls a real AI provider. No API key, no network request, no
// real cost is ever incurred by this code as it exists today. This exists
// so a FUTURE real integration has a cost-safe place to plug into, instead
// of a real AI call being added ad hoc with no ceiling.
//
// Centralized on purpose — see the Prompt B spec this was built against:
// "Centralize configuration conceptually such as AI_MONTHLY_COST_CAP_USD =
// 3.00. Do not scatter $3 constants around the app." This is the one file
// that number (and the model/pricing config it depends on) lives in.

// Roughly half of a future ~$6/mo Plus price point — see README.md.
export const AI_MONTHLY_COST_CAP_USD = 3.00;

// Deliberately NOT a real model name yet — token pricing and model
// availability both change, and hard-coding a specific model here would
// make this file wrong the moment that model is deprecated or repriced.
// `version` lets stored usage records reference which pricing config
// produced their estimate, so changing prices later doesn't silently
// corrupt historical accounting.
export const AI_MODEL_CONFIG = {
  version: 1,
  provider: "unconfigured",
  model: "unconfigured",
  pricePerInputTokenUsd: 0,
  pricePerOutputTokenUsd: 0,
};

// A mocked estimator — real token counting needs the actual provider's
// tokenizer, which doesn't exist here yet. Callers pass their own
// estimated token counts (e.g. from a rough chars/4 heuristic later);
// this just centralizes the arithmetic so it isn't duplicated per call site.
export function estimateRequestCostUsd({ estimatedInputTokens = 0, estimatedOutputTokens = 0 }, modelConfig = AI_MODEL_CONFIG) {
  return estimatedInputTokens * modelConfig.pricePerInputTokenUsd + estimatedOutputTokens * modelConfig.pricePerOutputTokenUsd;
}

// The current UTC calendar month as a period key, e.g. "2026-09" — the
// natural unit for "resets with the user's monthly entitlement period"
// without needing to track each user's individual signup anniversary.
export function currentPeriodKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// The actual admission check a future real request would run BEFORE
// calling any provider: would this request's estimated cost push the
// user's accumulated estimated cost this period past the cap? If so, the
// request must never be sent — see server/db.js's aiUsage functions for
// where the accumulated total actually comes from.
export function canAffordRequest(usedUsdThisPeriod, estimatedRequestCostUsd, capUsd = AI_MONTHLY_COST_CAP_USD) {
  return usedUsdThisPeriod + estimatedRequestCostUsd <= capUsd;
}
