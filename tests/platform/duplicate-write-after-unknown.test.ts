import {establishFinancialFixture} from "./financial-fixture.js";
import {observeRelatedCompatibility} from "../../src/platform/compatibility-observer.js";
import {buildStrictLegacyWritePlan} from "../../src/platform/legacy-write.js";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import {stubBudgetCeilings} from "./budget-ceiling-fixture.js";
beforeEach(()=>stubBudgetCeilings());
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { createApprovalRouter } from "../../src/platform/approval-router.js";
import { encryptCredential } from "../../src/platform/connections.js";
import {inspectApprovalRequest,issueHumanApproval} from "../../src/platform/approvals.js";
const origin="https://fixture.invalid",source="https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi";
const localFetch=globalThis.fetch;
let httpServer:Server|undefined;
beforeEach(()=>{vi.stubEnv("META_APP_ID","300");vi.stubEnv("DEPLOYMENT_MODE","legacy");vi.stubEnv("LUMIN_PLATFORM_ENABLED","true");vi.stubEnv("LUMIN_MARKETING_CBO_ENABLED","true");vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED","true");vi.stubEnv("AGENCY_WRITES_ENABLED","true");vi.stubEnv("META_API_VERSION","v26.0");vi.stubEnv("TOKEN_ENCRYPTION_KEY","d".repeat(64));});
afterEach(async()=>{configurePlatformRepository(undefined);vi.unstubAllEnvs();vi.unstubAllGlobals();if(httpServer)await new Promise<void>(r=>httpServer!.close(()=>r()));httpServer=undefined;});
async function fixture(lead=false){
  const repo=new InMemoryPlatformRepository(),now=Date.now();configurePlatformRepository(repo);
  await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",migrationState:"READY",policyRevision:1,registryRevision:1});
  for(const [id,roles] of [["actor",["writer"]],["human",["approver"]]] as const){await repo.put("members","tenant",id,{operatorId:id,tenantId:"tenant",roles:[...roles],allowedClientIds:["client"],revision:1,disabledAt:null});await repo.put("operatorIndex","_index",id,{operatorId:id,tenantId:"tenant"});}
  await repo.put("clients","tenant","client",{id:"client",tenantId:"tenant",status:"ACTIVE",revision:1,verifiedBusinessIds:["900"]});
  const account={key:"account",id:"101",type:"AD_ACCOUNT" as const,provider:"META_MARKETING" as const,appId:"300",tenantId:"tenant",clientId:"client",parents:[],verifiedAt:now,revokedAt:null,revision:1,ownerBusinessId:"900",billingOwnershipVerified:true,ownershipEvidenceSource:source};await repo.put("assets","tenant","account",account);
  await repo.put("connections","tenant","connection",{id:"connection",tenantId:"tenant",operatorId:"actor",provider:"META_MARKETING",appId:"300",credentialId:"credential",tokenType:lead?"page":"user",...(lead?{subjectId:"601"}:{}),authStrategy:"fixture",scopes:["ads_management","pages_read_engagement","pages_show_list",...(lead?["pages_manage_ads","ads_read"]:[])],assetKeys:lead?["account","page"]:["account"],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1,eligibility:["marketing_write_access:v26.0",...(lead?["marketing_read_access:v26.0"]:[]),...(lead?["marketing_lead_terms_accepted:601"]:[])].map(requirement=>({requirement,source,verified:true,checkedAt:now,expiresAt:now+300000}))});
  await repo.put("grants","tenant","grant",{id:"grant",tenantId:"tenant",clientId:"client",assetKey:"account",connectionId:"connection",capabilities:["legacy.ads_create_campaign",...(lead?["legacy.ads_get_account_info","legacy.ads_get_lead_forms"]:[])],actions:["WRITE_AD_CONFIGURATION","WRITE_BUDGET",...(lead?["READ" as const]:[])],tasks:[],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1});
  if(lead){await repo.put("assets","tenant","page",{key:"page",id:"601",type:"PAGE",provider:"META_MARKETING",appId:"300",tenantId:"tenant",clientId:"client",parents:[],verifiedAt:now,revokedAt:null,revision:1});const rootGrant=(await repo.get("grants","tenant","grant"))!;await repo.put("grants","tenant","pagegrant",{...rootGrant,id:"pagegrant",assetKey:"page",tasks:["ADVERTISE"]});}
  await repo.put("credentials","tenant","credential",encryptCredential({id:"credential",tenantId:"tenant",operatorId:"actor",provider:"META_MARKETING",appId:"300",keyVersion:"primary"},"synthetic-selected-token"));
  let humanSession=false;
  const app=express();app.use(cookieParser());app.use("/platform/approvals",createApprovalRouter({repo,origin,csrfSecret:"synthetic-csrf-secret-".repeat(4),resolveSession:async()=>humanSession?{tenantId:"tenant",operatorId:"human"}:null}));httpServer=app.listen(0,"127.0.0.1");await new Promise<void>(r=>httpServer!.once("listening",r));const base=`http://127.0.0.1:${(httpServer.address() as {port:number}).port}`;
  const provider=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{if(options?.method==="GET"){const path=new URL(String(input)).pathname;return new Response(JSON.stringify(path.endsWith("/act_101")?{id:"act_101",account_id:"101"}:{id:"601"}));}expect(String(input)).toBe("https://graph.facebook.com/v26.0/act_101/campaigns");expect(options?.method).toBe("POST");expect(new Headers(options?.headers).get("authorization")).toBe("Bearer synthetic-selected-token");expect(new URLSearchParams(String(options?.body)).get("status")).toBe("PAUSED");expect(new URLSearchParams(String(options?.body)).get("daily_budget")).toBe("2000");return new Response(JSON.stringify({id:"777"}));});
  vi.stubGlobal("fetch",(input:RequestInfo|URL,options?:RequestInit)=>new URL(input instanceof Request?input.url:String(input)).hostname==="127.0.0.1"?localFetch(input,options):provider(input,options));
  await establishFinancialFixture(repo,{tenantId:"tenant",operatorId:"actor"},"client","account");
  return {repo,account:(await repo.get("assets","tenant","account"))!,provider,base,observeLead:(input:Record<string,unknown>)=>observeRelatedCompatibility(repo,{principal:{tenantId:"tenant",operatorId:"actor"},clientId:"client",provider:"META_MARKETING",tool:"ads_create_campaign",requestId:"synthetic-observation"},buildStrictLegacyWritePlan("ads_create_campaign",input),"connection",provider),signInHuman:()=>{humanSession=true;}};
}
async function withClient(work:(client:Client)=>Promise<void>){const server=createServer(),client=new Client({name:"synthetic-approval-journey",version:"1"}),[ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(st),client.connect(ct)]);try{await work(client);}finally{await client.close();await server.close();}}
const call=(client:Client,name:string,args:Record<string,unknown>)=>requestContext.run({fbUserId:"actor"},()=>client.callTool({name,arguments:args}));


