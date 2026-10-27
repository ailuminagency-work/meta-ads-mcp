import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../utils/logger.js";
import { abortableSleep, throwIfAborted } from "../utils/abortable.js";
import { createHash } from "node:crypto";

/**
 * Context threaded with every Graph API request so rate-limit usage is tracked
 * per (token, account, use-case type) bucket instead of as a single global.
 * An agency with many ad accounts must not let one hot account slow down the
 * others.
 */
export interface RequestContext {
  tokenHash: string;
  accountId?: string;
}

/**
 * One bucket per resource Meta tracks independently. Keys are opaque strings
 * composed by `bucketKey(...)`.
 */
export interface UsageBucket {
  kind: "app" | "buc" | "insights" | "acc" | "reach" | "local_retry";
  key: string;
  callCount: number;
  cpuTime: number;
  totalTime: number;
  estimatedTimeToRegainAccessMs: number;
  adsApiAccessTier?: "development_access" | "standard_access" | string;
  updatedAt: number;
}

interface BucUsageEntry {
  type?: string;
  call_count?: number;
  total_cputime?: number;
  total_time?: number;
  estimated_time_to_regain_access?: number; // in minutes
  ads_api_access_tier?: string;
}

interface InsightsThrottleHeader {
  app_id_util_pct?: number;
  acc_id_util_pct?: number;
  ads_api_access_tier?: string;
}

interface AdAccountUsageHeader {
  acc_id_util_pct?: number;
  reset_time_duration?: number;
  ads_api_access_tier?: string;
}

interface ReachThrottleHeader {
  call_count?: number;
  reset_time_duration?: number;
}

/**
 * Rate limiter that reads Meta's usage headers per request and decides when to
 * self-throttle before the next call. Parses:
 *
 *  - X-App-Usage (platform limits, per token)
 *  - X-Business-Use-Case-Usage (BUC limits, per business_id × type)
 *  - x-fb-ads-insights-throttle (Insights-specific app/account load)
 *  - x-ad-account-usage (ad-account-level quota)
 *  - x-Fb-Ads-Insights-Reach-Throttle (10/day cap for reach+breakdowns >13mo)
 *
 * Strategy per bucket:
 *  - When the header carries `estimated_time_to_regain_access` (minutes),
 *    that's authoritative: self-wait for that long.
 *  - Otherwise fall back to a usage-based staircase (linear 75–95 %,
 *    exponential above 95 %) so we self-slow before Meta throttles us.
 */
export const USAGE_BUCKET_TTL_MS = 60 * 60 * 1000;
export const MAX_USAGE_BUCKETS = 5_000;
/** The longest pause a call is held for; a longer block is reported to the caller instead of slept through. */
export const MAX_SELF_THROTTLE_WAIT_MS = 30_000;
const SWEEP_INTERVAL_MS = 60_000;
// The platform limiter (src/platform/product-rate-usage.ts) caps the same Meta field at 1440 minutes.
export const MAX_REGAIN_ACCESS_MS = 24 * 60 * 60 * 1000;
const CLOCK_STEP_TOLERANCE_MS = 1_000;

export class RateLimiter {
  private readonly buckets = new Map<string, UsageBucket>();
  private lastSweepMs = 0;

  constructor(
    private readonly bucketTtlMs = USAGE_BUCKET_TTL_MS,
    private readonly maxBuckets = MAX_USAGE_BUCKETS,
  ) {}

