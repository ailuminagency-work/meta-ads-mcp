import {assertManualEligibilityAttestation} from "./manual-eligibility.js";
import {legacyMarketingWriteEligibilityContract,legacyMarketingWriteRequirement} from "./legacy-marketing-eligibility.js";
import {buildAppInstallAdset,buildAppInstallCreative,assertAppPromotionPlanSnapshot,requireAppPromotionEngineering} from "./legacy-app-promotion.js";
import {inspectLegacyRepoint,inspectSourceAdCreation} from "./legacy-repoint-inspection.js";
import {validateLegacyUrlTags} from "./legacy-url-tags.js";
import {buildLegacyVideoCreative,marketingVideoCreativeEnabled} from "./legacy-video-creative.js";
import {applyCampaignBudget,applyAdsetBudget,marketingCboEnabled,type MarketingBudgetMode} from "./legacy-cbo.js";
import {createHash} from "node:crypto";
import {productRateController} from "./clients.js";
import {assertAgencyAdvertisingAuthorization} from "./ownership-evidence.js";
import { assertNoCredentialShapedString } from "./input-safety.js";
import { z } from "zod";
import { resolveMetaApiVersion } from "../meta/api-version.js";
import { readBodyWithLimit } from "../utils/bounded-body.js";
import { PlatformDenied, type AssetRef, type AuthorizationSnapshot, type OperationPlan } from "./models.js";
import { authorizeOperation, assertExecutionPermit, claimMutationStep, finishCreatedAsset, finishRepointedAd, finishOperation, getExecutionScope, revalidateExecutionPermit, runWithExecutionPermit, withConnectionCredential } from "./execution.js";
import { canonicalJson, classifyPlan } from "./policy.js";
import { getPlatformRepository, platformWritesEnabled, resolveOperationContext } from "./runtime.js";
import { expandVerifiedPermissionDependencies } from "./products/permission-dependencies.js";
import {buildLegacyTargeting} from "./legacy-targeting.js";
import {buildLegacyImageCreative} from "./legacy-creative.js";
import {buildLegacyUpdatePlan,LEGACY_UPDATE_TOOLS} from "./legacy-mutation.js";
import {bindLegacyTargetingEvidence} from "./targeting-lookup.js";
import {compatibilityIntentHash} from "./compatibility-intent.js";

