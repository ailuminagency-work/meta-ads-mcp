import {IMAGE_INSPECTION_TOOLS,imageInspectionInput} from "./image-inspection-contract.js";
import {APP_EVENT_TYPES_TOOL,appEventTypesInput} from "./app-event-types-contract.js";
import {VIDEO_INSPECTION_TOOL,videoInspectionInput,CREATIVE_VIDEO_INSPECTION_TOOL,creativeVideoInspectionInput} from "./video-inspection-contract.js";
import {CATALOG_CAMPAIGN_TOOL,catalogCampaignInput} from "./catalog-campaign-contract.js";
import {INVOICE_METADATA_TOOL,invoiceMetadataInput} from "./business-invoice-metadata.js";
import {CRM_SIGNAL_TOOL,crmSignalInput} from "./crm-contract.js";
import {CATALOG_OPERATIONAL_TOOLS,validateCatalogOperationalInput} from "./catalog-operational-contracts.js";
import {PAGE_COMMENT_READ_TOOL,validatePageCommentReadInput} from "./page-comment-read-contract.js";
import {MARKETING_PREVIEW_TOOL,validateMarketingPreviewInput} from "./marketing-preview-contract.js";
import {PURCHASE_CONVERSION_TOOL,validatePurchaseConversionInput,purchaseConversionAssets} from "./purchase-conversion-contract.js";
import {DATASET_READ_TOOL,validateDatasetReadInput,datasetReadAssets} from "./dataset-read-contract.js";
import {MARKETING_STUDY_TOOL,validateMarketingStudyInput} from "./marketing-study-contract.js";
import {MARKETING_RULE_TOOL,validateMarketingRuleInput} from "./marketing-rule-contract.js";
import {MARKETING_REPORT_TOOL,validateMarketingReportInput} from "./marketing-report-contracts.js";
import {clientBusinessBound,type ClientBusinessEvidence} from "./client-business.js";
import {WHATSAPP_QR_TOOLS,validateWhatsAppQrParameters} from "./whatsapp-qr-contracts.js";
import {PAGE_REPLY_TOOL,validatePageReplyInput,resolvePageReplyContext} from './page-comment-reply.js';
import {MARKETING_CONTROL_TOOLS,validateMarketingControlInput} from './marketing-control-contracts.js';
import {AD_LIBRARY_TOOL,validateAdLibraryInput} from "./ad-library-contract.js";
import {MARKETING_VIDEO_TOOL,validateMarketingVideoInput} from "./marketing-video-contract.js";
import {MARKETING_AUDIENCE_TOOLS,validateMarketingAudienceInput} from "./marketing-audience-contracts.js";
import {MESSENGER_UTILITY_TOOLS,validateMessengerUtilityInput} from "./messenger-utility-contracts.js";
import {MESSENGER_ATTACHMENT_TOOLS,validateMessengerAttachmentInput} from "./messaging-attachment-contracts.js";
import {INSTAGRAM_IMAGE_VARIANT_TOOLS,validateInstagramImageVariant,assertInstagramImageVariantSource} from "./instagram-image-variants.js";
import {THREADS_IMAGE_TOOLS,validateThreadsImageInput,assertThreadsImageSource} from "./threads-image-contracts.js";
import {INSTAGRAM_CAROUSEL_TOOLS,validateInstagramCarouselInput,assertInstagramCarouselChildren} from "./instagram-carousel-contracts.js";
import {THREADS_CAROUSEL_TOOLS,validateThreadsCarouselInput,assertThreadsCarouselChildren} from "./threads-carousel-contracts.js";
import {THREADS_VIDEO_TOOLS,validateThreadsVideoInput,assertThreadsVideoSource} from "./threads-video-contracts.js";
import {MARKETING_IMAGE_TOOL,validateMarketingImageInput} from "./marketing-image-contract.js";
import {INSTAGRAM_VIDEO_TOOLS,validateInstagramVideoInput,assertInstagramVideoSource} from "./instagram-video-contracts.js";
import {MESSAGING_IMAGE_TOOLS,validateMessagingImageInput,assertMessagingImageSource} from "./messaging-image.js";
import {LEAD_FORM_TOOL,leadFormBody} from "./lead-form-contract.js";
import {WHATSAPP_SEND_TOOLS,validateWhatsAppSendParameters} from "./whatsapp-send-contracts.js";
import {MESSENGER_TYPED_TOOLS,validateMessengerTypedInput} from "./messenger-typed.js";
import {pageVideoOwner} from "./page-video-status.js";
import {validatePageVideoInput,assertPageVideoSource} from "./page-video.js";
import {catalogAssignedBusiness} from "./catalog-assigned-users.js";
import {INSTAGRAM_MENTION_TOOLS,validateInstagramMentionInput} from "./instagram-mentions.js";
import {WHATSAPP_ANALYTICS_TOOLS,validateWhatsAppAnalyticsParameters} from "./whatsapp-analytics-contracts.js";
import {THREADS_DISCOVERY_TOOLS,validateThreadsDiscoveryInput} from "./threads-discovery-contracts.js";
import {validateInstagramHashtagInput} from "./instagram-hashtag-contract.js";
import {validateInstagramBusinessDiscoveryInput} from "./instagram-business-discovery.js";
import {INSTAGRAM_MEDIA_INSIGHTS_TOOLS} from "./instagram-insights.js";
import {assertPagePhotoSource,validatePagePhotoInput} from "./page-photo.js";
import {assertPagePostEditAsset,validatePagePostEditInput} from "./page-post-edit.js";
import {INSTAGRAM_COMMENT_TOOLS,validateInstagramCommentInput,resolveInstagramCommentContext} from "./instagram-comments.js";
import {WHATSAPP_PHONE_TOOLS,validateWhatsAppPhoneParameters} from "./whatsapp-phone-contracts.js";
import {WHATSAPP_TEMPLATE_TOOLS,validateWhatsAppTemplateParameters} from "./whatsapp-template-contracts.js";
import {LEAD_READ_TOOLS,validateLeadReadInput,assertLeadReadRelationships} from "./lead-read.js";
import {WHATSAPP_FLOW_TOOLS} from "./whatsapp-flow-contracts.js";
import {validateWhatsAppFlowParameters} from "./whatsapp-flow-json.js";
import { PlatformDenied, type Client, type MetaAsset } from "./models.js";
import type { ProductContract } from "./products/contracts.js";
import { assertApprovedJpegAsset, validatePublicJpegUrl } from "./product-media.js";

