import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { executeLegacyTrackingWorkflow } from "../../src/platform/legacy-tracking.js";
import { AppPromotionEnrollmentService } from "../../src/platform/app-promotion-service.js";
import { appPromotionBindingHash } from "../../src/platform/app-promotion-contract.js";
import type { PlatformRepository } from "../../src/platform/repository.js";
import { marketingControlFixture } from "./marketing-control-fixture.js";
import { establishFinancialFixture } from "./financial-fixture.js";
import { signalDiscoveryFixture } from "./signal-discovery-fixture.js";
import { appPromotionFixture } from "./app-promotion-fixture.js";
import { actor, clientId as pagesClientId, pagesApprovalFixture, pagesInput } from "./pages-approval-fixture.js";
import { recordFetch, recordStoreWrites } from "./store-write-recorder.js";

/**
 * Every tool that keeps its place in a strict read-only agency deployment without a readOnlyHint, driven end to end
 * with synthetic fixtures. Each one is run twice, with platform writes disabled (the deployment under test) and
 * enabled (a control that proves the fixture reaches a real success path, so a denial is not a fixture accident).
 * No Meta request may ever be anything but a GET, and every store write is pinned to the records the tool is
 * documented to create.
 */
const DEPLOYMENT = {
  DEPLOYMENT_MODE: "agency", LUMIN_PLATFORM_ENABLED: "true", LUMIN_PLATFORM_DISCOVERY_ENABLED: "true", LUMIN_TRACKING_CHANGE_ENABLED: "true",
  LUMIN_MARKETING_CREATIVE_REPLACEMENT_ENABLED: "true", LUMIN_PAUSED_AD_BATCH_ENABLED: "true", LUMIN_MARKETING_VIDEO_CREATIVE_ENABLED: "true",
  LUMIN_SIGNAL_ASSET_DISCOVERY_ENABLED: "true", LUMIN_MARKETING_APP_PROMOTION_ENABLED: "true", META_APP_ID: "300", META_API_VERSION: "v26.0", TOKEN_ENCRYPTION_KEY: "e".repeat(64),
} as const;
const WRITES = { readonly: { AGENCY_WRITES_ENABLED: "false", LUMIN_PLATFORM_WRITES_ENABLED: "false" }, enabled: { AGENCY_WRITES_ENABLED: "true", LUMIN_PLATFORM_WRITES_ENABLED: "true" } } as const;
type Mode = keyof typeof WRITES;
const MODES: Mode[] = ["readonly", "enabled"];
const stubDeployment = (mode: Mode) => { for (const [k, v] of Object.entries({ ...DEPLOYMENT, ...WRITES[mode] })) vi.stubEnv(k, v); };

