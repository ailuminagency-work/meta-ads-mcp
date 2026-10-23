import {expect,it} from "vitest";
import {publishingVideoPurpose,publishingVideoRoot,publishingVideoDraftTool} from "../../src/platform/video-purpose.js";
it.each([
 ["META_FACEBOOK_PAGES","facebook_video_publishing","PAGE","pages_create_videos"],
 ["META_INSTAGRAM_LOGIN","instagram_video_publishing","INSTAGRAM_ACCOUNT","instagram_login_create_container"],
 ["META_INSTAGRAM_FACEBOOK_LOGIN","instagram_video_publishing","INSTAGRAM_ACCOUNT","instagram_create_container"],
 ["META_THREADS","threads_video_publishing","THREADS_ACCOUNT","threads_create_container"],
 ["META_MESSENGER","facebook_messaging_video","PAGE","messenger_send_video"],
 ["META_WHATSAPP","whatsapp_messaging_video","WHATSAPP_PHONE","whatsapp_platform_send_video"],
 ["META_MARKETING","meta_ad_video_upload","AD_ACCOUNT","marketing_upload_video"],
] as const)("keeps %s source rights bound to its exact owner family",(provider,purpose,root,tool)=>{expect(publishingVideoPurpose(provider)).toBe(purpose);expect(publishingVideoRoot(provider)).toBe(root);expect(publishingVideoDraftTool(provider)).toBe(tool);});
it.each(["META_BUSINESS"] as const)("has no fallback source authority for %s",provider=>{expect(()=>publishingVideoPurpose(provider)).toThrow("VIDEO_PROVIDER_PURPOSE_UNSUPPORTED");expect(()=>publishingVideoRoot(provider)).toThrow();expect(()=>publishingVideoDraftTool(provider)).toThrow();});
