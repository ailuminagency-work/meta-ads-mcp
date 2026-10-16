import { requestContext } from "../auth/token-store.js";
import { metaApiClient } from "../meta/client.js";
import { z } from "zod";
import { authorizeOperation, finishOperation, runWithExecutionPermit, withConnectionCredential } from "./execution.js";
import { getPlatformRepository, resolveOperationContext } from "./runtime.js";
import { PlatformDenied, type AssetRef, type AssetType, type MetaAsset, type OperationContext, type OperationPlan } from "./models.js";
import { assertLegacyMarketingReadEligibility, type LegacyReadStep } from "./legacy-egress.js";
import { LEGACY_MANIFEST } from "./legacy-manifest.js";

export const LEGACY_CORE_READ_TOOLS = Object.freeze(["ads_get_ad_accounts","ads_get_account_info","ads_get_campaigns","ads_get_campaign_details","ads_get_ad_sets","ads_get_ad_set_details","ads_get_ads","ads_get_ad_details","ads_get_ad_entities","ads_get_insights","ads_insights_performance_trend","ads_insights_advertiser_context"]);
export const LEGACY_CORE_READ_DOCUMENTATION = Object.freeze(["https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi", "https://www.postman.com/meta/facebook-marketing-api/request/u07tack/get-ad-insights-l1", "https://www.postman.com/meta/facebook-marketing-api/request/vhwas2d/retrieving-adset-details-l2", "https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/README.md", "https://github.com/facebook/facebook-php-business-sdk/blob/main/src/FacebookAds/Object/AdAccount.php"]);
export const legacyClientSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).describe("Explicit registered Lumin client identifier; authenticated membership is checked server-side.");
const ACCOUNT_FIELDS=["id","account_id","name","account_status","currency","timezone_name","business_name","amount_spent","balance","spend_cap","created_time","disable_reason"];
const CAMPAIGN_FIELDS=["id","account_id","name","objective","status","effective_status","buying_type","daily_budget","lifetime_budget","budget_remaining","bid_strategy","special_ad_categories","created_time","updated_time","start_time","stop_time"];
const ADSET_FIELDS=["id","account_id","campaign_id","name","status","effective_status","optimization_goal","billing_event","bid_amount","daily_budget","lifetime_budget","start_time","end_time","created_time","updated_time"];
const AD_FIELDS=["id","account_id","campaign_id","adset_id","name","status","effective_status","bid_amount","created_time","updated_time"];
const INSIGHT_FIELDS=["account_id","campaign_id","adset_id","ad_id","date_start","date_stop","impressions","clicks","spend","reach","frequency","ctr","cpc","cpm","actions","cost_per_action_type"];
const fieldSets:Partial<Record<AssetType,string[]>>={AD_ACCOUNT:ACCOUNT_FIELDS,CAMPAIGN:CAMPAIGN_FIELDS,AD_SET:ADSET_FIELDS,AD:AD_FIELDS};
function normalizedId(value:unknown,account=false):string {if(typeof value!=="string"||! /^(?:act_)?\d{1,32}$/.test(value)||(!account&&value.startsWith("act_")))throw new PlatformDenied("LEGACY_ASSET_ID_INVALID");return account?`act_${value.replace(/^act_/,"")}`:value;}
function int(value:unknown,fallback:number,max:number):number {if(value===undefined)return fallback;if(typeof value!=="number"||!Number.isInteger(value)||value<1||value>max)throw new PlatformDenied("LEGACY_BOUNDED_LIMIT_REQUIRED");return value;}
function fields(value:unknown,defaults:string[]):string[] {if(value===undefined)return [...defaults];if(!Array.isArray(value)||!value.length||value.length>30||value.some(v=>typeof v!=="string"||!defaults.includes(v)))throw new PlatformDenied("LEGACY_FIELD_PROJECTION_DENIED");return [...new Set(["id",...value as string[]])].filter(v=>defaults.includes(v));}
function statuses(value:unknown):string|undefined {if(value===undefined)return undefined;if(!Array.isArray(value)||!value.length||value.length>4||value.some(v=>!["ACTIVE","PAUSED","DELETED","ARCHIVED"].includes(String(v))))throw new PlatformDenied("LEGACY_STATUS_FILTER_INVALID");return JSON.stringify([{field:"effective_status",operator:"IN",value}]);}
function rootRef(type:AssetType,id:unknown):AssetRef{return {type,id:normalizedId(id,type==="AD_ACCOUNT")};}
function sameRef(a:AssetRef,b:AssetRef):boolean{return a.type===b.type&&a.id.replace(/^act_/,"")===b.id.replace(/^act_/,"");}
function findRef(value:unknown,assets:MetaAsset[],allowed:AssetType[]):AssetRef {
  const id=normalizedId(value,typeof value==="string"&&value.startsWith("act_"));
  const matched=assets.filter(a=>allowed.includes(a.type)&&a.id.replace(/^act_/,"")===id.replace(/^act_/,"")&&(!id.startsWith("act_")||a.type==="AD_ACCOUNT"));
  if(matched.length!==1)throw new PlatformDenied("LEGACY_ASSET_TYPE_AMBIGUOUS_OR_UNREGISTERED");return rootRef(matched[0].type,id);
}
function descendants(assets:MetaAsset[],root:AssetRef,types:AssetType[]):AssetRef[] {
  const reaches=(a:MetaAsset,visited:Set<string>):boolean=>{
    if(sameRef(a,root))return true;
    if(visited.has(a.key))throw new PlatformDenied("ASSET_PARENT_CYCLE");
    const next=new Set(visited);next.add(a.key);
    return a.parents.some(p=>sameRef(p,root)||assets.some(parent=>sameRef(parent,p)&&parent.appId===a.appId&&reaches(parent,next)));
  };
  return assets.filter(a=>types.includes(a.type)&&reaches(a,new Set())).map(a=>rootRef(a.type,a.id));
}
function datePreset(value:unknown):string {const allowed=["today","yesterday","this_month","last_month","this_quarter","last_3d","last_7d","last_14d","last_28d","last_30d","last_90d","last_week_mon_sun","last_week_sun_sat","last_quarter","last_year","this_week_mon_today","this_week_sun_today","this_year"];if(value===undefined)return "last_30d";if(typeof value!=="string"||!allowed.includes(value))throw new PlatformDenied("LEGACY_INSIGHT_DATE_RANGE_DENIED");return value;}
function clean(input:Record<string,unknown>):Record<string,unknown> {return Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined));}
function step(root:AssetRef,edge:string,projection:string[],query:Record<string,string|number|boolean>,entityType:LegacyReadStep["entityType"]):LegacyReadStep {return {path:`/${root.id}${edge}`,query:{fields:projection.join(","),...query},projection,root,list:edge!=="",entityType};}
interface BuiltPlan {steps:LegacyReadStep[];refs:AssetRef[]}
function buildPlan(tool:string,input:Record<string,unknown>,assets:MetaAsset[]):BuiltPlan {
  const limit=int(input.limit,25,100);const filter=statuses(input.status_filter);
  const query:Record<string,string|number|boolean>={limit,...(filter?{filtering:filter}:{})};
  let root:AssetRef;let type:AssetType;let edge="";let projection:string[];
  if(tool==="ads_get_account_info") {root=rootRef("AD_ACCOUNT",input.account_id);type="AD_ACCOUNT";projection=ACCOUNT_FIELDS;return {steps:[step(root,"",projection,{},type)],refs:[root]};}
  if(tool==="ads_get_campaigns"||tool==="ads_get_campaign_details") {root=rootRef(tool.endsWith("details")?"CAMPAIGN":"AD_ACCOUNT",tool.endsWith("details")?input.campaign_id:input.account_id);type="CAMPAIGN";edge=tool.endsWith("details")?"":"/campaigns";projection=fields(input.fields,CAMPAIGN_FIELDS);}
  else if(tool==="ads_get_ad_sets"||tool==="ads_get_ad_set_details") {root=tool.endsWith("details")?rootRef("AD_SET",input.ad_set_id):input.campaign_id?rootRef("CAMPAIGN",input.campaign_id):rootRef("AD_ACCOUNT",input.account_id);type="AD_SET";edge=tool.endsWith("details")?"":"/adsets";projection=fields(input.fields,ADSET_FIELDS);}
  else if(tool==="ads_get_ads"||tool==="ads_get_ad_details") {root=tool.endsWith("details")?rootRef("AD",input.ad_id):input.ad_set_id?rootRef("AD_SET",input.ad_set_id):input.campaign_id?rootRef("CAMPAIGN",input.campaign_id):rootRef("AD_ACCOUNT",input.account_id);type="AD";edge=tool.endsWith("details")?"":"/ads";projection=fields(input.fields,AD_FIELDS);}
  else if(tool==="ads_get_ad_entities") {
    const mapping:Record<string,AssetType>={campaign:"CAMPAIGN",ad_set:"AD_SET",ad:"AD"};type=mapping[String(input.entity_type)];if(!type)throw new PlatformDenied("LEGACY_ENTITY_TYPE_INVALID");
    root=findRef(input.parent_id,assets,type==="CAMPAIGN"?["AD_ACCOUNT"]:type==="AD_SET"?["CAMPAIGN"]:["AD_ACCOUNT","CAMPAIGN","AD_SET"]);edge=type==="CAMPAIGN"?"/campaigns":type==="AD_SET"?"/adsets":"/ads";projection=fields(input.fields,fieldSets[type]!);
  } else if(["ads_get_insights","ads_insights_performance_trend","ads_insights_advertiser_context"].includes(tool)) {
    root=tool==="ads_insights_advertiser_context"?rootRef("AD_ACCOUNT",input.account_id):findRef(input.object_id,assets,["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"]);
    if(input.breakdowns!==undefined||input.filtering!==undefined||input.time_range!==undefined||input.action_attribution_windows!==undefined)throw new PlatformDenied("LEGACY_COMPLEX_INSIGHTS_CONTRACT_HOLD");
    projection=[...new Set(["account_id","campaign_id","adset_id","ad_id",...fields(input.fields,INSIGHT_FIELDS)])].filter(f=>f!=="id");
    const insightQuery:Record<string,string|number|boolean>={limit:int(input.limit,100,100),date_preset:datePreset(input.date_preset),use_unified_attribution_setting:true};
    if(input.use_unified_attribution_setting===false)throw new PlatformDenied("LEGACY_ATTRIBUTION_OVERRIDE_HOLD");
    if(input.level!==undefined){const level=String(input.level);if(!["account","campaign","adset","ad_set","ad"].includes(level))throw new PlatformDenied("LEGACY_INSIGHT_LEVEL_INVALID");insightQuery.level=level==="ad_set"?"adset":level;}
    if(input.time_increment!==undefined){if(![1,7,"monthly","all_days"].includes(input.time_increment as string|number))throw new PlatformDenied("LEGACY_INSIGHT_INCREMENT_DENIED");insightQuery.time_increment=String(input.time_increment);}
    if(tool==="ads_insights_performance_trend"){if(!["daily","weekly","monthly"].includes(String(input.granularity??"daily")))throw new PlatformDenied("LEGACY_INSIGHT_INCREMENT_DENIED");insightQuery.time_increment=input.granularity==="monthly"?"monthly":input.granularity==="weekly"?7:1;delete insightQuery.level;}
    const refs=[root,...descendants(assets,root,["CAMPAIGN","AD_SET","AD"])];
    const steps=[step(root,"/insights",projection,insightQuery,"INSIGHTS")];
    if(tool==="ads_insights_advertiser_context") {
      steps.push(step(root,"",ACCOUNT_FIELDS,{},"AD_ACCOUNT"));
      steps.push(step(root,"/insights",["account_id","campaign_id","campaign_name","spend","impressions","clicks","ctr","cpc"],{...insightQuery,level:"campaign",limit:int(input.top_n_campaigns,5,20)},"INSIGHTS"));
    }
    return {steps,refs};
  } else throw new PlatformDenied("LEGACY_STRICT_MIGRATION_HOLD");
  const refs=[root,...(edge?descendants(assets,root,[type]):[])];
  if(input.account_id!==undefined){const account=rootRef("AD_ACCOUNT",input.account_id);refs.push(account);if(!sameRef(root,account)&&!descendants(assets,account,[root.type]).some(r=>sameRef(r,root)))throw new PlatformDenied("LEGACY_PARENT_ACCOUNT_MISMATCH");}
  if(input.campaign_id!==undefined){const campaign=rootRef("CAMPAIGN",input.campaign_id);refs.push(campaign);if(!sameRef(root,campaign)&&!descendants(assets,campaign,[root.type]).some(r=>sameRef(r,root)))throw new PlatformDenied("LEGACY_PARENT_CAMPAIGN_MISMATCH");}
  return {steps:[step(root,edge,projection,edge?query:{},type)],refs};
}
async function executePlan(ctx:OperationContext,input:Record<string,unknown>,built:BuiltPlan):Promise<unknown[]> {
  const repo=getPlatformRepository();
  const plan:OperationPlan={parameters:{input:clean(input),legacy_read_steps:built.steps},assets:built.refs,classes:["READ"],capability:`legacy.${ctx.tool}`,requiredScopes:["ads_read"],tokenTypes:["user","system_user"]};
  const permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:false});
  try {
    const result=await runWithExecutionPermit(permit,async()=>{
      assertLegacyMarketingReadEligibility();
      return withConnectionCredential(permit,async accessToken=>requestContext.run({accessToken,fbUserId:ctx.principal.operatorId},async()=>{
        const output:unknown[]=[];
        for(const item of built.steps)output.push(await metaApiClient.get(item.path,item.query));
        return output;
      }));
    });
    await finishOperation(permit,"SUCCEEDED");return result;
  } catch(error){await finishOperation(permit,"FAILED");throw error;}
}
export async function executeStrictLegacyRead(tool:string,input:Record<string,unknown>):Promise<{content:Array<{type:"text";text:string}>}> {
  if(!LEGACY_CORE_READ_TOOLS.includes(tool))throw new PlatformDenied("LEGACY_STRICT_MIGRATION_HOLD");
  const allowedKeys=new Set([...(LEGACY_MANIFEST.find(entry=>entry.name===tool)?.inputKeys??[]),"client_id"]);
  if(Object.keys(input).some(key=>!allowedKeys.has(key)))throw new PlatformDenied("LEGACY_INPUT_KEY_DENIED");
  const clientId=input.client_id;if(typeof clientId!=="string")throw new PlatformDenied("CLIENT_CONTEXT_REQUIRED");
  const ctx=await resolveOperationContext(clientId,tool,"META_MARKETING");
  const repo=getPlatformRepository();
  const assets=(await repo.list("assets",ctx.principal.tenantId)).filter(a=>a.tenantId===ctx.principal.tenantId&&a.clientId===ctx.clientId&&a.provider==="META_MARKETING"&&a.revokedAt===null);
  let data:unknown[];
  if(tool==="ads_get_ad_accounts") {
    if(input.user_id!==undefined&&input.user_id!=="me")throw new PlatformDenied("LEGACY_ACCOUNT_DISCOVERY_SUBJECT_DENIED");
    const roots=assets.filter(a=>a.type==="AD_ACCOUNT");const limit=int(input.limit,100,100);const projection=fields(input.fields,ACCOUNT_FIELDS);
    data=[];
    for(const asset of roots.slice(0,limit)){const root=rootRef("AD_ACCOUNT",asset.id);data.push(...await executePlan(ctx,input,{steps:[step(root,"",projection,{},"AD_ACCOUNT")],refs:[root]}));}
    if(!roots.length)throw new PlatformDenied("ASSET_ACCESS_REQUIRED");
    data=[{data,registry_scope:"registered-client-ad-accounts-only",complete:roots.length<=limit,truncated:roots.length>limit}];
  } else data=await executePlan(ctx,input,buildPlan(tool,input,assets));
  return {content:[{type:"text",text:`Strict authorized read for ${tool}; client ${clientId}. Bounded projections and page completeness are reported in the result.`},{type:"text",text:JSON.stringify(data.length===1?data[0]:data,null,2)}]};
}
