import {publishingVideoEnabled} from "./publishing-video-flags.js";
import {assertNoCredentialShapedString} from "./input-safety.js";
import {attachmentEnabled,assertAttachmentAsset} from "./attachment-policy.js";
import {decryptAttachmentPlan} from "./attachment-proposal.js";
import {createHash} from "node:crypto";
import {z} from "zod";
import {PlatformDenied} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {PRODUCT_CONTRACTS,type ProductContract} from "./products/contracts.js";
import {MESSENGER_ATTACHMENT_TOOLS,validateMessengerAttachmentInput,messengerAttachmentBody} from "./messaging-attachment-contracts.js";
import {assertExecutionPermit,getExecutionScope,revalidateExecutionPermit,withConnectionCredential,claimMutationStep} from "./execution.js";
import {assertContractEligibility,contractPlanParameters,productRateController} from "./clients.js";
import {canonicalJson} from "./policy.js";
import {decryptVideoPlan} from "./video-proposal.js";
import {assertPublishingMp4Asset} from "./publishing-video-asset.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
/** Only deployment-owned trusted policy may establish the response window. No caller-supplied evidence. */
export class MessengerAttachmentClient{
 constructor(private readonly options:{repository:PlatformRepository;verifyWindow(assetId:string,recipient:string):Promise<{validUntil:number}>;fetcher?:typeof fetch}){}
 async request(contract:ProductContract,assetId:string,input:Record<string,unknown>):Promise<unknown>{
  contract=structuredClone(contract);input=structuredClone(input);validateMessengerAttachmentInput(contract.tool,input);
  const known=MESSENGER_ATTACHMENT_TOOLS.some(t=>t===contract.tool)?PRODUCT_CONTRACTS.find(c=>c.tool===contract.tool):undefined;
  if(!known||canonicalJson(known)!==canonicalJson(contract)||!new RegExp('^[0-9]{1,32}$').test(assetId))throw new PlatformDenied("EXACT_MESSENGER_ATTACHMENT_CONTRACT_REQUIRED");
  const video=contract.tool==="messenger_send_video",purpose=contract.tool==="messenger_send_audio"?"facebook_messaging_audio":"facebook_messaging_file";if(!video&&!attachmentEnabled())throw new PlatformDenied("ATTACHMENT_DISABLED_BY_DEPLOYMENT");
  const permit=assertExecutionPermit({provider:"META_MESSENGER",tool:contract.tool,mutation:true}),scope=getExecutionScope(),c=scope.snapshot.connection;
  if(canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,assetId,input))||scope.plan.capability!==contract.id||canonicalJson(scope.plan.classes)!==canonicalJson(contract.operationClasses)||canonicalJson(scope.plan.requiredScopes)!==canonicalJson(contract.requiredScopes)||canonicalJson(scope.plan.tokenTypes)!==canonicalJson(contract.tokenTypes))throw new PlatformDenied("MESSENGER_ATTACHMENT_EXACT_PLAN_REQUIRED");
  const owners=scope.snapshot.assets.filter(a=>a.type==="PAGE"&&a.id===assetId),sources=scope.snapshot.assets.filter(a=>a.type==="MEDIA"&&a.id===input.source_media_id);
  if(owners.length!==1||sources.length!==1)throw new PlatformDenied("MESSENGER_ATTACHMENT_SOURCE_REQUIRED");const owner=owners[0],source=sources[0];
  const proposal=video?await this.options.repository.get("videoProposals",c.tenantId,String(input.source_media_id).slice(4)):await this.options.repository.get("attachmentProposals",c.tenantId,String(input.source_media_id).slice(purpose==="facebook_messaging_audio"?6:4));
  if(!proposal||proposal.consumedAt===null||!proposal.approvedBy||proposal.tenantId!==c.tenantId||proposal.clientId!==scope.context.clientId||proposal.connectionId!==c.id||proposal.appId!==c.appId||proposal.provider!==c.provider||proposal.rootKey!==owner.key||proposal.expiresAt<=Date.now()||(video?!("draftTools" in proposal)||canonicalJson(proposal.draftTools)!==canonicalJson([contract.tool]):!("purpose" in proposal)||proposal.purpose!==purpose))throw new PlatformDenied("MESSENGER_ATTACHMENT_HUMAN_ENROLLMENT_REQUIRED");
  const plan="draftTools" in proposal?decryptVideoPlan(proposal):decryptAttachmentPlan(proposal as import("./attachment-source.js").AttachmentProposal);if(plan.url!==input.attachment_url||canonicalJson(plan.evidence)!==canonicalJson(video?source.videoEvidence:source.attachmentEvidence))throw new PlatformDenied("MESSENGER_ATTACHMENT_SOURCE_CHANGED");
  const current=async()=>{if(video?!publishingVideoEnabled():!attachmentEnabled())throw new PlatformDenied("ATTACHMENT_DISABLED_BY_DEPLOYMENT");await revalidateExecutionPermit(permit);assertContractEligibility(contract,c);if(video)assertPublishingMp4Asset(owner,source,plan.url);else assertAttachmentAsset(owner,source,plan.url,purpose);};await current();
  return withConnectionCredential(permit,async token=>{const proof=await this.options.verifyWindow(assetId,(input.recipient as {id:string}).id);if(!proof||!Number.isSafeInteger(proof.validUntil))throw new PlatformDenied("MESSENGER_ATTACHMENT_WINDOW_PROOF_REQUIRED");const latest=await this.options.repository.get(video?"videoProposals":"attachmentProposals",c.tenantId,proposal.id);if(canonicalJson(latest)!==canonicalJson(proposal))throw new PlatformDenied("MESSENGER_ATTACHMENT_SOURCE_CHANGED");await current();const now=Date.now();if(!Number.isSafeInteger(now)||now<=0||now>=proof.validUntil)throw new PlatformDenied("MESSENGER_ATTACHMENT_WINDOW_EXPIRED");
   const bucket=createHash("sha256").update(JSON.stringify([c.provider,c.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");productRateController.bind(bucket,c.appId);productRateController.check(bucket);claimMutationStep(permit);
   let response:Response;try{response=await(this.options.fetcher??fetch)(`https://graph.facebook.com/v26.0/${assetId}/messages`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(messengerAttachmentBody(contract.tool,input)),redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new PlatformDenied("MESSENGER_ATTACHMENT_OUTCOME_UNCERTAIN_DO_NOT_RETRY");}productRateController.observe(bucket,response,null);
   let parsed:unknown;try{parsed=JSON.parse(await readBodyWithLimit(response,65536));}catch{throw new PlatformDenied("MESSENGER_ATTACHMENT_OUTCOME_UNCERTAIN_DO_NOT_RETRY");}const receipt=z.object({recipient_id:z.string().regex(/^[0-9]{1,32}$/),message_id:z.string().min(1).max(500).regex(/^[A-Za-z0-9_:.=-]+$/)}).safeParse(parsed);if(!response.ok||!receipt.success||receipt.data.recipient_id!==(input.recipient as {id:string}).id)throw new PlatformDenied("MESSENGER_ATTACHMENT_OUTCOME_UNCERTAIN_DO_NOT_RETRY");assertNoCredentialShapedString(receipt.data.message_id);return receipt.data;
  });
 }
}
