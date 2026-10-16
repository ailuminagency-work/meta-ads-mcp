import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import type { Approval, ApprovalRequest, ControlAudit, AssetGrant, AuditRecord, Client, Connection, Credential, Member, MetaAsset, Operation, Tenant, PlatformPrincipal } from "./models.js";
import { PlatformDenied } from "./models.js";
import { canonicalJson } from "./policy.js";
import { assetKey } from "./assets.js";

export interface Records { tenants: Tenant; members: Member; clients: Client; assets: MetaAsset; grants: AssetGrant; connections: Connection; credentials: Credential; approvals: Approval; operations: Operation; audit: AuditRecord; operatorIndex: PlatformPrincipal; approvalRequests:ApprovalRequest; controlAudit:ControlAudit }
export type Collection = keyof Records;
export interface Preparation { operation: Operation; audit: AuditRecord; approvalId?: string; expectedRevisionHash: string; now: number; expectedRecords: { collection: Collection; id: string; canonical: string }[] }
export interface CreatedCompletion { asset: MetaAsset; grant: AssetGrant; connectionBefore: Connection; connectionAfter: Connection; expectedRecords: Preparation["expectedRecords"]; authorizationExpiresAt: number }
export interface Completion { tenantId: string; operationId: string; result: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "PARTIAL"; audit: AuditRecord; created?: CreatedCompletion }
export interface ControlCommit {tenantId:string;expected:Array<{collection:Collection;id:string;canonical:string}>;writes:Array<{collection:"credentials"|"connections"|"grants"|"approvals"|"approvalRequests";id:string;value:unknown;createOnly:boolean}>;audit:ControlAudit}
export interface PlatformRepository {
  commitControlPlane(input:ControlCommit):Promise<void>;
  resolvePrincipal(operatorId: string): Promise<PlatformPrincipal | null>;
  get<K extends Collection>(collection: K, tenantId: string, id: string): Promise<Records[K] | null>;
  list<K extends Collection>(collection: K, tenantId: string): Promise<Records[K][]>;
  put<K extends Collection>(collection: K, tenantId: string, id: string, value: Records[K]): Promise<void>;
  prepareOperation(input: Preparation): Promise<void>;
  finishOperation(input: Completion): Promise<void>;
}
function checkControlCommit(input:ControlCommit):void {
  if(!input.tenantId || input.audit.tenantId!==input.tenantId || !input.audit.id || input.writes.length<1 || input.writes.length>100 || input.expected.length<3 || input.expected.length>300)throw new PlatformDenied("INVALID_CONTROL_COMMIT");
  const keys=new Set<string>();
  for(const write of input.writes){if(!["credentials","connections","grants","approvals","approvalRequests"].includes(write.collection)||!write.id||!write.value||typeof write.value!=="object"||(write.value as {tenantId?:string}).tenantId!==input.tenantId||keys.has(write.collection+":"+write.id))throw new PlatformDenied("INVALID_CONTROL_WRITE");keys.add(write.collection+":"+write.id);}
  if(input.audit.event === "CONNECTION_ENROLLED"){const connection=input.writes.find(w=>w.collection === "connections")?.value as Connection | undefined;if(!connection || connection.expiresAt===null || !Number.isFinite(connection.expiresAt) || connection.expiresAt<=Date.now())throw new PlatformDenied("OAUTH_TOKEN_EXPIRED_AT_COMMIT");}
  if(input.audit.event === "APPROVAL_ISSUED"){const request=input.writes.find(w=>w.collection === "approvalRequests")?.value as ApprovalRequest | undefined;if(!request || !Number.isFinite(request.expiresAt) || request.expiresAt<=Date.now())throw new PlatformDenied("APPROVAL_REQUEST_EXPIRED_AT_COMMIT");}
  canonicalJson(input);
}
function persistedControlValue(write:ControlCommit["writes"][number]):Record<string,unknown>{const value=write.value as Record<string,unknown>;return write.collection==="approvalRequests"?{...value,expireTime:new Date((value as unknown as ApprovalRequest).expiresAt)}:value;}
function recordValue<K extends Collection>(collection:K,value:Record<string,unknown>):Records[K]{if(collection==="approvalRequests"){const {expireTime:ignored,...record}=value;void ignored;return record as unknown as Records[K];}return value as unknown as Records[K];}
function key(collection: Collection, tenantId: string, id: string): string { return createHash("sha256").update(JSON.stringify([collection, tenantId, id])).digest("hex"); }
function checkApproval(approval: Approval | null, input: Preparation): void {
  const op = input.operation;
  if (!approval || approval.tenantId !== op.tenantId || approval.clientId !== op.clientId || approval.actorId !== op.actorId || !approval.approverId || approval.planHash !== op.planHash || approval.revisionHash !== input.expectedRevisionHash || approval.expiresAt <= Math.max(input.now,Date.now()) || approval.consumedAt !== null) throw new PlatformDenied("APPROVAL_INVALID_OR_REPLAYED");
}
function checkPreparation(input: Preparation): void {
  const op = input.operation;
  const audit = input.audit;
  if(op.state !== "PREPARED" || audit.event !== "PREPARED" || op.id !== audit.operationId || op.tenantId !== audit.tenantId || op.clientId !== audit.clientId || op.actorId !== audit.actorId || op.tool !== audit.tool || op.planHash !== audit.planHash || op.approvalId !== audit.approvalId || op.approvalId !== (input.approvalId ?? null)) throw new PlatformDenied("AUDIT_PREPARATION_MISMATCH");
}
function checkApprover(member: Member | null, approval: Approval, input: Preparation): void {
  if(!member || member.operatorId !== approval.approverId || member.tenantId !== input.operation.tenantId || member.disabledAt !== null || member.revision !== approval.approverRevision || !member.allowedClientIds.includes(input.operation.clientId) || !member.roles.some(role => role === "admin" || role === "approver")) throw new PlatformDenied("APPROVER_MEMBERSHIP_REQUIRED");
}
function checkCompletion(operation: Operation | null, existingAudit: AuditRecord | null, input: Completion): "COMMIT" | "IDEMPOTENT" {
  const a = input.audit;
  if((input.created && a.createdAssetKey !== input.created.asset.key) || (!input.created && a.createdAssetKey))throw new PlatformDenied("AUDIT_COMPLETION_MISMATCH");
  if(input.created && (input.result !== "SUCCEEDED" || input.created.asset.createdFromOperationId !== input.operationId || input.created.asset.key !== assetKey(input.created.asset.provider,input.created.asset.appId,input.created.asset) || !a.afterSummary?.some(s=>s.field === "newresource_id" && s.value === input.created!.asset.id)))throw new PlatformDenied("AUDIT_COMPLETION_MISMATCH");
  if(!operation || operation.id !== input.operationId || operation.tenantId !== input.tenantId || a.id !== `${operation.id}:result` || a.operationId !== operation.id || a.tenantId !== operation.tenantId || a.clientId !== operation.clientId || a.actorId !== operation.actorId || a.tool !== operation.tool || a.planHash !== operation.planHash || a.approvalId !== operation.approvalId || a.event !== input.result) throw new PlatformDenied("AUDIT_COMPLETION_MISMATCH");
  if(["PREPARED","EXECUTING"].includes(operation.state)) { if(existingAudit) throw new PlatformDenied("AUDIT_COMPLETION_CONFLICT"); return "COMMIT"; }
  if(operation.state !== input.result || !existingAudit) throw new PlatformDenied("OPERATION_ALREADY_FINISHED");
  const {timestamp: ignoredExistingTime,...existing} = existingAudit;
  const {timestamp: ignoredInputTime,...requested} = a;
  void ignoredExistingTime; void ignoredInputTime;
  if(canonicalJson(existing) !== canonicalJson(requested)) throw new PlatformDenied("AUDIT_COMPLETION_CONFLICT");
  return "IDEMPOTENT";
}
function checkCreated(input: Completion, existingAssets: MetaAsset[], existingGrant: AssetGrant | null): void {
  const c = input.created; if(!c) return;
  const {asset:a,grant:g,connectionBefore:b,connectionAfter:n} = c;
  if(input.result !== "SUCCEEDED" || !Number.isSafeInteger(c.authorizationExpiresAt) || c.authorizationExpiresAt <= Date.now() || a.createdFromOperationId !== input.operationId || !/^[0-9]{1,100}$/.test(a.id) || !["CAMPAIGN","AD_SET","AD"].includes(a.type) || a.tenantId !== input.tenantId || a.clientId !== input.audit.clientId || a.provider !== "META_MARKETING" || a.appId !== b.appId || a.revokedAt !== null || a.revision !== 1 || a.parents.length < 1 || existingAssets.some(asset=>asset.id === a.id) || existingGrant || g.tenantId !== a.tenantId || g.clientId !== a.clientId || g.assetKey !== a.key || g.connectionId !== b.id || g.revokedAt !== null || g.revision !== 1 || g.expiresAt <= Date.now() || b.tenantId !== a.tenantId || b.provider !== a.provider || b.revokedAt !== null || (b.expiresAt !== null && b.expiresAt <= Date.now()) || canonicalJson(n) !== canonicalJson({...b,assetKeys:[...b.assetKeys,a.key],revision:b.revision+1}) || !input.audit.afterSummary?.some(s=>s.field === "newresource_id" && s.value === a.id)) throw new PlatformDenied("CREATED_ASSET_REGISTRATION_REJECTED");
  const parent = existingAssets.find(p=>p.id === a.parents[0].id && p.type === a.parents[0].type);
  if(!parent || parent.clientId !== a.clientId || parent.provider !== a.provider || parent.appId !== a.appId || parent.revokedAt !== null || !b.assetKeys.includes(parent.key) || ({CAMPAIGN:"AD_ACCOUNT",AD_SET:"CAMPAIGN",AD:"AD_SET"} as Record<string,string>)[a.type] !== parent.type || !c.expectedRecords.some(e=>e.collection === "assets" && e.id === parent.key && e.canonical === canonicalJson(parent)) || !c.expectedRecords.some(e=>e.collection === "connections" && e.id === b.id && e.canonical === canonicalJson(b)) || !["tenants","members","clients","grants"].every(collection=>c.expectedRecords.some(e=>e.collection===collection))) throw new PlatformDenied("CREATED_ASSET_REGISTRATION_REJECTED");
  const grants=c.expectedRecords.filter(e=>e.collection === "grants").map(e=>JSON.parse(e.canonical) as AssetGrant).filter(g=>g.assetKey===parent.key && g.connectionId===b.id && g.clientId===a.clientId && g.tenantId===a.tenantId && g.revokedAt===null);
  if(a.key!==assetKey(a.provider,a.appId,a) || existingAssets.some(asset=>asset.key===a.key) || !grants.length || grants.some(p=>g.capabilities.some(v=>!p.capabilities.includes(v)) || g.actions.some(v=>!p.actions.includes(v)) || g.tasks.some(v=>!p.tasks.includes(v)) || g.expiresAt>p.expiresAt || g.verifiedAt>p.verifiedAt) || a.parents.some(ref=>!existingAssets.some(p=>p.type===ref.type && p.id===ref.id && p.clientId===a.clientId && p.provider===a.provider && p.appId===a.appId && p.revokedAt===null && c.expectedRecords.some(e=>e.collection==="assets" && e.id===p.key && e.canonical===canonicalJson(p)))))throw new PlatformDenied("CREATED_ASSET_REGISTRATION_REJECTED");
}
export class InMemoryPlatformRepository implements PlatformRepository {
  async commitControlPlane(input:ControlCommit):Promise<void> {
    checkControlCommit(input);
    for(const expected of input.expected) if(canonicalJson(this.records.get(key(expected.collection,input.tenantId,expected.id)) ?? null)!==expected.canonical) throw new PlatformDenied("CONTROL_AUTHORIZATION_CHANGED");
    if(this.records.has(key("controlAudit",input.tenantId,input.audit.id)))throw new PlatformDenied("CONTROL_AUDIT_ALREADY_EXISTS");
    for(const write of input.writes) if(write.createOnly && this.records.has(key(write.collection,input.tenantId,write.id)))throw new PlatformDenied("CONTROL_RECORD_ALREADY_EXISTS");
    const writes=structuredClone(input.writes),audit=structuredClone(input.audit);
    for(const write of writes)this.store(write.collection,input.tenantId,write.id,write.value);
    this.store("controlAudit",input.tenantId,audit.id,audit);
  }
  private readonly records = new Map<string, unknown>();
  private store(collection: Collection, tenantId: string, id: string, value: unknown): void {
    const storageKey = key(collection, tenantId, id);
    this.records.set(storageKey, value); this.records.set(`${collection}:${tenantId}:${storageKey}`, value);
  }
  async resolvePrincipal(operatorId: string): Promise<PlatformPrincipal | null> {
    const principal = await this.get("operatorIndex", "_index", operatorId);
    if(!principal || principal.operatorId !== operatorId) return null;
    const member = await this.get("members", principal.tenantId, operatorId);
    return member && member.operatorId === operatorId && member.tenantId === principal.tenantId && member.disabledAt === null ? principal : null;
  }
  async get<K extends Collection>(collection: K, tenantId: string, id: string): Promise<Records[K] | null> { const value = this.records.get(key(collection, tenantId, id)); return value ? structuredClone(value) as Records[K] : null; }
  async list<K extends Collection>(collection: K, tenantId: string): Promise<Records[K][]> { const prefix = `${collection}:${tenantId}:`; return [...this.records.entries()].filter(([k]) => k.startsWith(prefix)).map(([,v]) => structuredClone(v) as Records[K]); }
  async put<K extends Collection>(collection: K, tenantId: string, id: string, value: Records[K]): Promise<void> {
    const storageKey = key(collection, tenantId, id);
    if (["audit","controlAudit"].includes(collection) && this.records.has(storageKey)) throw new PlatformDenied("AUDIT_APPEND_ONLY");
    this.store(collection, tenantId, id, structuredClone(value));
  }
  async prepareOperation(input: Preparation): Promise<void> {
    checkPreparation(input);
    // No await between checks and commit: this is atomic within the fake's process.
    const op = input.operation;
    const opKey = key("operations", op.tenantId, op.id);
    if (this.records.has(opKey)) throw new PlatformDenied("OPERATION_ALREADY_EXISTS");
    for(const expected of input.expectedRecords) if(canonicalJson(this.records.get(key(expected.collection,op.tenantId,expected.id)) ?? null) !== expected.canonical) throw new PlatformDenied("AUTHORIZATION_CHANGED");
    let approval: Approval | null = null;
    if (input.approvalId) { approval = this.records.get(key("approvals", op.tenantId, input.approvalId)) as Approval ?? null; checkApproval(approval, input); checkApprover(this.records.get(key("members",op.tenantId,approval!.approverId)) as Member ?? null,approval!,input); }
    if (this.records.has(key("audit", op.tenantId, input.audit.id))) throw new PlatformDenied("AUDIT_ALREADY_EXISTS");
    const nextOperation = structuredClone(op);
    const nextAudit = structuredClone(input.audit);
    const nextApproval = approval ? structuredClone({ ...approval, consumedAt: input.now, operationId: op.id }) : null;
    if (nextApproval) this.store("approvals", op.tenantId, nextApproval.id, nextApproval);
    this.store("operations", op.tenantId, op.id, nextOperation);
    this.store("audit", op.tenantId, nextAudit.id, nextAudit);
  }
  async finishOperation(input: Completion): Promise<void> {
    const operation = this.records.get(key("operations",input.tenantId,input.operationId)) as Operation ?? null;
    const existing = this.records.get(key("audit",input.tenantId,input.audit.id)) as AuditRecord ?? null;
    if(checkCompletion(operation,existing,input) === "IDEMPOTENT") return;
    if(input.created) {
      for(const expected of input.created.expectedRecords) if(canonicalJson(this.records.get(key(expected.collection,input.tenantId,expected.id)) ?? null)!==expected.canonical)throw new PlatformDenied("CREATED_ASSET_AUTHORIZATION_CHANGED");
      const assets = [...this.records.entries()].filter(([k])=>k.startsWith(`assets:${input.tenantId}:`)).map(([,v])=>v as MetaAsset);
      checkCreated(input,assets,this.records.get(key("grants",input.tenantId,input.created.grant.id)) as AssetGrant ?? null);
    }
    const nextOperation = structuredClone({...operation!,state:input.result,updatedAt:input.audit.timestamp});
    const audit = structuredClone(input.audit);
    if(input.created){const c=structuredClone(input.created);this.store("assets",input.tenantId,c.asset.key,c.asset);this.store("grants",input.tenantId,c.grant.id,c.grant);this.store("connections",input.tenantId,c.connectionAfter.id,c.connectionAfter);}
    this.store("audit",input.tenantId,audit.id,audit);
    this.store("operations",input.tenantId,input.operationId,nextOperation);
  }
}
export class FirestorePlatformRepository implements PlatformRepository {
  constructor(private readonly db: Firestore) {}
  async commitControlPlane(input:ControlCommit):Promise<void> {
    checkControlCommit(input);
    await this.db.runTransaction(async tx=>{
      checkControlCommit(input);
      const auditRef=this.collection("controlAudit",input.tenantId).doc(key("controlAudit",input.tenantId,input.audit.id));
      const audit=await tx.get(auditRef);
      const expected=await Promise.all(input.expected.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id)))));
      const writes=await Promise.all(input.writes.map(w=>tx.get(this.collection(w.collection,input.tenantId).doc(key(w.collection,input.tenantId,w.id)))));
      if(audit.exists)throw new PlatformDenied("CONTROL_AUDIT_ALREADY_EXISTS");
      for(let i=0;i<expected.length;i++)if(canonicalJson(expected[i].exists?recordValue(input.expected[i].collection,expected[i].data()!):null)!==input.expected[i].canonical)throw new PlatformDenied("CONTROL_AUTHORIZATION_CHANGED");
      for(let i=0;i<writes.length;i++)if(writes[i].exists && input.writes[i].createOnly)throw new PlatformDenied("CONTROL_RECORD_ALREADY_EXISTS");
      checkControlCommit(input);
      for(const write of input.writes){const ref=this.collection(write.collection,input.tenantId).doc(key(write.collection,input.tenantId,write.id));if(write.createOnly)tx.create(ref,persistedControlValue(write));else tx.set(ref,persistedControlValue(write));}
      tx.create(auditRef,input.audit);
    });
  }

  async resolvePrincipal(operatorId: string): Promise<PlatformPrincipal | null> {
    const snap = await this.db.collection("platform_operator_index").doc(key("operatorIndex", "_index", operatorId)).get();
    const principal = snap.exists ? snap.data() as PlatformPrincipal : null;
    if(!principal || principal.operatorId !== operatorId) return null;
    const member = await this.get("members", principal.tenantId, operatorId);
    return member && member.operatorId === operatorId && member.tenantId === principal.tenantId && member.disabledAt === null ? principal : null;
  }
  private collection(collection: Collection, tenantId: string) { return this.db.collection("platform_v1").doc(key("tenants", tenantId, tenantId)).collection(collection); }
  async get<K extends Collection>(collection: K, tenantId: string, id: string): Promise<Records[K] | null> { const snap = await this.collection(collection, tenantId).doc(key(collection, tenantId, id)).get(); return snap.exists ? recordValue(collection,snap.data()!) : null; }
  async list<K extends Collection>(collection: K, tenantId: string): Promise<Records[K][]> { const snap = await this.collection(collection, tenantId).limit(1001).get(); if(snap.size > 1000) throw new PlatformDenied("REGISTRY_LIMIT_REQUIRES_PAGINATION"); return snap.docs.map(d => recordValue(collection,d.data())); }
  async put<K extends Collection>(collection: K, tenantId: string, id: string, value: Records[K]): Promise<void> { const ref = collection === "operatorIndex" ? this.db.collection("platform_operator_index").doc(key(collection,"_index",id)) : this.collection(collection, tenantId).doc(key(collection, tenantId, id)); if(["audit","controlAudit"].includes(collection)) await ref.create(value); else await ref.set(collection === "approvalRequests" ? {...value,expireTime:new Date((value as ApprovalRequest).expiresAt)} : value); }
  async prepareOperation(input: Preparation): Promise<void> {
    checkPreparation(input);
    const op = input.operation;
    const opRef = this.collection("operations", op.tenantId).doc(key("operations", op.tenantId, op.id));
    const auditRef = this.collection("audit", op.tenantId).doc(key("audit", op.tenantId, input.audit.id));
    const approvalRef = input.approvalId ? this.collection("approvals", op.tenantId).doc(key("approvals", op.tenantId, input.approvalId)) : null;
    await this.db.runTransaction(async tx => {
      const existing = await tx.get(opRef);
      const audit = await tx.get(auditRef);
      const approval = approvalRef ? await tx.get(approvalRef) : null;
      const approvalDoc = approval?.exists ? approval.data() as Approval : null;
      const approver = approvalDoc ? await tx.get(this.collection("members",op.tenantId).doc(key("members",op.tenantId,approvalDoc.approverId))) : null;
      const checks = await Promise.all(input.expectedRecords.map(expected => tx.get(this.collection(expected.collection,op.tenantId).doc(key(expected.collection,op.tenantId,expected.id)))));
      for(let i = 0; i < checks.length; i++) if(canonicalJson(checks[i].exists ? checks[i].data() : null) !== input.expectedRecords[i].canonical) throw new PlatformDenied("AUTHORIZATION_CHANGED");
      if(existing.exists || audit.exists) throw new PlatformDenied("OPERATION_ALREADY_EXISTS");
      if(approvalRef) { checkApproval(approvalDoc, input); checkApprover(approver?.exists ? approver.data() as Member : null,approvalDoc!,input); }
      if(approvalRef) tx.update(approvalRef, { consumedAt: input.now, operationId: op.id });
      tx.create(opRef, op); tx.create(auditRef, input.audit);
    });
  }
  async finishOperation(input: Completion): Promise<void> {
    const opRef = this.collection("operations",input.tenantId).doc(key("operations",input.tenantId,input.operationId));
    const auditRef = this.collection("audit",input.tenantId).doc(key("audit",input.tenantId,input.audit.id));
    await this.db.runTransaction(async tx => {
      const operation = await tx.get(opRef);
      const audit = await tx.get(auditRef);
      if(checkCompletion(operation.exists ? operation.data() as Operation : null,audit.exists ? audit.data() as AuditRecord : null,input) === "IDEMPOTENT") return;
      if(input.created){
        const c=input.created;
        const checks=await Promise.all(c.expectedRecords.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id)))));
        const assets=await tx.get(this.collection("assets",input.tenantId).limit(1001));
        const grant=await tx.get(this.collection("grants",input.tenantId).doc(key("grants",input.tenantId,c.grant.id)));
        for(let i=0;i<checks.length;i++)if(canonicalJson(checks[i].exists?recordValue(c.expectedRecords[i].collection,checks[i].data()!):null)!==c.expectedRecords[i].canonical)throw new PlatformDenied("CREATED_ASSET_AUTHORIZATION_CHANGED");
        if(assets.size>1000)throw new PlatformDenied("CREATED_ASSET_REGISTRATION_REJECTED");
        checkCreated(input,assets.docs.map(d=>d.data() as MetaAsset),grant.exists?grant.data() as AssetGrant:null);
        tx.create(this.collection("assets",input.tenantId).doc(key("assets",input.tenantId,c.asset.key)),c.asset);
        tx.create(this.collection("grants",input.tenantId).doc(key("grants",input.tenantId,c.grant.id)),c.grant);
        tx.set(this.collection("connections",input.tenantId).doc(key("connections",input.tenantId,c.connectionAfter.id)),c.connectionAfter);
      }
      tx.create(auditRef,input.audit);
      tx.update(opRef,{state:input.result,updatedAt:input.audit.timestamp});
    });
  }
}
