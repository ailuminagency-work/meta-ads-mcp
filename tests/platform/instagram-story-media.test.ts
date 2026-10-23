import {it,expect,vi,afterEach} from 'vitest';
import jpeg from 'jpeg-js';
import {prepareApprovedJpegMedia,assertApprovedJpegAsset,productMediaDigest} from '../../src/platform/product-media.js';
import type {MetaAsset} from '../../src/platform/models.js';
afterEach(()=>vi.unstubAllEnvs());
it('accepts actually decoded 9:16 JPEG only with exact story rights and does not transfer them to feed publishing',async()=>{
 const now=Date.now(),bytes=Buffer.from(jpeg.encode({width:360,height:640,data:Buffer.alloc(360*640*4,128)},50).data),digest=productMediaDigest(bytes),url='https://assets.example.com/'+digest+'.jpg',scope={tenantId:'tenant',clientId:'client',appId:'300',provider:'META_INSTAGRAM_LOGIN' as const,purpose:'instagram_story_publishing' as const},prepared=await prepareApprovedJpegMedia(scope,digest,{resolve:async()=>({bytes,url,sourceReference:digest,aiGenerated:false,immutable:true,rights:{...scope,granted:true,contentDigest:digest,checkedAt:now,expiresAt:now+299000,source:'approved_media_adapter'}})});
 const owner:MetaAsset={key:'owner',id:'101',type:'INSTAGRAM_ACCOUNT',tenantId:'tenant',clientId:'client',provider:scope.provider,appId:'300',parents:[],verifiedAt:now,revokedAt:null,revision:1},source:MetaAsset={...owner,key:'source',id:'jpeg_'+digest,type:'MEDIA',parents:[{type:'INSTAGRAM_ACCOUNT',id:'101'}],mediaEvidence:prepared.evidence};
 expect(()=>assertApprovedJpegAsset(owner,source,url,false,Date.now(),'instagram_story_publishing')).not.toThrow();expect(()=>assertApprovedJpegAsset(owner,source,url,false,Date.now(),'instagram_content_publishing')).toThrow();
});
vi.setConfig({testTimeout:20000});
