import {videoLeadFixture as fixture} from "./video-lead-fixture.js";




import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {stubBudgetCeilings} from "./budget-ceiling-fixture.js";
beforeEach(()=>stubBudgetCeilings());
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createServer} from "../../src/server.js";

import {configurePlatformRepository} from "../../src/platform/runtime.js";
import {requestContext} from "../../src/auth/token-store.js";
import {AssetDiscoveryService} from "../../src/platform/discovery-service.js";


import {issueHumanApproval} from "../../src/platform/approvals.js";

const actor={tenantId:"tenant",operatorId:"100"},hash="a".repeat(32);
beforeEach(()=>{for(const key of ["LUMIN_PLATFORM_ENABLED","LUMIN_PLATFORM_WRITES_ENABLED","AGENCY_WRITES_ENABLED","LUMIN_PLATFORM_DISCOVERY_ENABLED","LUMIN_MARKETING_CBO_ENABLED","LUMIN_MARKETING_VIDEO_CREATIVE_ENABLED"])vi.stubEnv(key,"true");vi.stubEnv("META_APP_ID","300");vi.stubEnv("TOKEN_ENCRYPTION_KEY","c".repeat(64));vi.stubEnv("META_API_VERSION","v26.0");vi.stubEnv("DEPLOYMENT_MODE","legacy");});afterEach(()=>{configurePlatformRepository(null);vi.unstubAllEnvs();vi.restoreAllMocks();});
it.each(["success","processing","changed-intent","stale-snapshot"])("human-enrolls registered client video/image/form and builds an individually approved paused CBO lead chain (%s)",async mode=>{const {repo,provider,connectionId}=await fixture(mode),ctx={principal:actor,clientId:"client",provider:"META_MARKETING" as const,tool:"meta_discover_ad_assets",requestId:"synthetic"},discovery=new AssetDiscoveryService(repo,{fetcher:provider});for(const kind of ["AD_IMAGE","AD_VIDEO","LEAD_FORM"] as const){const proposed=await discovery.prepare(ctx,"account",kind,connectionId);await discovery.enroll({tenantId:"tenant",operatorId:"200"},proposed.proposalId,proposed.planHash);}expect((await repo.list("assets","tenant")).find(a=>a.type==="LEAD_FORM")?.parents).toEqual([{type:"PAGE",id:"601"}]);
 vi.stubGlobal("fetch",provider);const server=createServer(),client=new Client({name:"synthetic-native-lead-chain",version:"1"}),[ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(st),client.connect(ct)]);
 const call=(name:string,input:Record<string,unknown>)=>requestContext.run({fbUserId:"100"},()=>client.callTool({name,arguments:input}));
 try{const steps:[string,Record<string,unknown>][]=[
 ["ads_create_campaign",{account_id:"101",page_id:"601",name:"Reviewed lead campaign",objective:"OUTCOME_LEADS",budget_mode:"CAMPAIGN",daily_budget:4000}],
 ["ads_create_ad_set",{account_id:"101",campaign_id:"201",name:"Reviewed lead adset",destination_type:"ON_AD",optimization_goal:"LEAD_GENERATION",budget_mode:"CAMPAIGN",promoted_object:{page_id:"601"},targeting:{geo_locations:{countries:["US"]}}}],
 ["ads_create_ad_creative",{account_id:"101",page_id:"601",lead_form_id:"701",image_hash:hash,video_id:"801",name:"Reviewed lead creative",link_url:"https://fb.me/",message:"Reviewed client copy"}],
 ["ads_create_ad",{account_id:"101",ad_set_id:"301",creative_id:"501",page_id:"601",lead_form_id:"701",name:"Reviewed lead ad"}]];
 for(const [tool,input] of steps){const observed=await call("meta_observe_ads_compatibility",{client_id:"client",connection_id:connectionId,tool,input});if(tool==="ads_create_ad_creative"&&mode==="processing"){expect(observed.isError).toBe(true);expect(provider.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(2);return;}expect(observed.isError,JSON.stringify(observed.content)).not.toBe(true);if(tool==="ads_create_ad"&&mode==="changed-intent")input.name="Changed after observed intent";const prepared=await call("meta_prepare_action",{client_id:"client",tool,asset_id:"101",input});if(tool==="ads_create_ad"&&mode==="changed-intent"){expect(prepared.isError).toBe(true);expect(provider.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(3);expect((await repo.list("assets","tenant")).some(a=>a.type==="AD")).toBe(false);return;}expect(prepared.isError,JSON.stringify(prepared.content)).not.toBe(true);const metadata=JSON.parse((prepared.content as {text:string}[])[0].text),approval=await issueHumanApproval(repo,{tenantId:"tenant",operatorId:"200"},metadata.request_id);if(tool==="ads_create_ad"&&mode==="stale-snapshot"){const creative=(await repo.list("assets","tenant")).find(a=>a.type==="CREATIVE")!;await repo.put("assets","tenant",creative.key,{...creative,revision:creative.revision+1});}const result=await call(tool,{...input,client_id:"client",approval_id:approval});if(tool==="ads_create_ad"&&mode==="stale-snapshot"){expect(result.isError).toBe(true);expect(provider.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(3);expect((await repo.list("assets","tenant")).some(a=>a.type==="AD")).toBe(false);return;}expect(result.isError,JSON.stringify(result.content)).not.toBe(true);expect(JSON.parse((result.content as {text:string}[])[0].text).registered).toBe(true);}
 expect(provider.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(4);expect((await repo.list("assets","tenant")).filter(a=>["CAMPAIGN","AD_SET","CREATIVE","AD"].includes(a.type))).toHaveLength(4);expect((await repo.list("operations","tenant")).filter(o=>o.state==="SUCCEEDED")).toHaveLength(4);expect((await repo.list("grants","tenant")).find(g=>g.assetKey==="account"&&g.connectionId===connectionId)?.tasks).toEqual([]);expect((await repo.get("assets","tenant","account"))?.ownerBusinessId).toBe("900");expect(JSON.stringify(await repo.list("controlAudit","tenant"))).not.toContain("synthetic-native-chain-token");
 }finally{await client.close();await server.close();}
});

vi.setConfig({testTimeout:90000});
