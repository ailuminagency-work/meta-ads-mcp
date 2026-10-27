import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCampaignTools } from "../../src/tools/campaigns.js";
import { registerAdSetTools } from "../../src/tools/adsets.js";
import { registerBudgetTools } from "../../src/tools/budget.js";
import { registerBillingTools } from "../../src/tools/billing.js";
import { registerEntityTools } from "../../src/tools/entities.js";
import { validateMetaId } from "../../src/utils/format.js";
import { registerAllTools } from "../../src/tools/index.js";
import { installLegacyGuard } from "../../src/platform/legacy-guard.js";
import { createMockMcpServer, setupTestToken, cleanupTestToken, mockFetchResponse } from "../setup.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function tool(register: (server: never) => void, name: string) {
  const server = createMockMcpServer();
  register(server as never);
  const found = server._registeredTools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return { ...found, handler: found.handler as unknown as Handler, shape: found.schema as z.ZodRawShape };
}

const parses = (shape: z.ZodRawShape, input: Record<string, unknown>) => z.object(shape).safeParse(input).success;

beforeEach(() => setupTestToken());
afterEach(() => {
  cleanupTestToken();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const campaignBase = { account_id: "123", name: "Reviewed campaign", objective: "OUTCOME_TRAFFIC" };
const adSetBase = {
  account_id: "123",
  campaign_id: "201",
  name: "Reviewed ad set",
  destination_type: "WEBSITE",
  optimization_goal: "LINK_CLICKS",
  targeting: { geo_locations: { countries: ["US"] } },
};

describe("legacy tool budget schemas are integer, positive and bounded", () => {
  const BAD_AMOUNTS: Array<[string, unknown]> = [
    ["fractional", 50.5],
    ["zero", 0],
    ["negative", -5000],
    ["above the absolute ceiling", 1_000_000_001],
    ["not a safe integer", Number.MAX_SAFE_INTEGER + 2],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  const fields: Array<[string, () => z.ZodRawShape, Record<string, unknown>, string]> = [
    ["ads_create_campaign daily_budget", () => tool(registerCampaignTools, "ads_create_campaign").shape, campaignBase, "daily_budget"],
    ["ads_create_campaign lifetime_budget", () => tool(registerCampaignTools, "ads_create_campaign").shape, campaignBase, "lifetime_budget"],
    ["ads_update_campaign daily_budget", () => tool(registerCampaignTools, "ads_update_campaign").shape, { campaign_id: "201" }, "daily_budget"],
    ["ads_update_campaign lifetime_budget", () => tool(registerCampaignTools, "ads_update_campaign").shape, { campaign_id: "201" }, "lifetime_budget"],
    ["ads_create_ad_set daily_budget", () => tool(registerAdSetTools, "ads_create_ad_set").shape, adSetBase, "daily_budget"],
    ["ads_create_ad_set lifetime_budget", () => tool(registerAdSetTools, "ads_create_ad_set").shape, adSetBase, "lifetime_budget"],
    ["ads_create_ad_set bid_amount", () => tool(registerAdSetTools, "ads_create_ad_set").shape, adSetBase, "bid_amount"],
    ["ads_update_ad_set daily_budget", () => tool(registerAdSetTools, "ads_update_ad_set").shape, { ad_set_id: "301" }, "daily_budget"],
    ["ads_update_ad_set lifetime_budget", () => tool(registerAdSetTools, "ads_update_ad_set").shape, { ad_set_id: "301" }, "lifetime_budget"],
    ["ads_update_ad_set bid_amount", () => tool(registerAdSetTools, "ads_update_ad_set").shape, { ad_set_id: "301" }, "bid_amount"],
    ["ads_update_spend_cap spend_cap", () => tool(registerBillingTools, "ads_update_spend_cap").shape, { account_id: "123" }, "spend_cap"],
  ];

  describe.each(fields)("%s", (_label, shape, base, field) => {
    it.each(BAD_AMOUNTS)("rejects a %s amount", (_name, value) => {
      expect(parses(shape(), { ...base, [field]: value })).toBe(false);
    });

    it("accepts a positive whole amount up to the ceiling", () => {
      expect(parses(shape(), { ...base, [field]: 5000 })).toBe(true);
      expect(parses(shape(), { ...base, [field]: 1_000_000_000 })).toBe(true);
    });
  });

  it("bounds the ads_clone_ad_set_bundle target budgets", () => {
    const shape = tool(registerAdSetTools, "ads_clone_ad_set_bundle").shape;
    const target = { name: "Clone", geo_override: { countries: ["CL"] } };
    const base = { account_id: "123", source_ad_set_id: "301" };
    for (const field of ["daily_budget", "lifetime_budget"]) {
      for (const [, bad] of BAD_AMOUNTS) {
        expect(parses(shape, { ...base, target_ad_set: { ...target, [field]: bad } }), `${field}=${String(bad)}`).toBe(false);
      }
      expect(parses(shape, { ...base, target_ad_set: { ...target, [field]: 2500 } })).toBe(true);
    }
  });

  it("bounds ads_create_budget_schedule absolute amounts before any request", async () => {
    const handler = tool(registerBudgetTools, "ads_create_budget_schedule").handler;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ id: "1" })));
    const base = { campaign_id: "201", budget_value_type: "ABSOLUTE", time_start: "2026-12-01T00:00:00Z", time_end: "2026-12-02T00:00:00Z" };
    for (const bad of ["0", "-5", "50.5", "1e9", "abc", "", "1000000001", " 500"]) {
      await expect(handler({ ...base, budget_value: bad }), bad).rejects.toThrow(/budget_value/);
    }
    expect(fetch).not.toHaveBeenCalled();
    await handler({ ...base, budget_value: "5000" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("ads_create_campaign serialises array parameters as JSON arrays", () => {
  const create = async (extra: Record<string, unknown>) => {
    const handler = tool(registerCampaignTools, "ads_create_campaign").handler;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ id: "1000123" })));
    await handler({ ...campaignBase, status: "PAUSED", buying_type: "AUCTION", ...extra });
    return vi.mocked(fetch).mock.calls[0];
  };

  it("sends the default NONE category as the JSON array [\"NONE\"] (exact body)", async () => {
    const [url, init] = await create({ special_ad_categories: ["NONE"] });
    expect(String(url)).toContain("/act_123/campaigns");
    expect(init?.body).toBe(
      "name=Reviewed+campaign&objective=OUTCOME_TRAFFIC&status=PAUSED&special_ad_categories=%5B%22NONE%22%5D&buying_type=AUCTION&is_adset_budget_sharing_enabled=false",
    );
  });

  it("sends categories and their country list as JSON arrays (exact body)", async () => {
    const [, init] = await create({
      special_ad_categories: ["HOUSING", "EMPLOYMENT"],
      special_ad_category_country: ["US", "CA"],
    });
    expect(init?.body).toBe(
      "name=Reviewed+campaign&objective=OUTCOME_TRAFFIC&status=PAUSED&special_ad_categories=%5B%22HOUSING%22%2C%22EMPLOYMENT%22%5D&special_ad_category_country=%5B%22US%22%2C%22CA%22%5D&buying_type=AUCTION&is_adset_budget_sharing_enabled=false",
    );
    const params = new URLSearchParams(init?.body as string);
    expect(JSON.parse(params.get("special_ad_categories")!)).toEqual(["HOUSING", "EMPLOYMENT"]);
    expect(JSON.parse(params.get("special_ad_category_country")!)).toEqual(["US", "CA"]);
  });

  it.each([
    ["EMPLOYMENT"],
    ["HOUSING"],
    ["CREDIT"],
    ["FINANCIAL_PRODUCTS_SERVICES"],
    ["ISSUES_ELECTIONS_POLITICS"],
    ["ONLINE_GAMBLING_AND_GAMING"],
  ])("refuses the %s category without special_ad_category_country, before any request", async (category) => {
    const handler = tool(registerCampaignTools, "ads_create_campaign").handler;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ id: "1" })));
    const input = { ...campaignBase, status: "PAUSED", buying_type: "AUCTION", special_ad_categories: [category] };
    await expect(handler(input)).rejects.toThrow(/special_ad_category_country/);
    await expect(handler({ ...input, special_ad_category_country: [] })).rejects.toThrow(/special_ad_category_country/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a country list that does not accompany a special category", async () => {
    const handler = tool(registerCampaignTools, "ads_create_campaign").handler;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ id: "1" })));
    await expect(
      handler({ ...campaignBase, status: "PAUSED", buying_type: "AUCTION", special_ad_categories: ["NONE"], special_ad_category_country: ["US"] }),
    ).rejects.toThrow(/special_ad_category_country/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses NONE combined with a real category", async () => {
    const handler = tool(registerCampaignTools, "ads_create_campaign").handler;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ id: "1" })));
    await expect(
      handler({ ...campaignBase, status: "PAUSED", buying_type: "AUCTION", special_ad_categories: ["NONE", "HOUSING"], special_ad_category_country: ["US"] }),
    ).rejects.toThrow(/NONE/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates country codes as ISO 3166-1 alpha-2 in the schema", () => {
    const shape = tool(registerCampaignTools, "ads_create_campaign").shape;
    const base = { ...campaignBase, special_ad_categories: ["HOUSING"] };
    expect(parses(shape, { ...base, special_ad_category_country: ["US"] })).toBe(true);
    for (const bad of [["usa"], ["U"], ["US,CA"], ["U1"], [""], []]) {
      expect(parses(shape, { ...base, special_ad_category_country: bad }), JSON.stringify(bad)).toBe(false);
    }
  });

  it("keeps the strict-mode input keys identical to the pinned legacy manifest", async () => {
    vi.stubEnv("LUMIN_PLATFORM_ENABLED", "true");
    const { LEGACY_MANIFEST } = await import("../../src/platform/legacy-manifest.js");
    const strict = tool(registerCampaignTools, "ads_create_campaign");
    expect(Object.keys(strict.shape).sort()).toEqual([...LEGACY_MANIFEST.find((e) => e.name === "ads_create_campaign")!.inputKeys].sort());
    expect(strict.description).not.toContain("special_ad_category_country");
    vi.stubEnv("LUMIN_PLATFORM_ENABLED", "false");
    const baseline = tool(registerCampaignTools, "ads_create_campaign");
    expect(Object.keys(baseline.shape)).toContain("special_ad_category_country");
    expect(baseline.description).toContain("special_ad_category_country");
  });
});

