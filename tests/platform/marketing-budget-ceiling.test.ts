import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_CEILINGS_ENV,
  assertActivationWithinBudgetCeiling,
  assertPlanWithinBudgetCeiling,
  budgetCeilingFor,
  loadBudgetCeilings,
  planBudgets,
} from "../../src/platform/marketing-budget-ceiling.js";
import { buildStrictLegacyWritePlan } from "../../src/platform/legacy-write.js";
import type { OperationPlan } from "../../src/platform/models.js";
import { budgetCeilingDocument } from "./budget-ceiling-fixture.js";

const plan = (body: Record<string, unknown>, extra: Record<string, unknown> = {}): OperationPlan => ({
  parameters: { status: "PAUSED", legacy_write_step: { path: "/act_101/adsets", body }, ...extra },
  assets: [{ type: "AD_ACCOUNT", id: "act_101" }],
  classes: ["WRITE_AD_CONFIGURATION", "WRITE_BUDGET"],
  capability: "legacy.ads_create_ad_set",
  requiredScopes: ["ads_management"],
  tokenTypes: ["user"],
});

const denied = (run: () => unknown, reason: string) => {
  expect(run).toThrow(expect.objectContaining({ name: "PlatformDenied", reason }));
};

const configure = (clients: Parameters<typeof budgetCeilingDocument>[0]) => vi.stubEnv(BUDGET_CEILINGS_ENV, budgetCeilingDocument(clients));

beforeEach(() => {
  vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "true");
  vi.stubEnv("AGENCY_WRITES_ENABLED", "true");
  vi.stubEnv("META_API_VERSION", "v26.0");
});
afterEach(() => vi.unstubAllEnvs());

describe("fail-closed configuration", () => {
  it("denies a budget-bearing write when no ceilings are configured at all", () => {
    denied(() => assertPlanWithinBudgetCeiling({ clientId: "client" }, plan({ daily_budget: "2000" })), "BUDGET_CEILING_NOT_CONFIGURED");
  });

  it("denies a budget-bearing write for a client that has no entry, while another client is configured", () => {
    configure({ "client-a": {} });
    assertPlanWithinBudgetCeiling({ clientId: "client-a" }, plan({ daily_budget: "2000" }));
    denied(() => assertPlanWithinBudgetCeiling({ clientId: "client-b" }, plan({ daily_budget: "2000" })), "BUDGET_CEILING_NOT_CONFIGURED");
  });

  it("does not require a ceiling for plans that carry no budget", () => {
    assertPlanWithinBudgetCeiling({ clientId: "client" }, plan({ name: "Renamed", status: "PAUSED" }));
  });

  it("does not apply outside strict write mode (policy already denies every write there)", () => {
    vi.stubEnv("AGENCY_WRITES_ENABLED", "false");
    assertPlanWithinBudgetCeiling({ clientId: "client" }, plan({ daily_budget: "2000" }));
  });

  it.each([
    ["not JSON", "{nope"],
    ["wrong version", JSON.stringify({ version: 2, clients: {} })],
    ["unknown top-level key", JSON.stringify({ version: 1, clients: {}, default: {} })],
    ["wildcard client", JSON.stringify({ version: 1, clients: { "*": { currency: "USD", max_daily_budget: "1", max_lifetime_budget: "1" } } })],
    ["unknown entry key", JSON.stringify({ version: 1, clients: { c: { currency: "USD", max_daily_budget: "1", max_lifetime_budget: "1", extra: 1 } } })],
    ["missing lifetime ceiling", JSON.stringify({ version: 1, clients: { c: { currency: "USD", max_daily_budget: "1" } } })],
    ["numeric amount instead of decimal string", JSON.stringify({ version: 1, clients: { c: { currency: "USD", max_daily_budget: 1, max_lifetime_budget: "1" } } })],
    ["unrecorded currency", JSON.stringify({ version: 1, clients: { c: { currency: "XTS", max_daily_budget: "1", max_lifetime_budget: "1" } } })],
    ["fraction a whole-unit currency cannot hold", JSON.stringify({ version: 1, clients: { c: { currency: "JPY", max_daily_budget: "1.5", max_lifetime_budget: "1" } } })],
    ["zero ceiling", JSON.stringify({ version: 1, clients: { c: { currency: "USD", max_daily_budget: "0", max_lifetime_budget: "1" } } })],
    ["ceiling above the absolute bound", JSON.stringify({ version: 1, clients: { c: { currency: "USD", max_daily_budget: "20000000.00", max_lifetime_budget: "1" } } })],
  ])("an unreadable document (%s) denies every budget-bearing write instead of being ignored", (_name, raw) => {
    vi.stubEnv(BUDGET_CEILINGS_ENV, raw);
    denied(() => loadBudgetCeilings(), "BUDGET_CEILING_CONFIG_INVALID");
    denied(() => assertPlanWithinBudgetCeiling({ clientId: "c" }, plan({ daily_budget: "1" })), "BUDGET_CEILING_CONFIG_INVALID");
  });

  it("reloads when the document changes", () => {
    configure({ client: { daily: "10.00" } });
    expect(budgetCeilingFor("client").maxDailyMinor).toBe(1000);
    configure({ client: { daily: "20.00" } });
    expect(budgetCeilingFor("client").maxDailyMinor).toBe(2000);
  });
});

