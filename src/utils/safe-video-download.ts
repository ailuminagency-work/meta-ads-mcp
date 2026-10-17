import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import https from "node:https";
import type { RequestOptions } from "node:https";
import { UnsafeUrlError, type AssertSafeUrlOptions, type ResolvedSafePublicUrl } from "./url-guard.js";
import {
  assertAllowedHost,
  buildPinnedLookup,
  followSafeRedirects,
  isRedirect,
  parseContentLength,
  parseContentType,
  redirectTarget,
  type RedirectOrResult,
} from "./safe-http.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 0;
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4"]);

export interface SafeVideoDownloadOptions extends AssertSafeUrlOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Optional host allowlist by suffix, enforced on every hop. */
  allowedHostSuffixes?: string[];
  request?: typeof https.request;
}

export interface SafeVideoDownload {
  buffer: Buffer;
  contentType: string;
  extension: ".mp4";
  finalUrl: URL;
}

function extensionFor(_contentType:string):SafeVideoDownload["extension"] {return ".mp4";}
function normalizeVideoContentType(headers:IncomingHttpHeaders):string|null{return parseContentType(headers);}

function requestVideo(
  resolved: ResolvedSafePublicUrl,
  options: Required<Pick<SafeVideoDownloadOptions, "maxBytes" | "timeoutMs">> & {
    request: typeof https.request;
    signal?: AbortSignal;
  },
): Promise<RedirectOrResult<SafeVideoDownload>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    if (options.signal?.aborted) {
      reject(new UnsafeUrlError("Video download aborted"));
      return;
    }
    const reqOptions: RequestOptions = {
      method: "GET",
      headers: { Accept: "video/mp4" },
      lookup: buildPinnedLookup(resolved),
    };

    // Rejected responses are torn down, never drained, so an oversized video
    // does not keep transferring after the caller has moved on.
    const rejectAndClose = (res: IncomingMessage, err: UnsafeUrlError) => {
      settled = true;
      res.destroy();
      req.destroy();
      reject(err);
    };

    const req = options.request(resolved.url, reqOptions, (res: IncomingMessage) => {
      if (isRedirect(res.statusCode)) {
        let target: URL;
        try {
          target = redirectTarget(res, resolved.url);
        } catch (err) {
          rejectAndClose(res, err as UnsafeUrlError);
          return;
        }
        settled = true;
        res.destroy();
        req.destroy();
        resolve({ redirectUrl: target });
        return;
      }

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        rejectAndClose(res, new UnsafeUrlError(`Failed to download image: HTTP ${res.statusCode ?? "unknown"}`));
        return;
      }

      const contentType = normalizeVideoContentType(res.headers);
      if (!contentType || !ALLOWED_VIDEO_TYPES.has(contentType)) {
        rejectAndClose(res, new UnsafeUrlError(`Video content-type "${contentType ?? "missing"}" is not allowed`));
        return;
      }

      const contentLength = parseContentLength(res.headers);
      if (contentLength !== null && contentLength > options.maxBytes) {
        rejectAndClose(res, new UnsafeUrlError(`Video is too large: ${contentLength} bytes exceeds ${options.maxBytes}`));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;

      res.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > options.maxBytes) {
          rejectAndClose(res, new UnsafeUrlError(`Video is too large: exceeded ${options.maxBytes} bytes`));
          return;
        }
        chunks.push(buffer);
      });

      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          buffer: Buffer.concat(chunks),
          contentType,
          extension: extensionFor(contentType),
          finalUrl: resolved.url,
        });
      });

      res.on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err instanceof UnsafeUrlError ? err : new UnsafeUrlError(`Video download failed: ${err.message}`));
      });
    });

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new UnsafeUrlError(`Video download timed out after ${options.timeoutMs}ms`));
    });

    const onAbort = () => req.destroy(new UnsafeUrlError("Video download aborted"));
    options.signal?.addEventListener("abort", onAbort, { once: true });

    req.on("error", (err) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      reject(err instanceof UnsafeUrlError ? err : new UnsafeUrlError(`Video download failed: ${err.message}`));
    });
    req.on("close", () => options.signal?.removeEventListener("abort", onAbort));

    req.end();
  });
}

export async function downloadSafePublicVideo(
  rawUrl: string,
  options: SafeVideoDownloadOptions = {},
): Promise<SafeVideoDownload> {
  const request = options.request ?? https.request;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || maxRedirects !== 0 || !options.allowedHostSuffixes?.length) throw new UnsafeUrlError("Exact bounded video download policy required");

  return followSafeRedirects(
    rawUrl,
    {
      maxRedirects,
      resolve: options.resolve,
      signal: options.signal,
      what: "video",
      validateHop: options.allowedHostSuffixes ? (url) => assertAllowedHost(url, options.allowedHostSuffixes as string[], "video") : undefined,
    },
    (resolved) => requestVideo(resolved, { request, maxBytes, timeoutMs, signal: options.signal }),
  );
}
