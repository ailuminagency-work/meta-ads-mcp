import type {EncryptedPayload} from "../auth/crypto.js";
import type {ControlCommit} from "./repository.js";
import type {PublishingVideoPurpose,PublishingVideoProvider} from "./video-purpose.js";
export interface VideoEvidence {
 kind:"approved_mp4";purpose:PublishingVideoPurpose;urlDigest:string;contentDigest:string;mimeType:"video/mp4";aiGenerated:boolean;byteLength:number;width:number;height:number;durationMs:number;frameRate:number;videoCodec:"h264";pixelFormat:"yuv420p";audioCodec:"aac"|null;rightsGranted:true;checkedAt:number;expiresAt:number;source:"approved_video_adapter";sourceReference:string;encodingProof?:{source:"ACTUAL_MP4_AND_H264_INSPECTION";progressive:true;closedGop:true;editLists:false};
}
export interface TrustedMp4Source {bytes:Uint8Array;url:string;sourceReference:string;immutable:true;aiGenerated:boolean;rights:{tenantId:string;clientId:string;provider:"META_FACEBOOK_PAGES";appId:string;purpose:"facebook_video_publishing";contentDigest:string;granted:true;checkedAt:number;expiresAt:number;source:"approved_video_adapter"}}
export interface VideoIngressBinding {id:string;tenantId:string;clientId:string;operatorId:string;connectionId:string;accountId:string;appId:string;provider:"META_FACEBOOK_PAGES"}
export interface VideoProposal {id:string;tenantId:string;clientId:string;actorId:string;connectionId:string;rootKey:string;appId:string;provider:PublishingVideoProvider;draftTools?:string[];checkedAt:number;expiresAt:number;consumedAt:number|null;approvedBy:string|null;planHash:string;encryptedPlan:EncryptedPayload}
export interface VideoPlan {version:1;url:string;evidence:VideoEvidence;expected:ControlCommit["expected"]}
