import {z} from "zod";
import {PlatformDenied} from "./models.js";
import {buildLegacyUpdatePlan} from "./legacy-mutation.js";
import {executeStrictLegacyWrite} from "./legacy-write.js";
export const LEGACY_ENTITY_UPDATE_TOOLS=Object.freeze(["ads_update_entity"]);
export const LEGACY_ENTITY_UPDATE_SCHEMA=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),entity_type:z.enum(["campaign","ad_set","ad"]),entity_id:z.string().regex(/^\d{1,32}$/),updates:z.record(z.string(),z.unknown()),approval_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional()}).strict();
export function mapLegacyEntityUpdate(raw:unknown){const data=LEGACY_ENTITY_UPDATE_SCHEMA.parse(raw),definition=({campaign:{tool:"ads_update_campaign",key:"campaign_id"},ad_set:{tool:"ads_update_ad_set",key:"ad_set_id"},ad:{tool:"ads_update_ad",key:"ad_id"}} as const)[data.entity_type];if(Object.keys(data.updates).some(key=>["client_id","tenant_id","approval_id","connection_id","entity_type","entity_id","ad_id","ad_set_id","campaign_id"].includes(key)))throw new PlatformDenied("ENTITY_UPDATE_CONTEXT_OVERRIDE_DENIED");const input={...data.updates,[definition.key]:data.entity_id};buildLegacyUpdatePlan(definition.tool,input);return {tool:definition.tool,assetId:data.entity_id,clientId:data.client_id,input,...(data.approval_id?{approvalId:data.approval_id}:{})};}
export async function executeLegacyEntityUpdate(raw:unknown){const mapped=mapLegacyEntityUpdate(raw);return executeStrictLegacyWrite(mapped.tool,{client_id:mapped.clientId,...mapped.input,...(mapped.approvalId?{approval_id:mapped.approvalId}:{})});}