afterEach(() => { configurePlatformRepository(undefined); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const image = "a".repeat(32), otherImage = "b".repeat(32);
async function marketingWorld() {
  const f = await marketingControlFixture("success", {
    pausedOnly: true, actions: ["READ", "WRITE_AD_CONFIGURATION"],
    capabilities: ["legacy.ads_get_ad_details", "legacy.ads_get_creative_details", "legacy.ads_get_ad_set_details", "legacy.ads_create_ad_creative", "legacy.ads_create_ad", "legacy.ads_update_ad", "legacy.ads_get_ads", "legacy.ads_get_ad_images", "legacy.ads_search_geo_locations", "legacy.ads_search_interests"],
  });
  const connected = await f.connect();
  await establishFinancialFixture(f.repo, { tenantId: "tenant", operatorId: "100" }, "client", "account");
  const c = (await f.repo.get("connections", "tenant", connected.connectionId))!, now = Date.now();
  await f.repo.put("connections", "tenant", c.id, { ...c, revision: c.revision + 1, eligibility: [...(c.eligibility ?? []), ...["marketing_read_access:v26.0", "marketing_write_access:v26.0", "marketing_creative_destination:https://client.fixture.invalid"].map(requirement => ({ requirement, source: "https://developers.facebook.com/docs/permissions", verified: true, checkedAt: now, expiresAt: now + 300000 }))] });
  const provider = recordFetch(async (input, init) => {
    const path = new URL(String(input)).pathname.replace("/v26.0", "");
    if (path === "/601") return new Response('{"id":"601"}');
    if (path === "/act_101/adimages") return new Response(JSON.stringify({ data: [{ hash: otherImage, account_id: "101" }] }));
    if (path === "/search") return new Response(JSON.stringify({ data: [{ key: "2420379", name: "Madrid", type: "city", country_code: "ES", country_name: "Spain", region: "Madrid", region_id: 1, supports_city: true }] }));
    return f.fetcher(input, init);
  });
  const writes = recordStoreWrites(f.repo);
  configurePlatformRepository(f.repo);
  vi.stubGlobal("fetch", provider.fetch);
  return { repo: f.repo as PlatformRepository, connectionId: connected.connectionId, writes, requests: provider.log };
}

async function session(operatorId: string) {
  const server = createServer(), client = new Client({ name: "read-only-surface", version: "1" }), [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await requestContext.run({ fbUserId: operatorId }, () => client.callTool({ name, arguments: args }));
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* a protocol error is plain text */ }
    return { isError: result.isError === true, text, body };
  };
  return { client, server, call, close: async () => { await client.close(); await server.close(); } };
}

const trackingArgs = (connectionId: string) => ({ client_id: "client", ad_id: "401", name: "Tracking replacement", url_tags: "utm_source=meta", connection_id: connectionId });
const compatibilityArgs = (connectionId: string) => ({ client_id: "client", connection_id: connectionId, tool: "ads_create_ad_creative", input: { account_id: "101", name: "Reviewed replacement", page_id: "601", image_hash: image, link_url: "https://client.fixture.invalid/", call_to_action_type: "LEARN_MORE", url_tags: "utm_source=meta", source_ad_id: "401" } });

interface MarketingCase {
  tool: string;
  args: (connectionId: string) => Record<string, unknown>;
  /** Meta requests the tool makes when it succeeds: all must be GET. */
  gets: string[];
  /** Store writes when it succeeds. */
  writes: string[];
  /** Whether a deployment with platform writes disabled refuses it, and with which reason; undefined means it still runs. */
  deniedWhenWritesDisabled?: string;
}
const MARKETING_CASES: MarketingCase[] = [
  { tool: "meta_plan_ad_tracking_change", args: trackingArgs, gets: ["/401", "/501", "/me/accounts"], writes: ["trackingChangeJobs", "controlAudit"], deniedWhenWritesDisabled: "DISABLED_BY_LUMIN_POLICY" },
  { tool: "meta_plan_paused_ads", args: () => ({ client_id: "client", account_id: "101", ad_set_id: "301", ads: [{ name: "One", creative_id: "501" }] }), gets: [], writes: ["pausedAdBatchJobs", "controlAudit"] },
  { tool: "meta_observe_ads_compatibility", args: compatibilityArgs, gets: ["/act_101", "/601", "/401", "/me/accounts"], writes: ["compatibilityObservations", "connections", "controlAudit"] },
  { tool: "meta_observe_account_owner", args: connectionId => ({ client_id: "client", account_key: "account", connection_id: connectionId }), gets: ["/act_101"], writes: ["accountOwnershipObservations", "assets", "controlAudit"] },
  { tool: "meta_lookup_ad_targeting", args: connectionId => ({ client_id: "client", root_key: "account", kind: "CITY", query: "Madrid", connection_id: connectionId }), gets: ["/search"], writes: ["targetingLookups", "controlAudit"] },
  { tool: "meta_discover_ad_assets", args: connectionId => ({ client_id: "client", root_key: "account", kind: "AD_IMAGE", connection_id: connectionId }), gets: ["/act_101/adimages"], writes: ["discoveryProposals", "controlAudit"] },
];

describe.each(MODES)("strict agency deployment, platform writes %s", mode => {
  it.each(MARKETING_CASES)("$tool makes only GET requests and writes only its own records", async spec => {
    stubDeployment(mode);
    const world = await marketingWorld(), s = await session("100");
    try {
      const before = { writes: world.writes.length, requests: world.requests.length };
      const result = await s.call(spec.tool, spec.args(world.connectionId));
      const requests = world.requests.slice(before.requests), writes = world.writes.slice(before.writes);
      expect(requests.filter(r => r.method !== "GET")).toEqual([]);
      if (mode === "readonly" && spec.deniedWhenWritesDisabled) {
        expect(result.isError).toBe(true);
        expect(result.body).toMatchObject({ status: "HOLD", reason: spec.deniedWhenWritesDisabled });
        expect(writes).toEqual([]);
        expect(requests).toEqual([]);
        return;
      }
      expect(result.isError, result.text).toBe(false);
      expect(writes).toEqual(spec.writes);
      expect(requests.map(r => r.path)).toEqual(spec.gets);
    } finally { await s.close(); }
  });

  it("ads_update_ad_url_tags is a local review planner: hidden and refused read-only, GET-only and one tracking proposal when enabled", async () => {
    stubDeployment(mode);
    const world = await marketingWorld(), s = await session("100");
    try {
      const listed = (await s.client.listTools()).tools.map(t => t.name);
      const args = { client_id: "client", ad_ids: ["401"], url_tags: "utm_source=meta", dry_run: true, connection_id: world.connectionId };
      const before = { writes: world.writes.length, requests: world.requests.length };
      if (mode === "readonly") {
        expect(listed).not.toContain("ads_update_ad_url_tags");
        const result = await s.call("ads_update_ad_url_tags", args);
        expect(result.isError).toBe(true);
        expect(result.text).toContain("disabled");
        await expect(executeLegacyTrackingWorkflow(args)).rejects.toThrow("DISABLED_BY_LUMIN_POLICY");
      } else {
        expect(listed).toContain("ads_update_ad_url_tags");
        const result = await s.call("ads_update_ad_url_tags", args);
        expect(result.isError, result.text).toBe(false);
        expect(result.body).toMatchObject({ provider_writes: 0, providerDispatch: false, implementation: "STRICT_LOCAL_REVIEW_WORKFLOW" });
      }
      const requests = world.requests.slice(before.requests), writes = world.writes.slice(before.writes);
      expect(requests.filter(r => r.method !== "GET")).toEqual([]);
      expect(requests.map(r => r.path)).toEqual(mode === "readonly" ? [] : ["/401", "/501", "/me/accounts"]);
      expect(writes).toEqual(mode === "readonly" ? [] : ["trackingChangeJobs", "controlAudit"]);
    } finally { await s.close(); }
  });

  it("meta_prepare_action and meta_prepare_publication store an approval request only when writes are enabled", async () => {
    stubDeployment(mode);
    const repo = await pagesApprovalFixture(), writes = recordStoreWrites(repo), requests: string[] = [];
    configurePlatformRepository(repo);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { requests.push((init?.method ?? "GET") + " " + String(input)); return new Response("{}"); }));
    const s = await session(actor.operatorId);
    try {
      const action = await s.call("meta_prepare_action", { client_id: pagesClientId, tool: "pages_create_feed", asset_id: "123", input: pagesInput });
      const publication = await s.call("meta_prepare_publication", { client_id: pagesClientId, steps: [{ tool: "pages_create_feed", asset_id: "123", input: pagesInput }] });
      expect(requests).toEqual([]);
      if (mode === "readonly") {
        expect(action.isError).toBe(true);
        expect(action.body).toMatchObject({ status: "HOLD", reason: "DISABLED_BY_LUMIN_POLICY" });
        expect(publication.body).toMatchObject({ status: "PARTIAL_PREPARATION", steps: [{ tool: "pages_create_feed", status: "HOLD" }] });
        expect(writes).toEqual([]);
        expect(await repo.list("approvalRequests", "tenant-fixture")).toEqual([]);
      } else {
        expect(action.isError, action.text).toBe(false);
        expect(publication.body).toMatchObject({ status: "HUMAN_REVIEW_REQUIRED", provider_writes: 0 });
        expect(writes).toEqual(["approvalRequests", "controlAudit", "approvalRequests", "controlAudit"]);
      }
    } finally { await s.close(); }
  });

  it("meta_discover_signal_assets only reads from Meta and stores one encrypted enrollment proposal", async () => {
    stubDeployment(mode);
    const f = await signalDiscoveryFixture(), writes = recordStoreWrites(f.repo);
    const ctx = { principal: { tenantId: "tenant", operatorId: "100" }, clientId: "client", provider: "META_MARKETING" as const, tool: "meta_discover_signal_assets", requestId: "surface" };
    await f.service.prepare(ctx, { accountKey: "account", businessKey: "business", kind: "DATASET" });
    expect(f.fetcher.mock.calls.length).toBeGreaterThan(0);
    for (const [, init] of f.fetcher.mock.calls) expect(init?.method).toBe("GET");
    expect(writes).toEqual(["signalDiscoveryProposals", "controlAudit"]);
  });

  it("meta_prepare_app_promotion_access only reads from Meta and stores one enrollment proposal", async () => {
    stubDeployment(mode);
    const f = await appPromotionFixture(), writes = recordStoreWrites(f.repo), service = new AppPromotionEnrollmentService(f.repo, f.registry, { fetcher: f.fetcher });
    const ctx = { principal: { tenantId: "t", operatorId: "100" }, clientId: "c", provider: "META_MARKETING" as const, tool: "meta_prepare_app_promotion_access", requestId: "surface" };
    await service.prepare(ctx, appPromotionBindingHash(f.definition.binding), "source");
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of f.fetcher.mock.calls) expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
    expect(writes).toEqual(["appPromotionProposals", "controlAudit"]);
  });
});