describe("billing reads use the account currency, never an assumed USD", () => {
  const read = async (name: string, account: Record<string, unknown>) => {
    const handler = tool(registerBillingTools, name).handler;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ id: "act_123", name: "Acct", ...account })));
    return (await handler({ account_id: "123" })).content[0].text;
  };

  it("does not divide offset-1 currencies (JPY/KRW/TWD) by 100", async () => {
    const jpy = await read("ads_get_billing_info", { currency: "JPY", spend_cap: "100000", amount_spent: "50000", balance: "20000" });
    expect(jpy).toContain("Spend Cap: 100000 JPY");
    expect(jpy).toContain("Amount Spent: 50000 JPY");
    expect(jpy).toContain("Balance: 20000 JPY");
    expect(jpy).not.toContain("1000.00");

    const krw = await read("ads_get_spend_limit", { currency: "KRW", spend_cap: "1000000", amount_spent: "250000", min_daily_budget: 1000, daily_spend_limit: "300000" });
    expect(krw).toContain("Spend Cap: 1000000 KRW");
    expect(krw).toContain("Remaining: 750000 KRW");
    expect(krw).toContain("Min Daily Budget: 1000 KRW");
    expect(krw).toContain("Daily Spend Limit: 300000 KRW");
    expect(krw).not.toContain("10000.00");

    const twd = await read("ads_get_billing_info", { currency: "TWD", spend_cap: "30000" });
    expect(twd).toContain("Spend Cap: 30000 TWD");
  });

  it("keeps cents for offset-100 currencies", async () => {
    const eur = await read("ads_get_billing_info", { currency: "EUR", spend_cap: "100000", amount_spent: "50000" });
    expect(eur).toContain("Spend Cap: 1000.00 EUR");
    expect(eur).toContain("Amount Spent: 500.00 EUR");
  });

  it("reports raw minor units without inventing a currency when Meta omits it", async () => {
    const text = await read("ads_get_billing_info", { spend_cap: "100000" });
    expect(text).toContain("Spend Cap: 100000 (minor units; currency unknown)");
    expect(text).not.toContain("USD");
  });

  it("does not guess an offset for a currency missing from the table", async () => {
    const text = await read("ads_get_billing_info", { currency: "XTS", spend_cap: "100000" });
    expect(text).toContain("Spend Cap: 100000 (minor units; offset for XTS unknown)");
  });
});

