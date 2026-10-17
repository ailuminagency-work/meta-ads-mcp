import { PlatformDenied, type MetaAsset, type ThreadsReplyEvidence } from "./models.js";
import type { ProductContract } from "./products/contracts.js";

const CONTAINER_SOURCE = "https://developers.facebook.com/documentation/threads/reference/publishing";
const REPLY_SOURCE = "https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/replies-and-conversations";
const PENDING_SOURCE = "https://developers.facebook.com/documentation/threads/reply-management";
const INSTAGRAM_CONTAINER_SOURCE = "https://developers.facebook.com/documentation/instagram-platform/content-publishing";
const HIDE_STATUSES = ["NOT_HUSHED", "UNHUSHED", "HIDDEN", "COVERED", "BLOCKED", "RESTRICTED"];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformDenied("PRODUCT_OBSERVATION_SCHEMA_INVALID");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,100}$/.test(value)) throw new PlatformDenied("PRODUCT_OBSERVATION_ID_INVALID");
  return value;
}
function accountFor(target: MetaAsset, assets: MetaAsset[], now: number): MetaAsset {
  const roots = new Map<string, MetaAsset>();
  const visited = new Set<string>();
  const walk = (asset: MetaAsset): void => {
    if (visited.has(asset.key)) return;
    visited.add(asset.key);
    if (!["META_THREADS", "META_INSTAGRAM_LOGIN", "META_INSTAGRAM_FACEBOOK_LOGIN"].includes(target.provider) || asset.provider !== target.provider || asset.tenantId !== target.tenantId || asset.clientId !== target.clientId || asset.appId !== target.appId || asset.revokedAt !== null || !Number.isFinite(asset.verifiedAt) || asset.verifiedAt <= 0 || asset.verifiedAt > now || now - asset.verifiedAt > 60 * 60_000) throw new PlatformDenied("PRODUCT_OBSERVATION_PROVENANCE_INVALID");
    if (asset.type === (target.provider === "META_THREADS" ? "THREADS_ACCOUNT" : "INSTAGRAM_ACCOUNT")) { roots.set(asset.id, asset); return; }
    for (const parent of asset.parents) {
      const matches = assets.filter(candidate => candidate.id === parent.id && candidate.type === parent.type && candidate.provider === asset.provider);
      if (matches.length !== 1) throw new PlatformDenied("PRODUCT_OBSERVATION_PARENT_INVALID");
      walk(matches[0]!);
    }
  };
  walk(target);
  if (roots.size !== 1) throw new PlatformDenied("PRODUCT_OBSERVATION_ACCOUNT_INVALID");
  return [...roots.values()][0]!;
}

/** Pure interpretation of an authenticated, projected provider read; host owns permit validation and CAS. */
export function deriveProductAssetEvidence(contract: ProductContract, target: MetaAsset, response: unknown, assets: MetaAsset[], now: number): Partial<MetaAsset> | null {
  if (!["threads_container", "instagram_container"].includes(contract.assetEvidenceUpdate ?? "")) return null;
  const instagram = contract.assetEvidenceUpdate === "instagram_container";
  const statusKey = instagram ? "status_code" : "status";
  const toolProviders: Record<string, string> = { threads_get_post_status: "META_THREADS", instagram_get_container_status: "META_INSTAGRAM_FACEBOOK_LOGIN", instagram_login_get_container_status: "META_INSTAGRAM_LOGIN" };
  if (!contract.verified || toolProviders[contract.tool] !== contract.provider || target.provider !== contract.provider || contract.method !== "GET" || target.type !== "MEDIA" || target.mediaEvidence || instagram && (!target.createdFromOperationId || !["instagram_container","instagram_reel_container","instagram_story_container","instagram_carousel_item","instagram_carousel_container"].includes(target.productKind??"")) || !Number.isFinite(now) || now <= 0) throw new PlatformDenied("PRODUCT_OBSERVATION_CONTRACT_INVALID");
  const result = object(response);
  const status = result[statusKey];
  if (Object.keys(result).some(key => !["id", statusKey].includes(key)) || id(result.id) !== target.id || typeof status !== "string" || !["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"].includes(status)) throw new PlatformDenied("PRODUCT_OBSERVATION_SCHEMA_INVALID");
  if ((target.publishingEvidence?.published === true && status !== "PUBLISHED") || (target.publishingEvidence?.status === "EXPIRED" && status !== "EXPIRED")) throw new PlatformDenied("PRODUCT_OBSERVATION_TERMINAL_REGRESSION");
  const account = accountFor(target, assets, now);
  return { publishingEvidence: { kind: instagram ? "instagram_container" : "threads_container", accountId: account.id, appId: target.appId, status, published: status === "PUBLISHED", checkedAt: now, expiresAt: now + 300_000, verified: true, source: instagram ? INSTAGRAM_CONTAINER_SOURCE : CONTAINER_SOURCE } };
}

