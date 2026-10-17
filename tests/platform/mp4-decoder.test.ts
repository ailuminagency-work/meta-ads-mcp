import {readFile} from "node:fs/promises";
import {it,expect,vi} from "vitest";
import {decodeVerifiedMp4} from "../../src/platform/mp4-decoder.js";
const fixture=()=>readFile(new URL("../fixtures/video/standard-h264-320x240-1s.mp4",import.meta.url));
it("actually decodes every frame of the bounded standard MP4 fixture",async()=>{const bytes=await fixture(),decoded=await decodeVerifiedMp4(bytes);expect(decoded).toMatchObject({verified:true,mimeType:"video/mp4",width:320,height:240,durationMs:1000,frameRate:24,videoCodec:"h264",pixelFormat:"yuv420p",audioCodec:null});expect(decoded.contentDigest).toMatch(/^[a-f0-9]{64}$/);expect(decoded.byteLength).toBe(bytes.length);});
it.each(["not-mp4","truncated","wrong-brand","trailing-box","corrupt-video"])("rejects %s rather than trusting declared metadata",async mode=>{let bytes=Buffer.from(await fixture());if(mode==="not-mp4")bytes=Buffer.from("not an approved video".repeat(100));if(mode==="truncated")bytes=bytes.subarray(0,bytes.length-128);if(mode==="wrong-brand")bytes.write("qt  ",8,"ascii");if(mode==="trailing-box")bytes=Buffer.concat([bytes,Buffer.from([0,0,0,8,109,111,111,118])]);if(mode==="corrupt-video")bytes.fill(0,bytes.length-20000,bytes.length-1000);await expect(decodeVerifiedMp4(bytes)).rejects.toThrow("APPROVED_MP4_DECODING_REQUIRED");});

it("accepts bounded portrait video using actual decoded dimensions",async()=>{const bytes=await readFile(new URL("../fixtures/video/standard-h264-720x1280-half-second.mp4",import.meta.url));expect(await decodeVerifiedMp4(bytes)).toMatchObject({width:720,height:1280,durationMs:500,frameRate:24});});

// Actual isolated decoding has bounded subprocess deadlines; allow their sum under shared CI contention.
vi.setConfig({testTimeout:20000});
