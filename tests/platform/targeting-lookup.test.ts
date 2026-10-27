import {establishFinancialFixture} from "./financial-fixture.js";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createServer} from "../../src/server.js";
import {requestContext} from "../../src/auth/token-store.js";
import {configurePlatformRepository} from "../../src/platform/runtime.js";
import {observeCampaignCompatibility} from "../../src/platform/compatibility-observer.js";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {stubBudgetCeilings} from "./budget-ceiling-fixture.js";
beforeEach(()=>stubBudgetCeilings());
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {encryptCredential} from "../../src/platform/connections.js";
import {lookupAdTargeting,bindLegacyTargetingEvidence,targetingLookupRows} from "../../src/platform/targeting-lookup.js";
import {buildStrictLegacyWritePlan} from "../../src/platform/legacy-write.js";
import {requestLegacyApproval,inspectApprovalRequest,issueHumanApproval} from "../../src/platform/approvals.js";
import {authorizeOperation,finishOperation} from "../../src/platform/execution.js";
import {canonicalPlanHash,planLockHash} from "../../src/platform/policy.js";
import type {OperationContext} from "../../src/platform/models.js";
const ctx:OperationContext={principal:{tenantId:"tenant",operatorId:"100"},clientId:"client",provider:"META_MARKETING",tool:"ads_create_ad_set",requestId:"synthetic"},source="https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/targeting-search";
beforeEach(()=>{vi.stubEnv("TOKEN_ENCRYPTION_KEY","a".repeat(64));vi.stubEnv("META_API_VERSION","v26.0");vi.stubEnv("LUMIN_PLATFORM_ENABLED","true");vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED","true");vi.stubEnv("AGENCY_WRITES_ENABLED","true");});afterEach(()=>{configurePlatformRepository(null);vi.unstubAllEnvs();vi.restoreAllMocks();});
async function fixture(body:unknown={data:[{key:"2447439",name:"Seattle",type:"city",country_code:"US",region:"Washington",supports_city:true}]}){
 const repo=new InMemoryPlatformRepository(),now=Date.now();await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",migrationState:"READY",policyRevision:1,registryRevision:1});for(const[id,roles]of [["100",["admin"]],["200",["approver"]]] as const){await repo.put("operatorIndex","_index",id,{operatorId:id,tenantId:"tenant"});await repo.put("members","tenant",id,{operatorId:id,tenantId:"tenant",roles:[...roles],allowedClientIds:["client"],revision:1,disabledAt:null});}await repo.put("clients","tenant","client",{id:"client",tenantId:"tenant",status:"ACTIVE",revision:1,verifiedBusinessIds:["900"]});
 const base={tenantId:"tenant",clientId:"client",provider:"META_MARKETING" as const,appId:"300",verifiedAt:now,revokedAt:null,revision:1};await repo.put("assets","tenant","root",{...base,key:"root",id:"101",type:"AD_ACCOUNT",parents:[],ownerBusinessId:"900",billingOwnershipVerified:true,ownershipEvidenceSource:source});await repo.put("assets","tenant","campaign",{...base,key:"campaign",id:"201",type:"CAMPAIGN",parents:[{type:"AD_ACCOUNT",id:"101"}]});await repo.put("connections","tenant","connection",{id:"connection",tenantId:"tenant",operatorId:"100",provider:"META_MARKETING",appId:"300",credentialId:"credential",authStrategy:"synthetic",tokenType:"user",scopes:["ads_read","ads_management","pages_read_engagement","pages_show_list"],assetKeys:["root","campaign"],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1,eligibility:["marketing_read_access:v26.0","marketing_write_access:v26.0","marketing_adset_parent_compatibility:201"].map(requirement=>({requirement,source,verified:true,checkedAt:now,expiresAt:now+300000}))});
 for(const key of ["root","campaign"])await repo.put("grants","tenant",key,{id:key,tenantId:"tenant",clientId:"client",assetKey:key,connectionId:"connection",capabilities:["legacy.ads_search_geo_locations","legacy.ads_search_interests","legacy.ads_create_ad_set","legacy.ads_get_campaign_details"],actions:["READ","WRITE_AD_CONFIGURATION","WRITE_BUDGET"],tasks:[],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1});await repo.put("credentials","tenant","credential",encryptCredential({id:"credential",tenantId:"tenant",operatorId:"100",provider:"META_MARKETING",appId:"300",keyVersion:"primary"},"synthetic-token"));
 const fetcher=vi.fn(async(raw:RequestInfo|URL,options?:RequestInit)=>{const url=new URL(String(raw));expect(url.origin+url.pathname).toBe("https://graph.facebook.com/v26.0/search");expect(new Headers(options?.headers).get("authorization")).toBe("Bearer synthetic-token");expect(url.searchParams.has("access_token")).toBe(false);return new Response(JSON.stringify(url.searchParams.get("type")==="adinterestvalid"?{data:[{id:"6001",valid:true}]}:body));});await establishFinancialFixture(repo,{tenantId:"tenant",operatorId:"100"},"client","root");return {repo,fetcher};
}
const input=(id?:string)=>({account_id:"101",campaign_id:"201",name:"Reviewed local adset",daily_budget:2000,destination_type:"WEBSITE",optimization_goal:"LINK_CLICKS",targeting:{geo_locations:{cities:[{key:"2447439",radius:10,distance_unit:"mile"}]}},...(id?{targeting_lookup_ids:[id]}:{})});
describe("fresh public targeting evidence for reviewed ad sets",()=>{
 it.each(["ads_search_geo_locations","ads_search_interests"])("original %s reaches client-scoped encrypted lookup through native MCP",async tool=>{vi.stubEnv("LUMIN_PLATFORM_DISCOVERY_ENABLED","true");vi.stubEnv("DEPLOYMENT_MODE","legacy");const f=await fixture(tool==="ads_search_interests"?{data:[{id:"6001",name:"Synthetic interest"}]}:undefined);configurePlatformRepository(f.repo);vi.stubGlobal("fetch",f.fetcher);const server=createServer(),client=new Client({name:"synthetic-original-targeting",version:"1"}),[ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(st),client.connect(ct)]);try{const response=await requestContext.run({fbUserId:"100"},()=>client.callTool({name:tool,arguments:{client_id:"client",root_key:"root",connection_id:"connection",query:"Seattle",limit:1,...(tool==="ads_search_geo_locations"?{location_types:["city"]}:{})}}));expect(response.isError,JSON.stringify(response.content)).not.toBe(true);const result=JSON.parse((response.content as {text:string}[])[0].text);expect(result.lookupId).toBeTruthy();expect(result.options).toHaveLength(1);expect(await f.repo.list("targetingLookups","tenant")).toHaveLength(1);expect((await f.repo.list("grants","tenant")).filter(g=>g.revokedAt===null)).toHaveLength(2);}finally{await client.close();await server.close();}});
 it("looks up exact city keys, encrypts evidence and binds provider names/digest into human review",async()=>{const f=await fixture(),found=await lookupAdTargeting(f.repo,ctx,{rootKey:"root",kind:"CITY",query:"Seattle"},f.fetcher);expect(found.options).toEqual([{id:"2447439",name:"Seattle",kind:"CITY",countryCode:"US",region:"Washington"}]);const stored=(await f.repo.list("targetingLookups","tenant"))[0];expect(JSON.stringify(stored)).not.toContain("Seattle");expect(targetingLookupRows(stored)).toEqual(found.options);const plan=await bindLegacyTargetingEvidence(f.repo,ctx,buildStrictLegacyWritePlan(ctx.tool,input(found.lookupId)));expect(JSON.stringify(plan.parameters.targeting_lookup_selected)).toContain("Seattle");await observeCampaignCompatibility(f.repo,ctx,plan,"connection",async()=>new Response(JSON.stringify({id:"201",account_id:"101",objective:"OUTCOME_TRAFFIC",buying_type:"AUCTION",status:"PAUSED",special_ad_categories:[],daily_budget:"0",lifetime_budget:"0"})));const request=await requestLegacyApproval(f.repo,ctx,input(found.lookupId));const review=await inspectApprovalRequest(f.repo,{tenantId:"tenant",operatorId:"200"},request.id);expect(review.plan).toEqual(plan);expect((await f.repo.list("grants","tenant")).filter(g=>g.revokedAt===null)).toHaveLength(2);expect(f.fetcher).toHaveBeenCalledOnce();});
 it("independently validates actual interest IDs by ID before storing evidence",async()=>{const f=await fixture({data:[{id:6001,name:"Synthetic public interest"}]}),found=await lookupAdTargeting(f.repo,ctx,{rootKey:"root",kind:"INTEREST",query:"Synthetic"},f.fetcher);expect(found.options[0].id).toBe("6001");expect(f.fetcher).toHaveBeenCalledTimes(2);const validation=new URL(String(f.fetcher.mock.calls[1][0]));expect(validation.searchParams.get("type")).toBe("adinterestvalid");expect(validation.searchParams.get("interest_fbid_list")).toBe('["6001"]');});
 it.each([{data:[{key:"2447439",name:"Wrong type",type:"region",country_code:"US",supports_city:true}]},{data:[{key:"2447439",name:"Unavailable",type:"city",country_code:"US",supports_city:false}]},{data:[{key:"../evil",name:"Bad ID",type:"city",country_code:"US",supports_city:true}]},{data:Array.from({length:21},(_,i)=>({key:String(i+1),name:"Synthetic",type:"city",country_code:"US",supports_city:true}))}])("rejects malformed, unproven or overbound provider options %j",async body=>{const f=await fixture(body);await expect(lookupAdTargeting(f.repo,ctx,{rootKey:"root",kind:"CITY",query:"Seattle"},f.fetcher)).rejects.toThrow();expect(await f.repo.list("targetingLookups","tenant")).toHaveLength(0);});
 it("rejects guessed keys, missing proof, wrong client, scope tampering and stale evidence before approval",async()=>{const f=await fixture(),found=await lookupAdTargeting(f.repo,ctx,{rootKey:"root",kind:"CITY",query:"Seattle"},f.fetcher);await expect(bindLegacyTargetingEvidence(f.repo,ctx,buildStrictLegacyWritePlan(ctx.tool,input()))).rejects.toThrow();const guessed=input(found.lookupId);guessed.targeting.geo_locations.cities[0].key="999";await expect(bindLegacyTargetingEvidence(f.repo,ctx,buildStrictLegacyWritePlan(ctx.tool,guessed))).rejects.toThrow("EXACT_LOOKUP_OPTION_REQUIRED");await expect(bindLegacyTargetingEvidence(f.repo,{...ctx,clientId:"other"},buildStrictLegacyWritePlan(ctx.tool,input(found.lookupId)))).rejects.toThrow();const stored=(await f.repo.get("targetingLookups","tenant",found.lookupId))!;expect(()=>targetingLookupRows({...stored,clientId:"other"})).toThrow("BINDING_INVALID");vi.spyOn(Date,"now").mockReturnValue(found.expiresAt+1);await expect(requestLegacyApproval(f.repo,ctx,input(found.lookupId))).rejects.toThrow("EXPIRED_OR_WRONG_CLIENT");});
});

describe("a read-only targeting lookup cannot be re-run to unlock a plan whose write may have happened",()=>{
 const human={tenantId:"tenant",operatorId:"200"};
 async function world(){
  const f=await fixture();
  const lookup=()=>lookupAdTargeting(f.repo,ctx,{rootKey:"root",kind:"CITY",query:"Seattle"},f.fetcher);
  await observeCampaignCompatibility(f.repo,ctx,buildStrictLegacyWritePlan(ctx.tool,input()),"connection",async()=>new Response(JSON.stringify({id:"201",account_id:"101",objective:"OUTCOME_TRAFFIC",buying_type:"AUCTION",status:"PAUSED",special_ad_categories:[],daily_budget:"0",lifetime_budget:"0"})));
  const approve=async(lookupId:string,args:Record<string,unknown>={})=>{const request=await requestLegacyApproval(f.repo,ctx,{...input(lookupId),...args}),{plan}=await inspectApprovalRequest(f.repo,human,request.id);return {plan,requestId:request.id,approvalId:await issueHumanApproval(f.repo,human,request.id)};};
  const run=(plan:Awaited<ReturnType<typeof approve>>["plan"],approvalId:string)=>authorizeOperation(f.repo,ctx,plan,{writesEnabled:true,approvalId});
  return {f,lookup,approve,run};
 }
 const bound=async(w:Awaited<ReturnType<typeof world>>,id:string)=>bindLegacyTargetingEvidence(w.f.repo,ctx,buildStrictLegacyWritePlan(ctx.tool,input(id)));

 it("two lookups of the same query send the same request, keep distinct approval hashes and share one lock key",async()=>{
  const w=await world(),first=await w.lookup(),second=await w.lookup(),p1=await bound(w,first.lookupId),p2=await bound(w,second.lookupId);
  expect(first.lookupId).not.toBe(second.lookupId);
  expect((p1.parameters as {legacy_write_step:unknown}).legacy_write_step).toEqual((p2.parameters as {legacy_write_step:unknown}).legacy_write_step);
  expect(canonicalPlanHash(ctx,p1)).not.toBe(canonicalPlanHash(ctx,p2));
  expect(planLockHash(ctx,p1)).toBe(planLockHash(ctx,p2));
 });

 it("the lock key still tells different requests apart",async()=>{
  const w=await world(),lookup=await w.lookup(),base=await bound(w,lookup.lookupId);
  for(const change of [{name:"Another reviewed adset"},{daily_budget:2100}]){
   const other=await bindLegacyTargetingEvidence(w.f.repo,ctx,buildStrictLegacyWritePlan(ctx.tool,{...input(lookup.lookupId),...change}));
   expect(planLockHash(ctx,other),JSON.stringify(change)).not.toBe(planLockHash(ctx,base));
  }
  expect(planLockHash({...ctx,principal:{...ctx.principal,tenantId:"other"}},base)).not.toBe(planLockHash(ctx,base));
 });

 it("after an UNKNOWN attempt a fresh lookup does not allow the identical ad set to be requested again",async()=>{
  const w=await world(),first=await w.lookup(),attempt=await w.approve(first.lookupId),permit=await w.run(attempt.plan,attempt.approvalId);
  await finishOperation(permit,"UNKNOWN");
  const second=await w.lookup(),requests=(await w.f.repo.list("approvalRequests","tenant")).length;
  await expect(w.approve(second.lookupId)).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
  expect(await w.f.repo.list("approvalRequests","tenant")).toHaveLength(requests);
  expect(await w.f.repo.list("operations","tenant")).toHaveLength(1);
 });

 it("an approval already issued against a later lookup is refused after the UNKNOWN attempt, and stays unspent",async()=>{
  const w=await world(),first=await w.lookup(),second=await w.lookup(),early=await w.approve(second.lookupId),attempt=await w.approve(first.lookupId);
  await finishOperation(await w.run(attempt.plan,attempt.approvalId),"UNKNOWN");
  await expect(w.run(early.plan,early.approvalId)).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
  expect(await w.f.repo.get("approvals","tenant",early.approvalId)).toMatchObject({consumedAt:null,operationId:null});
  expect(await w.f.repo.list("operations","tenant")).toHaveLength(1);
 });

 it("after a FAILED attempt a fresh lookup lets the identical ad set be requested and run again",async()=>{
  const w=await world(),first=await w.lookup(),attempt=await w.approve(first.lookupId);
  await finishOperation(await w.run(attempt.plan,attempt.approvalId),"FAILED");
  const second=await w.lookup(),again=await w.approve(second.lookupId),permit=await w.run(again.plan,again.approvalId);
  await finishOperation(permit,"SUCCEEDED");
  expect((await w.f.repo.list("operations","tenant")).map(o=>o.state).sort()).toEqual(["FAILED","SUCCEEDED"]);
 });

 it("approval stays bound to the full plan: an approval for one lookup does not authorise the plan carrying another",async()=>{
  const w=await world(),first=await w.lookup(),second=await w.lookup(),one=await w.approve(first.lookupId),two=await w.approve(second.lookupId);
  await expect(w.run(one.plan,two.approvalId)).rejects.toThrow();
  expect(await w.f.repo.get("approvals","tenant",two.approvalId)).toMatchObject({consumedAt:null});
 });
});
