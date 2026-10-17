import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {PlatformDenied} from "./models.js";
let active=0;
export const MAX_STANDARD_MP4_BYTES=16*1024*1024;
function fastStartMp4(bytes:Uint8Array):void {
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0,boxes=0,moov=false,mdat=false;
 while(offset<b.length&&++boxes<=128){if(offset+8>b.length)throw new Error();const size=b.readUInt32BE(offset),type=b.toString("ascii",offset+4,offset+8);if(size<8||offset+size>b.length||!/^[A-Za-z0-9 ]{4}$/.test(type))throw new Error();if(offset===0&&(type!=="ftyp"||size<16||!["isom","iso2","mp41","mp42","avc1"].includes(b.toString("ascii",offset+8,offset+12))))throw new Error();if(type==="moov"){if(moov||mdat||size>2*1024*1024)throw new Error();moov=true;}if(type==="mdat"){if(!moov||mdat)throw new Error();mdat=true;}if(!["ftyp","moov","mdat","free","wide","skip"].includes(type))throw new Error();offset+=size;}
 if(offset!==b.length||!moov||!mdat)throw new Error();
}
async function run(binary:"ffprobe"|"ffmpeg",args:string[],bytes:Uint8Array,timeout:number):Promise<string>{
 return new Promise((resolve,reject)=>{let output="",settled=false;const child=spawn(binary,args,{shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"]});
  const finish=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill("SIGKILL");child.stdin.destroy();if(ok)resolve(output);else reject(new PlatformDenied("APPROVED_MP4_DECODING_REQUIRED"));};
  const timer=setTimeout(()=>finish(false),timeout);child.once("error",()=>finish(false));child.once("close",code=>finish(code===0));child.stdout.on("data",(data:Buffer)=>{output+=data.toString("utf8");if(Buffer.byteLength(output)>65536)finish(false);});let stderr=0;child.stderr.on("data",(data:Buffer)=>{stderr+=data.length;if(stderr>65536)finish(false);});child.stdin.on("error",(error:NodeJS.ErrnoException)=>{if(!["EPIPE","EOF"].includes(error.code??""))finish(false);});child.stdin.end(bytes);
 });
}
/** Actual full decode, fixed pipe-only executables, bounded bytes/pixels/frames/time/concurrency; no URLs or filenames enter the process arguments. */
export async function decodeVerifiedMp4(value:Uint8Array):Promise<{verified:true;mimeType:"video/mp4";contentDigest:string;byteLength:number;width:number;height:number;durationMs:number;frameRate:number;videoCodec:"h264";pixelFormat:"yuv420p";audioCodec:"aac"|null}>{
 if(!(value instanceof Uint8Array)||value.length<128||value.length>MAX_STANDARD_MP4_BYTES)throw new PlatformDenied("APPROVED_MP4_DECODING_REQUIRED");if(active>=1)throw new PlatformDenied("MP4_DECODER_BUSY");const bytes=Uint8Array.from(value);active++;
 try{
  fastStartMp4(bytes);
  const text=await run("ffprobe",["-v","error","-max_alloc","67108864","-max_pixels","2073600","-protocol_whitelist","pipe","-f","mov","-i","pipe:0","-show_entries","stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,nb_frames,sample_rate,channels:stream_side_data=rotation:format=duration,format_name","-of","json"],bytes,5000),raw=JSON.parse(text) as {streams?:Array<Record<string,unknown>>;format?:{duration?:string;format_name?:string}};
  const streams=raw.streams??[],video=streams.filter(s=>s.codec_type==="video"),audio=streams.filter(s=>s.codec_type==="audio");if(video.length!==1||audio.length>1||streams.length!==video.length+audio.length)throw new Error();const v=video[0],width=Number(v.width),height=Number(v.height),duration=Number(raw.format?.duration),frames=Number(v.nb_frames),fps=(x:unknown)=>{if(typeof x!=="string"||!/^\d+\/\d+$/.test(x))throw new Error();const[n,d]=x.split("/").map(Number);return n/d;},frameRate=fps(v.avg_frame_rate),declaredRate=fps(v.r_frame_rate);
  if(v.side_data_list!==undefined&&(!Array.isArray(v.side_data_list)||v.side_data_list.some((row:unknown)=>!row||typeof row!=="object"||("rotation"in row&&(!Number.isFinite((row as {rotation:unknown}).rotation)||(row as {rotation:number}).rotation!==0)))))throw new Error();
  if(v.codec_name!=="h264"||v.pix_fmt!=="yuv420p"||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<320||height<240||width>1920||height>1920||Math.min(width,height)>1080||width*height>2073600||width%2||height%2||!Number.isFinite(duration)||duration<=0||duration>60||!Number.isFinite(frameRate)||frameRate<=0||frameRate>30||!Number.isFinite(declaredRate)||declaredRate<=0||declaredRate>30||!Number.isSafeInteger(frames)||frames<1||frames>1800||audio.some(a=>a.codec_name!=="aac"||![44100,48000].includes(Number(a.sample_rate))||![1,2].includes(Number(a.channels))))throw new Error();
  const decoded=await run("ffmpeg",["-nostdin","-hide_banner","-v","error","-xerror","-err_detect","explode","-max_alloc","67108864","-threads","1","-filter_threads","1","-max_pixels","2073600","-protocol_whitelist","pipe","-f","mov","-i","pipe:0","-map","0:v:0","-map","0:a:0?","-frames:v","1801","-progress","pipe:1","-nostats","-f","null","-"],bytes,10000),actualFrames=[...decoded.matchAll(/^frame=(\d+)\s*$/gm)].map(m=>Number(m[1])),times=[...decoded.matchAll(/^out_time_us=(\d+)\s*$/gm)].map(m=>Number(m[1]));
  if(!decoded.includes("progress=end")||actualFrames.at(-1)!==frames||times.some(t=>t>61000000))throw new Error();
  return {verified:true,mimeType:"video/mp4",contentDigest:createHash("sha256").update(bytes).digest("hex"),byteLength:bytes.length,width,height,durationMs:Math.ceil(duration*1000),frameRate,videoCodec:"h264",pixelFormat:"yuv420p",audioCodec:audio.length?"aac":null};
 }catch(error){if(error instanceof PlatformDenied)throw error;throw new PlatformDenied("APPROVED_MP4_DECODING_REQUIRED");}finally{active--;}
}
