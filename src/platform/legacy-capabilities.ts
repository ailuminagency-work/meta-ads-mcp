import {legacyMarketingReadEligibilityContract,legacyMarketingReadRequirement,legacyMarketingWriteRequirement} from "./legacy-marketing-eligibility.js";
import {loadManualEligibilityEvidence,assertManualEligibilityAttestation} from "./manual-eligibility.js";
import {INVOICE_METADATA_TOOL} from './business-invoice-metadata.js';
import {AUDIENCE_ESTIMATE_TOOL,AUDIENCE_ESTIMATE_SOURCE} from "./audience-estimate-contract.js";
import {LEGACY_TARGETING_TAXONOMY_TOOLS,TARGETING_TAXONOMY_SOURCE} from "./legacy-targeting-taxonomy.js";
import {LEGACY_ENTITY_UPDATE_TOOLS} from "./legacy-entity-update.js";
import {LEGACY_TRACKING_WORKFLOW_TOOLS} from "./legacy-tracking.js";
import {LEGACY_MARKETING_PRODUCT_ALIASES} from "./legacy-marketing-products.js";
import {LEGACY_INSTAGRAM_CAPABILITIES} from "./legacy-instagram.js";
import {loadOwnershipEvidence} from "./ownership-evidence.js";
import {LEGACY_LEAD_CAPABILITIES} from "./legacy-leads.js";
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
import { ADDITIONAL_LEGACY_READ_CONTRACTS } from "./legacy-read-contracts.js";
import { expandVerifiedPermissionDependencies } from "./products/permission-dependencies.js";
import {LEGACY_UPDATE_TOOLS} from "./legacy-mutation.js";
import {LEGACY_TARGETING_LOOKUP_TOOLS} from "./legacy-targeting-lookup.js";
import {discoveryEnabled} from "./discovery-runtime.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";

