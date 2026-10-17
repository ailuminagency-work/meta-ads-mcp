import {mapLegacyEntityUpdate} from "./legacy-entity-update.js";
import {observeLegacyUpdateCompatibility} from "./compatibility-update-observer.js";
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {getPlatformRepository,resolveOperationContext} from "./runtime.js";
import {discoveryEnabled} from "./discovery-runtime.js";
import {buildStrictLegacyWritePlan} from "./legacy-write.js";
import {bindLegacyTargetingEvidence} from "./targeting-lookup.js";
import {observeCampaignCompatibility,observeRelatedCompatibility} from "./compatibility-observer.js";
import {PlatformDenied} from "./models.js";
export function registerCompatibilityTools(server:McpServer):void {
 server.registerTool("meta_observe_ads_compatibility",{description:"Check current client campaign, creative, Page and form relationships for one exact typed paused Ads creation or update action. Uses the selected registered connection, stores encrypted evidence for five minutes and changes no ads. Manual app eligibility, client billing ownership, lead terms and separate human approval remain required.",inputSchema:{client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),connection_id:z.string().min(1).max(128),tool:z.enum(["ads_create_campaign","ads_create_ad_set","ads_create_ad_creative","ads_create_ad","ads_update_campaign","ads_update_ad_set","ads_update_ad","ads_update_ad_creative","ads_update_entity"]),input:z.record(z.string(),z.unknown())},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},async({client_id,connection_id,tool,input})=>{
  try{if(tool==="ads_update_entity"){if(["client_id","approval_id","tenant_id","connection_id"].some(key=>key in input))throw new PlatformDenied("ENTITY_APPROVAL_CONTEXT_INPUT_FORBIDDEN");const mapped=mapLegacyEntityUpdate({...input,client_id});tool=mapped.tool;input=mapped.input;}if(!discoveryEnabled())throw new PlatformDenied("COMPATIBILITY_OBSERVATION_DISABLED_BY_DEPLOYMENT");const ctx=await resolveOperationContext(client_id,tool,"META_MARKETING"),repo=getPlatformRepository(),plan=await bindLegacyTargetingEvidence(repo,ctx,buildStrictLegacyWritePlan(tool,input)),observations=[];
   if(tool.startsWith("ads_update_"))observations.push(await observeLegacyUpdateCompatibility(repo,ctx,plan,connection_id));
   if(tool==="ads_create_ad_set")observations.push(await observeCampaignCompatibility(repo,ctx,plan,connection_id));
   if(!tool.startsWith("ads_update_")&&plan.assets.some(a=>a.type==="PAGE"||a.type==="CREATIVE"))observations.push(await observeRelatedCompatibility(repo,ctx,plan,connection_id));
   return {content:[{type:"text" as const,text:JSON.stringify({status:observations.length?"OBSERVED":"NO_DYNAMIC_RELATIONSHIP_REQUIRED",observations,provider_writes:0,grants_created:0,human_approval_required:true})}]};
  }catch(error){return {isError:true,content:[{type:"text" as const,text:JSON.stringify({status:"HOLD",reason:error instanceof PlatformDenied?error.reason:"COMPATIBILITY_OBSERVATION_UNAVAILABLE"})}]};}
 });
}
