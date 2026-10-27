import {CATALOG_CAMPAIGN_TOOL,catalogCampaignEnabled} from "./catalog-campaign-contract.js";
import {invoiceMetadataEnabled,INVOICE_METADATA_TOOL} from './business-invoice-metadata.js';
import {assertBusinessOwnerScope} from "./business-owner-scope.js";
import {attachmentEnabled} from "./attachment-flags.js";
import {publishingVideoEnabled,isPublishingVideoDraftTool} from "./publishing-video-flags.js";
import {pageVideoEnabled} from "./video-flags.js";
import {assertAccountOwnershipEvidence,assertAgencyAdvertisingAuthorization,classifyAccountOwnership} from "./ownership-evidence.js";
import { createHash } from "node:crypto";
import type { AuthorizationSnapshot, OperationClass, OperationContext, OperationPlan, SafeChange } from "./models.js";
import { PlatformDenied } from "./models.js";

export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function normalize(v: unknown, depth: number): unknown {
    if(depth > 30) throw new PlatformDenied("PLAN_TOO_DEEP");
    if(v === null || typeof v === "string" || typeof v === "boolean") return v;
    if(typeof v === "number" && Number.isFinite(v)) return v;
    if(typeof v !== "object" || v === undefined) throw new PlatformDenied("PLAN_INVALID_VALUE");
    if(seen.has(v)) throw new PlatformDenied("PLAN_CYCLE");
    seen.add(v);
    let result: unknown;
    if(Array.isArray(v)) result = v.map(x => normalize(x, depth + 1));
    else {
      if(Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new PlatformDenied("PLAN_NON_PLAIN_OBJECT");
      const object: Record<string, unknown> = {};
      for(const k of Object.keys(v).sort()) { if(["__proto__", "constructor", "prototype"].includes(k)) throw new PlatformDenied("PLAN_UNSAFE_KEY"); object[k] = normalize((v as Record<string, unknown>)[k], depth + 1); }
      result = object;
    }
    seen.delete(v); return result;
  }
  return JSON.stringify(normalize(value, 0));
}
function digest(v: unknown): string { return createHash("sha256").update(canonicalJson(v)).digest("hex"); }
export function canonicalPlanHash(ctx: OperationContext, plan: OperationPlan): string { return digest({ actor: ctx.principal.operatorId, tenant: ctx.principal.tenantId, client: ctx.clientId, tool: ctx.tool, provider: ctx.provider, plan }); }
/** Plan parameters that only record read-only evidence gathered before the request. They are not sent to Meta, and re-running a lookup mints new ids and expiries without changing a byte of the request. */
const NON_SENT_EVIDENCE_PARAMETERS: readonly string[] = ["targeting_lookup_ids", "targeting_lookup_selected"];
/**
 * The key of the per-plan lock: the plan hash with the non-sent evidence removed, so the lock follows what would reach Meta.
 * Approvals stay bound to the full `canonicalPlanHash`, so a human still reviews and approves the evidence itself.
 */
