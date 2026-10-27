import {ImageInspectionClient} from "./image-inspection-client.js";
import {IMAGE_INSPECTION_TOOLS} from "./image-inspection-contract.js";
import {assertImageInspectionReadResponseCurrent} from "./execution.js";
import {AppEventTypesClient} from "./app-event-types-client.js";
import {APP_EVENT_TYPES_TOOL} from "./app-event-types-contract.js";
import {assertAppEventTypesReadResponseCurrent} from "./execution.js";
import {VideoInspectionClient} from "./video-inspection-client.js";
import {VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_TOOL} from "./video-inspection-contract.js";
import {assertVideoInspectionReadResponseCurrent} from "./execution.js";
import {CATALOG_CAMPAIGN_TOOL,catalogCampaignEnabled} from "./catalog-campaign-contract.js";
import {readCatalogCampaignDiagnostics} from "./catalog-campaign-client.js";
import {ClientInvoiceMetadataClient} from "./business-invoice-client.js";
import {assertInvoiceMetadataReadResponseCurrent} from "./execution.js";
import {CRM_SIGNAL_TOOL} from "./crm-contract.js";
import {CrmGraphTransport,hasCrmCredentialInspector} from "./crm-client.js";
import {CrmSignalDispatcher} from "./crm-dispatch.js";
import {getCrmRuntime,crmSignalsEnabled} from "./crm-runtime.js";
import {CatalogOperationalClient} from "./catalog-operational-client.js";
import {assertCatalogOperationalReadResponseCurrent} from "./execution.js";
import {PageCommentsReadClient} from "./page-comment-read-client.js";
import {assertPageCommentsReadResponseCurrent} from "./execution.js";
import {MarketingPreviewClient} from "./marketing-preview-client.js";
import {PurchaseConversionClient} from "./purchase-conversion-client.js";
import {LEGACY_ENTITY_UPDATE_TOOLS,mapLegacyEntityUpdate} from "./legacy-entity-update.js";
import {DatasetReadClient} from "./dataset-read-client.js";
import {MarketingStudyClient} from "./marketing-study-client.js";
import {registerTrackingChangeTools} from "./tracking-change-tools.js";
import {MarketingRuleClient} from "./marketing-rule-client.js";
import {MarketingReportClient} from "./marketing-report-client.js";
import {listClientAssetMetadata} from "./client-metadata.js";
import {listConnectionMetadata} from "./connection-metadata.js";
import {registerPausedAdBatchTools} from "./paused-ad-batch-tools.js";
import {loadManualEligibilityEvidence} from "./manual-eligibility.js";
import {WHATSAPP_QR_TOOLS} from "./whatsapp-qr-contracts.js";
import {WhatsAppQrClient} from "./whatsapp-qr-client.js";
import {MarketingAdControlClient} from "./marketing-control-client.js";
import {MARKETING_CONTROL_TOOLS} from "./marketing-control-contracts.js";
import {finishDeletedAd} from "./execution.js";
import {registerResearchTools} from './research-tools.js';
import {AdLibraryClient} from "./ad-library-client.js";
import {recordScopedHealthFailure} from "./health-events.js";
import {MarketingVideoClient} from "./marketing-video-client.js";
import {MarketingAudienceClient} from "./marketing-audience-client.js";
import {MARKETING_AUDIENCE_TOOLS} from "./marketing-audience-contracts.js";
import {MessengerAttachmentClient} from "./messaging-attachment-client.js";
import {verifyProductMessagingWindow} from "./clients.js";
import {MessengerUtilityClient} from "./messenger-utility-client.js";
import {MESSENGER_UTILITY_TOOLS} from "./messenger-utility-contracts.js";
import {messengerUtilityPolicy} from "./messenger-utility-runtime.js";
import {productAssetReferences} from "./product-asset-references.js";
import {MarketingImageClient} from "./marketing-image-client.js";
import {LeadFormClient} from "./lead-form-client.js";
import {WHATSAPP_SEND_TOOLS} from "./whatsapp-send-contracts.js";
import {WhatsAppSendClient} from "./whatsapp-send-client.js";
import {OfflineQualityClient} from "./offline-quality.js";
import {PageVideoClient} from "./page-video-client.js";
import {pageVideoEnabled} from "./video-flags.js";
import {OEMBED_TOOLS} from "./oembed-contracts.js";
import {prepareOEmbedPreview} from "./oembed-preview.js";
import {WhatsAppAnalyticsClient} from "./whatsapp-analytics-client.js";
import {WHATSAPP_ANALYTICS_TOOLS} from "./whatsapp-analytics-contracts.js";
import {ThreadsDiscoveryClient,THREADS_DISCOVERY_TOOLS} from "./threads-discovery.js";
import {InstagramHashtagClient} from "./instagram-hashtag.js";
import {WhatsAppPhoneClient} from "./whatsapp-phone-client.js";
import {WHATSAPP_PHONE_TOOLS} from "./whatsapp-phone-contracts.js";
import {LEGACY_WHATSAPP_WRITE_TOOLS,mapLegacyWhatsAppAction} from "./legacy-whatsapp.js";
import {WhatsAppTemplateClient} from "./whatsapp-template-client.js";
import {WHATSAPP_TEMPLATE_TOOLS} from "./whatsapp-template-contracts.js";
import {WhatsAppSubscriptionClient} from "./whatsapp-subscription-client.js";
import {WHATSAPP_SUBSCRIPTION_TOOLS} from "./whatsapp-subscription-contracts.js";
import {WhatsAppFlowClient} from "./whatsapp-flow-client.js";
import {WHATSAPP_FLOW_TOOLS} from "./whatsapp-flow-contracts.js";
import {applyProductTaskRequirements} from "./product-task-requirements.js";
import {scopedBusinessInventory} from "./business-inventory.js";
import {validCreatedProductId} from "./product-identifiers.js";
import {registerWorkflowTools,preparedActionMetadata} from "./workflow-tools.js";
import {recordProductObservation} from "./product-observations.js";
import {assertProductAssetRelationships} from "./product-inputs.js";
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
import { getExecutionScope, authorizeOperation, revalidateExecutionPermit, finishOperation, finishCreatedAsset, runWithExecutionPermit } from "./execution.js";
import { outcomeAfterFailure } from "./failure-outcome.js";
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
  registerWorkflowTools(server);
  registerResearchTools(server,existingNames);
  registerPausedAdBatchTools(server);
  registerTrackingChangeTools(server);
  for(const tool of OEMBED_TOOLS){if(existingNames.has(tool))continue;const contract=PRODUCT_CONTRACTS.find(c=>c.tool===tool)!;server.registerTool(tool,{description:"Prepare a private frontend-only public post embed preview. Returns an opaque authenticated preview path, never provider HTML, metadata or content URL. Not an analytics or content extraction tool. Default disabled.",inputSchema:{client_id:clientId,url:z.string().max(512),purpose:z.literal("FRONTEND_EMBED")},annotations:{readOnlyHint:true}},async({client_id,url,purpose})=>{try{const ctx=await resolveOperationContext(client_id,tool,contract.provider);return result(await prepareOEmbedPreview(getPlatformRepository(),ctx.principal,client_id,tool,{url,purpose}));}catch(error){return failure(error);}}); }
  server.registerTool("meta_prepare_action",{description:"Prepare one verified content, messaging or minimal paused Ads action for human browser review. Stores an encrypted plan and never executes the action or grants its own approval.",inputSchema:{client_id:clientId,tool:z.string().max(128),asset_id:z.string().regex(/^[A-Za-z0-9_:.=$-]{1,200}$/),input:z.record(z.string(),z.unknown())},annotations:{readOnlyHint:false}},async ({client_id,tool,asset_id,input})=>{
    try {if(LEGACY_ENTITY_UPDATE_TOOLS.includes(tool)){if(["client_id","tenant_id","approval_id","connection_id"].some(key=>key in input))throw new PlatformDenied("ENTITY_UPDATE_APPROVAL_CONTEXT_FORBIDDEN");const mapped=mapLegacyEntityUpdate({...input,client_id});if(mapped.assetId!==asset_id)throw new PlatformDenied("ENTITY_UPDATE_APPROVAL_TARGET_MISMATCH");tool=mapped.tool;input=mapped.input;}if(LEGACY_WHATSAPP_WRITE_TOOLS.includes(tool)){if(["client_id","approval_id","connection_id"].some(key=>key in input))throw new PlatformDenied("WHATSAPP_APPROVAL_CONTEXT_INPUT_FORBIDDEN");const mapped=mapLegacyWhatsAppAction(tool,{...input,client_id});if(mapped.assetId!==asset_id)throw new PlatformDenied("WHATSAPP_APPROVAL_TARGET_MISMATCH");if(mapped.expectedMessagingAccountId){const ctx=await resolveOperationContext(client_id,mapped.tool,"META_WHATSAPP"),assets=await resolveAuthorizedAssets(getPlatformRepository(),ctx,[{type:mapped.tool.includes("template")?"TEMPLATE":"FLOW",id:mapped.assetId}],Date.now(),300000);if(!assets.some(a=>a.id===mapped.assetId&&a.parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===mapped.expectedMessagingAccountId)))throw new PlatformDenied("WHATSAPP_LEGACY_EXACT_PARENT_REQUIRED");}tool=mapped.tool;asset_id=mapped.assetId;input=mapped.input;}const contract=PRODUCT_CONTRACTS.find(c=>c.tool===tool);const legacy=LEGACY_CORE_WRITE_TOOLS.includes(tool);if(!legacy && !contract?.verified)throw new PlatformDenied("VERIFIED_APPROVAL_CONTRACT_REQUIRED");if(legacy){const targetKey=({ads_update_campaign:"campaign_id",ads_update_ad_set:"ad_set_id",ads_update_ad:"ad_id",ads_update_ad_creative:"creative_id"} as Record<string,string>)[tool]??"account_id";if(typeof input[targetKey]!=="string"||(input[targetKey] as string).replace(/^act_/, "")!==asset_id.replace(/^act_/, ""))throw new PlatformDenied("APPROVAL_TARGET_INPUT_MISMATCH");}const ctx=await resolveOperationContext(client_id,tool,legacy?"META_MARKETING":contract!.provider),request=legacy?await requestLegacyApproval(getPlatformRepository(),ctx,input):await requestProductApproval(getPlatformRepository(),ctx,contract!,asset_id,input);return result({status:"HUMAN_REVIEW_REQUIRED",request_id:request.id,review_path:`/platform/approvals/${request.id}`,expires_at:request.expiresAt,plan_hash:request.planHash});}catch(error){return failure(error);}
  });
  server.registerTool("meta_get_action_status",{description:"Read the authenticated actor's prepared action status and reference after human approval. Cannot approve an action.",inputSchema:{client_id:clientId,request_id:z.string().uuid()},annotations:{readOnlyHint:true}},async ({client_id,request_id})=>{
    try {const ctx=await resolveOperationContext(client_id,"meta_get_action_status","META_BUSINESS"),request=await getPlatformRepository().get("approvalRequests",ctx.principal.tenantId,request_id);if(!request || request.tenantId!==ctx.principal.tenantId || request.clientId!==client_id || request.actorId!==ctx.principal.operatorId)throw new PlatformDenied("ACTION_REQUEST_ACCESS_REQUIRED");return result(await preparedActionMetadata(getPlatformRepository(),ctx,request));}catch(error){return failure(error);}
  });
  server.registerTool("meta_admin_get_status",{description:"Show verified implementation boundaries and manual app-dashboard gates for this client. Does not infer app approval from account access.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try {await resolveOperationContext(client_id,"meta_admin_get_status","META_BUSINESS");return result({app_review:"UNVERIFIED",business_verification:"UNVERIFIED",tech_provider:"UNVERIFIED",marketing_access_tier:"UNVERIFIED",publication:"DASHBOARD_ONLY",login_consent:"USER_CONSENT_REQUIRED",app_promotion:{status:process.env.LUMIN_MARKETING_APP_PROMOTION_ENABLED==="true"?"EXTERNAL_ELIGIBILITY_UNVERIFIED":"DISABLED_BY_LUMIN_POLICY",engineering:"BOUNDED_APP_INSTALLS_WITH_PROTECTED_HUMAN_ENROLLMENT",reason:"Requires exact deployment-owned app/store/account/Page binding, product-specific OAuth and current human access/financial review. Typed creation remains paused; live app-event eligibility and delivery are not established."},api_configuration:{status:"UNVERIFIED",reason:"Only endpoint-specific verified subscriptions and app operations may be exposed; no generic developer-dashboard mutation API."},manual_actions:MANUAL_ACTIONS});}catch(error){return failure(error);}
  });
  server.registerTool("meta_list_assets",{description:"List registered assets for one authorized client. Registration alone does not establish current permission or ownership.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try {const ctx=await resolveOperationContext(client_id,"meta_list_assets","META_BUSINESS");return result(await listClientAssetMetadata(getPlatformRepository(),ctx));}catch(error){return failure(error);}
  });
  server.registerTool("meta_list_connections",{description:"List this operator's product connections linked to this client's registered assets. Never returns credentials.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try {const ctx=await resolveOperationContext(client_id,"meta_list_connections","META_BUSINESS");return result(await listConnectionMetadata(getPlatformRepository(),ctx));}catch(error){return failure(error);}
  });
  server.registerTool("meta_list_capabilities",{description:"Show client-specific capability gates using the authenticated operator's current grants. Does not change assets.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try { const ctx=await resolveOperationContext(client_id,"meta_list_capabilities","META_BUSINESS"); return result(await listCapabilities(ctx)); } catch(error) {return failure(error);}
  });
  server.registerTool("meta_list_manual_actions",{description:"List dashboard and human-consent requirements for an authorized client.",inputSchema:{client_id:clientId},annotations:{readOnlyHint:true}},async ({client_id})=>{
    try {await resolveOperationContext(client_id,"meta_list_manual_actions","META_BUSINESS");return result(MANUAL_ACTIONS);}catch(error){return failure(error);}
  });
  for(const contract of PRODUCT_CONTRACTS) {
    if(existingNames.has(contract.tool)) continue;
    if(contract.product==="oembed"||contract.authMode) continue;
    if(contract.tool===CATALOG_CAMPAIGN_TOOL){server.registerTool(contract.tool,{description:contract.title+". Two independently authorized client credentials and registered roots only; observes current catalog link and optional Advantage state, never eligibility, delivery or exhaustive inventory.",inputSchema:{client_id:clientId,asset_id:z.string().regex(/^[1-9]\d{0,31}$/),input:z.object({catalog_id:z.string().regex(/^[1-9]\d{0,31}$/)}).strict(),connection_id:z.string().min(1).max(128).optional(),catalog_connection_id:z.string().min(1).max(128).optional()},annotations:{readOnlyHint:true}},async({client_id,asset_id,input,connection_id,catalog_connection_id})=>{try{if(!catalogCampaignEnabled())throw new PlatformDenied("CATALOG_CAMPAIGN_DISABLED");const context=await resolveOperationContext(client_id,contract.tool,contract.provider);return result(await readCatalogCampaignDiagnostics(getPlatformRepository(),context,{ad_set_id:asset_id,catalog_id:input.catalog_id,...(connection_id?{marketing_connection_id:connection_id}:{}),...(catalog_connection_id?{catalog_connection_id}:{})}));}catch(error){return failure(error);}});continue;}
    if(contract.tool===CRM_SIGNAL_TOOL){
      server.registerTool(contract.tool,{description:"Send one signed, consented Instant Form CRM stage using references only. Requires a reviewed compatible CRM credential and immutable client funnel. Provider acceptance does not prove delivery or optimization.",inputSchema:{client_id:clientId,asset_id:z.string().regex(/^[1-9]\d{0,31}$/),connection_id:z.string().min(1).max(128),source_reference:z.string().min(1).max(200),consent_reference:z.string().min(1).max(200),approval_id:z.string().min(1).max(128)},annotations:{readOnlyHint:false}},async({client_id,asset_id,connection_id,source_reference,consent_reference,approval_id})=>{
        let permit:Awaited<ReturnType<typeof authorizeOperation>>|undefined;
        try{const ctx=await resolveOperationContext(client_id,contract.tool,contract.provider),repo=getPlatformRepository();if(!platformWritesEnabled()||!crmSignalsEnabled())throw new PlatformDenied("DISABLED_BY_LUMIN_POLICY");if(!hasCrmCredentialInspector())throw new PlatformDenied("CRM_REVIEWED_CREDENTIAL_INSPECTOR_REQUIRED");const input={source_reference,consent_reference},plan:OperationPlan={parameters:contractPlanParameters(contract,asset_id,input),assets:[{type:"PIXEL",id:asset_id}],classes:[...contract.operationClasses],capability:contract.id,requiredScopes:[...contract.requiredScopes],tokenTypes:[...contract.tokenTypes]};permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:platformWritesEnabled(),selectedConnectionId:connection_id,approvalId:approval_id});const activePermit=permit;
          const output=await runWithExecutionPermit(activePermit,async()=>{const scope={tenantId:ctx.principal.tenantId,clientId:ctx.clientId,appId:getExecutionScope().snapshot.connection.appId,pixelId:asset_id},entry=getCrmRuntime().select(scope,connection_id);return new CrmSignalDispatcher(entry.source,entry.journal,new CrmGraphTransport(input),entry.key).dispatch(scope,entry.profile.funnel,input);});await finishOperation(activePermit,"SUCCEEDED");return result(output);
        }catch(error){if(permit)try{await finishOperation(permit,outcomeAfterFailure(permit,error));}catch{return failure(new PlatformDenied("CRM_OPERATION_RECONCILIATION_REQUIRED"));}return failure(error);}
      });continue;
    }
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
          assertContractEligibility(contract,connection,Date.now(),{clientId:ctx.clientId,evidence:await loadManualEligibilityEvidence(repo,ctx,connection,Object.keys(contract.eligibilityPolicies??{}))});
          const deps=firstPartySignalRuntime(),scope={tenantId:ctx.principal.tenantId,clientId:ctx.clientId,datasetId:asset_id};
          const dispatcher=new FirstPartySignalDispatcher(deps.source,deps.store,{send:async(target,event,prepared)=>{
            if(target.tenantId!==scope.tenantId||target.clientId!==scope.clientId||target.datasetId!==scope.datasetId)throw new PlatformDenied("SIGNAL_DISPATCH_SCOPE_MISMATCH");
            const permit=await authorizeOperation(repo,ctx,{...plan,parameters:signalPlanParameters(contract,asset_id,input,event)},{writesEnabled:platformWritesEnabled(),selectedConnectionId:connection.id});
            try{const response=await runWithExecutionPermit(permit,()=>new MetaGraphClient(contract.provider).requestPreparedSignal(contract,asset_id,input,prepared)) as {events_received?:unknown};if(response.events_received!==1)throw new PlatformDenied("SIGNAL_PROVIDER_ACCEPTANCE_UNVERIFIED");await finishOperation(permit,"SUCCEEDED");return {eventsReceived:1};}
            catch(error){try{await finishOperation(permit,outcomeAfterFailure(permit,error));}catch{throw new PlatformDenied("SIGNAL_OPERATION_RECONCILIATION_REQUIRED");}throw error;}
          }});
          return result(await dispatcher.dispatch(scope,input));
        }catch(error){return failure(error);}
      });
      continue;
    }
    if([VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_TOOL].includes(contract.tool)){server.registerTool(contract.tool,{description:"Inspect actual private frames from one registered client advertising video. Returns bounded sampled JPEGs and measured media metadata after current authorization. Default disabled; no transcription or semantic analysis.",inputSchema:{client_id:clientId,asset_id:z.string().regex(/^[1-9]\d{0,31}$/),connection_id:z.string().min(1).max(128).optional(),input:contract.tool===CREATIVE_VIDEO_INSPECTION_TOOL?z.object({video_id:z.string().regex(/^[1-9]\d{0,31}$/),frame_count:z.number().int().min(1).max(4).optional()}).strict():z.object({frame_count:z.number().int().min(1).max(4).optional()}).strict().default({})},annotations:{readOnlyHint:true,destructiveHint:false}},async args=>executePlatformProductAction(contract.tool,args));continue;}
    server.registerTool(contract.tool,{
      description:`${contract.title}. ${contract.verified ? "Requires verified client assets, product connection and eligibility." : "HOLD: current endpoint contract is unverified; execution is blocked."}`,
      inputSchema:{client_id:clientId,asset_id:z.string().regex(/^[A-Za-z0-9_:.=$-]{1,200}$/),input:z.record(z.string(),z.unknown()).default({}),connection_id:z.string().max(128).optional(),approval_id:z.string().max(128).optional()},
      annotations:{readOnlyHint:contract.operationClasses.every(c=>c==="READ"),destructiveHint:contract.operationClasses.includes("DELETE")},
    },async args=>executePlatformProductAction(contract.tool,args));
  }
}
/** Shared exact product executor for native and reviewed legacy wrappers.
 * First-party signals keep their separate source-consent dispatcher. */
