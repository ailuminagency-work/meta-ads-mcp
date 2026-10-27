import { describe, expect, it } from "vitest";
import { validateMarketingControlInput } from "../../src/platform/marketing-control-contracts.js";
import { MAX_MINOR_UNIT_AMOUNT } from "../../src/meta/currency.js";

const valid = {
  expected_creative_id: "501",
  expected_campaign_daily_budget: 0,
  expected_adset_daily_budget: 1000,
  expected_currency: "USD",
  expected_campaign_objective: "OUTCOME_TRAFFIC",
  expected_optimization_goal: "LINK_CLICKS",
  expected_bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  expected_bid_amount: 0,
};
const activate = (patch: Record<string, unknown>) => () => validateMarketingControlInput("marketing_activate_ad", { ...valid, ...patch });

describe("marketing_activate_ad budget and currency expectations", () => {
  it("accepts the reviewed integer minor-unit expectations", () => {
    expect(activate({})).not.toThrow();
    expect(activate({ expected_currency: "JPY", expected_adset_daily_budget: 5000 })).not.toThrow();
    expect(activate({ expected_adset_daily_budget: MAX_MINOR_UNIT_AMOUNT })).not.toThrow();
  });

  it.each([
    ["fractional budget", { expected_adset_daily_budget: 10.5 }],
    ["negative budget", { expected_adset_daily_budget: -1 }],
    ["budget above the absolute bound", { expected_adset_daily_budget: MAX_MINOR_UNIT_AMOUNT + 1 }],
    ["string budget", { expected_adset_daily_budget: "1000" }],
    ["both budgets positive", { expected_campaign_daily_budget: 500 }],
    ["neither budget positive", { expected_adset_daily_budget: 0 }],
    ["lower-case currency", { expected_currency: "usd" }],
    ["currency Meta has no recorded offset for", { expected_currency: "XTS" }],
    ["currency that is not ISO shaped", { expected_currency: "US" }],
    ["fractional bid", { expected_bid_strategy: "LOWEST_COST_WITH_BID_CAP", expected_bid_amount: 1.5 }],
  ])("denies %s", (_name, patch) => {
    expect(activate(patch)).toThrow(expect.objectContaining({ reason: "MARKETING_AD_CONTROL_TYPED_EXPECTATIONS_REQUIRED" }));
  });
});
