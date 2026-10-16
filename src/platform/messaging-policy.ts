import { createHash, createHmac } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import type { AuthorizationSnapshot, OperationContext, OperationPlan, Provider } from "./models.js";
import { PlatformDenied } from "./models.js";

const WINDOW = 24 * 60 * 60_000;
const RETENTION = 90 * WINDOW; // Lumin policy, not a claimed Meta limit.
export interface MessagingScope { tenantId:string; clientId:string; provider:Provider; appId:string; assetId:string; recipientHmac:string }
export interface TrustedInboundEvidence { eventId:string; occurredAt:number; receivedAt:number; verified:true; source:"meta_signed_webhook" }
export interface TrustedOptInEvidence { eventId:string; occurredAt:number; receivedAt:number; expiresAt:number; purpose:"service"|"utility"; granted:boolean; verified:true; source:"verified_client_consent" }
export interface TrustedTemplateEvidence { eventId:string; occurredAt:number; receivedAt:number; expiresAt:number; name:string; language:string; accountId:string; status:"APPROVED"|"PENDING"|"REJECTED"|"PAUSED"|"DISABLED"; category:"UTILITY"; verified:true; source:"meta_authenticated_template_refresh" }
export interface MessagingState { inbound?:TrustedInboundEvidence; optIn?:TrustedOptInEvidence; templates:TrustedTemplateEvidence[] }
export interface MessagingAudit { scopeHash:string; eventHash:string; kind:"INBOUND"|"OPT_IN"|"TEMPLATE"; timestamp:number }
type Update = {kind:"INBOUND"; evidence:TrustedInboundEvidence}|{kind:"OPT_IN"; evidence:TrustedOptInEvidence}|{kind:"TEMPLATE"; evidence:TrustedTemplateEvidence};
export interface MessagingPolicyStore {
  get(scope:MessagingScope):Promise<MessagingState|null>;
  /** The immutable event marker, state merge and append-only audit must share one transaction. */
  commit(scope:MessagingScope,eventHash:string,update:Update,audit:MessagingAudit):Promise<"RECORDED"|"DUPLICATE">;
}
function scopeHash(scope:MessagingScope):string { return createHash("sha256").update(JSON.stringify([scope.tenantId,scope.clientId,scope.provider,scope.appId,scope.assetId,scope.recipientHmac])).digest("hex"); }
function merge(state:MessagingState|null, update:Update):MessagingState {
  const result:MessagingState = structuredClone(state ?? {templates:[]});
  if(update.kind === "INBOUND") { if(!result.inbound || update.evidence.occurredAt>result.inbound.occurredAt) result.inbound=structuredClone(update.evidence); }
  if(update.kind === "OPT_IN") { if(!result.optIn || update.evidence.occurredAt>result.optIn.occurredAt || update.evidence.occurredAt===result.optIn.occurredAt && (!update.evidence.granted || result.optIn.granted)) result.optIn=structuredClone(update.evidence); }
  if(update.kind === "TEMPLATE") {
    const old=result.templates.find(e=>e.name===update.evidence.name && e.language===update.evidence.language && e.accountId===update.evidence.accountId);
    if(!old || update.evidence.occurredAt>old.occurredAt || update.evidence.occurredAt===old.occurredAt && (update.evidence.status!=="APPROVED" || old.status==="APPROVED")) result.templates=[...result.templates.filter(e=>e!==old),structuredClone(update.evidence)].slice(-100);
  }
  return result;
}
function expiration(state:MessagingState,now:number):number {
  return Math.min(now+RETENTION,Math.max(now,...[state.inbound?.occurredAt===undefined?0:state.inbound.occurredAt+WINDOW,state.optIn?.expiresAt??0,...state.templates.map(e=>e.expiresAt)]));
}
function stateOnly(value:Record<string,unknown>):MessagingState {
  return structuredClone({...(value.inbound?{inbound:value.inbound as TrustedInboundEvidence}:{}),...(value.optIn?{optIn:value.optIn as TrustedOptInEvidence}:{}),templates:Array.isArray(value.templates)?value.templates as TrustedTemplateEvidence[]:[]});
}
function checkCommit(scope:MessagingScope,eventHash:string,audit:MessagingAudit):void {
  if(!scope.tenantId || !scope.clientId || !scope.appId || !scope.assetId || !/^[a-f0-9]{64}$/.test(scope.recipientHmac) || !/^[a-f0-9]{64}$/.test(eventHash) || audit.scopeHash!==scopeHash(scope) || audit.eventHash!==eventHash || !Number.isFinite(audit.timestamp)) throw new PlatformDenied("MESSAGING_EVIDENCE_SCOPE_INVALID");
}
export class InMemoryMessagingPolicyStore implements MessagingPolicyStore {
  private readonly states=new Map<string,{state:MessagingState;expireTime:number}>(); private readonly events=new Map<string,number>();
  readonly audit:Array<MessagingAudit & {expireTime:Date}>=[];
  constructor(private readonly clock:()=>number=Date.now){}
  private purge():void {const now=this.clock();for(const [id,value]of this.states)if(value.expireTime<=now)this.states.delete(id);for(const [id,expiry]of this.events)if(expiry<=now)this.events.delete(id);for(let i=this.audit.length-1;i>=0;i--)if(this.audit[i].expireTime.getTime()<=now)this.audit.splice(i,1);}
  async get(scope:MessagingScope):Promise<MessagingState|null> { this.purge();const record=this.states.get(scopeHash(scope));return record?structuredClone(record.state):null; }
  async commit(scope:MessagingScope,eventHash:string,update:Update,audit:MessagingAudit):Promise<"RECORDED"|"DUPLICATE"> {
    checkCommit(scope,eventHash,audit);this.purge();const key=scopeHash(scope),eventKey=`${key}:${eventHash}`;
    if(this.events.has(eventKey))return "DUPLICATE";
    const previous=this.states.get(key),next=merge(previous && previous.expireTime>audit.timestamp?previous.state:null,update),record={...structuredClone(audit),expireTime:new Date(audit.timestamp+RETENTION)};
    this.events.set(eventKey,audit.timestamp+RETENTION);this.states.set(key,{state:next,expireTime:expiration(next,audit.timestamp)});this.audit.push(record);return "RECORDED";
  }
}
export class FirestoreMessagingPolicyStore implements MessagingPolicyStore {
  constructor(private readonly db:Firestore){}
  async get(scope:MessagingScope):Promise<MessagingState|null>{const snap=await this.db.collection("platform_messaging_state").doc(scopeHash(scope)).get();if(!snap.exists)return null;const value=snap.data()!;const expiry=value.expireTime?.toDate?.() ?? value.expireTime;return expiry instanceof Date && expiry.getTime()>Date.now()?stateOnly(value):null;}
  async commit(scope:MessagingScope,eventHash:string,update:Update,audit:MessagingAudit):Promise<"RECORDED"|"DUPLICATE"> {
    checkCommit(scope,eventHash,audit);const key=scopeHash(scope),id=createHash("sha256").update(`${key}:${eventHash}`).digest("hex");
    return this.db.runTransaction(async tx=>{
      const stateRef=this.db.collection("platform_messaging_state").doc(key),eventRef=this.db.collection("platform_messaging_events").doc(id),auditRef=this.db.collection("platform_messaging_audit").doc(id);
      const [event,state,existingAudit]=await Promise.all([tx.get(eventRef),tx.get(stateRef),tx.get(auditRef)]);
      if(event.exists){if(!existingAudit.exists)throw new PlatformDenied("MESSAGING_AUDIT_INTEGRITY_REQUIRED");return "DUPLICATE";}
      if(existingAudit.exists)throw new PlatformDenied("MESSAGING_AUDIT_INTEGRITY_REQUIRED");
      const prior=state.exists?state.data()!:null,priorExpiry=prior?.expireTime?.toDate?.() ?? prior?.expireTime;
      const next=merge(prior && priorExpiry instanceof Date && priorExpiry.getTime()>audit.timestamp?stateOnly(prior):null,update),expireTime=new Date(audit.timestamp+RETENTION);
      tx.create(eventRef,{scopeHash:key,eventHash,kind:update.kind,expireTime});tx.set(stateRef,{...next,expireTime:new Date(expiration(next,audit.timestamp))});tx.create(auditRef,{...audit,expireTime});return "RECORDED";
    });
  }
}
export interface MessagingExecution {context:OperationContext;plan:OperationPlan;snapshot:AuthorizationSnapshot}
export interface MessagingRequest {assetId:string;recipient:string;mode:"text"|"template";template?:{name:string;language:string}}
/** Trusted ingestion only. Never register these evidence setters as model-callable tools. */
export class MessagingPolicyService {
  constructor(private readonly store:MessagingPolicyStore,private readonly recipientKey:Buffer,private readonly clock:()=>number=Date.now){
    if(recipientKey.length!==32)throw new PlatformDenied("MESSAGING_RECIPIENT_HMAC_KEY_REQUIRED");
    this.recipientKey=Buffer.from(recipientKey);
  }
  scope(binding:Omit<MessagingScope,"recipientHmac">,recipient:string):MessagingScope {
    if(!recipient || recipient.length>200 || !/^[A-Za-z0-9_+:-]+$/.test(recipient))throw new PlatformDenied("MESSAGING_RECIPIENT_INVALID");
    const scope={...binding,recipientHmac:createHmac("sha256",this.recipientKey).update(JSON.stringify([binding.tenantId,binding.clientId,binding.provider,binding.appId,binding.assetId,recipient])).digest("hex")};
    checkCommit(scope,"0".repeat(64),{scopeHash:scopeHash(scope),eventHash:"0".repeat(64),kind:"INBOUND",timestamp:this.clock()});return scope;
  }
  private validate(e:{eventId:string;occurredAt:number;receivedAt:number;verified:true}, maximumAge:number):number {
    const now=this.clock();if(e.verified!==true || !/^[a-f0-9]{64}$/.test(e.eventId) || !Number.isFinite(e.occurredAt) || !Number.isFinite(e.receivedAt) || e.occurredAt<=0 || e.occurredAt>e.receivedAt || e.receivedAt>now || now-e.receivedAt>maximumAge || now-e.occurredAt>=maximumAge)throw new PlatformDenied("MESSAGING_TRUSTED_EVIDENCE_REQUIRED");return now;
  }
  private async record(scope:MessagingScope,update:Update,now:number):Promise<"RECORDED"|"DUPLICATE"> {
    // Event ID is already a verified source hash. Do not retain payloads, contact details or raw recipient identifiers.
    const eventHash=createHash("sha256").update(`${update.kind}:${update.evidence.eventId}`).digest("hex");
    return this.store.commit(scope,eventHash,update,{scopeHash:scopeHash(scope),eventHash,kind:update.kind,timestamp:now});
  }
  async recordTrustedInbound(scope:MessagingScope,evidence:TrustedInboundEvidence):Promise<"RECORDED"|"DUPLICATE"> {
    const now=this.validate(evidence,WINDOW);if(evidence.source!=="meta_signed_webhook")throw new PlatformDenied("MESSAGING_TRUSTED_SOURCE_REQUIRED");
    return this.record(scope,{kind:"INBOUND",evidence:{eventId:evidence.eventId,occurredAt:evidence.occurredAt,receivedAt:evidence.receivedAt,verified:true,source:"meta_signed_webhook"}},now);
  }
  async recordTrustedOptIn(scope:MessagingScope,evidence:TrustedOptInEvidence):Promise<"RECORDED"|"DUPLICATE"> {
    const now=this.validate(evidence,WINDOW);if(evidence.source!=="verified_client_consent" || typeof evidence.granted!=="boolean" || !["service","utility"].includes(evidence.purpose) || !Number.isFinite(evidence.expiresAt) || evidence.expiresAt<=now || evidence.expiresAt>now+RETENTION)throw new PlatformDenied("MESSAGING_OPT_IN_REQUIRED");
    return this.record(scope,{kind:"OPT_IN",evidence:{eventId:evidence.eventId,occurredAt:evidence.occurredAt,receivedAt:evidence.receivedAt,expiresAt:evidence.expiresAt,purpose:evidence.purpose,granted:evidence.granted,verified:true,source:"verified_client_consent"}},now);
  }
  async recordTrustedTemplate(scope:MessagingScope,evidence:TrustedTemplateEvidence):Promise<"RECORDED"|"DUPLICATE"> {
    const now=this.validate(evidence,5*60_000);if(scope.provider!=="META_WHATSAPP" || evidence.source!=="meta_authenticated_template_refresh" || evidence.category!=="UTILITY" || !/^[a-z0-9_]{1,512}$/.test(evidence.name) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(evidence.language) || !/^[0-9]+$/.test(evidence.accountId) || !["APPROVED","PENDING","REJECTED","PAUSED","DISABLED"].includes(evidence.status) || !Number.isFinite(evidence.expiresAt) || evidence.expiresAt<=now || evidence.expiresAt>now+RETENTION)throw new PlatformDenied("MESSAGING_TEMPLATE_EVIDENCE_REQUIRED");
    return this.record(scope,{kind:"TEMPLATE",evidence:{eventId:evidence.eventId,occurredAt:evidence.occurredAt,receivedAt:evidence.receivedAt,expiresAt:evidence.expiresAt,name:evidence.name,language:evidence.language,accountId:evidence.accountId,status:evidence.status,category:"UTILITY",verified:true,source:"meta_authenticated_template_refresh"}},now);
  }
  async verifyExecution(execution:MessagingExecution,input:MessagingRequest):Promise<{messagingAccountId?:string}> {
    const {context,snapshot,plan}=execution,now=this.clock(),connection=snapshot.connection;
    if(!plan.classes.includes("WRITE_MESSAGING") || context.provider!==connection.provider || snapshot.tenant.id!==context.principal.tenantId || snapshot.client.id!==context.clientId || !["META_MESSENGER","META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN","META_WHATSAPP"].includes(context.provider))throw new PlatformDenied("MESSAGING_EXECUTION_SCOPE_REQUIRED");
    if(connection.tenantId!==context.principal.tenantId || connection.operatorId!==context.principal.operatorId || connection.revokedAt!==null || !Number.isFinite(connection.verifiedAt) || connection.verifiedAt<=0 || connection.verifiedAt>now || now-connection.verifiedAt>=5*60_000 || connection.expiresAt!==null && (!Number.isFinite(connection.expiresAt) || connection.expiresAt<=now))throw new PlatformDenied("MESSAGING_CONNECTION_REQUIRED");
    const candidates=snapshot.assets.filter(a=>a.id===input.assetId && a.provider===context.provider && a.appId===connection.appId && a.tenantId===context.principal.tenantId && a.clientId===context.clientId && a.revokedAt===null && a.verifiedAt>0 && a.verifiedAt<=now && now-a.verifiedAt<5*60_000);
    if(candidates.length!==1)throw new PlatformDenied("MESSAGING_ASSET_REQUIRED");
    const asset=candidates[0];let messagingAccountId:string|undefined;
    if(!plan.assets.some(a=>a.type===asset.type && a.id===asset.id) || (context.provider==="META_INSTAGRAM_LOGIN" ? asset.type!=="INSTAGRAM_ACCOUNT" : context.provider!=="META_WHATSAPP" && asset.type!=="PAGE"))throw new PlatformDenied("MESSAGING_ASSET_REQUIRED");
    const granted=(key:string)=>connection.assetKeys.includes(key) && snapshot.grants.some(g=>g.assetKey===key && g.connectionId===connection.id && g.tenantId===context.principal.tenantId && g.clientId===context.clientId && g.revokedAt===null && g.capabilities.includes(plan.capability) && g.actions.includes("WRITE_MESSAGING") && Number.isFinite(g.verifiedAt) && g.verifiedAt>0 && g.verifiedAt<=now && now-g.verifiedAt<5*60_000 && Number.isFinite(g.expiresAt) && g.expiresAt>now);
    if(!granted(asset.key))throw new PlatformDenied("MESSAGING_ASSET_GRANT_REQUIRED");
    if(context.provider==="META_WHATSAPP") {
      if(asset.type!=="WHATSAPP_PHONE" || !/^\+[1-9][0-9]{7,14}$/.test(input.recipient))throw new PlatformDenied("MESSAGING_RECIPIENT_INVALID");
      const messaging=asset.parents.filter(p=>p.type==="MESSAGING_ACCOUNT"),waac=asset.parents.filter(p=>p.type==="WHATSAPP_ACCOUNT");
      if(messaging.length!==1 || waac.length!==1)throw new PlatformDenied("MESSAGING_BILLING_ACCOUNT_AMBIGUOUS");
      const parent=snapshot.assets.find(a=>a.type==="MESSAGING_ACCOUNT" && a.id===messaging[0].id && a.parents.some(p=>p.type==="WHATSAPP_ACCOUNT" && p.id===waac[0].id));
      const account=snapshot.assets.find(a=>a.type==="WHATSAPP_ACCOUNT" && a.id===waac[0].id);
      if(!parent || !account || [parent,account].some(a=>a.provider!==context.provider || a.appId!==connection.appId || a.tenantId!==context.principal.tenantId || a.clientId!==context.clientId || a.revokedAt!==null || !Number.isFinite(a.verifiedAt) || a.verifiedAt<=0 || now-a.verifiedAt>=5*60_000 || a.verifiedAt>now || !granted(a.key)))throw new PlatformDenied("MESSAGING_BILLING_ACCOUNT_REQUIRED");
      messagingAccountId=parent.id;
    } else if(input.mode!=="text" || input.template)throw new PlatformDenied("MESSAGING_RESPONSE_ONLY");
    const scope=this.scope({tenantId:context.principal.tenantId,clientId:context.clientId,provider:context.provider,appId:connection.appId,assetId:asset.id},input.recipient),state=await this.store.get(scope);
    if(!state)throw new PlatformDenied("MESSAGING_POLICY_EVIDENCE_REQUIRED");
    const evidenceTimeValid=(e:{eventId:string;occurredAt:number;receivedAt:number})=>/^[a-f0-9]{64}$/.test(e.eventId) && Number.isFinite(e.occurredAt) && e.occurredAt>0 && e.occurredAt<=now && Number.isFinite(e.receivedAt) && e.receivedAt>=e.occurredAt && e.receivedAt<=now;
    const inbound=state.inbound,open=!!inbound && inbound.verified===true && inbound.source==="meta_signed_webhook" && evidenceTimeValid(inbound) && now-inbound.occurredAt<WINDOW;
    if(context.provider==="META_WHATSAPP") {
      const opt=state.optIn;
      if(!opt || opt.granted!==true || opt.verified!==true || opt.source!=="verified_client_consent" || !Number.isFinite(opt.expiresAt) || opt.expiresAt<=now || !evidenceTimeValid(opt) || (input.mode==="template" ? opt.purpose!=="utility" : !["service","utility"].includes(opt.purpose)))throw new PlatformDenied("MESSAGING_OPT_IN_REQUIRED");
      if(input.mode==="template") {
        const template=input.template,approved=state.templates.filter(e=>template && e.name===template.name && e.language===template.language && e.accountId===messagingAccountId && e.verified===true && e.source==="meta_authenticated_template_refresh" && e.category==="UTILITY" && e.status==="APPROVED" && Number.isFinite(e.expiresAt) && e.expiresAt>now && evidenceTimeValid(e) && now-e.occurredAt<5*60_000);
        if(approved.length!==1)throw new PlatformDenied("MESSAGING_APPROVED_TEMPLATE_REQUIRED");
        return {messagingAccountId};
      }
    }
    if(input.mode!=="text" || input.template || !open)throw new PlatformDenied("MESSAGING_WINDOW_REQUIRED");
    return messagingAccountId?{messagingAccountId}:{};
  }
}
