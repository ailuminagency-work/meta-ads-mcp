import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { downloadSafePublicVideo } from "../../src/utils/safe-video-download.js";
import { UnsafeUrlError } from "../../src/utils/url-guard.js";

interface FakeResponse {
  statusCode?: number;
  headers?: IncomingHttpHeaders;
  chunks?: Array<Buffer | string>;
}

function fakeResolve(map: Record<string, string[]>) {
  return async (hostname: string) =>
    (map[hostname] ?? []).map((address) => ({ address }));
}

function makeRequest(responses: FakeResponse[]) {
  const calls: Array<{ url: URL; options: Record<string, unknown>; req: { destroy: ReturnType<typeof vi.fn> } }> = [];
  const request = vi.fn((urlInput: URL, options: Record<string, unknown>, callback: (res: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, cb?: () => void) => void;
      end: () => void;
      destroy: (err?: Error) => void;
    };
    req.setTimeout = vi.fn();
    req.destroy = vi.fn((err?: Error) => {
      if (err) queueMicrotask(() => req.emit("error", err));
    });
    calls.push({ url: urlInput, options, req: req as unknown as { destroy: ReturnType<typeof vi.fn> } });
    req.end = vi.fn(() => {
      queueMicrotask(() => {
        const next = responses.shift();
        if (!next) {
          req.emit("error", new Error("No fake response queued"));
          return;
        }
        const res = new PassThrough() as IncomingMessage;
        res.statusCode = next.statusCode ?? 200;
        res.headers = next.headers ?? {};
        callback(res);
        for (const chunk of next.chunks ?? []) {
          res.write(chunk);
        }
        res.end();
      });
    });
    return req;
  });

  return { request: request as never, calls };
}

async function runLookup(options: Record<string, unknown>): Promise<{ address: string; family: number }> {
  const lookup = options.lookup as (
    hostname: string,
    options: Record<string, unknown>,
    callback: (err: Error | null, address: string, family: number) => void,
  ) => void;
  return new Promise((resolve, reject) => {
    lookup("cdn.example.com", {}, (err, address, family) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ address, family });
    });
  });
}

describe("downloadSafePublicVideo",()=>{
 it("downloads only bounded MP4 and pins the verified public DNS address",async()=>{const {request,calls}=makeRequest([{headers:{"content-type":"video/mp4","content-length":"7"},chunks:[Buffer.from("mp4data")]}]),result=await downloadSafePublicVideo("https://cdn.example.com/approved.mp4",{request,resolve:fakeResolve({"cdn.example.com":["93.184.216.34"]}),allowedHostSuffixes:["cdn.example.com"]});expect(result.buffer.toString()).toBe("mp4data");expect(result.extension).toBe(".mp4");expect(result.contentType).toBe("video/mp4");await expect(runLookup(calls[0].options)).resolves.toEqual({address:"93.184.216.34",family:4});expect(calls[0].options.headers).toEqual({Accept:"video/mp4"});});
 it.each(["image/jpeg","text/html","application/octet-stream"])("rejects MIME substitution %s",async type=>{const {request,calls}=makeRequest([{headers:{"content-type":type},chunks:[Buffer.from("payload")]}]);await expect(downloadSafePublicVideo("https://cdn.example.com/approved.mp4",{request,resolve:fakeResolve({"cdn.example.com":["93.184.216.34"]}),allowedHostSuffixes:["cdn.example.com"]})).rejects.toBeInstanceOf(UnsafeUrlError);expect(calls[0].req.destroy).toHaveBeenCalled();});
 it("refuses redirects without contacting the next destination",async()=>{const {request,calls}=makeRequest([{statusCode:302,headers:{location:"https://foreign.example.com/video.mp4"}}]);await expect(downloadSafePublicVideo("https://cdn.example.com/approved.mp4",{request,resolve:fakeResolve({"cdn.example.com":["93.184.216.34"]}),allowedHostSuffixes:["cdn.example.com"]})).rejects.toBeInstanceOf(UnsafeUrlError);expect(calls).toHaveLength(1);});
 it("rejects private DNS before sending any request",async()=>{const {request}=makeRequest([]);await expect(downloadSafePublicVideo("https://cdn.example.com/approved.mp4",{request,resolve:fakeResolve({"cdn.example.com":["127.0.0.1"]}),allowedHostSuffixes:["cdn.example.com"]})).rejects.toBeInstanceOf(UnsafeUrlError);expect(request).not.toHaveBeenCalled();});
 it.each([{headers:{"content-type":"video/mp4","content-length":"100"},chunks:[]},{headers:{"content-type":"video/mp4"},chunks:[Buffer.alloc(6),Buffer.alloc(6)]}])("tears down oversized declared or streamed video",async response=>{const {request,calls}=makeRequest([response]);await expect(downloadSafePublicVideo("https://cdn.example.com/approved.mp4",{request,maxBytes:10,resolve:fakeResolve({"cdn.example.com":["93.184.216.34"]}),allowedHostSuffixes:["cdn.example.com"]})).rejects.toBeInstanceOf(UnsafeUrlError);expect(calls[0].req.destroy).toHaveBeenCalled();});
 it("rejects attempts to enlarge byte limits or permit redirects",async()=>{for(const options of [{maxBytes:16777217},{maxRedirects:1},{timeoutMs:30001}])await expect(downloadSafePublicVideo("https://cdn.example.com/approved.mp4",{...options,allowedHostSuffixes:["cdn.example.com"]})).rejects.toBeInstanceOf(UnsafeUrlError);});
});
