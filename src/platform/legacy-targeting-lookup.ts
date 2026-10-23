import {z} from "zod";
import {getPlatformRepository,resolveOperationContext} from "./runtime.js";
import {discoveryEnabled} from "./discovery-runtime.js";
import {lookupAdTargeting} from "./targeting-lookup.js";
import {PlatformDenied} from "./models.js";
export const LEGACY_TARGETING_LOOKUP_TOOLS=Object.freeze(["ads_search_interests","ads_search_geo_locations"]);
export async function executeLegacyTargetingLookup(tool:string,raw:Record<string,unknown>){
 if(!LEGACY_TARGETING_LOOKUP_TOOLS.includes(tool))throw new PlatformDenied("TARGETING_LEGACY_MAPPING_REQUIRED");if(!discoveryEnabled())throw new PlatformDenied("TARGETING_LOOKUP_DISABLED_BY_DEPLOYMENT");
 const input=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),root_key:z.string().min(1).max(256),connection_id:z.string().min(1).max(128).optional(),query:z.string().min(2).max(200),limit:z.number().int().min(1).max(20).optional(),...(tool==="ads_search_geo_locations"?{location_types:z.tuple([z.literal("city")]).optional()}:{})}).strict().parse(raw),ctx=await resolveOperationContext(input.client_id,tool,"META_MARKETING"),found=await lookupAdTargeting(getPlatformRepository(),ctx,{rootKey:input.root_key,kind:tool==="ads_search_interests"?"INTEREST":"CITY",query:input.query,...(input.connection_id?{connectionId:input.connection_id}:{})});
 return {content:[{type:"text" as const,text:JSON.stringify({...found,options:found.options.slice(0,input.limit??20),provider_writes:0,asset_grants_created:0,encrypted_lookup_stored:true})}]};
}
