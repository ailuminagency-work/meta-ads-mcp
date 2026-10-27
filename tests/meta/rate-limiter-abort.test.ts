import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SELF_THROTTLE_WAIT_MS, RateLimiter, type RequestContext } from "../../src/meta/rate-limiter.js";
import { RequestAbortedError } from "../../src/utils/abortable.js";

// The logger schedules flush timers of its own; the timer counts below are about the limiter's.
vi.mock("../../src/utils/logger.js", () => {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => logger };
  return { logger };
});

const ctx: RequestContext = { tokenHash: "tokenhash1", accountId: "act_1" };
let limiter: RateLimiter;

beforeEach(() => {
  limiter = new RateLimiter();
});
afterEach(() => vi.useRealTimers());

const settle = (promise: Promise<unknown>) => promise.then(() => "done" as const, (e: unknown) => e);

describe("RateLimiter.waitIfNeeded and the abort signal", () => {
  it("ends the sleep at once on abort, with the abort error and no timer left", async () => {
    vi.useFakeTimers();
    limiter.markRetryAfter(ctx, "ads_management", 25_000);
    const controller = new AbortController();
    const sleeping = settle(limiter.waitIfNeeded(ctx, controller.signal));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    expect(await sleeping).toBeInstanceOf(RequestAbortedError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a wait for a signal that is already aborted", async () => {
    vi.useFakeTimers();
    limiter.markRetryAfter(ctx, "ads_management", 25_000);
    const controller = new AbortController();
    controller.abort();
    await expect(limiter.waitIfNeeded(ctx, controller.signal)).rejects.toBeInstanceOf(RequestAbortedError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still sleeps out a short throttle when nobody aborts, and when a signal is given", async () => {
    vi.useFakeTimers();
    limiter.markRetryAfter(ctx, "ads_management", 5_000);
    for (const signal of [undefined, new AbortController().signal]) {
      let done = false;
      const waiting = limiter.waitIfNeeded(ctx, signal).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_100);
      await waiting;
      expect(done).toBe(true);
      limiter.markRetryAfter(ctx, "ads_management", 5_000);
    }
  });
});

describe("RateLimiter.waitIfNeeded and a long block", () => {
  it("allows up to 30 s to be slept and refuses more, at once, with the time left", async () => {
    vi.useFakeTimers();
    expect(MAX_SELF_THROTTLE_WAIT_MS).toBe(30_000);

    limiter.markRetryAfter(ctx, "ads_management", 29_000);
    let slept = false;
    const waiting = limiter.waitIfNeeded(ctx).then(() => { slept = true; });
    await vi.advanceTimersByTimeAsync(29_500);
    await waiting;
    expect(slept).toBe(true);

    limiter.reset();
    limiter.markRetryAfter(ctx, "ads_management", 31_000);
    const refused = await settle(limiter.waitIfNeeded(ctx));
    expect(refused).toBeInstanceOf(McpError);
    expect((refused as McpError).message).toMatch(/Meta rate limit active for this token, retry in 31 seconds/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses a ten minute block without sleeping, and names the time left", async () => {
    vi.useFakeTimers();
    limiter.updateFromHeaders(
      new Headers({
        "x-business-use-case-usage": JSON.stringify({
          "1": [{ type: "ads_management", call_count: 99, total_cputime: 99, total_time: 99, estimated_time_to_regain_access: 10 }],
        }),
      }),
      { tokenHash: "tokenhash1", accountId: "1" },
    );
    const error = await settle(limiter.waitIfNeeded({ tokenHash: "tokenhash1", accountId: "1" }));
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).message).toMatch(/Meta rate limit active for this token, retry in (59\d|600) seconds/);
    expect((error as McpError).data).toMatchObject({ retry_after_seconds: expect.any(Number) });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not refuse when there is no block", async () => {
    await expect(limiter.waitIfNeeded(ctx)).resolves.toBeUndefined();
  });
});
