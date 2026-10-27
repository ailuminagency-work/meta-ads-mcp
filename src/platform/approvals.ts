import {appPurchaseRequirement} from "./app-purchase-eligibility.js";
import {legacyMarketingReadRequirement,legacyMarketingWriteRequirement} from "./legacy-marketing-eligibility.js";
import {businessOwnerDeadlines} from "./business-owner-scope.js";
import {loadClientBusinessEvidence,clientBusinessExpected} from "./client-business.js";
import {productVersion} from "./product-version.js";
import {loadManualEligibilityEvidence,manualEligibilityExpected} from "./manual-eligibility.js";
import {productAssetReferences} from "./product-asset-references.js";
import {loadOwnershipEvidence,ownershipExpectedRecords} from "./ownership-evidence.js";
import {bindLegacyTargetingEvidence} from "./targeting-lookup.js";
import {applyProductTaskRequirements} from "./product-task-requirements.js";
import {assertProductAssetRelationships,assertProductClientOwnership} from "./product-inputs.js";
import { LEGACY_CORE_WRITE_TOOLS, buildStrictLegacyWritePlan, validateLegacyWriteSnapshot } from "./legacy-write.js";
import { randomUUID } from "node:crypto";
import { encryptToken, decryptToken } from "../auth/crypto.js";
import type { ApprovalRequest, AuthorizationSnapshot, OperationContext, OperationPlan, PlatformPrincipal } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { Collection, PlatformRepository } from "./repository.js";
import { canonicalJson, canonicalPlanHash, classifyPlan, evaluatePolicy, revisionHash } from "./policy.js";
import { resolveAuthorizedAssets } from "./assets.js";
import { platformWritesEnabled } from "./runtime.js";
import { selectConnection } from "./connections.js";
import { assertContractEligibility, contractPlanParameters, validateContractParameters } from "./clients.js";
import { PRODUCT_CONTRACTS, type ProductContract } from "./products/contracts.js";