export const LEGACY_CORE_WRITE_TOOLS = Object.freeze(["ads_create_campaign","ads_create_ad_set","ads_create_ad","ads_create_ad_creative",...LEGACY_UPDATE_TOOLS]);
export const legacyApprovalSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional().describe("One-time human approval identifier bound to this exact paused creation plan.");
export const LEGACY_WRITE_SOURCES = Object.freeze([
  "https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi",
  "https://www.postman.com/meta/facebook-marketing-api/request/jk2pu62/createacampaignobjtrafficoffsiteconversion",
  "https://www.postman.com/meta/facebook-marketing-api/request/6t7azqp/createadsettrafficconversionimpressions",
  "https://www.postman.com/meta/facebook-marketing-api/request/8nbnqnv/createadforawarenesscampaign",
  "https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py",
]);
const numericId = (value:unknown,account=false):string => {
  if(typeof value!=="string" || !(account?/^(?:act_)?\d{1,32}$/:/^\d{1,32}$/).test(value))throw new PlatformDenied("LEGACY_WRITE_ASSET_ID_INVALID");
  return account?`act_${value.replace(/^act_/,"")}`:value;
};
const official = (value:string):boolean => /^https:\/\/(developers\.facebook\.com\/|www\.postman\.com\/meta\/|github\.com\/facebook\/)/.test(value);
const clean = (input:Record<string,unknown>):Record<string,unknown> => Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined));
function requireKeys(input:Record<string,unknown>,keys:string[]):void {
  if(Object.keys(clean(input)).some(k=>![...keys,"client_id","approval_id"].includes(k)))throw new PlatformDenied("LEGACY_COMPLEX_AD_CREATION_HOLD");
}
/** The only accepted reference-bearing structures are constructed here, never passed through. */
export function buildStrictLegacyWritePlan(tool:string,input:Record<string,unknown>):OperationPlan {
  if(!LEGACY_CORE_WRITE_TOOLS.includes(tool))throw new PlatformDenied("LEGACY_STRICT_MIGRATION_HOLD");
  if(resolveMetaApiVersion()!=="v26.0")throw new PlatformDenied("UNVERIFIED_MARKETING_WRITE_VERSION");
  if(LEGACY_UPDATE_TOOLS.includes(tool))return buildLegacyUpdatePlan(tool,input);
  if(input.status!==undefined && input.status!=="PAUSED")throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
  if(typeof input.name!=="string" || !input.name.trim() || input.name.length>200 || /[\u0000-\u001f]/.test(input.name))throw new PlatformDenied("LEGACY_WRITE_NAME_INVALID");
  assertNoCredentialShapedString(input.name);
  const root:AssetRef={type:"AD_ACCOUNT",id:numericId(input.account_id,true)};
  const refs:AssetRef[]=[root];
  const body:Record<string,unknown>={name:input.name,status:"PAUSED"};
  let edge:string,budgetMode:MarketingBudgetMode|undefined;
  if(tool==="ads_create_ad_creative"){
    requireKeys(input,["account_id","name","page_id","image_hash","video_id","link_url","message","headline","description","call_to_action_type","lead_form_id","url_tags","source_ad_id","application_id","platform","object_store_url"]);
    if(input.video_id!==undefined&&!marketingVideoCreativeEnabled())throw new PlatformDenied("MARKETING_VIDEO_CREATIVE_DISABLED");
    const creative=(input.application_id!==undefined?buildAppInstallCreative:input.video_id===undefined?buildLegacyImageCreative:buildLegacyVideoCreative)(Object.fromEntries(Object.entries(clean(input)).filter(([key])=>!["account_id","name","client_id","approval_id","url_tags","source_ad_id"].includes(key))));
    refs.push(...creative.assets);delete body.status;body.object_story_spec=creative.story;if(input.url_tags!==undefined)body.url_tags=validateLegacyUrlTags(input.url_tags);edge="adcreatives";
  }else if(tool==="ads_create_campaign") {
    requireKeys(input,["account_id","name","objective","status","special_ad_categories","daily_budget","buying_type","is_adset_budget_sharing_enabled","page_id","budget_mode","bid_strategy","application_id"]);
    if(!["OUTCOME_TRAFFIC","OUTCOME_AWARENESS","OUTCOME_LEADS","OUTCOME_APP_PROMOTION"].includes(String(input.objective)))throw new PlatformDenied("LEGACY_OBJECTIVE_CONTRACT_HOLD");
    if(input.objective==="OUTCOME_APP_PROMOTION"){requireAppPromotionEngineering();refs.push({type:"APP",id:numericId(input.application_id)},{type:"PAGE",id:numericId(input.page_id)});}else if(input.application_id!==undefined)throw new PlatformDenied("APP_CONTEXT_ONLY");
    if(input.objective==="OUTCOME_LEADS")refs.push({type:"PAGE",id:numericId(input.page_id)});else if(input.page_id!==undefined&&input.objective!=="OUTCOME_APP_PROMOTION")throw new PlatformDenied("LEAD_PAGE_CONTEXT_ONLY");
    if(input.buying_type!==undefined && input.buying_type!=="AUCTION")throw new PlatformDenied("LEGACY_RESERVED_BUYING_HOLD");
    const categories=input.special_ad_categories;
    if(categories!==undefined && (!Array.isArray(categories)||!([0,1].includes(categories.length))||(categories.length===1&&categories[0]!=="NONE")))throw new PlatformDenied("LEGACY_SPECIAL_CATEGORY_CREATION_HOLD");
    if(input.is_adset_budget_sharing_enabled===true)throw new PlatformDenied("LEGACY_BUDGET_SHARING_HOLD");
    body.objective=input.objective;body.buying_type="AUCTION";body.special_ad_categories=[];
    budgetMode=applyCampaignBudget(input,body);
    edge="campaigns";
  } else if(tool==="ads_create_ad_set") {
    requireKeys(input,["account_id","campaign_id","name","destination_type","status","daily_budget","optimization_goal","billing_event","targeting","promoted_object","bid_amount","bid_strategy","targeting_lookup_ids","budget_mode","page_id"]);
    if(input.page_id!==undefined&&input.destination_type!=="APP")throw new PlatformDenied("APP_ADSET_PAGE_CONTEXT_ONLY");
    const lead=input.destination_type==="ON_AD"&&input.optimization_goal==="LEAD_GENERATION",app=input.destination_type==="APP"&&["APP_INSTALLS","OFFSITE_CONVERSIONS"].includes(String(input.optimization_goal));
    if((!lead&&!app&&(input.destination_type!=="WEBSITE"||input.optimization_goal!=="LINK_CLICKS"))||(input.billing_event!==undefined&&input.billing_event!=="IMPRESSIONS"))throw new PlatformDenied("LEGACY_ADSET_OBJECTIVE_CONTRACT_HOLD");
    let appTargeting:ReturnType<typeof buildAppInstallAdset>|undefined;if(app){appTargeting=buildAppInstallAdset(input.promoted_object,input.targeting);refs.push(...appTargeting.assets,{type:"PAGE",id:numericId(input.page_id)});body.promoted_object=appTargeting.body;}else if(lead){const promoted=input.promoted_object;if(!promoted||typeof promoted!=="object"||Array.isArray(promoted)||Object.keys(promoted).join()!=="page_id")throw new PlatformDenied("TYPED_LEAD_PROMOTED_PAGE_REQUIRED");const page={type:"PAGE" as const,id:numericId((promoted as Record<string,unknown>).page_id)};refs.push(page);body.promoted_object={page_id:page.id};}else if(input.promoted_object!==undefined)throw new PlatformDenied("LEGACY_COMPLEX_AD_CREATION_HOLD");budgetMode=applyAdsetBudget(input,body,lead);
    const targeting=appTargeting?{body:appTargeting.targeting,assets:[]}:buildLegacyTargeting(input.targeting);refs.push(...targeting.assets);
    const campaign:AssetRef={type:"CAMPAIGN",id:numericId(input.campaign_id)};refs.push(campaign);
    Object.assign(body,{campaign_id:campaign.id,destination_type:app?"APP":lead?"ON_AD":"WEBSITE",optimization_goal:app?String(input.optimization_goal):lead?"LEAD_GENERATION":"LINK_CLICKS",billing_event:"IMPRESSIONS",targeting:targeting.body});

    edge="adsets";
  } else {
    requireKeys(input,["account_id","name","ad_set_id","creative_id","status","page_id","lead_form_id","application_id"]);
    const adset:AssetRef={type:"AD_SET",id:numericId(input.ad_set_id)},creative:AssetRef={type:"CREATIVE",id:numericId(input.creative_id)};refs.push(adset,creative);
    body.adset_id=adset.id;body.creative={creative_id:creative.id};edge="ads";
    if(input.page_id!==undefined&&input.application_id===undefined&&input.lead_form_id===undefined)throw new PlatformDenied("AD_PAGE_CONTEXT_REQUIRES_TYPED_DESTINATION");
    if(input.application_id!==undefined){requireAppPromotionEngineering();refs.push({type:"APP",id:numericId(input.application_id)},{type:"PAGE",id:numericId(input.page_id)});}
    if(input.lead_form_id!==undefined)refs.push({type:"PAGE",id:numericId(input.page_id)},{type:"LEAD_FORM",id:numericId(input.lead_form_id)});
  }
  const plan:OperationPlan={parameters:{status:"PAUSED",legacy_write_step:{path:`/${root.id}/${edge}`,body}},assets:refs,classes:["WRITE_AD_CONFIGURATION"],createOrCopy:true,capability:`legacy.${tool}`,requiredScopes:expandVerifiedPermissionDependencies(["ads_management"]),tokenTypes:["user","system_user"]};
  if(refs.some(a=>a.type==="APP")){plan.parameters.app_promotion=true;plan.tokenTypes=["user"];plan.requiredAssetTasks=refs.filter(a=>a.type==="PAGE").map(asset=>({asset,tasks:["ADVERTISE"]}));}
  if(budgetMode==="CAMPAIGN")plan.parameters.marketing_budget_mode="CAMPAIGN";
  if(input.targeting_lookup_ids!==undefined)plan.parameters.targeting_lookup_ids=z.array(z.string().uuid()).min(1).max(5).parse(input.targeting_lookup_ids).sort();
  const lead=body.objective==="OUTCOME_LEADS"||body.optimization_goal==="LEAD_GENERATION"||refs.some(a=>a.type==="LEAD_FORM");
  if(lead){plan.requiredScopes=expandVerifiedPermissionDependencies(["ads_management","pages_manage_ads"]);plan.tokenTypes=["page"];plan.requiredAssetTasks=refs.filter(a=>a.type==="PAGE").map(asset=>({asset,tasks:["ADVERTISE"]}));}
  if(input.source_ad_id!==undefined){if(tool!=="ads_create_ad_creative"||lead||plan.parameters.app_promotion===true)throw new PlatformDenied("SOURCE_AD_TRAFFIC_CREATIVE_ONLY");const source=numericId(input.source_ad_id);plan.assets.push({type:"AD",id:source});plan.parameters.marketing_source_ad_id=source;plan.tokenTypes=["user"];plan.requiredAssetTasks=refs.filter(a=>a.type==="PAGE").map(asset=>({asset,tasks:["ADVERTISE"]}));}
  plan.classes=classifyPlan(plan);return plan;
}
/** Trusted persisted evidence, never caller headers or inline eligibility, gates execution. */
export function validateLegacyWriteSnapshot(plan:OperationPlan,snapshot:AuthorizationSnapshot,now=Date.now()):void {
  assertAppPromotionPlanSnapshot(plan,snapshot,now);
  if(plan.parameters.app_promotion===true||snapshot.connection.eligibility?.some(e=>e.requirement===legacyMarketingWriteRequirement()&&e.attestationId))assertManualEligibilityAttestation(legacyMarketingWriteEligibilityContract(),snapshot.connection,legacyMarketingWriteRequirement(),snapshot.manualEligibilityEvidence,snapshot.client.id,now);
  if(plan.parameters.expected_original_creative_id){const target=snapshot.assets.find(a=>a.type==="AD"&&a.id===plan.parameters.marketing_source_ad_id);if(!target||target.parents.filter(p=>p.type==="CREATIVE").length!==1||!target.parents.some(p=>p.type==="CREATIVE"&&p.id===plan.parameters.expected_original_creative_id))throw new PlatformDenied("REPOINT_CURRENT_OLD_CREATIVE_REQUIRED");}
  if(plan.parameters.expected_original_creative_id&&process.env.LUMIN_MARKETING_CREATIVE_REPLACEMENT_ENABLED!=="true")throw new PlatformDenied("UPDATE_CREATIVE_REPLACEMENT_TASK_PROOF_HOLD");
  if(plan.parameters.marketing_budget_mode==="CAMPAIGN"&&!marketingCboEnabled())throw new PlatformDenied("MARKETING_CBO_DISABLED_BY_DEPLOYMENT");
  const intentHash=compatibilityIntentHash({principal:{tenantId:snapshot.tenant.id,operatorId:snapshot.member.operatorId},clientId:snapshot.client.id,provider:snapshot.connection.provider,tool:plan.capability.replace(/^legacy\./,""),requestId:"intent-check"},plan,snapshot.connection);
  const requireEvidence=(requirement:string,exactIntent=false):void=>{
    if(!snapshot.connection.eligibility?.some(e=>e.requirement===requirement&&(!exactIntent||e.bindingHash===intentHash)&&e.verified&&e.checkedAt>0&&e.checkedAt<=now&&now-e.checkedAt<=300000&&e.expiresAt>now&&official(e.source)))throw new PlatformDenied(`UNVERIFIED_MARKETING_WRITE_ELIGIBILITY:${requirement}`);
  };
  requireEvidence(`marketing_write_access:${resolveMetaApiVersion()}`);
  for(const app of plan.assets.filter(a=>a.type==="APP")){const account=snapshot.assets.find(a=>a.type==="AD_ACCOUNT");if(!account)throw new PlatformDenied("APP_PROMOTION_ACCOUNT_REQUIRED");requireEvidence(`marketing_app_assignment:${app.id}:${account.id.replace(/^act_/,"")}`,true);if(snapshot.assets.find(a=>a.type==="APP"&&a.id===app.id)?.appPromotionEvidence?.binding.optimizationMode==="PURCHASE")requireEvidence(`marketing_app_purchase_event:${app.id}`,true);}
  const accounts=snapshot.assets.filter(a=>a.type==="AD_ACCOUNT");
  const account=accounts.length===1?accounts[0]:undefined;
  if(!account)throw new PlatformDenied("EXACT_FINANCIAL_EVIDENCE_REQUIRED");
  assertAgencyAdvertisingAuthorization(snapshot,account,plan.classes.filter(c=>["WRITE_AD_CONFIGURATION","WRITE_BUDGET","ACTIVATE_SPEND"].includes(c)) as ("WRITE_AD_CONFIGURATION"|"WRITE_BUDGET"|"ACTIVATE_SPEND")[],now);
  const reaches=(ref:AssetRef,seen=new Set<string>()):boolean=>{
    const a=snapshot.assets.find(a=>a.type===ref.type&&a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,""));
    if(!a||seen.has(a.key))return false;if(a.key===account.key)return true;
    return a.parents.some(p=>reaches(p,new Set([...seen,a.key])));
  };
  for(const ref of plan.assets)if(!((plan.capability==="legacy.ads_create_ad_creative"||plan.capability==="legacy.ads_update_ad"&&!!plan.parameters.expected_original_creative_id||plan.tokenTypes.length===1&&plan.tokenTypes[0]==="page"||plan.parameters.app_promotion===true)&&ref.type==="PAGE")&&!(plan.tokenTypes.length===1&&plan.tokenTypes[0]==="page"&&ref.type==="LEAD_FORM")&&!reaches(ref))throw new PlatformDenied("LEGACY_WRITE_PARENT_ACCOUNT_MISMATCH");
  if(LEGACY_UPDATE_TOOLS.includes(plan.capability.replace(/^legacy\./,""))){if(plan.capability!=="legacy.ads_update_ad_creative"&&plan.assets.some(a=>a.type==="CREATIVE")){const pages=snapshot.assets.filter(a=>a.type==="PAGE");if(pages.length!==1||!snapshot.grants.some(g=>g.assetKey===pages[0].key&&g.connectionId===snapshot.connection.id&&g.revokedAt===null&&g.expiresAt>now&&g.verifiedAt>0&&g.verifiedAt<=now&&now-g.verifiedAt<=300000&&g.tasks.includes("ADVERTISE")))throw new PlatformDenied("UPDATE_CREATIVE_CURRENT_PAGE_ADVERTISE_REQUIRED");}requireEvidence(`marketing_update_state:${plan.capability.replace(/^legacy\./,"")}:${plan.assets[0].id}`,true);return;}
  if(plan.tokenTypes.length===1&&plan.tokenTypes[0]==="page"){
    const pages=plan.assets.filter(a=>a.type==="PAGE");if(pages.length!==1)throw new PlatformDenied("LEAD_EXACT_PAGE_CONTEXT_REQUIRED");const page=pages[0];
    requireEvidence(`marketing_creative_page_advertise:${page.id}:${account.id.replace(/^act_/,"")}`,true);requireEvidence(`marketing_lead_terms_accepted:${page.id}`);
    for(const form of plan.assets.filter(a=>a.type==="LEAD_FORM")){const registered=snapshot.assets.find(a=>a.type==="LEAD_FORM"&&a.id===form.id);if(!registered||registered.parents.filter(p=>p.type==="PAGE").length!==1||!registered.parents.some(p=>p.type==="PAGE"&&p.id===page.id))throw new PlatformDenied("LEAD_FORM_PAGE_PROVENANCE_REQUIRED");requireEvidence(`marketing_lead_form_eligible:${form.id}:${page.id}`,true);if(plan.capability==="legacy.ads_create_ad"){const creative=snapshot.assets.find(a=>a.type==="CREATIVE"&&plan.assets.some(ref=>ref.type==="CREATIVE"&&ref.id===a.id));if(!creative?.parents.some(p=>p.type==="LEAD_FORM"&&p.id===form.id)||!creative.parents.some(p=>p.type==="PAGE"&&p.id===page.id))throw new PlatformDenied("LEAD_CREATIVE_FORM_PROVENANCE_REQUIRED");}}
  }
  if(plan.capability==="legacy.ads_create_ad_creative"){
    const step=plan.parameters.legacy_write_step as WriteStep,story=step.body.object_story_spec as Record<string,unknown>,link=(story.link_data??story.video_data) as Record<string,unknown>;
    if(story.video_data){if(!marketingVideoCreativeEnabled())throw new PlatformDenied("MARKETING_VIDEO_CREATIVE_DISABLED");requireEvidence(`marketing_video_ready:${String(link.video_id)}:${account.id.replace(/^act_/,"")}`,true);}
    requireEvidence(`marketing_creative_page_advertise:${String(story.page_id)}:${account.id.replace(/^act_/,"")}`,true);
    if(!plan.assets.some(a=>a.type==="LEAD_FORM")&&plan.parameters.app_promotion!==true)requireEvidence(`marketing_creative_destination:${new URL(String(link.link??((link.call_to_action as {value?:{link?:string}})?.value?.link))).origin}`);
  }
  for(const ref of plan.assets.filter(a=>a.type==="AD_VIDEO")){if(!marketingVideoCreativeEnabled())throw new PlatformDenied("MARKETING_VIDEO_CREATIVE_DISABLED");requireEvidence(`marketing_video_ready:${ref.id}:${account.id.replace(/^act_/,"")}`,true);}
  // Evidence attests actual parent objective/budget compatibility or full inspected creative reference closure.
  for(const ref of plan.assets){if(ref.type==="CAMPAIGN")requireEvidence(`marketing_adset_parent_compatibility:${ref.id}`,true);if(ref.type==="AD_SET"&&plan.capability==="legacy.ads_create_ad")requireEvidence(`marketing_adset_delivery_compatibility:${ref.id}`,true);if(ref.type==="CREATIVE")requireEvidence(`marketing_creative_reference_closure:${ref.id}`,true);}
}
interface WriteStep {path:string;body:Record<string,unknown>}
async function singleWrite(tool:string,plan:OperationPlan):Promise<{id:string;requestId?:string}> {
  const permit=assertExecutionPermit({provider:"META_MARKETING",mutation:true,tool});
  const scope=getExecutionScope();
  if(canonicalJson(scope.plan)!==canonicalJson(plan))throw new PlatformDenied("LEGACY_WRITE_PLAN_MISMATCH");
  validateLegacyWriteSnapshot(plan,scope.snapshot);
  const step=plan.parameters.legacy_write_step as WriteStep;
  const creative=tool==="ads_create_ad_creative",creativeRename=tool==="ads_update_ad_creative";
  const update=LEGACY_UPDATE_TOOLS.includes(tool);
  if(!(update?new RegExp(`^/${plan.assets[0].id}$`).test(step.path):/^\/act_\d{1,32}\/(campaigns|adsets|ads|adcreatives)$/.test(step.path))||(creativeRename?(Object.keys(step.body).length!==1||typeof step.body.name!=="string"):creative?(!step.path.endsWith("/adcreatives")||"status"in step.body):step.body.status!=="PAUSED"))throw new PlatformDenied("LEGACY_WRITE_ENDPOINT_DENIED");
  const form=new URLSearchParams();
  for(const [key,value] of Object.entries(step.body))form.set(key,typeof value==="object"?canonicalJson(value):String(value));
  return withConnectionCredential(permit,async token=>{
    if(canonicalJson(await bindLegacyTargetingEvidence(getPlatformRepository(),scope.context,plan))!==canonicalJson(plan))throw new PlatformDenied("TARGETING_REVIEW_PLAN_CHANGED");
    if(plan.parameters.expected_original_creative_id)await inspectLegacyRepoint(plan,token);
    else if(plan.parameters.marketing_source_ad_id)await inspectSourceAdCreation(plan,token);
    await revalidateExecutionPermit(permit);
    validateLegacyWriteSnapshot(plan,getExecutionScope().snapshot);
    const lookupBinding=plan.parameters.targeting_lookup_selected as {lookups?:Array<{expiresAt:number}>}|undefined;
    if(lookupBinding?.lookups?.some(row=>row.expiresAt<=Date.now()))throw new PlatformDenied("TARGETING_LOOKUP_EXPIRED_AT_EGRESS");
    const connection=getExecutionScope().snapshot.connection,bucket=createHash("sha256").update(JSON.stringify(["META_MARKETING",connection.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");
    productRateController.bind(bucket,connection.appId);
    productRateController.check(bucket);
    claimMutationStep(permit);
    try {
      const response=await fetch(`https://graph.facebook.com/v26.0${step.path}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/x-www-form-urlencoded"},body:form.toString(),redirect:"error",signal:AbortSignal.timeout(15000)});
      productRateController.observe(bucket,response,null);
      const raw=JSON.parse(await readBodyWithLimit(response,128*1024)) as {id?:unknown;error?:{code?:unknown};success?:unknown};
      productRateController.observe(bucket,response,typeof raw.error?.code==="number"?raw.error.code:null);
      if(!response.ok || raw.error || (update?raw.success!==true:typeof raw.id!=="string"||!/^\d{1,32}$/.test(raw.id)))throw new Error("invalid response");
      const requestId=response.headers.get("x-fb-request-id");
      return {id:update?plan.assets[0].id:raw.id as string,...(requestId&&/^[A-Za-z0-9_-]{1,128}$/.test(requestId)?{requestId}:{})};
    } catch {throw new PlatformDenied("LEGACY_WRITE_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED");}
  });
}
export async function executeStrictLegacyWrite(tool:string,input:Record<string,unknown>):Promise<{content:Array<{type:"text";text:string}>}> {
  let plan=buildStrictLegacyWritePlan(tool,input);
  if(typeof input.client_id!=="string")throw new PlatformDenied("CLIENT_CONTEXT_REQUIRED");
  const ctx=await resolveOperationContext(input.client_id,tool,"META_MARKETING");
  plan=await bindLegacyTargetingEvidence(getPlatformRepository(),ctx,plan);
  const permit=await authorizeOperation(getPlatformRepository(),ctx,plan,{writesEnabled:platformWritesEnabled(),...(typeof input.approval_id==="string"?{approvalId:input.approval_id}:{})});
  let result:{id:string;requestId?:string};
  try {result=await runWithExecutionPermit(permit,()=>singleWrite(tool,plan));}
  catch(error){await finishOperation(permit,error instanceof PlatformDenied&&error.reason==="LEGACY_WRITE_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED"?"UNKNOWN":"FAILED");throw error;}
  if(plan.parameters.expected_original_creative_id){const completed=await finishRepointedAd(permit);return {...(!completed?{isError:true}:{}),content:[{type:"text",text:JSON.stringify({status:completed?"SUCCEEDED":"PARTIAL_RECONCILE_DONT_RETRY",updated_id:result.id,requested_status:"PAUSED",effective_status:"UNVERIFIED",registry_updated:completed,engagement_preservation:"NOT_ESTABLISHED",auto_chain:false,next_action:completed?"Provider accepted the separately approved paused creative replacement. Read state separately.":"Provider accepted the update but local completion was not established. Stop and reconcile; do not retry."})}]};}
  if(LEGACY_UPDATE_TOOLS.includes(tool)){await finishOperation(permit,"SUCCEEDED",result.requestId);return {content:[{type:"text",text:JSON.stringify({status:"SUCCEEDED",updated_id:result.id,...(tool==="ads_update_ad_creative"?{change:"CREATIVE_NAME_ONLY",delivery_change:"NONE_REQUESTED"}:{requested_status:"PAUSED",effective_status:"UNVERIFIED"}),auto_chain:false,next_action:"Provider accepted the reviewed update. Read status separately; any further change requires a new authorization and human approval."})}]};}
  const type=tool==="ads_create_campaign"?"CAMPAIGN":tool==="ads_create_ad_set"?"AD_SET":tool==="ads_create_ad_creative"?"CREATIVE":"AD";
  const parent=plan.assets.find(a=>a.type===(["CAMPAIGN","CREATIVE"].includes(type)?"AD_ACCOUNT":type==="AD_SET"?"CAMPAIGN":"AD_SET"))!;
  // Registry provenance, inherited grant, connection revision and terminal audit commit atomically.
  const registered=await finishCreatedAsset(permit,{id:result.id,type,parent});
  return {content:[{type:"text",text:JSON.stringify({status:registered?"SUCCEEDED":"PARTIAL",created_id:result.id,requested_status:type==="CREATIVE"?"NOT_APPLICABLE":"PAUSED",effective_status:type==="CREATIVE"?"NOT_APPLICABLE":"UNVERIFIED",registered,auto_chain:false,next_action:registered?"Any subsequent operation requires a new authorization and human approval.":"Trusted provenance reconciliation required before this created asset can be used."})}]};
}

