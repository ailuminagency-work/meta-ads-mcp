import {verifySourceAdPageTask} from "./legacy-source-ad-proof.js";
import {verifyRegisteredAdVideo} from "./legacy-video-creative.js";
import {z} from "zod";
import {PlatformDenied,type OperationPlan,type MetaAsset} from "./models.js";
import {verifyCreativeCompatibility,verifyAdsetDeliveryCompatibility} from "./compatibility-observations.js";
const numeric=z.string().regex(/^\d{1,32}$/),budget=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(Number).refine(Number.isSafeInteger);
export interface LegacyUpdateFacts {target:unknown;creativeFingerprint?:string;observedUrlTags?:string;campaign?:unknown;creative?:unknown;adset?:unknown;pageTasks?:unknown;videoMembership?:unknown;videoStatus?:unknown}
export function legacyUpdateReadFields(tool:string):string {
 if(tool==="ads_update_ad_creative")return "id,account_id";
 if(tool==="ads_update_campaign")return "id,account_id,status,daily_budget,lifetime_budget,objective";
 if(tool==="ads_update_ad_set")return "id,account_id,campaign_id,status,daily_budget,lifetime_budget";
 if(tool==="ads_update_ad")return "id,account_id,campaign_id,adset_id,status,creative{id}";
 throw new PlatformDenied("TYPED_UPDATE_OBSERVATION_REQUIRED");
}
/** Current provider state authorizes no budget-mode conversion or opaque creative replacement. */
export function verifyLegacyUpdateFacts(plan:OperationPlan,facts:LegacyUpdateFacts,assets:MetaAsset[]):{requirement:string;source:string}{
 const tool=plan.capability.replace(/^legacy\./,""),target=plan.assets[0],account=assets.find(a=>a.type==="AD_ACCOUNT"),registered=assets.find(a=>a.type===target?.type&&a.id===target?.id),step=plan.parameters.legacy_write_step as {body?:Record<string,unknown>}|undefined;
 if(tool==="ads_update_ad_creative"){
  const raw=z.object({id:numeric,account_id:numeric}).strict().parse(facts.target);
  if(!account||!registered||registered.type!=="CREATIVE"||raw.id!==target.id||raw.account_id!==account.id.replace(/^act_/,"")||registered.parents.filter(p=>p.type==="AD_ACCOUNT").length!==1||!registered.parents.some(p=>p.type==="AD_ACCOUNT"&&p.id.replace(/^act_/,"")===raw.account_id)||!step?.body||Object.keys(step.body).length!==1||typeof step.body.name!=="string")throw new PlatformDenied("UPDATE_CREATIVE_ACCOUNT_PROOF_REQUIRED");
  return {requirement:"marketing_update_state:"+tool+":"+target.id,source:"https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py"};
 }
 if(!account||!registered||!step?.body||step.body.status!=="PAUSED")throw new PlatformDenied("UPDATE_REGISTERED_STATE_REQUIRED");
 const raw=z.object({id:numeric,account_id:numeric,status:z.enum(["ACTIVE","PAUSED"]),daily_budget:budget.optional(),lifetime_budget:budget.optional(),objective:z.string().max(100).optional(),campaign_id:numeric.optional(),adset_id:numeric.optional(),creative:z.object({id:numeric}).strict().optional()}).parse(facts.target);
 if(raw.id!==target.id||raw.account_id!==account.id.replace(/^act_/,""))throw new PlatformDenied("UPDATE_PROVIDER_TARGET_MISMATCH");
 let sourceFile:string;
 if(tool==="ads_update_campaign"){
  if(target.type!=="CAMPAIGN"||!raw.objective||!registered.parents.some(p=>p.type==="AD_ACCOUNT"&&p.id.replace(/^act_/,"")===raw.account_id))throw new PlatformDenied("UPDATE_CAMPAIGN_PARENT_REQUIRED");
  if(step.body.daily_budget!==undefined&&(!(raw.daily_budget&&raw.daily_budget>0)||(raw.lifetime_budget??0)>0))throw new PlatformDenied("UPDATE_CAMPAIGN_BUDGET_MODE_CHANGE_HOLD");sourceFile="campaign.py";
 }else if(tool==="ads_update_ad_set"){
  if(target.type!=="AD_SET"||!raw.campaign_id||registered.parents.filter(p=>p.type==="CAMPAIGN").length!==1||!registered.parents.some(p=>p.type==="CAMPAIGN"&&p.id===raw.campaign_id))throw new PlatformDenied("UPDATE_ADSET_PARENT_REQUIRED");
  const campaign=z.object({id:numeric,account_id:numeric,daily_budget:budget.optional(),lifetime_budget:budget.optional()}).parse(facts.campaign);if(campaign.id!==raw.campaign_id||campaign.account_id!==raw.account_id)throw new PlatformDenied("UPDATE_ADSET_CAMPAIGN_MISMATCH");
  if(step.body.daily_budget!==undefined&&(!(raw.daily_budget&&raw.daily_budget>0)||(raw.lifetime_budget??0)>0||(campaign.daily_budget??0)>0||(campaign.lifetime_budget??0)>0))throw new PlatformDenied("UPDATE_ADSET_BUDGET_MODE_CHANGE_HOLD");sourceFile="adset.py";
 }else if(tool==="ads_update_ad"){
  if(target.type!=="AD"||!raw.campaign_id||!raw.adset_id||!assets.some(a=>a.type==="CAMPAIGN"&&a.id===raw.campaign_id)||!assets.some(a=>a.type==="AD_SET"&&a.id===raw.adset_id&&registered.parents.some(p=>p.type==="AD_SET"&&p.id===a.id)&&a.parents.some(p=>p.type==="CAMPAIGN"&&p.id===raw.campaign_id)))throw new PlatformDenied("UPDATE_AD_PARENT_REQUIRED");
  const nextCreative=plan.assets.find(a=>a.type==="CREATIVE");if(nextCreative){if(plan.parameters.expected_creative_fingerprint!==undefined&&(facts.creativeFingerprint!==plan.parameters.expected_creative_fingerprint||facts.observedUrlTags!==plan.parameters.expected_url_tags))throw new PlatformDenied("TRACKING_EFFECTIVE_CREATIVE_MISMATCH");if(process.env.LUMIN_MARKETING_CREATIVE_REPLACEMENT_ENABLED!=="true"||raw.status!=="PAUSED"||raw.creative?.id!==plan.parameters.expected_original_creative_id||raw.creative?.id===nextCreative.id)throw new PlatformDenied("REPOINT_CURRENT_OLD_CREATIVE_REQUIRED");verifySourceAdPageTask(plan,{id:raw.id,account_id:raw.account_id,adset_id:raw.adset_id,campaign_id:raw.campaign_id,creative:raw.creative,status:raw.status},facts.pageTasks,assets);const creative=assets.find(a=>a.type==="CREATIVE"&&a.id===nextCreative.id);if(!creative||creative.parents.some(p=>p.type==="LEAD_FORM")||creative.parents.filter(p=>p.type==="PAGE").length!==1||!creative.parents.some(p=>p.type==="PAGE"&&plan.assets.some(ref=>ref.type==="PAGE"&&ref.id===p.id)))throw new PlatformDenied("UPDATE_LEAD_CREATIVE_REPLACEMENT_HOLD");const inspectedPlan={...plan,capability:"legacy.ads_create_ad",assets:[...plan.assets,{type:"AD_SET" as const,id:raw.adset_id}]};verifyCreativeCompatibility(inspectedPlan,facts.creative,assets);verifyAdsetDeliveryCompatibility(inspectedPlan,facts.adset,assets);if(plan.assets.some(a=>a.type==="AD_VIDEO"))verifyRegisteredAdVideo(plan,assets,facts.videoMembership,facts.videoStatus);}
  sourceFile="ad.py";
 }else throw new PlatformDenied("TYPED_UPDATE_OBSERVATION_REQUIRED");
 return {requirement:`marketing_update_state:${tool}:${target.id}`,source:`https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/${sourceFile}`};
}

export function legacyUpdateReadCapabilities(plan:OperationPlan):string[]{const tool=plan.capability.replace(/^legacy\./,"");return [tool==="ads_update_ad_creative"?"legacy.ads_get_creative_details":tool==="ads_update_campaign"?"legacy.ads_get_campaign_details":tool==="ads_update_ad_set"?"legacy.ads_get_ad_set_details":"legacy.ads_get_ad_details",...(tool==="ads_update_ad_set"?["legacy.ads_get_campaign_details"]:[]),...(tool!=="ads_update_ad_creative"&&plan.assets.some(a=>a.type==="CREATIVE")?["legacy.ads_get_creative_details","legacy.ads_get_ad_set_details","legacy.ads_get_account_info",...(plan.assets.some(a=>a.type==="AD_VIDEO")?["legacy.ads_get_ad_videos","legacy.ads_get_video_details"]:[])]:[])];}
