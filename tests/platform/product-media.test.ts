import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { assertApprovedJpegAsset, inspectJpeg, prepareApprovedJpegMedia, productMediaDigest, validatePublicJpegUrl, type TrustedJpegSource } from "../../src/platform/product-media.js";
import { decodeVerifiedJpeg } from "../../src/platform/jpeg-decoder.js";
import { assertInstagramPublicationQuota } from "../../src/platform/instagram-quota.js";
import type { MetaAsset } from "../../src/platform/models.js";

const bytes = Uint8Array.from(jpeg.encode({ width: 320, height: 320, data: Buffer.alloc(320 * 320 * 4, 128) }, 50).data);
const digest = productMediaDigest(bytes), url = `https://assets.example.com/${digest}.jpg`;
const scope = { tenantId: "t", clientId: "c", provider: "META_INSTAGRAM_LOGIN" as const, appId: "a" };
function source(): TrustedJpegSource { const now = Date.now(); return { bytes, url, sourceReference: digest, immutable: true, aiGenerated: false, rights: { ...scope, granted: true, purpose: "instagram_content_publishing", contentDigest: digest, checkedAt: now, expiresAt: now + 300000, source: "approved_media_adapter" } }; }
const account: MetaAsset = { key: "account", id: "10", type: "INSTAGRAM_ACCOUNT", ...scope, parents: [], verifiedAt: Date.now(), revokedAt: null, revision: 1 };
describe("actual trusted JPEG source validation", () => {
  it.each([NaN,Infinity,-1,0,1.5])("denies an invalid injected validation clock %s",now=>{
    expect(()=>assertApprovedJpegAsset(account,account,url,false,now)).toThrow("APPROVED_MEDIA_CLOCK_REQUIRED");
  });
  it("decodes actual pixels in a bounded worker and binds scoped rights, URL and AI metadata", async () => {
    expect(inspectJpeg(bytes)).toEqual({ width: 320, height: 320 });
    const prepared = await prepareApprovedJpegMedia(scope, digest, { resolve: async () => source() });
    expect(prepared.evidence.contentDigest).toBe(digest);
    expect(prepared.evidence.aiGenerated).toBe(false);
    const asset: MetaAsset = { ...account, key: "source", id: "source1", type: "MEDIA", parents: [{ type: "INSTAGRAM_ACCOUNT", id: "10" }], mediaEvidence: prepared.evidence };
    expect(() => assertApprovedJpegAsset(account, asset, url, false)).not.toThrow();
    expect(() => assertApprovedJpegAsset(account, asset, url, true)).toThrow("APPROVED_CLIENT_JPEG_SOURCE_REQUIRED");
    expect(() => assertApprovedJpegAsset(account, { ...asset, clientId: "other" }, url, false)).toThrow("APPROVED_CLIENT_JPEG_SOURCE_REQUIRED");
  });
  it("rejects a JPEG-looking structural shell without successful pixel decoding", async () => {
    const shell = Uint8Array.from([255,216,255,192,0,17,8,1,64,1,64,3,1,17,0,2,17,0,3,17,0,255,218,0,12,3,1,0,2,17,3,17,0,63,0,1,255,217]);
    expect(inspectJpeg(shell)).toEqual({ width: 320, height: 320 });
    await expect(decodeVerifiedJpeg(shell)).rejects.toThrow("APPROVED_JPEG_DECODING_REQUIRED");
  });
  it.each(["foreign-client", "withdrawn", "expired", "digest-mismatch", "mutable"])("denies %s source evidence", async mode => {
    const item = source();
    if (mode === "foreign-client") item.rights.clientId = "foreign";
    if (mode === "withdrawn") Object.assign(item.rights, { granted: false });
    if (mode === "expired") item.rights.expiresAt = Date.now() - 1;
    if (mode === "digest-mismatch") item.rights.contentDigest = "a".repeat(64);
    if (mode === "mutable") Object.assign(item, { immutable: false });
    await expect(prepareApprovedJpegMedia(scope, digest, { resolve: async () => item })).rejects.toThrow();
  });
  it.each(["https://127.0.0.1/a.jpg", "https://user:password@example.com/a.jpg", "https://example.com/a.jpg?access_token=synthetic", "https://example.com/a.jpg?signature=synthetic", "http://example.com/a.jpg", "https://example.com/a.jpg#fragment"])("denies unsafe media URL %s", value => {
    expect(() => validatePublicJpegUrl(value)).toThrow();
  });
});
describe("live Instagram publication quota gate", () => {
  it("honors the lower of provider quota and conservative local 50 limit", () => {
    expect(() => assertInstagramPublicationQuota({ data: [{ quota_usage: 49, config: { quota_total: 100, quota_duration: 86400 } }] })).not.toThrow();
    for (const [usage, total] of [[50,100],[10,10]]) expect(() => assertInstagramPublicationQuota({ data: [{ quota_usage: usage, config: { quota_total: total, quota_duration: 86400 } }] })).toThrow("INSTAGRAM_PUBLISHING_QUOTA_EXHAUSTED");
  });
  it.each([{}, { data: [] }, { data: [{ quota_usage: "0", config: { quota_total: 50, quota_duration: 86400 } }] }, { data: [{ quota_usage: 0, config: { quota_total: 50, quota_duration: 60 } }] }])("denies unverifiable quota %#", value => {
    expect(() => assertInstagramPublicationQuota(value)).toThrow("INSTAGRAM_PUBLISHING_QUOTA_UNVERIFIED");
  });
});
