import { afterEach, describe, expect, it, vi } from "vitest";
import { WritePacer } from "../../src/meta/write-pacer.js";
import { RequestAbortedError } from "../../src/utils/abortable.js";

// The logger schedules flush timers of its own; the timer counts below are about the pacer's.
vi.mock("../../src/utils/logger.js", () => {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => logger };
  return { logger };
});

const devRatePerSec = (300 + 40 * 50) / 3600;
const gapMs = 1000 / devRatePerSec;
const burst = 10;

afterEach(() => vi.useRealTimers());

/** Takes the whole initial burst, so the next caller has to queue for a refill. */
async function drain(pacer: WritePacer, scope = "act_1"): Promise<void> {
  for (let i = 0; i < burst; i++) await pacer.acquire("tok", scope);
}

const outcome = (promise: Promise<unknown>) => promise.then(() => "acquired", (e: unknown) => (e instanceof RequestAbortedError ? "aborted" : e));

describe("WritePacer: a caller that aborts leaves the queue", () => {
  it("refuses to queue for a signal that is already aborted", async () => {
    const pacer = new WritePacer();
    const controller = new AbortController();
    controller.abort();
    await expect(pacer.acquire("tok", "act_1", controller.signal)).rejects.toBeInstanceOf(RequestAbortedError);
    expect(pacer.snapshot()).toEqual([]);
  });

  it("removes 200 aborted queued writers: the queue is empty, no timer is left, no token is spent", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    await drain(pacer);
    const before = pacer.snapshot()[0].tokens;

    const controllers = Array.from({ length: 200 }, () => new AbortController());
    const results = controllers.map((c) => outcome(pacer.acquire("tok", "act_1", c.signal)));
    await vi.advanceTimersByTimeAsync(10);
    expect(pacer.queuedCallers).toBe(199);
    expect(vi.getTimerCount()).toBe(1);

    for (const c of controllers) c.abort();
    expect(await Promise.all(results)).toEqual(Array(200).fill("aborted"));
    expect(pacer.queuedCallers).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(pacer.snapshot()[0].tokens).toBeLessThanOrEqual(before + 0.1);
  });

  it("does not make the next caller wait for the ones that left", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    await drain(pacer);

    const gone = Array.from({ length: 50 }, () => new AbortController());
    const goneResults = gone.map((c) => outcome(pacer.acquire("tok", "act_1", c.signal)));
    await vi.advanceTimersByTimeAsync(10);
    for (const c of gone) c.abort();
    await Promise.all(goneResults);

    const start = Date.now();
    let servedAt = -1;
    void pacer.acquire("tok", "act_1").then(() => { servedAt = Date.now() - start; });
    await vi.advanceTimersByTimeAsync(2 * gapMs);
    expect(servedAt, "served after at most one refill interval, not after 50").toBeGreaterThanOrEqual(0);
    expect(servedAt).toBeLessThanOrEqual(Math.ceil(gapMs));
  });

  it("hands the turn on when the caller at the head aborts while waiting for a token", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    await drain(pacer);
    const head = new AbortController();
    const headResult = outcome(pacer.acquire("tok", "act_1", head.signal));
    await vi.advanceTimersByTimeAsync(10);
    let nextServedAt = -1;
    const start = Date.now();
    void pacer.acquire("tok", "act_1").then(() => { nextServedAt = Date.now() - start; });
    await vi.advanceTimersByTimeAsync(10);
    expect(pacer.queuedCallers).toBe(1);

    head.abort();
    expect(await headResult).toBe("aborted");
    await vi.advanceTimersByTimeAsync(2 * gapMs);
    expect(nextServedAt).toBeGreaterThanOrEqual(0);
    expect(nextServedAt).toBeLessThanOrEqual(Math.ceil(gapMs) + 20);
    expect(pacer.queuedCallers).toBe(0);
  });

  it("keeps the order of the callers that stay when one in the middle leaves", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    await drain(pacer);
    const order: string[] = [];
    const middle = new AbortController();
    void pacer.acquire("tok", "act_1").then(() => order.push("first"));
    const middleResult = outcome(pacer.acquire("tok", "act_1", middle.signal));
    void pacer.acquire("tok", "act_1").then(() => order.push("third"));
    void pacer.acquire("tok", "act_1").then(() => order.push("fourth"));
    await vi.advanceTimersByTimeAsync(10);
    middle.abort();
    expect(await middleResult).toBe("aborted");
    await vi.advanceTimersByTimeAsync(5 * gapMs);
    expect(order).toEqual(["first", "third", "fourth"]);
  });

  it("is unaffected by a signal that never aborts, and leaves no listener behind", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    await drain(pacer);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let served = false;
    void pacer.acquire("tok", "act_1", controller.signal).then(() => { served = true; });
    await vi.advanceTimersByTimeAsync(2 * gapMs);
    expect(served).toBe(true);
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    expect(pacer.queuedCallers).toBe(0);
  });
});
