import {registerSignalDiscoveryTools} from "./signal-discovery-tools.js";
import {APP_PROMOTION_WORKFLOW_TOOLS,registerAppPromotionTools} from "./app-promotion-tools.js";
import {assertClientMetadataCurrent,clientMetadataBase} from "./client-metadata.js";
import {canonicalJson} from "./policy.js";
import {HEALTH_TOOL_NAMES,registerHealthTools} from "./observability.js";
import {productAssetReferences} from "./product-asset-references.js";
import {registerSignalStatusTool} from "./signal-status.js";
import {registerOwnershipTools} from "./ownership-tools.js";
import {registerCompatibilityTools} from "./compatibility-tools.js";
import {registerTargetingLookupTools} from "./targeting-tools.js";
import {registerDiscoveryTools} from "./discovery-tools.js";
import {configuredLocalInbox} from "./operational-runtime.js";
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {resolveOperationContext,getPlatformRepository} from "./runtime.js";
import {listCapabilities,MANUAL_ACTIONS} from "./capabilities.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {PlatformDenied,type OperationContext,type ApprovalRequest} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {requestProductApproval} from "./approvals.js";
import {validateContractParameters} from "./clients.js";
import {resolveAuthorizedAssets} from "./assets.js";
import {assertProductAssetRelationships} from "./product-inputs.js";

