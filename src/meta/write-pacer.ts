import { logger } from "../utils/logger.js";

/**
 * Preventive self-pacing for Ads Management writes.
 *
 * Meta's BUC quota for Ads Management is tight in `development_access`:
 *   300 + 40 × active_ads per hour (standard)
 *   100 000 + 40 × active_ads per hour (advanced)
 *
 * We apply a token-bucket per (token, ad account) on POST/PUT/DELETE calls so a
 * burst of writes from an agent never blows the hourly quota. This is
 * independent of (and complementary to) the reactive `RateLimiter` that reads
 * response headers — the pacer prevents, the limiter reacts.
 *
 * Meta meters Ads Management per ad account, but most writes address an object
 * (`/{campaign_id}`) rather than the account. The pacer learns object → account
 * from responses it has already seen (see `learnFromResponse`) and charges the
 * write to that account. An object it has never seen shares one per-token
 * bucket, so an unrecognised bulk update is still paced instead of getting a
 * fresh bucket per object.
 */
type Tier = "development_access" | "standard_access";

interface Bucket {
  tokens: number;
  capacity: number;
  refillRatePerSec: number;
  lastRefillMs: number;
  activeAds: number;
  tier: Tier;
  lastUsedMs: number;
  lastWaitLogMs: number;
  waiters: number;
  turn: Promise<void>;
}

const DEFAULT_ACTIVE_ADS = 50;
const INITIAL_BURST = 10;
const TOKEN_SCOPE = "_token";
const ACCOUNT_PATTERN = /^act_(\d{1,32})$/i;
const OBJECT_PATTERN = /^\d{1,32}$/;
const TOKEN_EPSILON = 1e-9;
const WAIT_LOG_INTERVAL_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

export const PACER_IDLE_TTL_MS = 15 * 60_000;
export const PACER_MAX_BUCKETS = 5_000;
export const SCOPE_CACHE_MAX_ENTRIES = 10_000;
export const SCOPE_CACHE_TTL_MS = 6 * 60 * 60_000;
const MAX_LEARNED_PER_RESPONSE = 500;

const ACCOUNT_OBJECT_EDGES = new Set([
  "campaigns",
  "adsets",
  "ads",
  "adcreatives",
  "customaudiences",
  "savedaudiences",
  "advideos",
  "adlabels",
  "adrules_library",
]);

function parseAccount(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const match = ACCOUNT_PATTERN.exec(raw);
  return match ? `act_${match[1]}` : undefined;
}

function parseAccountField(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) return `act_${raw}`;
  if (typeof raw !== "string") return undefined;
  return parseAccount(raw) ?? (OBJECT_PATTERN.test(raw) ? `act_${raw}` : undefined);
}

function parseObjectId(raw: unknown): string | undefined {
  return typeof raw === "string" && OBJECT_PATTERN.test(raw) ? raw : undefined;
}

/** Bounded, per-token map of object id → owning ad account. */
export class AccountScopeCache {
  private readonly entries = new Map<string, { account: string; at: number }>();

  constructor(
    private readonly maxEntries = SCOPE_CACHE_MAX_ENTRIES,
    private readonly ttlMs = SCOPE_CACHE_TTL_MS,
  ) {}

