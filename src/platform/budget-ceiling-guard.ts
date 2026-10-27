import { registerPolicyGuard } from "./policy.js";
import { assertActivationWithinBudgetCeiling, assertPlanWithinBudgetCeiling } from "./marketing-budget-ceiling.js";

export const BUDGET_CEILING_GUARD = "marketing-budget-ceiling";

/** The per-client ceiling is enforced inside policy evaluation, so an over-ceiling plan is refused before a human is asked, before issue and before an approval is consumed. */
registerPolicyGuard(BUDGET_CEILING_GUARD, (ctx, plan) => {
  if (ctx.provider !== "META_MARKETING") return;
  if (ctx.tool === "marketing_activate_ad") {
    const input = (plan.parameters as { input?: Record<string, unknown> }).input ?? {};
    assertActivationWithinBudgetCeiling(ctx.clientId, { currency: String(input.expected_currency), campaignDailyMinor: Number(input.expected_campaign_daily_budget), adsetDailyMinor: Number(input.expected_adset_daily_budget) });
    return;
  }
  assertPlanWithinBudgetCeiling(ctx, plan);
});
