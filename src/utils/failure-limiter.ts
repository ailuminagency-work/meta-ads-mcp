export interface FailureLimiterOptions {
  maxFailures: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

const DEFAULT_MAX_KEYS = 10_000;

/**
 * Counts failed attempts per key and refuses everything from a key that has
 * failed too often until its window ends. The table is capped, so rotating
 * keys cannot grow it without limit: expired entries go first, then the oldest.
 */
export class FailureLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(private readonly options: FailureLimiterOptions) {
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.now = options.now ?? Date.now;
  }

  isBlocked(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.resetAt <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return entry.count >= this.options.maxFailures;
  }

  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.entries.get(key);
    if (entry && entry.resetAt > now) {
      entry.count++;
      return;
    }
    this.entries.delete(key);
    this.makeRoom(now);
    this.entries.set(key, { count: 1, resetAt: now + this.options.windowMs });
  }

  get size(): number {
    return this.entries.size;
  }

  private makeRoom(now: number): void {
    if (this.entries.size < this.maxKeys) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
