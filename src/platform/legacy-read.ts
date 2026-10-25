import {REPORT_OBSERVER_TOOL,observeRegisteredReport} from "./legacy-report-observer.js";
import {MARKETING_REPORT_FIELDS,validateMarketingReportInput} from "./marketing-report-contracts.js";
import {DOSSIER_TOOL,dossierPlan,normalizeDossier} from "./legacy-dossier.js";
import {ERRORS_TOOL,ERROR_ACCOUNT_FIELDS,ERROR_AD_FIELDS,validateErrorsInput,normalizeErrors} from "./legacy-errors.js";
import {OPPORTUNITY_TOOL,validateOpportunityInput,normalizeOpportunity} from "./legacy-opportunity.js";
import {ANOMALY_TOOL,anomalyWindows,normalizeAnomaly} from "./legacy-anomaly.js";
import {scopedRateStatus} from "./scoped-rate-status.js";
import {normalizeLegacyPortfolio,portfolioWindow} from "./legacy-portfolio.js";
import {legacyInsightRange} from "./legacy-insight-range.js";
import { requestContext,hashToken } from "../auth/token-store.js";
import { metaApiClient } from "../meta/client.js";
import { z } from "zod";
import { authorizeOperation, assertPortfolioReadResponseCurrent, getExecutionScope, revalidateExecutionPermit, finishOperation, runWithExecutionPermit, withConnectionCredential } from "./execution.js";
import { getPlatformRepository, resolveOperationContext } from "./runtime.js";
import { PlatformDenied, type AssetRef, type AssetType, type MetaAsset, type OperationContext, type OperationPlan } from "./models.js";
import { assertLegacyMarketingReadEligibility, type LegacyReadStep } from "./legacy-egress.js";
import { LEGACY_MANIFEST } from "./legacy-manifest.js";
import { ADDITIONAL_LEGACY_READ_CONTRACTS } from "./legacy-read-contracts.js";
import { resolveMetaApiVersion } from "../meta/api-version.js";