export async function executePlatformProductAction(tool:string,args:{client_id:string;asset_id:string;input:Record<string,unknown>;connection_id?:string;approval_id?:string}){
 const parsed=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),asset_id:z.string().regex(/^[A-Za-z0-9_:.=$-]{1,200}$/),input:z.record(z.string(),z.unknown()),connection_id:z.string().min(1).max(128).optional(),approval_id:z.string().min(1).max(128).optional()}).strict().safeParse(args);
 const contract=PRODUCT_CONTRACTS.find(c=>c.tool===tool);
 if(!parsed.success||!contract||contract.tool===CATALOG_CAMPAIGN_TOOL||contract.product==="signals"&&!["signals_get_offline_quality","signals_get_dataset"].includes(contract.tool)||contract.product==="oembed")return failure(new PlatformDenied("EXACT_PLATFORM_PRODUCT_ACTION_REQUIRED"));
 const {client_id,asset_id,input,connection_id,approval_id}=parsed.data;
      let permit: Awaited<ReturnType<typeof authorizeOperation>> | undefined;
      let resolvedContext:Awaited<ReturnType<typeof resolveOperationContext>>|undefined;
      let executionConnectionId=connection_id;
      try {
        const ctx=await resolveOperationContext(client_id,contract.tool,contract.provider);resolvedContext=ctx;
        if(!contract.verified) throw new PlatformDenied("ENDPOINT_CONTRACT_UNVERIFIED");
        if(contract.tool==="pages_create_videos"&&!pageVideoEnabled())throw new PlatformDenied("PAGE_VIDEO_DISABLED_BY_DEPLOYMENT");
        validateContractParameters(contract,input);
        const assets=productAssetReferences(contract,asset_id,input);
        if(contract.tool==="pages_list_comments"){
          const repo=getPlatformRepository(),now=Date.now(),base=await resolveAuthorizedAssets(repo,ctx,[{type:"POST",id:asset_id}],now,3600000),post=base.filter(a=>a.type==="POST"&&a.id===asset_id);if(post.length!==1)throw new PlatformDenied("PAGE_COMMENTS_EXACT_POST_REQUIRED");
          const basePlan:OperationPlan={parameters:contractPlanParameters(contract,asset_id,input),assets:[{type:"POST",id:asset_id}],classes:["READ"],capability:contract.id,requiredScopes:[...contract.requiredScopes],tokenTypes:[...contract.tokenTypes]};applyProductTaskRequirements(basePlan,contract,base);const selected=await selectConnection(repo,ctx,basePlan,base,now,connection_id);executionConnectionId=selected.id;
          const rows=repo.listClientHealthRecords?await repo.listClientHealthRecords("assets",ctx.principal.tenantId,ctx.clientId):await repo.list("assets",ctx.principal.tenantId),grants=repo.listClientHealthRecords?await repo.listClientHealthRecords("grants",ctx.principal.tenantId,ctx.clientId):await repo.list("grants",ctx.principal.tenantId);if(rows.length>1000||grants.length>1000)throw new PlatformDenied("PAGE_COMMENTS_REGISTRY_BOUND_REQUIRED");
          const children=rows.filter(a=>a.tenantId===ctx.principal.tenantId&&a.clientId===ctx.clientId&&a.provider===contract.provider&&a.appId===post[0].appId&&a.type==="COMMENT"&&a.revokedAt===null&&a.verifiedAt>0&&a.verifiedAt<=now&&now-a.verifiedAt<=3600000&&selected.assetKeys.includes(a.key)&&a.parents.some(p=>p.type==="POST"&&p.id===asset_id)&&grants.some(g=>g.assetKey===a.key&&g.connectionId===selected.id&&g.tenantId===ctx.principal.tenantId&&g.clientId===ctx.clientId&&g.revokedAt===null&&g.verifiedAt>0&&g.verifiedAt<=now&&now-g.verifiedAt<=3600000&&g.expiresAt>now&&g.actions.includes("READ")&&g.capabilities.includes(contract.id)));if(children.length>100)throw new PlatformDenied("PAGE_COMMENTS_REGISTERED_CHILD_BOUND_REQUIRED");assets.push(...children.map(a=>({type:a.type,id:a.id})));
        }
        const plan:OperationPlan={parameters:contractPlanParameters(contract,asset_id,input),assets,classes:[...contract.operationClasses],capability:contract.id,requiredScopes:[...contract.requiredScopes],tokenTypes:[...contract.tokenTypes],...(contract.requiredTasks?{requiredTasks:[...contract.requiredTasks]}:{}),...(contract.createOrCopy?{createOrCopy:true}:{})};
        const authorizedAssets=await resolveAuthorizedAssets(getPlatformRepository(),ctx,assets,Date.now(),contract.operationClasses.some(c=>c!=="READ")?300000:3600000);
        applyProductTaskRequirements(plan,contract,authorizedAssets);
        assertProductAssetRelationships(contract,asset_id,input,authorizedAssets);
        permit=await authorizeOperation(getPlatformRepository(),ctx,plan,{writesEnabled:platformWritesEnabled(),approvalId:approval_id,selectedConnectionId:executionConnectionId});
        const output=await runWithExecutionPermit(permit,async()=>{let response=IMAGE_INSPECTION_TOOLS.includes(contract.tool)?await new ImageInspectionClient().request(contract,asset_id,input):contract.tool===APP_EVENT_TYPES_TOOL?await new AppEventTypesClient().request(contract,asset_id,input):[VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_TOOL].includes(contract.tool)?await new VideoInspectionClient().request(contract,asset_id,input):contract.tool==="marketing_list_client_invoice_metadata"?await new ClientInvoiceMetadataClient().request(contract,asset_id,input):["catalog_get_feed_status","catalog_get_item_diagnostics"].includes(contract.tool)?await new CatalogOperationalClient().request(contract,asset_id,input):contract.tool==="pages_list_comments"?await new PageCommentsReadClient().request(contract,asset_id,input):contract.tool==="marketing_get_ad_preview"?await new MarketingPreviewClient().request(contract,asset_id,input):contract.tool==="marketing_create_purchase_conversion"?await new PurchaseConversionClient().request(contract,asset_id,input):contract.tool==="signals_get_dataset"?await new DatasetReadClient().request(contract,asset_id,input):contract.tool==="marketing_create_classic_split_study"?await new MarketingStudyClient().request(contract,asset_id,input):contract.tool==="marketing_create_disabled_pause_rule"?await new MarketingRuleClient().request(contract,asset_id,input):contract.tool==="marketing_create_async_report"?await new MarketingReportClient().request(contract,asset_id,input):contract.tool==="marketing_search_ad_library"?await new AdLibraryClient().request(contract,asset_id,input):["messenger_send_video","messenger_send_audio","messenger_send_file"].includes(contract.tool)?await new MessengerAttachmentClient({repository:getPlatformRepository(),verifyWindow:(assetId,recipient)=>verifyProductMessagingWindow("META_MESSENGER",assetId,recipient)}).request(contract,asset_id,input):MESSENGER_UTILITY_TOOLS.includes(contract.tool)?await new MessengerUtilityClient({policy:messengerUtilityPolicy()}).request(contract,asset_id,input):MARKETING_CONTROL_TOOLS.includes(contract.tool as typeof MARKETING_CONTROL_TOOLS[number])?await new MarketingAdControlClient({repository:getPlatformRepository()}).request(contract,asset_id,input):contract.tool==="marketing_upload_video"?await new MarketingVideoClient({repository:getPlatformRepository()}).request(contract,asset_id,input):MARKETING_AUDIENCE_TOOLS.includes(contract.tool as typeof MARKETING_AUDIENCE_TOOLS[number])?await new MarketingAudienceClient().request(contract,asset_id,input):contract.tool==="marketing_upload_image"?await new MarketingImageClient({repository:getPlatformRepository()}).request(contract,asset_id,input):contract.tool==="leads_create_form"?await new LeadFormClient().request(contract,asset_id,input):WHATSAPP_SEND_TOOLS.includes(contract.tool)?await new WhatsAppSendClient({repository:getPlatformRepository(),getAppSecret:async appId=>{if(process.env.META_APP_ID!==appId||!process.env.META_APP_SECRET)throw new PlatformDenied("WHATSAPP_SEND_APP_SECRET_BINDING_REQUIRED");return process.env.META_APP_SECRET;}}).request(contract,asset_id,input):contract.tool==="signals_get_offline_quality"?await new OfflineQualityClient().request(contract,asset_id,input):["pages_create_videos","pages_get_video_status"].includes(contract.tool)?await new PageVideoClient().request(contract,asset_id,input):WHATSAPP_ANALYTICS_TOOLS.includes(contract.tool)?await new WhatsAppAnalyticsClient({repository:getPlatformRepository(),getAppSecret:async appId=>{if(process.env.META_APP_ID!==appId||!process.env.META_APP_SECRET)throw new PlatformDenied("WHATSAPP_ANALYTICS_APP_SECRET_BINDING_REQUIRED");return process.env.META_APP_SECRET;}}).request(contract,asset_id,input):THREADS_DISCOVERY_TOOLS.includes(contract.tool)?await new ThreadsDiscoveryClient().request(contract,asset_id,input):contract.tool==="instagram_hashtag_search"?await new InstagramHashtagClient(getPlatformRepository()).request(contract,asset_id,input):WHATSAPP_QR_TOOLS.includes(contract.tool)?await new WhatsAppQrClient({repository:getPlatformRepository(),getAppSecret:async appId=>{if(process.env.META_APP_ID!==appId||!process.env.META_APP_SECRET)throw new PlatformDenied("WHATSAPP_QR_APP_SECRET_BINDING_REQUIRED");return process.env.META_APP_SECRET;}}).request(contract,asset_id,input):WHATSAPP_PHONE_TOOLS.includes(contract.tool)?await new WhatsAppPhoneClient({repository:getPlatformRepository(),getAppSecret:async appId=>{if(process.env.META_APP_ID!==appId||!process.env.META_APP_SECRET)throw new PlatformDenied("WHATSAPP_PHONE_APP_SECRET_BINDING_REQUIRED");return process.env.META_APP_SECRET;}}).request(contract,asset_id,input):WHATSAPP_TEMPLATE_TOOLS.includes(contract.tool)?await new WhatsAppTemplateClient({repository:getPlatformRepository(),getAppSecret:async appId=>{if(process.env.META_APP_ID!==appId||!process.env.META_APP_SECRET)throw new PlatformDenied("WHATSAPP_TEMPLATE_APP_SECRET_BINDING_REQUIRED");return process.env.META_APP_SECRET;}}).request(contract,asset_id,input):WHATSAPP_SUBSCRIPTION_TOOLS.includes(contract.tool)?await new WhatsAppSubscriptionClient({getAppSecret:async appId=>{if(process.env.META_APP_ID!==appId||!process.env.META_APP_SECRET)throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_APP_SECRET_BINDING_REQUIRED");return process.env.META_APP_SECRET;}}).request(contract,asset_id,input):WHATSAPP_FLOW_TOOLS.includes(contract.tool)?await new WhatsAppFlowClient({repository:getPlatformRepository(),getAppSecret:async appId=>{if(process.env.META_APP_ID!==appId||!process.env.META_APP_SECRET)throw new PlatformDenied("WHATSAPP_FLOW_APP_SECRET_BINDING_REQUIRED");return process.env.META_APP_SECRET;}}).request(contract,asset_id,input):await new MetaGraphClient(contract.provider).request(contract,asset_id,input);if(contract.product==="business"&&contract.returnedAssetType){response=scopedBusinessInventory(contract,ctx,asset_id,response,await getPlatformRepository().list("assets",ctx.principal.tenantId));await revalidateExecutionPermit(permit!);}if(contract.assetEvidenceUpdate)await recordProductObservation(getPlatformRepository(),permit!,contract,asset_id,response);return response;});
        if(contract.tool==="marketing_delete_paused_ad"){const revoked=await finishDeletedAd(permit,asset_id);return revoked?result({status:"DELETED",registry_status:"REVOKED",operation_id:permit.operationId}):{...result({status:"PARTIAL_RECONCILE_DO_NOT_RETRY",operation_id:permit.operationId}),isError:true};}
        if(contract.tool==="marketing_activate_ad"){await finishOperation(permit,"SUCCEEDED",undefined,{status:"ACTIVE"});return result({configured_status:"ACTIVE",delivery_status:"NOT_ESTABLISHED",operation_id:permit.operationId});}
        if(contract.createdAssetType){
          const id=(output as {id?:unknown})?.id;
          if(!validCreatedProductId(contract,id,asset_id))throw new PlatformDenied("CREATED_PRODUCT_ID_UNVERIFIED");
          const partial=(["instagram_publish_container","instagram_login_publish"].includes(contract.tool) && !!((output as Record<string,unknown>).config_issue || (output as Record<string,unknown>).caption_add_on_attachment_status)) || (contract.tool==="whatsapp_platform_create_flow" && Number((output as Record<string,unknown>).validation_error_count)>0);
          const registered=await finishCreatedAsset(permit,{id,type:contract.createdAssetType as "MEDIA"|"POST"|"FLOW"|"TEMPLATE"|"COMMENT"|"VIDEO"|"LEAD_FORM"|"AD_IMAGE"|"AD_VIDEO"|"AUDIENCE"|"REPORT"|"RULE"|"STUDY"|"CUSTOM_CONVERSION",parent:{type:contract.assetType,id:asset_id},...(partial?{providerResult:"PARTIAL" as const}:{})});
          return result({...output as Record<string,unknown>,registry_status:registered?"REGISTERED":"PARTIAL",...(partial?(contract.tool==="whatsapp_platform_create_flow"?{draft_status:"INVALID_DRAFT_RECONCILE"}:{publication_status:"PARTIAL_PUBLISHED_RECONCILE_DO_NOT_RETRY"}):{}),operation_id:permit.operationId});
        }
        await finishOperation(permit,"SUCCEEDED");
        if(IMAGE_INSPECTION_TOOLS.includes(contract.tool)){await assertImageInspectionReadResponseCurrent(permit);const inspected=output as Awaited<ReturnType<ImageInspectionClient["request"]>>;return {content:[{type:"text" as const,text:JSON.stringify(inspected.metadata)},{type:"image" as const,mimeType:"image/jpeg",data:inspected.image.toString("base64")}]};}
        if([VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_TOOL].includes(contract.tool)){await assertVideoInspectionReadResponseCurrent(permit);const video=output as Awaited<ReturnType<VideoInspectionClient["request"]>>;return {content:[{type:"text" as const,text:JSON.stringify(video.metadata)},...video.frames.map(frame=>({type:"image" as const,mimeType:"image/jpeg",data:frame.bytes.toString("base64")}))]};}
        if(contract.tool===APP_EVENT_TYPES_TOOL)await assertAppEventTypesReadResponseCurrent(permit);
        if(contract.tool==="pages_list_comments")await assertPageCommentsReadResponseCurrent(permit);
        if(["catalog_get_feed_status","catalog_get_item_diagnostics"].includes(contract.tool))await assertCatalogOperationalReadResponseCurrent(permit);if(contract.tool==="marketing_list_client_invoice_metadata")await assertInvoiceMetadataReadResponseCurrent(permit);
        return result(output);
      }catch(error){
        if(resolvedContext)await recordScopedHealthFailure(resolvedContext,error);
        if(permit) {
          // A failure that provably never reached Meta finishes FAILED and frees the plan; anything that
          // may have reached it stays UNKNOWN and keeps the plan locked until it is reconciled.
          try {await finishOperation(permit,outcomeAfterFailure(permit,error));}catch{return {...result({status:"HOLD",reason:"DURABLE_COMPLETION_PENDING",operation_id:permit.operationId}),isError:true};}
        }
        return failure(error);
      }
}
