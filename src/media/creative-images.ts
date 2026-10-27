import { logger } from "../utils/logger.js";
import { downloadSafePublicImage, type SafeImageDownloadOptions, type SafeImageDownload } from "../utils/safe-download.js";
import { errorLine, imageBlock, safeHostname, type ContentBlock } from "./content-blocks.js";
import { resolveAllowedMediaHostSuffixes } from "./media-hosts.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TOTAL_BYTES_BUDGET = 20 * 1024 * 1024;
/** Wall-clock cap for one image, redirects and DNS included. */
export const IMAGE_DOWNLOAD_DEADLINE_MS = 20_000;
/** Wall-clock cap for the whole set of images a single call attaches. */
export const IMAGE_BATCH_DEADLINE_MS = 60_000;
export const MAX_IMAGE_ATTEMPTS = 20;

/**
 * The parts of an image asset this helper reads and writes. Callers keep their
 * own richer shapes (role, hashes, dimensions) around it.
 */
export interface DownloadableImage {
  source_url?: string;
  downloaded: boolean;
  block_index?: number;
  mime_type?: string;
  bytes?: number;
  error?: string;
  skipped?: "max_images" | "size_budget" | "aborted" | "max_attempts" | "time_budget";
  /** Only used for the log line, never for the response. */
  role?: string;
}

export interface FetchImageBlocksOptions {
  maxImages: number;
  /** Shared with whatever else the response carries (video media, above all). */
  totalBytesBudget?: number;
  /** Already spent by the caller before these images. */
  bytesUsed?: number;
  signal?: AbortSignal;
  /** Hosts an image may come from; Meta's CDN hosts unless a caller narrows or the operator overrides them. */
  allowedHostSuffixes?: string[];
  /** Download attempts, successful or not; a creative full of dead links must not become a fetch storm. */
  maxAttempts?: number;
  /** Wall-clock cap for every attempt together. */
  batchDeadlineMs?: number;
  /** Wall-clock cap for one attempt. */
  perImageDeadlineMs?: number;
  download?: (url: string, options?: SafeImageDownloadOptions) => Promise<SafeImageDownload>;
}

export interface FetchImageBlocksResult {
  blocks: ContentBlock[];
  bytes: number;
}

/**
 * Downloads creative images into MCP image blocks under a count and a byte
 * budget, recording on each asset what happened to it. Extracted from
 * ads_get_creative_media so the dossier attaches images the same way, with
 * the same caps and the same failure reporting.
 *
 * The url on an asset is whatever the creative says: a picture field can name
 * any host. Only Meta CDN hosts are fetched, checked before any DNS lookup, so
 * a creative cannot make this server probe other hosts or ports or hold a
 * connection open, and the error text it gets back says nothing about them.
 */
export async function fetchCreativeImageBlocks(
  assets: DownloadableImage[],
  options: FetchImageBlocksOptions,
): Promise<FetchImageBlocksResult> {
  const download = options.download ?? downloadSafePublicImage;
  const budget = options.totalBytesBudget ?? IMAGE_TOTAL_BYTES_BUDGET;
  const allowedHostSuffixes = options.allowedHostSuffixes ?? resolveAllowedMediaHostSuffixes();
  const maxAttempts = options.maxAttempts ?? Math.min(MAX_IMAGE_ATTEMPTS, Math.max(1, options.maxImages) * 2);
  const perImageDeadlineMs = options.perImageDeadlineMs ?? IMAGE_DOWNLOAD_DEADLINE_MS;
  const batchTimer = AbortSignal.timeout(options.batchDeadlineMs ?? IMAGE_BATCH_DEADLINE_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, batchTimer]) : batchTimer;
  const blocks: ContentBlock[] = [];
  let used = options.bytesUsed ?? 0;
  const startedAt = used;
  let attempts = 0;

  for (const asset of assets) {
    if (!asset.source_url) continue;
    if (options.signal?.aborted) {
      asset.skipped = "aborted";
      continue;
    }
    if (batchTimer.aborted) {
      asset.skipped = "time_budget";
      continue;
    }
    if (blocks.length >= options.maxImages) {
      asset.skipped = "max_images";
      continue;
    }
    if (attempts >= maxAttempts) {
      asset.skipped = "max_attempts";
      continue;
    }
    const remaining = budget - used;
    if (remaining <= 0) {
      asset.skipped = "size_budget";
      continue;
    }
    attempts += 1;
    try {
      const downloaded = await download(asset.source_url, {
        maxBytes: Math.min(MAX_IMAGE_BYTES, remaining),
        signal,
        deadlineMs: perImageDeadlineMs,
        allowedHostSuffixes,
      });
      used += downloaded.buffer.length;
      asset.block_index = blocks.length;
      blocks.push(imageBlock(downloaded.buffer, downloaded.contentType));
      asset.downloaded = true;
      asset.mime_type = downloaded.contentType;
      asset.bytes = downloaded.buffer.length;
    } catch (err) {
      // A download error can quote the url it failed on, credentials included.
      asset.error = errorLine(err);
      logger.warn({ imageHost: safeHostname(asset.source_url), role: asset.role }, "Creative image download failed");
    }
  }

  return { blocks, bytes: used - startedAt };
}