type Fixture = Awaited<ReturnType<typeof fixture>>;
const input = { account_id: "101", name: "Synthetic reviewed campaign", objective: "OUTCOME_TRAFFIC", daily_budget: 2000, status: "PAUSED" };
const human = { tenantId: "tenant", operatorId: "human" };
const prepare = async (client: Client, args: Record<string, unknown> = input) => {
  const prepared = await call(client, "meta_prepare_action", { client_id: "client", tool: "ads_create_campaign", asset_id: "101", input: args });
  return { isError: prepared.isError === true, body: JSON.parse((prepared.content as Array<{ text: string }>)[0].text) as { request_id?: string; reason?: string } };
};
const approve = async (f: Fixture, client: Client, args: Record<string, unknown> = input) => {
  const prepared = await prepare(client, args);
  expect(prepared.isError, JSON.stringify(prepared.body)).toBe(false);
  return issueHumanApproval(f.repo, human, prepared.body.request_id!);
};
const send = (client: Client, approvalId: string, args: Record<string, unknown> = input) => call(client, "ads_create_campaign", { ...args, client_id: "client", approval_id: approvalId });
const reasonOf = (response: { content: unknown }) => JSON.stringify(response.content);
/** Meta POSTs are scripted per attempt; every GET goes to the fixture's provider. */
function scriptPosts(outcomes: Array<"lost-response" | "created">) {
  const base = globalThis.fetch as typeof fetch, posts: string[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(url)).hostname === "127.0.0.1") return localFetch(url, init);
    if (init?.method === "POST") {
      const outcome = outcomes[posts.length] ?? "created";
      posts.push(String(url));
      if (outcome === "lost-response") throw new Error("socket hang up (response lost after Meta processed the request)");
      return new Response(JSON.stringify({ id: String(777 + posts.length) }));
    }
    return base(url as never, init);
  });
  return posts;
}
const states = async (f: Fixture) => (await f.repo.list("operations", "tenant")).filter(o => o.tool === "ads_create_campaign").map(o => o.state);

