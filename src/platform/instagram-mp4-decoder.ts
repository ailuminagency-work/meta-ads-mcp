import {spawn} from "node:child_process";
import {PlatformDenied} from "./models.js";
import {decodeVerifiedMp4,MAX_STANDARD_MP4_BYTES} from "./mp4-decoder.js";
import {assertClosedGopH264,assertNoMp4EditLists} from "./h264-closed-gop.js";
let active=false;
async function fixedProcess(binary:"ffprobe"|"ffmpeg",args:readonly string[],bytes:Uint8Array,maxOutput:number):Promise<Buffer>{
 return new Promise((resolve,reject)=>{const chunks:Buffer[]=[];let total=0,stderr=0,done=false;const child=spawn(binary,[...args],{shell:false,windowsHide:true,env:{PATH:process.env.PATH},stdio:["pipe","pipe","pipe"]}),finish=(ok:boolean)=>{if(done)return;done=true;clearTimeout(timer);child.kill("SIGKILL");child.stdin.destroy();if(ok)resolve(Buffer.concat(chunks));else reject(new PlatformDenied("INSTAGRAM_MP4_ENCODING_PROOF_REQUIRED"));},timer=setTimeout(()=>finish(false),10000);
 child.once("error",()=>finish(false));child.once("close",code=>finish(code===0));child.stdin.on("error",(error:NodeJS.ErrnoException)=>{if(!["EPIPE","EOF"].includes(error.code??""))finish(false);});child.stdout.on("data",(chunk:Buffer)=>{total+=chunk.length;if(total>maxOutput){finish(false);return;}chunks.push(chunk);});child.stderr.on("data",(chunk:Buffer)=>{stderr+=chunk.length;if(stderr>65536)finish(false);});child.stdin.end(bytes);
 });
}
/** Narrow documented Instagram subset, checked against the bytes and actual encoded H.264 slices. */
export async function decodeInstagramMp4(value:Uint8Array){
 if(active)throw new PlatformDenied("INSTAGRAM_MP4_DECODER_BUSY");if(!(value instanceof Uint8Array)||value.length>MAX_STANDARD_MP4_BYTES)throw new PlatformDenied("INSTAGRAM_MP4_ENCODING_PROOF_REQUIRED");active=true;const bytes=Uint8Array.from(value);
 try{assertNoMp4EditLists(bytes);const decoded=await decodeVerifiedMp4(bytes);
  if(decoded.durationMs<3000||decoded.frameRate<23||decoded.width>1920||decoded.width/decoded.height<0.1||decoded.width/decoded.height>10||bytes.length*8/(decoded.durationMs/1000)>25000000)throw new Error();
  const common=["-v","error","-max_alloc","67108864","-max_pixels","2073600","-protocol_whitelist","pipe","-f","mov","-i","pipe:0"],metadata=JSON.parse((await fixedProcess("ffprobe",[...common,"-show_entries","stream=codec_type,field_order,has_b_frames,bit_rate,sample_rate,channels","-of","json"],bytes,65536)).toString("utf8")) as {streams?:Array<Record<string,unknown>>},video=metadata.streams?.find(s=>s.codec_type==="video"),audio=metadata.streams?.filter(s=>s.codec_type==="audio")??[];
  if(!video||video.field_order!=="progressive"||video.has_b_frames!==0||audio.some(a=>!Number.isFinite(Number(a.bit_rate))||Number(a.bit_rate)<=0||Number(a.bit_rate)>128000||![44100,48000].includes(Number(a.sample_rate))||![1,2].includes(Number(a.channels))))throw new Error();
  const elementary=await fixedProcess("ffmpeg",["-nostdin","-hide_banner",...common,"-map","0:v:0","-c:v","copy","-bsf:v","h264_mp4toannexb","-an","-f","h264","pipe:1"],bytes,17*1024*1024);assertClosedGopH264(elementary);
  return {...decoded,progressive:true as const,closedGop:true as const,editLists:false as const,encodingSource:"ACTUAL_MP4_AND_H264_INSPECTION" as const};
 }catch(error){if(error instanceof PlatformDenied)throw error;throw new PlatformDenied("INSTAGRAM_MP4_ENCODING_PROOF_REQUIRED");}finally{active=false;}
}
