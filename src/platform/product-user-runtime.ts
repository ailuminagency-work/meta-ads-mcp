import type {OperationalStore} from "./operational-store.js";
import {operationalHash} from "./operational-store.js";
import {readLifecycleSnapshot,lifecycleAppUserLockKey,type LifecycleCommand} from "./lifecycle.js";
import {privacySubjectHash} from "./meta-privacy-provenance.js";
import {PlatformDenied,type Connection} from "./models.js";
import {canonicalJson} from "./policy.js";
import type {PageInspectionRuntime} from "./page-task-refresh.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
/** USER credentials are inspected directly; there is no secondary token or Page credential fallback. */
export function createProductUserInspectionRuntime(store:OperationalStore,options:{secrets:PageInspectionRuntime["secrets"];fetcher?:typeof fetch;now?:()=>number}):PageInspectionRuntime {
 const now=()=>{const n=(options.now??Date.now)();if(!Number.isSafeInteger(n)||n<=0)throw new PlatformDenied("IG_USER_RUNTIME_CLOCK_REQUIRED");return n;};
 const current=async(tx:Parameters<Parameters<OperationalStore["transaction"]>[0]>[0],c:Connection,clientId?:string)=>{
  if(c.provider!=="META_INSTAGRAM_FACEBOOK_LOGIN"||c.tokenType!=="user"||!/^\d{1,100}$/.test(c.appId)||c.subjectId!==c.operatorId||c.metaAppUserId!==undefined&&c.metaAppUserId!==c.subjectId||c.pageInspectionDelegationId||!c.expiresAt||c.expiresAt<=now())throw new PlatformDenied("IG_USER_RUNTIME_PRIMARY_REQUIRED");
  const rows=await Promise.all(c.assetKeys.map(key=>tx.platform("assets",c.tenantId,key))),clients=[...new Set(rows.map(a=>a?.clientId))];if(clients.length!==1||!clients[0]||clientId&&clients[0]!==clientId)throw new PlatformDenied("IG_USER_RUNTIME_EXACT_CLIENT_REQUIRED");
  const s=await readLifecycleSnapshot(tx,{tenantId:c.tenantId,operatorId:c.operatorId},clients[0],c.id);
  if(canonicalJson(s.connection)!==canonicalJson(c)||await tx.get("lifecycle_locks",lifecycleAppUserLockKey(c.appId,c.operatorId))||await tx.get("meta_privacy_subject_locks",privacySubjectHash(c.appId,c.metaAppUserId??c.subjectId!))||s.assets.some(a=>!s.grants.some(g=>g.assetKey===a.key&&g.tenantId===c.tenantId&&g.clientId===clients[0]&&g.revokedAt===null&&g.capabilities.length>0&&g.capabilities.every(cap=>PRODUCT_CONTRACTS.some(p=>p.id===cap&&p.provider===c.provider&&p.verified&&p.tokenTypes.includes("user")&&p.requiredScopes.every(scope=>c.scopes.includes(scope)))))))throw new PlatformDenied("IG_USER_RUNTIME_CURRENT_AUTHORITY_REQUIRED");
  return s;
 };
 return {...options,loadDelegation:async()=>null,verifyProfile:async()=>{throw new PlatformDenied("IG_USER_SECONDARY_DELEGATION_FORBIDDEN");},assertCurrent:async(c,record)=>{if(record)throw new PlatformDenied("IG_USER_SECONDARY_DELEGATION_FORBIDDEN");await store.transaction(tx=>current(tx,c));},verifyHumanCommand:async(c,clientId,commandId)=>store.transaction(async tx=>{
  const s=await current(tx,c,clientId),command=await tx.get<LifecycleCommand>("lifecycle_commands",commandId),time=now();
  if(!command||command.id!==commandId||command.state!=="ATTEMPTED"||command.action!=="REFRESH_GRANTS"||command.tenantId!==c.tenantId||command.actorId!==c.operatorId||command.clientId!==clientId||command.connectionId!==c.id||!command.approverId||!Number.isSafeInteger(command.mutationStartedAt)||command.mutationStartedAt!<=0||command.mutationStartedAt!>time||command.expiresAt<=time||command.retentionExpiresAt<=time||command.snapshotHash!==s.hash||command.planHash!==operationalHash(canonicalJson({principal:{tenantId:command.tenantId,operatorId:command.actorId},clientId:command.clientId,connectionId:command.connectionId,action:command.action,snapshotHash:command.snapshotHash})))throw new PlatformDenied("IG_USER_RUNTIME_CURRENT_HUMAN_COMMAND_REQUIRED");
  const approver=await tx.platform("members",c.tenantId,command.approverId);if(!approver||approver.tenantId!==c.tenantId||approver.operatorId!==command.approverId||approver.disabledAt!==null||approver.revision!==command.approverRevision||!approver.allowedClientIds.includes(clientId)||!approver.roles.some(r=>["admin","approver"].includes(r)))throw new PlatformDenied("IG_USER_RUNTIME_CURRENT_HUMAN_APPROVER_REQUIRED");
 })};
}
