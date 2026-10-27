import { WindowCounter } from "../utils/window-counter.js";

export const API_KEY_MAX_FAILURES = 20;
export const API_KEY_FAILURE_WINDOW_MS = 15 * 60 * 1000;

export interface ApiKeyLockoutOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Per-address failure lockout for the static API key.
 *
 * A locked address is refused for the right key too, so it cannot tell a right
 * guess from a wrong one. There is no exemption for an address whose client
 * used the key earlier: twenty failures show that someone at that address is
 * guessing, and a guesser sharing the address (a NAT, a proxy counted with too
 * few hops) would inherit the exemption and keep testing keys at full speed.
 * The cost is that a legitimate client at a locked address is refused until
 * the window ends.
 */
export class ApiKeyLockout {
  private readonly failures: WindowCounter;

  constructor(options: ApiKeyLockoutOptions = {}) {
    this.failures = new WindowCounter({
      limit: options.maxFailures ?? API_KEY_MAX_FAILURES,
      windowMs: options.windowMs ?? API_KEY_FAILURE_WINDOW_MS,
      now: options.now ?? Date.now,
    });
  }

  isLocked(address: string): boolean {
    return this.failures.isBlocked(address);
  }

  recordFailure(address: string): void {
    this.failures.record(address);
  }
}
