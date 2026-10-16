import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PRODUCT_CONTRACTS } from "./products/contracts.js";
import { getPlatformRepository, platformWritesEnabled, resolveOperationContext } from "./runtime.js";
import { listCapabilities, MANUAL_ACTIONS } from "./capabilities.js";
import { resolveAuthorizedAssets } from "./assets.js";
import { selectConnection } from "./connections.js";
import { evaluatePolicy } from "./policy.js";
import { FirstPartySignalDispatcher } from "./signals-dispatch.js";
import { firstPartySignalRuntime } from "./signals-runtime.js";
import { authorizeOperation, finishOperation, runWithExecutionPermit } from "./execution.js";
import { contractPlanParameters, signalPlanParameters, assertContractEligibility, validateContractParameters, MetaGraphClient, ProductApiError } from "./clients.js";
import { PlatformDenied, type OperationPlan } from "./models.js";
import { LEGACY_CORE_WRITE_TOOLS } from "./legacy-write.js";
import { requestLegacyApproval, requestProductApproval } from "./approvals.js";

const clientId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const result = (value: unknown) => ({content:[{type:"text" as const,text:JSON.stringify(value)}]});
// Provider responses and internal errors are never reflected without a reviewed projection.
function failure(error: unknown) {
  const reason = error instanceof PlatformDenied ? error.message : error instanceof ProductApiError ? error.message : "PLATFORM_OPERATION_FAILED";
  return {...result({status:"HOLD",reason}),isError:true};
}

