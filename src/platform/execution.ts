import {appPurchaseRequirement} from "./app-purchase-eligibility.js";
import {assertAppEventTypesReadConfiguration} from "./app-event-types-client.js";
import {legacyMarketingReadRequirement,legacyMarketingWriteRequirement} from "./legacy-marketing-eligibility.js";
import {assertAccountOwnershipEvidence} from "./ownership-evidence.js";
import {validatePurchaseConversionInput} from "./purchase-conversion-contract.js";
import {validateMarketingStudyInput} from "./marketing-study-contract.js";
import {validateMarketingRuleInput} from "./marketing-rule-contract.js";
import {buildRepointClaim,repointIntent} from "./marketing-repoint-claim.js";
import {marketingReportBody,MARKETING_REPORT_FIELDS} from "./marketing-report-contracts.js";
import {assertBusinessOwnerScope,assertBusinessOwnerDependencyLocks,businessOwnerDeadlines,requiredBusinessOwnerIds} from "./business-owner-scope.js";
import {loadClientBusinessEvidence,clientBusinessExpected} from "./client-business.js";
import {productVersion} from "./product-version.js";
import {loadManualEligibilityEvidence,manualEligibilityExpected} from "./manual-eligibility.js";
import {connectionPrivacyAppUserId} from "./privacy-identity.js";
import {loadOwnershipEvidence,ownershipExpectedRecords} from "./ownership-evidence.js";
import {assertProductAssetRelationships} from "./product-inputs.js";
import {validCreatedProductId,publishedProductOwnerType} from "./product-identifiers.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AssetRef, AssetGrant, MetaAsset, AuditRecord, AuthorizationSnapshot, Connection, Operation, OperationContext, OperationPlan, Provider } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { Collection, CreatedCompletion, PlatformRepository } from "./repository.js";
import { assetKey, resolveAuthorizedAssets } from "./assets.js";
import { decryptCredential, selectConnection, assertWhatsAppPhoneUnlocked } from "./connections.js";
import { canonicalJson, canonicalPlanHash, classifyPlan, evaluatePolicy, normalizeSafeDiff, revisionHash } from "./policy.js";

