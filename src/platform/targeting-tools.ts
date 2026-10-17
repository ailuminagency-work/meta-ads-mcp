import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {getPlatformRepository,resolveOperationContext} from "./runtime.js";
import {discoveryEnabled} from "./discovery-runtime.js";
import {lookupAdTargeting} from "./targeting-lookup.js";
import {PlatformDenied} from "./models.js";
export function registerTargetingLookupTools(server:McpServer):void{
 server.registerTool("meta_lookup_ad_targeting",{description:"Look up current public city keys or interest IDs with one registered client's selected advertiser connection. Stores encrypted evidence for five minutes; no asset grants or ads change. Use returned lookup references in a separately reviewed paused ad-set plan.",inputSchema:{client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),root_key:z.string().min(1).max(256),connection_id:z.string().min(1).max(128).optional(),kind:z.enum(["CITY","INTEREST"]),query:z.string().min(2).max(200)},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},async({client_id,root_key,connection_id,kind,query})=>{try{if(!discoveryEnabled())throw new PlatformDenied("TARGETING_LOOKUP_DISABLED_BY_DEPLOYMENT");const ctx=await resolveOperationContext(client_id,"meta_lookup_ad_targeting","META_MARKETING"),result=await lookupAdTargeting(getPlatformRepository(),ctx,{rootKey:root_key,kind,query,...(connection_id?{connectionId:connection_id}:{})});return {content:[{type:"text" as const,text:JSON.stringify({...result,provider_writes:0,asset_grants_created:0})}]};}catch(error){return {isError:true,content:[{type:"text" as const,text:JSON.stringify({status:"HOLD",reason:error instanceof PlatformDenied?error.reason:"TARGETING_LOOKUP_UNAVAILABLE"})}]};}});
}
