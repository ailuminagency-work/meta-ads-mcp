import { afterEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../../src/meta/circuit-breaker.js";
import { classifyMetaError } from "../../src/meta/errors.js";
import { RateLimiter, USAGE_BUCKET_TTL_MS } from "../../src/meta/rate-limiter.js";

afterEach(() => {
  vi.useRealTimers();
});

const accountUsage = (pct: number, resetSeconds?: number) =>
  new Headers({
    "x-ad-account-usage": JSON.stringify({
      acc_id_util_pct: pct,
      ...(resetSeconds === undefined ? {} : { reset_time_duration: resetSeconds }),
    }),
  });

describe("RateLimiter idle-bucket eviction", () => {
  it("drops buckets that have not been refreshed within Meta's rolling hour", () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    limiter.updateFromHeaders(accountUsage(40), { tokenHash: "tok", accountId: "act_1" });
    vi.advanceTimersByTime(USAGE_BUCKET_TTL_MS / 2);
    limiter.updateFromHeaders(accountUsage(40), { tokenHash: "tok", accountId: "act_2" });
    vi.advanceTimersByTime(USAGE_BUCKET_TTL_MS / 2 + 120_000);
    expect(limiter.snapshot().map((b) => b.key)).toEqual(["acc:tok:act_2"]);
    vi.advanceTimersByTime(USAGE_BUCKET_TTL_MS);
    expect(limiter.snapshot()).toEqual([]);
  });

  it("stops a stale high-usage reading from delaying requests forever", () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    const context = { tokenHash: "tok", accountId: "act_1" };
    limiter.updateFromHeaders(accountUsage(99), context);
    expect(limiter.getThrottleDelay(context)).toBeGreaterThanOrEqual(5_000);
    vi.advanceTimersByTime(USAGE_BUCKET_TTL_MS + 1_000);
    expect(limiter.getThrottleDelay(context)).toBe(0);
  });

  it("keeps an explicit regain-access wait that outlasts the usual window", () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    const context = { tokenHash: "tok", accountId: "act_1" };
    limiter.updateFromHeaders(accountUsage(100, 4 * 60 * 60), context);
    vi.advanceTimersByTime(USAGE_BUCKET_TTL_MS + 60_000);
    expect(limiter.snapshot()).toHaveLength(1);
    expect(limiter.getThrottleDelay(context)).toBeGreaterThan(2 * 60 * 60 * 1000);
  });

  it("stays within its bucket cap under a flood of distinct accounts, dropping the oldest first", () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(USAGE_BUCKET_TTL_MS, 100);
    for (let index = 0; index < 1_000; index++) {
      limiter.updateFromHeaders(accountUsage(10), { tokenHash: "tok", accountId: `act_${index}` });
      vi.advanceTimersByTime(10);
    }
    const keys = limiter.snapshot().map((b) => b.key);
    expect(keys.length).toBeLessThanOrEqual(100);
    expect(keys).toContain("acc:tok:act_999");
    expect(keys).not.toContain("acc:tok:act_0");
  });

  it("bounds retry-after hints the same way", () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(USAGE_BUCKET_TTL_MS, 50);
    for (let index = 0; index < 500; index++) {
      limiter.markRetryAfter({ tokenHash: "tok", accountId: `act_${index}` }, "ads_management", 1_000);
      vi.advanceTimersByTime(10);
    }
    expect(limiter.snapshot().length).toBeLessThanOrEqual(50);
  });
});

describe("CircuitBreaker idle-state eviction", () => {
  const throttle = classifyMetaError({ code: 4, message: "rate limit", type: "OAuthException" });
  const abuse = classifyMetaError({ code: 613, error_subcode: 1996, message: "abuse", type: "OAuthException" });
  const ctx = (index: number) => ({ tokenHash: "tok", accountId: `act_${index}`, type: "ads_management" });

  it("forgets throttle counters that fell out of the five-minute window", () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker();
    for (let index = 0; index < 50; index++) breaker.trip(ctx(index), throttle);
    expect(breaker.size().throttleEventKeys).toBe(50);
    vi.advanceTimersByTime(6 * 60_000);
    breaker.trip(ctx(999), throttle);
    expect(breaker.size().throttleEventKeys).toBe(1);
  });

  it("drops expired circuits on the next trip, not only on the next request", () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker();
    breaker.trip(ctx(1), abuse);
    expect(breaker.size().circuits).toBe(1);
    vi.advanceTimersByTime(61 * 60_000);
    breaker.trip(ctx(2), throttle);
    expect(breaker.size().circuits).toBe(0);
  });

  it("never drops a circuit that is still open", () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(10);
    breaker.trip(ctx(1), abuse);
    for (let index = 100; index < 400; index++) breaker.trip(ctx(index), throttle);
    expect(() => breaker.assertClosed(ctx(1))).toThrow(/Circuit open/);
  });

  it("keeps the throttle-counter map within its cap", () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(100);
    for (let index = 0; index < 2_000; index++) breaker.trip(ctx(index), throttle);
    expect(breaker.size().throttleEventKeys).toBeLessThanOrEqual(100);
  });

  it("still opens after three throttles in the window despite the sweeps", () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(100);
    const target = ctx(7);
    breaker.trip(target, throttle);
    vi.advanceTimersByTime(61_000);
    for (let index = 100; index < 140; index++) breaker.trip(ctx(index), throttle);
    breaker.trip(target, throttle);
    breaker.trip(target, throttle);
    expect(() => breaker.assertClosed(target)).toThrow(/Circuit open/);
  });
});