describe("outside an agency deployment", () => {
  it("ads_update_ad_url_tags keeps its baseline listing and still refuses, with no Meta request and no store write, while writes are disabled", async () => {
    stubDeployment("readonly");
    vi.stubEnv("DEPLOYMENT_MODE", "legacy");
    const world = await marketingWorld(), s = await session("100");
    try {
      expect((await s.client.listTools()).tools.map(t => t.name)).toContain("ads_update_ad_url_tags");
      const result = await s.call("ads_update_ad_url_tags", { client_id: "client", ad_ids: ["401"], url_tags: "utm_source=meta", dry_run: true, connection_id: world.connectionId });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("DISABLED_BY_LUMIN_POLICY");
      expect(world.requests).toEqual([]);
      expect(world.writes).toEqual([]);
    } finally { await s.close(); }
  });
});

describe("tools/list in a strict read-only agency deployment", () => {
  it("advertises exactly the ten preparation and observation tools without readOnlyHint, none of which can write to Meta", async () => {
    stubDeployment("readonly");
    const s = await session("100");
    try {
      const listed = (await s.client.listTools()).tools;
      expect(listed.filter(t => t.annotations?.readOnlyHint !== true).map(t => t.name).sort()).toEqual([
        "meta_discover_ad_assets", "meta_discover_signal_assets", "meta_lookup_ad_targeting", "meta_observe_account_owner", "meta_observe_ads_compatibility",
        "meta_plan_ad_tracking_change", "meta_plan_paused_ads", "meta_prepare_action", "meta_prepare_app_promotion_access", "meta_prepare_publication",
      ]);
    } finally { await s.close(); }
  });
});
