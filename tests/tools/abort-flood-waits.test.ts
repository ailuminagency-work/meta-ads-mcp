import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, requestContext } from "../../src/auth/token-store.js";
import { metaApiClient } from "../../src/meta/client.js";
import { createServer } from "../../src/server.js";
import { resetToolRuntimeForTests, runningToolCallsForTests } from "../../src/tools/tool-runtime.js";

vi.mock("../../src/utils/logger.js", () => {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => logger };
  return { logger };
});

/**
 * The reviewers' two crash loops at reduced scale, through the real server: one
 * credential starts calls that block in the write pacer's queue or in the rate
 * limiter's sleep, and drops each a moment later. Nothing may stay queued,
 * sleeping or running, and the heap may not keep the dropped calls.
 */
const CALLS = 150;
const USER_TOKEN = "synthetic-user-token";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timers = () => process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;

type Internals = { writePacer: { queuedCallers: number }; rateLimiter: { markRetryAfter(c: { tokenHash: string; accountId?: string }, t: string, ms: number): void } };
const internals = metaApiClient as unknown as Internals;
let graphRequests: number;

beforeEach(() => {
  resetToolRuntimeForTests();
  metaApiClient.resetForTests();
  for (const [key, value] of Object.entries({ LUMIN_PLATFORM_ENABLED: "false", META_API_VERSION: "v26.0", META_ACCESS_TOKEN: "synthetic-token" })) vi.stubEnv(key, value);
  graphRequests = 0;
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    graphRequests += 1;
    const body = init?.method === "POST" ? { report_run_id: "123456789012345" } : { id: "123456789012345", async_status: "Job Running", async_percent_completion: 1, data: [] };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function dropAll(name: string, toolArgs: Record<string, unknown>, count: number, abortAfterMs: number) {
  const pairs: Array<{ client: Client; closeServer: () => Promise<void> }> = [];
  const calls: Array<Promise<unknown>> = [];
  for (let i = 0; i < count; i++) {
    const server = createServer();
    const client = new Client({ name: "flood", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    pairs.push({ client, closeServer: () => server.close() });
    const controller = new AbortController();
    calls.push(
      requestContext
        .run({ accessToken: USER_TOKEN, fbUserId: "100000000000001" }, () => client.callTool({ name, arguments: toolArgs }, undefined, { signal: controller.signal }))
        .catch(() => undefined),
    );
    setTimeout(() => controller.abort(), abortAfterMs);
  }
  return { pairs, calls };
}

async function release(pairs: Array<{ client: Client; closeServer: () => Promise<void> }>, calls: unknown[]): Promise<void> {
  await Promise.all(pairs.map(async ({ client, closeServer }) => { await client.close(); await closeServer(); }));
  pairs.length = 0;
  calls.length = 0;
}

async function untilQuiet(limitMs: number, extra: () => boolean): Promise<void> {
  const limit = Date.now() + limitMs;
  while ((runningToolCallsForTests().total > 0 || extra()) && Date.now() < limit) await sleep(10);
}

describe("dropped calls blocked in a wait in front of Graph", () => {
  it("write path: dropped report writes leave the pacer queue and nothing keeps running", async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const timersBefore = timers();
    const heapBefore = (gc?.(), process.memoryUsage().heapUsed);
    const { pairs, calls } = await dropAll("ads_run_report_and_wait", { object_id: "act_1", date_preset: "last_7d", level: "campaign", max_wait_seconds: 900 }, CALLS, 40);
    await Promise.all(calls);
    await untilQuiet(1500, () => internals.writePacer.queuedCallers > 0);

    const queued = internals.writePacer.queuedCallers;
    const running = runningToolCallsForTests();
    await release(pairs, calls);
    let retained = 0;
    if (gc) {
      await sleep(50);
      gc();
      retained = process.memoryUsage().heapUsed - heapBefore;
    }
    await sleep(30);

    expect(graphRequests, "the calls reached Graph").toBeGreaterThan(0);
    expect(queued, "writes still queued in the pacer").toBe(0);
    expect(running, "handlers still running").toEqual({ total: 0, subjects: 0 });
    expect(timers() - timersBefore, "timers left by dropped calls").toBeLessThanOrEqual(2);
    if (gc) expect(retained, "heap retained by dropped calls (run with NODE_OPTIONS=--expose-gc)").toBeLessThan(60 * 1024 * 1024);
  }, 120_000);

  it("read path: dropped calls sleeping in a 25 s throttle wake, leave, and keep nothing", async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    internals.rateLimiter.markRetryAfter({ tokenHash: hashToken(USER_TOKEN) }, "ads_management", 25_000);
    const timersBefore = timers();
    const heapBefore = (gc?.(), process.memoryUsage().heapUsed);
    const { pairs, calls } = await dropAll("ads_get_ad_accounts", {}, CALLS, 40);
    await Promise.all(calls);
    await untilQuiet(1500, () => timers() - timersBefore > 2);

    const running = runningToolCallsForTests();
    const sleeping = timers() - timersBefore;
    await release(pairs, calls);
    let retained = 0;
    if (gc) {
      await sleep(50);
      gc();
      retained = process.memoryUsage().heapUsed - heapBefore;
    }

    expect(graphRequests, "a call during the throttle reached Graph").toBe(0);
    expect(running, "handlers still running").toEqual({ total: 0, subjects: 0 });
    expect(sleeping, "sleep timers left by dropped calls").toBeLessThanOrEqual(2);
    // 150 sleepers abandoned on freeze 4 pinned about 16 MiB here (more through the HTTP transport); cancelled ones pin none.
    if (gc) expect(retained, "heap retained by dropped calls (run with NODE_OPTIONS=--expose-gc)").toBeLessThan(10 * 1024 * 1024);
  }, 120_000);

  it("a ten minute Meta block is a prompt tool error, not a call held for ten minutes", async () => {
    internals.rateLimiter.markRetryAfter({ tokenHash: hashToken(USER_TOKEN) }, "ads_management", 10 * 60_000);
    const server = createServer();
    const client = new Client({ name: "blocked", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const started = Date.now();
    const result = (await requestContext.run({ accessToken: USER_TOKEN, fbUserId: "100000000000001" }, () =>
      client.callTool({ name: "ads_get_ad_accounts", arguments: {} }),
    )) as { isError?: boolean; content: Array<{ text: string }> };
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Meta rate limit active for this token, retry in (59\d|600) seconds/);
    expect(graphRequests).toBe(0);
    expect(runningToolCallsForTests().total).toBe(0);
    await client.close();
    await server.close();
  });
});
