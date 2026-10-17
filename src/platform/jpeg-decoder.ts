import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { PlatformDenied } from "./models.js";

const decoderPath = createRequire(import.meta.url).resolve("jpeg-js");
let activeDecoders = 0;
const WORKER_SOURCE = `
const {parentPort,workerData}=require('node:worker_threads');
try {
  const jpeg=require(workerData.decoderPath);
  const image=jpeg.decode(Buffer.from(workerData.bytes),{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:4,maxMemoryUsageInMB:64});
  if(!image || image.data.length!==image.width*image.height*4)throw new Error();
  parentPort.postMessage({width:image.width,height:image.height});
} catch { parentPort.postMessage({error:true}); }
`;

/** Actual decoding is isolated from the HTTP event loop with bounded memory, time and concurrency. */
export async function decodeVerifiedJpeg(bytes: Uint8Array,purpose?:"instagram_story_publishing"): Promise<{ verified: true; mimeType: "image/jpeg"; contentDigest: string; width: number; height: number }> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > 8 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new PlatformDenied("APPROVED_JPEG_DECODING_REQUIRED");
  if (activeDecoders >= 2) throw new PlatformDenied("JPEG_DECODER_BUSY");
  bytes = Uint8Array.from(bytes);
  activeDecoders++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { decoderPath, bytes }, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
      let settled = false;
      const finish = (result?: { width: number; height: number }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void worker.terminate().catch(() => undefined);
        if (!result || !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width < 320 || result.width > 1440 || result.height < 1 || (purpose==="instagram_story_publishing"?(result.height>4096||result.width*result.height>4000000||result.width/result.height<0.1||result.width/result.height>10):(result.width/result.height<0.8||result.width/result.height>1.91))) reject(new PlatformDenied("APPROVED_JPEG_DECODING_REQUIRED"));
        else resolve({ verified: true, mimeType: "image/jpeg", contentDigest: createHash("sha256").update(bytes).digest("hex"), width: result.width, height: result.height });
      };
      const timeout = setTimeout(() => finish(), 2000);
      worker.once("message", message => { const result = message as { error?: unknown; width?: number; height?: number }; finish(result.error ? undefined : { width: result.width!, height: result.height! }); });
      worker.once("error", () => finish());
      worker.once("exit", () => { if (!settled) finish(); });
    });
  } finally { activeDecoders--; }
}
