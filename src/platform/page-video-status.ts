import {z} from "zod";
import {PlatformDenied,type MetaAsset} from "./models.js";
export function pageVideoOwner(videoId:string,assets:MetaAsset[]):MetaAsset {
 const video=assets.find(a=>a.type==="VIDEO"&&a.id===videoId),pages=assets.filter(a=>a.type==="PAGE");if(!video||video.provider!=="META_FACEBOOK_PAGES"||video.parents.length!==1||video.parents[0].type!=="PAGE"||pages.length!==1||pages[0].id!==video.parents[0].id||pages[0].tenantId!==video.tenantId||pages[0].clientId!==video.clientId||pages[0].appId!==video.appId||pages[0].provider!==video.provider)throw new PlatformDenied("REGISTERED_VIDEO_OWNER_PAGE_REQUIRED");return pages[0];
}
export function normalizePageVideoStatus(value:unknown,videoId:string,pageId:string):{id:string;from:{id:string};published:boolean;status:{video_status:"ready"|"processing"|"error";processing_progress?:number};publication_verified:boolean}{
 try{const numeric=z.string().regex(/^\d{1,32}$/),row=z.object({id:numeric,from:z.object({id:numeric}),published:z.boolean(),status:z.object({video_status:z.enum(["ready","processing","error"]),processing_progress:z.number().int().min(0).max(100).optional()})}).parse(value);if(row.id!==videoId||row.from.id!==pageId)throw new Error();return {...row,publication_verified:row.published&&row.status.video_status==="ready"};}catch{throw new PlatformDenied("PAGE_VIDEO_ACTUAL_OWNER_STATUS_UNVERIFIED");}
}
