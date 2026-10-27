import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStrictLegacyWritePlan } from "../../src/platform/legacy-write.js";
import { classifyPlan, planMoneyKeys } from "../../src/platform/policy.js";
import { assertPlanWithinBudgetCeiling, planBudgets } from "../../src/platform/marketing-budget-ceiling.js";
import type { OperationPlan } from "../../src/platform/models.js";
import { PlatformDenied } from "../../src/platform/models.js";
import { BUDGET_CEILINGS_ENV } from "../../src/platform/marketing-budget-ceiling.js";
import { budgetCeilingDocument } from "./budget-ceiling-fixture.js";

beforeEach(() => {
  for (const key of ["LUMIN_PLATFORM_ENABLED", "LUMIN_PLATFORM_WRITES_ENABLED", "AGENCY_WRITES_ENABLED"]) vi.stubEnv(key, "true");
  vi.stubEnv("META_APP_ID", "300"); vi.stubEnv("META_API_VERSION", "v26.0");
  vi.stubEnv(BUDGET_CEILINGS_ENV, budgetCeilingDocument({ client: { currency: "USD", daily: "10.00" } }));
});
afterEach(() => vi.unstubAllEnvs());

/** Advertiser copy that begins with a bracket or brace but is not JSON: template placeholders, tags, markdown. */
const COPY = ["[New] Summer sale", "{{product.name}} on sale", " [x] leading space", "{Shop now} and save", "[", "{", "[1, 2,]", "{\"unterminated\": "];
const plan = (parameters: Record<string, unknown>): OperationPlan => ({ parameters, assets: [], classes: ["WRITE_AD_CONFIGURATION"], capability: "legacy.ads_create_ad_creative", requiredScopes: ["ads_management"], tokenTypes: ["user"] });
const reasonOf = (work: () => unknown): string | null => { try { work(); return null; } catch (error) { return error instanceof PlatformDenied ? error.reason : String(error); } };

describe("a string that starts with [ or { but is not JSON is plain text", () => {
  it.each(COPY)("%j builds a creative and is read as text by the money guards", message => {
    const built = buildStrictLegacyWritePlan("ads_create_ad_creative", { account_id: "101", name: "c", page_id: "601", image_hash: "a".repeat(32), link_url: "https://client.example.com/", message });
    expect(JSON.stringify(built.parameters)).toContain(JSON.stringify(message).slice(1, -1));
    expect(classifyPlan(built)).not.toContain("WRITE_BUDGET");
    expect(planMoneyKeys(built)).toEqual([]);
    expect(planBudgets(built)).toEqual([]);
    expect(reasonOf(() => assertPlanWithinBudgetCeiling({ clientId: "client" }, built))).toBeNull();
  });

  it.each(COPY)("%j is accepted at any depth by the classifier and the ceiling", value => {
    const nested = plan({ legacy_write_step: { path: "/1", body: { message: value, items: [value, { caption: value }], more: { deeper: [{ title: value }] } } } });
    expect(reasonOf(() => classifyPlan(nested))).toBeNull();
    expect(reasonOf(() => planMoneyKeys(nested))).toBeNull();
    expect(reasonOf(() => planBudgets(nested))).toBeNull();
  });

  it("does not hide a real budget key sitting beside the copy", () => {
    const mixed = plan({ legacy_write_step: { path: "/1", body: { message: "[New] Summer sale", daily_budget: "5000" } } });
    expect(classifyPlan(mixed)).toContain("WRITE_BUDGET");
    expect(planBudgets(mixed)).toEqual([{ field: "daily_budget", amountMinor: 5000 }]);
    expect(reasonOf(() => assertPlanWithinBudgetCeiling({ clientId: "client" }, mixed))).toBe("BUDGET_CEILING_EXCEEDED");
  });
});

describe("a string that does parse as JSON is still decoded and held to the ceiling", () => {
  const encoded: Array<[string, unknown]> = [
    ["an object", JSON.stringify({ daily_budget: "5000" })],
    ["an object with leading whitespace", " \n" + JSON.stringify({ daily_budget: "5000" })],
    ["an array of objects", JSON.stringify([{ ok: 1 }, { daily_budget: "5000" }])],
    ["a budget nested deeper", JSON.stringify({ a: { b: [{ daily_budget: "5000" }] } })],
    ["a string inside a string", JSON.stringify({ inner: JSON.stringify({ daily_budget: "5000" }) })],
  ];

  it.each(encoded)("%s: the budget is found", (_label, value) => {
    const p = plan({ legacy_write_step: { path: "/1", body: { targeting: value } } });
    expect(classifyPlan(p)).toContain("WRITE_BUDGET");
    expect(planBudgets(p)).toHaveLength(1);
    expect(planBudgets(p)[0].amountMinor).toBe(5000);
  });

  it.each(encoded)("%s: a budget over the ceiling is refused", (_label, value) => {
    expect(reasonOf(() => assertPlanWithinBudgetCeiling({ clientId: "client" }, plan({ legacy_write_step: { path: "/1", body: { targeting: value } } })))).toBe("BUDGET_CEILING_EXCEEDED");
  });

  it("a budget within the ceiling passes", () => {
    const within = plan({ legacy_write_step: { path: "/1", body: { targeting: JSON.stringify({ daily_budget: "900" }) } } });
    expect(reasonOf(() => assertPlanWithinBudgetCeiling({ clientId: "client" }, within))).toBeNull();
  });

  it("an unrecognised money key inside a decoded string is still refused", () => {
    expect(reasonOf(() => classifyPlan(plan({ body: { targeting: JSON.stringify({ daily_spend_cap: 5 }) } })))).toBeNull();
    expect(planMoneyKeys(plan({ body: { targeting: JSON.stringify({ daily_spend_cap: 5 }) } }))).toEqual(["daily_spend_cap"]);
  });
});
