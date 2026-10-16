import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AssetRef, AssetGrant, MetaAsset, AuditRecord, AuthorizationSnapshot, Connection, Operation, OperationContext, OperationPlan, Provider } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { Collection, CreatedCompletion, PlatformRepository } from "./repository.js";
import { assetKey, resolveAuthorizedAssets } from "./assets.js";
import { decryptCredential, selectConnection } from "./connections.js";
import { canonicalJson, canonicalPlanHash, classifyPlan, evaluatePolicy, normalizeSafeDiff, revisionHash } from "./policy.js";

export interface ExecutionPermit { readonly operationId: string; readonly context: Readonly<OperationContext>; readonly assetKeys: readonly string[]; readonly connectionId: string; readonly planHash: string }
interface PermitState { repo: PlatformRepository; context: OperationContext; plan: OperationPlan; snapshot: AuthorizationSnapshot; connection: Connection; expiresAt: number; mutation: boolean; completed: boolean; mutationClaimed: boolean; terminalHash?: string; finishing?: Promise<void>; createdHash?:string; createdResult?:boolean }
const permits = new WeakMap<ExecutionPermit, PermitState>();
const execution = new AsyncLocalStorage<ExecutionPermit>();
export async function authorizeOperation(repo: PlatformRepository, context: OperationContext, inputPlan: OperationPlan, options: { writesEnabled: boolean; approvalId?: string; selectedConnectionId?: string; now?: number; operationId?: string }): Promise<ExecutionPermit> {
  const now = options.now ?? Date.now();
  const ctx = structuredClone(context);
  const plan = structuredClone(inputPlan);
  plan.classes = classifyPlan(plan);
  const tenant = await repo.get("tenants", ctx.principal.tenantId, ctx.principal.tenantId);
  const member = await repo.get("members", ctx.principal.tenantId, ctx.principal.operatorId);
  const client = await repo.get("clients", ctx.principal.tenantId, ctx.clientId);
  if(!tenant || !member || !client) throw new PlatformDenied("PLATFORM_MEMBERSHIP_REQUIRED");
  if(member.operatorId !== ctx.principal.operatorId || member.tenantId !== ctx.principal.tenantId || member.disabledAt !== null || !member.allowedClientIds.includes(ctx.clientId)) throw new PlatformDenied("CLIENT_MEMBERSHIP_REQUIRED");
  const maximumAge = plan.classes.some(c=>c!=="READ") ? 5 * 60_000 : 60 * 60_000;
  const assets = await resolveAuthorizedAssets(repo, ctx, plan.assets, now,maximumAge);
  const connection = await selectConnection(repo, ctx, plan, assets, now, options.selectedConnectionId);
  const grants = (await repo.list("grants", ctx.principal.tenantId)).filter(g => assets.some(a => a.key === g.assetKey) && g.clientId === ctx.clientId && g.connectionId === connection.id && g.revokedAt === null && g.expiresAt > now);
  const snapshot: AuthorizationSnapshot = {tenant,member,client,assets,connection,grants};
  const decision = evaluatePolicy(ctx, plan, snapshot, options);
  if(decision.decision === "DENY") throw new PlatformDenied(decision.reason);
  if(decision.decision === "REQUIRE_CONFIRMATION" && !options.approvalId) throw new PlatformDenied(decision.reason);
  const planHash = canonicalPlanHash(ctx, plan);
  const mutation = plan.classes.some(c => c !== "READ");
  const operationId = options.operationId ?? randomUUID();
  if(mutation) {
    const operation: Operation = {id: operationId, tenantId: ctx.principal.tenantId, clientId: ctx.clientId, actorId: ctx.principal.operatorId, tool: ctx.tool, planHash, state: "PREPARED", approvalId: options.approvalId ?? null, createdAt: now, updatedAt: now};
    const audit: AuditRecord = {id: `${operationId}:prepared`, tenantId: operation.tenantId, clientId: ctx.clientId, actorId: operation.actorId, tool: ctx.tool, operationId, event: "PREPARED", timestamp: now, assetKeys: assets.map(a => a.key), planHash, approvalId: operation.approvalId,requestedChange:normalizeSafeDiff(plan.parameters),beforeEvidence:"UNKNOWN"};
    await repo.prepareOperation({operation,audit,approvalId: options.approvalId,expectedRevisionHash: revisionHash(snapshot),now, expectedRecords: [
      {collection: "tenants", id: tenant.id, canonical: canonicalJson(tenant)},
      {collection: "members", id: member.operatorId, canonical: canonicalJson(member)},
      {collection: "clients", id: client.id, canonical: canonicalJson(client)},
      {collection: "connections", id: connection.id, canonical: canonicalJson(connection)},
      ...assets.map(a => ({collection: "assets" as const,id:a.key,canonical:canonicalJson(a)})),
      ...grants.map(g => ({collection: "grants" as const,id:g.id,canonical:canonicalJson(g)})),
    ]});
  }
  const publicContext = structuredClone(ctx);
  Object.freeze(publicContext.principal); Object.freeze(publicContext);
  const permit: ExecutionPermit = Object.freeze({operationId, context: publicContext, assetKeys: Object.freeze(assets.map(a => a.key)), connectionId: connection.id, planHash});
  permits.set(permit, {repo,context:ctx,plan,snapshot,connection,expiresAt: Math.min(now+60_000,connection.expiresAt ?? Infinity,connection.verifiedAt+maximumAge,...assets.map(a=>a.verifiedAt+maximumAge),...grants.flatMap(g=>[g.expiresAt,g.verifiedAt+maximumAge])),mutation,completed:false,mutationClaimed:false});
  return permit;
}
export function runWithExecutionPermit<T>(permit: ExecutionPermit, fn: () => T): T { validate(permit); return execution.run(permit,fn); }
function validate(permit: ExecutionPermit): PermitState { const state = permits.get(permit); if(!state || state.completed || state.expiresAt <= Date.now()) throw new PlatformDenied("EXECUTION_PERMIT_REQUIRED_OR_EXPIRED"); return state; }
export function currentExecutionPermit(): ExecutionPermit | undefined { return execution.getStore(); }
export function getExecutionScope(): {context: OperationContext; plan: OperationPlan; snapshot: AuthorizationSnapshot} {
  const permit = execution.getStore(); if(!permit) throw new PlatformDenied("EXECUTION_PERMIT_REQUIRED");
  const state = validate(permit);
  return structuredClone({context:state.context,plan:state.plan,snapshot:state.snapshot});
}
export async function revalidateExecutionPermit(permit: ExecutionPermit): Promise<void> {
  const state = validate(permit);
  const ctx = state.context;
  const snapshot = state.snapshot;
  const checks = [
    ["tenants", snapshot.tenant.id, snapshot.tenant], ["members", snapshot.member.operatorId, snapshot.member],
    ["clients", snapshot.client.id, snapshot.client], ["connections", snapshot.connection.id, snapshot.connection],
    ...snapshot.assets.map(a => ["assets",a.key,a]), ...snapshot.grants.map(g => ["grants",g.id,g]),
  ] as const;
  for(const [collection,id,expected] of checks) {
    const fresh = await state.repo.get(collection as Collection,ctx.principal.tenantId,id as string);
    if(canonicalJson(fresh) !== canonicalJson(expected)) throw new PlatformDenied("AUTHORIZATION_CHANGED");
  }
  if(state.mutation) {
    const record = await state.repo.get("operations",ctx.principal.tenantId,permit.operationId);
    if(!record || !["PREPARED","EXECUTING"].includes(record.state) || record.planHash !== permit.planHash) throw new PlatformDenied("DURABLE_AUDIT_REQUIRED");
  }
}
export function assertExecutionPermit(requirements: { provider: Provider; assetKeys?: readonly string[]; mutation?: boolean; tool?: string }): ExecutionPermit {
  const permit = execution.getStore(); if(!permit) throw new PlatformDenied("EXECUTION_PERMIT_REQUIRED");
  const state = validate(permit);
  if(state.context.provider !== requirements.provider || (requirements.tool && state.context.tool !== requirements.tool) || (requirements.mutation && !state.mutation) || (requirements.assetKeys ?? []).some(a => !permit.assetKeys.includes(a))) throw new PlatformDenied("EXECUTION_PERMIT_MISMATCH");
  return permit;
}
export function claimMutationStep(permit: ExecutionPermit): void {
  const state = validate(permit);
  if(!state.mutation || state.mutationClaimed || state.finishing || state.terminalHash) throw new PlatformDenied("MUTATION_STEP_ALREADY_CLAIMED_OR_NOT_AUTHORIZED");
  state.mutationClaimed = true;
}
export async function withConnectionCredential<T>(permit: ExecutionPermit, fn: (token: string) => Promise<T>): Promise<T> {
  await revalidateExecutionPermit(permit);
  const state = validate(permit);
  const c = state.connection;
  const fresh = await state.repo.get("connections", state.context.principal.tenantId,c.id);
  if(!fresh || canonicalJson(fresh) !== canonicalJson(c)) throw new PlatformDenied("CONNECTION_CHANGED");
  const credential = await state.repo.get("credentials",c.tenantId,c.credentialId);
  if(!credential || credential.tenantId !== c.tenantId || credential.operatorId !== c.operatorId || credential.provider !== c.provider || credential.appId !== c.appId || credential.id !== c.credentialId) throw new PlatformDenied("CREDENTIAL_BINDING_MISMATCH");
  return fn(decryptCredential(credential));
}
export async function finishOperation(permit: ExecutionPermit, result: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "PARTIAL", providerRequestId?: string, resultSummary: Record<string,unknown> = {}): Promise<void> {
  const state = permits.get(permit); if(!state) throw new PlatformDenied("EXECUTION_PERMIT_REQUIRED");
  const safeRequestId = providerRequestId && /^[A-Za-z0-9_-]{1,128}$/.test(providerRequestId) && !/^EAA[A-Za-z0-9]{20,}$/.test(providerRequestId) ? providerRequestId : undefined;
  const afterSummary = normalizeSafeDiff(resultSummary);
  const terminalHash = canonicalJson({result,providerRequestId:safeRequestId ?? null,afterSummary});
  if(state.terminalHash && state.terminalHash !== terminalHash) throw new PlatformDenied("OPERATION_ALREADY_FINISHED");
  if(state.completed) return;
  if(state.finishing) return state.finishing;
  if(!state.mutation) { state.completed = true; state.terminalHash = terminalHash; return; }
  const complete = async ():Promise<void> => {
  const operation = await state.repo.get("operations",state.context.principal.tenantId,permit.operationId);
  if(!operation) throw new PlatformDenied("AUDIT_OPERATION_MISSING");
  const now = Date.now();
  const audit:AuditRecord = {id:`${operation.id}:result`,tenantId:operation.tenantId,clientId:operation.clientId,actorId:operation.actorId,tool:operation.tool,operationId:operation.id,event:result,timestamp:now,assetKeys:[...permit.assetKeys],planHash:operation.planHash,approvalId:operation.approvalId,beforeEvidence:"UNKNOWN",afterSummary,...(safeRequestId ? {providerRequestId:safeRequestId}: {})};
  await state.repo.finishOperation({tenantId:operation.tenantId,operationId:operation.id,result,audit});
  state.completed = true; state.terminalHash = terminalHash;
  };
  state.terminalHash = terminalHash;
  state.finishing = complete();
  try { await state.finishing; } finally { state.finishing = undefined; }
}

