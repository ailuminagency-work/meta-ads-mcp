import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {PlatformDenied,type Client,type Member,type PlatformPrincipal,type Tenant} from './models.js';
import {canonicalJson} from './policy.js';
import type {ControlCommit,PlatformRepository} from './repository.js';

const clientIdSchema=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export type ClientManagementAction='create'|'assign';
export const clientManagementHash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const eventFor=(action:ClientManagementAction)=>action==='create'?'CLIENT_PROFILE_CREATED':'CLIENT_MEMBERSHIP_ASSIGNED';

/** Validate the exact control-plane mutation, even if a caller bypasses the browser service. */
export function validateClientManagementControl(input:ControlCommit):void{
  const creation=input.audit.event==='CLIENT_PROFILE_CREATED';
  if(!creation&&input.audit.event!=='CLIENT_MEMBERSHIP_ASSIGNED')throw new PlatformDenied('CLIENT_MANAGEMENT_EVENT_REQUIRED');
  if(input.expected.length!==3||input.writes.length!==(creation?2:1)
    ||input.writes.filter(w=>w.collection==='members').length!==1
    ||input.writes.filter(w=>w.collection==='clients').length!==(creation?1:0)
    ||input.writes.some(w=>!['members','clients'].includes(w.collection)))
    throw new PlatformDenied('CLIENT_MANAGEMENT_EXACT_WRITES_REQUIRED');
  const getExpected=(collection:'tenants'|'members'|'clients',id:string)=>{
    const rows=input.expected.filter(r=>r.collection===collection&&r.id===id);
    if(rows.length!==1)throw new PlatformDenied('CLIENT_MANAGEMENT_EXPECTED_STATE_REQUIRED');
    return rows[0].canonical;
  };
  const memberText=getExpected('members',input.audit.actorId);
  const tenantText=getExpected('tenants',input.tenantId);
  const clientText=getExpected('clients',input.audit.clientId);
  if(memberText==='null'||tenantText==='null')throw new PlatformDenied('CLIENT_MANAGEMENT_AUTHORITY_REQUIRED');
  const old=JSON.parse(memberText) as Member;
  const tenant=JSON.parse(tenantText) as Tenant;
  const row=input.writes.find(w=>w.collection==='members')!;
  const updated=row.value as Member;
  const clientId=input.audit.clientId;
  if(!clientIdSchema.safeParse(clientId).success||old.operatorId!==input.audit.actorId||old.tenantId!==input.tenantId
    ||tenant.id!==input.tenantId||tenant.status!=='ACTIVE'||tenant.migrationState!=='READY'
    ||old.disabledAt!==null||!old.roles.includes('admin')||old.allowedClientIds.includes(clientId)
    ||old.allowedClientIds.length>=100||new Set(old.allowedClientIds).size!==old.allowedClientIds.length
    ||row.createOnly||row.id!==old.operatorId
    ||canonicalJson(updated)!==canonicalJson({...old,allowedClientIds:[...old.allowedClientIds,clientId],revision:old.revision+1})
    ||input.audit.subjectId!==clientId||input.audit.tenantId!==input.tenantId
    ||input.audit.planHash!==clientManagementHash({event:input.audit.event,clientId,oldMemberHash:clientManagementHash(old)}))
    throw new PlatformDenied('CLIENT_MANAGEMENT_ADMIN_AND_SCOPE_REQUIRED');
  if(creation){
    const clientRow=input.writes.find(w=>w.collection==='clients')!;
    const created:Client={id:clientId,tenantId:input.tenantId,status:'ACTIVE',revision:1,verifiedBusinessIds:[]};
    if(clientText!=='null'||clientRow.id!==clientId||!clientRow.createOnly
      ||canonicalJson(clientRow.value)!==canonicalJson(created))
      throw new PlatformDenied('CLIENT_MANAGEMENT_CREATE_ONLY_REQUIRED');
  }else{
    if(clientText==='null')throw new PlatformDenied('CLIENT_MANAGEMENT_EXISTING_CLIENT_REQUIRED');
    const client=JSON.parse(clientText) as Client;
    if(client.id!==clientId||client.tenantId!==input.tenantId||client.status!=='ACTIVE')
      throw new PlatformDenied('CLIENT_MANAGEMENT_EXISTING_CLIENT_REQUIRED');
  }
}

/** No Meta API calls, no asset declarations, no credentials, grants, ownership or billing claims. */
export async function manageClient(repo:PlatformRepository,principal:PlatformPrincipal,action:ClientManagementAction,clientId:string,memberHash:string){
  if(!clientIdSchema.safeParse(clientId).success||!['create','assign'].includes(action))
    throw new PlatformDenied('CLIENT_MANAGEMENT_INPUT_INVALID');
  const [trusted,tenant,member,client]=await Promise.all([
    repo.resolvePrincipal(principal.operatorId),
    repo.get('tenants',principal.tenantId,principal.tenantId),
    repo.get('members',principal.tenantId,principal.operatorId),
    repo.get('clients',principal.tenantId,clientId)
  ]);
  if(!trusted||canonicalJson(trusted)!==canonicalJson(principal)||!tenant
    ||tenant.status!=='ACTIVE'||tenant.migrationState!=='READY'||!member
    ||member.tenantId!==principal.tenantId||member.operatorId!==principal.operatorId
    ||member.disabledAt!==null||!member.roles.includes('admin')
    ||clientManagementHash(member)!==memberHash||member.allowedClientIds.includes(clientId)
    ||member.allowedClientIds.length>=100)
    throw new PlatformDenied('CLIENT_MANAGEMENT_REVIEW_CHANGED');
  if(action==='create'&&client||action==='assign'&&(!client||client.tenantId!==principal.tenantId||client.status!=='ACTIVE'))
    throw new PlatformDenied('CLIENT_MANAGEMENT_CLIENT_STATE_REQUIRED');
  const event=eventFor(action);
  const created:Client={id:clientId,tenantId:principal.tenantId,status:'ACTIVE',revision:1,verifiedBusinessIds:[]};
  const before=clientManagementHash(member);
  const commit:ControlCommit={
    tenantId:principal.tenantId,
    expected:[
      {collection:'tenants',id:tenant.id,canonical:canonicalJson(tenant)},
      {collection:'members',id:member.operatorId,canonical:canonicalJson(member)},
      {collection:'clients',id:clientId,canonical:client?canonicalJson(client):'null'}
    ],
    writes:[
      {collection:'members',id:member.operatorId,createOnly:false,value:{...member,allowedClientIds:[...member.allowedClientIds,clientId],revision:member.revision+1}},
      ...(action==='create'?[{collection:'clients' as const,id:clientId,createOnly:true,value:created}]:[])
    ],
    audit:{id:randomUUID(),tenantId:principal.tenantId,clientId,actorId:principal.operatorId,event,
      timestamp:Date.now(),subjectId:clientId,planHash:clientManagementHash({event,clientId,oldMemberHash:before})}
  };
  validateClientManagementControl(commit);
  await repo.commitControlPlane(commit);
  return {client_id:clientId,status:action==='create'?'CLIENT_PROFILE_CREATED':'EXISTING_CLIENT_ASSIGNED',
    grants_created:0,provider_calls:0,connection_required:true};
}