export interface ExecutionPermit { readonly operationId: string; readonly context: Readonly<OperationContext>; readonly assetKeys: readonly string[]; readonly connectionId: string; readonly planHash: string }
interface PermitState {approvalExpected?:Array<{collection:"approvals"|"members";id:string;canonical:string}>;authAppId?:string;readCredentialExpected?:{collection:"credentials";id:string;canonical:string}; repo: PlatformRepository; context: OperationContext; plan: OperationPlan; snapshot: AuthorizationSnapshot; connection: Connection; expiresAt: number; mutation: boolean; completed: boolean; mutationClaimed: boolean; providerReadProof?:{accountId:string;checkedAt:number;expiresAt:number;providerBusinessId?:string}; terminalHash?: string; finishing?: Promise<void>; createdHash?:string;createdResult?:boolean;deletedHash?:string;deletedResult?:boolean;repointHash?:string;repointResult?:boolean }
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
  const allowStaleReadBootstrap = plan.parameters.provider_read_bootstrap === true && plan.classes.every(c => c === "READ");
  const assets = await resolveAuthorizedAssets(repo, ctx, plan.assets, now,maximumAge,allowStaleReadBootstrap);
  const connection = await selectConnection(repo, ctx, plan, assets, now, options.selectedConnectionId);
  productVersion(connection.provider);
  const grants = (await repo.list("grants", ctx.principal.tenantId)).filter(g => assets.some(a => a.key === g.assetKey) && g.clientId === ctx.clientId && g.connectionId === connection.id && g.revokedAt === null && g.expiresAt > now);
  const snapshot: AuthorizationSnapshot = {tenant,member,client,assets,connection,grants,businessOwnerEvidence:await loadClientBusinessEvidence(repo,client),financialEvidence:await loadOwnershipEvidence(repo,ctx,assets),manualEligibilityEvidence:await loadManualEligibilityEvidence(repo,ctx,connection,[...(connection.appPromotionProfile&&plan.assets.some(a=>a.type==="APP")?[appPurchaseRequirement(connection.appPromotionProfile.bindingHash)]:[]),...Object.keys(PRODUCT_CONTRACTS.find(c=>c.tool===ctx.tool&&c.provider===ctx.provider)?.eligibilityPolicies??{}),...(ctx.provider==="META_MARKETING"?[legacyMarketingReadRequirement(),...(ctx.tool.startsWith("ads_")&&plan.classes.some(c=>c!=="READ")?[legacyMarketingWriteRequirement()]:[])]:[])])};
  const decision = evaluatePolicy(ctx, plan, snapshot, options);
  if(decision.decision === "DENY") throw new PlatformDenied(decision.reason);
  if(decision.decision === "REQUIRE_CONFIRMATION" && !options.approvalId) throw new PlatformDenied(decision.reason);
  const planHash = canonicalPlanHash(ctx, plan);
  const mutation = plan.classes.some(c => c !== "READ");
  const operationId = options.operationId ?? randomUUID();
  let approvalDeadline=Infinity;
  const approvalExpected:Array<{collection:"approvals"|"members";id:string;canonical:string}>=[];
  const preparationApprovalExpected:typeof approvalExpected=[];
  if(mutation&&options.approvalId){const approval=await repo.get("approvals",ctx.principal.tenantId,options.approvalId);if(!approval||!Number.isSafeInteger(approval.expiresAt)||approval.expiresAt<=now)throw new PlatformDenied("APPROVAL_INVALID_OR_REPLAYED");const approver=await repo.get("members",ctx.principal.tenantId,approval.approverId);if(!approver)throw new PlatformDenied("APPROVER_MEMBERSHIP_REQUIRED");approvalDeadline=approval.expiresAt;preparationApprovalExpected.push({collection:"approvals",id:approval.id,canonical:canonicalJson(approval)},{collection:"members",id:approver.operatorId,canonical:canonicalJson(approver)});approvalExpected.push({collection:"approvals",id:approval.id,canonical:canonicalJson({...approval,consumedAt:now,operationId})},{collection:"members",id:approver.operatorId,canonical:canonicalJson(approver)});}
  if(mutation) {
    let publicationClaim:{before:MetaAsset;after:MetaAsset}|undefined;
    let deletionClaim:{before:MetaAsset;after:MetaAsset}|undefined;
    const creativeRepointClaim=buildRepointClaim(plan,snapshot.assets,operationId,now);
    let publicationClaims:Array<{before:MetaAsset;after:MetaAsset}>|undefined;
    if(["instagram_create_carousel_container","instagram_login_create_carousel_container","threads_create_carousel_container"].includes(ctx.tool)){
      const contract=PRODUCT_CONTRACTS.find(c=>c.tool===ctx.tool&&c.provider===ctx.provider),parameters=plan.parameters as {asset_id?:unknown;input?:Record<string,unknown>};
      if(!contract?.verified||typeof parameters.asset_id!=="string"||!parameters.input||!Array.isArray(parameters.input.children))throw new PlatformDenied("CAROUSEL_CONTRACT_REQUIRED");
      assertProductAssetRelationships(contract,parameters.asset_id,parameters.input,snapshot.assets);
      publicationClaims=parameters.input.children.map(id=>{const matches=snapshot.assets.filter(a=>a.type==="MEDIA"&&a.id===id&&a.provider===ctx.provider);if(matches.length!==1||matches[0].publicationClaim)throw new PlatformDenied("PUBLICATION_ALREADY_CLAIMED_RECONCILE");const before=matches[0];return {before,after:{...before,revision:before.revision+1,publicationClaim:{operationId,claimedAt:now}}};});
    }
    if(["threads_publish_container","instagram_publish_container","instagram_login_publish","pages_create_videos"].includes(ctx.tool)){
      const contract=PRODUCT_CONTRACTS.find(c=>c.tool===ctx.tool && c.provider===ctx.provider);
      const parameters=plan.parameters as {asset_id?:unknown;input?:Record<string,unknown>};
      if(!contract?.verified || typeof parameters.asset_id!=="string" || !parameters.input)throw new PlatformDenied("PUBLICATION_CONTRACT_REQUIRED");
      assertProductAssetRelationships(contract,parameters.asset_id,parameters.input,snapshot.assets);
      const before=snapshot.assets.find(a=>a.type==="MEDIA" && a.id===parameters.input![ctx.tool==="pages_create_videos"?"source_media_id":"creation_id"]);
      if(!before || before.publicationClaim)throw new PlatformDenied("PUBLICATION_ALREADY_CLAIMED_RECONCILE");
      publicationClaim={before,after:{...before,revision:before.revision+1,publicationClaim:{operationId,claimedAt:now}}};
    }
    if(ctx.tool==="marketing_delete_paused_ad"){const parameters=plan.parameters as {asset_id?:unknown},before=snapshot.assets.find(a=>a.type==="AD"&&a.id===parameters.asset_id);if(!before||before.deletionClaim)throw new PlatformDenied("DELETION_ALREADY_CLAIMED_RECONCILE");deletionClaim={before,after:{...before,revision:before.revision+1,deletionClaim:{operationId,claimedAt:now}}};}
    const operation: Operation = {appId:connection.appId,metaAppUserId:connectionPrivacyAppUserId(connection),id: operationId, tenantId: ctx.principal.tenantId, clientId: ctx.clientId, actorId: ctx.principal.operatorId, tool: ctx.tool, planHash, state: "PREPARED", approvalId: options.approvalId ?? null, createdAt: now, updatedAt: now};
    const audit: AuditRecord = {id: `${operationId}:prepared`, tenantId: operation.tenantId, clientId: ctx.clientId, actorId: operation.actorId, tool: ctx.tool, operationId, event: "PREPARED", timestamp: now, assetKeys: assets.map(a => a.key), planHash, approvalId: operation.approvalId,requestedChange:normalizeSafeDiff(plan.parameters),beforeEvidence:"UNKNOWN"};
    await repo.prepareOperation({selectedConnectionId:connection.id,operation,audit,creativeRepointClaim,deletionClaim,publicationClaim,publicationClaims,approvalId: options.approvalId,expectedRevisionHash: revisionHash(snapshot),now, expectedRecords: [
      ...preparationApprovalExpected,
      {collection: "tenants", id: tenant.id, canonical: canonicalJson(tenant)},
      {collection: "members", id: member.operatorId, canonical: canonicalJson(member)},
      {collection: "clients", id: client.id, canonical: canonicalJson(client)},
      {collection: "connections", id: connection.id, canonical: canonicalJson(connection)},
      ...assets.map(a => ({collection: "assets" as const,id:a.key,canonical:canonicalJson(a)})),
      ...grants.map(g => ({collection: "grants" as const,id:g.id,canonical:canonicalJson(g)})),
      ...ownershipExpectedRecords(snapshot.financialEvidence!),...manualEligibilityExpected(snapshot.manualEligibilityEvidence),...clientBusinessExpected(snapshot.businessOwnerEvidence),
    ]});
    if(creativeRepointClaim){const index=snapshot.assets.findIndex(a=>a.key===creativeRepointClaim.before.key);snapshot.assets[index]=creativeRepointClaim.after;}
    if(deletionClaim){const index=snapshot.assets.findIndex(a=>a.key===deletionClaim!.before.key);snapshot.assets[index]=deletionClaim.after;}
    for(const claim of publicationClaims??[]){const index=snapshot.assets.findIndex(a=>a.key===claim.before.key);snapshot.assets[index]=claim.after;}
    if(publicationClaim){const index=snapshot.assets.findIndex(a=>a.key===publicationClaim!.before.key);snapshot.assets[index]=publicationClaim.after;}
  }
  const publicContext = structuredClone(ctx);
  Object.freeze(publicContext.principal); Object.freeze(publicContext);
  const permit: ExecutionPermit = Object.freeze({operationId, context: publicContext, assetKeys: Object.freeze(assets.map(a => a.key)), connectionId: connection.id, planHash});
  const freshnessWindow = allowStaleReadBootstrap ? 24 * 60 * 60_000 : maximumAge;
  permits.set(permit, {approvalExpected,authAppId:process.env.META_APP_ID,repo,context:ctx,plan,snapshot,connection,expiresAt: Math.min(now+60_000,approvalDeadline,...(snapshot.manualEligibilityEvidence?.attestations.map(r=>r.expiresAt)??[]),...businessOwnerDeadlines(snapshot),connection.expiresAt ?? Infinity,connection.verifiedAt+freshnessWindow,...assets.map(a=>a.verifiedAt+freshnessWindow),...grants.flatMap(g=>[g.expiresAt,g.verifiedAt+freshnessWindow]),...(mutation?[...snapshot.financialEvidence!.attestations.map(r=>r.expiresAt),...snapshot.financialEvidence!.observations.map(r=>r.expiresAt)]:[])),mutation,completed:false,mutationClaimed:false});
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

/**
 * A successful bounded provider read is an execution-scoped proof for the
 * exact selected connection and account. It is intentionally held only for
 * the lifetime of the permit; callers cannot inject or persist it.
 */
export function recordProviderReadProof(accountId:string, checkedAt=Date.now(), providerBusinessId?: string, ttlMs=300000):void {
  const permit=execution.getStore(), state=permit?permits.get(permit):undefined;
  if(!state||state.mutation||state.context.provider!=="META_MARKETING"||!/^\d{1,32}$/.test(accountId.replace(/^act_/,""))||!Number.isSafeInteger(checkedAt)||checkedAt<=0||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>300000)throw new PlatformDenied("PROVIDER_READ_PROOF_CONTEXT_REQUIRED");
  const account=accountId.replace(/^act_/,"");
  if(!state.snapshot.assets.some(a=>a.type==="AD_ACCOUNT"&&a.id.replace(/^act_/,"")===account)||!state.plan.assets.some(a=>a.type==="AD_ACCOUNT"&&a.id.replace(/^act_/,"")===account))throw new PlatformDenied("PROVIDER_READ_PROOF_ACCOUNT_BINDING_REQUIRED");
  if(providerBusinessId!==undefined && !/^\d{1,32}$/.test(providerBusinessId))throw new PlatformDenied("PROVIDER_READ_PROOF_BUSINESS_BINDING_REQUIRED");
  state.providerReadProof={accountId:account,checkedAt,expiresAt:Math.min(checkedAt+ttlMs,state.connection.expiresAt??checkedAt+ttlMs)};
  state.providerReadProof.providerBusinessId=providerBusinessId;
}