describe("comparison", () => {
  it("allows exactly the ceiling and rejects one minor unit above it, for daily and lifetime budgets", () => {
    configure({ client: { daily: "50.00", lifetime: "500.00" } });
    const ctx = { clientId: "client" };
    assertPlanWithinBudgetCeiling(ctx, plan({ daily_budget: "5000" }));
    assertPlanWithinBudgetCeiling(ctx, plan({ lifetime_budget: "50000" }));
    denied(() => assertPlanWithinBudgetCeiling(ctx, plan({ daily_budget: "5001" })), "BUDGET_CEILING_EXCEEDED");
    denied(() => assertPlanWithinBudgetCeiling(ctx, plan({ lifetime_budget: "50001" })), "BUDGET_CEILING_EXCEEDED");
  });

  it("holds every budget in the plan to its ceiling", () => {
    configure({ client: { daily: "50.00", lifetime: "500.00" } });
    denied(
      () => assertPlanWithinBudgetCeiling({ clientId: "client" }, plan({ daily_budget: "1000", lifetime_budget: "50001" })),
      "BUDGET_CEILING_EXCEEDED",
    );
  });

  it("is currency-aware: the same number means different money in USD and JPY", () => {
    configure({ usd: { currency: "USD", daily: "500.00" }, jpy: { currency: "JPY", daily: "500" } });
    expect(budgetCeilingFor("usd").maxDailyMinor).toBe(50000);
    expect(budgetCeilingFor("jpy").maxDailyMinor).toBe(500);
    assertPlanWithinBudgetCeiling({ clientId: "usd" }, plan({ daily_budget: "50000" }));
    denied(() => assertPlanWithinBudgetCeiling({ clientId: "jpy" }, plan({ daily_budget: "50000" })), "BUDGET_CEILING_EXCEEDED");
    assertPlanWithinBudgetCeiling({ clientId: "jpy" }, plan({ daily_budget: "500" }));
  });

  it("finds budgets nested in objects, arrays and JSON-encoded strings", () => {
    configure({ client: { daily: "10.00", lifetime: "100.00" } });
    const ctx = { clientId: "client" };
    denied(() => assertPlanWithinBudgetCeiling(ctx, plan({ nested: { deeper: [{ daily_budget: 2000 }] } })), "BUDGET_CEILING_EXCEEDED");
    denied(() => assertPlanWithinBudgetCeiling(ctx, plan({ blob: JSON.stringify({ lifetime_budget: "10001" }) })), "BUDGET_CEILING_EXCEEDED");
    denied(() => assertPlanWithinBudgetCeiling(ctx, plan({ DAILY_BUDGET: "2000" })), "BUDGET_CEILING_EXCEEDED");
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e9", " 5", "99999999999999999"])("denies an unreadable budget amount %j", (amount) => {
    configure({ client: {} });
    denied(() => assertPlanWithinBudgetCeiling({ clientId: "client" }, plan({ daily_budget: amount })), "BUDGET_AMOUNT_INVALID");
  });

  it("reads budgets out of real strict plans built by the legacy plan builder", () => {
    const campaign = buildStrictLegacyWritePlan("ads_update_campaign", { campaign_id: "201", daily_budget: 4000 });
    expect(planBudgets(campaign)).toEqual([{ field: "daily_budget", amountMinor: 4000 }]);
    const adset = buildStrictLegacyWritePlan("ads_update_ad_set", { ad_set_id: "301", daily_budget: 2500 });
    expect(planBudgets(adset)).toEqual([{ field: "daily_budget", amountMinor: 2500 }]);
    expect(planBudgets(buildStrictLegacyWritePlan("ads_update_ad", { ad_id: "401", name: "Rename" }))).toEqual([]);

    configure({ client: { daily: "30.00" } });
    assertPlanWithinBudgetCeiling({ clientId: "client" }, adset);
    denied(() => assertPlanWithinBudgetCeiling({ clientId: "client" }, campaign), "BUDGET_CEILING_EXCEEDED");
  });
});

describe("activation", () => {
  const expected = { currency: "USD", campaignDailyMinor: 0, adsetDailyMinor: 1000 };

  it("requires a configured ceiling", () => {
    denied(() => assertActivationWithinBudgetCeiling("client", expected), "BUDGET_CEILING_NOT_CONFIGURED");
  });

  it("denies an expected budget above the ceiling and allows one at it", () => {
    configure({ client: { daily: "10.00" } });
    assertActivationWithinBudgetCeiling("client", expected);
    denied(() => assertActivationWithinBudgetCeiling("client", { ...expected, adsetDailyMinor: 1001 }), "BUDGET_CEILING_EXCEEDED");
    denied(() => assertActivationWithinBudgetCeiling("client", { ...expected, campaignDailyMinor: 1001, adsetDailyMinor: 0 }), "BUDGET_CEILING_EXCEEDED");
  });

  it("never compares amounts across currencies", () => {
    configure({ client: { currency: "USD", daily: "10.00" } });
    denied(() => assertActivationWithinBudgetCeiling("client", { ...expected, currency: "JPY" }), "BUDGET_CEILING_CURRENCY_MISMATCH");
  });
});
