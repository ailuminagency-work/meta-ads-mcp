import {approvedJpegPurpose,approvedJpegRootType} from "./media-purpose.js";
import { createHash } from "node:crypto";
import { PlatformDenied, type MetaAsset, type Provider } from "./models.js";
import { unsafeIpReason } from "../utils/url-guard.js";
import { decodeVerifiedJpeg } from "./jpeg-decoder.js";

export interface ApprovedMediaScope { tenantId: string; clientId: string; provider: Provider; appId: string; purpose?:import("./media-purpose.js").ApprovedJpegPurpose }
export interface TrustedJpegSource {
  bytes: Uint8Array;
  url: string;
  sourceReference: string;
  aiGenerated: boolean;
  immutable: true;
  rights: ApprovedMediaScope & { granted: true; purpose: "instagram_content_publishing" | "facebook_content_publishing" | "whatsapp_messaging"|"facebook_messaging"|"instagram_messaging"|"meta_ad_image_upload"|"threads_content_publishing"|"instagram_story_publishing"; contentDigest: string; checkedAt: number; expiresAt: number; source: "approved_media_adapter" };
}
export interface TrustedJpegSourceResolver { resolve(scope: ApprovedMediaScope, sourceReference: string): Promise<TrustedJpegSource> }
export function productMediaDigest(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function validatePublicJpegUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[^\x21-\x7e]/.test(value)) throw new PlatformDenied("APPROVED_PUBLIC_IMAGE_URL_REQUIRED");
  let url: URL;
  try { url = new URL(value); } catch { throw new PlatformDenied("APPROVED_PUBLIC_IMAGE_URL_REQUIRED"); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") || !hostname.includes(".") || unsafeIpReason(hostname) || /(?:^|\.)(localhost|local|internal)$/i.test(hostname) || [...url.searchParams.keys()].some(key => /token|secret|password|credential|authorization|signature|(?:^|_)sig(?:$|_)|(?:^|_)key(?:$|_)/i.test(key))) throw new PlatformDenied("APPROVED_PUBLIC_IMAGE_URL_REQUIRED");
  return value;
}

/** Bounded structural inspection; prepareApprovedJpegMedia also requires actual isolated pixel decoding. */
export function inspectJpeg(bytes: Uint8Array,purpose?:import("./media-purpose.js").ApprovedJpegPurpose): { width: number; height: number } {
  if (bytes.length < 12 || bytes.length > 8 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new PlatformDenied("APPROVED_JPEG_BYTES_REQUIRED");
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  let segments = 0;
  while (offset < bytes.length - 2 && ++segments < 10000) {
    if (bytes[offset++] !== 0xff) throw new PlatformDenied("APPROVED_JPEG_STRUCTURE_REQUIRED");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) {
      if (!dimensions || offset + 2 > bytes.length) throw new PlatformDenied("APPROVED_JPEG_STRUCTURE_REQUIRED");
      const scanLength = bytes[offset]! * 256 + bytes[offset + 1]!;
      if (scanLength < 6 || offset + scanLength >= bytes.length - 2) throw new PlatformDenied("APPROVED_JPEG_STRUCTURE_REQUIRED");
      return dimensions;
    }
    if (marker === undefined || marker === 0xd9 || marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) throw new PlatformDenied("APPROVED_JPEG_STRUCTURE_REQUIRED");
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length - 2) throw new PlatformDenied("APPROVED_JPEG_STRUCTURE_REQUIRED");
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 11 || bytes[offset + 2] !== 8) throw new PlatformDenied("APPROVED_JPEG_STRUCTURE_REQUIRED");
      const height = bytes[offset + 3]! * 256 + bytes[offset + 4]!, width = bytes[offset + 5]! * 256 + bytes[offset + 6]!;
      if (dimensions && (dimensions.width !== width || dimensions.height !== height)) throw new PlatformDenied("APPROVED_JPEG_STRUCTURE_REQUIRED");
      if (width < 320 || width > 1440 || height < 1 || (purpose==="instagram_story_publishing"?(height>4096||width*height>4000000||width/height<0.1||width/height>10):(width/height<0.8||width/height>1.91))) throw new PlatformDenied("INSTAGRAM_JPEG_DIMENSIONS_REQUIRED");
      dimensions = { width, height };
    }
    offset += length;
  }
  throw new PlatformDenied("APPROVED_JPEG_STRUCTURE_REQUIRED");
}

