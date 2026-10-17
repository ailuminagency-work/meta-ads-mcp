import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import express from "express";
import {createMediaIngressRouter,mediaIngressSignature,type MediaIngressProfile} from "../../src/platform/media-ingress.js";
import {MediaEnrollmentService} from "../../src/platform/media-enrollment-service.js";
import {createMediaEnrollmentRouter} from "../../src/platform/media-enrollment-router.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jpeg from "jpeg-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import { issueHumanApproval } from "../../src/platform/approvals.js";
import { encryptCredential } from "../../src/platform/connections.js";
import { productMediaDigest } from "../../src/platform/product-media.js";
import type { MetaAsset, Provider } from "../../src/platform/models.js";
const bytes = Uint8Array.from(jpeg.encode({ width: 320, height: 320, data: Buffer.alloc(320 * 320 * 4, 128) }, 50).data);
const digest = productMediaDigest(bytes), mediaUrl = `https://assets.example.com/${digest}.jpg`;
const decode = (result: { content?: unknown }): Record<string, unknown> => JSON.parse((result.content as Array<{ text: string }>)[0].text);
beforeEach(() => { for (const [key, value] of Object.entries({ DEPLOYMENT_MODE: "legacy", LUMIN_PLATFORM_ENABLED: "true", LUMIN_PLATFORM_WRITES_ENABLED: "true", AGENCY_WRITES_ENABLED: "true", TOKEN_ENCRYPTION_KEY: "e".repeat(64), INSTAGRAM_API_VERSION: "v26.0" })) vi.stubEnv(key, value); });
afterEach(() => { configurePlatformRepository(undefined); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function fixture(provider: Provider, mode = "success") {
  const login = provider === "META_INSTAGRAM_LOGIN";
  const tools = login ? ["instagram_login_create_container", "instagram_login_get_container_status", "instagram_login_publish"] : ["instagram_create_container", "instagram_get_container_status", "instagram_publish_container"];
  const contracts = PRODUCT_CONTRACTS.filter(c => tools.includes(c.tool));
  const repo = new InMemoryPlatformRepository(), now = Date.now(); configurePlatformRepository(repo);
  await repo.put("tenants", "tenant", "tenant", { id: "tenant", status: "ACTIVE", migrationState: "READY", registryRevision: 1, policyRevision: 1 });
  for (const [operator, roles] of [["actor", ["writer", "reader", "admin"]], ["human", ["approver"]]] as const) {
    await repo.put("members", "tenant", operator, { operatorId: operator, tenantId: "tenant", roles: [...roles], allowedClientIds: ["client"], revision: 1, disabledAt: null });
    await repo.put("operatorIndex", "_index", operator, { operatorId: operator, tenantId: "tenant" });
  }
  await repo.put("clients", "tenant", "client", { id: "client", tenantId: "tenant", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  const account: MetaAsset = { key: "account", id: "101", type: "INSTAGRAM_ACCOUNT", provider, appId: "300", tenantId: "tenant", clientId: "client", parents: login ? [] : [{ type: "PAGE", id: "202" }], verifiedAt: now, revokedAt: null, revision: 1 };
  const page: MetaAsset = { ...account, key: "page", id: "202", type: "PAGE", parents: [] };
  const assets = [account, ...(login ? [] : [page])];
  for (const asset of assets) await repo.put("assets", "tenant", asset.key, asset);
  await repo.put("connections", "tenant", "connection", { id: "connection", tenantId: "tenant", operatorId: "actor", provider, appId: "300", credentialId: "credential", subjectId: login ? "101" : "999", tokenType: login ? "instagram" : "user", ...(login?{metaAppUserId:"901"}:{}), authStrategy: "fixture", scopes: [...new Set(contracts.flatMap(c => c.requiredScopes))], assetKeys: assets.map(a => a.key), expiresAt: now + 3600000, revokedAt: null, verifiedAt: now, revision: 1, eligibility: [...new Set(contracts.flatMap(c => c.manualRequirements))].map(requirement => ({ requirement, source: "https://developers.facebook.com/documentation/instagram-platform/content-publishing", verified: true, checkedAt: now, expiresAt: now + 300000 })) });
  for (const asset of assets) await repo.put("grants", "tenant", `grant-${asset.key}`, { id: `grant-${asset.key}`, tenantId: "tenant", clientId: "client", assetKey: asset.key, connectionId: "connection", capabilities: contracts.map(c => c.id), actions: ["READ", "WRITE_CONTENT"], tasks: asset.type === "PAGE" ? ["CREATE_CONTENT"] : [], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1 });
  await repo.put("credentials", "tenant", "credential", encryptCredential({ id: "credential", tenantId: "tenant", operatorId: "actor", provider, appId: "300", keyVersion: "primary" }, "synthetic-instagram-publisher"));
  await establishManualEligibilityFixture(repo,"tenant","client","connection");
  const service=new MediaEnrollmentService(repo),profile:MediaIngressProfile={id:"adapter",tenantId:"tenant",clientId:"client",operatorId:"actor",connectionId:"connection",accountId:"101",appId:"300",provider:provider as "META_INSTAGRAM_LOGIN"|"META_INSTAGRAM_FACEBOOK_LOGIN",secretReference:"LUMIN_MEDIA_INGRESS_KEY_TEST",allowedHost:"assets.example.com",enabled:true},app=express(),ingressKey="b".repeat(64),origin="https://fixture.invalid";
  app.use("/ingress",createMediaIngressRouter({profiles:[profile],service,secret:async()=>ingressKey}));app.use("/review",createMediaEnrollmentRouter({origin,csrfSecret:"synthetic-review-secret".repeat(2),service,resolveSession:async req=>req.get("x-human")==="actor"?{operatorId:"actor",tenantId:"tenant"}:null}));
  const http=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>http.once("listening",resolve));const address=http.address();if(!address||typeof address==="string")throw new Error();const local=`http://127.0.0.1:${address.port}`;
  let source:MetaAsset;
  try{const checkedAt=Date.now(),timestamp=String(checkedAt),raw=Buffer.from(JSON.stringify({jpeg_base64:Buffer.from(bytes).toString("base64"),url:mediaUrl,ai_generated:false,immutable:true,rights:{granted:true,purpose:"instagram_content_publishing",checked_at:checkedAt,expires_at:checkedAt+299000}})),ingress=await fetch(`${local}/ingress/adapter`,{method:"POST",headers:{"content-type":"application/json","x-lumin-timestamp":timestamp,"x-lumin-delivery":"native-journey","x-lumin-signature":mediaIngressSignature(raw,profile,timestamp,"native-journey",ingressKey)},body:raw});expect(ingress.status).toBe(202);const proposal=await ingress.json() as {proposalId:string;planHash:string};expect((await repo.list("assets","tenant")).some(a=>a.type==="MEDIA")).toBe(false);const review=await fetch(`${local}/review/${proposal.proposalId}`,{headers:{"x-human":"actor"}}),html=await review.text();expect(review.status).toBe(200);const csrf=html.match(/name="csrf" value="([^"]+)"/)![1],cookie=review.headers.get("set-cookie")!.split(";")[0],enrollment=await fetch(`${local}/review/${proposal.proposalId}`,{method:"POST",headers:{"x-human":"actor",origin,cookie,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf,decision:"enroll",plan_hash:proposal.planHash})});expect(enrollment.status).toBe(200);source=(await repo.list("assets","tenant")).find(a=>a.type==="MEDIA")!;expect(source.mediaEvidence?.contentDigest).toBe(digest);
  }finally{await new Promise<void>(resolve=>http.close(()=>resolve()));}
  const network: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(input)); expect(url.hostname).toBe(login ? "graph.instagram.com" : "graph.facebook.com");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer synthetic-instagram-publisher");
    network.push(`${options?.method}:${url.pathname}`);
    if (url.pathname === "/v26.0/101/media") { expect(JSON.parse(String(options?.body))).toEqual({ image_url: mediaUrl, caption: "Reviewed JPEG", is_ai_generated: false }); return new Response('{"id":"777"}'); }
    if (url.pathname === "/v26.0/777") { expect(url.searchParams.get("fields")).toBe("id,status_code"); return new Response('{"id":"777","status_code":"FINISHED"}'); }
    if (url.pathname === "/v26.0/101/content_publishing_limit") { expect(options?.method).toBe("GET"); expect(url.searchParams.get("fields")).toBe("quota_usage,config"); return new Response(JSON.stringify({ data: [{ quota_usage: mode === "quota" ? 50 : 0, config: { quota_total: 100, quota_duration: 86400 } }] })); }
    if (url.pathname === "/v26.0/101/media_publish") { expect(JSON.parse(String(options?.body))).toEqual({ creation_id: "777" }); if (mode === "unknown") throw new Error("synthetic ambiguous transport"); return new Response(JSON.stringify({ id: "888", ...(mode === "partial" ? { config_issue: "CAPTION_NOT_ATTACHED" } : {}) })); }
    throw new Error("external fixture endpoint not allowed");
  }); vi.stubGlobal("fetch", fetcher);
  return { repo, network, fetcher, tools, source };
}
const call = (client: Client, name: string, input: Record<string, unknown>) => requestContext.run({ fbUserId: "actor" }, () => client.callTool({ name, arguments: input }));
async function withClient(work: (client: Client) => Promise<void>) { const server = createServer(), client = new Client({ name: "synthetic-instagram-publication", version: "1" }), [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]); try { await work(client); } finally { await client.close(); await server.close(); } }
async function approve(client: Client, repo: InMemoryPlatformRepository, tool: string, input: Record<string, unknown>): Promise<string> { const prepared = await call(client, "meta_prepare_action", { client_id: "client", tool, asset_id: "101", input }); expect(prepared.isError, JSON.stringify(prepared.content)).not.toBe(true); return issueHumanApproval(repo, { operatorId: "human", tenantId: "tenant" }, String(decode(prepared).request_id)); }
const draftInput = { source_media_id: "source-jpeg", image_url: mediaUrl, caption: "Reviewed JPEG", is_ai_generated: false };
async function draftAndObserve(client: Client, f: Awaited<ReturnType<typeof fixture>>) {
  const input = {...draftInput,source_media_id:f.source.id}; const approval = await approve(client, f.repo, f.tools[0], input);
  const draft = await call(client, f.tools[0], { client_id: "client", asset_id: "101", input, approval_id: approval }); expect(draft.isError, JSON.stringify(draft.content)).not.toBe(true);
  expect((await f.repo.list("assets", "tenant")).find(a => a.id === "777")?.productKind).toBe("instagram_container");
  const premature = await call(client, "meta_prepare_action", { client_id: "client", tool: f.tools[2], asset_id: "101", input: { creation_id: "777" } }); expect(premature.isError).toBe(true);
  const status = await call(client, f.tools[1], { client_id: "client", asset_id: "777", input: {} }); expect(status.isError, JSON.stringify(status.content)).not.toBe(true);
}
describe("native SDK Instagram approved JPEG lifecycle", () => {
  it.each(["META_INSTAGRAM_LOGIN", "META_INSTAGRAM_FACEBOOK_LOGIN"] as Provider[])("creates draft, observes readiness, queries live quota and separately publishes %s", async provider => {
    const f = await fixture(provider); await withClient(async client => {
      await draftAndObserve(client, f); const approval = await approve(client, f.repo, f.tools[2], { creation_id: "777" });
      const result = await call(client, f.tools[2], { client_id: "client", asset_id: "101", input: { creation_id: "777" }, approval_id: approval }); expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect((await f.repo.list("assets", "tenant")).find(a => a.id === "888")?.productKind).toBe("instagram_published_media");
      expect(f.network).toEqual(["POST:/v26.0/101/media", "GET:/v26.0/777", "GET:/v26.0/101/content_publishing_limit", "POST:/v26.0/101/media_publish"]);
    });
  });
  it.each(["partial", "unknown", "quota"])("retains a one-shot claim and truthful %s outcome", async mode => {
    const f = await fixture("META_INSTAGRAM_LOGIN", mode); await withClient(async client => {
      await draftAndObserve(client, f); const approval = await approve(client, f.repo, f.tools[2], { creation_id: "777" });
      const result = await call(client, f.tools[2], { client_id: "client", asset_id: "101", input: { creation_id: "777" }, approval_id: approval });
      expect(result.isError).toBe(mode === "partial" ? undefined : true);
      expect((await f.repo.list("operations", "tenant")).map(o => o.state)).toContain(mode === "partial" ? "PARTIAL" : "UNKNOWN");
      expect((await f.repo.list("assets", "tenant")).find(a => a.id === "777")?.publicationClaim).toBeTruthy();
      expect((await f.repo.list("assets", "tenant")).some(a => a.id === "888")).toBe(mode === "partial");
      if (mode === "partial") expect(decode(result).publication_status).toBe("PARTIAL_PUBLISHED_RECONCILE_DO_NOT_RETRY");
      const retry = await call(client, "meta_prepare_action", { client_id: "client", tool: f.tools[2], asset_id: "101", input: { creation_id: "777" } }); expect(retry.isError).toBe(true);
      expect(f.network.filter(path => path.includes("media_publish"))).toHaveLength(mode === "quota" ? 0 : 1);
    });
  });
  it("rejects a false AI label before any provider request", async () => {
    const f = await fixture("META_INSTAGRAM_LOGIN"); await withClient(async client => {
      const result = await call(client, "meta_prepare_action", { client_id: "client", tool: f.tools[0], asset_id: "101", input: { ...draftInput, source_media_id:f.source.id, is_ai_generated: true } });
      expect(result.isError).toBe(true); expect(f.fetcher).not.toHaveBeenCalled();
    });
  });
});
