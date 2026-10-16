import { assertNoCredentialShapedString } from "./input-safety.js";
import { z } from "zod";
import { resolveMetaApiVersion } from "../meta/api-version.js";
import { readBodyWithLimit } from "../utils/bounded-body.js";
import { PlatformDenied, type AssetRef, type AuthorizationSnapshot, type OperationPlan } from "./models.js";
import { authorizeOperation, assertExecutionPermit, claimMutationStep, finishCreatedAsset, finishOperation, getExecutionScope, revalidateExecutionPermit, runWithExecutionPermit, withConnectionCredential } from "./execution.js";
import { canonicalJson, classifyPlan } from "./policy.js";
import { getPlatformRepository, platformWritesEnabled, resolveOperationContext } from "./runtime.js";

export const LEGACY_CORE_WRITE_TOOLS = Object.freeze(["ads_create_campaign","ads_create_ad_set","ads_create_ad"]);
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
function budget(value:unknown):string|undefined {
  if(value===undefined)return undefined;
  if(typeof value!=="number" || !Number.isSafeInteger(value) || value<1 || value>1_000_000_000)throw new PlatformDenied("LEGACY_WRITE_BUDGET_INVALID");
  return String(value);
}
/** The only accepted reference-bearing structures are constructed here, never passed through. */
export function buildStrictLegacyWritePlan(tool:string,input:Record<string,unknown>):OperationPlan {
  if(!LEGACY_CORE_WRITE_TOOLS.includes(tool))throw new PlatformDenied("LEGACY_STRICT_MIGRATION_HOLD");
  if(resolveMetaApiVersion()!=="v26.0")throw new PlatformDenied("UNVERIFIED_MARKETING_WRITE_VERSION");
  if(input.status!==undefined && input.status!=="PAUSED")throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
  if(typeof input.name!=="string" || !input.name.trim() || input.name.length>200 || /[\u0000-\u001f]/.test(input.name))throw new PlatformDenied("LEGACY_WRITE_NAME_INVALID");
  assertNoCredentialShapedString(input.name);
  const root:AssetRef={type:"AD_ACCOUNT",id:numericId(input.account_id,true)};
  const refs:AssetRef[]=[root];
  const body:Record<string,unknown>={name:input.name,status:"PAUSED"};
  let edge:string;
  if(tool==="ads_create_campaign") {
    requireKeys(input,["account_id","name","objective","status","special_ad_categories","daily_budget","buying_type","is_adset_budget_sharing_enabled"]);
    if(!["OUTCOME_TRAFFIC","OUTCOME_AWARENESS"].includes(String(input.objective)))throw new PlatformDenied("LEGACY_OBJECTIVE_CONTRACT_HOLD");
    if(input.buying_type!==undefined && input.buying_type!=="AUCTION")throw new PlatformDenied("LEGACY_RESERVED_BUYING_HOLD");
    const categories=input.special_ad_categories;
    if(categories!==undefined && (!Array.isArray(categories)||!([0,1].includes(categories.length))||(categories.length===1&&categories[0]!=="NONE")))throw new PlatformDenied("LEGACY_SPECIAL_CATEGORY_CREATION_HOLD");
    if(input.is_adset_budget_sharing_enabled===true)throw new PlatformDenied("LEGACY_BUDGET_SHARING_HOLD");
    body.objective=input.objective;body.buying_type="AUCTION";body.special_ad_categories=[];
    const daily=budget(input.daily_budget);if(daily)body.daily_budget=daily;else body.is_adset_budget_sharing_enabled=false;
    edge="campaigns";
  } else if(tool==="ads_create_ad_set") {
    requireKeys(input,["account_id","campaign_id","name","destination_type","status","daily_budget","optimization_goal","billing_event","targeting"]);
    if(input.destination_type!=="WEBSITE" || input.optimization_goal!=="LINK_CLICKS" || (input.billing_event!==undefined&&input.billing_event!=="IMPRESSIONS"))throw new PlatformDenied("LEGACY_ADSET_OBJECTIVE_CONTRACT_HOLD");
    const targeting=input.targeting as Record<string,unknown>|undefined;
    const geo=targeting?.geo_locations as Record<string,unknown>|undefined;
    const countries=geo?.countries;
    if(!targeting||Array.isArray(targeting)||Object.keys(targeting).join()!=="geo_locations"||!geo||Array.isArray(geo)||Object.keys(geo).join()!=="countries"||!Array.isArray(countries)||countries.length<1||countries.length>10||countries.some(c=>typeof c!=="string"||! /^[A-Z]{2}$/.test(c))||new Set(countries).size!==countries.length)throw new PlatformDenied("LEGACY_COMPLEX_TARGETING_HOLD");
    const campaign:AssetRef={type:"CAMPAIGN",id:numericId(input.campaign_id)};refs.push(campaign);
    Object.assign(body,{campaign_id:campaign.id,destination_type:"WEBSITE",optimization_goal:"LINK_CLICKS",billing_event:"IMPRESSIONS",targeting:{geo_locations:{countries:[...countries].sort()}}});
    const daily=budget(input.daily_budget);if(daily)body.daily_budget=daily;
    edge="adsets";
  } else {
    requireKeys(input,["account_id","name","ad_set_id","creative_id","status"]);
    const adset:AssetRef={type:"AD_SET",id:numericId(input.ad_set_id)},creative:AssetRef={type:"CREATIVE",id:numericId(input.creative_id)};refs.push(adset,creative);
    body.adset_id=adset.id;body.creative={creative_id:creative.id};edge="ads";
  }
  const plan:OperationPlan={parameters:{status:"PAUSED",legacy_write_step:{path:`/${root.id}/${edge}`,body}},assets:refs,classes:["WRITE_AD_CONFIGURATION"],createOrCopy:true,capability:`legacy.${tool}`,requiredScopes:["ads_management"],tokenTypes:["user","system_user"]};
  plan.classes=classifyPlan(plan);return plan;
}
/** Trusted persisted evidence, never caller headers or inline eligibility, gates execution. */
export function validateLegacyWriteSnapshot(plan:OperationPlan,snapshot:AuthorizationSnapshot,now=Date.now()):void {
  const requireEvidence=(requirement:string):void=>{
    if(!snapshot.connection.eligibility?.some(e=>e.requirement===requirement&&e.verified&&e.checkedAt>0&&e.checkedAt<=now&&now-e.checkedAt<=300000&&e.expiresAt>now&&official(e.source)))throw new PlatformDenied(`UNVERIFIED_MARKETING_WRITE_ELIGIBILITY:${requirement}`);
  };
  requireEvidence(`marketing_write_access:${resolveMetaApiVersion()}`);
  const account=snapshot.assets.find(a=>a.type==="AD_ACCOUNT"&&a.id.replace(/^act_/,"")===plan.assets[0].id.replace(/^act_/,""));
  if(!account?.ownerBusinessId || !/^\d{1,32}$/.test(account.ownerBusinessId) || account.billingOwnershipVerified!==true || !account.ownershipEvidenceSource || !official(account.ownershipEvidenceSource) || !snapshot.client.verifiedBusinessIds.includes(account.ownerBusinessId))throw new PlatformDenied("CLIENT_OWNED_ACCOUNT_AND_BILLING_EVIDENCE_REQUIRED");
  const reaches=(ref:AssetRef,seen=new Set<string>()):boolean=>{
    const a=snapshot.assets.find(a=>a.type===ref.type&&a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,""));
    if(!a||seen.has(a.key))return false;if(a.key===account.key)return true;
    return a.parents.some(p=>reaches(p,new Set([...seen,a.key])));
  };
  for(const ref of plan.assets.slice(1))if(!reaches(ref))throw new PlatformDenied("LEGACY_WRITE_PARENT_ACCOUNT_MISMATCH");
  // Evidence attests actual parent objective/budget compatibility or full inspected creative reference closure.
  for(const ref of plan.assets){if(ref.type==="CAMPAIGN")requireEvidence(`marketing_adset_parent_compatibility:${ref.id}`);if(ref.type==="CREATIVE")requireEvidence(`marketing_creative_reference_closure:${ref.id}`);}
}
interface WriteStep {path:string;body:Record<string,unknown>}
async function singleWrite(tool:string,plan:OperationPlan):Promise<{id:string;requestId?:string}> {
  const permit=assertExecutionPermit({provider:"META_MARKETING",mutation:true,tool});
  const scope=getExecutionScope();
  if(canonicalJson(scope.plan)!==canonicalJson(plan))throw new PlatformDenied("LEGACY_WRITE_PLAN_MISMATCH");
  validateLegacyWriteSnapshot(plan,scope.snapshot);
  const step=plan.parameters.legacy_write_step as WriteStep;
  if(!/^\/act_\d{1,32}\/(campaigns|adsets|ads)$/.test(step.path)||step.body.status!=="PAUSED")throw new PlatformDenied("LEGACY_WRITE_ENDPOINT_DENIED");
  const form=new URLSearchParams();
  for(const [key,value] of Object.entries(step.body))form.set(key,typeof value==="object"?canonicalJson(value):String(value));
  return withConnectionCredential(permit,async token=>{
    await revalidateExecutionPermit(permit);
    validateLegacyWriteSnapshot(plan,getExecutionScope().snapshot);
    claimMutationStep(permit);
    try {
      const response=await fetch(`https://graph.facebook.com/v26.0${step.path}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/x-www-form-urlencoded"},body:form.toString(),redirect:"error",signal:AbortSignal.timeout(15000)});
      const raw=JSON.parse(await readBodyWithLimit(response,128*1024)) as {id?:unknown;error?:unknown};
      if(!response.ok || raw.error || typeof raw.id!=="string" || !/^\d{1,32}$/.test(raw.id))throw new Error("invalid response");
      const requestId=response.headers.get("x-fb-request-id");
      return {id:raw.id,...(requestId&&/^[A-Za-z0-9_-]{1,128}$/.test(requestId)?{requestId}:{})};
    } catch {throw new PlatformDenied("LEGACY_WRITE_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED");}
  });
}
export async function executeStrictLegacyWrite(tool:string,input:Record<string,unknown>):Promise<{content:Array<{type:"text";text:string}>}> {
  const plan=buildStrictLegacyWritePlan(tool,input);
  if(typeof input.client_id!=="string")throw new PlatformDenied("CLIENT_CONTEXT_REQUIRED");
  const ctx=await resolveOperationContext(input.client_id,tool,"META_MARKETING");
  const permit=await authorizeOperation(getPlatformRepository(),ctx,plan,{writesEnabled:platformWritesEnabled(),...(typeof input.approval_id==="string"?{approvalId:input.approval_id}:{})});
  let result:{id:string;requestId?:string};
  try {result=await runWithExecutionPermit(permit,()=>singleWrite(tool,plan));}
  catch(error){await finishOperation(permit,error instanceof PlatformDenied&&error.reason==="LEGACY_WRITE_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED"?"UNKNOWN":"FAILED");throw error;}
  const type=tool==="ads_create_campaign"?"CAMPAIGN":tool==="ads_create_ad_set"?"AD_SET":"AD";
  const parent=plan.assets.find(a=>a.type===(type==="CAMPAIGN"?"AD_ACCOUNT":type==="AD_SET"?"CAMPAIGN":"AD_SET"))!;
  // Registry provenance, inherited grant, connection revision and terminal audit commit atomically.
  const registered=await finishCreatedAsset(permit,{id:result.id,type,parent});
  return {content:[{type:"text",text:JSON.stringify({status:registered?"SUCCEEDED":"PARTIAL",created_id:result.id,requested_status:"PAUSED",effective_status:"UNVERIFIED",registered,auto_chain:false,next_action:registered?"Any subsequent operation requires a new authorization and human approval.":"Trusted provenance reconciliation required before this created asset can be used."})}]};
}
