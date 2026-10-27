import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerEntityTools } from "../../src/tools/entities.js";
import { createMockMcpServer, setupTestToken, cleanupTestToken, mockFetchResponse } from "../setup.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

const handler = (): Handler => {
  const server = createMockMcpServer();
  registerEntityTools(server as never);
  return server._registeredTools.find((t) => t.name === "ads_update_entity")!.handler as unknown as Handler;
};

const update = (updates: Record<string, unknown>, entityType = "campaign", entityId = "201") =>
  handler()({ entity_type: entityType, entity_id: entityId, updates });

const sentBody = () => new URLSearchParams(vi.mocked(fetch).mock.calls[0][1]?.body as string);

beforeEach(() => {
  setupTestToken();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ success: true })));
});
afterEach(() => {
  cleanupTestToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AMOUNT_KEYS = [
  "daily_budget",
  "lifetime_budget",
  "bid_amount",
  "bid_cap",
  "daily_spend_cap",
  "lifetime_spend_cap",
  "daily_min_spend_target",
  "lifetime_min_spend_target",
];

const BAD_AMOUNTS: Array<[string, unknown]> = [
  ["negative number", -1],
  ["zero", 0],
  ["fractional number", 50.5],
  ["number above the ceiling", 1_000_000_001],
  ["unsafe integer", Number.MAX_SAFE_INTEGER + 2],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["negative string", "-1"],
  ["zero string", "0"],
  ["fractional string", "1.5"],
  ["exponent string", "1e3"],
  ["hex string", "0x10"],
  ["leading zeros", "007"],
  ["leading plus", "+5"],
  ["padded string", " 5"],
  ["trailing space", "5 "],
  ["empty string", ""],
  ["word", "abc"],
  ["string above the ceiling", "1000000001"],
  ["very long digit string", "99999999999999999999"],
  ["boolean", true],
  ["object", { amount: 5 }],
  ["array", [5]],
];

describe("ads_update_entity bounds every money field it forwards", () => {
  describe.each(AMOUNT_KEYS)("%s", (key) => {
    it.each(BAD_AMOUNTS)("rejects a %s without calling Meta", async (_name, value) => {
      await expect(update({ [key]: value })).rejects.toThrow(new RegExp(`updates\\.${key}`));
      expect(fetch).not.toHaveBeenCalled();
    });

    it("sends a valid whole amount in canonical decimal form", async () => {
      await update({ [key]: 5000 });
      expect(sentBody().get(key)).toBe("5000");
      vi.mocked(fetch).mockClear();
      await update({ [key]: "1000000000" });
      expect(sentBody().get(key)).toBe("1000000000");
    });
  });

  it("matches money fields case-insensitively", async () => {
    await expect(update({ Daily_Budget: -5 })).rejects.toThrow(/updates\.Daily_Budget/);
    await expect(update({ BID_AMOUNT: "1e3" })).rejects.toThrow(/updates\.BID_AMOUNT/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["campaign", "ad_set", "ad"])("applies to a %s update, not only to campaigns", async (entityType) => {
    await expect(update({ daily_budget: -1 }, entityType)).rejects.toThrow(/updates\.daily_budget/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves a null amount unsent, as before", async () => {
    await update({ name: "Renamed", daily_budget: null });
    expect(sentBody().get("name")).toBe("Renamed");
    expect(sentBody().has("daily_budget")).toBe(false);
  });
});

describe("ads_update_entity never writes spend caps or read-only money fields", () => {
  it.each(["spend_cap", "spend_cap_action", "account_spend_limit", "budget_remaining", "SPEND_CAP"])(
    "refuses %s for any value, including 0 and null",
    async (key) => {
      for (const value of [0, 100, "0", "reset", null, undefined]) {
        await expect(update({ [key]: value })).rejects.toThrow(/financial gate|read-only/);
      }
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("points to the lower-only spend cap tool for account caps", async () => {
    await expect(update({ spend_cap: 0 })).rejects.toThrow(/ads_update_spend_cap/);
  });
});

describe("ads_update_entity checks money fields nested in structured updates", () => {
  it("rejects a bad per-ad-set budget inside adset_budgets", async () => {
    await expect(update({ adset_budgets: [{ adset_id: "301", daily_budget: -5 }] })).rejects.toThrow(/daily_budget/);
    await expect(update({ adset_budgets: [{ adset_id: "301", daily_budget: 5000 }, { adset_id: "302", lifetime_budget: 1.5 }] })).rejects.toThrow(/lifetime_budget/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a spend cap hidden inside a nested object", async () => {
    await expect(update({ settings: { deeper: { spend_cap: 0 } } })).rejects.toThrow(/financial gate/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects money fields inside values that are already JSON-encoded strings", async () => {
    await expect(update({ adset_budgets: JSON.stringify([{ adset_id: "301", daily_budget: -5 }]) })).rejects.toThrow(/daily_budget/);
    await expect(update({ blob: '{"spend_cap":0}' })).rejects.toThrow(/financial gate/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("encodes valid nested amounts in canonical form", async () => {
    await update({ adset_budgets: [{ adset_id: "301", daily_budget: 5000 }] });
    expect(JSON.parse(sentBody().get("adset_budgets")!)).toEqual([{ adset_id: "301", daily_budget: 5000 }]);
  });
});

describe("ads_update_entity refuses update keys that are not plain field names", () => {
  it.each([
    "adset_budgets[0][daily_budget]",
    "daily_budget[0]",
    "spend_cap[x]",
    "budget.daily_budget",
    "daily_budget ",
    " spend_cap",
    "spend_cap\n",
    "daily-budget",
    "1daily_budget",
    "",
    "a".repeat(65),
  ])("refuses the key %j before any request", async (key) => {
    await expect(update({ [key]: "-1" })).rejects.toThrow(/not a plain field name/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still accepts the ordinary snake_case field names", async () => {
    await update({ name: "Renamed", is_adset_budget_sharing_enabled: false, bid_strategy: "LOWEST_COST_WITHOUT_CAP" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("ads_update_entity keeps ordinary updates unchanged", () => {
  it("forwards names, statuses and structured fields as before", async () => {
    await update({ name: "[PROMO] Summer", status: "PAUSED", targeting: { geo_locations: { countries: ["US"] } }, is_adset_budget_sharing_enabled: false });
    const body = sentBody();
    expect(body.get("name")).toBe("[PROMO] Summer");
    expect(body.get("status")).toBe("PAUSED");
    expect(JSON.parse(body.get("targeting")!)).toEqual({ geo_locations: { countries: ["US"] } });
    expect(body.get("is_adset_budget_sharing_enabled")).toBe("false");
  });

  it("still sends a valid budget with the other changes", async () => {
    await update({ name: "Renamed", daily_budget: 2500 });
    expect(sentBody().get("daily_budget")).toBe("2500");
  });
});