const isRead=(name:string):boolean=>name===AUDIENCE_ESTIMATE_TOOL||LEGACY_TARGETING_TAXONOMY_TOOLS.includes(name)||LEGACY_CORE_READ_TOOLS.includes(name)||LEGACY_TARGETING_LOOKUP_TOOLS.includes(name);
const migrated=(name:string):boolean=>LEGACY_ENTITY_UPDATE_TOOLS.includes(name)||LEGACY_TRACKING_WORKFLOW_TOOLS.includes(name)||isRead(name)||LEGACY_CORE_WRITE_TOOLS.includes(name);
function matches(a:AssetRef,b:AssetRef):boolean{return a.type===b.type&&a.id.replace(/^act_/,"")===b.id.replace(/^act_/,"");}
function reaches(asset:MetaAsset,root:MetaAsset,all:MetaAsset[],seen=new Set<string>()):boolean{
  if(asset.key===root.key)return true;if(seen.has(asset.key))return false;
  return asset.parents.some(ref=>all.some(parent=>matches(ref,parent)&&reaches(parent,root,all,new Set([...seen,asset.key]))));
}
function plans(tool:string,assets:MetaAsset[]):OperationPlan[]{
  if(LEGACY_ENTITY_UPDATE_TOOLS.includes(tool))return ["ads_update_campaign","ads_update_ad_set","ads_update_ad"].flatMap(canonical=>plans(canonical,assets));
  if(LEGACY_TRACKING_WORKFLOW_TOOLS.includes(tool))return assets.filter(a=>a.type==="AD").map(a=>({assets:[{type:"AD",id:a.id}],classes:["READ"],capability:"legacy.ads_get_ad_details",requiredScopes:expandVerifiedPermissionDependencies(["ads_read","ads_management"]),tokenTypes:["user"],parameters:{trackingInspection:true}}));
  if(tool===AUDIENCE_ESTIMATE_TOOL||LEGACY_TARGETING_TAXONOMY_TOOLS.includes(tool))return assets.filter(a=>a.type==="AD_ACCOUNT"&&a.parents.length===0).map(a=>({parameters:{publicTaxonomyOnly:true},assets:[{type:"AD_ACCOUNT",id:a.id}],classes:["READ"],capability:`legacy.${tool}`,requiredScopes:["ads_read"],tokenTypes:["user","system_user"]}));
  if(LEGACY_TARGETING_LOOKUP_TOOLS.includes(tool))return assets.filter(a=>a.type==="AD_ACCOUNT").flatMap(root=>[{parameters:{},assets:[{type:root.type,id:root.id}],classes:["READ"],capability:`legacy.${tool}`,requiredScopes:["ads_read"],tokenTypes:["user","system_user"]} as OperationPlan,...assets.filter(a=>a.type==="PAGE"&&a.appId===root.appId).map(page=>({parameters:{},assets:[{type:root.type,id:root.id},{type:page.type,id:page.id}],classes:["READ"],capability:`legacy.${tool}`,requiredScopes:["ads_read"],tokenTypes:["page"]} as OperationPlan))]);
  if(!isRead(tool)){
    const output:OperationPlan[]=[];
    if(LEGACY_UPDATE_TOOLS.includes(tool)){
      const type=tool==="ads_update_ad_creative"?"CREATIVE":tool==="ads_update_campaign"?"CAMPAIGN":tool==="ads_update_ad_set"?"AD_SET":"AD",key=tool==="ads_update_ad_creative"?"creative_id":tool==="ads_update_campaign"?"campaign_id":tool==="ads_update_ad_set"?"ad_set_id":"ad_id";
      return assets.filter(a=>a.type===type).map(a=>buildStrictLegacyWritePlan(tool,{[key]:a.id,...(tool==="ads_update_ad_creative"?{name:"Capability inspection only"}:{status:"PAUSED"})}));
    }
    for(const account of assets.filter(a=>a.type==="AD_ACCOUNT")){
      const input:Record<string,unknown>={account_id:account.id,name:"Capability inspection only",status:"PAUSED"};
      if(tool==="ads_create_campaign")output.push(buildStrictLegacyWritePlan(tool,{...input,objective:"OUTCOME_TRAFFIC"}));
      else if(tool==="ads_create_ad_set")for(const campaign of assets.filter(a=>a.type==="CAMPAIGN"&&reaches(a,account,assets)))output.push(buildStrictLegacyWritePlan(tool,{...input,campaign_id:campaign.id,destination_type:"WEBSITE",optimization_goal:"LINK_CLICKS",targeting:{geo_locations:{countries:["US"]}}}));
      else for(const adset of assets.filter(a=>a.type==="AD_SET"&&reaches(a,account,assets)))for(const creative of assets.filter(a=>a.type==="CREATIVE"&&reaches(a,account,assets)))output.push(buildStrictLegacyWritePlan(tool,{...input,ad_set_id:adset.id,creative_id:creative.id}));
      if(output.length>100)throw new PlatformDenied("LEGACY_CAPABILITY_CANDIDATE_LIMIT_HOLD");
    }
    return output;
  }
  const additional=ADDITIONAL_LEGACY_READ_CONTRACTS[tool];
  if(additional)return assets.filter(a=>additional.roots.some(root=>root.type===a.type)).map(root=>{
    const related=additional.edge?assets.filter(a=>a.key!==root.key&&a.type===additional.entityType&&(reaches(a,root,assets)||(root.type==="AD"&&root.parents.some(p=>matches(p,a))))):[];
    return {parameters:{},assets:[root,...related].map(a=>({type:a.type,id:a.id})),classes:["READ"],capability:`legacy.${tool}`,requiredScopes:["ads_read"],tokenTypes:["user","system_user"]};
  });
  const roots:Record<string,AssetType[]>={ads_get_ad_accounts:["AD_ACCOUNT"],ads_portfolio_summary:["AD_ACCOUNT"],ads_rate_status:["AD_ACCOUNT"],ads_get_account_info:["AD_ACCOUNT"],ads_get_campaigns:["AD_ACCOUNT"],ads_get_campaign_details:["CAMPAIGN"],ads_get_ad_sets:["AD_ACCOUNT","CAMPAIGN"],ads_get_ad_set_details:["AD_SET"],ads_get_ads:["AD_ACCOUNT","CAMPAIGN","AD_SET"],ads_get_ad_details:["AD"],ads_get_ad_entities:["AD_ACCOUNT","CAMPAIGN","AD_SET"],ads_insights_anomaly_signal:["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],ads_get_insights:["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],ads_insights_performance_trend:["AD_ACCOUNT","CAMPAIGN","AD_SET","AD"],ads_insights_advertiser_context:["AD_ACCOUNT"]};
  const descendantTypes:Record<string,AssetType[]>={ads_get_campaigns:["CAMPAIGN"],ads_get_ad_sets:["AD_SET"],ads_get_ads:["AD"],ads_get_ad_entities:["CAMPAIGN","AD_SET","AD"],ads_get_insights:["CAMPAIGN","AD_SET","AD"],ads_insights_performance_trend:["CAMPAIGN","AD_SET","AD"],ads_insights_advertiser_context:["CAMPAIGN","AD_SET","AD"]};
  const readPlans:OperationPlan[]=assets.filter(a=>roots[tool].includes(a.type)).map(root=>({parameters:{},assets:[root,...assets.filter(a=>a.key!==root.key&&(descendantTypes[tool]??[]).includes(a.type)&&reaches(a,root,assets))].map(a=>({type:a.type,id:a.id})),classes:["READ"],capability:`legacy.${tool}`,requiredScopes:["ads_read"],tokenTypes:["user","system_user"]}));
  if((tool==="ads_get_ad_accounts"||tool==="ads_portfolio_summary"||tool==="ads_rate_status")&&readPlans.length)return [{...readPlans[0],assets:readPlans.flatMap(p=>p.assets)}];
  return readPlans;
}
export async function legacyCapabilityStatus(ctx:OperationContext,entry:LegacyManifestEntry,now=Date.now(),repo:PlatformRepository=getPlatformRepository()):Promise<CapabilityReport>{
  const whatsAppAliases:Record<string,string>={whatsapp_get_business_accounts:"business_list_owned_wabas",whatsapp_get_qr_codes:"whatsapp_platform_list_qr_codes",whatsapp_create_qr_code:"whatsapp_platform_create_qr_code",whatsapp_update_qr_code:"whatsapp_platform_update_qr_code",whatsapp_delete_qr_code:"whatsapp_platform_delete_qr_code",whatsapp_get_webhook_subscriptions:"whatsapp_platform_get_subscriptions",whatsapp_get_phone_numbers:"whatsapp_platform_list_phones",whatsapp_get_business_profile:"whatsapp_platform_get_profile",whatsapp_subscribe_webhook:"whatsapp_platform_subscribe",whatsapp_unsubscribe_webhook:"whatsapp_platform_unsubscribe",whatsapp_get_templates:"whatsapp_platform_list_templates",whatsapp_get_flows:"whatsapp_platform_list_flows",whatsapp_create_template:"whatsapp_platform_create_template",whatsapp_update_template:"whatsapp_platform_update_template",whatsapp_delete_template:"whatsapp_platform_delete_template",whatsapp_create_flow:"whatsapp_platform_create_flow",whatsapp_update_flow:"whatsapp_platform_update_flow",whatsapp_publish_flow:"whatsapp_platform_publish_flow",whatsapp_deprecate_flow:"whatsapp_platform_deprecate_flow",whatsapp_delete_flow:"whatsapp_platform_delete_flow"};
  const canonical=(entry.name==="ads_get_creative_media"?"marketing_inspect_creative_image":undefined)??(entry.name==="ads_get_invoices"?INVOICE_METADATA_TOOL:undefined)??(entry.name==="ads_get_pages_for_business"?"business_list_owned_pages":undefined)??LEGACY_MARKETING_PRODUCT_ALIASES[entry.name]??LEGACY_INSTAGRAM_CAPABILITIES[entry.name]??(entry.name==="ads_upload_ad_image"?"marketing_upload_image":undefined)??(entry.name==="ads_create_lead_form"?"leads_create_form":undefined)??whatsAppAliases[entry.name]??(LEGACY_LEAD_CAPABILITIES as Readonly<Record<string,string>>)[entry.name];if(canonical){const contract=PRODUCT_CONTRACTS.find(c=>c.tool===canonical||c.id===canonical);if(contract){const {capabilityStatus}=await import("./capabilities.js"),report=await capabilityStatus(ctx,contract,now,repo);return {...report,id:`legacy.${entry.name}`,tool:entry.name,product:entry.provider==="META_WHATSAPP"?"Legacy WhatsApp through bounded canonical transport":LEGACY_INSTAGRAM_CAPABILITIES[entry.name]?"Legacy Instagram through scoped canonical metadata":"Legacy client lead actions through canonical privacy transport",writeAvailable:false,activationAvailable:false,reasons:[...report.reasons,"Original tool maps to the canonical client-scoped transport. Exact input/parent binding and private output projection remain enforced; mutations require separate human approval."]};}}
  let selected:Connection|undefined;
  const read=isRead(entry.name),workflow=LEGACY_TRACKING_WORKFLOW_TOOLS.includes(entry.name),core=migrated(entry.name);
  const report=(status:CapabilityStatus,reasons:string[],assetIds:string[]=[]):CapabilityReport=>({id:`legacy.${entry.name}`,product:entry.provider==="APIFY"?"Ads Library via Apify":entry.provider==="GEMINI"?"Gemini creative services":entry.provider==="META_WHATSAPP"?"Legacy WhatsApp":"Legacy Meta Ads",provider:entry.provider,tool:entry.name,status,apiAvailability:core?"VERIFIED":"UNVERIFIED",requiredPermissions:core?expandVerifiedPermissionDependencies(workflow?["ads_read","ads_management"]:[read?"ads_read":"ads_management"]):[],grantedPermissions:[...selected?.scopes??[]].sort(),connectedAssetIds:assetIds,accessLevel:"UNVERIFIED",appReview:"UNVERIFIED",businessVerification:"UNVERIFIED",techProvider:"UNVERIFIED",marketingAccessTier:"UNVERIFIED",userConsentRequired:status==="USER_CONSENT_REQUIRED"||status==="NOT_CONNECTED",pageTasks:[],tokenTypes:core?(selected?[selected.tokenType]:workflow?["user"]:LEGACY_TARGETING_LOOKUP_TOOLS.includes(entry.name)?["user","system_user","page"]:["user","system_user"]):[],readAvailable:read&&status==="AVAILABLE",writeAvailable:false,activationAvailable:false,reasons,remediation:core?["Validate exact execution input, every registered reference and fresh provider evidence. Creations require a separately reviewed one-time plan approval."]:["Migrate this exact endpoint, references, output projection and operation policy before strict use."],documentation:core?[...(entry.name===AUDIENCE_ESTIMATE_TOOL?[AUDIENCE_ESTIMATE_SOURCE]:LEGACY_TARGETING_TAXONOMY_TOOLS.includes(entry.name)?[TARGETING_TAXONOMY_SOURCE]:ADDITIONAL_LEGACY_READ_CONTRACTS[entry.name]?.documentation??(read?LEGACY_CORE_READ_DOCUMENTATION:LEGACY_WRITE_SOURCES))]:[]});
  if(entry.name==="ads_library_list_runs")return {...report("PARTIAL",["Implemented saved PUBLIC acquisition metadata subset through meta_research_list_public_acquisitions; current client reader, original actors/reviewers, consumed approvals, encrypted jobs and identity/privacy locks are verified atomically at invocation. This inventory does not certify readable jobs.","No paid provider-wide run enumeration, query/results, credentials, network call or completeness claim." ]),apiAvailability:"VERIFIED",product:"Saved PUBLIC research metadata",requiredPermissions:[],tokenTypes:[],userConsentRequired:false,documentation:[],remediation:["Use explicit client_id and optional limit1..25; complete existing client/operator authorization. No paid vendor credential is required to read retained observations."]};
  if(workflow&&(process.env.LUMIN_TRACKING_CHANGE_ENABLED!=="true"||process.env.LUMIN_MARKETING_CREATIVE_REPLACEMENT_ENABLED!=="true"||!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??"")))return report("DISABLED_BY_LUMIN_POLICY",["Encrypted two-step tracking review workflow is disabled by deployment."]);
  if(LEGACY_TARGETING_LOOKUP_TOOLS.includes(entry.name)&&(!discoveryEnabled()||!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??"")))return report("DISABLED_BY_LUMIN_POLICY",["Encrypted targeting lookup storage is disabled by deployment."]);
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
  if(!read&&!workflow&&!platformWritesEnabled())return report("DISABLED_BY_LUMIN_POLICY",["Platform mutations are disabled."]);
  if(entry.name==="ads_create_ad_creative")return report("UNVERIFIED",["Typed registered-Page/image creative endpoint is implemented. Availability depends on the exact reviewed destination, registered image and current Page-advertise/account relationship evidence; generic discovery cannot infer these inputs. Prepare the concrete action for authorization."]);
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
      const snapshot={tenant,member,client,assets,connection,grants,financialEvidence:await loadOwnershipEvidence(repo,ctx,assets),manualEligibilityEvidence:await loadManualEligibilityEvidence(repo,context,connection,[legacyMarketingReadRequirement(),legacyMarketingWriteRequirement()])},decision=evaluatePolicy(context,plan,snapshot,{writesEnabled:platformWritesEnabled()});
      if(decision.decision==="DENY"){fallback??=report("DISABLED_BY_LUMIN_POLICY",[decision.reason]);continue;}
      const credential=await repo.get("credentials",ctx.principal.tenantId,connection.credentialId);
      if(!credential||credential.id!==connection.credentialId||credential.tenantId!==connection.tenantId||credential.operatorId!==connection.operatorId||credential.appId!==connection.appId||credential.provider!==connection.provider||credential.envelopeVersion!==1||credential.keyVersion!=="primary"){fallback??=report("UNVERIFIED",["CREDENTIAL_BINDING_REQUIRED"]);continue;}
      if(!read&&!workflow)validateLegacyWriteSnapshot(plan,snapshot,now);
      else if(entry.name!=="ads_rate_status"&&!connection.eligibility?.some(e=>e.requirement===`marketing_read_access:${resolveMetaApiVersion()}`&&e.verified&&Number.isFinite(e.checkedAt)&&e.checkedAt>0&&e.checkedAt<=now&&now-e.checkedAt<=3600000&&Number.isFinite(e.expiresAt)&&e.expiresAt>now&&/^https:\/\/(developers\.facebook\.com\/|www\.postman\.com\/meta\/|github\.com\/facebook\/)/.test(e.source)))throw new PlatformDenied("UNVERIFIED_MARKETING_READ_ACCESS");
      if((read||workflow)&&connection.provider==="META_MARKETING"&&connection.eligibility?.some(e=>e.requirement===legacyMarketingReadRequirement()&&e.attestationId))assertManualEligibilityAttestation(legacyMarketingReadEligibilityContract(),connection,legacyMarketingReadRequirement(),await loadManualEligibilityEvidence(repo,context,connection,[legacyMarketingReadRequirement()]),ctx.clientId,now);
      if(workflow){if(!member.roles.some(role=>["writer","admin","approver"].includes(role))||assets.some(a=>!grants.some(g=>g.assetKey===a.key&&g.verifiedAt>0&&g.verifiedAt<=now&&now-g.verifiedAt<=300000&&g.actions.includes("WRITE_AD_CONFIGURATION")&&["legacy.ads_create_ad_creative","legacy.ads_update_ad"].every(cap=>g.capabilities.includes(cap))&&(a.type!=="PAGE"||g.tasks.includes("ADVERTISE")))))throw new PlatformDenied("TRACKING_CURRENT_SOURCE_WRITE_GRANTS_REQUIRED");return report("USER_CONSENT_REQUIRED",["STRICT_LOCAL_REVIEW_WORKFLOW: dry_run:true for one registered paused AD inspects a bounded typed source and creates an encrypted review proposal. Two separate current human approvals are required for replacement creative and paused AD repoint. No automatic dispatch, bulk semantics or engagement preservation; provider source inspection may still reject unsupported creative forms."],assets.map(a=>a.id));}
      return report(read?"AVAILABLE":"USER_CONSENT_REQUIRED",[read?"Pure dry-run authorized for a bounded registered-asset subset; exact input and provider response remain enforced at execution.":entry.name==="ads_update_ad_creative"?"Name-only creative update policy is eligible; exact current account proof and one-time human approval are still required.":"Minimal paused creation or update policy is eligible; exact input, budget classes and one-time human approval are still required."],assets.map(a=>a.id));
    }catch(error){const reason=error instanceof PlatformDenied?error.reason:"CAPABILITY_EVIDENCE_UNAVAILABLE";fallback??=report(reason==="PERMISSION_OR_CONNECTION_REQUIRED"?"PERMISSION_REQUIRED":reason.startsWith("ASSET_")?"ASSET_ACCESS_REQUIRED":"UNVERIFIED",[reason]);}
  }
  return fallback??report("UNVERIFIED",["No fully authorized dry-run candidate."]);
}
export async function listLegacyCapabilities(ctx:OperationContext,repo:PlatformRepository=getPlatformRepository()):Promise<CapabilityReport[]>{
  const result:CapabilityReport[]=[];for(const entry of LEGACY_MANIFEST)result.push(await legacyCapabilityStatus(ctx,entry,Date.now(),repo));return result;
}
