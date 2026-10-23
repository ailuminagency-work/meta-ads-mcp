import {PlatformDenied} from "./models.js";
import {productMediaDigest} from "./product-media.js";
import {validatePublicVideoUrl} from "./page-video.js";
import {decodeInstagramMp4} from "./instagram-mp4-decoder.js";
import {publishingVideoPurpose,type PublishingVideoProvider,type PublishingVideoPurpose} from "./video-purpose.js";
import type {VideoEvidence} from "./video-types.js";

export interface PublishingVideoScope {tenantId:string;clientId:string;appId:string;provider:PublishingVideoProvider}
export interface PublishingMp4Source {bytes:Uint8Array;url:string;sourceReference:string;immutable:true;aiGenerated:false;rights:PublishingVideoScope&{purpose:PublishingVideoPurpose;contentDigest:string;granted:true;checkedAt:number;expiresAt:number;source:"approved_video_adapter"}}
/** Bytes/rights normalization only: callers must separately authorize the exact typed provider container contract. */
export async function preparePublishingMp4Source(scope:PublishingVideoScope,source:PublishingMp4Source):Promise<{url:string;evidence:VideoEvidence}>{
 const input=structuredClone(source),now=Date.now(),rights=input.rights,purpose=publishingVideoPurpose(scope.provider),url=validatePublicVideoUrl(input.url);
 if(!["META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN","META_THREADS","META_MESSENGER","META_MARKETING","META_WHATSAPP"].includes(scope.provider)||input.immutable!==true||input.aiGenerated!==false||rights.source!=="approved_video_adapter"||rights.granted!==true||rights.purpose!==purpose||rights.tenantId!==scope.tenantId||rights.clientId!==scope.clientId||rights.appId!==scope.appId||rights.provider!==scope.provider||!Number.isSafeInteger(rights.checkedAt)||rights.checkedAt<=0||rights.checkedAt>now||now-rights.checkedAt>300000||!Number.isSafeInteger(rights.expiresAt)||rights.expiresAt<=now||!/^[a-f0-9]{64}$/.test(input.sourceReference)||rights.contentDigest!==productMediaDigest(input.bytes))throw new PlatformDenied("INSTAGRAM_VIDEO_PURPOSE_RIGHTS_REQUIRED");
 const decoded=await decodeInstagramMp4(input.bytes),checkedAt=Date.now();if(rights.expiresAt<=checkedAt||checkedAt-rights.checkedAt>300000||decoded.contentDigest!==rights.contentDigest)throw new PlatformDenied("INSTAGRAM_VIDEO_RIGHTS_EXPIRED_DURING_INSPECTION");
 return {url,evidence:{kind:"approved_mp4",purpose,urlDigest:productMediaDigest(url),contentDigest:decoded.contentDigest,mimeType:"video/mp4",aiGenerated:false,byteLength:decoded.byteLength,width:decoded.width,height:decoded.height,durationMs:decoded.durationMs,frameRate:decoded.frameRate,videoCodec:"h264",pixelFormat:"yuv420p",audioCodec:decoded.audioCodec,rightsGranted:true,checkedAt,expiresAt:Math.min(checkedAt+300000,rights.expiresAt),source:"approved_video_adapter",sourceReference:input.sourceReference,encodingProof:{source:decoded.encodingSource,progressive:decoded.progressive,closedGop:decoded.closedGop,editLists:decoded.editLists}}};
}

export async function prepareInstagramMp4Source(scope:PublishingVideoScope,source:PublishingMp4Source){if(!["META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN"].includes(scope.provider))throw new PlatformDenied("INSTAGRAM_VIDEO_PURPOSE_RIGHTS_REQUIRED");return preparePublishingMp4Source(scope,source);}
