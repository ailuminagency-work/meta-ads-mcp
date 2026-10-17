import { describe, expect, it } from "vitest";
import { assertProductAssetRelationships, validateProductInput, type ThreadsPublishingEvidence } from "../../src/platform/product-inputs.js";
import type { MetaAsset } from "../../src/platform/models.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";

describe("Threads bounded publishing input", () => {
  it("requires an explicit boolean for Page hiding and denies injected body fields", () => {
    expect(() => validateProductInput("pages_hide_comment", { is_hidden: true })).not.toThrow();
    expect(() => validateProductInput("pages_hide_comment", { is_hidden: false })).not.toThrow();
    for (const input of [{}, { is_hidden: "true" }, { is_hidden: true, message: "rewrite" }]) expect(() => validateProductInput("pages_hide_comment", input)).toThrow("LUMIN_PAGE_COMMENT_HIDE_SCHEMA_REQUIRED");
  });
  const draft = { media_type: "TEXT", is_carousel_item: false, text: "A draft for review" };
  it("accepts a text-only draft without silently publishing", () => {
    expect(() => validateProductInput("threads_create_container", draft)).not.toThrow();
    const contract = PRODUCT_CONTRACTS.find(c => c.tool === "threads_create_container")!;
    expect(contract.verified).toBe(true);
    expect(contract.requiredScopes).toEqual(["threads_basic", "threads_content_publish"]);
    expect(contract.allowedInputKeys).not.toContain("auto_publish_text");
    expect(contract.responseFields).toEqual(["id"]);
  });
  it.each([
    { ...draft, auto_publish_text: true }, { ...draft, media_type: "IMAGE" },
    { ...draft, is_carousel_item: true }, { ...draft, text: " " },
    { ...draft, text: "a".repeat(501) }, { ...draft, text: "😀".repeat(126) },
    { ...draft, text: "Visit https://example.com" }, { ...draft, text: "www.example.com" },
    { ...draft, reply_to_id: "123" },
  ])("denies unsupported draft input %#", input => {
    expect(() => validateProductInput("threads_create_container", input)).toThrow("LUMIN_THREADS_TEXT_DRAFT_SCHEMA_REQUIRED");
  });
  it("accepts the conservative UTF-8 boundary", () => {
    expect(() => validateProductInput("threads_create_container", { ...draft, text: "😀".repeat(125) })).not.toThrow();
  });
  it("requires a separate registered MEDIA reference for explicit publication", () => {
    expect(() => validateProductInput("threads_publish_container", { creation_id: "123" })).not.toThrow();
    const contract = PRODUCT_CONTRACTS.find(c => c.tool === "threads_publish_container")!;
    expect(contract.assetInputKeys).toEqual({ creation_id: "MEDIA" });
    expect(contract.manualRequirements.join(" ")).toContain("exact-plan approval");
    for (const input of [{}, { creation_id: 123 }, { creation_id: "../123" }, { creation_id: "123", text: "injected" }]) {
      expect(() => validateProductInput("threads_publish_container", input)).toThrow("LUMIN_THREADS_PUBLISH_SCHEMA_REQUIRED");
    }
  });
  it.each(["valid", "own-claim", "foreign-claim", "claimed-preflight", "wrong-account", "wrong-client", "missing-parent", "stale", "future", "published", "processing", "wrong-source"])("checks trusted publication provenance: %s", mode => {
    const now = Date.now();
    const account: MetaAsset = { key: "account", id: "10", type: "THREADS_ACCOUNT", tenantId: "t", clientId: "c", provider: "META_THREADS", appId: "a", parents: [], verifiedAt: now, revokedAt: null, revision: 1 };
    const other: MetaAsset = { ...account, id: "20", key: "other" };
    const evidence: ThreadsPublishingEvidence = { kind: "threads_container", accountId: "10", appId: "a", status: mode === "processing" ? "IN_PROGRESS" : "FINISHED", published: mode === "published", checkedAt: mode === "stale" ? now - 300001 : mode === "future" ? now + 1000 : now, expiresAt: now + 10000, source: mode === "wrong-source" ? "caller" : "https://developers.facebook.com/documentation/threads/reference/publishing", verified: true };
    const container: MetaAsset & { publishingEvidence: ThreadsPublishingEvidence } = { ...account, key: "container", id: "123", type: "MEDIA", clientId: mode === "wrong-client" ? "other-client" : "c", parents: mode === "missing-parent" ? [] : [{ type: "THREADS_ACCOUNT", id: mode === "wrong-account" ? "20" : "10" }], publishingEvidence: evidence };
    const contract = PRODUCT_CONTRACTS.find(c => c.tool === "threads_publish_container")!;
    if (["own-claim", "foreign-claim", "claimed-preflight"].includes(mode)) container.publicationClaim = { operationId: "operation-one", claimedAt: now };
    const check = () => assertProductAssetRelationships(contract, "10", { creation_id: "123" }, [account, other, container], mode === "own-claim" ? "operation-one" : mode === "foreign-claim" ? "operation-two" : undefined);
    if (["valid", "own-claim"].includes(mode)) expect(check).not.toThrow(); else expect(check).toThrow();
  });
});