export const LEGACY_CORE_READ_TOOLS = Object.freeze([REPORT_OBSERVER_TOOL,DOSSIER_TOOL,ERRORS_TOOL,ANOMALY_TOOL,"ads_rate_status","ads_portfolio_summary","ads_get_ad_accounts","ads_get_account_info","ads_get_campaigns","ads_get_campaign_details","ads_get_ad_sets","ads_get_ad_set_details","ads_get_ads","ads_get_ad_details","ads_get_ad_entities","ads_get_insights","ads_insights_performance_trend","ads_insights_advertiser_context",...Object.keys(ADDITIONAL_LEGACY_READ_CONTRACTS)]);
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
function rootRef(type:AssetType,id:unknown):AssetRef{if(type==="AD_IMAGE"){if(typeof id!=="string"||!/^[a-fA-F0-9]{32}$/.test(id))throw new PlatformDenied("LEGACY_IMAGE_HASH_INVALID");return {type,id};}return {type,id:normalizedId(id,type==="AD_ACCOUNT")};}
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
function buildPlan(tool:string,input:Record<string,unknown>,assets:MetaAsset[],now=Date.now()):BuiltPlan {
  if(tool===DOSSIER_TOOL)return dossierPlan(input,assets,datePreset(input.date_preset));
  if(tool===ERRORS_TOOL){validateErrorsInput(input);const root=rootRef("AD_ACCOUNT",input.account_id),all=descendants(assets,root,["AD"]),selected=all.slice(0,int(input.limit,50,100));return {refs:[root,...selected],steps:[step(root,"",ERROR_ACCOUNT_FIELDS,{},"AD_ACCOUNT"),...selected.map(ref=>step(ref,"",ERROR_AD_FIELDS,{},"AD"))]};}
  if(tool===ANOMALY_TOOL){const root=findRef(input.object_id,assets,["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"]),w=anomalyWindows(input,root,now),refs=[root,...descendants(assets,root,["CAMPAIGN","AD_SET","AD"])];return {refs,steps:[w.recent,w.previous].map(range=>step(root,"/insights",INSIGHT_FIELDS,{level:w.level,time_range:legacyInsightRange(range,undefined)!,limit:1,use_unified_attribution_setting:true},"INSIGHTS"))};}
  if(tool==="ads_portfolio_summary"){const raw=input.account_ids;if(!Array.isArray(raw)||raw.length<1||raw.length>20)throw new PlatformDenied("PORTFOLIO_BOUNDED_ACCOUNTS_REQUIRED");const refs=raw.map(id=>rootRef("AD_ACCOUNT",id));if(new Set(refs.map(r=>r.id)).size!==refs.length)throw new PlatformDenied("PORTFOLIO_DUPLICATE_ACCOUNTS_DENIED");const steps=refs.flatMap(root=>[step(root,"",["id","name","currency","timezone_name"],{},"AD_ACCOUNT"),step(root,"/insights",["account_id","date_start","date_stop","spend","impressions","clicks"],{...portfolioWindow(input),level:"account",limit:1,use_unified_attribution_setting:true},"INSIGHTS")]);return {refs,steps};}
  if(tool==="ads_get_report_results"){const root=rootRef("REPORT",input.report_run_id),report=assets.find(a=>sameRef(a,root)),parents=report?.parents.filter(a=>a.type==="AD_ACCOUNT");if(!report||parents?.length!==1)throw new PlatformDenied("REPORT_EXACT_ACCOUNT_PROVENANCE_REQUIRED");const account=rootRef("AD_ACCOUNT",parents[0].id),contract=ADDITIONAL_LEGACY_READ_CONTRACTS[tool],definition=report.reportDefinition;if(definition){validateMarketingReportInput({since:definition.since,until:definition.until});if(definition.kind!=="account_insights"||definition.level!=="account"||JSON.stringify(definition.fields)!==JSON.stringify(MARKETING_REPORT_FIELDS)||definition.useUnifiedAttributionSetting!==true||definition.operationId!==report.createdFromOperationId)throw new PlatformDenied("MINTED_REPORT_DEFINITION_INVALID");}return {refs:[root,account,...descendants(assets,account,["CAMPAIGN","AD_SET","AD"])],steps:[step(root,"",["id","account_id","async_status","async_percent_completion"],{},"REPORT"),step(root,"/insights",[...(definition?.fields??contract.fields)],{limit:int(input.limit,25,100)},"INSIGHTS")]};}
  const additional=ADDITIONAL_LEGACY_READ_CONTRACTS[tool];
  if(additional){
    const selected=additional.roots.find(root=>input[root.input]!==undefined);
    if(!selected)throw new PlatformDenied("LEGACY_REGISTERED_ROOT_REQUIRED");
    const root=rootRef(selected.type,input[selected.input]);
    const projection=[...new Set([...(additional.responseIdField?[additional.responseIdField]:[]),...fields(input.fields,[...additional.fields])])];
    const related=additional.edge?descendants(assets,root,[additional.entityType as AssetType]):[];
    // Creative->ad is a reference in the ad, so creative is an ancestor rather
    // than descendant. Authorize those registered direct parents explicitly.
    if(root.type==="AD"&&additional.entityType==="CREATIVE"){
      const ad=assets.find(a=>sameRef(a,root));
      if(!ad)throw new PlatformDenied("ASSET_ACCESS_REQUIRED");
      related.push(...ad.parents.filter(p=>p.type==="CREATIVE"));
    }
    const refs=[root,...related];
    if(input.account_id!==undefined&&root.type!=="AD_ACCOUNT"){
      const account=rootRef("AD_ACCOUNT",input.account_id);refs.push(account);
      if(!descendants(assets,account,[root.type]).some(a=>sameRef(a,root)))throw new PlatformDenied("LEGACY_PARENT_ACCOUNT_MISMATCH");
    }
    if(tool==="ads_get_rule_details"&&input.include_history===true)throw new PlatformDenied("LEGACY_RULE_HISTORY_CONTRACT_REQUIRED");
    const query:Record<string,string|number|boolean>=additional.edge?{limit:int(input.limit,25,100)}:{};
    if(tool==="ads_get_ad_images"&&input.hashes!==undefined){
      const hashes=input.hashes;
      if(!Array.isArray(hashes)||hashes.length>100||hashes.some(hash=>typeof hash!=="string"||!/^[a-fA-F0-9]{32}$/.test(hash))||new Set(hashes).size!==hashes.length)throw new PlatformDenied("LEGACY_IMAGE_HASH_FILTER_INVALID");
      if(hashes.some(hash=>!related.some(ref=>ref.type==="AD_IMAGE"&&ref.id===hash)))throw new PlatformDenied("LEGACY_IMAGE_HASH_UNREGISTERED");
      if(hashes.length)query.hashes=JSON.stringify([...hashes].sort());
    }
    return {steps:[step(root,additional.edge,projection,query,additional.entityType)],refs};
  }
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
    if(input.breakdowns!==undefined||input.filtering!==undefined||input.action_attribution_windows!==undefined)throw new PlatformDenied("LEGACY_COMPLEX_INSIGHTS_CONTRACT_HOLD");
    projection=[...new Set(["account_id","campaign_id","adset_id","ad_id",...fields(input.fields,INSIGHT_FIELDS)])].filter(f=>f!=="id");
    const range=legacyInsightRange(input.time_range,input.date_preset);
    const insightQuery:Record<string,string|number|boolean>={limit:int(input.limit,100,100),...(range?{time_range:range}:{date_preset:datePreset(input.date_preset)}),use_unified_attribution_setting:true};
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
function toolReportPending(tool:string,item:LegacyReadStep,value:unknown,accountId:string|undefined):boolean{if(tool!=="ads_get_report_results"||item.entityType!=="REPORT")return false;const row=value as {account_id?:unknown;async_status?:unknown;async_percent_completion?:unknown};return typeof row.account_id!=="string"||row.account_id.replace(/^act_/,"")!==accountId?.replace(/^act_/,"")||row.async_status!=="Job Completed"||row.async_percent_completion!==100;}
async function executePlan(ctx:OperationContext,input:Record<string,unknown>,built:BuiltPlan):Promise<unknown[]> {
  const repo=getPlatformRepository();
  const plan:OperationPlan={parameters:{input:clean(input),legacy_read_steps:built.steps,provider_read_bootstrap:true},assets:built.refs,classes:["READ"],capability:`legacy.${ctx.tool}`,requiredScopes:["ads_read"],tokenTypes:["user","system_user"]};
  const permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:false});let terminal=false;
  try {
    const result=await runWithExecutionPermit(permit,async()=>{
      const requirement=`marketing_read_access:${resolveMetaApiVersion()}`;
      if((getExecutionScope().snapshot.connection.eligibility??[]).some(e=>e.requirement===requirement))assertLegacyMarketingReadEligibility();
      return withConnectionCredential(permit,async accessToken=>requestContext.run({accessToken,fbUserId:ctx.principal.operatorId},async()=>{
        const output:unknown[]=[];
        if(ctx.tool!=="ads_get_account_info"&&built.refs.some(ref=>ref.type==="AD_ACCOUNT")&&!(getExecutionScope().snapshot.connection.eligibility??[]).some(e=>e.requirement===`marketing_read_access:${resolveMetaApiVersion()}`)){
          const account=built.refs.find(ref=>ref.type==="AD_ACCOUNT");
          if(!account)throw new PlatformDenied("LEGACY_PROVIDER_READ_PROBE_ACCOUNT_REQUIRED");
          await metaApiClient.get(`/act_${account.id.replace(/^act_/,"")}`,{fields:"id,account_id,business{id},account_status"});
        }
        for(const item of built.steps){const response=await metaApiClient.get(item.path,item.query);if(toolReportPending(ctx.tool,item,response,built.refs.find(ref=>ref.type==="AD_ACCOUNT")?.id))throw new PlatformDenied("REPORT_NOT_COMPLETED_HOLD");output.push(response);}
        return output;
      }));
    });
    await runWithExecutionPermit(permit,async()=>{await revalidateExecutionPermit(permit);assertLegacyMarketingReadEligibility();});await finishOperation(permit,"SUCCEEDED");terminal=true;if(ctx.tool==="ads_portfolio_summary")await assertPortfolioReadResponseCurrent(permit);return result;
  } catch(error){if(!terminal)await finishOperation(permit,"FAILED");throw error;}
}
export async function executeStrictLegacyRead(tool:string,input:Record<string,unknown>,signal?:AbortSignal):Promise<{content:Array<{type:"text";text:string}>}> {
  if(tool===REPORT_OBSERVER_TOOL)return observeRegisteredReport(input,{},signal);
  if(!LEGACY_CORE_READ_TOOLS.includes(tool))throw new PlatformDenied("LEGACY_STRICT_MIGRATION_HOLD");
  const allowedKeys=new Set([...(LEGACY_MANIFEST.find(entry=>entry.name===tool)?.inputKeys??[]),"client_id",...(tool==="ads_portfolio_summary"?["time_range"]:[])]);
  if(Object.keys(input).some(key=>!allowedKeys.has(key)))throw new PlatformDenied("LEGACY_INPUT_KEY_DENIED");
  const clientId=input.client_id;if(typeof clientId!=="string")throw new PlatformDenied("CLIENT_CONTEXT_REQUIRED");
  const ctx=await resolveOperationContext(clientId,tool,"META_MARKETING");
  const repo=getPlatformRepository();
  const assets=(await repo.list("assets",ctx.principal.tenantId)).filter(a=>a.tenantId===ctx.principal.tenantId&&a.clientId===ctx.clientId&&a.provider==="META_MARKETING"&&a.revokedAt===null);
  if(tool==="ads_rate_status"){
    const refs=assets.filter(a=>a.type==="AD_ACCOUNT").map(a=>rootRef("AD_ACCOUNT",a.id));if(!refs.length||refs.length>100)throw new PlatformDenied("RATE_STATUS_BOUNDED_CLIENT_ACCOUNTS_REQUIRED");
    const plan:OperationPlan={parameters:{local_rate_status:true},assets:refs,classes:["READ"],capability:"legacy.ads_rate_status",requiredScopes:["ads_read"],tokenTypes:["user","system_user"]},permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:false});
    try{const value=await runWithExecutionPermit(permit,()=>withConnectionCredential(permit,async token=>{const projected=scopedRateStatus(metaApiClient.getUsageSnapshot(),hashToken(token),refs.map(ref=>ref.id));await revalidateExecutionPermit(permit);return projected;}));await finishOperation(permit,"SUCCEEDED");return {content:[{type:"text",text:JSON.stringify(value)}]};}catch(error){await finishOperation(permit,"FAILED");throw error;}
  }
  if(tool===OPPORTUNITY_TOOL)validateOpportunityInput(input);
  if(["ads_get_report_status","ads_get_report_results"].includes(tool)&&input.fields!==undefined)throw new PlatformDenied("REPORT_FIXED_PROJECTION_REQUIRED");
  const checkedAt=Date.now();
  let data:unknown[];
  if(tool==="ads_get_ad_accounts") {
    if(input.user_id!==undefined&&input.user_id!=="me")throw new PlatformDenied("LEGACY_ACCOUNT_DISCOVERY_SUBJECT_DENIED");
    const grants=await repo.list("grants",ctx.principal.tenantId);
    const roots=assets.filter(a=>a.type==="AD_ACCOUNT"&&grants.some(g=>g.tenantId===ctx.principal.tenantId&&g.clientId===ctx.clientId&&g.assetKey===a.key&&g.capabilities.includes("legacy.ads_get_ad_accounts")&&g.actions.length===1&&g.actions[0]==="READ"&&g.revokedAt===null&&g.expiresAt>Date.now()&&g.verifiedAt>0&&Date.now()-g.verifiedAt<=3600000));
    const limit=int(input.limit,100,100);const projection=fields(input.fields,ACCOUNT_FIELDS);
    if(!roots.length)throw new PlatformDenied("ASSET_ACCESS_REQUIRED");
    const refs=roots.slice(0,limit).map(asset=>rootRef("AD_ACCOUNT",asset.id));
    data=await executePlan(ctx,input,{steps:refs.map(root=>step(root,"",projection,{},"AD_ACCOUNT")),refs});
    data=[{data,registry_scope:"registered-client-ad-accounts-only",complete:roots.length<=limit,truncated:roots.length>limit}];
  } else data=await executePlan(ctx,input,buildPlan(tool,input,assets,checkedAt));
  if(tool===DOSSIER_TOOL)data=[normalizeDossier(data)];
  if(tool===ERRORS_TOOL){const root=rootRef("AD_ACCOUNT",input.account_id);data=[normalizeErrors(input,data,descendants(assets,root,["AD"]).length<=int(input.limit,50,100))];}
  if(tool===OPPORTUNITY_TOOL)data=[normalizeOpportunity(data[0])];
  if(tool===ANOMALY_TOOL)data=[normalizeAnomaly(input,findRef(input.object_id,assets,["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"]),data,checkedAt)];
  if(tool==="ads_get_report_results"){const definition=assets.find(a=>a.type==="REPORT"&&a.id===input.report_run_id)?.reportDefinition;data=[{report:data[0],results:data[1],report_definition:definition?{source:"APPROVED_LUMIN_ACCOUNT_REPORT",level:definition.level,fields:definition.fields,since:definition.since,until:definition.until}:"PREEXISTING_PROVIDER_REPORT",attribution_settings:definition?"UNIFIED_REQUESTED_TRUE_AT_CREATION_NOT_PROVIDER_RESULT_CERTIFIED":"NOT_ESTABLISHED_BY_THIS_READ",limitations:"Fixed bounded completed-report projections only; no export URLs, email recipients or arbitrary fields. Actual report ID/account ownership and Job Completed/100 status are required. Completion does not imply all result pages or verified business outcomes."}];}
  if(tool==="ads_get_dataset_quality")data=[{observations:data[0],health_certification:"NOT_ESTABLISHED",missing_fields:"UNKNOWN_NOT_ZERO_OR_NEVER",limitations:"Observed Pixel metadata only. No synthetic health score, consent certification, event delivery test, browser installation proof or outcome-quality claim. Match-rate units are reported as supplied by Meta without guessed interpretation."}];
  if(tool==="ads_portfolio_summary")data=[normalizeLegacyPortfolio((input.account_ids as string[]).map(id=>normalizedId(id,true)),data,portfolioWindow(input))];
  return {content:[{type:"text",text:`Strict authorized read for ${tool}; client ${clientId}. Bounded projections and page completeness are reported in the result.`},{type:"text",text:JSON.stringify(data.length===1?data[0]:data,null,2)}]};
}