export interface ProductReplyObservation { assetKey: string; expectedRevision: number; patch: Pick<MetaAsset, "replyEvidence"> }
/** Refreshes already registered replies only; never creates assets, grants, or changes root ownership. */
export function deriveProductReplyObservations(contract: ProductContract, target: MetaAsset, response: unknown, assets: MetaAsset[], now: number): ProductReplyObservation[] {
  if (contract.assetEvidenceUpdate !== "threads_reply_list") return [];
  if (!contract.verified || contract.provider !== "META_THREADS" || target.provider !== "META_THREADS" || !["threads_list_replies", "threads_get_conversation", "threads_list_pending_replies"].includes(contract.tool) || contract.method !== "GET" || target.type !== "POST" || !Number.isFinite(now) || now <= 0 || target.replyEvidence?.isReply) throw new PlatformDenied("PRODUCT_OBSERVATION_CONTRACT_INVALID");
  const account = accountFor(target, assets, now);
  const result = object(response);
  if (!Array.isArray(result.data) || result.data.length > 1000 || Object.keys(result).some(key => key !== "data")) throw new PlatformDenied("PRODUCT_OBSERVATION_SCHEMA_INVALID");
  const observations: ProductReplyObservation[] = [];
  const seen = new Set<string>();
  for (const raw of result.data) {
    const reply = object(raw);
    if (Object.keys(reply).some(key => !["id", "timestamp", "media_type", "is_reply", "is_reply_owned_by_me", "hide_status", "root_post", "replied_to", "reply_approval_status"].includes(key)) || Object.keys(object(reply.root_post)).join() !== "id" || Object.keys(object(reply.replied_to)).join() !== "id") throw new PlatformDenied("PRODUCT_OBSERVATION_SCHEMA_INVALID");
    const replyId = id(reply.id), rootId = id(object(reply.root_post).id), parentId = id(object(reply.replied_to).id);
    if (seen.has(replyId) || replyId === target.id || rootId !== target.id || reply.is_reply !== true || typeof reply.hide_status !== "string" || !HIDE_STATUSES.includes(reply.hide_status)) throw new PlatformDenied("PRODUCT_REPLY_PROVENANCE_INVALID");
    seen.add(replyId);
    if (contract.tool === "threads_list_replies" && parentId !== rootId) throw new PlatformDenied("PRODUCT_REPLY_TOP_LEVEL_INVALID");
    const matches = assets.filter(asset => asset.id === replyId && asset.type === "POST" && asset.provider === "META_THREADS");
    if (!matches.length) continue;
    if (matches.length !== 1) throw new PlatformDenied("PRODUCT_REPLY_ASSET_AMBIGUOUS");
    const registered = matches[0]!;
    if (accountFor(registered, assets, now).id !== account.id || !registered.parents.some(parent => parent.type === "POST" && parent.id === target.id)) throw new PlatformDenied("PRODUCT_REPLY_ASSET_MISMATCH");
    const evidence: ThreadsReplyEvidence = { kind: "threads_reply", accountId: account.id, appId: target.appId, rootPostId: rootId, repliedToId: parentId, isReply: true, hideStatus: reply.hide_status, checkedAt: now, expiresAt: now + 300_000, verified: true, source: contract.tool === "threads_list_pending_replies" ? PENDING_SOURCE : REPLY_SOURCE };
    if (reply.is_reply_owned_by_me !== undefined) {
      if (typeof reply.is_reply_owned_by_me !== "boolean") throw new PlatformDenied("PRODUCT_REPLY_OWNERSHIP_INVALID");
      evidence.isOwnedByMe = reply.is_reply_owned_by_me;
    }
    if (contract.tool === "threads_list_pending_replies") {
      if (!["pending", "ignored"].includes(String(reply.reply_approval_status))) throw new PlatformDenied("PRODUCT_REPLY_APPROVAL_STATUS_INVALID");
      evidence.approvalStatus = reply.reply_approval_status as "pending" | "ignored";
    }
    observations.push({ assetKey: registered.key, expectedRevision: registered.revision, patch: { replyEvidence: evidence } });
  }
  return observations;
}