export async function prepareApprovedJpegMedia(scope: ApprovedMediaScope, sourceReference: string, resolver: TrustedJpegSourceResolver, now = Date.now()): Promise<{ url: string; evidence: NonNullable<MetaAsset["mediaEvidence"]> }> {
  if (!["META_THREADS","META_MARKETING","META_MESSENGER","META_INSTAGRAM_LOGIN", "META_INSTAGRAM_FACEBOOK_LOGIN", "META_FACEBOOK_PAGES", "META_WHATSAPP"].includes(scope.provider) || !/^[A-Za-z0-9_-]{1,200}$/.test(sourceReference)) throw new PlatformDenied("APPROVED_MEDIA_SCOPE_REQUIRED");
  scope = structuredClone(scope);
  const source = structuredClone(await resolver.resolve(scope, sourceReference)), rights = source.rights;
  if(scope.provider === "META_WHATSAPP" && source.bytes.length > 5 * 1024 * 1024) throw new PlatformDenied("WHATSAPP_JPEG_TOO_LARGE");
  const url = validatePublicJpegUrl(source.url), digest = productMediaDigest(source.bytes), dimensions = inspectJpeg(source.bytes,approvedJpegPurpose(scope.provider,scope.purpose));
  const decoded = await decodeVerifiedJpeg(source.bytes,approvedJpegPurpose(scope.provider,scope.purpose)==="instagram_story_publishing"?"instagram_story_publishing":undefined);
  now = Math.max(now, Date.now());
  if (decoded.contentDigest !== digest || decoded.width !== dimensions.width || decoded.height !== dimensions.height || typeof source.aiGenerated !== "boolean") throw new PlatformDenied("APPROVED_JPEG_DECODING_REQUIRED");
  if (source.immutable !== true || sourceReference !== digest || !new URL(url).pathname.includes(digest)) throw new PlatformDenied("IMMUTABLE_APPROVED_MEDIA_REQUIRED");
  if (source.sourceReference !== sourceReference || rights.source !== "approved_media_adapter" || rights.purpose !== approvedJpegPurpose(scope.provider,scope.purpose) || rights.granted !== true || rights.tenantId !== scope.tenantId || rights.clientId !== scope.clientId || rights.provider !== scope.provider || rights.appId !== scope.appId || rights.contentDigest !== digest || !Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(rights.checkedAt) || rights.checkedAt <= 0 || rights.checkedAt > now || now - rights.checkedAt > 300000 || !Number.isSafeInteger(rights.expiresAt) || rights.expiresAt <= now || rights.expiresAt > rights.checkedAt + 300000) throw new PlatformDenied("APPROVED_MEDIA_RIGHTS_UNVERIFIED");
  return { url, evidence: { kind: "approved_jpeg", purpose:rights.purpose, urlDigest: productMediaDigest(url), contentDigest: digest, mimeType: "image/jpeg", aiGenerated: source.aiGenerated, byteLength: source.bytes.length, width: dimensions.width, height: dimensions.height, rightsGranted: true, checkedAt: rights.checkedAt, expiresAt: rights.expiresAt, source: "approved_media_adapter", sourceReference } };
}

export function assertApprovedJpegAsset(target: MetaAsset, source: MetaAsset, imageUrl: unknown, isAiGenerated: unknown, now = Date.now(), purpose?:import("./media-purpose.js").ApprovedJpegPurpose): void {
  if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("APPROVED_MEDIA_CLOCK_REQUIRED");
  const evidence = source.mediaEvidence;
  if (!evidence || evidence.sourceReference !== evidence.contentDigest || typeof imageUrl !== "string" || !new URL(validatePublicJpegUrl(imageUrl)).pathname.includes(evidence.contentDigest)) throw new PlatformDenied("APPROVED_CLIENT_JPEG_SOURCE_REQUIRED");
  if (source.type !== "MEDIA" || source.provider !== target.provider || source.tenantId !== target.tenantId || source.clientId !== target.clientId || source.appId !== target.appId || source.revokedAt !== null || source.publishingEvidence || !source.parents.some(parent => parent.type === (approvedJpegRootType(target.provider,purpose)) && parent.id === target.id) || !evidence || evidence.kind !== "approved_jpeg" || evidence.purpose !== approvedJpegPurpose(target.provider,purpose) || evidence.mimeType !== "image/jpeg" || typeof evidence.aiGenerated !== "boolean" || evidence.aiGenerated !== isAiGenerated || evidence.rightsGranted !== true || evidence.source !== "approved_media_adapter" || !/^[a-f0-9]{64}$/.test(evidence.contentDigest) || evidence.urlDigest !== productMediaDigest(validatePublicJpegUrl(imageUrl)) || !Number.isSafeInteger(evidence.checkedAt) || evidence.checkedAt <= 0 || evidence.checkedAt > now || now - evidence.checkedAt > 300000 || !Number.isSafeInteger(evidence.expiresAt) || evidence.expiresAt <= now || evidence.expiresAt > evidence.checkedAt + 300000 || !Number.isSafeInteger(evidence.byteLength) || evidence.byteLength < 12 || evidence.byteLength > (target.provider === "META_WHATSAPP" ? 5 : 8) * 1024 * 1024 || !Number.isSafeInteger(evidence.width) || !Number.isSafeInteger(evidence.height) || evidence.width < 320 || evidence.width > 1440 || evidence.height < 1 || (evidence.purpose==="instagram_story_publishing"?(evidence.height>4096||evidence.width*evidence.height>4000000||evidence.width/evidence.height<0.1||evidence.width/evidence.height>10):(evidence.width/evidence.height<0.8||evidence.width/evidence.height>1.91))) throw new PlatformDenied("APPROVED_CLIENT_JPEG_SOURCE_REQUIRED");
}
