import {PlatformDenied,type AssetRef,type OperationPlan} from "./models.js";
import {classifyPlan} from "./policy.js";
import {buildLegacyTargeting} from "./legacy-targeting.js";
import {assertNoCredentialShapedString} from "./input-safety.js";
import {expandVerifiedPermissionDependencies} from "./products/permission-dependencies.js";
import {z} from "zod";
export const LEGACY_UPDATE_TOOLS=Object.freeze(["ads_update_campaign","ads_update_ad_set","ads_update_ad","ads_update_ad_creative"]);
export function buildLegacyUpdatePlan(tool:string,input:Record<string,unknown>):OperationPlan{
 if(tool==="ads_update_ad_creative"){
  if(Object.entries(input).some(([k,v])=>v!==undefined&&!["creative_id","name","client_id","approval_id"].includes(k)))throw new PlatformDenied("CREATIVE_NAME_ONLY_UPDATE_REQUIRED");
  const id=z.string().regex(/^\d{1,32}$/).parse(input.creative_id),name=z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/).parse(input.name);assertNoCredentialShapedString(name);
  return {parameters:{legacy_write_step:{path:"/"+id,body:{name}}},assets:[{type:"CREATIVE",id}],classes:["WRITE_AD_CONFIGURATION"],capability:"legacy.ads_update_ad_creative",requiredScopes:expandVerifiedPermissionDependencies(["ads_management"]),tokenTypes:["user","system_user"]};
 }
 const definition=({ads_update_campaign:{type:"CAMPAIGN",key:"campaign_id"},ads_update_ad_set:{type:"AD_SET",key:"ad_set_id"},ads_update_ad:{type:"AD",key:"ad_id"}} as const)[tool as "ads_update_campaign"|"ads_update_ad_set"|"ads_update_ad"];
 if(!definition)throw new PlatformDenied("LEGACY_TYPED_UPDATE_REQUIRED");
 const id=input[definition.key];if(typeof id!=="string"||!/^\d{1,32}$/.test(id))throw new PlatformDenied("LEGACY_WRITE_ASSET_ID_INVALID");
 const allowed=[definition.key,"name","status","client_id","approval_id",...(tool!=="ads_update_ad"?["daily_budget"]:["creative_id","expected_original_creative_id","page_id","expected_url_tags","expected_creative_fingerprint"]),...(tool==="ads_update_ad_set"?["targeting","targeting_lookup_ids"]:[])];
 if(Object.entries(input).some(([key,value])=>value!==undefined&&!allowed.includes(key)))throw new PlatformDenied("LEGACY_COMPLEX_AD_UPDATE_HOLD");
 if(input.creative_id!==undefined){
  if(tool!=="ads_update_ad"||process.env.LUMIN_MARKETING_CREATIVE_REPLACEMENT_ENABLED!=="true")throw new PlatformDenied("UPDATE_CREATIVE_REPLACEMENT_TASK_PROOF_HOLD");
  if(input.name!==undefined||input.daily_budget!==undefined||input.targeting!==undefined)throw new PlatformDenied("REPOINT_ONLY_TYPED_UPDATE_REQUIRED");
  const next=z.string().regex(/^\d{1,32}$/).parse(input.creative_id),original=z.string().regex(/^\d{1,32}$/).parse(input.expected_original_creative_id),page=z.string().regex(/^\d{1,32}$/).parse(input.page_id);
  if(next===original||input.status!==undefined&&input.status!=="PAUSED")throw new PlatformDenied("REPOINT_DISTINCT_PAUSED_CREATIVE_REQUIRED");
  const tracking=input.expected_url_tags!==undefined||input.expected_creative_fingerprint!==undefined?{expected_url_tags:z.string().max(2048).parse(input.expected_url_tags),expected_creative_fingerprint:z.string().regex(/^[a-f0-9]{64}$/).parse(input.expected_creative_fingerprint)}:{};
  return {parameters:{...tracking,status:"PAUSED",expected_original_creative_id:original,marketing_source_ad_id:id,legacy_write_step:{path:"/"+id,body:{status:"PAUSED",creative:{creative_id:next}}}},assets:[{type:"AD",id},{type:"CREATIVE",id:next},{type:"PAGE",id:page}],classes:["WRITE_AD_CONFIGURATION"],capability:"legacy.ads_update_ad",requiredScopes:expandVerifiedPermissionDependencies(["ads_read","ads_management"]),tokenTypes:["user"],requiredAssetTasks:[{asset:{type:"PAGE",id:page},tasks:["ADVERTISE"]}]};
 }
 if(input.expected_original_creative_id!==undefined||input.page_id!==undefined||input.expected_url_tags!==undefined||input.expected_creative_fingerprint!==undefined)throw new PlatformDenied("REPOINT_UNUSED_CONTEXT_DENIED");
 if(input.status!==undefined&&input.status!=="PAUSED")throw new PlatformDenied("UPDATE_MUST_REMAIN_PAUSED");
 const body:Record<string,unknown>={status:"PAUSED"},assets:AssetRef[]=[{type:definition.type,id}];
 if(input.name!==undefined){if(typeof input.name!=="string"||!input.name.trim()||input.name.length>200||/[\x00-\x1f\x7f]/.test(input.name))throw new PlatformDenied("LEGACY_WRITE_NAME_INVALID");assertNoCredentialShapedString(input.name);body.name=input.name;}
 if(input.daily_budget!==undefined){if(typeof input.daily_budget!=="number"||!Number.isSafeInteger(input.daily_budget)||input.daily_budget<1||input.daily_budget>1_000_000_000)throw new PlatformDenied("LEGACY_WRITE_BUDGET_INVALID");body.daily_budget=String(input.daily_budget);}
 if(input.targeting!==undefined){const targeting=buildLegacyTargeting(input.targeting);body.targeting=targeting.body;assets.push(...targeting.assets);}
 if(input.creative_id!==undefined){if(typeof input.creative_id!=="string"||!/^\d{1,32}$/.test(input.creative_id))throw new PlatformDenied("LEGACY_WRITE_ASSET_ID_INVALID");body.creative={creative_id:input.creative_id};assets.push({type:"CREATIVE",id:input.creative_id});}
 const plan:OperationPlan={parameters:{status:"PAUSED",legacy_write_step:{path:`/${id}`,body}},assets,classes:["WRITE_AD_CONFIGURATION"],capability:`legacy.${tool}`,requiredScopes:expandVerifiedPermissionDependencies(["ads_management"]),tokenTypes:["user","system_user"]};if(input.targeting_lookup_ids!==undefined)plan.parameters.targeting_lookup_ids=z.array(z.string().uuid()).min(1).max(5).parse(input.targeting_lookup_ids).sort();plan.classes=classifyPlan(plan);return plan;
}
