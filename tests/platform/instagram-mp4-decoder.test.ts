import {readFile} from "node:fs/promises";
import {expect,it,vi} from "vitest";
import {decodeInstagramMp4} from "../../src/platform/instagram-mp4-decoder.js";
import {assertClosedGopH264,assertNoMp4EditLists} from "../../src/platform/h264-closed-gop.js";
it("fully decodes the exact progressive no-edit-list closed-GOP three-second fixture",async()=>{
 const bytes=await readFile(new URL("../fixtures/video/instagram-baseline-360x640-3s.mp4",import.meta.url)),result=await decodeInstagramMp4(bytes);
 expect(result).toMatchObject({verified:true,width:360,height:640,durationMs:3000,frameRate:24,progressive:true,closedGop:true,editLists:false});
});
it("rejects otherwise playable Page fixture with edit lists or insufficient Instagram duration",async()=>{
 const bytes=await readFile(new URL("../fixtures/video/standard-h264-320x240-1s.mp4",import.meta.url));await expect(decodeInstagramMp4(bytes)).rejects.toThrow();
});
it("rejects explicit nested edit lists and malformed atom bounds",()=>{
 const atom=(type:string,payload=Buffer.alloc(0))=>{const header=Buffer.alloc(8);header.writeUInt32BE(payload.length+8);header.write(type,4,"ascii");return Buffer.concat([header,payload]);};
 expect(()=>assertNoMp4EditLists(atom("moov",atom("trak",atom("edts"))))).toThrow("INSTAGRAM_MP4_NO_EDIT_LISTS_REQUIRED");expect(()=>assertNoMp4EditLists(Buffer.from([0,0,0,30,109,111,111,118]))).toThrow();
});
it("rejects unknown or truncated H.264 slice proof",()=>{
 for(const bytes of [Buffer.alloc(32),Buffer.from([0,0,0,1,0x67,1,2,3,0,0,0,1,0x68,1,0,0,1,0x61,0])])expect(()=>assertClosedGopH264(bytes)).toThrow("INSTAGRAM_CLOSED_GOP_PROOF_REQUIRED");
});
it("accepts only IDR-initialized I/P slices and rejects open-GOP, B and partitioned slices",()=>{
 const nal=(header:number,...payload:number[])=>Buffer.from([0,0,0,1,header,...payload]),prefix=Buffer.concat([nal(0x67,0x42,0,0x1e),nal(0x68,0xce,0x06)]),idr=nal(0x65,0xb8),p=nal(0x41,0xe0);
 expect(()=>assertClosedGopH264(Buffer.concat([prefix,idr,p,idr,p]))).not.toThrow();
 for(const stream of [Buffer.concat([prefix,p,idr]),Buffer.concat([prefix,idr,nal(0x41,0xa0)]),Buffer.concat([prefix,idr,nal(0x61,0xb8)]),Buffer.concat([prefix,idr,nal(0x42,0xe0)]),Buffer.concat([prefix,idr,nal(0x74,0xe0)])])expect(()=>assertClosedGopH264(stream)).toThrow("INSTAGRAM_CLOSED_GOP_PROOF_REQUIRED");
});

// Actual isolated decoding has bounded subprocess deadlines; allow their sum under shared CI contention.
vi.setConfig({testTimeout:40000});
