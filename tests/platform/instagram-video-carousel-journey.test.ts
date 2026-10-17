import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import express from "express";
import {readFileSync} from "node:fs";
import {createPublishingVideoIngressRouter as createMediaIngressRouter,publishingVideoIngressSignature as mediaIngressSignature,type PublishingVideoProfile as MediaIngressProfile} from "../../src/platform/publishing-video-ingress.js";
import {PublishingVideoEnrollmentService} from "../../src/platform/publishing-video-enrollment.js";
import {createVideoEnrollmentRouter} from "../../src/platform/video-enrollment-router.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const bytes=readFileSync(new URL("../fixtures/video/instagram-baseline-360x640-3s.mp4",import.meta.url));
const digest = productMediaDigest(bytes), mediaUrl = `https://assets.example.com/${digest}.mp4`;
const decode = (result: { content?: unknown }): Record<string, unknown> => JSON.parse((result.content as Array<{ text: string }>)[0].text);
beforeEach(() => { for (const [key, value] of Object.entries({ DEPLOYMENT_MODE: "legacy", LUMIN_PLATFORM_ENABLED: "true", LUMIN_PUBLISHING_VIDEO_ENABLED:"true", LUMIN_PLATFORM_WRITES_ENABLED: "true", AGENCY_WRITES_ENABLED: "true", TOKEN_ENCRYPTION_KEY: "e".repeat(64), INSTAGRAM_API_VERSION: "v26.0" })) vi.stubEnv(key, value); });
afterEach(() => { configurePlatformRepository(undefined); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function fixture(provider: Provider, mode = "success",kind:"reel"|"story"|"carousel_item"="reel") {
  const login = provider === "META_INSTAGRAM_LOGIN";
  const tools=[(login?"instagram_login_":"instagram_")+"create_"+(kind==="carousel_item"?kind:kind+"_container"),login?"instagram_login_get_container_status":"instagram_get_container_status",login?"instagram_login_publish":"instagram_publish_container"];
  const contracts = PRODUCT_CONTRACTS.filter(c => [...tools,login?"instagram_login_create_carousel_container":"instagram_create_carousel_container"].includes(c.tool));
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
  const service=new PublishingVideoEnrollmentService(repo),profile:MediaIngressProfile={id:"adapter",tenantId:"tenant",clientId:"client",operatorId:"actor",connectionId:"connection",accountId:"101",appId:"300",provider:provider as "META_INSTAGRAM_LOGIN"|"META_INSTAGRAM_FACEBOOK_LOGIN",purpose:"instagram_video_publishing",draftTools:[tools[0]],secretReference:"LUMIN_PUBLISHING_VIDEO_INGRESS_KEY_TEST",allowedHost:"assets.example.com",enabled:true},app=express(),ingressKey="b".repeat(64),origin="https://fixture.invalid";
  app.use("/ingress",createMediaIngressRouter({profiles:[profile],service,secret:async()=>ingressKey}));app.use("/review",createVideoEnrollmentRouter({origin,csrfSecret:"synthetic-review-secret".repeat(2),service,resolveSession:async req=>req.get("x-human")==="actor"?{operatorId:"actor",tenantId:"tenant"}:null}));
  const http=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>http.once("listening",resolve));const address=http.address();if(!address||typeof address==="string")throw new Error();const local=`http://127.0.0.1:${address.port}`;
  let source:MetaAsset;
  try{const checkedAt=Date.now(),timestamp=String(checkedAt),raw=Buffer.from(JSON.stringify({mp4_base64:Buffer.from(bytes).toString("base64"),url:mediaUrl,ai_generated:false,immutable:true,rights:{granted:true,purpose:"instagram_video_publishing",checked_at:checkedAt,expires_at:checkedAt+299000}})),ingress=await fetch(`${local}/ingress/adapter`,{method:"POST",headers:{"content-type":"application/json","x-lumin-timestamp":timestamp,"x-lumin-delivery":"native-journey","x-lumin-signature":mediaIngressSignature(raw,profile,timestamp,"native-journey",ingressKey)},body:raw});expect(ingress.status).toBe(202);const proposal=await ingress.json() as {proposalId:string;planHash:string};expect((await repo.list("assets","tenant")).some(a=>a.type==="MEDIA")).toBe(false);const review=await fetch(`${local}/review/${proposal.proposalId}`,{headers:{"x-human":"actor"}}),html=await review.text();expect(review.status).toBe(200);const csrf=html.match(/name="csrf" value="([^"]+)"/)![1],cookie=review.headers.get("set-cookie")!.split(";")[0],enrollment=await fetch(`${local}/review/${proposal.proposalId}`,{method:"POST",headers:{"x-human":"actor",origin,cookie,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf,decision:"enroll",plan_hash:proposal.planHash})});expect(enrollment.status).toBe(200);source=(await repo.list("assets","tenant")).find(a=>a.type==="MEDIA")!;expect(source.videoEvidence?.contentDigest).toBe(digest);
  }finally{await new Promise<void>(resolve=>http.close(()=>resolve()));}
  const network: string[] = [];let childCount=0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(input)); expect(url.hostname).toBe(login ? "graph.instagram.com" : "graph.facebook.com");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer synthetic-instagram-publisher");
    network.push(`${options?.method}:${url.pathname}`);
    if(url.pathname==="/v26.0/101/media"){const body=JSON.parse(String(options?.body));if(body.media_type==="CAROUSEL"){expect(body).toEqual({media_type:"CAROUSEL",children:["778","777"],caption:"Reviewed ordered carousel",is_ai_generated:false});if(mode==="unknown-parent")throw new Error("synthetic unknown parent outcome");return new Response('{"id":"779"}');}expect(body).toEqual({video_url:mediaUrl,media_type:"VIDEO",is_carousel_item:true});return new Response(JSON.stringify({id:String(777+childCount++)}));}
    if(["/v26.0/777","/v26.0/778","/v26.0/779"].includes(url.pathname)){expect(url.searchParams.get("fields")).toBe("id,status_code");return new Response(JSON.stringify({id:url.pathname.split("/").at(-1),status_code:"FINISHED"}));}
    if (url.pathname === "/v26.0/101/content_publishing_limit") { expect(options?.method).toBe("GET"); expect(url.searchParams.get("fields")).toBe("quota_usage,config"); return new Response(JSON.stringify({ data: [{ quota_usage: mode === "quota" ? 50 : 0, config: { quota_total: 100, quota_duration: 86400 } }] })); }
    if (url.pathname === "/v26.0/101/media_publish") { expect(JSON.parse(String(options?.body))).toEqual({ creation_id: "779" }); if (mode === "unknown") throw new Error("synthetic ambiguous transport"); return new Response(JSON.stringify({ id: "888", ...(mode === "partial" ? { config_issue: "CAPTION_NOT_ATTACHED" } : {}) })); }
    throw new Error("external fixture endpoint not allowed");
  }); vi.stubGlobal("fetch", fetcher);
  return { repo, network, fetcher, tools, source,kind };
}
const call = (client: Client, name: string, input: Record<string, unknown>) => requestContext.run({ fbUserId: "actor" }, () => client.callTool({ name, arguments: input }));
async function withClient(work: (client: Client) => Promise<void>) { const server = createServer(), client = new Client({ name: "synthetic-instagram-publication", version: "1" }), [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]); try { await work(client); } finally { await client.close(); await server.close(); } }
async function approve(client: Client, repo: InMemoryPlatformRepository, tool: string, input: Record<string, unknown>): Promise<string> { const prepared = await call(client, "meta_prepare_action", { client_id: "client", tool, asset_id: "101", input }); expect(prepared.isError, JSON.stringify(prepared.content)).not.toBe(true); return issueHumanApproval(repo, { operatorId: "human", tenantId: "tenant" }, String(decode(prepared).request_id)); }
describe("native Instagram ordered video carousel",()=>{
 it.each(["META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN"] as Provider[])("claims ready children and separately publishes the exact approved order %s",async provider=>{const f=await fixture(provider,"success","carousel_item");await withClient(async client=>{
  const childInput={source_media_id:f.source.id,video_url:mediaUrl,is_ai_generated:false};for(const id of ["777","778"]){const approval=await approve(client,f.repo,f.tools[0],childInput),result=await call(client,f.tools[0],{client_id:"client",asset_id:"101",input:childInput,approval_id:approval});expect(result.isError,JSON.stringify(result.content)).not.toBe(true);const status=await call(client,f.tools[1],{client_id:"client",asset_id:id,input:{}});expect(status.isError,JSON.stringify(status.content)).not.toBe(true);}
  const parentTool=provider==="META_INSTAGRAM_LOGIN"?"instagram_login_create_carousel_container":"instagram_create_carousel_container",parentInput={children:["778","777"],caption:"Reviewed ordered carousel",is_ai_generated:false},approval=await approve(client,f.repo,parentTool,parentInput),parent=await call(client,parentTool,{client_id:"client",asset_id:"101",input:parentInput,approval_id:approval});expect(parent.isError,JSON.stringify(parent.content)).not.toBe(true);
  const assets=await f.repo.list("assets","tenant"),created=assets.find(a=>a.id==="779")!;expect(created.productKind).toBe("instagram_carousel_container");for(const id of ["777","778"])expect(assets.find(a=>a.id===id)?.publicationClaim?.operationId).toBe(created.createdFromOperationId);
  const reparent=await call(client,"meta_prepare_action",{client_id:"client",tool:parentTool,asset_id:"101",input:parentInput});expect(reparent.isError).toBe(true);
  expect((await call(client,f.tools[1],{client_id:"client",asset_id:"779",input:{}})).isError).not.toBe(true);const publicationApproval=await approve(client,f.repo,f.tools[2],{creation_id:"779"}),published=await call(client,f.tools[2],{client_id:"client",asset_id:"101",input:{creation_id:"779"},approval_id:publicationApproval});expect(published.isError,JSON.stringify(published.content)).not.toBe(true);expect((await f.repo.list("assets","tenant")).find(a=>a.id==="888")?.parents).toEqual([{type:"INSTAGRAM_ACCOUNT",id:"101"}]);
 });});
 it("retains every child claim after an UNKNOWN parent receipt and prevents fresh reparent approval",async()=>{const f=await fixture("META_INSTAGRAM_LOGIN","unknown-parent","carousel_item");await withClient(async client=>{const input={source_media_id:f.source.id,video_url:mediaUrl,is_ai_generated:false};for(const id of ["777","778"]){const a=await approve(client,f.repo,f.tools[0],input);expect((await call(client,f.tools[0],{client_id:"client",asset_id:"101",input,approval_id:a})).isError).not.toBe(true);await call(client,f.tools[1],{client_id:"client",asset_id:id,input:{}});}const tool="instagram_login_create_carousel_container",parentInput={children:["778","777"],caption:"Reviewed ordered carousel",is_ai_generated:false},a=await approve(client,f.repo,tool,parentInput),result=await call(client,tool,{client_id:"client",asset_id:"101",input:parentInput,approval_id:a});expect(result.isError).toBe(true);for(const id of ["777","778"])expect((await f.repo.list("assets","tenant")).find(asset=>asset.id===id)?.publicationClaim).toBeTruthy();expect((await call(client,"meta_prepare_action",{client_id:"client",tool,asset_id:"101",input:parentInput})).isError).toBe(true);expect(f.network.filter(path=>path==="POST:/v26.0/101/media")).toHaveLength(3);});});
});
// Actual isolated decoding has bounded subprocess deadlines; allow their sum under shared CI contention.
vi.setConfig({testTimeout:90000});
