import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { createApprovalRouter } from "../../src/platform/approval-router.js";
import { encryptCredential } from "../../src/platform/connections.js";
const origin="https://fixture.invalid",source="https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi";
const localFetch=globalThis.fetch;
let httpServer:Server|undefined;
beforeEach(()=>{vi.stubEnv("DEPLOYMENT_MODE","legacy");vi.stubEnv("LUMIN_PLATFORM_ENABLED","true");vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED","true");vi.stubEnv("AGENCY_WRITES_ENABLED","true");vi.stubEnv("META_API_VERSION","v26.0");vi.stubEnv("TOKEN_ENCRYPTION_KEY","d".repeat(64));});
afterEach(async()=>{configurePlatformRepository(undefined);vi.unstubAllEnvs();vi.unstubAllGlobals();if(httpServer)await new Promise<void>(r=>httpServer!.close(()=>r()));httpServer=undefined;});
async function fixture(){
  const repo=new InMemoryPlatformRepository(),now=Date.now();configurePlatformRepository(repo);
  await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",migrationState:"READY",policyRevision:1,registryRevision:1});
  for(const [id,roles] of [["actor",["writer"]],["human",["approver"]]] as const){await repo.put("members","tenant",id,{operatorId:id,tenantId:"tenant",roles:[...roles],allowedClientIds:["client"],revision:1,disabledAt:null});await repo.put("operatorIndex","_index",id,{operatorId:id,tenantId:"tenant"});}
  await repo.put("clients","tenant","client",{id:"client",tenantId:"tenant",status:"ACTIVE",revision:1,verifiedBusinessIds:["900"]});
  const account={key:"account",id:"101",type:"AD_ACCOUNT" as const,provider:"META_MARKETING" as const,appId:"app",tenantId:"tenant",clientId:"client",parents:[],verifiedAt:now,revokedAt:null,revision:1,ownerBusinessId:"900",billingOwnershipVerified:true,ownershipEvidenceSource:source};await repo.put("assets","tenant","account",account);
  await repo.put("connections","tenant","connection",{id:"connection",tenantId:"tenant",operatorId:"actor",provider:"META_MARKETING",appId:"app",credentialId:"credential",tokenType:"user",authStrategy:"fixture",scopes:["ads_management"],assetKeys:["account"],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1,eligibility:[{requirement:"marketing_write_access:v26.0",source,verified:true,checkedAt:now,expiresAt:now+300000}]});
  await repo.put("grants","tenant","grant",{id:"grant",tenantId:"tenant",clientId:"client",assetKey:"account",connectionId:"connection",capabilities:["legacy.ads_create_campaign"],actions:["WRITE_AD_CONFIGURATION","WRITE_BUDGET"],tasks:[],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1});
  await repo.put("credentials","tenant","credential",encryptCredential({id:"credential",tenantId:"tenant",operatorId:"actor",provider:"META_MARKETING",appId:"app",keyVersion:"primary"},"synthetic-selected-token"));
  let humanSession=false;
  const app=express();app.use(cookieParser());app.use("/platform/approvals",createApprovalRouter({repo,origin,csrfSecret:"synthetic-csrf-secret-".repeat(4),resolveSession:async()=>humanSession?{tenantId:"tenant",operatorId:"human"}:null}));httpServer=app.listen(0,"127.0.0.1");await new Promise<void>(r=>httpServer!.once("listening",r));const base=`http://127.0.0.1:${(httpServer.address() as {port:number}).port}`;
  const provider=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{expect(String(input)).toBe("https://graph.facebook.com/v26.0/act_101/campaigns");expect(options?.method).toBe("POST");expect(new Headers(options?.headers).get("authorization")).toBe("Bearer synthetic-selected-token");expect(new URLSearchParams(String(options?.body)).get("status")).toBe("PAUSED");expect(new URLSearchParams(String(options?.body)).get("daily_budget")).toBe("2000");return new Response(JSON.stringify({id:"777"}));});
  vi.stubGlobal("fetch",(input:RequestInfo|URL,options?:RequestInit)=>new URL(input instanceof Request?input.url:String(input)).hostname==="127.0.0.1"?localFetch(input,options):provider(input,options));
  return {repo,account,provider,base,signInHuman:()=>{humanSession=true;}};
}
async function withClient(work:(client:Client)=>Promise<void>){const server=createServer(),client=new Client({name:"synthetic-approval-journey",version:"1"}),[ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(st),client.connect(ct)]);try{await work(client);}finally{await client.close();await server.close();}}
const call=(client:Client,name:string,args:Record<string,unknown>)=>requestContext.run({fbUserId:"actor"},()=>client.callTool({name,arguments:args}));
describe("local SDK to authenticated approval to paused Ads journey",()=>{
  it.each(["success","wrong-client","stale-snapshot"])("preserves atomic authorization and provenance (%s)",async mode=>{
    const f=await fixture(),input={account_id:"101",name:"Synthetic reviewed campaign",objective:"OUTCOME_TRAFFIC",daily_budget:2000,status:"PAUSED"};
    await withClient(async client=>{
      const prepared=await call(client,"meta_prepare_action",{client_id:"client",tool:"ads_create_campaign",asset_id:"101",input});expect(prepared.isError).not.toBe(true);const metadata=JSON.parse((prepared.content as Array<{text:string}>)[0].text) as {request_id:string;review_path:string};expect(f.provider).not.toHaveBeenCalled();expect(await f.repo.list("operations","tenant")).toHaveLength(0);expect(JSON.stringify(await f.repo.list("approvalRequests","tenant"))).not.toContain(input.name);
      expect((await fetch(f.base+metadata.review_path)).status).toBe(403);f.signInHuman();const review=await fetch(f.base+metadata.review_path),html=await review.text();expect(html).toContain("Synthetic reviewed campaign");const csrf=html.match(/name="csrf" value="([^"]+)"/)![1],cookie=review.headers.get("set-cookie")!.split(";")[0];const approve=await fetch(f.base+metadata.review_path,{method:"POST",headers:{origin,"content-type":"application/x-www-form-urlencoded",cookie},body:new URLSearchParams({csrf,decision:"approve"})});expect(approve.status).toBe(200);
      const status=await call(client,"meta_get_action_status",{client_id:"client",request_id:metadata.request_id});const action=JSON.parse((status.content as Array<{text:string}>)[0].text) as {approval_id:string};expect(action.approval_id).toBeTruthy();
      if(mode==="stale-snapshot")await f.repo.put("assets","tenant","account",{...f.account,revision:2});
      const created=await call(client,"ads_create_campaign",{...input,client_id:mode==="wrong-client"?"foreign":"client",approval_id:action.approval_id});
      if(mode!=="success"){expect(created.isError).toBe(true);expect(f.provider).not.toHaveBeenCalled();expect(await f.repo.list("operations","tenant")).toHaveLength(0);expect(await f.repo.list("assets","tenant")).toHaveLength(1);return;}
      expect(created.isError).not.toBe(true);expect(JSON.stringify(created.content)).toContain("SUCCEEDED");expect(f.provider).toHaveBeenCalledOnce();const operation=(await f.repo.list("operations","tenant"))[0],asset=(await f.repo.list("assets","tenant")).find(a=>a.id==="777")!;expect(operation.state).toBe("SUCCEEDED");expect(asset.createdFromOperationId).toBe(operation.id);expect(asset.parents).toContainEqual({type:"AD_ACCOUNT",id:"101"});expect((await f.repo.list("grants","tenant")).some(g=>g.assetKey===asset.key)).toBe(true);expect((await f.repo.get("connections","tenant","connection"))?.revision).toBe(2);expect((await f.repo.list("audit","tenant")).map(a=>a.event)).toEqual(["PREPARED","SUCCEEDED"]);expect(JSON.stringify(await f.repo.list("audit","tenant"))).not.toContain("synthetic-selected-token");expect((await f.repo.get("approvals","tenant",action.approval_id))?.consumedAt).not.toBeNull();
    });
  });
});
