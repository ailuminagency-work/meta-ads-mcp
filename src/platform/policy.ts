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
export function revisionHash(snapshot: AuthorizationSnapshot): string { return digest({tenant: snapshot.tenant.policyRevision, registry: snapshot.tenant.registryRevision, member: snapshot.member.revision, client: snapshot.client.revision, connection: [snapshot.connection.id, snapshot.connection.revision], assets: snapshot.assets.map(a => [a.key,a.revision]).sort(), grants: snapshot.grants.map(g => [g.id,g.revision]).sort()}); }
export function classifyPlan(plan: OperationPlan): OperationClass[] {
  const classes = new Set(plan.classes);
  const pausedCreation = plan.createOrCopy && classes.has("WRITE_AD_CONFIGURATION");
  if(pausedCreation && plan.parameters.status !== "PAUSED") throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
  let nodes = 0;
  function inspect(value: unknown, depth: number): void {
    if(++nodes > 10000 || depth > 30) throw new PlatformDenied("PLAN_TOO_COMPLEX");
    if(pausedCreation && typeof value === "string" && value.toUpperCase() === "INHERITED_FROM_SOURCE") throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
    if(typeof value === "string" && /^[\s]*[\[{]/.test(value)) { let decoded: unknown; try { decoded = JSON.parse(value); } catch { throw new PlatformDenied("OPAQUE_JSON_INVALID"); } inspect(decoded, depth + 1); return; }
    if(Array.isArray(value)) { value.forEach(v => inspect(v, depth + 1)); return; }
    if(!value || typeof value !== "object") return;
    for(const [key, v] of Object.entries(value)) {
      const k = key.toLowerCase();
      if(pausedCreation && ["status", "status_option", "target_status"].includes(k) && v !== "PAUSED") throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
      if((k === "status" || k === "execution_options" || k === "status_option" || k === "target_status") && typeof v === "string" && v.toUpperCase() === "ACTIVE") {
        if(plan.createOrCopy) throw new PlatformDenied("CREATE_MUST_REMAIN_PAUSED");
        classes.add("ACTIVATE_SPEND");
      }
      if(k.includes("budget") || k === "bid_amount" || k === "spend_cap" || k === "account_spend_limit") classes.add("WRITE_BUDGET");
      if(k.includes("credit_line") || k.includes("payment_method") || k === "funding_id") classes.add("BILLING");
      if(k === "status" && (v === "DELETED" || v === "ARCHIVED")) classes.add("DELETE");
      inspect(v, depth + 1);
    }
  }
  inspect(plan.parameters, 0); canonicalJson(plan);
  if(!classes.size) throw new PlatformDenied("OPERATION_CLASS_REQUIRED");
  return [...classes].sort();
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
export interface PolicyDecision { decision: "ALLOW" | "DENY" | "REQUIRE_CONFIRMATION"; reason: string; classes: OperationClass[] }
export function evaluatePolicy(ctx: OperationContext, plan: OperationPlan, snapshot: AuthorizationSnapshot, options: { writesEnabled: boolean }): PolicyDecision {
  const classes = classifyPlan(plan);
  const deny = (reason: string): PolicyDecision => ({decision: "DENY", reason, classes});
  if(snapshot.tenant.id !== ctx.principal.tenantId || snapshot.tenant.status !== "ACTIVE" || snapshot.tenant.migrationState !== "READY") return deny("TENANT_NOT_READY");
  if(snapshot.member.operatorId !== ctx.principal.operatorId || snapshot.member.tenantId !== ctx.principal.tenantId || snapshot.member.disabledAt !== null || !snapshot.member.allowedClientIds.includes(ctx.clientId)) return deny("CLIENT_MEMBERSHIP_REQUIRED");
  if(!Array.isArray(snapshot.member.roles) || !snapshot.member.roles.some(role=>["reader","writer","admin","approver"].includes(role))) return deny("READ_ROLE_REQUIRED");
  if(snapshot.client.id !== ctx.clientId || snapshot.client.tenantId !== ctx.principal.tenantId || snapshot.client.status !== "ACTIVE") return deny("CLIENT_ACCESS_REQUIRED");
  if(classes.some(c => c !== "READ")) {
    if(!options.writesEnabled) return deny("DISABLED_BY_LUMIN_POLICY");
    if(!snapshot.member.roles.includes("writer") && !snapshot.member.roles.includes("admin")) return deny("WRITE_ROLE_REQUIRED");
  }
  if(classes.some(c => ["BUSINESS_ADMIN", "IDENTITY_OR_ACCESS", "BILLING"].includes(c)) && !snapshot.member.roles.includes("admin")) return deny("ADMIN_ROLE_REQUIRED");
  const confirmation: OperationClass[] = ["WRITE_AD_CONFIGURATION", "WRITE_BUDGET", "ACTIVATE_SPEND", "DELETE", "BUSINESS_ADMIN", "IDENTITY_OR_ACCESS", "BILLING", "WRITE_CONTENT", "WRITE_MESSAGING"];
  return classes.some(c => confirmation.includes(c)) ? {decision: "REQUIRE_CONFIRMATION", reason: "HUMAN_APPROVAL_REQUIRED", classes} : {decision: "ALLOW", reason: "AUTHORIZED", classes};
}
