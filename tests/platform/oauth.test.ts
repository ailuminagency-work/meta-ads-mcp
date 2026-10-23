import {logger} from "../../src/utils/logger.js";
import {PlatformDenied} from "../../src/platform/models.js";
import express from "express";
import { request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { InMemoryConnectionChallengeStore } from "../../src/platform/connection-challenge-store.js";
import { PlatformOAuthService, ImmutableOAuthProfileRegistry, atomicConnectionEnrollment, type InspectedOAuthToken, type TrustedOAuthProfile, type VerifiedProviderAdapter } from "../../src/platform/oauth.js";
import { createPlatformOAuthRouter } from "../../src/platform/oauth-router.js";

const profile: TrustedOAuthProfile = { id: "pages-fixture", provider: "META_FACEBOOK_PAGES", appId: "3001", strategy: "facebook_business", scopes: ["pages_show_list","pages_read_engagement"], tokenTypes: ["page"], redirectUri: "https://fixture.invalid/platform/oauth/pages-fixture/callback", authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth", configurationId: "4001", verified: true, secretReference: "fixture-secret-reference", capabilities: ["pages.list.feed"], actions: ["READ"], requiredTasks: ["ANALYZE"] };
const inspected: InspectedOAuthToken = { pageInspection:{accessToken:"synthetic-inspection-user",appId:profile.appId,userSubjectId:"1001",grantedScopes:[...profile.scopes],expiresAt:Date.now()+7200000},accessToken: "synthetic-private-token", provider: profile.provider, appId: profile.appId, subjectId: "2001", tokenType: "page", grantedScopes: [...profile.scopes], expiresAt: Date.now() + 3600000, assets: [{ type: "PAGE", id: "2001", tasks: ["ANALYZE"] }] };
let server: Server | undefined;
beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("hex")));
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

it.each(["valid","unsafe-link","unavailable-link"])("renders safe browser completion without changing successful OAuth when next step is %s",async mode=>{const {service}=await fixture(),app=express();app.use("/platform/oauth",createPlatformOAuthRouter({service,publicOrigin:"https://fixture.invalid",getSessionOperator:async()=>"1001",getNextSteps:async()=>{if(mode==="unavailable-link")throw Error("internal dependency unavailable");return [{label:"Review client business ownership",path:mode==="unsafe-link"?"https://foreign.invalid/":"/platform/business-owner/client-fixture/700/source-connection"}];}}));server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server!.once("listening",r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/platform/oauth/${profile.id}`,started=await fetch(base+"/start",{method:"POST",redirect:"manual",headers:{origin:"https://fixture.invalid","content-type":"application/json"},body:JSON.stringify({client_id:"client-fixture"})}),state=new URL(started.headers.get("location")!).searchParams.get("state")!,response=await fetch(`${base}/callback?state=${state}&code=fixture`,{headers:{cookie:started.headers.get("set-cookie")!.split(";")[0],accept:"text/html"}}),html=await response.text();expect(response.status).toBe(200);expect(response.headers.get("content-type")).toContain("text/html");expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");expect(html).toContain("Client product connected");expect(html).toContain("does not verify client ownership or billing");expect(html).not.toContain("foreign.invalid");expect(html).not.toContain("internal dependency");expect(html.includes('href="/platform/business-owner/')).toBe(mode==="valid");});

it.each(["FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED","synthetic-private-provider-secret"])("logs safe provider category before generic callback wrapping: %s",async reason=>{
 const warn=vi.spyOn(logger,"warn").mockImplementation(()=>{});
 try{const {service,exchange,callback,repo}=await fixture();exchange.mockRejectedValue(new PlatformDenied(reason));const started=await service.start("1001","client-fixture",profile.id);
 await expect(callback(started.state,started.browserNonce)).rejects.toThrow("OAUTH_PROVIDER_EXCHANGE_OR_INSPECTION_FAILED");
 expect(warn).toHaveBeenCalledWith({event:"platform_oauth_failure",stage:"provider_exchange",reason:reason==="FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED"?reason:"UNEXPECTED_INTERNAL_FAILURE"},"Platform OAuth failed");
 expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-private");expect(await repo.list("connections","tenant-fixture")).toHaveLength(0);
 }finally{warn.mockRestore();}
});
