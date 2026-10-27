import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../../src/auth/token-store.js";
import { MetaApiClient } from "../../src/meta/client.js";
import { MAX_REGAIN_ACCESS_MS, RateLimiter, type RequestContext } from "../../src/meta/rate-limiter.js";
import { cleanupTestToken, mockFetchResponse, setupTestToken } from "../setup.js";

vi.mock("../../src/utils/logger.js", () => {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => logger };
  return { logger };
});

/**
 * A call that is refused is never sent, so no Graph response arrives to replace
 * the last reading. Whatever delay that reading implies therefore has to run
 * down with the clock by itself: a delay held constant until the next response
 * would refuse every call for as long as the reading lives, long after the
 * quota it described has recovered.
 */
const ctx: RequestContext = { tokenHash: "tokenhash-a", accountId: "act_1" };
const otherToken: RequestContext = { tokenHash: "tokenhash-b", accountId: "act_1" };
const appUsage = (pct: number) => new Headers({ "x-app-usage": JSON.stringify({ call_count: pct, total_cputime: 0, total_time: 0 }) });
const bucUsage = (pct: number, regainMinutes: number) =>
  new Headers({
    "x-business-use-case-usage": JSON.stringify({
      "1": [{ type: "ads_management", call_count: pct, total_cputime: 0, total_time: 0, estimated_time_to_regain_access: regainMinutes }],
    }),
  });
