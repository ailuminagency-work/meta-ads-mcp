import {logger} from "../../src/utils/logger.js";
import {PlatformDenied} from "../../src/platform/models.js";
import express from "express";
import { request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { InMemoryConnectionChallengeStore } from "../../src/platform/connection-challenge-store.js";
import { PlatformOAuthService, ImmutableOAuthProfileRegistry, OAuthAssetSelectionRequired, atomicConnectionEnrollment, type InspectedOAuthToken, type TrustedOAuthProfile, type VerifiedProviderAdapter } from "../../src/platform/oauth.js";
import { createPlatformOAuthRouter } from "../../src/platform/oauth-router.js";
import { resetKeyCacheForTests } from "../../src/auth/crypto.js";
import { assetKey } from "../../src/platform/assets.js";

const profile: TrustedOAuthProfile = { id: "pages-fixture", provider: "META_FACEBOOK_PAGES", appId: "3001", strategy: "facebook_business", scopes: ["pages_show_list","pages_read_engagement"], tokenTypes: ["page"], redirectUri: "https://fixture.invalid/platform/oauth/pages-fixture/callback", authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth", configurationId: "4001", verified: true, secretReference: "fixture-secret-reference", capabilities: ["pages.list.feed"], actions: ["READ"], requiredTasks: ["ANALYZE"] };
const inspected: InspectedOAuthToken = { pageInspection:{accessToken:"synthetic-inspection-user",appId:profile.appId,userSubjectId:"1001",grantedScopes:[...profile.scopes],expiresAt:Date.now()+7200000},accessToken: "synthetic-private-token", provider: profile.provider, appId: profile.appId, subjectId: "2001", tokenType: "page", grantedScopes: [...profile.scopes], expiresAt: Date.now() + 3600000, assets: [{ type: "PAGE", id: "2001", tasks: ["ANALYZE"] }] };
let server: Server | undefined;
  beforeEach(() => { resetKeyCacheForTests(); vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("hex")); vi.stubEnv("OAUTH_SECRET", Buffer.alloc(32, 4).toString("hex")); });
afterEach(async () => { vi.unstubAllEnvs(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });

async function fixture(change: Partial<InspectedOAuthToken> = {}, verified = true, atomic = true) {
  const repo = new InMemoryPlatformRepository(), now = Date.now();
  await repo.put("operatorIndex", "_index", "1001", { operatorId: "1001", tenantId: "tenant-fixture" });
  await repo.put("tenants", "tenant-fixture", "tenant-fixture", { id: "tenant-fixture", status: "ACTIVE", migrationState: "READY", registryRevision: 1, policyRevision: 1 });
  await repo.put("members", "tenant-fixture", "1001", { operatorId: "1001", tenantId: "tenant-fixture", roles: ["connection_admin"], allowedClientIds: ["client-fixture"], revision: 1, disabledAt: null });
  await repo.put("clients", "tenant-fixture", "client-fixture", { id: "client-fixture", tenantId: "tenant-fixture", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  await repo.put("assets", "tenant-fixture", "page-fixture", { id: "2001", key: "page-fixture", type: "PAGE", tenantId: "tenant-fixture", clientId: "client-fixture", provider: profile.provider, appId: profile.appId, parents: [], verifiedAt: now - 1, revokedAt: null, revision: 1 });
  const exchange = vi.fn(async () => structuredClone({ ...inspected, ...change }));
  const adapter: VerifiedProviderAdapter = { provider: profile.provider, verified, validateProfile:()=>{}, exchangeAndInspect: exchange };
  const service = new PlatformOAuthService({ repository: repo, challenges: new InMemoryConnectionChallengeStore(), profiles: new ImmutableOAuthProfileRegistry([profile]), secrets: { get: async () => "synthetic-private-app-secret" }, adapters: { get: () => adapter }, ...(atomic ? { commitVerifiedConnection: atomicConnectionEnrollment(repo) } : {}) });
  const callback = async (state: string, browserNonce: string) => service.callback({ operatorId: "1001", clientId: "client-fixture", profileId: profile.id, state, browserNonce, code: "synthetic-code" });
  return { repo, service, exchange, callback };
}

describe("protected incremental OAuth service", () => {
  it("launches the plain Meta marketing reader with its exact scopes", async () => {
    const marketing: TrustedOAuthProfile = {
      id: "meta-readonly",
      provider: "META_MARKETING",
      appId: "3002",
      strategy: "facebook_business",
      scopes: ["public_profile", "ads_read"],
      tokenTypes: ["user"],
      redirectUri: "https://fixture.invalid/platform/oauth/meta-readonly/callback",
      authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth",
      configurationId: "9902",
      verified: true,
      secretReference: "fixture-secret-reference",
      capabilities: ["legacy.ads_get_account_info"],
      actions: ["READ"],
      requiredTasks: [],
    };
    const repo = new InMemoryPlatformRepository();
    await repo.put("operatorIndex", "_index", "1002", { operatorId: "1002", tenantId: "tenant-readonly" });
    await repo.put("tenants", "tenant-readonly", "tenant-readonly", { id: "tenant-readonly", status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
    await repo.put("members", "tenant-readonly", "1002", { operatorId: "1002", tenantId: "tenant-readonly", roles: ["connection_admin"], allowedClientIds: ["client-readonly"], revision: 1, disabledAt: null });
    await repo.put("clients", "tenant-readonly", "client-readonly", { id: "client-readonly", tenantId: "tenant-readonly", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
    await repo.put("assets", "tenant-readonly", "account", { id: "101002", key: "account", type: "AD_ACCOUNT", tenantId: "tenant-readonly", clientId: "client-readonly", provider: "META_MARKETING", appId: marketing.appId, parents: [], verifiedAt: Date.now() - 1, revokedAt: null, revision: 1 });
    const service = new PlatformOAuthService({
      repository: repo,
      challenges: new InMemoryConnectionChallengeStore(),
      profiles: new ImmutableOAuthProfileRegistry([marketing]),
      secrets: { get: async () => "synthetic-private-app-secret" },
      adapters: { get: () => ({ provider: "META_MARKETING", verified: true, validateProfile: () => {}, exchangeAndInspect: async () => { throw new Error("not reached"); } }) },
      commitVerifiedConnection: atomicConnectionEnrollment(repo),
    });
    const started = await service.start("1002", "client-readonly", marketing.id);
    const url = new URL(started.authorizeUrl);
    expect(url.searchParams.get("config_id")).toBeNull();
    expect(url.searchParams.get("scope")).toBe("public_profile,ads_read");
  });

  it("allows first-time read-only discovery but never enrolls an unselected asset", async () => {
    const marketing: TrustedOAuthProfile = {
      id: "meta-discovery",
      provider: "META_MARKETING", appId: "3003", strategy: "facebook_business",
      scopes: ["public_profile", "ads_read"], tokenTypes: ["user"],
      redirectUri: "https://fixture.invalid/platform/oauth/meta-discovery/callback",
      authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth", verified: true,
      secretReference: "fixture-secret-reference", capabilities: ["legacy.ads_get_account_info"], actions: ["READ"], requiredTasks: [],
    };
    const repo = new InMemoryPlatformRepository();
    await repo.put("operatorIndex", "_index", "1003", { operatorId: "1003", tenantId: "tenant-discovery" });
    await repo.put("tenants", "tenant-discovery", "tenant-discovery", { id: "tenant-discovery", status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
    await repo.put("members", "tenant-discovery", "1003", { operatorId: "1003", tenantId: "tenant-discovery", roles: ["connection_admin"], allowedClientIds: ["client-discovery"], revision: 1, disabledAt: null });
    await repo.put("clients", "tenant-discovery", "client-discovery", { id: "client-discovery", tenantId: "tenant-discovery", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
    const inspectedDiscovery: InspectedOAuthToken = { accessToken: "synthetic-discovery-token", provider: "META_MARKETING", appId: marketing.appId, subjectId: "1003", tokenType: "user", grantedScopes: marketing.scopes, expiresAt: Date.now() + 3600000, assets: [{ type: "AD_ACCOUNT", id: "act_101003", tasks: [], name: "Amazing Ads", businessId: "114286761376026", businessName: "AmazingdecksinSeattle" }, { type: "AD_ACCOUNT", id: "101004", tasks: [], name: "Lumin Internal", businessId: "3550936491744646", businessName: "Lumin Agency LLC WA" }] };
    const exchange = vi.fn(async () => inspectedDiscovery);
    const service = new PlatformOAuthService({ repository: repo, challenges: new InMemoryConnectionChallengeStore(), profiles: new ImmutableOAuthProfileRegistry([marketing]), secrets: { get: async () => "synthetic-private-app-secret" }, adapters: { get: () => ({ provider: "META_MARKETING" as const, verified: true, validateProfile: () => {}, exchangeAndInspect: exchange }) }, commitVerifiedConnection: atomicConnectionEnrollment(repo) });
    const started = await service.start("1003", "client-discovery", marketing.id);
    await expect(service.callback({ operatorId: "1003", clientId: "client-discovery", profileId: marketing.id, ...started, code: "synthetic-code" })).rejects.toThrow("OAUTH_ASSET_SELECTION_REQUIRED");
    expect(exchange).toHaveBeenCalledOnce();
    expect(await repo.list("connections", "tenant-discovery")).toHaveLength(0);
    expect(await repo.list("credentials", "tenant-discovery")).toHaveLength(0);
    expect(await repo.list("assets", "tenant-discovery")).toHaveLength(0);
    const proposals = await repo.list("discoveryProposals", "tenant-discovery");
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0] as { id: string; consumedAt: number | null; assets: Array<{ id: string }> };
    expect(proposal.consumedAt).toBeNull();
    expect(proposal.assets.map(asset => asset.id)).toEqual(["101003", "101004"]);
    expect(proposal.assets[0]).toMatchObject({ name: "Amazing Ads", businessId: "114286761376026", businessName: "AmazingdecksinSeattle" });
    const enrolled = await service.enrollDiscoveredAsset("1003", proposal.id, "101003");
    expect(enrolled.assetCount).toBe(1);
    expect(await repo.list("connections", "tenant-discovery")).toHaveLength(1);
    expect(await repo.list("credentials", "tenant-discovery")).toHaveLength(1);
    expect(await repo.list("assets", "tenant-discovery")).toHaveLength(1);
    expect((await repo.get("assets", "tenant-discovery", assetKey("META_MARKETING", marketing.appId, { type: "AD_ACCOUNT", id: "101003" })))?.id).toBe("101003");
    expect(await repo.get("assets", "tenant-discovery", assetKey("META_MARKETING", marketing.appId, { type: "AD_ACCOUNT", id: "101004" }))).toBeNull();
    expect((await repo.get("discoveryProposals", "tenant-discovery", proposal.id) as { consumedAt: number | null }).consumedAt).toEqual(expect.any(Number));
    await expect(service.enrollDiscoveredAsset("1003", proposal.id, "101003")).rejects.toThrow("OAUTH_DISCOVERY_PROPOSAL_UNAVAILABLE");
  });

  it("auto-enrolls the only discovered account without weakening client binding", async () => {
    const marketing: TrustedOAuthProfile = { id: "meta-single-discovery", provider: "META_MARKETING", appId: "3004", strategy: "facebook_business", scopes: ["public_profile", "ads_read"], tokenTypes: ["user"], redirectUri: "https://fixture.invalid/platform/oauth/meta-single-discovery/callback", authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth", verified: true, secretReference: "fixture-secret-reference", capabilities: ["legacy.ads_get_account_info"], actions: ["READ"], requiredTasks: [] };
    const repo = new InMemoryPlatformRepository();
    await repo.put("operatorIndex", "_index", "1004", { operatorId: "1004", tenantId: "tenant-single" });
    await repo.put("tenants", "tenant-single", "tenant-single", { id: "tenant-single", status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
    await repo.put("members", "tenant-single", "1004", { operatorId: "1004", tenantId: "tenant-single", roles: ["connection_admin"], allowedClientIds: ["client-single"], revision: 1, disabledAt: null });
    await repo.put("clients", "tenant-single", "client-single", { id: "client-single", tenantId: "tenant-single", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
    // The client may have an earlier declarative root from onboarding while
    // still lacking an enrolled connection. Discovery must still inspect Meta
    // for the newly authorized target account instead of treating the old root
    // as the complete requested set.
    await repo.put("assets", "tenant-single", "declarative-root", { id: "101006", key: "declarative-root", type: "AD_ACCOUNT", tenantId: "tenant-single", clientId: "client-single", provider: "META_MARKETING", appId: marketing.appId, parents: [], verifiedAt: Date.now() - 1, revokedAt: null, revision: 1 });
    const service = new PlatformOAuthService({ repository: repo, challenges: new InMemoryConnectionChallengeStore(), profiles: new ImmutableOAuthProfileRegistry([marketing]), secrets: { get: async () => "synthetic-private-app-secret" }, adapters: { get: () => ({ provider: "META_MARKETING" as const, verified: true, validateProfile: () => {}, exchangeAndInspect: async () => ({ accessToken: "synthetic-single-token", provider: "META_MARKETING" as const, appId: marketing.appId, subjectId: "1004", tokenType: "user" as const, grantedScopes: marketing.scopes, expiresAt: Date.now() + 3600000, assets: [{ type: "AD_ACCOUNT" as const, id: "101005", tasks: [], name: "Only Account" }] }) }) }, commitVerifiedConnection: atomicConnectionEnrollment(repo) });
    const started = await service.start("1004", "client-single", marketing.id);
    const result = await service.callback({ operatorId: "1004", clientId: "client-single", profileId: marketing.id, ...started, code: "synthetic-code" });
    expect(result.assetCount).toBe(1);
    expect(result.connectionCount).toBe(1);
    expect(await repo.list("connections", "tenant-single")).toHaveLength(1);
  });

  it("performs incremental discovery when an existing connection is already enrolled", async () => {
    const marketing: TrustedOAuthProfile = { id: "meta-incremental-discovery", provider: "META_MARKETING", appId: "3005", strategy: "facebook_business", scopes: ["public_profile", "ads_read"], tokenTypes: ["user"], redirectUri: "https://fixture.invalid/platform/oauth/meta-incremental-discovery/callback", authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth", verified: true, secretReference: "fixture-secret-reference", capabilities: ["legacy.ads_get_account_info"], actions: ["READ"], requiredTasks: [] };
    const repo = new InMemoryPlatformRepository();
    await repo.put("operatorIndex", "_index", "1005", { operatorId: "1005", tenantId: "tenant-incremental" });
    await repo.put("tenants", "tenant-incremental", "tenant-incremental", { id: "tenant-incremental", status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
    await repo.put("members", "tenant-incremental", "1005", { operatorId: "1005", tenantId: "tenant-incremental", roles: ["connection_admin"], allowedClientIds: ["client-incremental"], revision: 1, disabledAt: null });
    await repo.put("clients", "tenant-incremental", "client-incremental", { id: "client-incremental", tenantId: "tenant-incremental", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
    const existing = (id: string, name: string): InspectedOAuthToken => ({ accessToken: `synthetic-${id}`, provider: "META_MARKETING", appId: marketing.appId, subjectId: "1005", tokenType: "user", grantedScopes: marketing.scopes, expiresAt: Date.now() + 3600000, assets: [{ type: "AD_ACCOUNT", id, tasks: [], name }] });
    const exchange = vi.fn().mockResolvedValueOnce(existing("101005", "Existing Account")).mockResolvedValueOnce({ ...existing("101005", "Existing Account"), accessToken: "synthetic-incremental-token", assets: [{ type: "AD_ACCOUNT", id: "101005", tasks: [], name: "Existing Account" }, { type: "AD_ACCOUNT", id: "101006", tasks: [], name: "New Account One" }, { type: "AD_ACCOUNT", id: "101007", tasks: [], name: "New Account Two" }] });
    const service = new PlatformOAuthService({ repository: repo, challenges: new InMemoryConnectionChallengeStore(), profiles: new ImmutableOAuthProfileRegistry([marketing]), secrets: { get: async () => "synthetic-private-app-secret" }, adapters: { get: () => ({ provider: "META_MARKETING" as const, verified: true, validateProfile: () => {}, exchangeAndInspect: exchange }) }, commitVerifiedConnection: atomicConnectionEnrollment(repo) });

    const first = await service.start("1005", "client-incremental", marketing.id);
    await service.callback({ operatorId: "1005", clientId: "client-incremental", profileId: marketing.id, ...first, code: "first-code" });
    expect(await repo.list("connections", "tenant-incremental")).toHaveLength(1);

    const second = await service.start("1005", "client-incremental", marketing.id);
    await expect(service.callback({ operatorId: "1005", clientId: "client-incremental", profileId: marketing.id, ...second, code: "second-code" })).rejects.toThrow("OAUTH_ASSET_SELECTION_REQUIRED");
    expect(exchange).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestedAssets: [] }));
    const proposals = await repo.list("discoveryProposals", "tenant-incremental");
    const proposal = proposals.find(candidate => (candidate as { consumedAt: number | null }).consumedAt === null) as { assets: Array<{ id: string }> };
    expect(proposal.assets.map(asset => asset.id)).toEqual(["101006", "101007"]);
    expect(await repo.get("assets", "tenant-incremental", assetKey("META_MARKETING", marketing.appId, { type: "AD_ACCOUNT", id: "101005" }))).toBeTruthy();
    expect(await repo.list("connections", "tenant-incremental")).toHaveLength(1);
  });

  it("uses config-specific permissions and atomically installs encrypted credentials with audit", async () => {
    const { repo, service, callback } = await fixture();
    const start = await service.start("1001", "client-fixture", profile.id);
    const url = new URL(start.authorizeUrl);
    expect(url.searchParams.get("config_id")).toBe("4001");
    expect(url.searchParams.has("scope")).toBe(false);
    const result = await callback(start.state, start.browserNonce);
    expect(result.assetCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
    expect(await repo.list("connections", "tenant-fixture")).toHaveLength(1);
    expect(await repo.list("grants", "tenant-fixture")).toHaveLength(1);
    expect(await repo.list("controlAudit", "tenant-fixture")).toHaveLength(1);
    expect(JSON.stringify(await repo.list("credentials", "tenant-fixture"))).not.toContain(inspected.accessToken);
    await expect(callback(start.state, start.browserNonce)).rejects.toThrow("REPLAYED");
  });
  it.each([{ appId: "foreign" }, { provider: "META_THREADS" }, { subjectId: "9999" }, { tokenType: "user" }, { grantedScopes: ["pages_read_engagement", "pages_manage_posts"] }, { expiresAt: NaN }, { assets: [{ type: "PAGE", id: "foreign", tasks: ["ANALYZE"] }] }, { assets: [{ type: "PAGE", id: "2001", tasks: [] }] }])("rejects actual token or asset mismatch %j", async change => {
    const { repo, service, callback } = await fixture(change as Partial<InspectedOAuthToken>);
    const start = await service.start("1001", "client-fixture", profile.id);
    await expect(callback(start.state, start.browserNonce)).rejects.toThrow();
    expect(await repo.list("connections", "tenant-fixture")).toHaveLength(0);
    expect(await repo.list("credentials", "tenant-fixture")).toHaveLength(0);
  });
  it("refuses unverified adapters and absent atomic enrollment before issuing state", async () => {
    await expect((await fixture({}, false)).service.start("1001", "client-fixture", profile.id)).rejects.toThrow("UNVERIFIED_HOLD");
    await expect((await fixture({}, true, false)).service.start("1001", "client-fixture", profile.id)).rejects.toThrow("UNAVAILABLE_HOLD");
  });
  it("refuses cross-client initiation and invalid callback nonce without exchanging code", async () => {
    const { service, exchange, callback } = await fixture();
    await expect(service.start("1001", "foreign-client", profile.id)).rejects.toThrow("CLIENT_CONNECTION_ADMIN_REQUIRED");
    const start = await service.start("1001", "client-fixture", profile.id);
    await expect(callback(start.state, "f".repeat(64))).rejects.toThrow("MISMATCHED");
    expect(exchange).not.toHaveBeenCalled();
  });
  it("rechecks registry inside atomic commit and never writes partial credentials", async () => {
    const { repo, service, exchange, callback } = await fixture();
    const original = repo.commitControlPlane.bind(repo);
    repo.commitControlPlane = async input => {
      const asset = (await repo.get("assets", "tenant-fixture", "page-fixture"))!;
      await repo.put("assets", "tenant-fixture", "page-fixture", { ...asset, clientId: "foreign-client", revision: 2 });
      await original(input);
    };
    const start = await service.start("1001", "client-fixture", profile.id);
    await expect(callback(start.state, start.browserNonce)).rejects.toThrow("CONTROL_AUTHORIZATION_CHANGED");
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(await repo.list("credentials", "tenant-fixture")).toHaveLength(0);
    expect(await repo.list("connections", "tenant-fixture")).toHaveLength(0);
  });
  it("allows only one concurrent callback to exchange its code", async () => {
    const { service, exchange, callback } = await fixture();
    const start = await service.start("1001", "client-fixture", profile.id);
    const results = await Promise.allSettled([callback(start.state, start.browserNonce), callback(start.state, start.browserNonce)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(exchange).toHaveBeenCalledTimes(1);
  });
  it("rejects membership revocation during exchange without persistence", async () => {
    const { repo, service, exchange, callback } = await fixture();
    exchange.mockImplementationOnce(async () => {
      const member = (await repo.get("members", "tenant-fixture", "1001"))!;
      await repo.put("members", "tenant-fixture", "1001", { ...member, disabledAt: Date.now(), revision: 2 });
      return structuredClone(inspected);
    });
    const start = await service.start("1001", "client-fixture", profile.id);
    await expect(callback(start.state, start.browserNonce)).rejects.toThrow();
    expect(await repo.list("credentials", "tenant-fixture")).toHaveLength(0);
  });
});

it("authenticates from verified session only, guards start origin and binds secure state cookies", async () => {
  const { service } = await fixture();
  let operator: string | null = null;
  const app = express();
  app.use("/platform/oauth", createPlatformOAuthRouter({ service, publicOrigin: "https://fixture.invalid", getSessionOperator: async () => operator }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/platform/oauth/${profile.id}`;
  const request = { method: "POST", redirect: "manual" as const, headers: { "content-type": "application/json", origin: "https://fixture.invalid", "x-operator-id": "1001" }, body: JSON.stringify({ client_id: "client-fixture" }) };
  expect((await fetch(base + "/start", request)).status).toBe(401);
  operator = "1001";
  expect((await fetch(base + "/start", { ...request, headers: { ...request.headers, origin: "https://foreign.invalid" } })).status).toBe(403);
  const browserHeaders = { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
  const browserBody = "client_id=client-fixture";
  expect((await fetch(base + "/start", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: browserBody })).status).toBe(403);
  expect((await fetch(base + "/start", { method: "POST", redirect: "manual", headers: { ...browserHeaders, "sec-fetch-site": "cross-site" }, body: browserBody })).status).toBe(403);
  expect((await fetch(base + "/start", { method: "POST", redirect: "manual", headers: { ...browserHeaders, origin: "https://foreign.invalid" }, body: browserBody })).status).toBe(403);
  expect((await fetch(base + "/start", { method: "POST", redirect: "manual", headers: { ...browserHeaders, origin: "https://fixture.invalid", "sec-fetch-site": "cross-site" }, body: browserBody })).status).toBe(403);
  const browserStatus = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(base + "/start", { method: "POST", headers: browserHeaders }, res => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
    req.on("error", reject);
    req.end(browserBody);
  });
  expect(browserStatus).toBe(303);
  const started = await fetch(base + "/start", request);
  expect(started.status).toBe(303);
  const cookie = started.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Path=/");
  const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
  expect((await fetch(`${base}/callback?state=${state}&code=fixture`)).status).toBe(403);
  const connected = await fetch(`${base}/callback?state=${state}&code=fixture`, { headers: { cookie: cookie.split(";")[0] } });
  expect(connected.status).toBe(200);
  expect((await connected.json()).status).toBe("CONNECTED");
  expect(connected.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
});

it("posts asset selection back through the mounted platform OAuth route", async () => {
  const state = "a".repeat(64);
  const nonce = "b".repeat(64);
  const app = express();
  app.use("/platform/oauth", createPlatformOAuthRouter({
    publicOrigin: "https://fixture.invalid",
    getSessionOperator: async () => "1001",
    service: {
      callback: async () => {
        throw new OAuthAssetSelectionRequired("proposal-1", [{ type: "AD_ACCOUNT", id: "101003" }]);
      },
      enrollDiscoveredAsset: async () => ({ connectionId: "connection-1", assetCount: 1, provider: "META_MARKETING" }),
    } as unknown as PlatformOAuthService,
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not start");
  const cookie = Buffer.from(JSON.stringify({ clientId: "client-fixture", nonce })).toString("base64url");
  const response = await fetch(`http://127.0.0.1:${address.port}/platform/oauth/pages-fixture/callback?state=${state}&code=fixture`, {
    headers: {
      cookie: `__Host-lumin-connect-${state}=${cookie}`,
      accept: "text/html",
    },
  });
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('action="/platform/oauth/pages-fixture/select"');
  expect(html).not.toContain('action="/pages-fixture/select"');
});

it("accepts the signed selection ticket when browser fetch headers or selection cookies are absent", async () => {
  const state = "c".repeat(64);
  const nonce = "d".repeat(64);
  const app = express();
  app.use("/platform/oauth", createPlatformOAuthRouter({
    publicOrigin: "https://fixture.invalid",
    getSessionOperator: async () => "1001",
    service: {
      callback: async () => { throw new OAuthAssetSelectionRequired("proposal-2", [{ type: "AD_ACCOUNT", id: "101004", tasks: [], name: "Lumin Ads", businessName: "Lumin Agency LLC WA" }]); },
      enrollDiscoveredAsset: async () => ({ connectionId: "connection-2", assetCount: 1, provider: "META_MARKETING" }),
    } as unknown as PlatformOAuthService,
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not start");
  const connectCookie = Buffer.from(JSON.stringify({ clientId: "client-fixture", nonce })).toString("base64url");
  const callback = await fetch(`http://127.0.0.1:${address.port}/platform/oauth/pages-fixture/callback?state=${state}&code=fixture`, { headers: { cookie: `__Host-lumin-connect-${state}=${connectCookie}`, accept: "text/html" } });
  const html = await callback.text();
  const ticket = html.match(/name="selection_ticket" value="([^"]+)"/)?.[1];
  expect(ticket).toBeTruthy();
  expect(html).toContain("Lumin Ads");
  const response = await fetch(`http://127.0.0.1:${address.port}/platform/oauth/pages-fixture/select`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" }, body: new URLSearchParams({ proposal_id: "proposal-2", asset_id: "101004", selection_ticket: ticket! }) });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Client product connected");
});

it.each(["valid","unsafe-link","unavailable-link"])("renders safe browser completion without changing successful OAuth when next step is %s",async mode=>{const {service}=await fixture(),app=express();app.use("/platform/oauth",createPlatformOAuthRouter({service,publicOrigin:"https://fixture.invalid",getSessionOperator:async()=>"1001",getNextSteps:async()=>{if(mode==="unavailable-link")throw Error("internal dependency unavailable");return [{label:"Review client business ownership",path:mode==="unsafe-link"?"https://foreign.invalid/":"/platform/business-owner/client-fixture/700/source-connection"}];}}));server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server!.once("listening",r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/platform/oauth/${profile.id}`,started=await fetch(base+"/start",{method:"POST",redirect:"manual",headers:{origin:"https://fixture.invalid","content-type":"application/json"},body:JSON.stringify({client_id:"client-fixture"})}),state=new URL(started.headers.get("location")!).searchParams.get("state")!,response=await fetch(`${base}/callback?state=${state}&code=fixture`,{headers:{cookie:started.headers.get("set-cookie")!.split(";")[0],accept:"text/html"}}),html=await response.text();expect(response.status).toBe(200);expect(response.headers.get("content-type")).toContain("text/html");expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");expect(html).toContain("Client product connected");expect(html).toContain("does not verify client ownership or billing");expect(html).not.toContain("foreign.invalid");expect(html).not.toContain("internal dependency");expect(html.includes('href="/platform/business-owner/')).toBe(mode==="valid");});

it.each(["FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED","synthetic-private-provider-secret"])("logs safe provider category before generic callback wrapping: %s",async reason=>{
 const warn=vi.spyOn(logger,"warn").mockImplementation(()=>{});
 try{const {service,exchange,callback,repo}=await fixture();exchange.mockRejectedValue(new PlatformDenied(reason));const started=await service.start("1001","client-fixture",profile.id);
 await expect(callback(started.state,started.browserNonce)).rejects.toThrow("OAUTH_PROVIDER_EXCHANGE_OR_INSPECTION_FAILED");
 expect(warn).toHaveBeenCalledWith({event:"platform_oauth_failure",stage:"provider_exchange",reason:reason==="FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED"?reason:"UNEXPECTED_INTERNAL_FAILURE"},"Platform OAuth failed");
 expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-private");expect(await repo.list("connections","tenant-fixture")).toHaveLength(0);
 }finally{warn.mockRestore();}
});

