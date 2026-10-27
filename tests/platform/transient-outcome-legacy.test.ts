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
import { metaApiClient } from "../../src/meta/client.js";
import { productRateController } from "../../src/platform/clients.js";

// A throttle code (4, 17, 32, 613, 429) blocks the bucket and trips the circuit for the shared test token; each scenario starts clean.
const resetProviderThrottles = (): void => {
  metaApiClient.resetForTests();
  for (const field of ["states", "apps", "appBlocks"]) (productRateController as unknown as Record<string, Map<string, unknown>>)[field].clear();
};
import { requestContext } from "../../src/auth/token-store.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { createApprovalRouter } from "../../src/platform/approval-router.js";
import { encryptCredential } from "../../src/platform/connections.js";
import {issueHumanApproval} from "../../src/platform/approvals.js";
beforeEach(() => { resetProviderThrottles(); });
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

const approveVia = async (f: Awaited<ReturnType<typeof fixture>>, client: Client, input: Record<string, unknown>, tool = "ads_create_campaign") => {
  const prepared = await call(client, "meta_prepare_action", { client_id: "client", tool, asset_id: "101", input });
  const metadata = JSON.parse((prepared.content as Array<{ text: string }>)[0].text) as { request_id: string };
  const approval = await issueHumanApproval(f.repo, { tenantId: "tenant", operatorId: "human" }, metadata.request_id);
  return approval;
};

type Responder = (init: RequestInit | undefined) => Response | Promise<Response>;
const J = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
/** The same recorded Graph responses are used for the strict legacy write path and the generic product path; both must end the operation the same way. */
const SCENARIOS: Array<[string, Responder, "FAILED" | "UNKNOWN"]> = [
  ["400 code 100 (rejected)", () => J(400, { error: { code: 100, message: "Invalid parameter" } }), "FAILED"],
  ["400 code 1 (unknown error)", () => J(400, { error: { code: 1 } }), "UNKNOWN"],
  ["400 code 4 + is_transient", () => J(400, { error: { code: 4, is_transient: true } }), "UNKNOWN"],
  ["400 code 100 + is_transient", () => J(400, { error: { code: 100, is_transient: true } }), "UNKNOWN"],
  ["400 code 100 + is_transient false", () => J(400, { error: { code: 100, is_transient: false } }), "FAILED"],
  ["400 code 17 (user limit)", () => J(400, { error: { code: 17 } }), "FAILED"],
  ["403 code 200 (permission)", () => J(403, { error: { code: 200 } }), "FAILED"],
  ["429 code 4", () => J(429, { error: { code: 4 } }), "UNKNOWN"],
  ["500 code 1", () => J(500, { error: { code: 1 } }), "UNKNOWN"],
  ["400 non-JSON body", () => J(400, "oops"), "UNKNOWN"],
];
const LOCK = { FAILED: "RELEASED", UNKNOWN: "HELD" } as const;

const prepareOnly = async (client: Client, input: Record<string, unknown>) => {
  const prepared = await call(client, "meta_prepare_action", { client_id: "client", tool: "ads_create_campaign", asset_id: "101", input });
  return JSON.parse((prepared.content as Array<{ text: string }>)[0].text) as { request_id?: string; reason?: string; status?: string };
};
describe("failure outcome of a provider write on the strict legacy write path", () => {
  it.each(SCENARIOS)("%s", async (label, respond, expected) => {
    const f = await fixture(), input = { account_id: "101", name: "Synthetic reviewed campaign", objective: "OUTCOME_TRAFFIC", daily_budget: 2000, status: "PAUSED" };
    let posts = 0; const base = (globalThis.fetch as typeof fetch);
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(url)).hostname === "127.0.0.1") return localFetch(url, init);
      if (init?.method === "POST") { posts++; return respond(init); }
      return base(url as never, init);
    });
    await withClient(async client => {
      const p1 = await prepareOnly(client, input), a1 = await issueHumanApproval(f.repo, { tenantId: "tenant", operatorId: "human" }, p1.request_id!);
      const r1 = await call(client, "ads_create_campaign", { ...input, client_id: "client", approval_id: a1 });
      const ops = (await f.repo.list("operations", "tenant")).filter(o => o.tool === "ads_create_campaign").map(o => o.state);
      const locks = (await f.repo.list("operationPlanLocks" as never, "tenant") as Array<{ state: string }>).map(l => l.state);
      const p2 = await prepareOnly(client, input);
      expect({ label, operation: ops, lock: locks }).toEqual({ label, operation: [expected], lock: [LOCK[expected]] });
    });
    expect(posts).toBe(1);
  });
});
