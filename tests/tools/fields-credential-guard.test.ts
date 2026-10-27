import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestContext } from "../../src/auth/token-store.js";
import { metaApiClient } from "../../src/meta/client.js";
import { registerAllTools } from "../../src/tools/index.js";
import { cleanupTestToken, createMockMcpServer, mockFetchResponse, setupTestToken } from "../setup.js";

/**
 * Every tool that relays a caller-chosen `fields` list to Graph, with the
 * smallest valid arguments for it. A tool with a `fields` input that is not
 * listed here fails the first test, so a new one has to be added (and so
 * checked) rather than slipping past.
 */
const TOOLS_WITH_FIELDS: Record<string, Record<string, unknown>> = {
  ads_get_ad_accounts: { user_id: "me" },
  ads_get_campaigns: { account_id: "act_123" },
  ads_get_campaign_details: { campaign_id: "123456789012345" },
  ads_get_ad_set_details: { ad_set_id: "123456789012345" },
  ads_get_ad_details: { ad_id: "123456789012345" },
  ads_get_ad_creatives: { ad_id: "123456789012345" },
  ads_get_creative_details: { creative_id: "123456789012345" },
  ads_get_ad_images: { account_id: "act_123" },
  ads_get_ad_videos: { account_id: "act_123" },
  ads_get_video_details: { video_id: "123456789012345" },
  ads_get_ad_entities: { entity_type: "ad_set", parent_id: "123456789012345" },
  ads_get_insights: { object_id: "act_123", date_preset: "last_7d", level: "campaign" },
  ads_get_lead_forms: { page_id: "123456789012345", limit: 25 },
  ads_get_leads: { form_id: "123456789012345" },
  ads_get_ad_leads: { ad_id: "123456789012345" },
  ads_get_custom_audiences: { account_id: "act_123" },
  ads_get_audience_details: { audience_id: "123456789012345" },
  ads_get_pixels: { account_id: "act_123" },
  ads_get_pixel_details: { pixel_id: "123456789012345" },
  ads_get_custom_conversions: { account_id: "act_123" },
  ads_get_ad_rules: { account_id: "act_123" },
  ads_get_rule_details: { rule_id: "123456789012345" },
  ads_get_ad_studies: { account_id: "act_123" },
  ads_get_study_details: { study_id: "123456789012345" },
  ads_create_async_report: { object_id: "act_123", date_preset: "last_7d", level: "campaign" },
  ads_run_report_and_wait: { object_id: "act_123", date_preset: "last_7d", level: "campaign" },
  whatsapp_get_business_accounts: { waba_id: "123456789012345" },
  whatsapp_get_phone_numbers: { waba_id: "123456789012345" },
  whatsapp_get_templates: { waba_id: "123456789012345" },
  whatsapp_get_flows: { waba_id: "123456789012345" },
};

const server = createMockMcpServer();
registerAllTools(server as never);
const byName = new Map(server._registeredTools.map((t) => [t.name, t]));

const HOSTILE: string[][] = [
  ["access_token"],
  ["id", "access_token"],
  ["owned_pages{access_token}"],
  ["business{owned_pages{id,access_token}}"],
  ["client_pages"],
  ["instagram_accounts"],
  ["accounts"],
  ["name.fields(access_token)"],
];

const asOperator = <T>(run: () => Promise<T>): Promise<T> =>
  requestContext.run({ accessToken: "synthetic-user-token", fbUserId: "100000000000001" }, run);

describe("tools that relay caller-chosen Graph fields", () => {
  beforeEach(() => {
    setupTestToken();
    metaApiClient.resetForTests();
    vi.stubGlobal("fetch", vi.fn(async () => mockFetchResponse({ data: [], id: "1" })));
  });
  afterEach(() => {
    cleanupTestToken();
    metaApiClient.resetForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists every registered tool that accepts a fields input", () => {
    const withFields = server._registeredTools
      .filter((t) => t.schema && typeof t.schema === "object" && "fields" in (t.schema as object))
      .map((t) => t.name)
      .sort();
    expect(withFields).toEqual(Object.keys(TOOLS_WITH_FIELDS).sort());
  });

  describe.each(Object.entries(TOOLS_WITH_FIELDS))("%s", (name, baseArgs) => {
    it.each(HOSTILE.map((fields) => [fields]))("refuses fields %j before any Graph call", async (fields) => {
      const tool = byName.get(name)!;
      await expect(asOperator(() => tool.handler({ ...baseArgs, fields }))).rejects.toThrow(/Requested fields are not allowed/);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("still relays ordinary fields", async () => {
      const tool = byName.get(name)!;
      await asOperator(() => tool.handler({ ...baseArgs, fields: ["id", "name"] })).catch(() => undefined);
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const first = calls[0];
      expect(`${String(first[0])} ${String(first[1]?.body ?? "")}`).toMatch(/fields/);
    });
  });
});
