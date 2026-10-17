import {z} from "zod";
import {PlatformDenied,type AssetRef,type MetaAsset,type OperationPlan} from "./models.js";
import {buildLegacyImageCreative} from "./legacy-creative.js";
/** Current official SDK AdCreativeVideoData: separately registered image_hash thumbnail, never image_url. */
export const VIDEO_CREATIVE_SOURCE="https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreativevideodata.py";
export function buildLegacyVideoCreative(input:Record<string,unknown>):{story:Record<string,unknown>;assets:AssetRef[];destinationOrigin:string}{
 const {video_id,...imageInput}=input;if(typeof video_id!=="string"||!/^\d{1,32}$/.test(video_id))throw new PlatformDenied("LEGACY_REGISTERED_VIDEO_REQUIRED");
 const built=buildLegacyImageCreative(imageInput),link=built.story.link_data as Record<string,unknown>,video:Record<string,unknown>={video_id,image_hash:link.image_hash};
 for(const [from,to] of [["message","message"],["name","title"],["description","link_description"]] as const)if(link[from]!==undefined)video[to]=link[from];
 video.call_to_action=link.call_to_action??{type:"LEARN_MORE",value:{link:link.link}};
 return {story:{page_id:built.story.page_id,video_data:video},assets:[...built.assets,{type:"AD_VIDEO",id:video_id}],destinationOrigin:built.destinationOrigin};
}

export function verifyRegisteredAdVideo(plan:OperationPlan,assets:MetaAsset[],edge:unknown,status:unknown):{requirement:string;source:string}{
 const videos=plan.assets.filter(a=>a.type==="AD_VIDEO"),account=assets.find(a=>a.type==="AD_ACCOUNT");if(videos.length!==1||!account)throw new PlatformDenied("VIDEO_CREATIVE_EXACT_REGISTERED_VIDEO_REQUIRED");const v=assets.find(a=>a.type==="AD_VIDEO"&&a.id===videos[0].id);if(!v||v.parents.length!==1||v.parents[0].type!=="AD_ACCOUNT"||v.parents[0].id.replace(/^act_/,"")!==account.id.replace(/^act_/,""))throw new PlatformDenied("VIDEO_CREATIVE_ACCOUNT_PROVENANCE_REQUIRED");
 const parsed=z.object({data:z.array(z.object({id:z.string().regex(/^\d{1,32}$/)})).max(100),paging:z.object({next:z.string().min(1).max(4096).optional(),previous:z.string().min(1).max(4096).optional(),cursors:z.object({before:z.string().min(1).max(2048).optional(),after:z.string().min(1).max(2048).optional()}).strict().optional()}).strict().optional()}).safeParse(edge),parsedNode=z.object({id:z.string().regex(/^\d{1,32}$/),status:z.object({video_status:z.literal("ready"),processing_progress:z.number().int().min(0).max(100).optional()})}).safeParse(status);
 if(!parsed.success||!parsedNode.success||parsed.data.paging?.next||new Set(parsed.data.data.map(r=>r.id)).size!==parsed.data.data.length||!parsed.data.data.some(r=>r.id===v.id)||parsedNode.data.id!==v.id)throw new PlatformDenied("VIDEO_CREATIVE_CURRENT_READY_ACCOUNT_MEMBERSHIP_REQUIRED");
 return {requirement:"marketing_video_ready:"+v.id+":"+account.id.replace(/^act_/,""),source:"https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/advideos"};
}

export function marketingVideoCreativeEnabled():boolean{const value=process.env.LUMIN_MARKETING_VIDEO_CREATIVE_ENABLED;if(value!==undefined&&!["true","false"].includes(value))throw new PlatformDenied("INVALID_MARKETING_VIDEO_CREATIVE_FLAG");return value==="true";}
