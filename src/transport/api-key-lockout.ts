import { WindowCounter } from "../utils/window-counter.js";

export const API_KEY_MAX_FAILURES = 20;
export const API_KEY_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const API_KEY_KNOWN_GOOD_TTL_MS = 15 * 60 * 1000;
export const API_KEY_MAX_KNOWN_GOOD = 2_000;

export interface ApiKeyLockoutOptions {
  maxFailures?: number;
  windowMs?: number;
  knownGoodTtlMs?: number;
  maxKnownGood?: number;
  now?: () => number;
}

/**
 * Per-address failure lockout for the static API key.
 *
 * A locked address stays locked even for the correct key, because answering
 * "right" differently from "wrong" would let a locked address keep guessing.
 * The one exception is an address that already presented the valid key within
 * the known-good window: its legitimate client keeps working while someone
 * else behind the same address is refused.
 */
export class ApiKeyLockout {
  private readonly failures: WindowCounter;
  private readonly knownGood = new Map<string, number>();
  private readonly knownGoodTtlMs: number;
  private readonly maxKnownGood: number;
  private readonly now: () => number;

  constructor(options: ApiKeyLockoutOptions = {}) {
    this.now = options.now ?? Date.now;
    this.knownGoodTtlMs = options.knownGoodTtlMs ?? API_KEY_KNOWN_GOOD_TTL_MS;
    this.maxKnownGood = options.maxKnownGood ?? API_KEY_MAX_KNOWN_GOOD;
    this.failures = new WindowCounter({
      limit: options.maxFailures ?? API_KEY_MAX_FAILURES,
      windowMs: options.windowMs ?? API_KEY_FAILURE_WINDOW_MS,
      now: this.now,
    });
  }

  isLocked(address: string): boolean {
    return this.failures.isBlocked(address);
  }

  recordFailure(address: string): void {
    this.failures.record(address);
  }

  isKnownGood(address: string): boolean {
    const expiresAt = this.knownGood.get(address);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.now()) {
      this.knownGood.delete(address);
      return false;
    }
    return true;
  }

  recordSuccess(address: string): void {
    const now = this.now();
    this.knownGood.delete(address);
    if (this.knownGood.size >= this.maxKnownGood) this.makeRoom(now);
    this.knownGood.set(address, now + this.knownGoodTtlMs);
  }

  get knownGoodSize(): number {
    return this.knownGood.size;
  }

  private makeRoom(now: number): void {
    for (const [address, expiresAt] of this.knownGood) {
      if (expiresAt <= now) this.knownGood.delete(address);
    }
    while (this.knownGood.size >= this.maxKnownGood) {
      const oldest = this.knownGood.keys().next();
      if (oldest.done) return;
      this.knownGood.delete(oldest.value);
    }
  }
}
