import {legacyMarketingReadEligibilityContract,legacyMarketingReadRequirement} from "./legacy-marketing-eligibility.js";
import {assertManualEligibilityAttestation} from "./manual-eligibility.js";
import {assertNoCredentialShapedString} from "./input-safety.js";
import {redactCredentials} from "./product-private-response.js";
import {DOSSIER_TOOL,DOSSIER_FIELDS} from "./legacy-dossier.js";
import {ERRORS_TOOL,ERROR_ACCOUNT_FIELDS,ERROR_AD_FIELDS,projectAdIssues} from "./legacy-errors.js";
import {legacyInsightRange} from "./legacy-insight-range.js";
import { canonicalJson } from "./policy.js";
import { assertExecutionPermit, getExecutionScope, hasCurrentProviderReadProof, revalidateExecutionPermit } from "./execution.js";
import { PlatformDenied, type AssetRef, type AssetType } from "./models.js";
import { platformEnabled } from "./runtime.js";
import { resolveMetaApiVersion } from "../meta/api-version.js";
import { ADDITIONAL_LEGACY_READ_CONTRACTS } from "./legacy-read-contracts.js";

export interface LegacyReadStep { path: string; query: Record<string,string|number|boolean>; projection: string[]; root: AssetRef; list: boolean; entityType: AssetType | "INSIGHTS" }
const PROVIDER_READ_PROBE_FIELDS="id,account_id,business{id},account_status";
function providerReadProbe(scope:ReturnType<typeof getExecutionScope>,method:string,path:string,query:Record<string,string>):boolean {
  if(method!=="GET"||scope.context.provider!=="META_MARKETING"||scope.plan.parameters.provider_read_bootstrap!==true)return false;
  if(scope.snapshot.connection.eligibility?.some(e=>e.requirement===`marketing_read_access:${resolveMetaApiVersion()}` && e.verified===true && Number.isFinite(e.checkedAt) && e.checkedAt>0 && e.checkedAt<=Date.now() && Number.isFinite(e.expiresAt) && e.expiresAt>Date.now()))return false;
  const accountIds=scope.plan.assets.filter(a=>a.type==="AD_ACCOUNT").map(a=>a.id.replace(/^act_/,""));
  if(!accountIds.length||!/^\/act_\d{1,32}$/.test(path)||!accountIds.includes(path.split("/act_")[1]))return false;
  if(scope.context.tool==="ads_get_account_info"||scope.context.tool==="ads_get_ad_accounts")return true;
  return query.fields===PROVIDER_READ_PROBE_FIELDS&&Object.keys(query).length===1;
}
const FIELD_ALLOWLIST:Record<string,string[]>={
  AD_ACCOUNT:["id","account_id","name","account_status","currency","timezone_name","business_name","amount_spent","balance","spend_cap","created_time","disable_reason"],
  CAMPAIGN:["id","account_id","name","objective","status","effective_status","buying_type","daily_budget","lifetime_budget","budget_remaining","bid_strategy","special_ad_categories","created_time","updated_time","start_time","stop_time"],
  AD_SET:["id","account_id","campaign_id","name","status","effective_status","optimization_goal","billing_event","bid_amount","daily_budget","lifetime_budget","start_time","end_time","created_time","updated_time"],
  AD:["id","account_id","campaign_id","adset_id","name","status","effective_status","bid_amount","created_time","updated_time"],
  INSIGHTS:["account_id","campaign_id","campaign_name","adset_id","ad_id","date_start","date_stop","impressions","clicks","spend","reach","frequency","ctr","cpc","cpm","actions","cost_per_action_type"],
};
export function assertLegacyMarketingReadEligibility():void {
  const scope=getExecutionScope(),now=Date.now();
  const account=scope.plan.assets.find(a=>a.type==="AD_ACCOUNT")?.id;
  const requirement=`marketing_read_access:${resolveMetaApiVersion()}`;
  const records=scope.snapshot.connection.eligibility?.filter(e=>e.requirement===requirement)??[];
  if(!records.length&&account&&hasCurrentProviderReadProof(account,now))return;
  if(!records.some(e=>e.verified===true && Number.isFinite(e.checkedAt) && e.checkedAt>0 && e.checkedAt<=now && now-e.checkedAt<=3600000 && Number.isFinite(e.expiresAt) && e.expiresAt>now && /^https:\/\/(developers\.facebook\.com\/|www\.postman\.com\/meta\/|github\.com\/facebook\/)/.test(e.source)))throw new PlatformDenied("UNVERIFIED_MARKETING_READ_ACCESS");
  if(scope.snapshot.connection.eligibility?.some(e=>e.requirement===legacyMarketingReadRequirement()&&e.attestationId))assertManualEligibilityAttestation(legacyMarketingReadEligibilityContract(),scope.snapshot.connection,legacyMarketingReadRequirement(),scope.snapshot.manualEligibilityEvidence,scope.context.clientId,now);
}
function assertStepContract(tool:string,step:LegacyReadStep):void {
  const contracts:Record<string,Array<[AssetType[],string,LegacyReadStep["entityType"]]>>={
    ads_get_ad_dossier:[[["AD_ACCOUNT"],"","AD_ACCOUNT"],[["AD"],"","AD"],[["CAMPAIGN"],"","CAMPAIGN"],[["AD_SET"],"","AD_SET"],[["CREATIVE"],"","CREATIVE"],[["AD"],"/insights","INSIGHTS"]],
    ads_get_errors:[[["AD_ACCOUNT"],"","AD_ACCOUNT"],[["AD"],"","AD"]],
    ads_portfolio_summary:[[["AD_ACCOUNT"],"","AD_ACCOUNT"],[["AD_ACCOUNT"],"/insights","INSIGHTS"]],
    ads_get_ad_accounts:[[["AD_ACCOUNT"],"","AD_ACCOUNT"]],ads_get_account_info:[[["AD_ACCOUNT"],"","AD_ACCOUNT"]],
    ads_get_campaigns:[[["AD_ACCOUNT"],"/campaigns","CAMPAIGN"]],ads_get_campaign_details:[[["CAMPAIGN"],"","CAMPAIGN"]],
    ads_get_ad_sets:[[["AD_ACCOUNT","CAMPAIGN"],"/adsets","AD_SET"]],ads_get_ad_set_details:[[["AD_SET"],"","AD_SET"]],
    ads_get_ads:[[["AD_ACCOUNT","CAMPAIGN","AD_SET"],"/ads","AD"]],ads_get_ad_details:[[["AD"],"","AD"]],
    ads_get_ad_entities:[[["AD_ACCOUNT"],"/campaigns","CAMPAIGN"],[["CAMPAIGN"],"/adsets","AD_SET"],[["AD_ACCOUNT","CAMPAIGN","AD_SET"],"/ads","AD"]],
    ads_insights_anomaly_signal:[[["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],"/insights","INSIGHTS"]],
    ads_get_insights:[[["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],"/insights","INSIGHTS"]],
    ads_insights_performance_trend:[[["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],"/insights","INSIGHTS"]],
    ads_insights_advertiser_context:[[["AD_ACCOUNT"],"/insights","INSIGHTS"],[["AD_ACCOUNT"],"","AD_ACCOUNT"]],
  };
  const additional=ADDITIONAL_LEGACY_READ_CONTRACTS[tool];
  const options=tool==="ads_get_report_results"?[[["REPORT"],"","REPORT"],[["REPORT"],"/insights","INSIGHTS"]] as Array<[AssetType[],string,LegacyReadStep["entityType"]]>:additional?[[additional.roots.map(r=>r.type),additional.edge,additional.entityType] as [AssetType[],string,LegacyReadStep["entityType"]]]:contracts[tool];
  if(!options||!step||!step.root||!/^(?:act_)?\d{1,32}$/.test(step.root.id)||!options.some(([roots,edge,type])=>roots.includes(step.root.type)&&step.path===`/${step.root.id}${edge}`&&step.entityType===type&&step.list===(edge!=="")))throw new PlatformDenied("LEGACY_STATIC_ENDPOINT_CONTRACT_DENIED");
  if((step.root.type==="AD_ACCOUNT")!==step.root.id.startsWith("act_"))throw new PlatformDenied("LEGACY_STATIC_ENDPOINT_CONTRACT_DENIED");
  const allowed=tool===DOSSIER_TOOL?DOSSIER_FIELDS[step.entityType]:tool===ERRORS_TOOL?(step.entityType==="AD_ACCOUNT"?ERROR_ACCOUNT_FIELDS:ERROR_AD_FIELDS):tool==="ads_get_report_results"&&step.entityType==="REPORT"?["id","account_id","async_status","async_percent_completion"]:additional?.fields??FIELD_ALLOWLIST[step.entityType];
  if(!Array.isArray(step.projection)||!step.projection.length||step.projection.length>30||step.projection.some(f=>!allowed.includes(f))||step.query.fields!==step.projection.join(","))throw new PlatformDenied("LEGACY_STATIC_PROJECTION_DENIED");
  const keys=tool==="ads_get_report_results"?["fields","limit"]:step.entityType==="INSIGHTS"?["fields","limit","date_preset","time_range","use_unified_attribution_setting","level","time_increment"]:step.list?["fields","limit","filtering",...(tool==="ads_get_ad_images"?["hashes"]:[])]:["fields"];
  if(Object.keys(step.query).some(k=>!keys.includes(k)))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
  if(step.query.limit!==undefined&&(!Number.isInteger(Number(step.query.limit))||Number(step.query.limit)<1||Number(step.query.limit)>100))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
  if(step.query.hashes!==undefined){let hashes:unknown;try{hashes=JSON.parse(String(step.query.hashes));}catch{throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");}if(tool!=="ads_get_ad_images"||!Array.isArray(hashes)||hashes.length<1||hashes.length>100||hashes.some(hash=>typeof hash!=="string"||!/^[a-fA-F0-9]{32}$/.test(hash)))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");}
  if(step.query.filtering!==undefined){let parsed:unknown;try{parsed=JSON.parse(String(step.query.filtering));}catch{throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");}if(!Array.isArray(parsed)||parsed.length!==1)throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");const f=parsed[0] as Record<string,unknown>;if(!f||Object.keys(f).sort().join(",")!=="field,operator,value"||f.field!=="effective_status"||f.operator!=="IN"||!Array.isArray(f.value)||f.value.length>4||f.value.some(v=>!["ACTIVE","PAUSED","DELETED","ARCHIVED"].includes(String(v))))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");}
  if(step.entityType==="INSIGHTS"&&tool!=="ads_get_report_results"){
    if(step.query.time_range!==undefined){let range:unknown;try{range=JSON.parse(String(step.query.time_range));}catch{throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");}if(legacyInsightRange(range,step.query.date_preset)!==step.query.time_range)throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");}
    if(step.query.use_unified_attribution_setting!==true||(step.query.time_range===undefined&&(typeof step.query.date_preset!=="string"||!/^[a-z0-9_]{1,40}$/.test(step.query.date_preset)||step.query.date_preset==="maximum")))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
    if(step.query.level!==undefined&&!["account","campaign","adset","ad"].includes(String(step.query.level)))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
    if(step.query.time_increment!==undefined&&!["1","7","monthly","all_days"].includes(String(step.query.time_increment)))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
  }
}
function stepsFromScope(): LegacyReadStep[] {
  const scope = getExecutionScope();
  const steps = scope.plan.parameters.legacy_read_steps;
  if(!Array.isArray(steps) || scope.plan.classes.length !== 1 || scope.plan.classes[0] !== "READ" || scope.context.provider !== "META_MARKETING") throw new PlatformDenied("LEGACY_READ_PLAN_REQUIRED");
  if(steps.length<1||steps.length>(["ads_insights_anomaly_signal","ads_get_report_results"].includes(scope.context.tool)?2:scope.context.tool===DOSSIER_TOOL?6:scope.context.tool===ERRORS_TOOL?101:scope.context.tool==="ads_get_ad_accounts"?100:scope.context.tool==="ads_portfolio_summary"?40:scope.context.tool==="ads_insights_advertiser_context"?3:1))throw new PlatformDenied("LEGACY_READ_STEP_COUNT_DENIED");
  for(const step of steps)assertStepContract(scope.context.tool,step as LegacyReadStep);
  return steps as LegacyReadStep[];
}
function queryObject(url: URL): Record<string,string> { const result:Record<string,string>={};for(const [k,v] of url.searchParams){if(k in result)throw new PlatformDenied("LEGACY_DUPLICATE_QUERY_PARAMETER");result[k]=v;}return result; }
export async function assertLegacyReadEgress(method: string,path: string,urlString: string): Promise<void> {
  if(!platformEnabled()) return;
  const permit=assertExecutionPermit({provider:"META_MARKETING"});
  const url=new URL(urlString);
  if(method!=="GET" || url.origin!=="https://graph.facebook.com" || url.username || url.password || url.hash || url.pathname!==`/${resolveMetaApiVersion()}${path}`) throw new PlatformDenied("LEGACY_READ_ENDPOINT_DENIED");
  const query=queryObject(url);
  const scope=getExecutionScope();
  if(providerReadProbe(scope,method,path,query)){await revalidateExecutionPermit(permit);return;}
  const step=stepsFromScope().find(s=>s.path===path&&canonicalJson(Object.fromEntries(Object.entries(s.query).map(([k,v])=>[k,String(v)])))===canonicalJson(query));
  if(!step) throw new PlatformDenied("LEGACY_READ_PLAN_MISMATCH");
  if(!scope.snapshot.assets.some(a=>a.type===step.root.type&&a.id.replace(/^act_/,"")===step.root.id.replace(/^act_/,""))) throw new PlatformDenied("LEGACY_READ_ASSET_NOT_AUTHORIZED");
  if(step.query.hashes!==undefined&&(JSON.parse(String(step.query.hashes)) as string[]).some(hash=>!scope.snapshot.assets.some(a=>a.type==="AD_IMAGE"&&a.id===hash)))throw new PlatformDenied("LEGACY_IMAGE_HASH_UNREGISTERED");
  await revalidateExecutionPermit(permit);
  assertLegacyMarketingReadEligibility();
}
export function projectLegacyReadResponse(path:string,urlString:string,body:unknown): unknown {
  if(!platformEnabled())return body;
  const query=queryObject(new URL(urlString));
  const scope=getExecutionScope();
  if(providerReadProbe(scope,"GET",path,query)&&query.fields===PROVIDER_READ_PROBE_FIELDS&&Object.keys(query).length===1){
    if(!body||typeof body!=="object"||Array.isArray(body))throw new PlatformDenied("LEGACY_PROVIDER_RESPONSE_SCHEMA_INVALID");
    const row=body as Record<string,unknown>,id=typeof row.id==="string"?row.id:"",accountId=typeof row.account_id==="string"?row.account_id:"";
    const expected=scope.plan.assets.find(a=>a.type==="AD_ACCOUNT")?.id.replace(/^act_/,"");
    if(!/^act_\d{1,32}$/.test(id)||!/^\d{1,32}$/.test(accountId)||id.replace(/^act_/,"")!==expected||accountId!==expected)throw new PlatformDenied("LEGACY_PROVIDER_READ_PROOF_MISMATCH");
    const business=typeof row.business==="object"&&row.business!==null&&!Array.isArray(row.business)?row.business as Record<string,unknown>:undefined;
    if(business&&typeof business.id!=="string")throw new PlatformDenied("LEGACY_PROVIDER_RESPONSE_SCHEMA_INVALID");
    if(row.account_status!==undefined&&(!Number.isSafeInteger(row.account_status)||Number(row.account_status)<0))throw new PlatformDenied("LEGACY_PROVIDER_RESPONSE_SCHEMA_INVALID");
    const safe:Record<string,unknown>={id,account_id:accountId,...(business?{business:{id:String(business.id),...(typeof business.name==="string"?{name:business.name}: {})}}:{}),...(row.account_status!==undefined?{account_status:row.account_status}: {})};
    assertNoCredentialShapedString(JSON.stringify(safe));
    return safe;
  }
  const step=stepsFromScope().find(s=>s.path===path&&canonicalJson(Object.fromEntries(Object.entries(s.query).map(([k,v])=>[k,String(v)])))===canonicalJson(query));
  if(!step)throw new PlatformDenied("LEGACY_READ_PLAN_MISMATCH");
  const allowedAssets=scope.snapshot.assets;
  const scalar=(value:unknown):boolean=>{if(typeof value==="string"){assertNoCredentialShapedString(value);if(redactCredentials(value)!==value)throw new PlatformDenied("LEGACY_CREDENTIAL_SHAPED_OUTPUT_DENIED");return Buffer.byteLength(value,"utf8")<=2000;}return value===null||typeof value==="number"&&Number.isFinite(value)||typeof value==="boolean";};
  const project=(input:unknown):Record<string,unknown>=>{
    if(!input||typeof input!=="object"||Array.isArray(input))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");
    const row=input as Record<string,unknown>;
    if(step.entityType!=="INSIGHTS") {
      const identityField=ADDITIONAL_LEGACY_READ_CONTRACTS[scope.context.tool]?.responseIdField;
      const id=String(identityField?row[identityField]??"":row.id??row.account_id??"").replace(/^act_/,"");
      if(!allowedAssets.some(a=>a.type===step.entityType&&a.id.replace(/^act_/,"")===id))throw new PlatformDenied("LEGACY_RESPONSE_UNREGISTERED_OBJECT");
    }
    if(scope.context.tool===DOSSIER_TOOL&&step.entityType!=="INSIGHTS"||scope.context.tool===ERRORS_TOOL||["ads_get_report_status","ads_get_report_results"].includes(scope.context.tool)&&step.entityType==="REPORT"){const required=step.entityType==="AD"?["id","account_id","campaign_id","adset_id"]:step.entityType==="AD_SET"?["id","account_id","campaign_id"]:["id","account_id"];if(required.some(k=>typeof row[k]!=="string"||!/^(?:act_)?\d{1,32}$/.test(row[k] as string)))throw new PlatformDenied("DIAGNOSTIC_MANDATORY_PARENT_RECEIPT_REQUIRED");}
    if([DOSSIER_TOOL,ERRORS_TOOL].includes(scope.context.tool)&&step.entityType!=="INSIGHTS"){
      const current=allowedAssets.find(a=>a.type===step.entityType&&a.id.replace(/^act_/,"")===String(row.id).replace(/^act_/,"")),exactParent=(asset:typeof current,type:AssetType)=>{const parents=asset?.parents.filter(p=>p.type===type)??[];if(parents.length!==1)throw new PlatformDenied("DIAGNOSTIC_REGISTERED_PARENT_REQUIRED");return parents[0].id;};
      if(!current)throw new PlatformDenied("DIAGNOSTIC_REGISTERED_PARENT_REQUIRED");
      if(current.type==="AD"){const setId=exactParent(current,"AD_SET"),set=allowedAssets.find(a=>a.type==="AD_SET"&&a.id===setId);if(row.adset_id!==setId||row.campaign_id!==exactParent(set,"CAMPAIGN"))throw new PlatformDenied("DIAGNOSTIC_ACTUAL_PARENT_CHANGED");}
      if(current.type==="AD_SET"&&row.campaign_id!==exactParent(current,"CAMPAIGN"))throw new PlatformDenied("DIAGNOSTIC_ACTUAL_PARENT_CHANGED");
      if(["CAMPAIGN","CREATIVE"].includes(current.type)&&String(row.account_id).replace(/^act_/,"")!==exactParent(current,"AD_ACCOUNT").replace(/^act_/,""))throw new PlatformDenied("DIAGNOSTIC_ACTUAL_PARENT_CHANGED");
    }
    for(const [field,type] of [["account_id","AD_ACCOUNT"],["campaign_id","CAMPAIGN"],["adset_id","AD_SET"],["ad_id","AD"]] as const){if(row[field]!==undefined&&!allowedAssets.some(a=>a.type===type&&a.id.replace(/^act_/,"")===String(row[field]).replace(/^act_/,"")))throw new PlatformDenied("LEGACY_RESPONSE_FOREIGN_PARENT");}
    const output:Record<string,unknown>={};
    for(const field of step.projection){
      if(field==="creative{id}"&&scope.context.tool===DOSSIER_TOOL){const v=row.creative;if(!v||typeof v!=="object"||Array.isArray(v)||typeof (v as {id?:unknown}).id!=="string"||!allowedAssets.some(a=>a.type==="CREATIVE"&&a.id===(v as {id:string}).id))throw new PlatformDenied("DOSSIER_ACTUAL_CREATIVE_CHANGED");output.creative={id:(v as {id:string}).id};continue;}
      if(row[field]===undefined)continue;
      const value=row[field];
      if(field==="issues_info"&&scope.context.tool===ERRORS_TOOL){output[field]=projectAdIssues(value);}else if(["actions","cost_per_action_type"].includes(field)){
        if(!Array.isArray(value)||value.length>200)throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");
        output[field]=value.map(v=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");const item=v as Record<string,unknown>;if(typeof item.action_type!=="string"||!/^[a-zA-Z0-9_.]{1,150}$/.test(item.action_type)||typeof item.value!=="string"||!/^\d+(?:\.\d+)?$/.test(item.value))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");return {action_type:item.action_type,value:item.value};});
      } else if(field==="async_percent_completion") {
        if(value!==null&&(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||value>100))throw new PlatformDenied("REPORT_PROGRESS_SCHEMA_INVALID");output[field]=value;
      } else if(field==="opportunity_score") {
        if(value!==null&&(typeof value!=="number"||!Number.isFinite(value)||value<0||value>100))throw new PlatformDenied("OPPORTUNITY_SCORE_INVALID");output[field]=value;
      } else if(field==="automatic_matching_fields") {
        if(!Array.isArray(value)||value.length>30||value.some(v=>typeof v!=="string"||!/^[a-z_]{1,50}$/.test(v)))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");output[field]=value;
      } else if(field==="special_ad_categories") {
        if(!Array.isArray(value)||value.length>20||value.some(v=>typeof v!=="string"||!/^[A-Z_]{1,60}$/.test(v)))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");output[field]=value;
      } else {if(!scalar(value))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");output[field]=value;}
    }
    return output;
  };
  if(!step.list)return project(body);
  if(!body||typeof body!=="object"||!("data" in body)||!Array.isArray(body.data)||body.data.length>1000)throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");
  const page=body as {data:unknown[];paging?:{next?:unknown}};
  if(page.paging!==undefined){if(!page.paging||typeof page.paging!=="object"||Array.isArray(page.paging))throw new PlatformDenied("LEGACY_PAGING_SCHEMA_INVALID");if(Object.prototype.hasOwnProperty.call(page.paging,"next")){const next=page.paging.next;if(typeof next!=="string"||!next.length||next.length>8192)throw new PlatformDenied("LEGACY_PAGING_SCHEMA_INVALID");let u:URL;try{u=new URL(next);}catch{throw new PlatformDenied("LEGACY_PAGING_SCHEMA_INVALID");}if(u.protocol!=="https:"||u.username||u.password)throw new PlatformDenied("LEGACY_PAGING_SCHEMA_INVALID");}}
  return {data:page.data.map(project),lumin_page:{complete:!page.paging?.next,truncated:!!page.paging?.next,reason:page.paging?.next?"Strict read returns one bounded page; no provider next URL is followed or exposed.":"No next page returned by provider."}};
}