export interface ThreadsPublishingEvidence {
  kind: "threads_container" | "instagram_container";
  accountId: string;
  appId: string;
  status: string;
  published: boolean;
  checkedAt: number;
  expiresAt: number;
  source: string;
  verified: true;
}

export function assertProductClientOwnership(contract: ProductContract, targetId: string, client: Client, assets: MetaAsset[],businessOwnerEvidence?:ClientBusinessEvidence): void {
  if (!contract.requiresClientOwnedBusiness) return;
  if((CATALOG_OPERATIONAL_TOOLS as readonly string[]).includes(contract.tool)){const catalogs=assets.filter(a=>a.type==="CATALOG"&&a.provider==="META_BUSINESS"&&(contract.assetType==="CATALOG"?a.id===targetId:assets.some(f=>f.type==="FEED"&&f.id===targetId&&f.parents.some(p=>p.type==="CATALOG"&&p.id===a.id))));if(catalogs.length!==1)throw new PlatformDenied("EXACT_CATALOG_AUTHORITY_REQUIRED");const business=catalogAssignedBusiness(catalogs[0].id,assets);if(catalogs[0].ownerBusinessId!==business.id||business.tenantId!==client.tenantId||business.clientId!==client.id||!clientBusinessBound(client,business.id,Date.now(),businessOwnerEvidence,business.appId))throw new PlatformDenied("VERIFIED_CLIENT_OWNED_BUSINESS_REQUIRED");return;}
  if(contract.tool==="catalog_list_assigned_users"){const business=catalogAssignedBusiness(targetId,assets);if(business.tenantId!==client.tenantId||business.clientId!==client.id||!clientBusinessBound(client,business.id,Date.now(),businessOwnerEvidence,business.appId))throw new PlatformDenied("VERIFIED_CLIENT_OWNED_BUSINESS_REQUIRED");return;}
  const matches = assets.filter(asset => asset.id === targetId && asset.type === "BUSINESS" && asset.provider === contract.provider);
  if (matches.length !== 1 || matches[0]!.tenantId !== client.tenantId || matches[0]!.clientId !== client.id || !clientBusinessBound(client,targetId,Date.now(),businessOwnerEvidence,matches[0]?.appId)) throw new PlatformDenied("VERIFIED_CLIENT_OWNED_BUSINESS_REQUIRED");
}

