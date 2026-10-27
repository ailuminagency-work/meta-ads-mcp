import { describe, expect, it } from "vitest";
import { FailureLimiter } from "../../src/utils/failure-limiter.js";

function limiter(options: { maxFailures?: number; windowMs?: number; maxKeys?: number } = {}) {
  let now = 1_000_000;
  const instance = new FailureLimiter({
    maxFailures: options.maxFailures ?? 3,
    windowMs: options.windowMs ?? 60_000,
    maxKeys: options.maxKeys,
    now: () => now,
  });
  return { instance, advance: (ms: number) => (now += ms) };
}

describe("FailureLimiter", () => {
  it("blocks a key after the allowed number of failures and only that key", () => {
    const { instance } = limiter();
    for (let i = 0; i < 2; i++) instance.recordFailure("a");
    expect(instance.isBlocked("a")).toBe(false);
    instance.recordFailure("a");
    expect(instance.isBlocked("a")).toBe(true);
    expect(instance.isBlocked("b")).toBe(false);
  });

  it("forgets a key when its window ends", () => {
    const { instance, advance } = limiter();
    for (let i = 0; i < 3; i++) instance.recordFailure("a");
    advance(60_001);
    expect(instance.isBlocked("a")).toBe(false);
    instance.recordFailure("a");
    expect(instance.isBlocked("a")).toBe(false);
  });

  it("stays within its key cap when keys keep rotating", () => {
    const { instance } = limiter({ maxKeys: 5 });
    for (let i = 0; i < 1000; i++) instance.recordFailure(`key-${i}`);
    expect(instance.size).toBeLessThanOrEqual(5);
  });

  it("drops expired keys before it drops live ones", () => {
    const { instance, advance } = limiter({ maxKeys: 3, windowMs: 1000, maxFailures: 1 });
    instance.recordFailure("old-1");
    instance.recordFailure("old-2");
    advance(2000);
    for (const key of ["live-1", "live-2", "live-3"]) instance.recordFailure(key);

    expect(instance.size).toBe(3);
    for (const key of ["live-1", "live-2", "live-3"]) expect(instance.isBlocked(key), key).toBe(true);
  });
});
