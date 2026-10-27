export interface OAuthStoreTtlPolicy {
  collectionGroup: "mcp_auth_codes" | "mcp_refresh_jti" | "mcp_session_jti" | "mcp_clients";
  field: "expireTime";
  maximumDays: number;
  basis: string;
}

const DAY_SECONDS = 86_400;

export const AUTH_CODE_GRACE_SECONDS = 3_600;
export const JTI_GRACE_SECONDS = DAY_SECONDS;
export const CLIENT_IDLE_RETENTION_DAYS = 90;
export const CLIENT_EXTENSION_THRESHOLD_DAYS = 45;

const AUTH_CODE_LIFETIME_SECONDS = 600;
const TOKEN_LIFETIME_SECONDS = 30 * DAY_SECONDS;

/**
 * Application expiry is always enforced on read; expireTime only lets Firestore
 * reap records that are already dead. It is never earlier than the logical
 * expiry, so a TTL policy can never shorten a credential's validity.
 */
export const OAUTH_STORE_TTL_POLICIES: readonly OAuthStoreTtlPolicy[] = Object.freeze([
  { collectionGroup: "mcp_auth_codes", field: "expireTime", maximumDays: (AUTH_CODE_LIFETIME_SECONDS + AUTH_CODE_GRACE_SECONDS) / DAY_SECONDS, basis: "entry.expiresAt plus one hour" },
  { collectionGroup: "mcp_refresh_jti", field: "expireTime", maximumDays: (TOKEN_LIFETIME_SECONDS + JTI_GRACE_SECONDS) / DAY_SECONDS, basis: "entry.expiresAt plus one day" },
  { collectionGroup: "mcp_session_jti", field: "expireTime", maximumDays: (TOKEN_LIFETIME_SECONDS + JTI_GRACE_SECONDS) / DAY_SECONDS, basis: "entry.expiresAt plus one day" },
  { collectionGroup: "mcp_clients", field: "expireTime", maximumDays: CLIENT_IDLE_RETENTION_DAYS, basis: "last use plus 90 days; extended on use when under 45 days remain" },
]);

/**
 * Collections that carry erasure tombstones, no-resend barriers, ambiguous
 * mutation claims or spend reservations. Expiry must never delete them; the
 * conditional ones may only receive expireTime once the unsafe state is gone.
 */
export const NEVER_TTL_COLLECTIONS: readonly string[] = Object.freeze([
  "platform_meta_privacy_subject_locks",
  "platform_meta_privacy_provenance",
  "platform_crm_no_resend",
  "platform_whatsapp_setup_phone_locks",
  "businessOwnerAttestations",
]);

export const CONDITIONAL_TTL_COLLECTIONS: readonly string[] = Object.freeze([
  "researchFinancialCheckpoints",
  "researchBudgets",
  "whatsappSetupCommands",
  "platform_meta_privacy_jobs",
  "platform_meta_privacy_receipts",
]);

export function expireTimeAfter(expiresAtSeconds: number, graceSeconds: number): Date {
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0 || !Number.isSafeInteger(graceSeconds) || graceSeconds < 0) {
    throw new Error("RETENTION_EXPIRY_INVALID");
  }
  return new Date((expiresAtSeconds + graceSeconds) * 1000);
}

export function authCodeExpireTime(entry: { expiresAt: number }): Date {
  return expireTimeAfter(entry.expiresAt, AUTH_CODE_GRACE_SECONDS);
}

export function jtiExpireTime(entry: { expiresAt: number }): Date {
  return expireTimeAfter(entry.expiresAt, JTI_GRACE_SECONDS);
}

export function clientExpireTime(nowMs: number = Date.now()): Date {
  return new Date(nowMs + CLIENT_IDLE_RETENTION_DAYS * DAY_SECONDS * 1000);
}

type TimestampLike = Date | { toDate(): Date } | null | undefined;

export function clientNeedsExtension(expireTime: TimestampLike, nowMs: number = Date.now()): boolean {
  if (expireTime === null || expireTime === undefined) return true;
  const at = expireTime instanceof Date ? expireTime.getTime() : expireTime.toDate().getTime();
  return !Number.isFinite(at) || at - nowMs < CLIENT_EXTENSION_THRESHOLD_DAYS * DAY_SECONDS * 1000;
}

/** Persistence metadata must not leak into protocol objects returned to the OAuth SDK. */
export function withoutExpireTime<T extends object>(data: T): Omit<T, "expireTime"> {
  const { expireTime: _expireTime, ...rest } = data as T & { expireTime?: unknown };
  return rest;
}
