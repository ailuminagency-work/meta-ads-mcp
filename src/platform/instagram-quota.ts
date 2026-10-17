import { PlatformDenied } from "./models.js";

export const INSTAGRAM_PUBLICATION_PREFLIGHT = Object.freeze({ method: "GET", path: "/{asset_id}/content_publishing_limit", fields: "quota_usage,config", localMaximum: 50, quotaDuration: 86400 });
export function requiresInstagramPublicationQuota(tool: string): boolean { return ["instagram_publish_container", "instagram_login_publish"].includes(tool); }
export function assertInstagramPublicationQuota(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformDenied("INSTAGRAM_PUBLISHING_QUOTA_UNVERIFIED");
  const body = value as { data?: unknown };
  if (!Array.isArray(body.data) || body.data.length !== 1 || !body.data[0] || typeof body.data[0] !== "object" || Array.isArray(body.data[0])) throw new PlatformDenied("INSTAGRAM_PUBLISHING_QUOTA_UNVERIFIED");
  const row = body.data[0] as { quota_usage?: unknown; config?: unknown };
  if (!row.config || typeof row.config !== "object" || Array.isArray(row.config)) throw new PlatformDenied("INSTAGRAM_PUBLISHING_QUOTA_UNVERIFIED");
  const config = row.config as { quota_total?: unknown; quota_duration?: unknown };
  if (!Number.isSafeInteger(row.quota_usage) || Number(row.quota_usage) < 0 || !Number.isSafeInteger(config.quota_total) || Number(config.quota_total) <= 0 || config.quota_duration !== 86400) throw new PlatformDenied("INSTAGRAM_PUBLISHING_QUOTA_UNVERIFIED");
  if (Number(row.quota_usage) >= Math.min(50, Number(config.quota_total))) throw new PlatformDenied("INSTAGRAM_PUBLISHING_QUOTA_EXHAUSTED");
}
