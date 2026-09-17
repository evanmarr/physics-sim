import { test, assert } from "./helpers.js";
import { AI_MONTHLY_COST_CAP_USD, estimateRequestCostUsd, canAffordRequest, currentPeriodKey } from "../server/aiConfig.js";

test("the monthly cost cap is exactly $3.00, centralized in one place", () => {
  assert.equal(AI_MONTHLY_COST_CAP_USD, 3.00);
});

test("cost estimator is zero with the unconfigured (no real provider) pricing config", () => {
  const cost = estimateRequestCostUsd({ estimatedInputTokens: 1000, estimatedOutputTokens: 500 });
  assert.equal(cost, 0, "no real provider is configured yet, so estimated cost must be exactly 0, never a fabricated positive number");
});

test("cost estimator scales linearly with a hypothetical real pricing config", () => {
  const pricing = { pricePerInputTokenUsd: 0.0001, pricePerOutputTokenUsd: 0.0002 };
  const cost = estimateRequestCostUsd({ estimatedInputTokens: 1000, estimatedOutputTokens: 500 }, pricing);
  assert.equal(cost, 1000 * 0.0001 + 500 * 0.0002);
});

test("canAffordRequest allows a request that stays under the cap", () => {
  assert.equal(canAffordRequest(1.00, 0.50, 3.00), true);
});

test("canAffordRequest denies a request that would exceed the cap", () => {
  assert.equal(canAffordRequest(2.80, 0.50, 3.00), false);
});

test("canAffordRequest allows a request landing exactly at the cap", () => {
  assert.equal(canAffordRequest(2.50, 0.50, 3.00), true);
});

test("a used-up period (already at cap) denies any further paid request", () => {
  assert.equal(canAffordRequest(3.00, 0.0001, 3.00), false);
});

test("period key format is a stable, sortable YYYY-MM, resetting month to month", () => {
  assert.equal(currentPeriodKey(new Date(Date.UTC(2026, 0, 15))), "2026-01");
  assert.equal(currentPeriodKey(new Date(Date.UTC(2026, 11, 31))), "2026-12");
  assert.notEqual(currentPeriodKey(new Date(Date.UTC(2026, 0, 1))), currentPeriodKey(new Date(Date.UTC(2026, 1, 1))), "a new month must produce a new period key");
});