export function planLockHash(ctx: OperationContext, plan: OperationPlan): string {
  return canonicalPlanHash(ctx, { ...plan, parameters: Object.fromEntries(Object.entries(plan.parameters).filter(([name]) => !NON_SENT_EVIDENCE_PARAMETERS.includes(name))) });
}
export function revisionHash(snapshot: AuthorizationSnapshot): string { return digest({...(snapshot.businessOwnerEvidence?.attestations.length?{businessOwnerEvidence:{attestations:snapshot.businessOwnerEvidence.attestations.map(r=>[r.id,r.revision]).sort(),issuers:snapshot.businessOwnerEvidence.issuers.map(m=>[m.operatorId,m.revision]).sort(),connections:snapshot.businessOwnerEvidence.connections.map(c=>[c.id,c.revision]).sort(),credentials:snapshot.businessOwnerEvidence.credentials.map(c=>[c.id,digest(c)]).sort()}}:{}),...(snapshot.manualEligibilityEvidence?.attestations.length?{manualEligibility:{attestations:snapshot.manualEligibilityEvidence.attestations.map(r=>[r.id,r.revision]).sort(),issuers:snapshot.manualEligibilityEvidence.issuers.map(m=>[m.operatorId,m.revision]).sort()}}:{}),tenant: snapshot.tenant.policyRevision, registry: snapshot.tenant.registryRevision, ...(snapshot.financialEvidence&&(snapshot.financialEvidence.attestations.length||snapshot.financialEvidence.observations.length)?{financialEvidence:{attestations:snapshot.financialEvidence.attestations.map(r=>[r.id,r.revision]).sort(),observations:snapshot.financialEvidence.observations.map(r=>[r.id,r.revision]).sort()}}:{}), member: snapshot.member.revision, client: snapshot.client.revision, connection: [snapshot.connection.id, snapshot.connection.revision], assets: snapshot.assets.map(a => [a.key,a.revision]).sort(), grants: snapshot.grants.map(g => [g.id,g.revision]).sort()}); }
const MONEY_KEY = /budget|spend_cap|spend_target|spend_limit|(?:^|[^a-z])bid_/;
/** Whether a request key can set what Meta spends: matched after trimming, case folding and removing spaces, zero-width characters and bracket syntax, so a disguised spelling is still caught. */
export function isMoneyKey(key: string): boolean { return MONEY_KEY.test(key.normalize("NFKC").replace(/[\s\u200b-\u200f\u2060\ufeff]/g, "").toLowerCase()); }
const ACTIVATION_EXPECTATION_KEYS: readonly string[] = ["expected_campaign_daily_budget", "expected_adset_daily_budget", "expected_bid_strategy", "expected_bid_amount"];
/** Every money-looking key a plan would send, at any depth and inside JSON-encoded strings, exactly as written. */
export function planMoneyKeys(plan: OperationPlan): string[] { return analysePlan(plan).moneyKeys; }
export function classifyPlan(plan: OperationPlan): OperationClass[] { return analysePlan(plan).classes; }
function analysePlan(plan: OperationPlan): { classes: OperationClass[]; moneyKeys: string[] } {
  const classes = new Set(plan.classes);
  const moneyKeys: string[] = [];
  const pausedCreation = plan.createOrCopy && classes.has("WRITE_AD_CONFIGURATION");
  if(pausedCreation && plan.parameters.status !== "PAUSED") throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
  const expectationOnly = plan.capability === "marketing.activate.ad" && plan.classes.length===1 && plan.classes[0]==="ACTIVATE_SPEND" && (plan.parameters.endpointContract as {tool?:unknown}|undefined)?.tool==="marketing_activate_ad";
  let nodes = 0;
  const mentionsActive = (value: unknown, depth = 0): boolean => typeof value === "string" ? value.trim().toUpperCase() === "ACTIVE" : depth < 30 && !!value && typeof value === "object" && Object.values(value).some(v => mentionsActive(v, depth + 1));
  function inspect(value: unknown, depth: number): void {
    if(++nodes > 10000 || depth > 30) throw new PlatformDenied("PLAN_TOO_COMPLEX");
    if(pausedCreation && typeof value === "string" && value.trim().toUpperCase() === "INHERITED_FROM_SOURCE") throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
    // A string that parses as JSON is decoded and inspected. One that does not parse (`[New] Summer sale`, `{{product.name}}`) is plain text: Graph decodes these fields with a strict JSON parser too, so it carries no key.
    if(typeof value === "string" && /^[\s]*[\[{]/.test(value)) { let decoded: unknown; try { decoded = JSON.parse(value); } catch { return; } inspect(decoded, depth + 1); return; }
    if(Array.isArray(value)) { value.forEach(v => inspect(v, depth + 1)); return; }
    if(!value || typeof value !== "object") return;
    for(const [key, v] of Object.entries(value)) {
      const k = key.trim().toLowerCase();
      if(pausedCreation && (/(^|_)status(_option)?$/.test(k) || k === "target_status") && v !== "PAUSED") throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
      if((["status", "configured_status", "execution_options", "status_option", "target_status"].includes(k) && mentionsActive(v)) || (k === "execution_type" && typeof v === "string" && v.trim().toUpperCase() === "UNPAUSE")) {
        if(plan.createOrCopy) throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
        classes.add("ACTIVATE_SPEND");
      }
      if(isMoneyKey(key) && !(expectationOnly && depth===1 && value===plan.parameters.input && ACTIVATION_EXPECTATION_KEYS.includes(k))) { classes.add("WRITE_BUDGET"); moneyKeys.push(key); }
      if(k.includes("credit_line") || k.includes("payment_method") || k === "funding_id") classes.add("BILLING");
      if(k === "status" && typeof v === "string" && ["DELETED", "ARCHIVED"].includes(v.trim().toUpperCase())) classes.add("DELETE");
      inspect(v, depth + 1);
    }
  }
  inspect(plan.parameters, 0); canonicalJson(plan);
  if(!classes.size) throw new PlatformDenied("OPERATION_CLASS_REQUIRED");
  return { classes: [...classes].sort(), moneyKeys };
}
export function normalizeSafeDiff(parameters: Record<string, unknown>): SafeChange[] {
  const result: SafeChange[] = [];
  const budgets = new Set(["daily_budget","lifetime_budget","bid_amount","spend_cap","account_spend_limit"]);
  const statuses = new Set(["ACTIVE","PAUSED","ARCHIVED","DELETED"]);
  const objectives = new Set(["OUTCOME_AWARENESS","OUTCOME_TRAFFIC","OUTCOME_ENGAGEMENT","OUTCOME_LEADS","OUTCOME_APP_PROMOTION","OUTCOME_SALES"]);
  const ids = new Set(["newresource_id","source_id","source_ad_id","source_campaign_id","source_ad_set_id","campaign_id","adset_id","ad_set_id","ad_id","creative_id","page_id","instagram_actor_id","instagram_user_id","pixel_id","dataset_id","catalog_id","product_set_id","account_id"]);
  function visit(value: unknown, depth: number): void {
    if(depth > 20 || result.length >= 100) return;
    if(typeof value === "string" && /^[\s]*[\[{]/.test(value)) { try {visit(JSON.parse(value),depth+1);} catch { /* Unsupported opaque text is never recorded. */ } return; }
    if(Array.isArray(value)) { value.forEach(v=>visit(v,depth+1)); return; }
    if(!value || typeof value !== "object") return;
    for(const [field,v] of Object.entries(value)) {
      if(result.length >= 100) return;
      if(budgets.has(field) && ((typeof v === "number" && Number.isFinite(v) && v >= 0) || (typeof v === "string" && /^\d{1,18}$/.test(v)))) result.push({field,value:v});
      if(field === "status" && typeof v === "string" && statuses.has(v)) result.push({field,value:v});
      if(field === "objective" && typeof v === "string" && objectives.has(v)) result.push({field,value:v});
      if(ids.has(field) && typeof v === "string" && /^(?:act_)?\d{1,32}(?:_\d{1,32})?$/.test(v)) result.push({field,value:v});
      visit(v,depth+1);
    }
  }
  visit(parameters,0); return result;
}
/** Tools whose only effect is to persist a proposal for a later write. Their plans are READ class, so the class rule cannot stop them; a deployment with platform writes disabled has no way to approve or run the proposal, so none is stored. */
const PREPARATION_ONLY_TOOLS: readonly string[] = Object.freeze(["meta_plan_tracking_change"]);
/** Same definition as runtime.platformWritesEnabled, which this module cannot import without a load-order cycle; tests/platform/policy-preparation-tools.test.ts pins the two together. */
const platformWritesEnabled = (): boolean => process.env.LUMIN_PLATFORM_WRITES_ENABLED === "true" && process.env.AGENCY_WRITES_ENABLED === "true";
/** Operation classes that need a one-use human approval. WRITE_NON_FINANCIAL is deliberately absent: see docs/policy-engine.md (G2-03) for the recorded exemption. */
export const HUMAN_APPROVAL_CLASSES: readonly OperationClass[] = Object.freeze(["WRITE_AD_CONFIGURATION", "WRITE_BUDGET", "ACTIVATE_SPEND", "DELETE", "BUSINESS_ADMIN", "IDENTITY_OR_ACCESS", "BILLING", "WRITE_CONTENT", "WRITE_MESSAGING"] as OperationClass[]);
export const HUMAN_APPROVAL_FORCED_TOOLS: readonly string[] = Object.freeze(["signals_send_crm_lead_event"]);
export interface PolicyDecision { decision: "ALLOW" | "DENY" | "REQUIRE_CONFIRMATION"; reason: string; classes: OperationClass[] }
export type PolicyGuard = (ctx: OperationContext, plan: OperationPlan, snapshot: AuthorizationSnapshot) => void;
const policyGuards = new Map<string, PolicyGuard>();
/** A guard can only add a denial: it throws to refuse and returns to leave the decision unchanged. It runs for every mutating plan before an approval is requested, issued or consumed, so a refusal never costs a human a review or an approval its single use. A name can be taken once, so one module cannot silently replace another's guard. */
export function registerPolicyGuard(name: string, guard: PolicyGuard): void { if(policyGuards.has(name) && policyGuards.get(name) !== guard) throw new PlatformDenied("POLICY_GUARD_ALREADY_REGISTERED"); policyGuards.set(name, guard); }
export function unregisterPolicyGuard(name: string): void { policyGuards.delete(name); }
export function hasPolicyGuard(name: string): boolean { return policyGuards.has(name); }
export function evaluatePolicy(ctx: OperationContext, plan: OperationPlan, snapshot: AuthorizationSnapshot, options: { writesEnabled: boolean }): PolicyDecision {
  const classes = classifyPlan(plan);
  const deny = (reason: string): PolicyDecision => ({decision: "DENY", reason, classes});
  if(PREPARATION_ONLY_TOOLS.includes(ctx.tool) && !platformWritesEnabled()) return deny("DISABLED_BY_LUMIN_POLICY");
  try{assertBusinessOwnerScope(snapshot);}catch(error){if(error instanceof PlatformDenied)return deny(error.reason);throw error;}
  if(["messenger_send_audio","messenger_send_file","whatsapp_platform_send_audio","whatsapp_platform_send_document"].includes(ctx.tool)&&!attachmentEnabled())return deny("ATTACHMENT_DISABLED_BY_DEPLOYMENT");
  if(isPublishingVideoDraftTool(ctx.tool)&&!publishingVideoEnabled())return deny("PUBLISHING_VIDEO_DISABLED_BY_DEPLOYMENT");
  if(ctx.tool==="marketing_activate_ad"&&process.env.LUMIN_MARKETING_ACTIVATION_ENABLED!=="true")return deny("MARKETING_ACTIVATION_DISABLED_BY_DEPLOYMENT");
  if(ctx.tool===INVOICE_METADATA_TOOL&&!invoiceMetadataEnabled())return deny('INVOICE_METADATA_DISABLED_BY_DEPLOYMENT');
  if(ctx.tool==="marketing_get_ad_preview"&&process.env.LUMIN_MARKETING_PREVIEWS_ENABLED!=="true")return deny("MARKETING_PREVIEW_DISABLED_BY_DEPLOYMENT");
  if(ctx.tool==="marketing_list_app_event_types"&&(process.env.LUMIN_APP_EVENT_TYPES_ENABLED!=="true"||process.env.LUMIN_MARKETING_APP_PROMOTION_ENABLED!=="true"))return deny("APP_EVENT_TYPES_DISABLED");
  if(["marketing_inspect_image","marketing_inspect_creative_image"].includes(ctx.tool)&&process.env.LUMIN_IMAGE_INSPECTION_ENABLED!=="true")return deny("IMAGE_INSPECTION_DISABLED");
  if(["marketing_inspect_video","marketing_inspect_creative_video"].includes(ctx.tool)&&process.env.LUMIN_VIDEO_INSPECTION_ENABLED!=="true")return deny("VIDEO_INSPECTION_DISABLED");
  if(ctx.tool===CATALOG_CAMPAIGN_TOOL&&!catalogCampaignEnabled())return deny("CATALOG_CAMPAIGN_DISABLED");
  if(ctx.tool==="marketing_create_classic_split_study"&&process.env.LUMIN_MARKETING_STUDIES_ENABLED!=="true")return deny("CLASSIC_STUDY_DISABLED_BY_DEPLOYMENT");
  if(ctx.tool==="marketing_create_classic_split_study"&&!snapshot.member.roles.includes("admin"))return deny("CLASSIC_STUDY_OWNER_ADMIN_REQUIRED");
  if(classes.some(c=>c!=="READ")&&snapshot.assets.some(a=>a.type==="AD"&&a.deletionClaim))return deny(ctx.tool==="marketing_delete_paused_ad"?"DELETION_ALREADY_CLAIMED_RECONCILE":"DELETION_PENDING_RECONCILE");
  if(classes.some(c=>c!=="READ")&&snapshot.assets.some(a=>a.type==="AD"&&a.creativeRepointClaim))return deny("CREATIVE_REPOINT_PENDING_RECONCILE");
  if(ctx.tool==="marketing_delete_paused_ad"&&process.env.LUMIN_MARKETING_DELETION_ENABLED!=="true")return deny("MARKETING_DELETION_DISABLED_BY_DEPLOYMENT");
  if(["marketing_activate_ad","marketing_delete_paused_ad"].includes(ctx.tool)&&!snapshot.member.roles.includes("admin"))return deny("MARKETING_OWNER_ADMIN_REQUIRED");
  if(ctx.tool==="pages_create_videos"&&!pageVideoEnabled())return deny("PAGE_VIDEO_DISABLED_BY_DEPLOYMENT");
  if(snapshot.tenant.id !== ctx.principal.tenantId || snapshot.tenant.status !== "ACTIVE" || snapshot.tenant.migrationState !== "READY") return deny("TENANT_NOT_READY");
  if(snapshot.member.operatorId !== ctx.principal.operatorId || snapshot.member.tenantId !== ctx.principal.tenantId || snapshot.member.disabledAt !== null || !snapshot.member.allowedClientIds.includes(ctx.clientId)) return deny("CLIENT_MEMBERSHIP_REQUIRED");
  if(!Array.isArray(snapshot.member.roles) || !snapshot.member.roles.some(role=>["reader","writer","admin","approver"].includes(role))) return deny("READ_ROLE_REQUIRED");
  if(snapshot.client.id !== ctx.clientId || snapshot.client.tenantId !== ctx.principal.tenantId || snapshot.client.status !== "ACTIVE") return deny("CLIENT_ACCESS_REQUIRED");
  // Every advertising-account mutation must be bound to independently verified
  // client ownership and client billing evidence. Keep this class based rather
  // than tool-list based so newly registered controls cannot bypass the gate.
  const requiresClientAdAccountEvidence = ctx.provider === "META_MARKETING" && classes.some(c => ["WRITE_AD_CONFIGURATION", "WRITE_BUDGET", "ACTIVATE_SPEND"].includes(c));
  if(classes.some(c => c !== "READ")) {
    if(!options.writesEnabled) return deny("DISABLED_BY_LUMIN_POLICY");
    if(!snapshot.member.roles.includes("writer") && !snapshot.member.roles.includes("admin")) return deny("WRITE_ROLE_REQUIRED");
  }
  const accountMutationTool = ["marketing_upload_image","marketing_upload_video","marketing_create_empty_custom_audience","marketing_create_lookalike_audience","marketing_activate_ad","marketing_delete_paused_ad","marketing_create_purchase_conversion","marketing_create_async_report","marketing_create_disabled_pause_rule","marketing_create_classic_split_study"].includes(ctx.tool);
  if(requiresClientAdAccountEvidence || accountMutationTool){
    const account=snapshot.assets.filter(a=>a.type==="AD_ACCOUNT");
    if(account.length!==1)return deny("EXACT_CLIENT_AD_ACCOUNT_REQUIRED");
    const classification=classifyAccountOwnership(snapshot,account[0]);
    if(classification==="UNVERIFIED")return deny("ACCOUNT_OWNERSHIP_UNVERIFIED");
    if(classification==="AGENCY_OWNED"&&snapshot.client.id!==account[0].clientId)return deny("AGENCY_ACCOUNT_CLIENT_SCOPE_MISMATCH");
    try{assertAccountOwnershipEvidence(snapshot,account[0]);}catch(error){return deny(error instanceof PlatformDenied?error.reason:"OWNER_EVIDENCE_REQUIRED");}
    if(ctx.tool!=="marketing_create_async_report"){try{assertAgencyAdvertisingAuthorization(snapshot,account[0],classes.filter(c=>["WRITE_AD_CONFIGURATION","WRITE_BUDGET","ACTIVATE_SPEND"].includes(c)) as ("WRITE_AD_CONFIGURATION"|"WRITE_BUDGET"|"ACTIVATE_SPEND")[]);}catch(error){return deny(error instanceof PlatformDenied?error.reason:"ADVERTISING_AUTHORIZATION_REQUIRED");}}
    const requiredActions=classes.filter(c=>c!=="READ");
    if(requiredActions.length){
      const eligible=snapshot.grants.filter(g=>g.assetKey===account[0].key&&g.tenantId===ctx.principal.tenantId&&g.clientId===ctx.clientId&&g.connectionId===snapshot.connection.id&&g.revokedAt===null&&g.verifiedAt>0&&g.verifiedAt<=Date.now()&&g.expiresAt>Date.now()&&requiredActions.every(action=>g.actions.includes(action)));
      if(eligible.length!==1)return deny("SCOPED_AD_ACCOUNT_AUTHORIZATION_REQUIRED");
    }
  }
  if(classes.some(c => ["BUSINESS_ADMIN", "IDENTITY_OR_ACCESS", "BILLING"].includes(c)) && !snapshot.member.roles.includes("admin")) return deny("ADMIN_ROLE_REQUIRED");
  for(const required of plan.requiredAssetTasks??[]){
    const matches=snapshot.assets.filter(a=>a.type===required.asset.type&&a.id.replace(/^act_/,"")===required.asset.id.replace(/^act_/,""));
    if(matches.length!==1||!required.tasks.length||!snapshot.grants.some(g=>g.assetKey===matches[0].key&&g.tenantId===ctx.principal.tenantId&&g.clientId===ctx.clientId&&g.connectionId===snapshot.connection.id&&g.revokedAt===null&&g.expiresAt>Date.now()&&required.tasks.every(task=>g.tasks.includes(task))))return deny("SCOPED_ASSET_TASK_REQUIRED");
  }
  if(classes.some(c => c !== "READ")) for(const guard of policyGuards.values()) { try { guard(ctx, plan, snapshot); } catch(error) { return deny(error instanceof PlatformDenied ? error.reason : "POLICY_GUARD_FAILED"); } }
  return HUMAN_APPROVAL_FORCED_TOOLS.includes(ctx.tool)||classes.some(c => HUMAN_APPROVAL_CLASSES.includes(c)) ? {decision: "REQUIRE_CONFIRMATION", reason: "HUMAN_APPROVAL_REQUIRED", classes} : {decision: "ALLOW", reason: "AUTHORIZED", classes};
}



