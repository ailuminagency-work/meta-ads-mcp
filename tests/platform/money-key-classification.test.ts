import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyPlan, isMoneyKey, planMoneyKeys } from "../../src/platform/policy.js";
import { budgetCeilingGuard } from "../../src/platform/budget-ceiling-guard.js";
import { planBudgets } from "../../src/platform/marketing-budget-ceiling.js";
import type { OperationContext, OperationPlan } from "../../src/platform/models.js";
import { stubBudgetCeilings } from "./budget-ceiling-fixture.js";

beforeEach(() => { vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "true"); vi.stubEnv("AGENCY_WRITES_ENABLED", "true"); });
afterEach(() => vi.unstubAllEnvs());

const plan = (body: Record<string, unknown>, extra: Partial<OperationPlan> = {}): OperationPlan => ({ parameters: { legacy_write_step: { path: "/1", body } }, assets: [], classes: ["WRITE_AD_CONFIGURATION"], capability: "legacy.ads_update_ad_set", requiredScopes: [], tokenTypes: ["user"], ...extra });
const ctx = (tool = "ads_update_ad_set", provider: OperationContext["provider"] = "META_MARKETING"): OperationContext => ({ principal: { tenantId: "tenant", operatorId: "actor" }, clientId: "client", tool, provider, requestId: "request" });

/** The spellings the G2 reviewer found that classifyPlan missed or the ceiling does not read, plus the ones it already caught. */
const MONEY_SPELLINGS: Array<[string, Record<string, unknown>]> = [
  ["daily_budget (control)", { daily_budget: "999999999" }],
  ["trailing space", { "daily_budget ": "999999999" }],
  ["upper case", { DAILY_BUDGET: "999999999" }],
  ["bracketed", { "adset_budgets[0][daily_budget]": "999999999" }],
  ["daily_spend_cap", { daily_spend_cap: "999999999" }],
  ["lifetime_spend_cap", { lifetime_spend_cap: "999999999" }],
  ["spend_target", { daily_min_spend_target: "999999999" }],
  ["spend_limit", { account_spend_limit: "999999999" }],
  ["bid_constraints", { bid_constraints: { roas_average_floor: 1 } }],
  ["bid_strategy", { bid_strategy: "COST_CAP" }],
  ["bid_amount in brackets", { "bid_amount[0]": 5 }],
  ["zero-width inside the word", { "bud​get": "5" }],
  ["fullwidth letters", { "ｂｕｄｇｅｔ": "5" }],
  ["inside a JSON string", { targeting: JSON.stringify({ nested: { daily_spend_cap: 5 } }) }],
  ["inside an array of objects", { adsets: [{ ok: 1 }, { "lifetime_budget ": 5 }] }],
];

describe("classifyPlan treats every money-looking key as a budget change", () => {
  it.each(MONEY_SPELLINGS)("%s", (_label, body) => {
    expect(classifyPlan(plan(body))).toContain("WRITE_BUDGET");
    expect(planMoneyKeys(plan(body)).length).toBeGreaterThan(0);
  });

  it.each([["forbid_reuse", true], ["bidirectional", 1], ["status", "PAUSED"], ["name", "Budget-free name value"], ["targeting", { geo_locations: { countries: ["US"] } }], ["access_token_hint", "x"]] as const)("does not flag %s", (key, value) => {
    expect(isMoneyKey(key)).toBe(false);
    expect(classifyPlan(plan({ [key]: value }))).not.toContain("WRITE_BUDGET");
  });

  it("flags a seven-level-deep ACTIVE status that the old depth cap of six missed", () => {
    const deep = { status: { a: { b: { c: { d: { e: { f: { g: "ACTIVE" } } } } } } } };
    expect(classifyPlan(plan(deep))).toContain("ACTIVATE_SPEND");
    expect(() => classifyPlan(plan(deep, { createOrCopy: true, parameters: { status: "PAUSED", legacy_write_step: { path: "/1", body: deep } } }))).toThrow("CREATE_MUST_REMAIN_PAUSED");
  });

  describe("the activation expectations are the only exempt keys", () => {
    const activation = (input: Record<string, unknown>): OperationPlan => ({ parameters: { asset_id: "401", input, endpointContract: { tool: "marketing_activate_ad" } }, assets: [], classes: ["ACTIVATE_SPEND"], capability: "marketing.activate.ad", requiredScopes: [], tokenTypes: ["user"] });
    const expected = { expected_creative_id: "501", expected_campaign_daily_budget: 0, expected_adset_daily_budget: 1000, expected_currency: "USD", expected_bid_strategy: "LOWEST_COST_WITHOUT_CAP", expected_bid_amount: 0 };
    it("keeps the reviewed expectations out of WRITE_BUDGET", () => expect(classifyPlan(activation(expected))).toEqual(["ACTIVATE_SPEND"]));
    it.each([["bid_amount", 5], ["daily_budget", 5], ["expected_daily_budget", 5], ["expected_spend_cap", 5]])("still flags a %s key next to them", (key, value) => {
      expect(classifyPlan(activation({ ...expected, [key]: value }))).toContain("WRITE_BUDGET");
    });
  });
});

describe("classification and the budget ceiling cannot disagree", () => {
  it.each(MONEY_SPELLINGS)("%s: whatever planBudgets reads, classifyPlan has flagged", (_label, body) => {
    const p = plan(body);
    let read = 0;
    try { read = planBudgets(p).length; } catch { read = 1; }
    if (read > 0) expect(classifyPlan(p)).toContain("WRITE_BUDGET");
  });

  describe("the guard", () => {
    beforeEach(() => stubBudgetCeilings({ client: { daily: "10.00", lifetime: "100.00" } }));

    it("lets exact daily and lifetime budgets through to the ceiling and refuses an over-ceiling amount", () => {
      expect(() => budgetCeilingGuard(ctx(), plan({ daily_budget: 1000 }), undefined as never)).not.toThrow();
      expect(() => budgetCeilingGuard(ctx(), plan({ daily_budget: 1001 }), undefined as never)).toThrow("BUDGET_CEILING_EXCEEDED");
      expect(() => budgetCeilingGuard(ctx(), plan({ lifetime_budget: 10001 }), undefined as never)).toThrow("BUDGET_CEILING_EXCEEDED");
    });

    it.each(MONEY_SPELLINGS.slice(1).filter(([label]) => label !== "bid_strategy"))("refuses the unrecognised spelling: %s", (_label, body) => {
      expect(() => budgetCeilingGuard(ctx(), plan(body), undefined as never)).toThrow("MONEY_KEY_UNRECOGNIZED");
    });

    it.each(["bid_strategy", "bid_amount", "budget_mode", "marketing_budget_mode", "is_adset_budget_sharing_enabled"])("lets the reviewed key %s through when no budget amount is present", key => {
      expect(() => budgetCeilingGuard(ctx(), plan({ [key]: "x" }), undefined as never)).not.toThrow();
    });

    it("ignores plans for other providers", () => {
      expect(() => budgetCeilingGuard(ctx("pages_create_feed", "META_FACEBOOK_PAGES"), plan({ "daily_budget ": 1 }), undefined as never)).not.toThrow();
    });
  });
});
