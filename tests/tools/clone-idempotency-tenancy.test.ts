import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestContext } from "../../src/auth/token-store.js";
import { metaApiClient } from "../../src/meta/client.js";
import { getCloneBundleStore, resetCloneBundleStoreForTests } from "../../src/store/clone-bundle-store.js";
import { registerAdSetTools } from "../../src/tools/adsets.js";
import { cleanupTestToken, createMockMcpServer, mockFetchResponse, setupTestToken } from "../setup.js";

const sourceAdSet = {
  id: "2099", name: "Source", campaign_id: "1001", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "500",
  optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", targeting: { geo_locations: { countries: ["CL"] } },
  destination_type: "WEBSITE",
};
const oneAd = {
  data: [{
    id: "3001", name: "Source__a1", adset_id: "2099", campaign_id: "1001", status: "ACTIVE", effective_status: "ACTIVE",
    creative: { id: "4001" }, created_time: "2026-01-01T00:00:00-0000", updated_time: "2026-01-01T00:00:00-0000",
  }],
};

function queueClone(adSetId: string, adId: string): void {
  const fetcher = vi.mocked(fetch);
  fetcher
    .mockResolvedValueOnce(mockFetchResponse(sourceAdSet))
    .mockResolvedValueOnce(mockFetchResponse(oneAd))
    .mockResolvedValueOnce(mockFetchResponse({ id: adSetId }))
    .mockResolvedValueOnce(mockFetchResponse({ copied_ad_id: adId }))
    .mockResolvedValueOnce(mockFetchResponse({ success: true }));
}

const server = createMockMcpServer();
registerAdSetTools(server as never);
const tool = server._registeredTools.find((t: { name: string }) => t.name === "ads_clone_ad_set_bundle")!;

const args = (overrides: Record<string, unknown> = {}) => ({
  account_id: "act_123",
  source_ad_set_id: "2099",
  target_ad_set: { name: "Target", geo_override: { countries: ["CO"] }, status: "PAUSED" },
  creative_overrides: [],
  dry_run: false,
  idempotency_key: "launch-1",
  ...overrides,
});

type Out = { content: Array<{ type: string; text: string }> };
const cloneAs = (fbUserId: string, input: Record<string, unknown>) =>
  requestContext.run({ accessToken: `synthetic-token-${fbUserId}`, fbUserId }, () => tool.handler(input) as Promise<Out>);
const textOf = (out: Out) => out.content.map((c) => c.text).join("\n");

describe("ads_clone_ad_set_bundle idempotency is per tenant", () => {
  beforeEach(() => {
    setupTestToken();
    metaApiClient.resetForTests();
    resetCloneBundleStoreForTests();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanupTestToken();
    metaApiClient.resetForTests();
    resetCloneBundleStoreForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not hand tenant A's stored result to tenant B, which clones for itself", async () => {
    queueClone("A-ADSET-20001", "A-AD-30001");
    const a = await cloneAs("A", args());
    expect(textOf(a)).toContain("A-ADSET-20001");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);

    queueClone("B-ADSET-20009", "B-AD-30009");
    const b = await cloneAs("B", args());
    expect(textOf(b)).not.toContain("reused cached result");
    expect(textOf(b)).not.toContain("A-ADSET-20001");
    expect(textOf(b)).not.toContain("A-AD-30001");
    expect(textOf(b)).toContain("B-ADSET-20009");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(10);
  });

  it("still returns a tenant its own stored result for the same key", async () => {
    queueClone("A-ADSET-20001", "A-AD-30001");
    await cloneAs("A", args());
    queueClone("B-ADSET-20009", "B-AD-30009");
    await cloneAs("B", args());

    const again = await cloneAs("A", args());
    expect(textOf(again)).toContain("reused cached result");
    expect(textOf(again)).toContain("A-ADSET-20001");
    expect(textOf(again)).not.toContain("B-ADSET-20009");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(10);
  });

  it("gives another tenant no way to learn that a key exists: a different payload under the same key is just a new clone", async () => {
    queueClone("A-ADSET-20001", "A-AD-30001");
    await cloneAs("A", args());

    queueClone("B-ADSET-20009", "B-AD-30009");
    const b = await cloneAs("B", args({ target_ad_set: { name: "Target", geo_override: { countries: ["MX"] }, status: "PAUSED" } }));
    expect(textOf(b)).not.toMatch(/already exists for a different/);
    expect(textOf(b)).toContain("B-ADSET-20009");
  });

  it("does not let a tenant squat a key another tenant has not used yet", async () => {
    queueClone("B-ADSET-20009", "B-AD-30009");
    await cloneAs("B", args());

    queueClone("A-ADSET-20001", "A-AD-30001");
    const a = await cloneAs("A", args());
    expect(textOf(a)).not.toContain("reused cached result");
    expect(textOf(a)).toContain("A-ADSET-20001");
  });

  it("keeps a tenant's in-progress lock from blocking another tenant", async () => {
    const store = getCloneBundleStore();
    await store.claim("A:launch-1:act_123:2099:Target", "whatever");

    queueClone("B-ADSET-20009", "B-AD-30009");
    const b = await cloneAs("B", args());
    expect(textOf(b)).toContain("B-ADSET-20009");
  });

  it("stores records under the tenant id", async () => {
    queueClone("A-ADSET-20001", "A-AD-30001");
    await cloneAs("A", args());
    const store = getCloneBundleStore();
    expect((await store.getDoc("A:launch-1:act_123:2099:Target"))?.state).toBe("completed");
    expect(await store.getDoc("launch-1:act_123:2099:Target")).toBeUndefined();
  });

  it("fails closed in multi-tenant mode for a caller with no tenant identity, before any Graph call", async () => {
    vi.stubEnv("META_APP_ID", "synthetic-app-id");
    vi.stubEnv("META_APP_SECRET", "synthetic-app-secret-not-real");
    await expect(tool.handler(args())).rejects.toThrow(/clone tools need an authenticated user/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("does not need an identity for a dry run or a clone without a key", async () => {
    vi.stubEnv("META_APP_ID", "synthetic-app-id");
    vi.stubEnv("META_APP_SECRET", "synthetic-app-secret-not-real");
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockFetchResponse(sourceAdSet))
      .mockResolvedValueOnce(mockFetchResponse(oneAd));
    await expect(tool.handler(args({ dry_run: true, idempotency_key: undefined }))).resolves.toBeDefined();

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockFetchResponse(sourceAdSet))
      .mockResolvedValueOnce(mockFetchResponse(oneAd));
    await expect(tool.handler(args({ dry_run: true }))).resolves.toBeDefined();
  });
});
