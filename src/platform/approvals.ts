import { LEGACY_CORE_WRITE_TOOLS, buildStrictLegacyWritePlan, validateLegacyWriteSnapshot } from "./legacy-write.js";
import { randomUUID } from "node:crypto";
import { encryptToken, decryptToken } from "../auth/crypto.js";
import type { ApprovalRequest, AuthorizationSnapshot, OperationContext, OperationPlan, PlatformPrincipal } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { Collection, PlatformRepository } from "./repository.js";
import { canonicalJson, canonicalPlanHash, classifyPlan, evaluatePolicy, revisionHash } from "./policy.js";
import { resolveAuthorizedAssets } from "./assets.js";
import { selectConnection } from "./connections.js";
import { assertContractEligibility, contractPlanParameters, validateContractParameters } from "./clients.js";
import { PRODUCT_CONTRACTS, type ProductContract } from "./products/contracts.js";

const aad=(r:Pick<ApprovalRequest,"id"|"tenantId"|"clientId"|"actorId"|"planHash">)=>canonicalJson(["platform-approval-plan",1,r.id,r.tenantId,r.clientId,r.actorId,r.planHash]);
async function snapshot(repo:PlatformRepository,ctx:OperationContext,plan:OperationPlan):Promise<AuthorizationSnapshot>{
  const tenant=await repo.get("tenants",ctx.principal.tenantId,ctx.principal.tenantId),member=await repo.get("members",ctx.principal.tenantId,ctx.principal.operatorId),client=await repo.get("clients",ctx.principal.tenantId,ctx.clientId);
  if(!tenant||!member||!client)throw new PlatformDenied("PLATFORM_MEMBERSHIP_REQUIRED");
  const assets=await resolveAuthorizedAssets(repo,ctx,plan.assets,Date.now(),300000),connection=await selectConnection(repo,ctx,plan,assets);
  const grants=(await repo.list("grants",ctx.principal.tenantId)).filter(g=>g.connectionId===connection.id && g.clientId===ctx.clientId && g.revokedAt===null && g.expiresAt>Date.now() && assets.some(a=>a.key===g.assetKey));
  const state={tenant,member,client,assets,connection,grants};
  const decision=evaluatePolicy(ctx,plan,state,{writesEnabled:true});
  if(decision.decision!=="REQUIRE_CONFIRMATION")throw new PlatformDenied(decision.decision==="DENY"?decision.reason:"HUMAN_APPROVAL_NOT_REQUIRED_FOR_PLAN");
  return state;
}
function expected(snapshot:AuthorizationSnapshot):Array<{collection:Collection;id:string;canonical:string}>{
  return [{collection:"tenants",id:snapshot.tenant.id,canonical:canonicalJson(snapshot.tenant)},{collection:"members",id:snapshot.member.operatorId,canonical:canonicalJson(snapshot.member)},{collection:"clients",id:snapshot.client.id,canonical:canonicalJson(snapshot.client)},{collection:"connections",id:snapshot.connection.id,canonical:canonicalJson(snapshot.connection)},...snapshot.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...snapshot.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)}))];
}
export async function requestProductApproval(repo:PlatformRepository,ctx:OperationContext,contract:ProductContract,assetId:string,input:Record<string,unknown>):Promise<ApprovalRequest>{
  if(!contract.verified || contract.provider!==ctx.provider || contract.tool!==ctx.tool)throw new PlatformDenied("VERIFIED_PRODUCT_APPROVAL_CONTRACT_REQUIRED");
  validateContractParameters(contract,input);
  const assets=[{type:contract.assetType,id:assetId}];
  for(const [key,type] of Object.entries(contract.assetInputKeys??{})){if(typeof input[key]!=="string")throw new PlatformDenied("INDIRECT_ASSET_REQUIRED");assets.push({type,id:input[key] as string});}
  const plan:OperationPlan={parameters:contractPlanParameters(contract,assetId,input),assets,classes:[...contract.operationClasses],capability:contract.id,requiredScopes:[...contract.requiredScopes],tokenTypes:[...contract.tokenTypes],...(contract.requiredTasks?{requiredTasks:[...contract.requiredTasks]}:{})};
  plan.classes=classifyPlan(plan);
  const state=await snapshot(repo,ctx,plan);assertContractEligibility(contract,state.connection);
  const now=Date.now(),base={id:randomUUID(),tenantId:ctx.principal.tenantId,clientId:ctx.clientId,actorId:ctx.principal.operatorId,tool:ctx.tool,provider:ctx.provider,planHash:canonicalPlanHash(ctx,plan),revisionHash:revisionHash(state),expiresAt:now+300000,approvedAt:null,approvalId:null};
  const request:ApprovalRequest={...base,encryptedPlan:encryptToken(canonicalJson({ctx,plan}),aad(base))};
  await repo.commitControlPlane({tenantId:base.tenantId,expected:expected(state),writes:[{collection:"approvalRequests",id:base.id,value:request,createOnly:true}],audit:{id:randomUUID(),tenantId:base.tenantId,clientId:base.clientId,actorId:base.actorId,event:"APPROVAL_REQUESTED",timestamp:now,subjectId:base.id,planHash:base.planHash}});
  return request;
}
export async function requestLegacyApproval(repo:PlatformRepository,ctx:OperationContext,input:Record<string,unknown>):Promise<ApprovalRequest>{
  if(ctx.provider!=="META_MARKETING" || !LEGACY_CORE_WRITE_TOOLS.includes(ctx.tool))throw new PlatformDenied("VERIFIED_LEGACY_APPROVAL_CONTRACT_REQUIRED");
  const legacyInput=structuredClone(Object.fromEntries(Object.entries(input).filter(([key,value])=>value!==undefined && !["client_id","approval_id"].includes(key))));
  const plan=buildStrictLegacyWritePlan(ctx.tool,legacyInput),state=await snapshot(repo,ctx,plan);validateLegacyWriteSnapshot(plan,state);
  const now=Date.now(),base={id:randomUUID(),tenantId:ctx.principal.tenantId,clientId:ctx.clientId,actorId:ctx.principal.operatorId,tool:ctx.tool,provider:ctx.provider,planHash:canonicalPlanHash(ctx,plan),revisionHash:revisionHash(state),expiresAt:now+300000,approvedAt:null,approvalId:null};
  const request:ApprovalRequest={...base,encryptedPlan:encryptToken(canonicalJson({ctx,plan,legacyInput}),aad(base))};
  await repo.commitControlPlane({tenantId:base.tenantId,expected:expected(state),writes:[{collection:"approvalRequests",id:base.id,value:request,createOnly:true}],audit:{id:randomUUID(),tenantId:base.tenantId,clientId:base.clientId,actorId:base.actorId,event:"APPROVAL_REQUESTED",timestamp:now,subjectId:base.id,planHash:base.planHash}});
  return request;
}
export async function inspectApprovalRequest(repo:PlatformRepository,approver:PlatformPrincipal,id:string):Promise<{request:ApprovalRequest;ctx:OperationContext;plan:OperationPlan;snapshot:AuthorizationSnapshot;approverRevision:number}>{
  const request=await repo.get("approvalRequests",approver.tenantId,id),member=await repo.get("members",approver.tenantId,approver.operatorId);
  if(!request || request.tenantId!==approver.tenantId || !member || member.operatorId!==approver.operatorId || member.tenantId!==approver.tenantId || member.disabledAt!==null || !member.allowedClientIds.includes(request.clientId) || !member.roles.some(r=>r==="admin"||r==="approver"))throw new PlatformDenied("HUMAN_APPROVER_MEMBERSHIP_REQUIRED");
  if(request.approvedAt!==null || request.expiresAt<=Date.now())throw new PlatformDenied("APPROVAL_REQUEST_EXPIRED_OR_CONSUMED");
  const {ctx,plan,legacyInput}=JSON.parse(decryptToken(request.encryptedPlan,aad(request))) as {ctx:OperationContext;plan:OperationPlan;legacyInput?:Record<string,unknown>};
  if(ctx.principal.tenantId!==request.tenantId || ctx.principal.operatorId!==request.actorId || ctx.clientId!==request.clientId || ctx.tool!==request.tool || ctx.provider!==request.provider || canonicalPlanHash(ctx,plan)!==request.planHash)throw new PlatformDenied("APPROVAL_REQUEST_BINDING_MISMATCH");
  const contract=PRODUCT_CONTRACTS.find(c=>c.tool===request.tool);
  const legacy=LEGACY_CORE_WRITE_TOOLS.includes(request.tool);
  if(legacy){if(!legacyInput || canonicalJson(buildStrictLegacyWritePlan(request.tool,legacyInput))!==canonicalJson(plan))throw new PlatformDenied("LEGACY_APPROVAL_CONTRACT_CHANGED");}
  else if(!contract?.verified)throw new PlatformDenied("APPROVAL_CONTRACT_UNVERIFIED");
  const parameters=plan.parameters as {asset_id?:unknown;input?:unknown};
  if(!legacy && (typeof parameters.asset_id!=="string" || !parameters.input || typeof parameters.input!=="object" || Array.isArray(parameters.input) || canonicalJson(plan.parameters)!==canonicalJson(contractPlanParameters(contract!,parameters.asset_id as string,parameters.input as Record<string,unknown>))))throw new PlatformDenied("APPROVAL_CONTRACT_CHANGED");
  const state=await snapshot(repo,ctx,plan);if(legacy)validateLegacyWriteSnapshot(plan,state);else assertContractEligibility(contract!,state.connection);
  if(revisionHash(state)!==request.revisionHash)throw new PlatformDenied("APPROVAL_AUTHORIZATION_CHANGED");
  return {request,ctx,plan,snapshot:state,approverRevision:member.revision};
}
export async function issueHumanApproval(repo:PlatformRepository,approver:PlatformPrincipal,id:string):Promise<string>{
  const inspected=await inspectApprovalRequest(repo,approver,id),now=Date.now(),request=inspected.request,approvalId=randomUUID();
  const member=await repo.get("members",approver.tenantId,approver.operatorId);
  if(!member || member.revision!==inspected.approverRevision || member.operatorId!==approver.operatorId || member.tenantId!==approver.tenantId || member.disabledAt!==null || !member.allowedClientIds.includes(request.clientId) || !member.roles.some(r=>r==="admin"||r==="approver"))throw new PlatformDenied("APPROVER_CHANGED");
  const checks=expected(inspected.snapshot);
  if(!checks.some(c=>c.collection==="members" && c.id===approver.operatorId))checks.push({collection:"members",id:approver.operatorId,canonical:canonicalJson(member)});
  checks.push({collection:"approvalRequests",id,canonical:canonicalJson(request)});
  await repo.commitControlPlane({tenantId:approver.tenantId,expected:checks,writes:[{collection:"approvalRequests",id,value:{...request,approvedAt:now,approvalId},createOnly:false},{collection:"approvals",id:approvalId,value:{id:approvalId,tenantId:request.tenantId,clientId:request.clientId,actorId:request.actorId,approverId:approver.operatorId,approverRevision:member.revision,planHash:request.planHash,revisionHash:request.revisionHash,expiresAt:request.expiresAt,consumedAt:null,operationId:null},createOnly:true}],audit:{id:randomUUID(),tenantId:request.tenantId,clientId:request.clientId,actorId:approver.operatorId,event:"APPROVAL_ISSUED",timestamp:now,subjectId:id,planHash:request.planHash}});
  return approvalId;
}