  learn(tokenHash: string, objectId: string, account: string): void {
    const key = `${tokenHash}:${objectId}`;
    this.entries.delete(key);
    this.entries.set(key, { account, at: Date.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  resolve(tokenHash: string, objectId: string): string | undefined {
    const key = `${tokenHash}:${objectId}`;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.account;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface WritePacerOptions {
  idleTtlMs?: number;
  maxBuckets?: number;
  scopes?: AccountScopeCache;
}

export class WritePacer {
  private readonly buckets = new Map<string, Bucket>();
  private readonly scopes: AccountScopeCache;
  private readonly idleTtlMs: number;
  private readonly maxBuckets: number;
  private lastSweepMs = 0;

  constructor(options: WritePacerOptions = {}) {
    this.scopes = options.scopes ?? new AccountScopeCache();
    this.idleTtlMs = options.idleTtlMs ?? PACER_IDLE_TTL_MS;
    this.maxBuckets = options.maxBuckets ?? PACER_MAX_BUCKETS;
  }

  /**
   * Record known active-ads count for an account (typically fed from an
   * Insights response). Allows tighter/wider pacing as volume changes.
   */
  updateActiveAds(
    tokenHash: string,
    accountId: string,
    activeAds: number,
  ): void {
    const existing = this.buckets.get(this.keyFor(tokenHash, accountId));
    if (existing) {
      existing.activeAds = activeAds;
      existing.refillRatePerSec = computeRate(existing.tier, activeAds);
      existing.capacity = Math.max(10, Math.round(existing.refillRatePerSec * 10));
    }
  }

  /**
   * Record the tier observed in a response header so pacing matches reality.
   */
  updateTier(tokenHash: string, accountId: string, tier: string): void {
    if (tier !== "development_access" && tier !== "standard_access") return;
    const existing = this.buckets.get(this.keyFor(tokenHash, accountId));
    if (existing && existing.tier !== tier) {
      existing.tier = tier;
      existing.refillRatePerSec = computeRate(tier, existing.activeAds);
      existing.capacity = tier === "standard_access" ? 50 : 10;
      logger.info(
        { event: "meta_write_pacer_tier", accountId, tier },
        "Write pacer adjusted to observed access tier",
      );
    }
  }

  /**
   * Block until a token is available in the bucket. `scopeId` is an ad account
   * (`act_123`) or an object id that may have been learned to belong to one.
   *
   * Callers on one bucket are served first-in first-out and each re-checks the
   * bucket after waking, so N concurrent writers leave at the refill rate
   * instead of all waking on the same timer.
   */
  async acquire(tokenHash: string, scopeId: string | undefined): Promise<void> {
    this.sweep();
    const key = this.keyFor(tokenHash, scopeId);
    const bucket = this.getOrCreate(key);
    bucket.waiters += 1;
    const previous = bucket.turn;
    let release!: () => void;
    bucket.turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      for (;;) {
        this.refill(bucket);
        if (bucket.tokens >= 1 - TOKEN_EPSILON) {
          bucket.tokens = Math.max(0, bucket.tokens - 1);
          bucket.lastUsedMs = Date.now();
          return;
        }
        const waitMs = Math.max(
          1,
          Math.ceil(((1 - bucket.tokens) / bucket.refillRatePerSec) * 1000),
        );
        const now = Date.now();
        if (now - bucket.lastWaitLogMs >= WAIT_LOG_INTERVAL_MS) {
          bucket.lastWaitLogMs = now;
          logger.warn(
            {
              event: "meta_write_pacer_wait",
              accountId: scopeId,
              waitMs,
              queued: bucket.waiters,
              rateRps: bucket.refillRatePerSec,
              tier: bucket.tier,
            },
            "Write pacer delaying a write to stay under Ads Management quota",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    } finally {
      bucket.waiters -= 1;
      bucket.lastUsedMs = Date.now();
      release();
    }
  }

  /**
   * Teach the pacer which ad account an object belongs to, from a successful
   * response that already carries the answer: ids listed under or created in
   * `/act_N/{campaigns,adsets,ads,...}`, ids listed under an object whose account
   * is already known, any `{id, account_id}` pair, and the object a caller
   * explicitly scoped to an account.
   */
  learnFromResponse(
    tokenHash: string,
    scopeId: string | undefined,
    path: string,
    body: unknown,
  ): void {
    const [first = "", edge = ""] = path.split("?")[0].replace(/^\//, "").split("/");
    let account: string | undefined;
    let childrenKnown = false;

    if (parseAccount(first)) {
      account = parseAccount(first);
      childrenKnown = ACCOUNT_OBJECT_EDGES.has(edge);
    } else if (OBJECT_PATTERN.test(first)) {
      account = parseAccount(scopeId) ?? this.scopes.resolve(tokenHash, first);
      if (account) {
        this.scopes.learn(tokenHash, first, account);
        childrenKnown = ACCOUNT_OBJECT_EDGES.has(edge);
      }
    }

    if (typeof body !== "object" || body === null) return;
    let learned = 0;
    const learn = (id: unknown, owner: string | undefined): void => {
      const objectId = parseObjectId(id);
      if (!objectId || !owner || learned >= MAX_LEARNED_PER_RESPONSE) return;
      learned += 1;
      this.scopes.learn(tokenHash, objectId, owner);
    };
    const visit = (row: unknown): void => {
      if (typeof row !== "object" || row === null) return;
      const record = row as { id?: unknown; account_id?: unknown };
      learn(record.id, parseAccountField(record.account_id) ?? (childrenKnown ? account : undefined));
    };

    visit(body);
    const rows = (body as { data?: unknown }).data;
    if (Array.isArray(rows)) {
      for (const row of rows.slice(0, MAX_LEARNED_PER_RESPONSE)) visit(row);
    }
  }

  snapshot(): Array<{
    key: string;
    tokens: number;
    capacity: number;
    rateRps: number;
    tier: Tier;
  }> {
    this.sweep();
    return Array.from(this.buckets.entries()).map(([key, b]) => ({
      key,
      tokens: Math.round(b.tokens * 100) / 100,
      capacity: b.capacity,
      rateRps: Math.round(b.refillRatePerSec * 1000) / 1000,
      tier: b.tier,
    }));
  }

  get learnedObjectCount(): number {
    return this.scopes.size;
  }

  reset(): void {
    this.buckets.clear();
    this.scopes.clear();
    this.lastSweepMs = 0;
  }

  private keyFor(tokenHash: string, scopeId: string | undefined): string {
    return `${tokenHash}:${this.scopeFor(tokenHash, scopeId)}`;
  }

  private scopeFor(tokenHash: string, scopeId: string | undefined): string {
    if (scopeId === undefined) return TOKEN_SCOPE;
    const account = parseAccount(scopeId);
    if (account) return account;
    if (OBJECT_PATTERN.test(scopeId)) return this.scopes.resolve(tokenHash, scopeId) ?? TOKEN_SCOPE;
    return TOKEN_SCOPE;
  }

  private getOrCreate(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      const tier: Tier = "development_access";
      const now = Date.now();
      bucket = {
        tokens: INITIAL_BURST,
        capacity: INITIAL_BURST,
        refillRatePerSec: computeRate(tier, DEFAULT_ACTIVE_ADS),
        lastRefillMs: now,
        activeAds: DEFAULT_ACTIVE_ADS,
        tier,
        lastUsedMs: now,
        lastWaitLogMs: 0,
        waiters: 0,
        turn: Promise.resolve(),
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    bucket.tokens = Math.min(
      bucket.capacity,
      bucket.tokens + elapsedSec * bucket.refillRatePerSec,
    );
    bucket.lastRefillMs = now;
  }

  /**
   * A bucket idle long enough to have refilled completely is indistinguishable
   * from a new one, so dropping it loses nothing but the observed tier, which
   * the next response re-teaches. Buckets with queued callers are never dropped.
   */
  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweepMs < SWEEP_INTERVAL_MS && this.buckets.size <= this.maxBuckets) return;
    this.lastSweepMs = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.waiters === 0 && now - bucket.lastUsedMs > this.idleTtlMs) this.buckets.delete(key);
    }
    if (this.buckets.size <= this.maxBuckets) return;
    const target = Math.floor(this.maxBuckets * 0.9);
    const idle = [...this.buckets.entries()]
      .filter(([, bucket]) => bucket.waiters === 0)
      .sort((a, b) => a[1].lastUsedMs - b[1].lastUsedMs);
    for (const [key] of idle) {
      if (this.buckets.size <= target) break;
      this.buckets.delete(key);
    }
  }
}

function computeRate(tier: Tier, activeAds: number): number {
  const hourly =
    tier === "standard_access"
      ? 100_000 + 40 * activeAds
      : 300 + 40 * activeAds;
  return hourly / 3600;
}