export const WORKFLOW_TOOL_NAMES=["meta_discover_signal_assets",...APP_PROMOTION_WORKFLOW_TOOLS,...HEALTH_TOOL_NAMES,"meta_manual_actions","meta_signal_status","meta_capabilities","meta_capability_status","meta_connection_status","meta_permissions_status","meta_assets_overview","meta_audit_presence","meta_prepare_publication","meta_list_prepared_actions","meta_list_events","meta_discover_ad_assets","meta_lookup_ad_targeting","meta_observe_ads_compatibility","meta_observe_account_owner","meta_inspect_billing_configuration"] as const;
const client=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),id=z.string().regex(/^[A-Za-z0-9_:.=$-]{1,200}$/);
const output=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value)}]});
const fail=(error:unknown)=>({...output({status:"HOLD",reason:error instanceof PlatformDenied?error.reason:"WORKFLOW_UNAVAILABLE"}),isError:true});
export async function preparedActionMetadata(repo:PlatformRepository,ctx:OperationContext,r:ApprovalRequest){
  if(r.tenantId!==ctx.principal.tenantId||r.clientId!==ctx.clientId||r.actorId!==ctx.principal.operatorId)throw new PlatformDenied("ACTION_REQUEST_ACCESS_REQUIRED");
  const expected=await clientMetadataBase(repo,ctx);expected.push({collection:"approvalRequests",id:r.id,canonical:canonicalJson(r)});
  let status=r.expiresAt<=Date.now()?"EXPIRED":r.approvedAt===null?"HUMAN_REVIEW_REQUIRED":"APPROVED";
  let operationId:string|null=null;
  if(r.approvalId){
    const approval=await repo.get("approvals",ctx.principal.tenantId,r.approvalId);
    if(!approval||approval.tenantId!==r.tenantId||approval.clientId!==r.clientId||approval.actorId!==r.actorId||approval.planHash!==r.planHash)throw new PlatformDenied("ACTION_APPROVAL_BINDING_REQUIRED");
    expected.push({collection:"approvals",id:approval.id,canonical:canonicalJson(approval)});
    if(approval.consumedAt!==null){operationId=approval.operationId;const operation=operationId?await repo.get("operations",ctx.principal.tenantId,operationId):null;if(!operation||operation.clientId!==r.clientId||operation.actorId!==r.actorId||operation.planHash!==r.planHash)throw new PlatformDenied("ACTION_OPERATION_BINDING_REQUIRED");expected.push({collection:"operations",id:operation.id,canonical:canonicalJson(operation)});status=operation.state;}
  }
  await assertClientMetadataCurrent(repo,{context:ctx,purpose:"ACTION",expected,requestId:r.id});
  if(!operationId&&r.expiresAt<=Date.now())status="EXPIRED";
  return {request_id:r.id,tool:r.tool,status,approval_id:r.approvalId,operation_id:operationId,review_path:`/platform/approvals/${r.id}`,expires_at:r.expiresAt,plan_hash:r.planHash};
}
export async function clientRegistryOverview(repo:PlatformRepository,ctx:OperationContext){
  const expected=await clientMetadataBase(repo,ctx);
  const [assets,allConnections,allGrants]=await Promise.all([repo.list("assets",ctx.principal.tenantId),repo.list("connections",ctx.principal.tenantId),repo.list("grants",ctx.principal.tenantId)]);
  const selected=assets.filter(a=>a.tenantId===ctx.principal.tenantId&&a.clientId===ctx.clientId),keys=new Set(selected.map(a=>a.key)),now=Date.now();
  if([assets,allConnections,allGrants].some(rows=>rows.length>1000))throw new PlatformDenied("CLIENT_METADATA_LIMIT_REQUIRED");
  const connections=allConnections.filter(c=>c.tenantId===ctx.principal.tenantId&&c.operatorId===ctx.principal.operatorId&&c.revokedAt===null&&(c.expiresAt===null||c.expiresAt>now)&&selected.some(a=>c.assetKeys.includes(a.key)&&a.appId===c.appId&&a.provider===c.provider)),grants=allGrants.filter(g=>g.tenantId===ctx.principal.tenantId&&g.clientId===ctx.clientId&&connections.some(c=>c.id===g.connectionId&&selected.some(a=>a.key===g.assetKey&&c.assetKeys.includes(a.key)&&a.appId===c.appId&&a.provider===c.provider)));
  expected.push(...selected.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...connections.map(c=>({collection:"connections" as const,id:c.id,canonical:canonicalJson(c)})),...grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})));
  await assertClientMetadataCurrent(repo,{context:ctx,purpose:"REGISTRY",expected});
  return {client_id:ctx.clientId,checked_at:now,observation:"REGISTERED_EVIDENCE_ONLY",assets:selected.map(a=>({asset_key:a.key,...(a.type==="AD_ACCOUNT"&&a.provider==="META_MARKETING"?{ownership_review_path:`/platform/ownership/${encodeURIComponent(ctx.clientId)}/${encodeURIComponent(a.key)}`} :{}),id:a.id,type:a.type,provider:a.provider,parent_ids:a.parents,revoked:a.revokedAt!==null,verified_at:a.verifiedAt,fresh:now>=a.verifiedAt&&now-a.verifiedAt<=3600000,ownership:a.ownerBusinessId?"RECORDED_REQUIRES_CURRENT_VERIFICATION":"UNVERIFIED",billing:a.billingOwnershipVerified===true?"RECORDED_REQUIRES_CURRENT_VERIFICATION":"UNVERIFIED"})),connections:connections.filter(c=>c.tenantId===ctx.principal.tenantId&&c.operatorId===ctx.principal.operatorId&&c.assetKeys.some(k=>keys.has(k))).map(c=>({id:c.id,provider:c.provider,token_type:c.tokenType,actual_granted_scopes:c.scopes,revoked:c.revokedAt!==null,expired:c.expiresAt!==null&&c.expiresAt<=now,verified_at:c.verifiedAt,asset_grants:grants.filter(g=>g.tenantId===ctx.principal.tenantId&&g.clientId===ctx.clientId&&g.connectionId===c.id&&keys.has(g.assetKey)).map(g=>({asset_id:selected.find(a=>a.key===g.assetKey)!.id,capabilities:g.capabilities,actions:g.actions,tasks:g.tasks,revoked:g.revokedAt!==null,expired:g.expiresAt<=now,verified_at:g.verifiedAt}))}))};
}
export async function preparePublicationSteps(repo:PlatformRepository,ctx:OperationContext,steps:Array<{tool:string;asset_id:string;input:Record<string,unknown>}>){
  const permitted=new Set(["pages_create_feed","pages_create_photos","pages_create_videos","instagram_create_container","instagram_create_reel_container","instagram_create_story_container","instagram_create_carousel_item","instagram_create_carousel_container","instagram_login_create_container","instagram_login_create_reel_container","instagram_login_create_story_container","instagram_login_create_carousel_item","instagram_login_create_carousel_container","instagram_publish_container","instagram_login_publish","threads_create_container","threads_publish_container"]);
  if(steps.length<1||steps.length>5||new Set(steps.map(s=>`${s.tool}:${s.asset_id}`)).size!==steps.length)throw new PlatformDenied("PUBLICATION_STEPS_INVALID");
  for(const step of steps){
    const contract=PRODUCT_CONTRACTS.find(c=>c.tool===step.tool);
    if(!permitted.has(step.tool)||!contract?.verified||contract.operationClasses.length!==1||contract.operationClasses[0]!=="WRITE_CONTENT")throw new PlatformDenied("PUBLICATION_CONTRACT_NOT_READY");
    validateContractParameters(contract,step.input);
    const refs=productAssetReferences(contract,step.asset_id,step.input);
    const assets=await resolveAuthorizedAssets(repo,{...ctx,provider:contract.provider,tool:contract.tool},refs,Date.now(),300000);
    assertProductAssetRelationships(contract,step.asset_id,step.input,assets);
  }
  const prepared:Array<{tool:string;asset_id:string;request_id?:string;review_path?:string;status:string}>=[];
  for(const step of steps){
    const contract=PRODUCT_CONTRACTS.find(c=>c.tool===step.tool)!;
    try{const request=await requestProductApproval(repo,{...ctx,provider:contract.provider,tool:contract.tool},contract,step.asset_id,step.input);prepared.push({tool:step.tool,asset_id:step.asset_id,request_id:request.id,review_path:`/platform/approvals/${request.id}`,status:"HUMAN_REVIEW_REQUIRED"});}
    catch{prepared.push({tool:step.tool,asset_id:step.asset_id,status:"HOLD"});return {status:"PARTIAL_PREPARATION",provider_writes:0,steps:prepared,recovery:"List prepared actions before preparing again. Each step needs its own human approval; no step has executed."};}
  }
  return {status:"HUMAN_REVIEW_REQUIRED",provider_writes:0,steps:prepared,execution:"Execute individually approved steps; stop and reconcile uncertainty before continuing. Draft creation does not publish."};
}
export function registerWorkflowTools(server:McpServer):void{
  registerAppPromotionTools(server);
  registerSignalDiscoveryTools(server);
  registerHealthTools(server);
  server.registerTool("meta_manual_actions",{description:"Read the human Meta Developer Dashboard action register for one authorized client. No dashboard mutation, grant, approval or app-publication claim.",inputSchema:{client_id:client},annotations:{readOnlyHint:true}},async({client_id})=>{try{await resolveOperationContext(client_id,"meta_manual_actions","META_BUSINESS");return output(MANUAL_ACTIONS);}catch(error){return fail(error);}});
  registerSignalStatusTool(server);
  registerDiscoveryTools(server);
  registerTargetingLookupTools(server);
  registerCompatibilityTools(server);
  registerOwnershipTools(server);
  for(const name of ["meta_capabilities","meta_connection_status","meta_permissions_status","meta_assets_overview","meta_audit_presence"] as const){
    server.registerTool(name,{description:name==="meta_audit_presence"?"Audit registered client assets, actual recorded grants and capability gates. Evidence inventory only; does not claim live content or inbox inspection.":"Read one authorized client's registered capability, connection, permission or asset evidence. No credentials or provider mutations.",inputSchema:{client_id:client},annotations:{readOnlyHint:true}},async({client_id})=>{
      try{const ctx=await resolveOperationContext(client_id,name,"META_BUSINESS");if(name==="meta_capabilities")return output(await listCapabilities(ctx));const overview=await clientRegistryOverview(getPlatformRepository(),ctx);if(name==="meta_assets_overview")return output({client_id,assets:overview.assets});if(name==="meta_connection_status"||name==="meta_permissions_status")return output({client_id,connections:overview.connections});return output({...overview,capabilities:await listCapabilities(ctx),live_provider_audit:"NOT_PERFORMED",recommended_next:"Select AVAILABLE product READ tools to inspect current content and performance; recorded ownership does not establish client billing."});}catch(error){return fail(error);}
    });
  }
  server.registerTool("meta_list_events",{description:"Read this client's locally delivered verified webhook metadata with signed pagination. No message bodies, lead answers, external CRM delivery or unanswered-message claims.",inputSchema:{client_id:client,product:z.enum(["leads","pages","instagram","messenger","whatsapp"]).optional(),asset_id:z.string().regex(/^[A-Za-z0-9_:.=$-]{1,200}$/).optional(),since:z.number().int().positive(),until:z.number().int().positive(),limit:z.number().int().min(1).max(100).default(25),cursor:z.string().max(2048).optional()},annotations:{readOnlyHint:true}},async({client_id,product,asset_id,since,until,limit,cursor})=>{try{const ctx=await resolveOperationContext(client_id,"meta_list_events","META_BUSINESS");const result=await configuredLocalInbox().list({tenantId:ctx.principal.tenantId,clientId:client_id},{product,assetId:asset_id,since,until,limit},cursor);const current=await resolveOperationContext(client_id,"meta_list_events","META_BUSINESS");if(current.principal.tenantId!==ctx.principal.tenantId||current.principal.operatorId!==ctx.principal.operatorId)throw new PlatformDenied("INBOX_SESSION_CHANGED");return output(result);}catch(error){return fail(error);}});
  server.registerTool("meta_capability_status",{description:"Read one exact capability ID for an authorized client, with its permission and policy gates.",inputSchema:{client_id:client,capability_id:z.string().min(1).max(160)},annotations:{readOnlyHint:true}},async({client_id,capability_id})=>{try{const ctx=await resolveOperationContext(client_id,"meta_capability_status","META_BUSINESS"),report=(await listCapabilities(ctx)).find(c=>c.id===capability_id);if(!report)throw new PlatformDenied("UNKNOWN_CAPABILITY");return output(report);}catch(error){return fail(error);}});
  server.registerTool("meta_list_prepared_actions",{description:"Recover this actor's prepared action references and consumed-operation results for one client. Returns no encrypted review contents and cannot approve or execute.",inputSchema:{client_id:client},annotations:{readOnlyHint:true}},async({client_id})=>{try{const ctx=await resolveOperationContext(client_id,"meta_list_prepared_actions","META_BUSINESS"),repo=getPlatformRepository(),requests=await repo.list("approvalRequests",ctx.principal.tenantId);return output(await Promise.all(requests.filter(r=>r.tenantId===ctx.principal.tenantId&&r.clientId===client_id&&r.actorId===ctx.principal.operatorId).map(r=>preparedActionMetadata(repo,ctx,r))));}catch(error){return fail(error);}});
  server.registerTool("meta_prepare_publication",{description:"Prepare up to five product-specific publication steps for separate human review. Creates encrypted proposals only; never publishes, approves, chains or retries provider writes.",inputSchema:{client_id:client,steps:z.array(z.object({tool:z.string().max(128),asset_id:id,input:z.record(z.string(),z.unknown())}).strict()).min(1).max(5)},annotations:{readOnlyHint:false}},async({client_id,steps})=>{try{const ctx=await resolveOperationContext(client_id,"meta_prepare_publication","META_BUSINESS");return output(await preparePublicationSteps(getPlatformRepository(),ctx,steps));}catch(error){return fail(error);}});
}
