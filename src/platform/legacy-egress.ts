import { canonicalJson } from "./policy.js";
import { assertExecutionPermit, getExecutionScope, revalidateExecutionPermit } from "./execution.js";
import { PlatformDenied, type AssetRef, type AssetType } from "./models.js";
import { platformEnabled } from "./runtime.js";
import { resolveMetaApiVersion } from "../meta/api-version.js";

export interface LegacyReadStep { path: string; query: Record<string,string|number|boolean>; projection: string[]; root: AssetRef; list: boolean; entityType: AssetType | "INSIGHTS" }
const FIELD_ALLOWLIST:Record<string,string[]>={
  AD_ACCOUNT:["id","account_id","name","account_status","currency","timezone_name","business_name","amount_spent","balance","spend_cap","created_time","disable_reason"],
  CAMPAIGN:["id","account_id","name","objective","status","effective_status","buying_type","daily_budget","lifetime_budget","budget_remaining","bid_strategy","special_ad_categories","created_time","updated_time","start_time","stop_time"],
  AD_SET:["id","account_id","campaign_id","name","status","effective_status","optimization_goal","billing_event","bid_amount","daily_budget","lifetime_budget","start_time","end_time","created_time","updated_time"],
  AD:["id","account_id","campaign_id","adset_id","name","status","effective_status","bid_amount","created_time","updated_time"],
  INSIGHTS:["account_id","campaign_id","campaign_name","adset_id","ad_id","date_start","date_stop","impressions","clicks","spend","reach","frequency","ctr","cpc","cpm","actions","cost_per_action_type"],
};
export function assertLegacyMarketingReadEligibility():void {
  const scope=getExecutionScope(),now=Date.now();
  if(!scope.snapshot.connection.eligibility?.some(e=>e.requirement===`marketing_read_access:${resolveMetaApiVersion()}` && e.verified===true && Number.isFinite(e.checkedAt) && e.checkedAt>0 && e.checkedAt<=now && now-e.checkedAt<=3600000 && Number.isFinite(e.expiresAt) && e.expiresAt>now && /^https:\/\/(developers\.facebook\.com\/|www\.postman\.com\/meta\/|github\.com\/facebook\/)/.test(e.source)))throw new PlatformDenied("UNVERIFIED_MARKETING_READ_ACCESS");
}
function assertStepContract(tool:string,step:LegacyReadStep):void {
  const contracts:Record<string,Array<[AssetType[],string,LegacyReadStep["entityType"]]>>={
    ads_get_ad_accounts:[[["AD_ACCOUNT"],"","AD_ACCOUNT"]],ads_get_account_info:[[["AD_ACCOUNT"],"","AD_ACCOUNT"]],
    ads_get_campaigns:[[["AD_ACCOUNT"],"/campaigns","CAMPAIGN"]],ads_get_campaign_details:[[["CAMPAIGN"],"","CAMPAIGN"]],
    ads_get_ad_sets:[[["AD_ACCOUNT","CAMPAIGN"],"/adsets","AD_SET"]],ads_get_ad_set_details:[[["AD_SET"],"","AD_SET"]],
    ads_get_ads:[[["AD_ACCOUNT","CAMPAIGN","AD_SET"],"/ads","AD"]],ads_get_ad_details:[[["AD"],"","AD"]],
    ads_get_ad_entities:[[["AD_ACCOUNT"],"/campaigns","CAMPAIGN"],[["CAMPAIGN"],"/adsets","AD_SET"],[["AD_ACCOUNT","CAMPAIGN","AD_SET"],"/ads","AD"]],
    ads_get_insights:[[["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],"/insights","INSIGHTS"]],
    ads_insights_performance_trend:[[["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],"/insights","INSIGHTS"]],
    ads_insights_advertiser_context:[[["AD_ACCOUNT"],"/insights","INSIGHTS"],[["AD_ACCOUNT"],"","AD_ACCOUNT"]],
  };
  const options=contracts[tool];
  if(!options||!step||!step.root||!/^(?:act_)?\d{1,32}$/.test(step.root.id)||!options.some(([roots,edge,type])=>roots.includes(step.root.type)&&step.path===`/${step.root.id}${edge}`&&step.entityType===type&&step.list===(edge!=="")))throw new PlatformDenied("LEGACY_STATIC_ENDPOINT_CONTRACT_DENIED");
  if((step.root.type==="AD_ACCOUNT")!==step.root.id.startsWith("act_"))throw new PlatformDenied("LEGACY_STATIC_ENDPOINT_CONTRACT_DENIED");
  const allowed=FIELD_ALLOWLIST[step.entityType];
  if(!Array.isArray(step.projection)||!step.projection.length||step.projection.length>30||step.projection.some(f=>!allowed.includes(f))||step.query.fields!==step.projection.join(","))throw new PlatformDenied("LEGACY_STATIC_PROJECTION_DENIED");
  const keys=step.entityType==="INSIGHTS"?["fields","limit","date_preset","use_unified_attribution_setting","level","time_increment"]:step.list?["fields","limit","filtering"]:["fields"];
  if(Object.keys(step.query).some(k=>!keys.includes(k)))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
  if(step.query.limit!==undefined&&(!Number.isInteger(Number(step.query.limit))||Number(step.query.limit)<1||Number(step.query.limit)>100))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
  if(step.query.filtering!==undefined){let parsed:unknown;try{parsed=JSON.parse(String(step.query.filtering));}catch{throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");}if(!Array.isArray(parsed)||parsed.length!==1)throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");const f=parsed[0] as Record<string,unknown>;if(!f||Object.keys(f).sort().join(",")!=="field,operator,value"||f.field!=="effective_status"||f.operator!=="IN"||!Array.isArray(f.value)||f.value.length>4||f.value.some(v=>!["ACTIVE","PAUSED","DELETED","ARCHIVED"].includes(String(v))))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");}
  if(step.entityType==="INSIGHTS"){
    if(step.query.use_unified_attribution_setting!==true||typeof step.query.date_preset!=="string"||!/^[a-z0-9_]{1,40}$/.test(step.query.date_preset)||step.query.date_preset==="maximum")throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
    if(step.query.level!==undefined&&!["account","campaign","adset","ad"].includes(String(step.query.level)))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
    if(step.query.time_increment!==undefined&&!["1","7","monthly","all_days"].includes(String(step.query.time_increment)))throw new PlatformDenied("LEGACY_STATIC_QUERY_DENIED");
  }
}
function stepsFromScope(): LegacyReadStep[] {
  const scope = getExecutionScope();
  const steps = scope.plan.parameters.legacy_read_steps;
  if(!Array.isArray(steps) || scope.plan.classes.length !== 1 || scope.plan.classes[0] !== "READ" || scope.context.provider !== "META_MARKETING") throw new PlatformDenied("LEGACY_READ_PLAN_REQUIRED");
  if(steps.length<1||steps.length>(scope.context.tool==="ads_insights_advertiser_context"?3:1))throw new PlatformDenied("LEGACY_READ_STEP_COUNT_DENIED");
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
  const step=stepsFromScope().find(s=>s.path===path&&canonicalJson(Object.fromEntries(Object.entries(s.query).map(([k,v])=>[k,String(v)])))===canonicalJson(query));
  if(!step) throw new PlatformDenied("LEGACY_READ_PLAN_MISMATCH");
  const scope=getExecutionScope();
  if(!scope.snapshot.assets.some(a=>a.type===step.root.type&&a.id.replace(/^act_/,"")===step.root.id.replace(/^act_/,""))) throw new PlatformDenied("LEGACY_READ_ASSET_NOT_AUTHORIZED");
  await revalidateExecutionPermit(permit);
  assertLegacyMarketingReadEligibility();
}
export function projectLegacyReadResponse(path:string,urlString:string,body:unknown): unknown {
  if(!platformEnabled())return body;
  const query=queryObject(new URL(urlString));
  const step=stepsFromScope().find(s=>s.path===path&&canonicalJson(Object.fromEntries(Object.entries(s.query).map(([k,v])=>[k,String(v)])))===canonicalJson(query));
  if(!step)throw new PlatformDenied("LEGACY_READ_PLAN_MISMATCH");
  const scope=getExecutionScope();
  const allowedAssets=scope.snapshot.assets;
  const scalar=(value:unknown):boolean=>value===null||typeof value==="number"||typeof value==="boolean"||(typeof value==="string"&&value.length<=2000&&!/EAA[A-Za-z0-9]{20,}|(?:access_token|client_secret)=/i.test(value));
  const project=(input:unknown):Record<string,unknown>=>{
    if(!input||typeof input!=="object"||Array.isArray(input))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");
    const row=input as Record<string,unknown>;
    if(step.entityType!=="INSIGHTS") {
      const id=String(row.id??row.account_id??"").replace(/^act_/,"");
      if(!allowedAssets.some(a=>a.type===step.entityType&&a.id.replace(/^act_/,"")===id))throw new PlatformDenied("LEGACY_RESPONSE_UNREGISTERED_OBJECT");
    }
    for(const [field,type] of [["account_id","AD_ACCOUNT"],["campaign_id","CAMPAIGN"],["adset_id","AD_SET"],["ad_id","AD"]] as const){if(row[field]!==undefined&&!allowedAssets.some(a=>a.type===type&&a.id.replace(/^act_/,"")===String(row[field]).replace(/^act_/,"")))throw new PlatformDenied("LEGACY_RESPONSE_FOREIGN_PARENT");}
    const output:Record<string,unknown>={};
    for(const field of step.projection){
      if(row[field]===undefined)continue;
      const value=row[field];
      if(["actions","cost_per_action_type"].includes(field)){
        if(!Array.isArray(value)||value.length>200)throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");
        output[field]=value.map(v=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");const item=v as Record<string,unknown>;if(typeof item.action_type!=="string"||!/^[a-zA-Z0-9_.]{1,150}$/.test(item.action_type)||typeof item.value!=="string"||!/^\d+(?:\.\d+)?$/.test(item.value))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");return {action_type:item.action_type,value:item.value};});
      } else if(field==="special_ad_categories") {
        if(!Array.isArray(value)||value.length>20||value.some(v=>typeof v!=="string"||!/^[A-Z_]{1,60}$/.test(v)))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");output[field]=value;
      } else {if(!scalar(value))throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");output[field]=value;}
    }
    return output;
  };
  if(!step.list)return project(body);
  if(!body||typeof body!=="object"||!("data" in body)||!Array.isArray(body.data)||body.data.length>1000)throw new PlatformDenied("LEGACY_RESPONSE_SCHEMA_INVALID");
  const page=body as {data:unknown[];paging?:{next?:unknown}};
  return {data:page.data.map(project),lumin_page:{complete:!page.paging?.next,truncated:!!page.paging?.next,reason:page.paging?.next?"Strict read returns one bounded page; no provider next URL is followed or exposed.":"No next page returned by provider."}};
}