export function hasCurrentProviderReadProof(accountId:string, now=Date.now()):boolean {
  const permit=execution.getStore(), state=permit?permits.get(permit):undefined, proof=state?.providerReadProof;
  return !!state&&!state.mutation&&!!proof&&proof.accountId===accountId.replace(/^act_/,"")&&Number.isSafeInteger(now)&&now>=proof.checkedAt&&now<proof.expiresAt&&state.connection.revokedAt===null;
}
/** Persist a bounded Graph read as short-lived, connection-bound evidence. */
export async function persistProviderReadEligibility(accountId:string, checkedAt=Date.now()):Promise<void> {
  const permit=execution.getStore(), state=permit?permits.get(permit):undefined;
  if(!state||state.mutation||state.context.provider!=="META_MARKETING"||!hasCurrentProviderReadProof(accountId,checkedAt))throw new PlatformDenied("PROVIDER_READ_EVIDENCE_CONTEXT_REQUIRED");
  const normalized=accountId.replace(/^act_/ ,"");
  const target=state.snapshot.assets.find(a=>a.type==="AD_ACCOUNT"&&a.id.replace(/^act_/ ,"")===normalized&&state.connection.assetKeys.includes(a.key));
  if(!target)throw new PlatformDenied("PROVIDER_READ_EVIDENCE_ACCOUNT_BINDING_REQUIRED");
  const providerBusinessId=(state.providerReadProof as {providerBusinessId?:string}|undefined)?.providerBusinessId;
  if(target.ownerBusinessId && providerBusinessId !== target.ownerBusinessId)throw new PlatformDenied("PROVIDER_READ_EVIDENCE_OWNER_MISMATCH");
  const requirement=legacyMarketingReadRequirement(),source="https://developers.facebook.com/docs/marketing-api/";
  const existingRows=state.connection.eligibility?.filter(e=>e.requirement===requirement)??[];
  const trustedSource=/^https:\/\/(developers\.facebook\.com\/|www\.postman\.com\/meta\/|github\.com\/facebook\/)/;
  const existing=existingRows.find(e=>e.verified&&trustedSource.test(e.source)&&e.checkedAt<=checkedAt&&e.expiresAt>checkedAt);
  if(existing)return;
  if(existingRows.length)throw new PlatformDenied("UNVERIFIED_MARKETING_READ_ACCESS");
  const expiresAt=Math.min(checkedAt+3600000,state.connection.expiresAt??Infinity,checkedAt+3600000,...state.snapshot.grants.filter(g=>g.connectionId===state.connection.id).map(g=>g.expiresAt));
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=checkedAt)throw new PlatformDenied("PROVIDER_READ_EVIDENCE_EXPIRED");
  const nextConnection={...state.connection,eligibility:[...(state.connection.eligibility??[]).filter(e=>e.requirement!==requirement),{requirement,source,checkedAt,expiresAt,verified:true}],verifiedAt:checkedAt,revision:state.connection.revision+1};
  const nextAssets=state.snapshot.assets.map(a=>a.key===target.key?{...a,verifiedAt:checkedAt,revision:a.revision+1}:a);
  const nextGrants=state.snapshot.grants.map(g=>g.assetKey===target.key&&g.connectionId===state.connection.id?{...g,verifiedAt:checkedAt,expiresAt:Math.min(checkedAt+3600000,state.connection.expiresAt??Infinity),revision:g.revision+1}:g);
  const expected=[{collection:"tenants" as const,id:state.snapshot.tenant.id,canonical:canonicalJson(state.snapshot.tenant)},{collection:"members" as const,id:state.snapshot.member.operatorId,canonical:canonicalJson(state.snapshot.member)},{collection:"clients" as const,id:state.snapshot.client.id,canonical:canonicalJson(state.snapshot.client)},{collection:"connections" as const,id:state.connection.id,canonical:canonicalJson(state.connection)},...state.snapshot.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...state.snapshot.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)}))];
  await state.repo.commitControlPlane({tenantId:state.context.principal.tenantId,expected,writes:[{collection:"connections",id:state.connection.id,value:nextConnection,createOnly:false},{collection:"assets",id:target.key,value:nextAssets.find(a=>a.key===target.key)!,createOnly:false},...nextGrants.filter(g=>g.assetKey===target.key&&g.connectionId===state.connection.id).map(g=>({collection:"grants" as const,id:g.id,value:g,createOnly:false}))],audit:{id:randomUUID(),tenantId:state.context.principal.tenantId,clientId:state.context.clientId,actorId:state.context.principal.operatorId,event:"PROVIDER_READ_ELIGIBILITY_RECORDED",timestamp:checkedAt,subjectId:state.connection.id,planHash:permit!.planHash}});
  state.connection=nextConnection; state.snapshot.connection=nextConnection; state.snapshot.assets=nextAssets; state.snapshot.grants=nextGrants; state.expiresAt=Math.min(checkedAt+60_000,state.connection.expiresAt??Infinity,checkedAt+3600000,...nextGrants.filter(g=>g.connectionId===state.connection.id).map(g=>g.expiresAt));
}
export async function assertCatalogCampaignReadResponseCurrent(marketingPermit:ExecutionPermit,catalogPermit:ExecutionPermit):Promise<void>{
 const marketing=permits.get(marketingPermit),catalog=permits.get(catalogPermit),states=[marketing,catalog];
 if(!marketing||!catalog||marketing.repo!==catalog.repo||marketing.context.tool!=="catalog_get_campaign_input_diagnostics"||marketing.context.provider!=="META_MARKETING"||catalog.context.tool!=="catalog_get_item_diagnostics"||catalog.context.provider!=="META_BUSINESS"||canonicalJson(marketing.context.principal)!==canonicalJson(catalog.context.principal)||marketing.context.clientId!==catalog.context.clientId||states.some(s=>!s||s.mutation||!s.completed||s.finishing||canonicalJson(s.plan.classes)!==canonicalJson(["READ"])||!s.terminalHash||JSON.parse(s.terminalHash).result!=="SUCCEEDED"||s.expiresAt<=Date.now()))throw new PlatformDenied("CATALOG_CAMPAIGN_COMPLETED_DUAL_READ_REQUIRED");
 const adsets=marketing.snapshot.assets.filter(a=>a.type==="AD_SET"),catalogs=catalog.snapshot.assets.filter(a=>a.type==="CATALOG");if(adsets.length!==1||catalogs.length!==1)throw new PlatformDenied("CATALOG_CAMPAIGN_EXACT_ADSET_CATALOG_REQUIRED");
 const unique=new Map<string,{collection:Collection;id:string;canonical:string}>();
 for(const state of [marketing,catalog]){if(!state.readCredentialExpected)throw new PlatformDenied("CATALOG_CAMPAIGN_SELECTED_CREDENTIAL_CAPTURE_REQUIRED");const s=state.snapshot,rows=[state.readCredentialExpected,{collection:"tenants" as const,id:s.tenant.id,canonical:canonicalJson(s.tenant)},{collection:"members" as const,id:s.member.operatorId,canonical:canonicalJson(s.member)},{collection:"clients" as const,id:s.client.id,canonical:canonicalJson(s.client)},{collection:"connections" as const,id:s.connection.id,canonical:canonicalJson(s.connection)},...s.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...s.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),...ownershipExpectedRecords(s.financialEvidence!),...manualEligibilityExpected(s.manualEligibilityEvidence),...clientBusinessExpected(s.businessOwnerEvidence)];for(const row of rows){const key=row.collection+":"+row.id,prior=unique.get(key);if(prior&&prior.canonical!==row.canonical)throw new PlatformDenied("CATALOG_CAMPAIGN_CONFLICTING_DUAL_AUTHORITY");unique.set(key,row);}}
 const input={marketingContext:marketing.context,catalogContext:catalog.context,expectedRecords:[...unique.values()],marketingConnectionId:marketing.connection.id,catalogConnectionId:catalog.connection.id,marketingPlanHash:marketingPermit.planHash,catalogPlanHash:catalogPermit.planHash,authorizationExpiresAt:Math.min(marketing.expiresAt,catalog.expiresAt),catalogId:catalogs[0].id,adSetId:adsets[0].id};
 const checkpoint=marketing.repo.assertCatalogCampaignReadResponseCurrent;if(!checkpoint)throw new PlatformDenied("CATALOG_CAMPAIGN_ATOMIC_ADAPTER_REQUIRED");await checkpoint.call(marketing.repo,input);if(process.env.LUMIN_PLATFORM_ENABLED!=="true"||input.authorizationExpiresAt<=Date.now())throw new PlatformDenied("CATALOG_CAMPAIGN_FINAL_RESPONSE_EXPIRED");
}
export async function assertAdCommentsReadResponseCurrent(marketingPermit:ExecutionPermit,pagePermit:ExecutionPermit):Promise<void>{
 const marketing=permits.get(marketingPermit),pages=permits.get(pagePermit),states=[marketing,pages];
 if(!marketing||!pages||marketing.repo!==pages.repo||marketing.context.tool!=="ads_get_ad_comments"||marketing.context.provider!=="META_MARKETING"||pages.context.tool!=="pages_list_comments"||pages.context.provider!=="META_FACEBOOK_PAGES"||canonicalJson(marketing.context.principal)!==canonicalJson(pages.context.principal)||marketing.context.clientId!==pages.context.clientId||states.some(s=>!s||s.mutation||!s.completed||s.finishing||canonicalJson(s.plan.classes)!==canonicalJson(["READ"])||!s.terminalHash||JSON.parse(s.terminalHash).result!=="SUCCEEDED"||s.expiresAt<=Date.now()))throw new PlatformDenied("AD_COMMENTS_COMPLETED_DUAL_READ_REQUIRED");
 const ads=marketing.snapshot.assets.filter(a=>a.type==="AD"),posts=pages.snapshot.assets.filter(a=>a.type==="POST");if(ads.length!==1||posts.length!==1)throw new PlatformDenied("AD_COMMENTS_EXACT_AD_POST_REQUIRED");
 const unique=new Map<string,{collection:Collection;id:string;canonical:string}>();
 for(const state of [marketing,pages]){if(!state.readCredentialExpected)throw new PlatformDenied("AD_COMMENTS_SELECTED_CREDENTIAL_CAPTURE_REQUIRED");const s=state.snapshot,rows=[state.readCredentialExpected,{collection:"tenants" as const,id:s.tenant.id,canonical:canonicalJson(s.tenant)},{collection:"members" as const,id:s.member.operatorId,canonical:canonicalJson(s.member)},{collection:"clients" as const,id:s.client.id,canonical:canonicalJson(s.client)},{collection:"connections" as const,id:s.connection.id,canonical:canonicalJson(s.connection)},...s.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...s.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),...ownershipExpectedRecords(s.financialEvidence!),...manualEligibilityExpected(s.manualEligibilityEvidence),...clientBusinessExpected(s.businessOwnerEvidence)];for(const row of rows){const key=row.collection+":"+row.id,prior=unique.get(key);if(prior&&prior.canonical!==row.canonical)throw new PlatformDenied("AD_COMMENTS_CONFLICTING_DUAL_AUTHORITY");unique.set(key,row);}}
 const input={marketingContext:marketing.context,pageContext:pages.context,expectedRecords:[...unique.values()],marketingConnectionId:marketing.connection.id,pageConnectionId:pages.connection.id,marketingPlanHash:marketingPermit.planHash,pagePlanHash:pagePermit.planHash,authorizationExpiresAt:Math.min(marketing.expiresAt,pages.expiresAt),postId:posts[0].id,adId:ads[0].id};
 const checkpoint=marketing.repo.assertAdCommentsReadResponseCurrent;if(!checkpoint)throw new PlatformDenied("AD_COMMENTS_ATOMIC_ADAPTER_REQUIRED");await checkpoint.call(marketing.repo,input);if(process.env.LUMIN_PLATFORM_ENABLED!=="true"||input.authorizationExpiresAt<=Date.now())throw new PlatformDenied("AD_COMMENTS_FINAL_RESPONSE_EXPIRED");
}
export async function assertPrivateReadResponseCurrent(permit:ExecutionPermit):Promise<void>{return assertScopedReadResponseCurrent(permit,"marketing_get_ad_preview");}
export async function assertPortfolioReadResponseCurrent(permit:ExecutionPermit):Promise<void>{return assertScopedReadResponseCurrent(permit,"ads_portfolio_summary");}
export async function assertPageCommentsReadResponseCurrent(permit:ExecutionPermit):Promise<void>{return assertScopedReadResponseCurrent(permit,"pages_list_comments");}
export async function assertTargetingTaxonomyReadResponseCurrent(permit:ExecutionPermit):Promise<void>{const state=permits.get(permit),tool=state?.context.tool;if(tool!=="ads_get_interest_suggestions"&&tool!=="ads_search_behaviors"&&tool!=="ads_search_demographics")throw new PlatformDenied("TARGETING_TAXONOMY_EXACT_READ_REQUIRED");return assertScopedReadResponseCurrent(permit,tool);}
export async function assertCrmLeadReadResponseCurrent(permit:ExecutionPermit):Promise<AuthorizationSnapshot>{await assertScopedReadResponseCurrent(permit,"leads_get_lead");return structuredClone(permits.get(permit)!.snapshot);}
export async function assertCatalogOperationalReadResponseCurrent(permit:ExecutionPermit):Promise<void>{const tool=permits.get(permit)?.context.tool;if(tool!=="catalog_get_feed_status"&&tool!=="catalog_get_item_diagnostics")throw new PlatformDenied("CATALOG_OPERATIONAL_EXACT_READ_REQUIRED");return assertScopedReadResponseCurrent(permit,tool);}
export async function assertAudienceEstimateReadResponseCurrent(permit:ExecutionPermit):Promise<void>{return assertScopedReadResponseCurrent(permit,"ads_estimate_audience_size");}
export async function assertAppEventTypesReadResponseCurrent(permit:ExecutionPermit):Promise<void>{await assertScopedReadResponseCurrent(permit,"marketing_list_app_event_types");assertAppEventTypesReadConfiguration(permit);}
export async function assertImageInspectionReadResponseCurrent(permit:ExecutionPermit):Promise<void>{const tool=permits.get(permit)?.context.tool;if(tool!=="marketing_inspect_image"&&tool!=="marketing_inspect_creative_image")throw new PlatformDenied("IMAGE_INSPECTION_EXACT_TOOL_REQUIRED");await assertScopedReadResponseCurrent(permit,tool);if(productVersion("META_MARKETING")!=="v26.0")throw new PlatformDenied("IMAGE_INSPECTION_VERSION_UNVERIFIED");if(process.env.LUMIN_IMAGE_INSPECTION_ENABLED!=="true")throw new PlatformDenied("IMAGE_INSPECTION_DISABLED");}
export async function assertVideoInspectionReadResponseCurrent(permit:ExecutionPermit):Promise<void>{await assertScopedReadResponseCurrent(permit,permits.get(permit)?.context.tool==="marketing_inspect_creative_video"?"marketing_inspect_creative_video":"marketing_inspect_video");if(productVersion("META_MARKETING")!=="v26.0")throw new PlatformDenied("VIDEO_INSPECTION_VERSION_UNVERIFIED");if(process.env.LUMIN_VIDEO_INSPECTION_ENABLED!=="true")throw new PlatformDenied("VIDEO_INSPECTION_DISABLED");}
export async function assertInvoiceMetadataReadResponseCurrent(permit:ExecutionPermit):Promise<void>{return assertScopedReadResponseCurrent(permit,'marketing_list_client_invoice_metadata');}
async function assertScopedReadResponseCurrent(permit:ExecutionPermit,tool:"marketing_inspect_image"|"marketing_inspect_creative_image"|"marketing_list_app_event_types"|"marketing_inspect_creative_video"|"marketing_inspect_video"|"ads_estimate_audience_size"|"marketing_get_ad_preview"|"ads_portfolio_summary"|"pages_list_comments"|"ads_get_interest_suggestions"|"ads_search_behaviors"|"ads_search_demographics"|"leads_get_lead"|"catalog_get_feed_status"|"catalog_get_item_diagnostics"|"marketing_list_client_invoice_metadata"):Promise<void>{
 const state=permits.get(permit);
 if(!state||state.mutation||!state.completed||state.finishing||state.context.tool!==tool||state.context.provider!==(tool==="pages_list_comments"?"META_FACEBOOK_PAGES":tool==="catalog_get_feed_status"||tool==="catalog_get_item_diagnostics"?"META_BUSINESS":"META_MARKETING")||canonicalJson(state.plan.classes)!==canonicalJson(["READ"])||!state.terminalHash||JSON.parse(state.terminalHash).result!=="SUCCEEDED"||state.expiresAt<=Date.now())throw new PlatformDenied("PRIVATE_PREVIEW_COMPLETED_READ_PERMIT_REQUIRED");
 if(!state.readCredentialExpected)throw new PlatformDenied("PRIVATE_READ_SELECTED_CREDENTIAL_CAPTURE_REQUIRED");
 const snapshot=state.snapshot,rows=[state.readCredentialExpected,{collection:"tenants" as const,id:snapshot.tenant.id,canonical:canonicalJson(snapshot.tenant)},{collection:"members" as const,id:snapshot.member.operatorId,canonical:canonicalJson(snapshot.member)},{collection:"clients" as const,id:snapshot.client.id,canonical:canonicalJson(snapshot.client)},{collection:"connections" as const,id:snapshot.connection.id,canonical:canonicalJson(snapshot.connection)},...snapshot.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...snapshot.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),...ownershipExpectedRecords(snapshot.financialEvidence!),...manualEligibilityExpected(snapshot.manualEligibilityEvidence),...clientBusinessExpected(snapshot.businessOwnerEvidence)];
 const unique=new Map<string,typeof rows[number]>();for(const row of rows){const key=row.collection+":"+row.id,prior=unique.get(key);if(prior&&prior.canonical!==row.canonical)throw new PlatformDenied("PRIVATE_PREVIEW_CONFLICTING_DEPENDENCIES");unique.set(key,row);}
 const input={context:state.context,expectedRecords:[...unique.values()],authorizationExpiresAt:state.expiresAt,operationId:permit.operationId,planHash:permit.planHash,selectedConnectionId:state.connection.id};
 if(tool==='marketing_list_client_invoice_metadata'){if(process.env.LUMIN_INVOICE_METADATA_ENABLED!=='true')throw new PlatformDenied('INVOICE_METADATA_DISABLED');for(const account of snapshot.assets.filter(a=>a.type==='AD_ACCOUNT'))assertAccountOwnershipEvidence(snapshot,account);}
 const checkpoint=state.repo.assertPrivateReadResponseCurrent;if(!checkpoint)throw new PlatformDenied("PRIVATE_PREVIEW_ATOMIC_ADAPTER_REQUIRED");await checkpoint.call(state.repo,input);if(process.env.LUMIN_PLATFORM_ENABLED!=="true"||state.expiresAt<=Date.now()||tool==="marketing_get_ad_preview"&&process.env.LUMIN_MARKETING_PREVIEWS_ENABLED!=="true")throw new PlatformDenied("PRIVATE_PREVIEW_RESPONSE_EXPIRED_OR_DISABLED");if(tool==='marketing_list_client_invoice_metadata'){if(process.env.LUMIN_INVOICE_METADATA_ENABLED!=='true')throw new PlatformDenied('INVOICE_METADATA_DISABLED');for(const account of snapshot.assets.filter(a=>a.type==='AD_ACCOUNT'))assertAccountOwnershipEvidence(snapshot,account);}
}
export async function revalidateExecutionPermit(permit: ExecutionPermit): Promise<void> {
  const state = validate(permit);
  const ctx = state.context;
  const snapshot = state.snapshot;
  const dependencyIds=[...new Set([snapshot.member.operatorId,...[...manualEligibilityExpected(snapshot.manualEligibilityEvidence),...clientBusinessExpected(snapshot.businessOwnerEvidence),...(state.approvalExpected??[])].filter(row=>row.collection==="members").map(row=>row.id)])];
  const assertCurrentIdentities=async()=>{if(process.env.META_APP_ID!==state.authAppId)throw new PlatformDenied("EXECUTION_AUTH_APP_CHANGED");for(const operatorId of dependencyIds){const current=await state.repo.resolvePrincipal(operatorId);if(canonicalJson(current)!==canonicalJson({tenantId:ctx.principal.tenantId,operatorId}))throw new PlatformDenied("EXECUTION_OPERATOR_IDENTITY_CHANGED");if(state.authAppId&&await state.repo.isAppUserLifecycleLocked?.(state.authAppId,operatorId,operatorId))throw new PlatformDenied("EXECUTION_AUTH_IDENTITY_LOCKED");}if(process.env.META_APP_ID!==state.authAppId)throw new PlatformDenied("EXECUTION_AUTH_APP_CHANGED");};
  await assertCurrentIdentities();
  await assertWhatsAppPhoneUnlocked(state.repo,state.connection,snapshot.assets);
  assertBusinessOwnerScope(snapshot);
  await assertBusinessOwnerDependencyLocks(state.repo,snapshot);
  if(await state.repo.isAppUserLifecycleLocked?.(state.connection.appId,state.connection.operatorId,connectionPrivacyAppUserId(state.connection)))throw new PlatformDenied("APP_USER_LIFECYCLE_EGRESS_LOCKED");
  const checks = [
    ["tenants", snapshot.tenant.id, snapshot.tenant], ["members", snapshot.member.operatorId, snapshot.member],
    ["clients", snapshot.client.id, snapshot.client], ["connections", snapshot.connection.id, snapshot.connection],
    ...snapshot.assets.map(a => ["assets",a.key,a]), ...snapshot.grants.map(g => ["grants",g.id,g]),
    ...snapshot.financialEvidence!.attestations.map(r=>["ownerBillingAttestations",r.id,r]),...snapshot.financialEvidence!.observations.map(r=>["accountOwnershipObservations",r.id,r]),...[...manualEligibilityExpected(snapshot.manualEligibilityEvidence),...clientBusinessExpected(snapshot.businessOwnerEvidence)].map(e=>[e.collection,e.id,JSON.parse(e.canonical)]),
    ...(state.approvalExpected??[]).map(row=>[row.collection,row.id,JSON.parse(row.canonical)] as const),
    ...(state.readCredentialExpected?[["credentials",state.readCredentialExpected.id,JSON.parse(state.readCredentialExpected.canonical)] as const]:[]),
  ] as const;
  for(const [collection,id,expected] of checks) {
    const fresh = await state.repo.get(collection as Collection,ctx.principal.tenantId,id as string);
    if(canonicalJson(fresh) !== canonicalJson(expected)) throw new PlatformDenied("AUTHORIZATION_CHANGED");
  }
  if(state.mutation) {
    const record = await state.repo.get("operations",ctx.principal.tenantId,permit.operationId);
    if(!record || !["PREPARED","EXECUTING"].includes(record.state) || record.planHash !== permit.planHash) throw new PlatformDenied("DURABLE_AUDIT_REQUIRED");
  }
  await assertWhatsAppPhoneUnlocked(state.repo,state.connection,snapshot.assets);
  await assertCurrentIdentities();
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
  productVersion(c.provider);
  const fresh = await state.repo.get("connections", state.context.principal.tenantId,c.id);
  if(!fresh || canonicalJson(fresh) !== canonicalJson(c)) throw new PlatformDenied("CONNECTION_CHANGED");
  const credential = await state.repo.get("credentials",c.tenantId,c.credentialId);
  if(!credential || credential.tenantId !== c.tenantId || credential.operatorId !== c.operatorId || credential.provider !== c.provider || credential.appId !== c.appId || credential.id !== c.credentialId) throw new PlatformDenied("CREDENTIAL_BINDING_MISMATCH");
  if(requiredBusinessOwnerIds(state.snapshot).length)await revalidateExecutionPermit(permit);
  await assertWhatsAppPhoneUnlocked(state.repo,c,state.snapshot.assets);
  await assertBusinessOwnerDependencyLocks(state.repo,state.snapshot);
  const expected={collection:"credentials" as const,id:credential.id,canonical:canonicalJson(credential)};if(state.readCredentialExpected&&canonicalJson(state.readCredentialExpected)!==canonicalJson(expected))throw new PlatformDenied(state.mutation?"EXECUTION_CREDENTIAL_CHANGED":"READ_CREDENTIAL_CHANGED");state.readCredentialExpected=expected;
  await revalidateExecutionPermit(permit);
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
export async function finishCreatedAsset(permit:ExecutionPermit,input:{id:string;type:"CAMPAIGN"|"AD_SET"|"AD"|"CREATIVE"|"MEDIA"|"POST"|"FLOW"|"TEMPLATE"|"COMMENT"|"VIDEO"|"LEAD_FORM"|"AD_IMAGE"|"AD_VIDEO"|"AUDIENCE"|"REPORT"|"RULE"|"STUDY"|"CUSTOM_CONVERSION";parent:AssetRef;providerResult?:"PARTIAL"}):Promise<boolean>{
  const state=permits.get(permit);
  if(!state || !state.mutation || !state.mutationClaimed)throw new PlatformDenied("CLAIMED_CREATION_PERMIT_REQUIRED");
  input=structuredClone(input);
  if(input.providerResult && (!["instagram_publish_container","instagram_login_publish","whatsapp_platform_create_flow"].includes(permit.context.tool) || input.providerResult!=="PARTIAL"))throw new PlatformDenied("PARTIAL_CREATION_CONTRACT_REQUIRED");
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
    const validAds=state.plan.createOrCopy && state.plan.parameters.status==="PAUSED" && state.plan.classes.includes("WRITE_AD_CONFIGURATION") && ctx.provider==="META_MARKETING" && /^[0-9]{1,32}$/.test(input.id) && ["CAMPAIGN","AD_SET","AD","CREATIVE"].includes(input.type) && parent && ({CAMPAIGN:"AD_ACCOUNT",AD_SET:"CAMPAIGN",AD:"AD_SET",CREATIVE:"AD_ACCOUNT"} as Record<string,string>)[input.type]===parent.type && parent.appId===state.connection.appId && parent.clientId===ctx.clientId && parent.provider===ctx.provider && parentGrants.length>0 && !snapshot.assets.some(a=>a.id===input.id) && plan.assets.every(ref=>snapshot.assets.some(a=>a.type===ref.type && a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,"") && a.appId===state.connection.appId && a.clientId===ctx.clientId && a.provider===ctx.provider));
    const contract=PRODUCT_CONTRACTS.find(c=>c.tool===ctx.tool && c.provider===ctx.provider);
    const validProduct=!!contract?.verified && contract.createdAssetType===input.type && ["MEDIA","POST","FLOW","TEMPLATE","COMMENT","VIDEO","LEAD_FORM","AD_IMAGE","AD_VIDEO","AUDIENCE","REPORT","RULE","STUDY","CUSTOM_CONVERSION"].includes(input.type) && (contract.operationClasses.includes("WRITE_CONTENT")||(contract.tool==="marketing_create_purchase_conversion"&&contract.provider==="META_MARKETING"&&input.type==="CUSTOM_CONVERSION"&&canonicalJson(contract.operationClasses)===canonicalJson(["WRITE_AD_CONFIGURATION"]))||(contract.tool==="marketing_create_classic_split_study"&&contract.provider==="META_MARKETING"&&input.type==="STUDY"&&canonicalJson(contract.operationClasses)===canonicalJson(["WRITE_AD_CONFIGURATION"]))||(contract.tool==="marketing_create_disabled_pause_rule"&&contract.provider==="META_MARKETING"&&input.type==="RULE"&&canonicalJson(contract.operationClasses)===canonicalJson(["WRITE_AD_CONFIGURATION"]))||(contract.provider==="META_MARKETING"&&input.type==="AUDIENCE"&&["marketing_create_empty_custom_audience","marketing_create_lookalike_audience"].includes(contract.tool)&&canonicalJson(contract.operationClasses)===canonicalJson(["WRITE_AD_CONFIGURATION"]))) && plan.capability===contract.id && parent?.type===contract.assetType && plan.assets[0]?.id.replace(/^act_/,"")===parent.id.replace(/^act_/,"") && plan.assets[0]?.type===parent.type && parent.appId===state.connection.appId && parent.clientId===ctx.clientId && parent.provider===ctx.provider && parentGrants.length>0 && validCreatedProductId(contract,input.id,parent?.id??"") && !snapshot.assets.some(a=>a.id===input.id) && plan.assets.every(ref=>snapshot.assets.some(a=>a.type===ref.type && a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,"") && a.appId===state.connection.appId && a.clientId===ctx.clientId && a.provider===ctx.provider));
    if((validAds || validProduct) && parent){
      const ref:AssetRef={id:input.id,type:input.type};
      const approvedParents=plan.assets.map(ref=>snapshot.assets.find(a=>a.type===ref.type && a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,""))!);
      const publishedOwner=publishedProductOwnerType(contract);if(publishedOwner&&parent.type!==publishedOwner)throw new PlatformDenied("PUBLISHED_OWNER_BINDING_REQUIRED");
      const sources=approvedParents.filter(a=>a.key!==parent.key);
      const sourceAdId=plan.parameters.marketing_source_ad_id;
      const replacementCreative=validAds&&input.type==="CREATIVE"&&plan.capability==="legacy.ads_create_ad_creative"&&typeof sourceAdId==="string"&&/^[0-9]{1,32}$/.test(sourceAdId)&&state.connection.tokenType==="user"&&canonicalJson(plan.tokenTypes)===canonicalJson(["user"]);
      const sourceAd=replacementCreative?sources.find(a=>a.type==="AD"&&a.id===sourceAdId):undefined;
      if(replacementCreative&&!sourceAd)throw new PlatformDenied("CREATIVE_SOURCE_AD_PROVENANCE_REQUIRED");
      const parents=[{id:parent.id,type:parent.type},...(publishedOwner?[]:sources.filter(a=>a.key!==sourceAd?.key).map(a=>({id:a.id,type:a.type})))];
      const asset:MetaAsset={...ref,key:assetKey(ctx.provider,state.connection.appId,ref),tenantId:ctx.principal.tenantId,clientId:ctx.clientId,provider:ctx.provider,appId:state.connection.appId,parents,verifiedAt:now,revokedAt:null,revision:1,createdFromOperationId:permit.operationId,...(publishedOwner?{sourceAssetKeys:sources.map(a=>a.key)}:{}),...(contract?.createdAssetKind?{productKind:contract.createdAssetKind}:{})};
      if(contract?.tool==="marketing_create_async_report"&&input.type==="REPORT"){const approved=plan.parameters.input as Record<string,unknown>;marketingReportBody(approved);asset.reportDefinition={kind:"account_insights",level:"account",fields:[...MARKETING_REPORT_FIELDS],since:approved.since as string,until:approved.until as string,useUnifiedAttributionSetting:true,requestDigest:operation.planHash,operationId:operation.id,createdAt:now};}
      if(contract?.tool==="marketing_create_disabled_pause_rule"&&input.type==="RULE"){const approved=plan.parameters.input as Record<string,unknown>;validateMarketingRuleInput(approved);asset.ruleDefinition={kind:"disabled_static_ad_pause",status:"DISABLED",schedule:"DAILY",adIds:[...(approved.ad_ids as string[])],impressionsThreshold:approved.impressions_threshold as number,timePreset:"LAST_7_DAYS",requestDigest:operation.planHash,operationId:operation.id,createdAt:now};}
      if(contract?.tool==="marketing_create_classic_split_study"&&input.type==="STUDY"){const approved=plan.parameters.input as Record<string,unknown>;validateMarketingStudyInput(approved);asset.studyDefinition={kind:"classic_split_test",businessId:parent.id,accountId:approved.account_id as string,campaignIds:[...(approved.campaign_ids as string[])],startTime:approved.start_time as number,endTime:approved.end_time as number,allocation:"50_50",requestDigest:operation.planHash,operationId:operation.id,createdAt:now};}
      if(contract?.tool==="marketing_create_purchase_conversion"&&input.type==="CUSTOM_CONVERSION"){const approved=plan.parameters.input as Record<string,unknown>;validatePurchaseConversionInput(approved);asset.purchaseConversionDefinition={kind:"website_purchase_value",pixelId:approved.pixel_id as string,minimumValue:approved.minimum_value as number,requestDigest:operation.planHash,operationId:operation.id,createdAt:now};}
      if(sourceAd)asset.sourceAssetKeys=[sourceAd.key];
      const intersect=<T extends string>(field:"capabilities"|"actions"|"tasks"):T[]=>parentGrants[0][field].filter(value=>parentGrants.every(g=>g[field].includes(value as never))) as T[];
      const grant:AssetGrant={id:`${permit.operationId}:created`,tenantId:asset.tenantId,clientId:asset.clientId,assetKey:asset.key,connectionId:state.connection.id,capabilities:intersect("capabilities"),actions:intersect("actions"),tasks:(["VIDEO","LEAD_FORM","AD_IMAGE","AD_VIDEO","AUDIENCE","REPORT","RULE","STUDY","CUSTOM_CONVERSION"].includes(input.type)||["messenger_create_utility_template","pages_reply_comment"].includes(contract?.tool??""))?[]:intersect("tasks"),verifiedAt:Math.min(...parentGrants.map(g=>g.verifiedAt)),expiresAt:Math.min(...parentGrants.map(g=>g.expiresAt)),revokedAt:null,revision:1};
      const expectedRecords:CreatedCompletion["expectedRecords"]=[...(state.readCredentialExpected?[state.readCredentialExpected]:[]),...(state.approvalExpected??[]),{collection:"tenants",id:snapshot.tenant.id,canonical:canonicalJson(snapshot.tenant)},{collection:"members",id:snapshot.member.operatorId,canonical:canonicalJson(snapshot.member)},{collection:"clients",id:snapshot.client.id,canonical:canonicalJson(snapshot.client)},{collection:"connections",id:state.connection.id,canonical:canonicalJson(state.connection)},...snapshot.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...snapshot.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),...ownershipExpectedRecords(snapshot.financialEvidence!),...manualEligibilityExpected(snapshot.manualEligibilityEvidence),...clientBusinessExpected(snapshot.businessOwnerEvidence)];
      created={asset,grant,connectionBefore:state.connection,connectionAfter:{...state.connection,assetKeys:[...state.connection.assetKeys,asset.key],revision:state.connection.revision+1},expectedRecords,authorizationExpiresAt:state.expiresAt};
    }
    const summary=contract?.tool==="pages_reply_comment"&&input.type==="COMMENT"&&validCreatedProductId(contract,input.id,parent?.id??"")?[{field:"newresource_id",value:input.id}]:contract?.tool==="marketing_upload_image"&&input.type==="AD_IMAGE"&&/^[a-f0-9]{32}$/.test(input.id)?[{field:"newresource_id",value:input.id}]:normalizeSafeDiff({newresource_id:input.id});
    let registered=!!created;
    const audit=(result:"SUCCEEDED"|"PARTIAL"):AuditRecord=>({id:`${operation.id}:result`,tenantId:operation.tenantId,clientId:operation.clientId,actorId:operation.actorId,tool:operation.tool,operationId:operation.id,event:result,timestamp:now,assetKeys:[...permit.assetKeys],planHash:operation.planHash,approvalId:operation.approvalId,beforeEvidence:"UNKNOWN",afterSummary:summary,...(registered && created ? {createdAssetKey:created.asset.key} : {})});
    try{
      await state.repo.finishOperation({tenantId:operation.tenantId,operationId:operation.id,result:registered&&!input.providerResult?"SUCCEEDED":"PARTIAL",audit:audit(registered&&!input.providerResult?"SUCCEEDED":"PARTIAL"),...(created?{created}:{})});
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


export async function finishRepointedAd(permit:ExecutionPermit):Promise<boolean>{
 const state=permits.get(permit),intent=state?repointIntent(state.plan):undefined;
 if(!state||!state.mutation||!state.mutationClaimed||state.context.tool!=="ads_update_ad"||state.context.provider!=="META_MARKETING"||!intent)throw new PlatformDenied("CLAIMED_REPOINT_PERMIT_REQUIRED");
 const hash=canonicalJson(intent);
 if(state.repointHash&&state.repointHash!==hash||!state.repointHash&&state.terminalHash)throw new PlatformDenied("OPERATION_ALREADY_FINISHED");
 if(state.completed)return state.repointResult===true;
 if(state.finishing){await state.finishing;return state.repointResult===true;}
 state.repointHash=hash;state.terminalHash=canonicalJson({repoint:hash});
 const finish=async()=>{
  const s=state.snapshot,ctx=state.context,operation=await state.repo.get("operations",ctx.principal.tenantId,permit.operationId),before=s.assets.find(a=>a.type==="AD"&&a.id===intent.adId),now=Date.now();
  if(!operation||!before||before.creativeRepointClaim?.operationId!==operation.id||before.creativeRepointClaim.oldCreativeId!==intent.oldCreativeId||before.creativeRepointClaim.newCreativeId!==intent.newCreativeId)throw new PlatformDenied("REPOINT_COMPLETION_CLAIM_REQUIRED");
  const {creativeRepointClaim:claim,...base}=before;void claim;
  const after:MetaAsset={...base,parents:before.parents.map(ref=>ref.type==="CREATIVE"?{type:"CREATIVE",id:intent.newCreativeId}:ref),revision:before.revision+1};
  const expectedRecords=[...(state.readCredentialExpected?[state.readCredentialExpected]:[]),...(state.approvalExpected??[]),{collection:"tenants" as const,id:s.tenant.id,canonical:canonicalJson(s.tenant)},{collection:"members" as const,id:s.member.operatorId,canonical:canonicalJson(s.member)},{collection:"clients" as const,id:s.client.id,canonical:canonicalJson(s.client)},{collection:"connections" as const,id:s.connection.id,canonical:canonicalJson(s.connection)},...s.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...s.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),...ownershipExpectedRecords(s.financialEvidence!),...manualEligibilityExpected(s.manualEligibilityEvidence),...clientBusinessExpected(s.businessOwnerEvidence)];
  const audit=(result:"SUCCEEDED"|"PARTIAL"):AuditRecord=>({id:operation.id+":result",tenantId:operation.tenantId,clientId:operation.clientId,actorId:operation.actorId,tool:operation.tool,operationId:operation.id,event:result,timestamp:now,assetKeys:[...permit.assetKeys],planHash:operation.planHash,approvalId:operation.approvalId,beforeEvidence:"UNKNOWN",afterSummary:[{field:"status",value:"PAUSED"},{field:"creative_id",value:intent.newCreativeId}]});
  let registered=true;
  try{await state.repo.finishOperation({tenantId:operation.tenantId,operationId:operation.id,result:"SUCCEEDED",audit:audit("SUCCEEDED"),repointed:{assetBefore:before,assetAfter:after,connection:s.connection,grants:s.grants,expectedRecords,authorizationExpiresAt:state.expiresAt,oldCreativeId:intent.oldCreativeId,newCreativeId:intent.newCreativeId,plan:state.plan}});}
  catch(error){if(error instanceof PlatformDenied&&["REPOINTED_AD_AUTHORIZATION_CHANGED","REPOINTED_AD_ATOMIC_COMMIT_REJECTED"].includes(error.reason)){registered=false;try{await state.repo.finishOperation({tenantId:operation.tenantId,operationId:operation.id,result:"PARTIAL",audit:audit("PARTIAL")});}catch{throw new PlatformDenied("REPOINT_COMPLETION_RECONCILIATION_HOLD");}}else throw new PlatformDenied("REPOINT_COMPLETION_RECONCILIATION_HOLD");}
  state.repointResult=registered;state.completed=true;state.terminalHash=canonicalJson({repoint:hash,registered});
 };
 state.finishing=finish();try{await state.finishing;}finally{state.finishing=undefined;}
 return state.repointResult===true;
}

