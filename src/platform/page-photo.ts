import {PlatformDenied,type MetaAsset} from "./models.js";
import {assertApprovedJpegAsset} from "./product-media.js";
export function validatePagePhotoInput(input:Record<string,unknown>):void{
 if(Object.keys(input).sort().join()!=="image_url,source_media_id"||typeof input.source_media_id!=="string"||!/^jpeg_[a-f0-9]{64}$/.test(input.source_media_id)||typeof input.image_url!=="string")throw new PlatformDenied("PAGE_PHOTO_APPROVED_JPEG_SCHEMA_REQUIRED");
}
export function assertPagePhotoSource(targetId:string,input:Record<string,unknown>,assets:MetaAsset[]):void{
 const page=assets.find(a=>a.type==="PAGE"&&a.id===targetId&&a.provider==="META_FACEBOOK_PAGES"),source=assets.find(a=>a.type==="MEDIA"&&a.id===input.source_media_id&&a.provider==="META_FACEBOOK_PAGES");
 if(!page||!source||source.mediaEvidence?.purpose!=="facebook_content_publishing"||source.mediaEvidence.aiGenerated!==false)throw new PlatformDenied("PAGE_PHOTO_SEPARATE_RIGHTS_REQUIRED");
 assertApprovedJpegAsset(page,source,input.image_url,false);
}
export function normalizePagePhotoReceipt(value:unknown,pageId:string):{id:string;photo_id:string}{
 const row=value as {id?:unknown;post_id?:unknown};if(!row||typeof row.id!=="string"||!/^[0-9]{1,32}$/.test(row.id)||typeof row.post_id!=="string"||!/^[0-9]{1,32}_[0-9]{1,32}$/.test(row.post_id)||row.post_id.split("_")[0]!==pageId)throw new PlatformDenied("PAGE_PHOTO_POST_RECEIPT_UNVERIFIED_DO_NOT_RETRY");
 return {id:row.post_id,photo_id:row.id};
}