const aad=(r:Pick<ApprovalRequest,"id"|"tenantId"|"clientId"|"actorId"|"planHash">)=>canonicalJson(["platform-approval-plan",1,r.id,r.tenantId,r.clientId,r.actorId,r.planHash]);
async function snapshot(repo:PlatformRepository,ctx:OperationContext,plan:OperationPlan):Promise<AuthorizationSnapshot>{
  const tenant=await repo.get("tenants",ctx.principal.tenantId,ctx.principal.tenantId),member=await repo.get("members",ctx.principal.tenantId,ctx.principal.operatorId),client=await repo.get("clients",ctx.principal.tenantId,ctx.clientId);
  if(!tenant||!member||!client)throw new PlatformDenied("PLATFORM_MEMBERSHIP_REQUIRED");
  const assets=await resolveAuthorizedAssets(repo,ctx,plan.assets,Date.now(),300000);
  const product=PRODUCT_CONTRACTS.find(c=>c.tool===ctx.tool&&c.provider===ctx.provider&&c.verified);if(product){const checked=applyProductTaskRequirements(structuredClone(plan),product,assets);if(canonicalJson({global:checked.requiredTasks??[],scoped:checked.requiredAssetTasks??[]})!==canonicalJson({global:plan.requiredTasks??[],scoped:plan.requiredAssetTasks??[]}))throw new PlatformDenied("APPROVAL_TASK_CONTRACT_CHANGED");}
  const connection=await selectConnection(repo,ctx,plan,assets);
  const grants=(await repo.list("grants",ctx.principal.tenantId)).filter(g=>g.connectionId===connection.id && g.clientId===ctx.clientId && g.revokedAt===null && g.expiresAt>Date.now() && assets.some(a=>a.key===g.assetKey));
  const state={tenant,member,client,assets,connection,grants,businessOwnerEvidence:await loadClientBusinessEvidence(repo,client),financialEvidence:await loadOwnershipEvidence(repo,ctx,assets),manualEligibilityEvidence:await loadManualEligibilityEvidence(repo,ctx,connection,[...(connection.appPromotionProfile&&plan.assets.some(a=>a.type==="APP")?[appPurchaseRequirement(connection.appPromotionProfile.bindingHash)]:[]),...Object.keys(PRODUCT_CONTRACTS.find(c=>c.tool===ctx.tool&&c.provider===ctx.provider)?.eligibilityPolicies??{}),...(ctx.provider==="META_MARKETING"?[legacyMarketingReadRequirement(),...(ctx.tool.startsWith("ads_")&&plan.classes.some(c=>c!=="READ")?[legacyMarketingWriteRequirement()]:[])]:[])])};
  const decision=evaluatePolicy(ctx,plan,state,{writesEnabled:platformWritesEnabled()});
  if(decision.decision!=="REQUIRE_CONFIRMATION")throw new PlatformDenied(decision.decision==="DENY"?decision.reason:"HUMAN_APPROVAL_NOT_REQUIRED_FOR_PLAN");
  return state;
}
function expected(snapshot:AuthorizationSnapshot):Array<{collection:Collection;id:string;canonical:string}>{
  return [{collection:"tenants",id:snapshot.tenant.id,canonical:canonicalJson(snapshot.tenant)},{collection:"members",id:snapshot.member.operatorId,canonical:canonicalJson(snapshot.member)},{collection:"clients",id:snapshot.client.id,canonical:canonicalJson(snapshot.client)},{collection:"connections",id:snapshot.connection.id,canonical:canonicalJson(snapshot.connection)},...snapshot.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...snapshot.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),...ownershipExpectedRecords(snapshot.financialEvidence!),...manualEligibilityExpected(snapshot.manualEligibilityEvidence),...clientBusinessExpected(snapshot.businessOwnerEvidence)];
}
export async function requestProductApproval(repo:PlatformRepository,ctx:OperationContext,contract:ProductContract,assetId:string,input:Record<string,unknown>):Promise<ApprovalRequest>{
  if(!contract.verified || contract.provider!==ctx.provider || contract.tool!==ctx.tool)throw new PlatformDenied("VERIFIED_PRODUCT_APPROVAL_CONTRACT_REQUIRED");
  productVersion(contract.provider);
  validateContractParameters(contract,input);
  const assets=productAssetReferences(contract,assetId,input);
  const plan:OperationPlan={parameters:contractPlanParameters(contract,assetId,input),assets,classes:[...contract.operationClasses],capability:contract.id,requiredScopes:[...contract.requiredScopes],tokenTypes:[...contract.tokenTypes],...(contract.requiredTasks?{requiredTasks:[...contract.requiredTasks]}:{}),...(contract.createOrCopy?{createOrCopy:true}:{})};
  plan.classes=classifyPlan(plan);
  applyProductTaskRequirements(plan,contract,await resolveAuthorizedAssets(repo,ctx,plan.assets,Date.now(),300000));
  const state=await snapshot(repo,ctx,plan);assertProductAssetRelationships(contract,assetId,input,state.assets);assertProductClientOwnership(contract,assetId,state.client,state.assets,state.businessOwnerEvidence);assertContractEligibility(contract,state.connection,Date.now(),{evidence:state.manualEligibilityEvidence,clientId:ctx.clientId});
  const now=Date.now(),base={id:randomUUID(),tenantId:ctx.principal.tenantId,clientId:ctx.clientId,actorId:ctx.principal.operatorId,tool:ctx.tool,provider:ctx.provider,planHash:canonicalPlanHash(ctx,plan),revisionHash:revisionHash(state),expiresAt:Math.min(now+300000,...(state.manualEligibilityEvidence?.attestations.map(r=>r.expiresAt)??[]),...businessOwnerDeadlines(state),...state.financialEvidence!.attestations.map(r=>r.expiresAt),...state.financialEvidence!.observations.map(r=>r.expiresAt)),approvedAt:null,approvalId:null};
  const request:ApprovalRequest={...base,encryptedPlan:encryptToken(canonicalJson({ctx,plan}),aad(base))};
  await repo.commitControlPlane({tenantId:base.tenantId,expected:expected(state),writes:[{collection:"approvalRequests",id:base.id,value:request,createOnly:true}],audit:{id:randomUUID(),tenantId:base.tenantId,clientId:base.clientId,actorId:base.actorId,event:"APPROVAL_REQUESTED",timestamp:now,subjectId:base.id,planHash:base.planHash}});
  return request;
}
export async function requestLegacyApproval(repo:PlatformRepository,ctx:OperationContext,input:Record<string,unknown>):Promise<ApprovalRequest>{
  if(ctx.provider!=="META_MARKETING" || !LEGACY_CORE_WRITE_TOOLS.includes(ctx.tool))throw new PlatformDenied("VERIFIED_LEGACY_APPROVAL_CONTRACT_REQUIRED");
  const legacyInput=structuredClone(Object.fromEntries(Object.entries(input).filter(([key,value])=>value!==undefined && !["client_id","approval_id"].includes(key))));
  const plan=await bindLegacyTargetingEvidence(repo,ctx,buildStrictLegacyWritePlan(ctx.tool,legacyInput)),state=await snapshot(repo,ctx,plan);validateLegacyWriteSnapshot(plan,state);
  const now=Date.now(),base={id:randomUUID(),tenantId:ctx.principal.tenantId,clientId:ctx.clientId,actorId:ctx.principal.operatorId,tool:ctx.tool,provider:ctx.provider,planHash:canonicalPlanHash(ctx,plan),revisionHash:revisionHash(state),expiresAt:Math.min(now+300000,...businessOwnerDeadlines(state),...state.financialEvidence!.attestations.map(r=>r.expiresAt),...state.financialEvidence!.observations.map(r=>r.expiresAt)),approvedAt:null,approvalId:null};
  const request:ApprovalRequest={...base,encryptedPlan:encryptToken(canonicalJson({ctx,plan,legacyInput}),aad(base))};
  await repo.commitControlPlane({tenantId:base.tenantId,expected:expected(state),writes:[{collection:"approvalRequests",id:base.id,value:request,createOnly:true}],audit:{id:randomUUID(),tenantId:base.tenantId,clientId:base.clientId,actorId:base.actorId,event:"APPROVAL_REQUESTED",timestamp:now,subjectId:base.id,planHash:base.planHash}});
  return request;
}
export async function inspectApprovalRequest(repo:PlatformRepository,approver:PlatformPrincipal,id:string):Promise<{request:ApprovalRequest;ctx:OperationContext;plan:OperationPlan;snapshot:AuthorizationSnapshot;approverRevision:number}>{
  const request=await repo.get("approvalRequests",approver.tenantId,id),member=await repo.get("members",approver.tenantId,approver.operatorId);
  if(request&&["marketing_activate_ad","marketing_delete_paused_ad"].includes(request.tool)&&!member?.roles.includes("admin"))throw new PlatformDenied("MARKETING_HUMAN_ADMIN_APPROVAL_REQUIRED");
  if(request&&request.actorId===approver.operatorId&&process.env.LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER==="true")throw new PlatformDenied("SELF_APPROVAL_FORBIDDEN");
  if(!request || request.tenantId!==approver.tenantId || !member || member.operatorId!==approver.operatorId || member.tenantId!==approver.tenantId || member.disabledAt!==null || !member.allowedClientIds.includes(request.clientId) || !member.roles.some(r=>r==="admin"||r==="approver"))throw new PlatformDenied("HUMAN_APPROVER_MEMBERSHIP_REQUIRED");
  if(request.approvedAt!==null || request.expiresAt<=Date.now())throw new PlatformDenied("APPROVAL_REQUEST_EXPIRED_OR_CONSUMED");
  const {ctx,plan,legacyInput}=JSON.parse(decryptToken(request.encryptedPlan,aad(request))) as {ctx:OperationContext;plan:OperationPlan;legacyInput?:Record<string,unknown>};
  if(ctx.principal.tenantId!==request.tenantId || ctx.principal.operatorId!==request.actorId || ctx.clientId!==request.clientId || ctx.tool!==request.tool || ctx.provider!==request.provider || canonicalPlanHash(ctx,plan)!==request.planHash)throw new PlatformDenied("APPROVAL_REQUEST_BINDING_MISMATCH");
  const contract=PRODUCT_CONTRACTS.find(c=>c.tool===request.tool);
  const legacy=LEGACY_CORE_WRITE_TOOLS.includes(request.tool);
  if(legacy){if(!legacyInput || canonicalJson(await bindLegacyTargetingEvidence(repo,ctx,buildStrictLegacyWritePlan(request.tool,legacyInput)))!==canonicalJson(plan))throw new PlatformDenied("LEGACY_APPROVAL_CONTRACT_CHANGED");}
  else if(!contract?.verified)throw new PlatformDenied("APPROVAL_CONTRACT_UNVERIFIED");
  const parameters=plan.parameters as {asset_id?:unknown;input?:unknown};
  if(!legacy && (typeof parameters.asset_id!=="string" || !parameters.input || typeof parameters.input!=="object" || Array.isArray(parameters.input) || canonicalJson(plan.parameters)!==canonicalJson(contractPlanParameters(contract!,parameters.asset_id as string,parameters.input as Record<string,unknown>))))throw new PlatformDenied("APPROVAL_CONTRACT_CHANGED");
  const state=await snapshot(repo,ctx,plan);if(legacy)validateLegacyWriteSnapshot(plan,state);else {assertProductAssetRelationships(contract!,parameters.asset_id as string,parameters.input as Record<string,unknown>,state.assets);assertProductClientOwnership(contract!,parameters.asset_id as string,state.client,state.assets);assertContractEligibility(contract!,state.connection,Date.now(),{evidence:state.manualEligibilityEvidence,clientId:ctx.clientId});}
  if(revisionHash(state)!==request.revisionHash)throw new PlatformDenied("APPROVAL_AUTHORIZATION_CHANGED");
  return {request,ctx,plan,snapshot:state,approverRevision:member.revision};
}
export async function issueHumanApproval(repo:PlatformRepository,approver:PlatformPrincipal,id:string):Promise<string>{
  const inspected=await inspectApprovalRequest(repo,approver,id),now=Date.now(),request=inspected.request,approvalId=randomUUID();
  const member=await repo.get("members",approver.tenantId,approver.operatorId);
  if(["marketing_activate_ad","marketing_delete_paused_ad"].includes(request.tool)&&!member?.roles.includes("admin"))throw new PlatformDenied("MARKETING_HUMAN_ADMIN_APPROVAL_REQUIRED");
  if(!member || member.revision!==inspected.approverRevision || member.operatorId!==approver.operatorId || member.tenantId!==approver.tenantId || member.disabledAt!==null || !member.allowedClientIds.includes(request.clientId) || !member.roles.some(r=>r==="admin"||r==="approver"))throw new PlatformDenied("APPROVER_CHANGED");
  const checks=expected(inspected.snapshot);
  if(!checks.some(c=>c.collection==="members" && c.id===approver.operatorId))checks.push({collection:"members",id:approver.operatorId,canonical:canonicalJson(member)});
  checks.push({collection:"approvalRequests",id,canonical:canonicalJson(request)});
  await repo.commitControlPlane({tenantId:approver.tenantId,expected:checks,writes:[{collection:"approvalRequests",id,value:{...request,approvedAt:now,approvalId},createOnly:false},{collection:"approvals",id:approvalId,value:{id:approvalId,tenantId:request.tenantId,clientId:request.clientId,actorId:request.actorId,approverId:approver.operatorId,approverRevision:member.revision,planHash:request.planHash,revisionHash:request.revisionHash,expiresAt:request.expiresAt,consumedAt:null,operationId:null},createOnly:true}],audit:{id:randomUUID(),tenantId:request.tenantId,clientId:request.clientId,actorId:approver.operatorId,event:"APPROVAL_ISSUED",timestamp:now,subjectId:id,planHash:request.planHash}});
  return approvalId;
}
