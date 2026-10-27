import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, runWithRequestSignal } from "../../src/auth/token-store.js";
import { MetaApiClient } from "../../src/meta/client.js";
import { RequestAbortedError } from "../../src/utils/abortable.js";
import { cleanupTestToken, mockFetchResponse, setupTestToken } from "../setup.js";

vi.mock("../../src/utils/logger.js", () => {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => logger };
  return { logger };
});

/**
 * The two waits in front of every Graph call, the write pacer's queue and the
 * rate limiter's sleep, must be cancelled by an abort, not just stopped being
 * waited for: an abandoned wait keeps the aborted request's whole graph alive.
 */
const TOKEN = "test-access-token";
const timers = () => process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Internals = { writePacer: { queuedCallers: number }; rateLimiter: { markRetryAfter(c: { tokenHash: string; accountId?: string }, t: string, ms: number): void } };
let client: MetaApiClient;
let internals: Internals;
let graphCalls: number;

beforeEach(() => {
  setupTestToken(TOKEN);
  graphCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    graphCalls += 1;
    return mockFetchResponse({ id: "1" });
  }));
  client = new MetaApiClient({ apiVersion: "v26.0", baseUrl: "https://graph.facebook.com", timeout: 30_000, maxRetries: 0 });
  internals = client as unknown as Internals;
});
afterEach(() => {
  cleanupTestToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function payloadSignal(controller: AbortController): AbortSignal {
  (controller.signal as unknown as { payload: string }).payload = "x".repeat(1_000_000);
  return controller.signal;
}

describe("write pacer queue", () => {
  it("200 aborted queued writes leave an empty queue, no timer, and bounded heap", async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    for (let i = 0; i < 10; i++) await client.postForm("/act_1/campaigns", { name: "x" });
    const timersBefore = timers();
    const heapBefore = (gc?.(), process.memoryUsage().heapUsed);

    const controllers = Array.from({ length: 200 }, () => new AbortController());
    const calls = controllers.map((c) =>
      runWithRequestSignal(payloadSignal(c), () => client.postForm("/act_1/campaigns", { name: "x" })).then(() => "sent", (e: unknown) => e),
    );
    await sleep(30);
    expect(internals.writePacer.queuedCallers, "queued behind the pacer").toBeGreaterThan(100);

    const started = Date.now();
    for (const c of controllers) c.abort();
    const results = await Promise.all(calls);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(results.every((r) => r instanceof RequestAbortedError)).toBe(true);

    controllers.length = 0;
    await sleep(30);
    expect(internals.writePacer.queuedCallers, "queue after the aborts").toBe(0);
    expect(timers() - timersBefore, "pacer timers left running").toBeLessThanOrEqual(1);
    expect(graphCalls, "no write was sent for a caller that had gone").toBe(10);
    if (gc) {
      gc();
      expect(process.memoryUsage().heapUsed - heapBefore, "heap held by aborted writers (run with NODE_OPTIONS=--expose-gc)").toBeLessThan(40 * 1024 * 1024);
    }
  }, 60_000);
});

describe("rate limiter sleep", () => {
  const block = (ms: number) => internals.rateLimiter.markRetryAfter({ tokenHash: hashToken(TOKEN), accountId: "act_1" }, "ads_management", ms);

  it("aborting during a 25 s throttle ends 200 calls promptly, with no sleeping timer and bounded heap", async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    block(25_000);
    const timersBefore = timers();
    const heapBefore = (gc?.(), process.memoryUsage().heapUsed);

    const controllers = Array.from({ length: 200 }, () => new AbortController());
    const calls = controllers.map((c) =>
      runWithRequestSignal(payloadSignal(c), () => client.get("/act_1/campaigns")).then(() => "sent", (e: unknown) => e),
    );
    await sleep(30);
    expect(timers() - timersBefore, "calls are sleeping out the throttle").toBeGreaterThan(100);

    const started = Date.now();
    for (const c of controllers) c.abort();
    const results = await Promise.all(calls);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(results.every((r) => r instanceof RequestAbortedError)).toBe(true);

    controllers.length = 0;
    await sleep(30);
    expect(timers() - timersBefore, "sleep timers left running").toBeLessThanOrEqual(1);
    expect(graphCalls).toBe(0);
    if (gc) {
      gc();
      expect(process.memoryUsage().heapUsed - heapBefore, "heap held by aborted sleepers (run with NODE_OPTIONS=--expose-gc)").toBeLessThan(40 * 1024 * 1024);
    }
  }, 60_000);

  it("a block longer than 30 s is refused at once with the time left, and nothing is sent or slept", async () => {
    block(10 * 60_000);
    const timersBefore = timers();
    const started = Date.now();
    const error = await client.get("/act_1/campaigns").catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(500);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).message).toMatch(/Meta rate limit active for this token, retry in (59\d|600) seconds/);
    expect(graphCalls).toBe(0);
    expect(timers() - timersBefore).toBeLessThanOrEqual(1);
  });

  it("a short block is still slept out and the call then goes through", async () => {
    vi.useFakeTimers();
    block(2_000);
    const call = client.get("/act_1/campaigns");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(graphCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(call).resolves.toEqual({ id: "1" });
    expect(graphCalls).toBe(1);
    vi.useRealTimers();
  });
});
