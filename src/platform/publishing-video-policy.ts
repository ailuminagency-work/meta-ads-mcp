import {PlatformDenied} from "./models.js";
import type {ProductContract} from "./products/contracts.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import type {PublishingVideoProvider} from "./video-purpose.js";

const modes:Readonly<Partial<Record<PublishingVideoProvider,readonly string[]>>>=Object.freeze({
 META_INSTAGRAM_FACEBOOK_LOGIN:Object.freeze(["instagram_create_reel_container","instagram_create_story_container","instagram_create_carousel_item"]),
 META_INSTAGRAM_LOGIN:Object.freeze(["instagram_login_create_reel_container","instagram_login_create_story_container","instagram_login_create_carousel_item"]),
 META_WHATSAPP:Object.freeze(["whatsapp_platform_send_video"]),
 META_MARKETING:Object.freeze(["marketing_upload_video"]),
 META_MESSENGER:Object.freeze(["messenger_send_video"]),
 META_THREADS:Object.freeze(["threads_create_video_container","threads_create_carousel_item"]),
});
/** The configured source mode set must consist entirely of independently verified exact video draft contracts. */
export function publishingVideoContracts(provider:PublishingVideoProvider,tools:readonly string[]):ProductContract[]{
 if(!modes[provider]||!tools.length||tools.length>3||new Set(tools).size!==tools.length||tools.some(t=>!modes[provider]!.includes(t)))throw new PlatformDenied("PUBLISHING_VIDEO_EXACT_MODE_CONFIGURATION_REQUIRED");
 return tools.map(tool=>{const c=PRODUCT_CONTRACTS.find(row=>row.tool===tool&&row.provider===provider);
  if(!c||!c.verified||c.method!=="POST"||(["META_MESSENGER","META_WHATSAPP"].includes(provider)?c.createdAssetType!==undefined||!c.operationClasses.includes("WRITE_MESSAGING"):c.createdAssetType!==(provider==="META_MARKETING"?"AD_VIDEO":"MEDIA")||!c.operationClasses.includes("WRITE_CONTENT"))||c.assetInputKeys?.[provider==="META_WHATSAPP"?"media_id":"source_media_id"]!=="MEDIA"||(!["META_MARKETING","META_WHATSAPP"].includes(provider)&&!c.allowedInputKeys.includes(provider==="META_MESSENGER"?"attachment_url":"video_url"))||(provider!=="META_WHATSAPP"&&!c.serverOnlyInputKeys?.includes("source_media_id"))||(!["META_MARKETING","META_WHATSAPP"].includes(provider)&&!c.serverOnlyInputKeys!.includes(provider==="META_MESSENGER"?"attachment_url":"video_url")))throw new PlatformDenied("PUBLISHING_VIDEO_MODE_CONTRACT_UNVERIFIED");
  return c;
 });
}
export function publishingVideoSourceContracts(provider:PublishingVideoProvider,tools:readonly string[]):ProductContract[]{
 const drafts=publishingVideoContracts(provider,tools);if(provider==="META_MESSENGER"||provider==="META_MARKETING"||provider==="META_WHATSAPP")return drafts;const lifecycle=provider==="META_INSTAGRAM_LOGIN"?["instagram_login_get_container_status","instagram_login_publish"]:provider==="META_INSTAGRAM_FACEBOOK_LOGIN"?["instagram_get_container_status","instagram_publish_container"]:provider==="META_THREADS"?["threads_get_post_status","threads_publish_container"]:[];
 if(lifecycle.length!==2)throw new PlatformDenied("PUBLISHING_VIDEO_LIFECYCLE_UNVERIFIED");
 const result=[...drafts,...lifecycle.map((tool,index)=>{const c=PRODUCT_CONTRACTS.find(row=>row.tool===tool&&row.provider===provider);if(!c?.verified||(index===0?(c.method!=="GET"||c.assetType!=="MEDIA"||!c.operationClasses.includes("READ")):(c.method!=="POST"||c.assetInputKeys?.creation_id!=="MEDIA"||!c.operationClasses.includes("WRITE_CONTENT"))))throw new PlatformDenied("PUBLISHING_VIDEO_LIFECYCLE_UNVERIFIED");return c;})];
 if(tools.some(tool=>tool.endsWith("create_carousel_item"))){const tool=provider==="META_INSTAGRAM_LOGIN"?"instagram_login_create_carousel_container":provider==="META_INSTAGRAM_FACEBOOK_LOGIN"?"instagram_create_carousel_container":"threads_create_carousel_container",parent=PRODUCT_CONTRACTS.find(c=>c.provider===provider&&c.tool===tool);if(!parent?.verified||parent.method!=="POST"||parent.assetInputArrayKeys?.children!=="MEDIA"||!parent.operationClasses.includes("WRITE_CONTENT"))throw new PlatformDenied("PUBLISHING_VIDEO_CAROUSEL_LIFECYCLE_UNVERIFIED");result.push(parent);}
 return result;
}