/** Records a known provider creation and its inherited registry authority in one
 * transaction. An uncertain commit must be reconciled; it never permits egress. */
export async function finishCreatedAsset(permit:ExecutionPermit,input:{id:string;type:"CAMPAIGN"|"AD_SET"|"AD";parent:AssetRef}):Promise<boolean>{
  const state=permits.get(permit);
  if(!state || !state.mutation || !state.mutationClaimed)throw new PlatformDenied("CLAIMED_CREATION_PERMIT_REQUIRED");
  input=structuredClone(input);
  const inputHash=canonicalJson(input);
  if((state.createdHash && state.createdHash!==inputHash) || (!state.createdHash && state.terminalHash))throw new PlatformDenied("OPERATION_ALREADY_FINISHED");
  if(state.completed)return state.createdResult===true;
  if(state.finishing){await state.finishing;return state.createdResult===true;}
  state.createdHash=inputHash;state.terminalHash=canonicalJson({created:inputHash});
  const finish=async():Promise<void>=>{
    const {snapshot,context:ctx,plan}=state;
    const now=Date.now();
    const operation=await state.repo.get("operations",ctx.principal.tenantId,permit.operationId);
    if(!operation)throw new PlatformDenied("AUDIT_OPERATION_MISSING");
    let created:CreatedCompletion|undefined;
    const parent=snapshot.assets.find(a=>a.type===input.parent.type && a.id.replace(/^act_/,"")===input.parent.id.replace(/^act_/,""));
    const parentGrants=parent?snapshot.grants.filter(g=>g.assetKey===parent.key && g.connectionId===state.connection.id):[];
    const valid=state.plan.createOrCopy && state.plan.parameters.status==="PAUSED" && state.plan.classes.includes("WRITE_AD_CONFIGURATION") && ctx.provider==="META_MARKETING" && /^[0-9]{1,32}$/.test(input.id) && ["CAMPAIGN","AD_SET","AD"].includes(input.type) && parent && ({CAMPAIGN:"AD_ACCOUNT",AD_SET:"CAMPAIGN",AD:"AD_SET"} as Record<string,string>)[input.type]===parent.type && parent.appId===state.connection.appId && parent.clientId===ctx.clientId && parent.provider===ctx.provider && parentGrants.length>0 && !snapshot.assets.some(a=>a.id===input.id) && plan.assets.every(ref=>snapshot.assets.some(a=>a.type===ref.type && a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,"") && a.appId===state.connection.appId && a.clientId===ctx.clientId && a.provider===ctx.provider));
    if(valid && parent){
      const ref:AssetRef={id:input.id,type:input.type};
      const approvedParents=plan.assets.map(ref=>snapshot.assets.find(a=>a.type===ref.type && a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,""))!);
      const parents=[{id:parent.id,type:parent.type},...approvedParents.filter(a=>a.key!==parent.key).map(a=>({id:a.id,type:a.type}))];
      const asset:MetaAsset={...ref,key:assetKey(ctx.provider,state.connection.appId,ref),tenantId:ctx.principal.tenantId,clientId:ctx.clientId,provider:ctx.provider,appId:state.connection.appId,parents,verifiedAt:now,revokedAt:null,revision:1,createdFromOperationId:permit.operationId};
      const intersect=<T extends string>(field:"capabilities"|"actions"|"tasks"):T[]=>parentGrants[0][field].filter(value=>parentGrants.every(g=>g[field].includes(value as never))) as T[];
      const grant:AssetGrant={id:`${permit.operationId}:created`,tenantId:asset.tenantId,clientId:asset.clientId,assetKey:asset.key,connectionId:state.connection.id,capabilities:intersect("capabilities"),actions:intersect("actions"),tasks:intersect("tasks"),verifiedAt:Math.min(...parentGrants.map(g=>g.verifiedAt)),expiresAt:Math.min(...parentGrants.map(g=>g.expiresAt)),revokedAt:null,revision:1};
      const expectedRecords:CreatedCompletion["expectedRecords"]=[{collection:"tenants",id:snapshot.tenant.id,canonical:canonicalJson(snapshot.tenant)},{collection:"members",id:snapshot.member.operatorId,canonical:canonicalJson(snapshot.member)},{collection:"clients",id:snapshot.client.id,canonical:canonicalJson(snapshot.client)},{collection:"connections",id:state.connection.id,canonical:canonicalJson(state.connection)},...snapshot.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...snapshot.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)}))];
      created={asset,grant,connectionBefore:state.connection,connectionAfter:{...state.connection,assetKeys:[...state.connection.assetKeys,asset.key],revision:state.connection.revision+1},expectedRecords,authorizationExpiresAt:state.expiresAt};
    }
    const summary=normalizeSafeDiff({newresource_id:input.id});
    const audit=(result:"SUCCEEDED"|"PARTIAL"):AuditRecord=>({id:`${operation.id}:result`,tenantId:operation.tenantId,clientId:operation.clientId,actorId:operation.actorId,tool:operation.tool,operationId:operation.id,event:result,timestamp:now,assetKeys:[...permit.assetKeys],planHash:operation.planHash,approvalId:operation.approvalId,beforeEvidence:"UNKNOWN",afterSummary:summary,...(result === "SUCCEEDED" && created ? {createdAssetKey:created.asset.key} : {})});
    let registered=!!created;
    try{
      await state.repo.finishOperation({tenantId:operation.tenantId,operationId:operation.id,result:registered?"SUCCEEDED":"PARTIAL",audit:audit(registered?"SUCCEEDED":"PARTIAL"),...(created?{created}:{})});
    }catch(error){
      if(error instanceof PlatformDenied && ["CREATED_ASSET_AUTHORIZATION_CHANGED","CREATED_ASSET_REGISTRATION_REJECTED"].includes(error.reason)){
        registered=false;
        try{await state.repo.finishOperation({tenantId:operation.tenantId,operationId:operation.id,result:"PARTIAL",audit:audit("PARTIAL")});}catch{throw new PlatformDenied("CREATED_ASSET_COMPLETION_RECONCILIATION_HOLD");}
      }else throw new PlatformDenied("CREATED_ASSET_COMPLETION_RECONCILIATION_HOLD");
    }
    state.createdResult=registered;state.completed=true;state.terminalHash=canonicalJson({created:inputHash,registered});
  };
  state.finishing=finish();
  try{await state.finishing;}finally{state.finishing=undefined;}
  return state.createdResult===true;
}