describe("ads_update_spend_cap cannot remove or raise a cap", () => {
  const POST = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");

  const stub = (current: Record<string, unknown>) => {
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? mockFetchResponse({ success: true }) : mockFetchResponse({ id: "act_123", ...current }),
    );
    vi.stubGlobal("fetch", f);
    return f;
  };

  const handler = () => tool(registerBillingTools, "ads_update_spend_cap").handler;

  it("describes the real behaviour: no 'or omit', no removal", () => {
    const t = tool(registerBillingTools, "ads_update_spend_cap");
    expect(t.description).not.toMatch(/omit/i);
    expect(t.description).not.toMatch(/to 0 .*remove|Use 0 to remove/i);
    expect(t.description).toMatch(/lower/i);
    expect(t.description).toMatch(/financial gate/i);
    const field = (t.shape.spend_cap as z.ZodType).description ?? "";
    expect(field).not.toMatch(/Use 0 to remove/i);
    expect(field).toMatch(/minor unit/i);
  });

  it.each([0, -1, 50.5, Number.NaN])("refuses %s before any request", async (value) => {
    stub({ currency: "USD", spend_cap: "100000" });
    await expect(handler()({ account_id: "123", spend_cap: value })).rejects.toThrow(/spend_cap/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses to raise an existing cap and sends no write", async () => {
    stub({ currency: "USD", spend_cap: "100000", amount_spent: "5000" });
    await expect(handler()({ account_id: "123", spend_cap: 200000 })).rejects.toThrow(/financial gate/i);
    expect(POST()).toHaveLength(0);
  });

  it("refuses when the current cap cannot be read, rather than guessing", async () => {
    stub({ currency: "USD" });
    await expect(handler()({ account_id: "123", spend_cap: 5000 })).rejects.toThrow(/financial gate/i);
    expect(POST()).toHaveLength(0);
  });

  it("lowers an existing cap and reports the account currency", async () => {
    stub({ currency: "JPY", spend_cap: "100000", amount_spent: "5000" });
    const result = await handler()({ account_id: "123", spend_cap: 50000 });
    expect(POST()).toHaveLength(1);
    expect(new URLSearchParams(POST()[0][1]?.body as string).get("spend_cap")).toBe("50000");
    expect(result.content[0].text).toContain("50000 JPY");
  });

  it("allows setting a first cap on an account that has none (0 means unlimited)", async () => {
    stub({ currency: "USD", spend_cap: "0" });
    await handler()({ account_id: "123", spend_cap: 100000 });
    expect(POST()).toHaveLength(1);
  });

  it("makes no write when the cap is unchanged", async () => {
    stub({ currency: "USD", spend_cap: "100000" });
    const result = await handler()({ account_id: "123", spend_cap: 100000 });
    expect(POST()).toHaveLength(0);
    expect(result.content[0].text).toMatch(/unchanged/i);
  });

  it("is held by the strict guard: no network request in platform mode", async () => {
    vi.stubEnv("LUMIN_PLATFORM_ENABLED", "true");
    const registrations = new Map<string, { handler: (...a: unknown[]) => unknown }>();
    const server = {
      registerTool: (name: string, _config: unknown, h: (...a: unknown[]) => unknown) => {
        registrations.set(name, { handler: h });
        return { name };
      },
    } as unknown as McpServer;
    const finish = installLegacyGuard(server);
    registerAllTools(server);
    finish();
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const input of [{ account_id: "123", spend_cap: 0 }, { account_id: "123", spend_cap: 900000000 }]) {
      await expect(Promise.resolve().then(() => registrations.get("ads_update_spend_cap")!.handler(input))).rejects.toThrow();
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe("no generic tool can reach an ad account's spend cap through an entity id", () => {
  const stubOk = () => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ success: true })));

  it.each(["campaign", "ad_set", "ad"])("ads_update_entity refuses an act_ account id as a %s", async (entityType) => {
    stubOk();
    const handler = tool(registerEntityTools, "ads_update_entity").handler;
    await expect(handler({ entity_type: entityType, entity_id: "act_123", updates: { spend_cap: 0 } })).rejects.toThrow(/Invalid Meta/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["campaign", "ad_set", "ad"])("ads_activate_entity refuses an act_ account id as a %s", async (entityType) => {
    stubOk();
    const handler = tool(registerEntityTools, "ads_activate_entity").handler;
    await expect(handler({ entity_type: entityType, entity_id: "act_123", status: "ACTIVE" })).rejects.toThrow(/Invalid Meta/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validateMetaId keeps account ids for account-level kinds but not for ad entities", () => {
    for (const kind of ["campaign", "adset", "ad", "creative"]) {
      expect(() => validateMetaId("act_123", kind), kind).toThrow(/Invalid Meta/);
      expect(() => validateMetaId("123_456", kind), kind).toThrow(/Invalid Meta/);
      expect(validateMetaId("123456", kind)).toBe("123456");
    }
    expect(validateMetaId("act_123", "object")).toBe("act_123");
    expect(validateMetaId("act_123")).toBe("act_123");
    expect(validateMetaId("123_456", "post")).toBe("123_456");
  });
});