const settle = (promise: Promise<unknown>) => promise.then(() => "done" as const, (e: unknown) => e);
const refusal = (error: unknown) => {
  expect(error).toBeInstanceOf(McpError);
  return (error as McpError).message.match(/retry in (\d+) seconds/)?.[1];
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("usage-based delay runs down with the clock", () => {
  let limiter: RateLimiter;
  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("a 99% reading refuses with the time truly left as it counts down, with no response in between", async () => {
    limiter.updateFromHeaders(appUsage(99), ctx);

    expect(refusal(await settle(limiter.waitIfNeeded(ctx)))).toBe("49");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(refusal(await settle(limiter.waitIfNeeded(ctx)))).toBe("39");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(limiter.getThrottleDelay(ctx)).toBe(29_000);
  });

  it("slept out once it fits in the short-wait allowance, for the time that is left and not the original delay", async () => {
    limiter.updateFromHeaders(appUsage(99), ctx);
    await vi.advanceTimersByTimeAsync(25_000);

    let finished = false;
    const waiting = limiter.waitIfNeeded(ctx).then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(23_000);
    expect(finished, "still inside the 24 s that are left").toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    await waiting;
    expect(finished).toBe(true);
  });

  it("is served at once after the delay has elapsed, with nothing slept", async () => {
    limiter.updateFromHeaders(appUsage(99), ctx);
    await vi.advanceTimersByTimeAsync(49_001);

    expect(limiter.getThrottleDelay(ctx)).toBe(0);
    await expect(limiter.waitIfNeeded(ctx)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a refused call leaves the readings untouched and does not extend the block", async () => {
    limiter.updateFromHeaders(appUsage(99), ctx);
    const before = JSON.stringify(limiter.snapshot());

    for (let i = 0; i < 5; i++) {
      expect(refusal(await settle(limiter.waitIfNeeded(ctx)))).toBeDefined();
      await vi.advanceTimersByTimeAsync(4_000);
    }
    expect(JSON.stringify(limiter.snapshot())).toBe(before);

    await vi.advanceTimersByTimeAsync(29_001);
    await expect(limiter.waitIfNeeded(ctx)).resolves.toBeUndefined();
  });

  it("a fresh reading still replaces the old one at once", async () => {
    limiter.updateFromHeaders(appUsage(99), ctx);
    limiter.updateFromHeaders(appUsage(20), ctx);
    await expect(limiter.waitIfNeeded(ctx)).resolves.toBeUndefined();
  });
});

describe("an explicit regain-access block behaves the same way", () => {
  let limiter: RateLimiter;
  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("names the time left as it counts down and then lets the call through", async () => {
    limiter.updateFromHeaders(bucUsage(40, 10), ctx);
    expect(refusal(await settle(limiter.waitIfNeeded(ctx)))).toBe("600");

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refusal(await settle(limiter.waitIfNeeded(ctx)))).toBe("300");

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await expect(limiter.waitIfNeeded(ctx)).resolves.toBeUndefined();
  });

  it("does not turn into a constant usage delay when the explicit wait ends", async () => {
    limiter.updateFromHeaders(bucUsage(99, 1), ctx);
    expect(refusal(await settle(limiter.waitIfNeeded(ctx)))).toBe("60");

    await vi.advanceTimersByTimeAsync(61_000);
    expect(limiter.getThrottleDelay(ctx)).toBe(0);
    await expect(limiter.waitIfNeeded(ctx)).resolves.toBeUndefined();
  });

  it("a refused call does not extend an explicit block", async () => {
    limiter.updateFromHeaders(bucUsage(99, 2), ctx);
    const before = JSON.stringify(limiter.snapshot());
    for (let i = 0; i < 5; i++) {
      expect(refusal(await settle(limiter.waitIfNeeded(ctx)))).toBeDefined();
      await vi.advanceTimersByTimeAsync(20_000);
    }
    expect(JSON.stringify(limiter.snapshot())).toBe(before);
    await vi.advanceTimersByTimeAsync(20_001);
    await expect(limiter.waitIfNeeded(ctx)).resolves.toBeUndefined();
  });
});

describe("per-token isolation", () => {
  it("one token's block neither delays another token nor outlives its own delay", async () => {
    const limiter = new RateLimiter();
    limiter.updateFromHeaders(appUsage(99), ctx);

    expect(refusal(await settle(limiter.waitIfNeeded(ctx)))).toBe("49");
    await expect(limiter.waitIfNeeded(otherToken)).resolves.toBeUndefined();
    expect(limiter.getThrottleDelay(otherToken)).toBe(0);

    await vi.advanceTimersByTimeAsync(20_000);
    limiter.updateFromHeaders(appUsage(99), otherToken);
    expect(limiter.getThrottleDelay(ctx)).toBe(29_000);
    expect(limiter.getThrottleDelay(otherToken)).toBe(49_000);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(limiter.getThrottleDelay(ctx), "the first token's own delay has passed").toBe(0);
    expect(limiter.getThrottleDelay(otherToken), "the second token's runs on its own clock").toBe(19_000);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(limiter.getThrottleDelay(otherToken)).toBe(0);
  });
});

describe("values and clocks that would otherwise pin a token", () => {
  let limiter: RateLimiter;
  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("caps a regain-access hint from a response header at 24 hours", async () => {
    limiter.updateFromHeaders(bucUsage(10, 1_000_000_000), ctx);
    expect(limiter.getThrottleDelay(ctx)).toBe(MAX_REGAIN_ACCESS_MS);

    await vi.advanceTimersByTimeAsync(MAX_REGAIN_ACCESS_MS + 1);
    expect(limiter.getThrottleDelay(ctx)).toBe(0);
  });

  it("caps a retry-after hint at the same limit instead of pinning the token for the process lifetime", async () => {
    limiter.markRetryAfter(ctx, "page_lead_read", 1e23);
    expect(limiter.getThrottleDelay(ctx)).toBe(MAX_REGAIN_ACCESS_MS);

    limiter.reset();
    limiter.markRetryAfter(ctx, "page_lead_read", Number.POSITIVE_INFINITY);
    expect(limiter.getThrottleDelay(ctx)).toBe(MAX_REGAIN_ACCESS_MS);
  });

  it("ignores a retry-after hint that is not a positive number", () => {
    for (const bad of [Number.NaN, 0, -5]) limiter.markRetryAfter(ctx, "page_lead_read", bad);
    expect(limiter.getThrottleDelay(ctx)).toBe(0);
  });

  it("still honours a normal retry-after hint and lets it run down", async () => {
    limiter.markRetryAfter(ctx, "page_lead_read", 86_400_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(limiter.getThrottleDelay(ctx)).toBe(86_340_000);
  });

  it("drops a reading stamped in the future after the wall clock steps back", async () => {
    limiter.updateFromHeaders(bucUsage(10, 10), ctx);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(limiter.getThrottleDelay(ctx)).toBe(5 * 60_000);

    vi.setSystemTime(Date.now() - 30 * 60_000);
    expect(limiter.getThrottleDelay(ctx)).toBe(0);
  });

  it("keeps a reading through a clock step smaller than a second", async () => {
    limiter.updateFromHeaders(bucUsage(10, 10), ctx);
    await vi.advanceTimersByTimeAsync(60_000);

    vi.setSystemTime(Date.now() - 400);
    expect(limiter.getThrottleDelay(ctx)).toBe(10 * 60_000 - 59_600);
  });
});

describe("through the Graph client", () => {
  const TOKEN = "test-access-token";
  let client: MetaApiClient;
  let graphCalls: number;
  let usageHeader: string;

  beforeEach(() => {
    setupTestToken(TOKEN);
    graphCalls = 0;
    usageHeader = JSON.stringify({ call_count: 99, total_cputime: 0, total_time: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        graphCalls += 1;
        return mockFetchResponse({ id: "1" }, { headers: { "x-app-usage": usageHeader } });
      }),
    );
    client = new MetaApiClient({ apiVersion: "v26.0", baseUrl: "https://graph.facebook.com", timeout: 30_000, maxRetries: 0 });
  });
  afterEach(() => {
    cleanupTestToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("after a 99% reading, calls are refused with the time left, and a call that fits the short-wait allowance is slept out and sent", async () => {
    await expect(client.get("/act_1/campaigns")).resolves.toEqual({ id: "1" });
    expect(graphCalls).toBe(1);
    usageHeader = JSON.stringify({ call_count: 20, total_cputime: 0, total_time: 0 });

    expect(refusal(await client.get("/act_1/campaigns").catch((e: unknown) => e))).toBe("49");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refusal(await client.get("/act_1/campaigns").catch((e: unknown) => e))).toBe("39");
    expect(graphCalls, "refused calls send nothing").toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    const slept = client.get("/act_1/campaigns");
    await vi.advanceTimersByTimeAsync(28_000);
    expect(graphCalls, "still inside the 29 s that were left").toBe(1);
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(slept).resolves.toEqual({ id: "1" });
    expect(graphCalls).toBe(2);
  });

  it("the call made after the delay has elapsed is served and sent, and repeated refusals before it did not extend the block", async () => {
    await client.get("/act_1/campaigns");
    usageHeader = JSON.stringify({ call_count: 20, total_cputime: 0, total_time: 0 });

    for (let i = 0; i < 3; i++) {
      expect(refusal(await client.get("/act_1/campaigns").catch((e: unknown) => e))).toBeDefined();
      await vi.advanceTimersByTimeAsync(9_000);
    }
    expect(graphCalls, "nothing sent while refused").toBe(1);

    await vi.advanceTimersByTimeAsync(23_000);
    await expect(client.get("/act_1/campaigns")).resolves.toEqual({ id: "1" });
    expect(graphCalls).toBe(2);
    await expect(client.get("/act_1/campaigns"), "its response carried the real 20%").resolves.toEqual({ id: "1" });
    expect(graphCalls).toBe(3);
  });

  it("an explicit block header is refused with the time left and then let through the same way", async () => {
    usageHeader = JSON.stringify({ call_count: 20, total_cputime: 0, total_time: 0 });
    internalsOf(client).rateLimiter.updateFromHeaders(bucUsage(10, 2), { tokenHash: hashToken(TOKEN), accountId: "act_1" });

    expect(refusal(await client.get("/act_1/campaigns").catch((e: unknown) => e))).toBe("120");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refusal(await client.get("/act_1/campaigns").catch((e: unknown) => e))).toBe("60");
    expect(graphCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(60_001);
    await expect(client.get("/act_1/campaigns")).resolves.toEqual({ id: "1" });
    expect(graphCalls).toBe(1);
  });
});

function internalsOf(client: MetaApiClient): { rateLimiter: RateLimiter } {
  return client as unknown as { rateLimiter: RateLimiter };
}
