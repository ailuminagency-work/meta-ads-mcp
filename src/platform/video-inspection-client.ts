import {productVersion} from "./product-version.js";
import {createHash} from 'node:crypto';
import {PRODUCT_CONTRACTS,type ProductContract} from './products/contracts.js';
import {VIDEO_INSPECTION_TOOL,VIDEO_INSPECTION_FIELDS,CREATIVE_VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_FIELDS,creativeVideoInspectionInput,videoInspectionInput,videoInspectionAccount,validateProviderVideoSource} from './video-inspection-contract.js';
import {decodeVideoInspection,assertDecodedVideoInspection,type DecodedVideoInspection} from './video-inspection-decoder.js';
import {PlatformDenied} from './models.js';
import {canonicalJson} from './policy.js';
import {assertExecutionPermit,getExecutionScope,revalidateExecutionPermit,withConnectionCredential} from './execution.js';
import {assertContractEligibility,contractPlanParameters,productRateController} from './clients.js';
import {downloadSafePublicVideo} from '../utils/safe-video-download.js';
import {readBodyWithLimit} from '../utils/bounded-body.js';
export class VideoInspectionClient{
 constructor(private readonly options:{fetcher?:typeof fetch;download?:typeof downloadSafePublicVideo;decode?:typeof decodeVideoInspection}={}){}
 async request(contract:ProductContract,targetId:string,input:Record<string,unknown>){
  contract=structuredClone(contract);input=structuredClone(input);const creative=contract.tool===CREATIVE_VIDEO_INSPECTION_TOOL,parameters=creative?creativeVideoInspectionInput(input):videoInspectionInput(input),videoId=creative?(parameters as {video_id:string}).video_id:targetId,canonical=PRODUCT_CONTRACTS.find(c=>c.tool===contract.tool&&[VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_TOOL].includes(c.tool));
  if(!canonical||canonicalJson(contract)!==canonicalJson(canonical)||! /^[1-9]\d{0,31}$/.test(targetId))throw new PlatformDenied('VIDEO_INSPECTION_EXACT_CONTRACT_REQUIRED');
  const permit=assertExecutionPermit({provider:'META_MARKETING',tool:contract.tool,mutation:false}),scope=getExecutionScope();
  if(scope.plan.capability!==contract.id||canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,targetId,input))||canonicalJson(scope.plan.classes)!==canonicalJson(contract.operationClasses)||canonicalJson(scope.plan.requiredScopes)!==canonicalJson(contract.requiredScopes)||canonicalJson(scope.plan.tokenTypes)!==canonicalJson(contract.tokenTypes))throw new PlatformDenied('VIDEO_INSPECTION_EXACT_PLAN_REQUIRED');
  const account=videoInspectionAccount(videoId,scope.snapshot.assets);
  return withConnectionCredential(permit,async token=>{
   const c=scope.snapshot.connection,bucket=createHash('sha256').update(canonicalJson([c.provider,c.appId,createHash('sha256').update(token).digest('hex')])).digest('hex');productRateController.bind(bucket,c.appId);
   const check=async()=>{await revalidateExecutionPermit(permit);if(productVersion("META_MARKETING")!=="v26.0")throw new PlatformDenied("VIDEO_INSPECTION_VERSION_UNVERIFIED");if(process.env.LUMIN_VIDEO_INSPECTION_ENABLED!=='true')throw new PlatformDenied('VIDEO_INSPECTION_DISABLED');videoInspectionAccount(videoId,getExecutionScope().snapshot.assets);assertContractEligibility(contract,getExecutionScope().snapshot.connection);productRateController.check(bucket);};
   const read=async(path:string,query:Record<string,string>)=>{await check();const url=new URL('https://graph.facebook.com/v26.0/'+path);for(const[k,v]of Object.entries(query))url.searchParams.set(k,v);let response:Response;try{response=await(this.options.fetcher??fetch)(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new PlatformDenied('VIDEO_INSPECTION_PROVIDER_UNAVAILABLE');}productRateController.observe(bucket,response,null);let value:unknown;try{value=JSON.parse(await readBodyWithLimit(response,131072));}catch{throw new PlatformDenied('VIDEO_INSPECTION_INVALID_RESPONSE');}if(!response.ok||!value||typeof value!=='object'||Array.isArray(value)||Object.hasOwn(value,'error'))throw new PlatformDenied('VIDEO_INSPECTION_INVALID_RESPONSE');return value as Record<string,unknown>;};
   if(creative){const node=await read(targetId,{fields:CREATIVE_VIDEO_INSPECTION_FIELDS}),registered=scope.snapshot.assets.filter(a=>a.type==='CREATIVE'&&a.id===targetId);if(registered.length!==1||!registered[0].parents.some(p=>p.type==='AD_ACCOUNT'&&p.id.replace(/^act_/, '')===account.id.replace(/^act_/, ''))||node.id!==targetId||node.account_id!==account.id.replace(/^act_/, '')||node.video_id!==videoId)throw new PlatformDenied('CREATIVE_ACTUAL_REGISTERED_VIDEO_RELATION_REQUIRED');}
   const edge=await read('act_'+account.id.replace(/^act_/, '')+'/advideos',{fields:'id',limit:'100'});
   if(!Array.isArray(edge.data)||edge.data.length>100||edge.data.some(v=>!v||typeof v!=='object'||Array.isArray(v)||Object.hasOwn(v,'error')||typeof v.id!=='string')||new Set(edge.data.map(v=>v.id)).size!==edge.data.length||edge.data.filter(v=>v.id===videoId).length!==1)throw new PlatformDenied('VIDEO_INSPECTION_ACTUAL_ACCOUNT_MEMBERSHIP_REQUIRED');
   if(edge.paging!==undefined&&(!edge.paging||typeof edge.paging!=='object'||Array.isArray(edge.paging)||Object.hasOwn(edge.paging,'next')))throw new PlatformDenied('VIDEO_INSPECTION_COMPLETE_MEMBERSHIP_REQUIRED');
   const source=validateProviderVideoSource(await read(videoId,{fields:VIDEO_INSPECTION_FIELDS}),videoId);let decodedSource:string;try{decodedSource=decodeURIComponent(source.url);}catch{throw new PlatformDenied('VIDEO_INSPECTION_CREDENTIAL_FREE_SOURCE_REQUIRED');}if(source.url.includes(token)||decodedSource.includes(token))throw new PlatformDenied('VIDEO_INSPECTION_CREDENTIAL_IN_SOURCE_DENIED');await check();
   let downloaded:Awaited<ReturnType<typeof downloadSafePublicVideo>>;try{downloaded=await(this.options.download??downloadSafePublicVideo)(source.url,{maxBytes:16*1024*1024,maxRedirects:0,timeoutMs:15000,allowedHostSuffixes:['.fbcdn.net']});}catch{throw new PlatformDenied('VIDEO_INSPECTION_PRIVATE_SOURCE_UNAVAILABLE');}
   await check();if(downloaded.finalUrl.toString()!==source.url||downloaded.contentType!=='video/mp4'||downloaded.buffer.length>16*1024*1024)throw new PlatformDenied('VIDEO_INSPECTION_PRIVATE_SOURCE_MISMATCH');
   const decoded:DecodedVideoInspection=await(this.options.decode??decodeVideoInspection)(downloaded.buffer,parameters.frame_count??3);assertDecodedVideoInspection(decoded,downloaded.buffer,parameters.frame_count??3);await check();
   return {metadata:{video_id:videoId,...(creative?{creative_id:targetId}:{}),duration_seconds:decoded.durationSeconds,width:decoded.width,height:decoded.height,frame_rate:decoded.frameRate,has_audio:decoded.hasAudio,frame_sampling_offsets_seconds:decoded.frames.map(f=>f.timestampSeconds),visual_frames_available:true,audio_transcribed:false,semantic_analysis_performed:false},frames:decoded.frames.map(f=>({timestampSeconds:f.timestampSeconds,width:f.width,height:f.height,bytes:Buffer.from(f.bytes)}))};
  });
 }
}
