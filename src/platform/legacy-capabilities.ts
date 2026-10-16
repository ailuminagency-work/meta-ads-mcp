import type { PlatformRepository } from "./repository.js";
import type { CapabilityReport, CapabilityStatus } from "./capabilities.js";
import { LEGACY_MANIFEST, type LegacyManifestEntry } from "./legacy-manifest.js";
import { LEGACY_CORE_READ_DOCUMENTATION, LEGACY_CORE_READ_TOOLS } from "./legacy-read.js";
import { buildStrictLegacyWritePlan, LEGACY_CORE_WRITE_TOOLS, LEGACY_WRITE_SOURCES, validateLegacyWriteSnapshot } from "./legacy-write.js";
import { resolveAuthorizedAssets } from "./assets.js";
import { selectConnection } from "./connections.js";
import { evaluatePolicy } from "./policy.js";
import { getPlatformRepository, platformWritesEnabled } from "./runtime.js";
import { PlatformDenied, type AssetRef, type AssetType, type Connection, type MetaAsset, type OperationContext, type OperationPlan } from "./models.js";
import { resolveMetaApiVersion } from "../meta/api-version.js";

const isRead=(name:string):boolean=>LEGACY_CORE_READ_TOOLS.includes(name);
const migrated=(name:string):boolean=>isRead(name)||LEGACY_CORE_WRITE_TOOLS.includes(name);
function matches(a:AssetRef,b:AssetRef):boolean{return a.type===b.type&&a.id.replace(/^act_/,"")===b.id.replace(/^act_/,"");}
function reaches(asset:MetaAsset,root:MetaAsset,all:MetaAsset[],seen=new Set<string>()):boolean{
  if(asset.key===root.key)return true;if(seen.has(asset.key))return false;
  return asset.parents.some(ref=>all.some(parent=>matches(ref,parent)&&reaches(parent,root,all,new Set([...seen,asset.key]))));
}
function plans(tool:string,assets:MetaAsset[]):OperationPlan[]{
  if(!isRead(tool)){
    const output:OperationPlan[]=[];
    for(const account of assets.filter(a=>a.type==="AD_ACCOUNT")){
      const input:Record<string,unknown>={account_id:account.id,name:"Capability inspection only",status:"PAUSED"};
      if(tool==="ads_create_campaign")output.push(buildStrictLegacyWritePlan(tool,{...input,objective:"OUTCOME_TRAFFIC"}));
      else if(tool==="ads_create_ad_set")for(const campaign of assets.filter(a=>a.type==="CAMPAIGN"&&reaches(a,account,assets)))output.push(buildStrictLegacyWritePlan(tool,{...input,campaign_id:campaign.id,destination_type:"WEBSITE",optimization_goal:"LINK_CLICKS",targeting:{geo_locations:{countries:["US"]}}}));
      else for(const adset of assets.filter(a=>a.type==="AD_SET"&&reaches(a,account,assets)))for(const creative of assets.filter(a=>a.type==="CREATIVE"&&reaches(a,account,assets)))output.push(buildStrictLegacyWritePlan(tool,{...input,ad_set_id:adset.id,creative_id:creative.id}));
      if(output.length>100)throw new PlatformDenied("LEGACY_CAPABILITY_CANDIDATE_LIMIT_HOLD");
    }
    return output;
  }
  const roots:Record<string,AssetType[]>={ads_get_ad_accounts:["AD_ACCOUNT"],ads_get_account_info:["AD_ACCOUNT"],ads_get_campaigns:["AD_ACCOUNT"],ads_get_campaign_details:["CAMPAIGN"],ads_get_ad_sets:["AD_ACCOUNT","CAMPAIGN"],ads_get_ad_set_details:["AD_SET"],ads_get_ads:["AD_ACCOUNT","CAMPAIGN","AD_SET"],ads_get_ad_details:["AD"],ads_get_ad_entities:["AD_ACCOUNT","CAMPAIGN","AD_SET"],ads_get_insights:["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],ads_insights_performance_trend:["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],ads_insights_advertiser_context:["AD_ACCOUNT"]};
  const descendantTypes:Record<string,AssetType[]>={ads_get_campaigns:["CAMPAIGN"],ads_get_ad_sets:["AD_SET"],ads_get_ads:["AD"],ads_get_ad_entities:["CAMPAIGN","AD_SET","AD"],ads_get_insights:["CAMPAIGN","AD_SET","AD"],ads_insights_performance_trend:["CAMPAIGN","AD_SET","AD"],ads_insights_advertiser_context:["CAMPAIGN","AD_SET","AD"]};
  const readPlans:OperationPlan[]=assets.filter(a=>roots[tool].includes(a.type)).map(root=>({parameters:{},assets:[root,...assets.filter(a=>a.key!==root.key&&(descendantTypes[tool]??[]).includes(a.type)&&reaches(a,root,assets))].map(a=>({type:a.type,id:a.id})),classes:["READ"],capability:`legacy.${tool}`,requiredScopes:["ads_read"],tokenTypes:["user","system_user"]}));
  if(tool==="ads_get_ad_accounts"&&readPlans.length)return [{...readPlans[0],assets:readPlans.flatMap(p=>p.assets)}];
  return readPlans;
}
export async function legacyCapabilityStatus(ctx:OperationContext,entry:LegacyManifestEntry,now=Date.now(),repo:PlatformRepository=getPlatformRepository()):Promise<CapabilityReport>{
  let selected:Connection|undefined;
  const read=isRead(entry.name),core=migrated(entry.name);
  const report=(status:CapabilityStatus,reasons:string[],assetIds:string[]=[]):CapabilityReport=>({id:`legacy.${entry.name}`,product:entry.provider==="APIFY"?"Ads Library via Apify":entry.provider==="GEMINI"?"Gemini creative services":entry.provider==="META_WHATSAPP"?"Legacy WhatsApp":"Legacy Meta Ads",provider:entry.provider,tool:entry.name,status,apiAvailability:core?"VERIFIED":"UNVERIFIED",requiredPermissions:core?[read?"ads_read":"ads_management"]:[],grantedPermissions:[...selected?.scopes??[]].sort(),connectedAssetIds:assetIds,accessLevel:"UNVERIFIED",appReview:"UNVERIFIED",businessVerification:"UNVERIFIED",techProvider:"UNVERIFIED",marketingAccessTier:"UNVERIFIED",userConsentRequired:status==="USER_CONSENT_REQUIRED"||status==="NOT_CONNECTED",pageTasks:[],tokenTypes:core?["user","system_user"]:[],readAvailable:read&&status==="AVAILABLE",writeAvailable:false,activationAvailable:false,reasons,remediation:core?["Validate exact execution input, every registered reference and fresh provider evidence. Creations require a separately reviewed one-time plan approval."]:["Migrate this exact endpoint, references, output projection and operation policy before strict use."],documentation:core?[...(read?LEGACY_CORE_READ_DOCUMENTATION:LEGACY_WRITE_SOURCES)]:[]});
  if(!core){
    if(entry.provider==="META_CREDENTIALS"||/^(ads_register_|ads_delete_gemini_key|ads_set_active_token)/.test(entry.name))return report("DISABLED_BY_LUMIN_POLICY",["Legacy global credential mutation/selection is disabled; use protected provider-specific onboarding."]);
    if(entry.provider==="APIFY")return report("UNVERIFIED",["HOLD: separate paid Apify credential, tenant/client run and dataset provenance, spend caps and human cost approval are required. This is not direct Meta Ads API access."]);
    if(entry.provider==="GEMINI")return report("UNVERIFIED",["HOLD: separate paid Gemini connection, client media provenance, cost caps and human cost approval are required."]);
    return report("UNVERIFIED",["HOLD: strict legacy endpoint/reference/projection or complex workflow migration is incomplete; API support has not been disproven."]);
  }
  const context={...ctx,tool:entry.name,provider:"META_MARKETING" as const};
  const [tenant,member,client]=await Promise.all([repo.get("tenants",ctx.principal.tenantId,ctx.principal.tenantId),repo.get("members",ctx.principal.tenantId,ctx.principal.operatorId),repo.get("clients",ctx.principal.tenantId,ctx.clientId)]);
  if(!tenant||tenant.id!==ctx.principal.tenantId||tenant.status!=="ACTIVE"||tenant.migrationState!=="READY")return report("DISABLED_BY_LUMIN_POLICY",["TENANT_NOT_READY"]);
  if(!member||member.operatorId!==ctx.principal.operatorId||member.tenantId!==ctx.principal.tenantId||member.disabledAt!==null||!member.allowedClientIds.includes(ctx.clientId)||!client||client.tenantId!==ctx.principal.tenantId||client.id!==ctx.clientId||client.status!=="ACTIVE")return report("ASSET_ACCESS_REQUIRED",["CLIENT_MEMBERSHIP_REQUIRED"]);
  if(!read&&!platformWritesEnabled())return report("DISABLED_BY_LUMIN_POLICY",["Platform mutations are disabled."]);
  const connections=(await repo.list("connections",ctx.principal.tenantId)).filter(c=>c.tenantId===ctx.principal.tenantId&&c.operatorId===ctx.principal.operatorId&&c.provider==="META_MARKETING"&&c.revokedAt===null);
  if(!connections.length)return report("NOT_CONNECTED",["No selected product-specific connection exists."]);
  if(connections.every(c=>c.expiresAt!==null&&c.expiresAt<=now))return report("TOKEN_EXPIRED",["No live Meta Marketing credential."]);
  const registered=(await repo.list("assets",ctx.principal.tenantId)).filter(a=>a.tenantId===ctx.principal.tenantId&&a.clientId===ctx.clientId&&a.provider==="META_MARKETING"&&a.revokedAt===null);
  let candidates:OperationPlan[];try{candidates=plans(entry.name,registered);}catch(error){return report("UNVERIFIED",[error instanceof PlatformDenied?error.reason:"CAPABILITY_PLAN_HOLD"]);}
  if(!candidates.length)return report("ASSET_ACCESS_REQUIRED",["Registered exact-type roots and parent references are required."]);
  let fallback:CapabilityReport|undefined;
  for(const plan of candidates){
    try{
      const assets=await resolveAuthorizedAssets(repo,context,plan.assets,now,read?3600000:300000),connection=await selectConnection(repo,context,plan,assets,now);selected=connection;
      const grants=(await repo.list("grants",ctx.principal.tenantId)).filter(g=>g.connectionId===connection.id&&g.tenantId===ctx.principal.tenantId&&g.clientId===ctx.clientId&&assets.some(a=>a.key===g.assetKey)&&g.revokedAt===null&&g.expiresAt>now);
      const snapshot={tenant,member,client,assets,connection,grants},decision=evaluatePolicy(context,plan,snapshot,{writesEnabled:platformWritesEnabled()});
      if(decision.decision==="DENY"){fallback??=report("DISABLED_BY_LUMIN_POLICY",[decision.reason]);continue;}
      const credential=await repo.get("credentials",ctx.principal.tenantId,connection.credentialId);
      if(!credential||credential.id!==connection.credentialId||credential.tenantId!==connection.tenantId||credential.operatorId!==connection.operatorId||credential.appId!==connection.appId||credential.provider!==connection.provider||credential.envelopeVersion!==1||credential.keyVersion!=="primary"){fallback??=report("UNVERIFIED",["CREDENTIAL_BINDING_REQUIRED"]);continue;}
      if(!read)validateLegacyWriteSnapshot(plan,snapshot,now);
      else if(!connection.eligibility?.some(e=>e.requirement===`marketing_read_access:${resolveMetaApiVersion()}`&&e.verified&&Number.isFinite(e.checkedAt)&&e.checkedAt>0&&e.checkedAt<=now&&now-e.checkedAt<=3600000&&Number.isFinite(e.expiresAt)&&e.expiresAt>now&&/^https:\/\/(developers\.facebook\.com\/|www\.postman\.com\/meta\/|github\.com\/facebook\/)/.test(e.source)))throw new PlatformDenied("UNVERIFIED_MARKETING_READ_ACCESS");
      return report(read?"AVAILABLE":"USER_CONSENT_REQUIRED",[read?"Pure dry-run authorized for a bounded registered-asset subset; exact input and provider response remain enforced at execution.":"Minimal paused creation policy is eligible; exact input, budget classes and one-time human approval are still required."],assets.map(a=>a.id));
    }catch(error){const reason=error instanceof PlatformDenied?error.reason:"CAPABILITY_EVIDENCE_UNAVAILABLE";fallback??=report(reason==="PERMISSION_OR_CONNECTION_REQUIRED"?"PERMISSION_REQUIRED":reason.startsWith("ASSET_")?"ASSET_ACCESS_REQUIRED":"UNVERIFIED",[reason]);}
  }
  return fallback??report("UNVERIFIED",["No fully authorized dry-run candidate."]);
}
export async function listLegacyCapabilities(ctx:OperationContext,repo:PlatformRepository=getPlatformRepository()):Promise<CapabilityReport[]>{
  const result:CapabilityReport[]=[];for(const entry of LEGACY_MANIFEST)result.push(await legacyCapabilityStatus(ctx,entry,Date.now(),repo));return result;
}
