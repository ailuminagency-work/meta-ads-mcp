import {PlatformDenied,type AssetType,type Provider} from "./models.js";

export type PublishingVideoProvider="META_FACEBOOK_PAGES"|"META_INSTAGRAM_LOGIN"|"META_INSTAGRAM_FACEBOOK_LOGIN"|"META_THREADS"|"META_MESSENGER"|"META_MARKETING"|"META_WHATSAPP";
export type PublishingVideoPurpose="facebook_video_publishing"|"instagram_video_publishing"|"threads_video_publishing"|"facebook_messaging_video"|"meta_ad_video_upload"|"whatsapp_messaging_video";
/** Source rights are provider-specific. This mapping grants no provider capability or contract eligibility. */
export function publishingVideoPurpose(provider:Provider):PublishingVideoPurpose{
 if(provider==="META_WHATSAPP")return "whatsapp_messaging_video";
 if(provider==="META_MARKETING")return "meta_ad_video_upload";
 if(provider==="META_MESSENGER")return "facebook_messaging_video";
 if(provider==="META_FACEBOOK_PAGES")return "facebook_video_publishing";
 if(provider==="META_INSTAGRAM_LOGIN"||provider==="META_INSTAGRAM_FACEBOOK_LOGIN")return "instagram_video_publishing";
 if(provider==="META_THREADS")return "threads_video_publishing";
 throw new PlatformDenied("VIDEO_PROVIDER_PURPOSE_UNSUPPORTED");
}
export function publishingVideoRoot(provider:Provider):AssetType{
 publishingVideoPurpose(provider);
 return provider==="META_WHATSAPP"?"WHATSAPP_PHONE":provider==="META_MARKETING"?"AD_ACCOUNT":["META_FACEBOOK_PAGES","META_MESSENGER"].includes(provider)?"PAGE":provider==="META_THREADS"?"THREADS_ACCOUNT":"INSTAGRAM_ACCOUNT";
}
export function publishingVideoDraftTool(provider:Provider):string{
 publishingVideoPurpose(provider);
 return provider==="META_WHATSAPP"?"whatsapp_platform_send_video":provider==="META_MARKETING"?"marketing_upload_video":provider==="META_MESSENGER"?"messenger_send_video":provider==="META_FACEBOOK_PAGES"?"pages_create_videos":provider==="META_THREADS"?"threads_create_container":provider==="META_INSTAGRAM_LOGIN"?"instagram_login_create_container":"instagram_create_container";
}

export function publishingVideoWriteAction(provider:Provider):"WRITE_CONTENT"|"WRITE_MESSAGING"{publishingVideoPurpose(provider);return ["META_MESSENGER","META_WHATSAPP"].includes(provider)?"WRITE_MESSAGING":"WRITE_CONTENT";}