/** Assets must already come from the fresh, authorized execution snapshot. Never pass caller objects. */
export function assertProductAssetRelationships(contract: ProductContract, targetId: string, input: Record<string, unknown>, assets: MetaAsset[], operationId?: string): void {
 if(contract.tool===PURCHASE_CONVERSION_TOOL){purchaseConversionAssets(targetId,input.pixel_id as string,assets);return;}
 if(contract.tool===DATASET_READ_TOOL){datasetReadAssets(targetId,input,assets);return;}
  if(contract.tool===MARKETING_IMAGE_TOOL){validateMarketingImageInput(input);const owner=assets.find(a=>a.type==="AD_ACCOUNT"&&a.id.replace(/^act_/,"")===targetId.replace(/^act_/,"")&&a.provider===contract.provider),source=assets.find(a=>a.type==="MEDIA"&&a.id===input.source_media_id),e=source?.mediaEvidence,now=Date.now();if(!owner||!source||source.provider!==owner.provider||source.appId!==owner.appId||source.tenantId!==owner.tenantId||source.clientId!==owner.clientId||source.revokedAt!==null||source.parents.length!==1||source.parents[0].type!=="AD_ACCOUNT"||source.parents[0].id!==owner.id||source.publishingEvidence||source.videoEvidence||!e||e.kind!=="approved_jpeg"||e.purpose!=="meta_ad_image_upload"||e.rightsGranted!==true||e.aiGenerated!==false||e.source!=="approved_media_adapter"||!Number.isSafeInteger(e.checkedAt)||e.checkedAt<=0||e.checkedAt>now||now-e.checkedAt>=300000||!Number.isSafeInteger(e.expiresAt)||e.expiresAt<=now||e.expiresAt>e.checkedAt+300000||!/^[a-f0-9]{64}$/.test(e.contentDigest)||e.sourceReference!==e.contentDigest||!/^[a-f0-9]{64}$/.test(e.urlDigest))throw new PlatformDenied("REGISTERED_MARKETING_IMAGE_SOURCE_REQUIRED");return;}
  if(INSTAGRAM_CAROUSEL_TOOLS.includes(contract.tool)){assertInstagramCarouselChildren(contract,targetId,input,assets,operationId);return;}
  if(THREADS_CAROUSEL_TOOLS.includes(contract.tool)){assertThreadsCarouselChildren(contract,targetId,input,assets,operationId);return;}
  if(INSTAGRAM_IMAGE_VARIANT_TOOLS.includes(contract.tool)){assertInstagramImageVariantSource(contract,targetId,input,assets);return;}
  if(THREADS_IMAGE_TOOLS.includes(contract.tool)){assertThreadsImageSource(contract,targetId,input,assets);return;}
  if(THREADS_VIDEO_TOOLS.includes(contract.tool)){assertThreadsVideoSource(contract,targetId,input,assets);return;}
  if(INSTAGRAM_VIDEO_TOOLS.includes(contract.tool)){assertInstagramVideoSource(contract,targetId,input,assets);return;}
  if(MESSAGING_IMAGE_TOOLS.includes(contract.tool)){assertMessagingImageSource(contract,targetId,input,assets);return;}
  if(contract.tool==="catalog_list_assigned_users"){catalogAssignedBusiness(targetId,assets);return;}
  if(contract.tool==="pages_get_video_status"){pageVideoOwner(targetId,assets);return;}
  if(contract.tool==="pages_create_videos"){assertPageVideoSource(targetId,input,assets);return;}
  if(contract.tool==="pages_create_photos"){assertPagePhotoSource(targetId,input,assets);return;}
  if(contract.tool===PAGE_REPLY_TOOL){resolvePageReplyContext(targetId,assets);return;}
  if(contract.tool==="pages_edit_post"){assertPagePostEditAsset(targetId,assets);return;}
  if(INSTAGRAM_COMMENT_TOOLS.includes(contract.tool)||INSTAGRAM_MEDIA_INSIGHTS_TOOLS.includes(contract.tool)){resolveInstagramCommentContext(contract,targetId,assets);return;}
  if(LEAD_READ_TOOLS.includes(contract.tool as typeof LEAD_READ_TOOLS[number])){assertLeadReadRelationships(contract.tool,targetId,input,assets);return;}
  const inbox = ["messenger_get_message", "instagram_get_message", "instagram_login_get_message"].includes(contract.tool);
  const instagramDraft = ["instagram_create_container", "instagram_login_create_container"].includes(contract.tool);
  const instagramPublish = ["instagram_publish_container", "instagram_login_publish"].includes(contract.tool);
  const instagramStatus = ["instagram_get_container_status", "instagram_login_get_container_status"].includes(contract.tool);
  if (!inbox && !instagramDraft && !instagramPublish && !instagramStatus && !["threads_create_container", "threads_publish_container", "threads_delete_post", "threads_get_post_status", "threads_manage_reply", "threads_manage_pending_reply", "threads_list_replies", "threads_get_conversation", "threads_list_pending_replies", "pages_hide_comment", "pages_delete_comment"].includes(contract.tool)) return;
  const target = assets.find(asset => asset.id === targetId && asset.type === contract.assetType && asset.provider === contract.provider);
  if (!target) throw new PlatformDenied("PRODUCT_TARGET_PROVENANCE_REQUIRED");
  if (inbox && target.parents.filter(parent => parent.type === "CONVERSATION").length !== 1) throw new PlatformDenied("EXACT_INBOX_CONVERSATION_REQUIRED");
  const roots = (leaf: MetaAsset): MetaAsset[] => {
    const found = new Map<string, MetaAsset>();
    const visited = new Set<string>();
    const walk = (asset: MetaAsset): void => {
      if (visited.has(asset.key)) return;
      visited.add(asset.key);
      if (asset.tenantId !== target.tenantId || asset.clientId !== target.clientId || asset.appId !== target.appId || asset.provider !== target.provider) throw new PlatformDenied("PRODUCT_PARENT_PROVENANCE_MISMATCH");
      const rootType = contract.provider === "META_FACEBOOK_PAGES" || contract.provider === "META_MESSENGER" ? "PAGE" : ["META_INSTAGRAM_LOGIN", "META_INSTAGRAM_FACEBOOK_LOGIN"].includes(contract.provider) ? "INSTAGRAM_ACCOUNT" : "THREADS_ACCOUNT";
      if (asset.type === rootType) { found.set(asset.id, asset); return; }
      for (const parent of asset.parents) {
        const resolved = assets.find(candidate => candidate.id === parent.id && candidate.type === parent.type && candidate.provider === asset.provider);
        if (!resolved) throw new PlatformDenied("PRODUCT_PARENT_PROVENANCE_REQUIRED");
        walk(resolved);
      }
    };
    walk(leaf);
    return [...found.values()];
  };
  const accounts = roots(target);
  if (accounts.length !== 1) throw new PlatformDenied("EXACT_PRODUCT_ACCOUNT_REQUIRED");
  if (instagramDraft) {
    const source = assets.find(asset => asset.type === "MEDIA" && asset.id === input.source_media_id && asset.provider === contract.provider);
    if (!source) throw new PlatformDenied("APPROVED_CLIENT_JPEG_SOURCE_REQUIRED");
    assertApprovedJpegAsset(target, source, input.image_url, input.is_ai_generated);
    return;
  }
  if (instagramStatus && (target.mediaEvidence || !["instagram_container","instagram_reel_container","instagram_story_container","instagram_carousel_item","instagram_carousel_container"].includes(target.productKind??"") || !target.createdFromOperationId)) throw new PlatformDenied("INSTAGRAM_CREATED_CONTAINER_REQUIRED");
  if (["threads_list_replies", "threads_get_conversation", "threads_list_pending_replies"].includes(contract.tool) && target.replyEvidence?.isReply) throw new PlatformDenied("THREADS_ROOT_POST_REQUIRED");
  if (contract.tool === "threads_delete_post" && target.replyEvidence && target.replyEvidence.isOwnedByMe !== true) throw new PlatformDenied("THREADS_OWN_REPLY_REQUIRED");
  if (["threads_manage_reply", "threads_manage_pending_reply"].includes(contract.tool)) {
    const evidence = target.replyEvidence;
    const now = Date.now();
    const root = assets.find(asset => asset.id === evidence?.rootPostId && asset.type === "POST" && asset.provider === "META_THREADS");
    if (!evidence || evidence.kind !== "threads_reply" || evidence.verified !== true || evidence.isReply !== true || evidence.accountId !== accounts[0]!.id || evidence.appId !== target.appId || !Number.isFinite(evidence.checkedAt) || evidence.checkedAt <= 0 || evidence.checkedAt > now || now - evidence.checkedAt > 300_000 || !Number.isFinite(evidence.expiresAt) || evidence.expiresAt <= now || !root || !target.parents.some(parent => parent.type === "POST" && parent.id === root.id) || !["https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/replies-and-conversations", "https://developers.facebook.com/documentation/threads/reply-management"].includes(evidence.source)) throw new PlatformDenied("THREADS_REPLY_STATE_UNVERIFIED");
    if (contract.tool === "threads_manage_reply" && evidence.repliedToId !== evidence.rootPostId) throw new PlatformDenied("THREADS_TOP_LEVEL_REPLY_REQUIRED");
    if (contract.tool === "threads_manage_pending_reply" && !["pending", "ignored"].includes(evidence.approvalStatus ?? "")) throw new PlatformDenied("THREADS_PENDING_REPLY_REQUIRED");
    return;
  }
  if (contract.tool !== "threads_publish_container" && !instagramPublish) return;
  const container = assets.find(asset => asset.id === input.creation_id && asset.type === "MEDIA" && asset.provider === contract.provider);
  if (!container) throw new PlatformDenied("THREADS_CONTAINER_PROVENANCE_REQUIRED");
  if (instagramPublish && !["instagram_container","instagram_reel_container","instagram_story_container","instagram_carousel_container"].includes(container.productKind??"")) throw new PlatformDenied("INSTAGRAM_CREATED_CONTAINER_REQUIRED");
  if(contract.tool==="threads_publish_container"&&container.productKind==="threads_carousel_item")throw new PlatformDenied("THREADS_CAROUSEL_CHILD_CANNOT_PUBLISH");
  const claim = (container as MetaAsset & { publicationClaim?: { operationId: string; claimedAt: number } }).publicationClaim;
  if (claim && (!operationId || claim.operationId !== operationId)) throw new PlatformDenied("THREADS_CONTAINER_ALREADY_CLAIMED");
  const owners = roots(container);
  if (owners.length !== 1 || owners[0]!.id !== targetId) throw new PlatformDenied("THREADS_CONTAINER_ACCOUNT_MISMATCH");
  const evidence = (container as MetaAsset & { publishingEvidence?: ThreadsPublishingEvidence }).publishingEvidence;
  const now = Date.now();
  const kind = instagramPublish ? "instagram_container" : "threads_container";
  const source = instagramPublish ? "https://developers.facebook.com/documentation/instagram-platform/content-publishing" : "https://developers.facebook.com/documentation/threads/reference/publishing";
  if (container.mediaEvidence || container.videoEvidence || !evidence || evidence.kind !== kind || evidence.verified !== true || evidence.accountId !== targetId || evidence.appId !== target.appId || evidence.status !== "FINISHED" || evidence.published !== false || !Number.isFinite(evidence.checkedAt) || evidence.checkedAt <= 0 || evidence.checkedAt > now || now - evidence.checkedAt > 300_000 || !Number.isFinite(evidence.expiresAt) || evidence.expiresAt <= now || evidence.source !== source) throw new PlatformDenied("THREADS_CONTAINER_READINESS_UNVERIFIED");
}

