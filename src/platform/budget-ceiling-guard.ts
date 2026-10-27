import { PlatformDenied } from "./models.js";
import { planMoneyKeys, registerPolicyGuard, type PolicyGuard } from "./policy.js";
import { assertActivationWithinBudgetCeiling, assertPlanWithinBudgetCeiling } from "./marketing-budget-ceiling.js";

export const BUDGET_CEILING_GUARD = "marketing-budget-ceiling";

/** Money-looking request keys that a strict builder emits, spelled exactly. The first two carry an amount the ceiling compares; the others are shown to the human and carry no comparable amount. */
const CEILING_COMPARED_KEYS: readonly string[] = ["daily_budget", "lifetime_budget"];
const REVIEWED_KEYS_WITHOUT_AMOUNT: readonly string[] = ["bid_strategy", "bid_amount", "budget_mode", "marketing_budget_mode", "is_adset_budget_sharing_enabled"];
const KNOWN_MONEY_KEYS = new Set([...CEILING_COMPARED_KEYS, ...REVIEWED_KEYS_WITHOUT_AMOUNT]);

/**
 * The per-client ceiling is enforced inside policy evaluation, so an over-ceiling plan is refused before a human is asked,
 * before issue and before an approval is consumed. classifyPlan flags every money-looking key, but the ceiling can only
 * compare exact daily and lifetime budget amounts, so any other spelling (padded, upper case, bracketed, a spend cap or
 * target) is refused here rather than sent with a budget nobody compared.
 */
export const budgetCeilingGuard: PolicyGuard = (ctx, plan) => {
  if (ctx.provider !== "META_MARKETING") return;
  if (ctx.tool === "marketing_activate_ad") {
    const input = (plan.parameters as { input?: Record<string, unknown> }).input ?? {};
    assertActivationWithinBudgetCeiling(ctx.clientId, { currency: String(input.expected_currency), campaignDailyMinor: Number(input.expected_campaign_daily_budget), adsetDailyMinor: Number(input.expected_adset_daily_budget) });
    return;
  }
  if (planMoneyKeys(plan).some(key => !KNOWN_MONEY_KEYS.has(key))) throw new PlatformDenied("MONEY_KEY_UNRECOGNIZED");
  assertPlanWithinBudgetCeiling(ctx, plan);
};
registerPolicyGuard(BUDGET_CEILING_GUARD, budgetCeilingGuard);
