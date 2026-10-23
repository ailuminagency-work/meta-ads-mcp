import { describe, expect, it } from "vitest";
import { deriveProductAssetEvidence, deriveProductReplyObservations } from "../../src/platform/product-evidence.js";
import { assertProductAssetRelationships, validateProductInput } from "../../src/platform/product-inputs.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import type { MetaAsset } from "../../src/platform/models.js";
const now = Date.now();
const account: MetaAsset = { key: "account", id: "10", type: "THREADS_ACCOUNT", tenantId: "t", clientId: "c", provider: "META_THREADS", appId: "a", parents: [], verifiedAt: now - 1000, revokedAt: null, revision: 1 };
const post: MetaAsset = { ...account, key: "post", id: "20", type: "POST", parents: [{ type: "THREADS_ACCOUNT", id: account.id }] };
const child: MetaAsset = { ...post, key: "child", id: "30", parents: [{ type: "POST", id: post.id }] };
const container: MetaAsset = { ...post, key: "container", id: "40", type: "MEDIA" };
const contract = (tool: string) => PRODUCT_CONTRACTS.find(c => c.tool === tool)!;
const row = { id: "30", root_post: { id: "20" }, replied_to: { id: "20" }, is_reply: true, hide_status: "NOT_HUSHED" };
describe("trusted product observation derivation", () => {
  it.each(["FINISHED", "PUBLISHED", "IN_PROGRESS", "ERROR", "EXPIRED"])("preserves exact container %s status without modifying claims", status => {
    const patch = deriveProductAssetEvidence(contract("threads_get_post_status"), container, { id: "40", status }, [account, container], now)!;
    expect(patch.publishingEvidence?.status).toBe(status);
    expect(patch.publishingEvidence?.published).toBe(status === "PUBLISHED");
    expect(Object.keys(patch)).toEqual(["publishingEvidence"]);
    expect(patch.publishingEvidence?.expiresAt).toBe(now + 300000);
  });
  it.each([{ id: "99", status: "FINISHED" }, { id: "40", status: "READY" }, { id: "40", status: "FINISHED", published: false }])("rejects unsupported container response %#", response => {
    expect(() => deriveProductAssetEvidence(contract("threads_get_post_status"), container, response, [account, container], now)).toThrow();
  });
  it("does not resurrect a published or expired container through a later ready observation", () => {
    for (const status of ["PUBLISHED", "EXPIRED"]) {
      const prior = deriveProductAssetEvidence(contract("threads_get_post_status"), container, { id: "40", status }, [account, container], now)!;
      expect(() => deriveProductAssetEvidence(contract("threads_get_post_status"), { ...container, ...prior }, { id: "40", status: "FINISHED" }, [account, container], now + 1)).toThrow("PRODUCT_OBSERVATION_TERMINAL_REGRESSION");
    }
  });
  it("refreshes only registered same-root replies and enables bounded moderation", () => {
    const observations = deriveProductReplyObservations(contract("threads_list_replies"), post, { data: [row, { ...row, id: "31" }] }, [account, post, child], now);
    expect(observations).toHaveLength(1);
    expect(observations[0]!.assetKey).toBe(child.key);
    expect(observations[0]!.expectedRevision).toBe(child.revision);
    const refreshed = { ...child, ...observations[0]!.patch };
    expect(() => assertProductAssetRelationships(contract("threads_manage_reply"), child.id, { hide: true }, [account, post, refreshed])).not.toThrow();
    expect(Object.keys(observations[0]!.patch)).toEqual(["replyEvidence"]);
  });
  it.each(["foreign-root", "foreign-client", "nested", "duplicate", "missing-hide"])("rejects invalid reply observation %s", mode => {
    const responseRow = { ...row, root_post: { id: mode === "foreign-root" ? "999" : "20" }, replied_to: { id: mode === "nested" ? "29" : "20" }, hide_status: mode === "missing-hide" ? undefined : row.hide_status };
    const registered = { ...child, clientId: mode === "foreign-client" ? "other" : "c" };
    expect(() => deriveProductReplyObservations(contract("threads_list_replies"), post, { data: mode === "duplicate" ? [responseRow, responseRow] : [responseRow] }, [account, post, registered], now)).toThrow();
  });
  it("requires fresh pending evidence for approval, then removes it on ordinary observation", () => {
    const pending = deriveProductReplyObservations(contract("threads_list_pending_replies"), post, { data: [{ ...row, reply_approval_status: "pending" }] }, [account, post, child], now)[0]!.patch;
    expect(() => assertProductAssetRelationships(contract("threads_manage_pending_reply"), child.id, { approve: true }, [account, post, { ...child, ...pending }])).not.toThrow();
    const ordinary = deriveProductReplyObservations(contract("threads_list_replies"), post, { data: [row] }, [account, post, { ...child, ...pending }], now)[0]!.patch;
    expect(ordinary.replyEvidence?.approvalStatus).toBeUndefined();
    expect(() => assertProductAssetRelationships(contract("threads_manage_pending_reply"), child.id, { approve: true }, [account, post, { ...child, ...ordinary }])).toThrow("THREADS_PENDING_REPLY_REQUIRED");
  });
  it("requires explicit moderation booleans and denies injected fields", () => {
    expect(() => validateProductInput("threads_manage_reply", { hide: false })).not.toThrow();
    expect(() => validateProductInput("threads_manage_pending_reply", { approve: true })).not.toThrow();
    expect(() => validateProductInput("threads_manage_reply", { hide: "true" })).toThrow();
    expect(() => validateProductInput("threads_manage_pending_reply", { approve: true, text: "injected" })).toThrow();
  });
});