  updateFromHeaders(headers: Headers, context: RequestContext): void {
    const now = Date.now();
    this.sweep(now);

    // ── X-App-Usage ──────────────────────────────────────
    const appUsage = headers.get("x-app-usage");
    if (appUsage) {
      const parsed = safeParse<BucUsageEntry>(appUsage);
      if (parsed) {
        this.writeBucket({
          kind: "app",
          key: bucketKey("app", context.tokenHash),
          callCount: parsed.call_count ?? 0,
          cpuTime: parsed.total_cputime ?? 0,
          totalTime: parsed.total_time ?? 0,
          estimatedTimeToRegainAccessMs: 0,
          updatedAt: now,
        });
      }
    }

    // ── X-Business-Use-Case-Usage ────────────────────────
    const buc = headers.get("x-business-use-case-usage");
    if (buc) {
      const parsed = safeParse<Record<string, BucUsageEntry[]>>(buc);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [businessId, entries] of Object.entries(parsed)) {
          if (!/^\d{1,32}$/.test(businessId) || !Array.isArray(entries)) continue;
          for (const entry of entries) {
            if (!entry || typeof entry !== "object") continue;
            const type = safeBucType(entry.type);
            if (!type) continue;
            this.writeBucket({
              kind: "buc",
              key: bucketKey("buc", context.tokenHash, businessId, type),
              callCount: entry.call_count ?? 0,
              cpuTime: entry.total_cputime ?? 0,
              totalTime: entry.total_time ?? 0,
              estimatedTimeToRegainAccessMs:
                (entry.estimated_time_to_regain_access ?? 0) * 60 * 1000,
              adsApiAccessTier: entry.ads_api_access_tier,
              updatedAt: now,
            });
          }
        }
      }
    }

    // ── x-fb-ads-insights-throttle ───────────────────────
    const insightsThrottle = headers.get("x-fb-ads-insights-throttle");
    if (insightsThrottle) {
      const parsed = safeParse<InsightsThrottleHeader>(insightsThrottle);
      if (parsed) {
        // App-scoped portion
        this.writeBucket({
          kind: "insights",
          key: bucketKey("insights", context.tokenHash, "app"),
          callCount: parsed.app_id_util_pct ?? 0,
          cpuTime: 0,
          totalTime: 0,
          estimatedTimeToRegainAccessMs: 0,
          adsApiAccessTier: parsed.ads_api_access_tier,
          updatedAt: now,
        });
        // Account-scoped portion
        if (context.accountId) {
          this.writeBucket({
            kind: "insights",
            key: bucketKey(
              "insights",
              context.tokenHash,
              "acc",
              context.accountId,
            ),
            callCount: parsed.acc_id_util_pct ?? 0,
            cpuTime: 0,
            totalTime: 0,
            estimatedTimeToRegainAccessMs: 0,
            adsApiAccessTier: parsed.ads_api_access_tier,
            updatedAt: now,
          });
        }
      }
    }

    // ── x-ad-account-usage ───────────────────────────────
    const accUsage = headers.get("x-ad-account-usage");
    if (accUsage && context.accountId) {
      const parsed = safeParse<AdAccountUsageHeader>(accUsage);
      if (parsed) {
        this.writeBucket({
          kind: "acc",
          key: bucketKey("acc", context.tokenHash, context.accountId),
          callCount: parsed.acc_id_util_pct ?? 0,
          cpuTime: 0,
          totalTime: 0,
          estimatedTimeToRegainAccessMs:
            (parsed.reset_time_duration ?? 0) * 1000,
          adsApiAccessTier: parsed.ads_api_access_tier,
          updatedAt: now,
        });
      }
    }

    // ── x-Fb-Ads-Insights-Reach-Throttle ─────────────────
    const reach = headers.get("x-fb-ads-insights-reach-throttle");
    if (reach && context.accountId) {
      const parsed = safeParse<ReachThrottleHeader>(reach);
      if (parsed) {
        this.writeBucket({
          kind: "reach",
          key: bucketKey("reach", context.tokenHash, context.accountId),
          callCount: parsed.call_count ?? 0,
          cpuTime: 0,
          totalTime: 0,
          estimatedTimeToRegainAccessMs: (parsed.reset_time_duration ?? 0) * 1000,
          updatedAt: now,
        });
      }
    }
  }

  /**
   * Record a retry-after hint derived from an error body (headers sometimes
   * lag). Always account-scoped: we never want a per-account throttle signal
   * to block sibling accounts under the same token. The circuit breaker is
   * responsible for broader stops (e.g. abuse signal).
   */
  markRetryAfter(
    context: RequestContext,
    type: string,
    retryAfterMs: number,
  ): void {
    if (!(retryAfterMs > 0)) return;
    const scope = context.accountId ?? "_";
    const key = bucketKey("local_retry", context.tokenHash, scope, type);
    const now = Date.now();
    this.sweep(now);
    this.buckets.set(key, {
      kind: "local_retry",
      key,
      callCount: 0,
      cpuTime: 0,
      totalTime: 0,
      estimatedTimeToRegainAccessMs: Math.min(retryAfterMs, MAX_REGAIN_ACCESS_MS),
      updatedAt: now,
    });
  }

  /**
   * Compute how long we should wait before making a request in the given
   * context. Returns the max delay across all buckets that match.
   */
  getThrottleDelay(context: RequestContext): number {
    const now = Date.now();
    let maxDelay = 0;

    for (const bucket of this.buckets.values()) {
      if (this.isExpired(bucket, now)) continue;
      if (!this.bucketAppliesTo(bucket, context)) continue;

      // Both delays are measured from the reading's own timestamp and shrink
      // with the clock. A call that is refused is never sent, so no response
      // arrives to replace the reading: a delay held constant until the next
      // response would block the token for the whole bucket lifetime.
      const elapsed = Math.max(0, now - bucket.updatedAt);
      const explicitWait = Math.max(0, bucket.estimatedTimeToRegainAccessMs - elapsed);
      if (explicitWait > 0) {
        maxDelay = Math.max(maxDelay, explicitWait);
        continue;
      }

      const usage = Math.max(bucket.callCount, bucket.cpuTime, bucket.totalTime);
      maxDelay = Math.max(maxDelay, staircaseDelay(usage) - elapsed);
    }

    return maxDelay;
  }

  /**
   * Sleeps out a short self-throttle. A wait longer than MAX_SELF_THROTTLE_WAIT_MS
   * is not served by holding the call (and its admission slot and memory) for
   * minutes: it is refused at once with the time left. The sleep ends, timer
   * cleared, when the signal aborts.
   */
  async waitIfNeeded(context: RequestContext, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const delay = this.getThrottleDelay(context);
    if (delay > MAX_SELF_THROTTLE_WAIT_MS) {
      const retryInSeconds = Math.ceil(delay / 1000);
      logger.warn(
        { event: "meta_rate_throttle_refused", tokenHash: context.tokenHash, accountId: context.accountId, retryInSeconds },
        "Refusing a Meta request during a long rate-limit block",
      );
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Meta rate limit active for this token, retry in ${retryInSeconds} seconds. No request was sent; Meta asked for this pause, and continuing to call during it extends it.`,
        { retry_after_seconds: retryInSeconds },
      );
    }
    if (delay > 0) {
      logger.warn(
        {
          event: "meta_rate_throttle",
          tokenHash: context.tokenHash,
          accountId: context.accountId,
          delayMs: delay,
        },
        "Self-throttling before Meta request",
      );
      await abortableSleep(delay, signal);
    }
  }

  /**
   * Snapshot for observability / the `ads_rate_status` tool.
   */
  snapshot(): UsageBucket[] {
    this.sweep(Date.now());
    return Array.from(this.buckets.values()).map((b) => ({ ...b }));
  }

  /** Clear state — used by tests. */
  reset(): void {
    this.buckets.clear();
    this.lastSweepMs = 0;
  }

  /**
   * A reading older than Meta's rolling one-hour window (or than its own
   * regain-access hint, if that is longer) says nothing about current load, so
   * it must neither keep delaying requests nor stay in memory.
   */
  private isExpired(bucket: UsageBucket, now: number): boolean {
    // A reading stamped in the future means the wall clock stepped back; it would neither age nor expire
    // until the clock caught up, and a refused call sends nothing that could replace it.
    if (bucket.updatedAt - now > CLOCK_STEP_TOLERANCE_MS) return true;
    return now - bucket.updatedAt > Math.max(this.bucketTtlMs, bucket.estimatedTimeToRegainAccessMs);
  }

  private sweep(now: number): void {
    if (now - this.lastSweepMs < SWEEP_INTERVAL_MS && this.buckets.size <= this.maxBuckets) return;
    this.lastSweepMs = now;
    for (const [key, bucket] of this.buckets) {
      if (this.isExpired(bucket, now)) this.buckets.delete(key);
    }
    if (this.buckets.size <= this.maxBuckets) return;
    const target = Math.floor(this.maxBuckets * 0.9);
    const oldestFirst = [...this.buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key] of oldestFirst) {
      if (this.buckets.size <= target) break;
      this.buckets.delete(key);
    }
  }

  private writeBucket(bucket: UsageBucket): void {
    const numeric = [bucket.callCount, bucket.cpuTime, bucket.totalTime, bucket.estimatedTimeToRegainAccessMs];
    if (numeric.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) return;
    this.buckets.set(bucket.key, {
      ...bucket,
      callCount: Math.min(bucket.callCount, 10_000),
      cpuTime: Math.min(bucket.cpuTime, 10_000),
      totalTime: Math.min(bucket.totalTime, 10_000),
      estimatedTimeToRegainAccessMs: Math.min(bucket.estimatedTimeToRegainAccessMs, MAX_REGAIN_ACCESS_MS),
      adsApiAccessTier: safeTier(bucket.adsApiAccessTier),
    });
  }

  private bucketAppliesTo(
    bucket: UsageBucket,
    context: RequestContext,
  ): boolean {
    // Every bucket is scoped to a tokenHash as its first segment after kind.
    if (!bucket.key.includes(context.tokenHash)) return false;

    // Account-scoped buckets only apply when the request targets that account.
    if (bucket.kind === "acc" || bucket.kind === "reach") {
      return !!context.accountId && bucket.key.endsWith(`:${context.accountId}`);
    }
    if (bucket.kind === "insights") {
      // Insights buckets come in `:app` flavor (applies to all requests for
      // this token) and `:acc:<id>` flavor (only when account matches).
      if (bucket.key.endsWith(":app")) return true;
      return !!context.accountId && bucket.key.endsWith(`:${context.accountId}`);
    }
    if (bucket.kind === "local_retry") {
      // Always scoped to a specific (token, account, type) so one account's
      // retry-after never blocks sibling accounts.
      const scope = context.accountId ?? "_";
      return bucket.key.startsWith(
        bucketKey("local_retry", context.tokenHash, scope) + ":",
      );
    }
    // `app` and `buc` are token-scoped and apply broadly; specific BUC type
    // filtering happens at error-handling time, not at pre-flight throttle.
    return true;
  }
}

function safeTier(value: unknown): UsageBucket["adsApiAccessTier"] {
  return value === "development_access" || value === "standard_access" || value === "advanced_access" ? value : undefined;
}

function safeBucType(value: unknown): string | undefined {
  if (value === undefined) return "unknown";
  if (typeof value !== "string" || value.length > 128) return undefined;
  if (["ads_insights", "ads_management", "custom_audience", "unknown"].includes(value)) return value;
  // Preserve independent quota buckets without returning provider-controlled
  // text through rate-status or logs.
  return `other_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function staircaseDelay(usagePct: number): number {
  if (usagePct < 75) return 0;
  if (usagePct < 95) {
    // 100ms @ 75% → 2000ms @ 95%
    const ratio = (usagePct - 75) / 20;
    return Math.round(100 + ratio * 1900);
  }
  // 5s @ 95% → 60s @ 100%
  const ratio = Math.min(1, (usagePct - 95) / 5);
  return Math.round(5000 + ratio * 55000);
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function bucketKey(...parts: string[]): string {
  return parts.join(":");
}
