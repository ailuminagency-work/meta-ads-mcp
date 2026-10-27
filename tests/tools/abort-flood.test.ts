import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestContext } from "../../src/auth/token-store.js";
import { metaApiClient } from "../../src/meta/client.js";
import { createServer } from "../../src/server.js";
import { resetToolRuntimeForTests, runningToolCallsForTests } from "../../src/tools/tool-runtime.js";

/**
 * The reviewers' flood at reduced scale: one credential starts calls whose Graph
 * request never answers, and drops each of them a moment later. Every dropped
 * call must end with its client, free what it held, and leave nothing running.
 */
const CALLS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let graph: { started: number; open: number };

beforeEach(() => {
  resetToolRuntimeForTests();
  metaApiClient.resetForTests();
  for (const [key, value] of Object.entries({ LUMIN_PLATFORM_ENABLED: "false", META_API_VERSION: "v26.0", META_ACCESS_TOKEN: "synthetic-token" })) vi.stubEnv(key, value);
  graph = { started: 0, open: 0 };
  vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => {
    graph.started += 1;
    graph.open += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        graph.open -= 1;
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      });
    });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function dropped(name: string, toolArgs: Record<string, unknown>, count: number) {
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
        .run({ accessToken: "synthetic-user-token", fbUserId: "100000000000001" }, () => client.callTool({ name, arguments: toolArgs }, undefined, { signal: controller.signal }))
        .catch(() => undefined),
    );
    setTimeout(() => controller.abort(), 5);
  }
  return { pairs, calls };
}

async function settle(): Promise<void> {
  const limit = Date.now() + 1000;
  while ((graph.open > 0 || runningToolCallsForTests().total > 0) && Date.now() < limit) await sleep(10);
}

describe("dropped tool calls do not keep running", () => {
  it("ads_run_report_and_wait: every dropped call ends within a second of the abort, frees its Graph request and its place", async () => {
    const heapBefore = process.memoryUsage().heapUsed;
    const { pairs, calls } = await dropped("ads_run_report_and_wait", { object_id: "act_1", date_preset: "last_7d", level: "campaign", max_wait_seconds: 900 }, CALLS);
    await Promise.all(calls);
    await settle();
    const stillHeld = graph.open;
    const stillRunning = runningToolCallsForTests();

    // The test's own references go first: what is left after a collection is what the dropped calls pinned.
    await Promise.all(pairs.map(async ({ client, closeServer }) => { await client.close(); await closeServer(); }));
    pairs.length = 0;
    calls.length = 0;
    const gc = (globalThis as { gc?: () => void }).gc;
    let retained = 0;
    if (gc) {
      await sleep(50);
      gc();
      retained = process.memoryUsage().heapUsed - heapBefore;
    }

    expect(graph.started, "every call reached Graph").toBeGreaterThan(0);
    expect(stillHeld, "Graph requests still held after the clients dropped").toBe(0);
    expect(stillRunning, "handlers still running").toEqual({ total: 0, subjects: 0 });
    if (gc) expect(retained, "heap retained by dropped calls (run with NODE_OPTIONS=--expose-gc)").toBeLessThan(60 * 1024 * 1024);
  }, 120_000);

  it("an ordinary read tool: the held Graph request is aborted with the client", async () => {
    const { pairs, calls } = await dropped("ads_get_campaigns", { account_id: "act_1" }, 40);
    await Promise.all(calls);
    await settle();
    expect(graph.open).toBe(0);
    expect(runningToolCallsForTests().total).toBe(0);
    await Promise.all(pairs.map(async ({ client, closeServer }) => { await client.close(); await closeServer(); }));
  }, 60_000);

  it("a call that is not dropped still completes normally after a flood", async () => {
    const { pairs, calls } = await dropped("ads_get_campaigns", { account_id: "act_1" }, 20);
    await Promise.all(calls);
    await settle();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: [{ id: "1", name: "Campaign" }] }), { headers: { "content-type": "application/json" } }));
    const server = createServer();
    const client = new Client({ name: "normal", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const result = (await requestContext.run({ accessToken: "synthetic-user-token", fbUserId: "100000000000001" }, () =>
      client.callTool({ name: "ads_get_campaigns", arguments: { account_id: "act_1" } }),
    )) as { isError?: boolean };
    expect(result.isError).not.toBe(true);
    await client.close();
    await server.close();
    await Promise.all(pairs.map(async ({ client: c, closeServer }) => { await c.close(); await closeServer(); }));
  }, 60_000);
});
