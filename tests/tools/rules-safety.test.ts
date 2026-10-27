import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerRuleTools } from "../../src/tools/rules.js";
import { createMockMcpServer, setupTestToken, cleanupTestToken, mockFetchResponse } from "../setup.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function tool(name: string) {
  const server = createMockMcpServer();
  registerRuleTools(server as never);
  const found = server._registeredTools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return { ...found, handler: found.handler as unknown as Handler, shape: found.schema as z.ZodRawShape };
}

const evaluation = {
  evaluation_type: "SCHEDULE",
  filters: [{ field: "impressions", value: 1, operator: "GREATER_THAN" }],
};

const create = (execution_spec: unknown) =>
  tool("ads_create_ad_rule").handler({ account_id: "123", name: "Synthetic rule", evaluation_spec: evaluation, execution_spec });

const update = (args: Record<string, unknown>) => tool("ads_update_ad_rule").handler({ rule_id: "901", ...args });

const sentBody = () => new URLSearchParams(vi.mocked(fetch).mock.calls[0][1]?.body as string);

beforeEach(() => {
  setupTestToken();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ id: "901", success: true })));
});
afterEach(() => {
  cleanupTestToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SPEND_TYPES = ["UNPAUSE", "CHANGE_BUDGET", "CHANGE_BID"];
const NOT_PERMITTED = /Autonomous spend-changing rules are not permitted in this release/;

const SPELLING_VARIANTS = [
  "unpause",
  "Change_Budget",
  "change_budget",
  "CHANGE_bid",
  " CHANGE_BUDGET",
  "CHANGE_BUDGET ",
  "UNPAUSE\n",
  "\tCHANGE_BID",
  "  unpause  ",
];

describe.each([
  ["ads_create_ad_rule", (spec: unknown) => create(spec)],
  ["ads_update_ad_rule", (spec: unknown) => update({ execution_spec: spec })],
] as const)("%s refuses autonomous spend-changing rules before any request", (_name, run) => {
  it.each(SPEND_TYPES)("refuses execution_type %s", async (execution_type) => {
    await expect(run({ execution_type })).rejects.toThrow(NOT_PERMITTED);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(SPEND_TYPES)("refuses execution_type %s with execution_options too", async (execution_type) => {
    await expect(
      run({ execution_type, execution_options: [{ field: "daily_budget", value: 5000, operator: "INCREASE_BY" }] }),
    ).rejects.toThrow(NOT_PERMITTED);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("no longer posts an unbounded daily_budget option (99999999999)", async () => {
    await expect(
      run({ execution_type: "CHANGE_BUDGET", execution_options: [{ field: "daily_budget", value: 99999999999, operator: "EQUAL" }] }),
    ).rejects.toThrow(NOT_PERMITTED);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(SPELLING_VARIANTS)("refuses the spelling variant %j if one ever reaches the handler", async (execution_type) => {
    await expect(run({ execution_type })).rejects.toThrow(NOT_PERMITTED);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["DELETE", "", "PAUSE_ALL", "ＣＨＡＮＧＥ_BUDGET", "CHANGE​_BUDGET", 7, null, undefined, {}])(
    "refuses an execution_type outside the allowed list: %j",
    async (execution_type) => {
      await expect(run({ execution_type })).rejects.toThrow(/Unsupported execution_type/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ field: "daily_budget", value: 5000 }],
    [{ field: "Lifetime_Budget", value: 5000 }],
    [{ field: "bid_amount", value: 100 }],
    [{ field: "spend_cap", value: 100 }],
    [{ field: "user_ids", value: "1", operator: "INCREASE_BY" }],
    [{ field: "user_ids", value: "1", operator: "DECREASE_BY" }],
    [{ field: "user_ids", value: "1", operator: "increase_by" }],
    [{ field: "user_ids", value: "1", operator: " Decrease_By " }],
  ])("refuses a budget, bid or spend option on an otherwise allowed type: %j", async (option) => {
    await expect(run({ execution_type: "NOTIFICATION", execution_options: [option] })).rejects.toThrow(NOT_PERMITTED);
    await expect(run({ execution_type: "PAUSE", execution_options: [option] })).rejects.toThrow(NOT_PERMITTED);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the input schemas do not accept spelling variants of the refused types", () => {
  it.each([
    ["ads_create_ad_rule", { account_id: "123", name: "n", evaluation_spec: evaluation }],
    ["ads_update_ad_rule", { rule_id: "901" }],
  ] as const)("%s", (name, base) => {
    const shape = tool(name).shape;
    for (const execution_type of SPELLING_VARIANTS) {
      expect(z.object(shape).safeParse({ ...base, execution_spec: { execution_type } }).success, execution_type).toBe(false);
    }
    expect(z.object(shape).safeParse({ ...base, execution_spec: { execution_type: "PAUSE" } }).success).toBe(true);
  });
});

describe("ads_create_ad_rule keeps PAUSE, ROTATE and NOTIFICATION working", () => {
  it.each(["PAUSE", "ROTATE", "NOTIFICATION"])("creates a %s rule", async (execution_type) => {
    await create({ execution_type });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/act_123/adrules_library");
    const body = sentBody();
    expect(body.get("name")).toBe("Synthetic rule");
    expect(JSON.parse(body.get("execution_spec")!)).toEqual({ execution_type });
    expect(JSON.parse(body.get("evaluation_spec")!)).toEqual(evaluation);
  });

  it("forwards harmless execution_options for a NOTIFICATION rule", async () => {
    const options = [{ field: "user_ids", value: "1001", operator: "EQUAL" }];
    await create({ execution_type: "NOTIFICATION", execution_options: options });
    expect(JSON.parse(sentBody().get("execution_spec")!)).toEqual({ execution_type: "NOTIFICATION", execution_options: options });
  });

  it("forwards only the known execution_spec keys", async () => {
    await create({ execution_type: "PAUSE", change_spec: { amount: 5000, unit: "ACCOUNT_CURRENCY" }, daily_budget: 99999999999 });
    expect(JSON.parse(sentBody().get("execution_spec")!)).toEqual({ execution_type: "PAUSE" });
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).not.toContain("99999999999");
  });
});

describe("ads_update_ad_rule keeps PAUSE, ROTATE and NOTIFICATION working", () => {
  it.each(["PAUSE", "ROTATE", "NOTIFICATION"])("switches a rule to %s", async (execution_type) => {
    await update({ execution_spec: { execution_type } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/901");
    expect(JSON.parse(sentBody().get("execution_spec")!)).toEqual({ execution_type });
  });

  it("still renames and disables a rule without an execution_spec", async () => {
    await update({ name: "Renamed", status: "DISABLED" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sentBody().get("name")).toBe("Renamed");
    expect(sentBody().get("status")).toBe("DISABLED");
    expect(sentBody().has("execution_spec")).toBe(false);
  });

  it("still updates the evaluation_spec alone", async () => {
    await update({ evaluation_spec: evaluation });
    expect(JSON.parse(sentBody().get("evaluation_spec")!)).toEqual(evaluation);
  });

  it("refuses a switch to CHANGE_BUDGET even when the same call renames the rule", async () => {
    await expect(update({ name: "Renamed", status: "ENABLED", execution_spec: { execution_type: "CHANGE_BUDGET" } })).rejects.toThrow(NOT_PERMITTED);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the rule tool descriptions no longer advertise spend-changing automation", () => {
  it.each(["ads_create_ad_rule", "ads_update_ad_rule"])("%s", (name) => {
    const description = tool(name).description as string;
    expect(description).not.toMatch(/increase budget/i);
    expect(description).toMatch(/UNPAUSE, CHANGE_BUDGET and CHANGE_BID are (refused|not permitted)/);
  });
});