export function registerPlatformTools(server: McpServer, existingNames: ReadonlySet<string> = new Set()): void {
  server.registerTool("meta_prepare_action",{description:"Prepare one verified content, messaging or minimal paused Ads action for human browser review. Stores an encrypted plan and never executes the action or grants its own approval.",inputSchema:{client_id:clientId,tool:z.string().max(128),asset_id:z.string().regex(/^[A-Za-z0-9_:-]{1,200}$/),input:z.record(z.string(),z.unknown())},annotations:{readOnlyHint:false}},async ({client_id,tool,asset_id,input})=>{
    try {const contract=PRODUCT_CONTRACTS.find(c=>c.tool===tool);const legacy=LEGACY_CORE_WRITE_TOOLS.includes(tool);if(!legacy && !contract?.verified)throw new PlatformDenied("VERIFIED_APPROVAL_CONTRACT_REQUIRED");if(legacy && (typeof input.account_id!=="string" || input.account_id.replace(/^act_/, "")!==asset_id.replace(/^act_/, "")))throw new PlatformDenied("APPROVAL_ACCOUNT_INPUT_MISMATCH");const ctx=await resolveOperationContext(client_id,tool,legacy?"META_MARKETING":contract!.provider),request=legacy?await requestLegacyApproval(getPlatformRepository(),ctx,input):await requestProductApproval(getPlatformRepository(),ctx,contract!,asset_id,input);return result({status:"HUMAN_REVIEW_REQUIRED",request_id:request.id,review_path:`/platform/approvals/${request.id}`,expires_at:request.expiresAt,plan_hash:request.planHash});}catch(error){return failure(error);}
  });
  server.registerTool("meta_get_action_status",{description:"Read the authenticated actor's prepared action status and reference after human approval. Cannot approve an action.",inputSchema:{client_id:clientId,request_id:z.string().uuid()},annotations:{readOnlyHint:true}},async ({client_id,request_id})=>{
    try {const ctx=await resolveOperationContext(client_id,"meta_get_action_status","META_BUSINESS"),request=await getPlatformRepository().get("approvalRequests",ctx.principal.tenantId,request_id);if(!request || request.tenantId!==ctx.principal.tenantId || request.clientId!==client_id || request.actorId!==ctx.principal.operatorId)throw new PlatformDenied("ACTION_REQUEST_ACCESS_REQUIRED");return result({request_id,status:request.expiresAt<=Date.now()?"EXPIRED":request.approvedAt===null?"HUMAN_REVIEW_REQUIRED":"APPROVED",approval_id:request.approvalId,expires_at:request.expiresAt,plan_hash:request.planHash});}catch(error){return failure(error);}
  });
  server.registerTool("meta_admin_get_status",{description:"Show verified implementation boundaries and manual app-dashboard gates for this client. Does not infer app approval from account access.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try {await resolveOperationContext(client_id,"meta_admin_get_status","META_BUSINESS");return result({app_review:"UNVERIFIED",business_verification:"UNVERIFIED",tech_provider:"UNVERIFIED",marketing_access_tier:"UNVERIFIED",publication:"DASHBOARD_ONLY",login_consent:"USER_CONSENT_REQUIRED",app_promotion:{status:"UNVERIFIED",reason:"Existing campaign APIs remain the integration boundary; app/promoted-object eligibility and source ownership require reviewed validation before enabling app-promotion writes."},api_configuration:{status:"UNVERIFIED",reason:"Only endpoint-specific verified subscriptions and app operations may be exposed; no generic developer-dashboard mutation API."},manual_actions:MANUAL_ACTIONS});}catch(error){return failure(error);}
  });
  server.registerTool("meta_list_assets",{description:"List registered assets for one authorized client. Registration alone does not establish current permission or ownership.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try {const ctx=await resolveOperationContext(client_id,"meta_list_assets","META_BUSINESS");const assets=await getPlatformRepository().list("assets",ctx.principal.tenantId);return result(assets.filter(a=>a.tenantId===ctx.principal.tenantId && a.clientId===ctx.clientId).map(a=>({id:a.id,type:a.type,provider:a.provider,parents:a.parents,verified_at:a.verifiedAt,revoked:a.revokedAt!==null,ownership:"UNVERIFIED"})));}catch(error){return failure(error);}
  });
  server.registerTool("meta_list_connections",{description:"List this operator's product connections linked to this client's registered assets. Never returns credentials.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try {const ctx=await resolveOperationContext(client_id,"meta_list_connections","META_BUSINESS"),repo=getPlatformRepository();const assets=await repo.list("assets",ctx.principal.tenantId),keys=new Set(assets.filter(a=>a.tenantId===ctx.principal.tenantId && a.clientId===ctx.clientId).map(a=>a.key));const connections=await repo.list("connections",ctx.principal.tenantId);return result(connections.filter(c=>c.tenantId===ctx.principal.tenantId && c.operatorId===ctx.principal.operatorId && c.assetKeys.some(k=>keys.has(k))).map(c=>({id:c.id,provider:c.provider,token_type:c.tokenType,granted_scopes:c.scopes,expires_at:c.expiresAt,verified_at:c.verifiedAt,revoked:c.revokedAt!==null})));}catch(error){return failure(error);}
  });
  server.registerTool("meta_list_capabilities",{description:"Show client-specific capability gates using the authenticated operator's current grants. Does not change assets.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try { const ctx=await resolveOperationContext(client_id,"meta_list_capabilities","META_BUSINESS"); return result(await listCapabilities(ctx)); } catch(error) {return failure(error);}
  });
  server.registerTool("meta_list_manual_actions",{description:"List dashboard and human-consent requirements for an authorized client.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try {await resolveOperationContext(client_id,"meta_list_manual_actions","META_BUSINESS");return result(MANUAL_ACTIONS);}catch(error){return failure(error);}
  });
  for(const contract of PRODUCT_CONTRACTS) {
    if(existingNames.has(contract.tool)) continue;
    if(contract.product==="oembed" && !contract.verified) continue;
    if(contract.tool==="signals_send_pixel_events"){
      server.registerTool(contract.tool,{description:"Send one verified first-party event from a trusted source to a client-authorized Pixel. References only; no caller events or test-event shortcut. Success means provider acceptance, not business-outcome proof.",inputSchema:{client_id:clientId,asset_id:z.string().regex(/^\d{1,100}$/),source_reference:z.string().min(1).max(200),consent_reference:z.string().min(1).max(200)},annotations:{readOnlyHint:false}},async({client_id,asset_id,source_reference,consent_reference})=>{
        try{
          const ctx=await resolveOperationContext(client_id,contract.tool,contract.provider),repo=getPlatformRepository();
          if(!platformWritesEnabled())throw new PlatformDenied("DISABLED_BY_LUMIN_POLICY");
          const input={source_reference,consent_reference},plan:OperationPlan={parameters:contractPlanParameters(contract,asset_id,input),assets:[{type:"PIXEL",id:asset_id}],classes:[...contract.operationClasses],capability:contract.id,requiredScopes:[...contract.requiredScopes],tokenTypes:[...contract.tokenTypes],...(contract.requiredTasks?{requiredTasks:[...contract.requiredTasks]}:{})};
          const assets=await resolveAuthorizedAssets(repo,ctx,plan.assets,Date.now(),300000),connection=await selectConnection(repo,ctx,plan,assets);
          const tenant=await repo.get("tenants",ctx.principal.tenantId,ctx.principal.tenantId),member=await repo.get("members",ctx.principal.tenantId,ctx.principal.operatorId),client=await repo.get("clients",ctx.principal.tenantId,ctx.clientId),grants=await repo.list("grants",ctx.principal.tenantId);
          if(!tenant||!member||!client)throw new PlatformDenied("PLATFORM_MEMBERSHIP_REQUIRED");
          const decision=evaluatePolicy(ctx,plan,{tenant,member,client,assets,connection,grants},{writesEnabled:platformWritesEnabled()});
          if(decision.decision!=="ALLOW")throw new PlatformDenied(decision.reason);
          assertContractEligibility(contract,connection);
          const deps=firstPartySignalRuntime(),scope={tenantId:ctx.principal.tenantId,clientId:ctx.clientId,datasetId:asset_id};
          const dispatcher=new FirstPartySignalDispatcher(deps.source,deps.store,{send:async(target,event,prepared)=>{
            if(target.tenantId!==scope.tenantId||target.clientId!==scope.clientId||target.datasetId!==scope.datasetId)throw new PlatformDenied("SIGNAL_DISPATCH_SCOPE_MISMATCH");
            const permit=await authorizeOperation(repo,ctx,{...plan,parameters:signalPlanParameters(contract,asset_id,input,event)},{writesEnabled:platformWritesEnabled(),selectedConnectionId:connection.id});
            try{const response=await runWithExecutionPermit(permit,()=>new MetaGraphClient(contract.provider).requestPreparedSignal(contract,asset_id,input,prepared)) as {events_received?:unknown};if(response.events_received!==1)throw new PlatformDenied("SIGNAL_PROVIDER_ACCEPTANCE_UNVERIFIED");await finishOperation(permit,"SUCCEEDED");return {eventsReceived:1};}
            catch(error){try{await finishOperation(permit,"UNKNOWN");}catch{throw new PlatformDenied("SIGNAL_OPERATION_RECONCILIATION_REQUIRED");}throw error;}
          }});
          return result(await dispatcher.dispatch(scope,input));
        }catch(error){return failure(error);}
      });
      continue;
    }
    server.registerTool(contract.tool,{
      description:`${contract.title}. ${contract.verified ? "Requires verified client assets, product connection and eligibility." : "HOLD: current endpoint contract is unverified; execution is blocked."}`,
      inputSchema:{client_id:clientId,asset_id:z.string().regex(/^[A-Za-z0-9_:-]{1,200}$/),input:z.record(z.string(),z.unknown()).default({}),connection_id:z.string().max(128).optional(),approval_id:z.string().max(128).optional()},
      annotations:{readOnlyHint:contract.operationClasses.every(c=>c==="READ"),destructiveHint:contract.operationClasses.includes("DELETE")},
    },async ({client_id,asset_id,input,connection_id,approval_id})=>{
      let permit: Awaited<ReturnType<typeof authorizeOperation>> | undefined;
      try {
        const ctx=await resolveOperationContext(client_id,contract.tool,contract.provider);
        if(!contract.verified) throw new PlatformDenied("ENDPOINT_CONTRACT_UNVERIFIED");
        validateContractParameters(contract,input);
        const assets=[{type:contract.assetType,id:asset_id}];
        for(const [key,type] of Object.entries(contract.assetInputKeys ?? {})) {
          const id=input[key];if(typeof id!=="string")throw new PlatformDenied("REFERENCED_ASSET_REQUIRED");assets.push({type,id});
        }
        const plan:OperationPlan={parameters:contractPlanParameters(contract,asset_id,input),assets,classes:[...contract.operationClasses],capability:contract.id,requiredScopes:[...contract.requiredScopes],tokenTypes:[...contract.tokenTypes],...(contract.requiredTasks?{requiredTasks:[...contract.requiredTasks]}:{}),...(contract.createOrCopy?{createOrCopy:true}:{})};
        permit=await authorizeOperation(getPlatformRepository(),ctx,plan,{writesEnabled:platformWritesEnabled(),approvalId:approval_id,selectedConnectionId:connection_id});
        const output=await runWithExecutionPermit(permit,()=>new MetaGraphClient(contract.provider).request(contract,asset_id,input));
        await finishOperation(permit,"SUCCEEDED");
        return result(output);
      }catch(error){
        if(permit) {
          // Once authorization has created a durable mutation record, an uncertain
          // transport or completion outcome must never be reported as safely retryable.
          try {await finishOperation(permit,"UNKNOWN");}catch{return {...result({status:"HOLD",reason:"DURABLE_COMPLETION_PENDING",operation_id:permit.operationId}),isError:true};}
        }
        return failure(error);
      }
    });
  }
}
