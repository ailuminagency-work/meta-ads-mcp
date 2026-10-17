import {expect,it} from "vitest";
import {assertApprovedMp4Asset,validatePageVideoInput} from "../../src/platform/page-video.js";
import {productMediaDigest} from "../../src/platform/product-media.js";
import type {MetaAsset} from "../../src/platform/models.js";
const now=Date.now(),url="https://media.fixture.invalid/immutable.mp4";
const page:MetaAsset={key:"page",id:"201",type:"PAGE",provider:"META_FACEBOOK_PAGES",appId:"300",tenantId:"tenant",clientId:"client",parents:[],verifiedAt:now,revokedAt:null,revision:1};
const source:MetaAsset={...page,key:"source",id:"mp4_"+"a".repeat(64),type:"MEDIA",parents:[{type:"PAGE",id:"201"}],videoEvidence:{kind:"approved_mp4",purpose:"facebook_video_publishing",urlDigest:productMediaDigest(url),contentDigest:"b".repeat(64),mimeType:"video/mp4",aiGenerated:false,byteLength:40000,width:320,height:240,durationMs:1000,frameRate:24,videoCodec:"h264",pixelFormat:"yuv420p",audioCodec:null,rightsGranted:true,checkedAt:now,expiresAt:now+300000,source:"approved_video_adapter",sourceReference:"c".repeat(64)}};
it.each(["foreign-client","foreign-app","foreign-parent","stale","expired","different-url","ai","jpeg-substitution","revoked"])("denies source authority substitution: %s",attack=>{
 const row=structuredClone(source);let selectedUrl=url;
 if(attack==="foreign-client")row.clientId="other";
 if(attack==="foreign-app")row.appId="999";
 if(attack==="foreign-parent")row.parents=[{type:"PAGE",id:"999"}];
 if(attack==="stale")row.videoEvidence!.checkedAt=now-300001;
 if(attack==="expired")row.videoEvidence!.expiresAt=now;
 if(attack==="different-url")selectedUrl="https://media.fixture.invalid/substituted.mp4";
 if(attack==="ai")row.videoEvidence!.aiGenerated=true;
 if(attack==="jpeg-substitution")row.mediaEvidence={} as NonNullable<MetaAsset["mediaEvidence"]>;
 if(attack==="revoked")row.revokedAt=now;
 expect(()=>assertApprovedMp4Asset(page,row,selectedUrl,now)).toThrow("FRESH_APPROVED_PAGE_MP4_ASSET_REQUIRED");
});
it("forbids caller publication flags, upload-phase and arbitrary endpoint controls",()=>{
 const input={source_media_id:source.id,video_url:url,title:"Reviewed title",description:"Reviewed description"};expect(()=>validatePageVideoInput(input)).not.toThrow();
 for(const extra of [{published:false},{upload_phase:"start"},{endpoint:"https://foreign.invalid"},{access_token:"fake"}])expect(()=>validatePageVideoInput({...input,...extra})).toThrow("PAGE_VIDEO_APPROVED_MP4_SCHEMA_REQUIRED");
});
