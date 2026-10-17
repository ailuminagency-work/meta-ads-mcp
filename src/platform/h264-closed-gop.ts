import {PlatformDenied} from "./models.js";

/** Validate a bounded Annex-B H.264 stream extracted from the exact MP4 bytes. */
export function assertClosedGopH264(value:Uint8Array):void{
 const deny=():never=>{throw new PlatformDenied("INSTAGRAM_CLOSED_GOP_PROOF_REQUIRED");};
 if(value.length<16||value.length>17*1024*1024)deny();
 const starts:Array<{start:number;header:number}>=[];
 for(let i=0;i+3<value.length;i++)if(value[i]===0&&value[i+1]===0&&(value[i+2]===1||(value[i+2]===0&&value[i+3]===1))){const header=i+(value[i+2]===1?3:4);starts.push({start:i,header});i=header-1;if(starts.length>20000)deny();}
 if(!starts.length||starts[0].start!==0)deny();let slices=0,idr=0,sps=false,pps=false;
 for(let n=0;n<starts.length;n++){
  const {header}=starts[n],end=n+1<starts.length?starts[n+1].start:value.length;if(header>=end)deny();const byte=value[header],type=byte&31;if(byte&128||![1,5,6,7,8,9,10,11,12].includes(type))deny();if(type===7)sps=true;if(type===8)pps=true;
  if(type!==1&&type!==5)continue;if(!sps||!pps||++slices>10000)deny();
  // Slice header starts with first_mb_in_slice and slice_type, both unsigned Exp-Golomb.
  const rbsp:number[]=[];let zeros=0;
  for(let i=header+1;i<end&&rbsp.length<64;i++){const b=value[i];if(zeros>=2&&b===3){zeros=0;continue;}rbsp.push(b);zeros=b===0?zeros+1:0;}
  let bit=0;const read=()=>{if(bit>=rbsp.length*8)deny();const result=(rbsp[bit>>3]>>(7-(bit&7)))&1;bit++;return result;},ue=()=>{let zeros=0;while(read()===0)if(++zeros>24)deny();let value=0;for(let i=0;i<zeros;i++)value=value*2+read();return 2**zeros-1+value;};
  ue();const slice=ue();if(slice>9)deny();const kind=slice%5;
  // B/SP/SI slices and non-IDR I slices are outside this intentionally narrow subset.
  if(![0,2].includes(kind)||(type===5&&kind!==2)||(type===1&&kind!==0))deny();
  if(slices===1&&type!==5)deny();if(type===5)idr++;
 }
 if(!slices||!idr)deny();
}

/** Explicit edit-list rejection; never infer normalization merely from fast-start layout. */
export function assertNoMp4EditLists(value:Uint8Array):void{
 const b=Buffer.from(value.buffer,value.byteOffset,value.byteLength);let boxes=0;
 const walk=(start:number,end:number,depth:number):void=>{if(depth>8)throw new Error();for(let at=start;at<end;){if(at+8>end||++boxes>10000)throw new Error();const size=b.readUInt32BE(at),type=b.toString("ascii",at+4,at+8);if(size<8||at+size>end||["edts","elst"].includes(type))throw new Error();if(["moov","trak","mdia","minf","stbl"].includes(type))walk(at+8,at+size,depth+1);at+=size;}};
 try{walk(0,b.length,0);}catch{throw new PlatformDenied("INSTAGRAM_MP4_NO_EDIT_LISTS_REQUIRED");}
}