/** Endpoint-specific local policy; shared client validation still enforces the contract key allowlist. */
export function validateProductInput(tool: string, input: Record<string, unknown>): void {
  if(WHATSAPP_ANALYTICS_TOOLS.includes(tool)){validateWhatsAppAnalyticsParameters(tool,input);return;}
  if(THREADS_DISCOVERY_TOOLS.includes(tool)){validateThreadsDiscoveryInput(tool,input);return;}
  if(INSTAGRAM_MENTION_TOOLS.includes(tool)){validateInstagramMentionInput(tool,input);return;}
  if(tool==="pages_create_videos"){validatePageVideoInput(input);return;}
  if(tool===MARKETING_IMAGE_TOOL){validateMarketingImageInput(input);return;}
  if(INSTAGRAM_CAROUSEL_TOOLS.includes(tool)){validateInstagramCarouselInput(input);return;}
  if(THREADS_CAROUSEL_TOOLS.includes(tool)){validateThreadsCarouselInput(input);return;}
  if(INSTAGRAM_IMAGE_VARIANT_TOOLS.includes(tool)){validateInstagramImageVariant(tool,input);return;}
  if(THREADS_IMAGE_TOOLS.includes(tool)){validateThreadsImageInput(tool,input);return;}
  if(THREADS_VIDEO_TOOLS.includes(tool)){validateThreadsVideoInput(tool,input);return;}
  if(INSTAGRAM_VIDEO_TOOLS.includes(tool)){validateInstagramVideoInput(tool,input);return;}
  if(MESSAGING_IMAGE_TOOLS.includes(tool)){validateMessagingImageInput(input);return;}
  if(tool===LEAD_FORM_TOOL){leadFormBody(input);return;}
  if(WHATSAPP_SEND_TOOLS.includes(tool)){validateWhatsAppSendParameters(tool,input);return;}
  if(tool===AD_LIBRARY_TOOL){validateAdLibraryInput(input);return;}
 if(tool===MARKETING_STUDY_TOOL){validateMarketingStudyInput(input);return;}
 if(tool===MARKETING_RULE_TOOL){validateMarketingRuleInput(input);return;}
 if(tool===PAGE_COMMENT_READ_TOOL){validatePageCommentReadInput(input);return;}
 if((CATALOG_OPERATIONAL_TOOLS as readonly string[]).includes(tool)){validateCatalogOperationalInput(input);return;}
 if(IMAGE_INSPECTION_TOOLS.includes(tool)){imageInspectionInput(tool,input);return;}
 if(tool===CREATIVE_VIDEO_INSPECTION_TOOL){creativeVideoInspectionInput(input);return;}
 if(tool===APP_EVENT_TYPES_TOOL){appEventTypesInput(input);return;}
 if(tool===VIDEO_INSPECTION_TOOL){videoInspectionInput(input);return;}
 if(tool===CATALOG_CAMPAIGN_TOOL){catalogCampaignInput(input);return;}
 if(tool===INVOICE_METADATA_TOOL){invoiceMetadataInput(input);return;}
 if(tool===CRM_SIGNAL_TOOL){crmSignalInput(input);return;}
 if(tool===MARKETING_PREVIEW_TOOL){validateMarketingPreviewInput(input);return;}
 if(tool===PURCHASE_CONVERSION_TOOL){validatePurchaseConversionInput(input);return;}
 if(tool===DATASET_READ_TOOL){validateDatasetReadInput(input);return;}
 if(tool===MARKETING_REPORT_TOOL){validateMarketingReportInput(input);return;}
 if(tool===MARKETING_VIDEO_TOOL){validateMarketingVideoInput(input);return;}
 if((MARKETING_CONTROL_TOOLS as readonly string[]).includes(tool)){validateMarketingControlInput(tool,input);return;}
 if((MARKETING_AUDIENCE_TOOLS as readonly string[]).includes(tool)){validateMarketingAudienceInput(tool,input);return;}
 if(MESSENGER_UTILITY_TOOLS.includes(tool)){validateMessengerUtilityInput(tool,input);return;}
 if((MESSENGER_ATTACHMENT_TOOLS as readonly string[]).includes(tool)){validateMessengerAttachmentInput(tool,input);return;}
 if(MESSENGER_TYPED_TOOLS.includes(tool)){validateMessengerTypedInput(tool,input);return;}
  if(tool==="instagram_hashtag_search"){validateInstagramHashtagInput(input);return;}
  if(tool==="instagram_business_discovery"){validateInstagramBusinessDiscoveryInput(input);return;}
  if(tool==="pages_create_photos"){validatePagePhotoInput(input);return;}
  if(tool==="pages_edit_post"){validatePagePostEditInput(input);return;}
  if(INSTAGRAM_COMMENT_TOOLS.includes(tool)){validateInstagramCommentInput(tool,input);return;}
  if(WHATSAPP_QR_TOOLS.includes(tool)){validateWhatsAppQrParameters(tool,input);return;}
  if(WHATSAPP_PHONE_TOOLS.includes(tool)){validateWhatsAppPhoneParameters(tool,input);return;}
  if(WHATSAPP_TEMPLATE_TOOLS.includes(tool)){validateWhatsAppTemplateParameters(tool,input);return;}
  if(LEAD_READ_TOOLS.includes(tool as typeof LEAD_READ_TOOLS[number])){validateLeadReadInput(tool,input);return;}
  if(WHATSAPP_FLOW_TOOLS.includes(tool)){validateWhatsAppFlowParameters(tool,input);return;}
  if (["instagram_create_container", "instagram_login_create_container"].includes(tool)) {
    if (Object.keys(input).some(key => !["source_media_id", "image_url", "caption", "alt_text", "is_ai_generated"].includes(key)) || typeof input.source_media_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(input.source_media_id) || typeof input.is_ai_generated !== "boolean" || (input.caption !== undefined && (typeof input.caption !== "string" || input.caption.length > 2200 || /@[A-Za-z0-9_.]+/.test(input.caption) || (input.caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0) > 30)) || (input.alt_text !== undefined && (typeof input.alt_text !== "string" || !input.alt_text.trim() || input.alt_text.length > 1000))) throw new PlatformDenied("LUMIN_INSTAGRAM_JPEG_DRAFT_SCHEMA_REQUIRED");
    validatePublicJpegUrl(input.image_url);
  }
  if (["instagram_publish_container", "instagram_login_publish"].includes(tool) && (Object.keys(input).join() !== "creation_id" || typeof input.creation_id !== "string" || !/^\d{1,100}$/.test(input.creation_id))) throw new PlatformDenied("LUMIN_INSTAGRAM_PUBLISH_SCHEMA_REQUIRED");
  if (tool === "threads_manage_reply" && (Object.keys(input).join() !== "hide" || typeof input.hide !== "boolean")) throw new PlatformDenied("LUMIN_THREADS_HIDE_SCHEMA_REQUIRED");
  if (tool === "threads_manage_pending_reply" && (Object.keys(input).join() !== "approve" || typeof input.approve !== "boolean")) throw new PlatformDenied("LUMIN_THREADS_APPROVE_SCHEMA_REQUIRED");
  if(tool===PAGE_REPLY_TOOL){validatePageReplyInput(input);return;}
  if (tool === "pages_reply_comment" && (Object.keys(input).join() !== "message" || typeof input.message !== "string" || !input.message.trim() || input.message.length > 2000 || /@\[[^\]]*\]/.test(input.message))) throw new PlatformDenied("LUMIN_PAGE_COMMENT_REPLY_SCHEMA_REQUIRED");
  if (tool === "pages_hide_comment" && (Object.keys(input).join() !== "is_hidden" || typeof input.is_hidden !== "boolean")) throw new PlatformDenied("LUMIN_PAGE_COMMENT_HIDE_SCHEMA_REQUIRED");
  if (tool === "threads_create_container") {
    if (Object.keys(input).some(key => !["media_type", "is_carousel_item", "text"].includes(key)) || input.media_type !== "TEXT" || input.is_carousel_item !== false || typeof input.text !== "string" || !input.text.trim() || Buffer.byteLength(input.text, "utf8") > 500 || /(?:https?:\/\/|www\.)/i.test(input.text)) {
      throw new PlatformDenied("LUMIN_THREADS_TEXT_DRAFT_SCHEMA_REQUIRED");
    }
  }
  if (tool === "threads_publish_container") {
    if (Object.keys(input).join() !== "creation_id" || typeof input.creation_id !== "string" || !/^[0-9]{1,100}$/.test(input.creation_id)) {
      throw new PlatformDenied("LUMIN_THREADS_PUBLISH_SCHEMA_REQUIRED");
    }
  }
}