describe("an identical plan is not re-approved or re-sent after an attempt whose outcome is unknown", () => {
  it("lost response (UNKNOWN): the identical action cannot be prepared again and Meta gets one POST", async () => {
    const f = await fixture(), posts = scriptPosts(["lost-response"]);
    await withClient(async client => {
      const first = await send(client, await approve(f, client));
      expect(first.isError).toBe(true);
      expect(await states(f)).toEqual(["UNKNOWN"]);
      const again = await prepare(client);
      expect(again.isError).toBe(true);
      expect(again.body).toMatchObject({ status: "HOLD", reason: "PRIOR_ATTEMPT_UNRECONCILED" });
      expect(await f.repo.list("approvalRequests", "tenant")).toHaveLength(1);
      expect(posts).toHaveLength(1);
    });
  });

  it("an approval issued earlier for the same plan is refused at execution and stays unspent", async () => {
    const f = await fixture(), posts = scriptPosts(["lost-response", "created"]);
    await withClient(async client => {
      const first = await approve(f, client), second = await approve(f, client);
      expect((await send(client, first)).isError).toBe(true);
      const refused = await send(client, second);
      expect(refused.isError).toBe(true);
      expect(reasonOf(refused)).toContain("PRIOR_ATTEMPT_UNRECONCILED");
      expect(posts).toHaveLength(1);
      const [, spare] = (await f.repo.list("approvals", "tenant")).sort((a, b) => Number(a.consumedAt === null) - Number(b.consumedAt === null));
      expect(spare).toMatchObject({ id: second, consumedAt: null, operationId: null });
      expect(await f.repo.list("operations", "tenant")).toHaveLength(1);
    });
  });

  it("review of a request prepared before the attempt is refused too", async () => {
    const f = await fixture(); scriptPosts(["lost-response"]);
    await withClient(async client => {
      const early = await prepare(client), later = await prepare(client);
      const first = await issueHumanApproval(f.repo, human, early.body.request_id!);
      expect((await send(client, first)).isError).toBe(true);
      await expect(inspectApprovalRequest(f.repo, human, later.body.request_id!)).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
      await expect(issueHumanApproval(f.repo, human, later.body.request_id!)).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
      expect(await f.repo.list("approvals", "tenant")).toHaveLength(1);
    });
  });

  it("a changed plan is a different plan and is not blocked", async () => {
    const f = await fixture(), posts = scriptPosts(["lost-response", "created"]);
    await withClient(async client => {
      expect((await send(client, await approve(f, client))).isError).toBe(true);
      const changed = { ...input, name: "Synthetic reviewed campaign, reconciled retry" };
      const second = await send(client, await approve(f, client, changed), changed);
      expect(second.isError, reasonOf(second)).not.toBe(true);
      expect(posts).toHaveLength(2);
      expect((await states(f)).sort()).toEqual(["SUCCEEDED", "UNKNOWN"]);
    });
  });

  it("after a SUCCEEDED attempt the same action can be approved and sent again, as before", async () => {
    const f = await fixture(), posts = scriptPosts(["created", "created"]);
    await withClient(async client => {
      expect((await send(client, await approve(f, client))).isError).not.toBe(true);
      const again = await send(client, await approve(f, client));
      expect(again.isError, reasonOf(again)).not.toBe(true);
      expect(posts).toHaveLength(2);
      expect(await states(f)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
    });
  });
});