export async function finishDeletedAd(permit:ExecutionPermit,id:string):Promise<boolean>{
 const state=permits.get(permit);if(!state||!state.mutation||!state.mutationClaimed||state.context.tool!=="marketing_delete_paused_ad"||state.context.provider!=="META_MARKETING"||!/^\d{1,32}$/.test(id))throw new PlatformDenied("CLAIMED_DELETED_AD_PERMIT_REQUIRED");const hash=canonicalJson({id});if(state.deletedHash&&state.deletedHash!==hash||!state.deletedHash&&state.terminalHash)throw new PlatformDenied("OPERATION_ALREADY_FINISHED");if(state.completed)return state.deletedResult===true;if(state.finishing){await state.finishing;return state.deletedResult===true;}state.deletedHash=hash;state.terminalHash=canonicalJson({deleted:hash});
 const finish=async()=>{const {snapshot,context:ctx}=state,operation=await state.repo.get("operations",ctx.principal.tenantId,permit.operationId),asset=snapshot.assets.find(a=>a.type==="AD"&&a.id===id),now=Date.now();if(!operation||!asset||asset.deletionClaim?.operationId!==operation.id)throw new PlatformDenied("DELETED_AD_CLAIM_BINDING_REQUIRED");const grants=(await state.repo.list("grants",ctx.principal.tenantId)).filter(g=>g.assetKey===asset.key&&g.clientId===ctx.clientId&&g.revokedAt===null),connections=await Promise.all([...new Set(grants.map(g=>g.connectionId))].map(id=>state.repo.get("connections",ctx.principal.tenantId,id)));if(connections.some(c=>!c))throw new PlatformDenied("DELETED_AD_CONNECTION_SNAPSHOT_REQUIRED");const before=connections as Connection[],expectedRecords=[...(state.readCredentialExpected?[state.readCredentialExpected]:[]),...(state.approvalExpected??[]),{collection:"tenants" as const,id:snapshot.tenant.id,canonical:canonicalJson(snapshot.tenant)},{collection:"members" as const,id:snapshot.member.operatorId,canonical:canonicalJson(snapshot.member)},{collection:"clients" as const,id:snapshot.client.id,canonical:canonicalJson(snapshot.client)},...snapshot.assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...snapshot.grants.filter(g=>!grants.some(row=>row.id===g.id)).map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),...grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),...before.map(c=>({collection:"connections" as const,id:c.id,canonical:canonicalJson(c)})),...ownershipExpectedRecords(snapshot.financialEvidence!),...manualEligibilityExpected(snapshot.manualEligibilityEvidence),...clientBusinessExpected(snapshot.businessOwnerEvidence)];const audit=(result:"SUCCEEDED"|"PARTIAL"):AuditRecord=>({id:operation.id+":result",tenantId:operation.tenantId,clientId:operation.clientId,actorId:operation.actorId,tool:operation.tool,operationId:operation.id,event:result,timestamp:now,assetKeys:[...permit.assetKeys],planHash:operation.planHash,approvalId:operation.approvalId,beforeEvidence:"UNKNOWN",afterSummary:[{field:"status",value:"DELETED"}]});let registered=true;try{await state.repo.finishOperation({tenantId:operation.tenantId,operationId:operation.id,result:"SUCCEEDED",audit:audit("SUCCEEDED"),deleted:{assetBefore:asset,assetAfter:{...asset,revokedAt:now,revision:asset.revision+1},grantsBefore:grants,grantsAfter:grants.map(g=>({...g,revokedAt:now,revision:g.revision+1})),connectionsBefore:before,connectionsAfter:before.map(c=>({...c,assetKeys:c.assetKeys.filter(key=>key!==asset.key),revision:c.revision+1})),expectedRecords,authorizationExpiresAt:state.expiresAt}});}catch(error){if(error instanceof PlatformDenied&&["DELETED_AD_ATOMIC_COMMIT_REJECTED","DELETED_AD_AUTHORIZATION_CHANGED"].includes(error.reason)){registered=false;try{await state.repo.finishOperation({tenantId:operation.tenantId,operationId:operation.id,result:"PARTIAL",audit:audit("PARTIAL")});}catch{throw new PlatformDenied("DELETED_AD_COMPLETION_RECONCILIATION_HOLD");}}else throw new PlatformDenied("DELETED_AD_COMPLETION_RECONCILIATION_HOLD");}state.deletedResult=registered;state.completed=true;state.terminalHash=canonicalJson({deleted:hash,registered});};state.finishing=finish();try{await state.finishing;}finally{state.finishing=undefined;}return state.deletedResult===true;
}

