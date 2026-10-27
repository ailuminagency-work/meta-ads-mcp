import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { getRequestSignal, requestContext } from "../../src/auth/token-store.js";
import {
  DEFAULT_MAX_RUNNING_PER_SUBJECT,
  installToolRuntime,
  readToolRuntimeConfig,
  resetToolRuntimeForTests,
  runningToolCallsForTests,
} from "../../src/tools/tool-runtime.js";
import { createMockMcpServer } from "../setup.js";

type Handler = (...args: unknown[]) => Promise<unknown>;

function serverWith(handler: Handler, options: { noArgs?: boolean } = {}) {
  const server = createMockMcpServer();
  installToolRuntime(server as never);
  (server.registerTool as unknown as (n: string, c: unknown, h: Handler) => void)("t", options.noArgs ? {} : { inputSchema: {} }, handler);
  return server._registeredTools[0].handler as Handler;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const as = <T>(fbUserId: string, run: () => T): T => requestContext.run({ accessToken: `synthetic-${fbUserId}`, fbUserId }, run);

beforeEach(() => {
  resetToolRuntimeForTests();
  vi.stubEnv("META_ACCESS_TOKEN", "synthetic-token");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("tool runtime wrapper: the request's abort signal", () => {
  it("hands the SDK's extra.signal to everything the handler awaits", async () => {
    let seen: AbortSignal | undefined;
    const handler = serverWith(async () => { await Promise.resolve(); seen = getRequestSignal(); return "ok"; });
    const controller = new AbortController();
    await expect(handler({ a: 1 }, { signal: controller.signal })).resolves.toBe("ok");
    expect(seen).toBe(controller.signal);
    expect(getRequestSignal()).toBeUndefined();
  });

  it("finds the signal on a handler registered without an input schema, which receives only extra", async () => {
    let seen: AbortSignal | undefined;
    const handler = serverWith(async () => { seen = getRequestSignal(); return "ok"; }, { noArgs: true });
    const controller = new AbortController();
    await handler({ signal: controller.signal, requestId: 1 });
    expect(seen).toBe(controller.signal);
  });

  it("works when the transport gives no signal, and passes arguments and results through untouched", async () => {
    const received: unknown[][] = [];
    const handler = serverWith(async (...args) => { received.push(args); return { content: [] }; });
    await expect(handler({ x: 1 })).resolves.toEqual({ content: [] });
    expect(received).toEqual([[{ x: 1 }]]);
  });

  it("keeps the signal when the handler opens a nested request context with another credential", async () => {
    let seen: AbortSignal | undefined;
    const handler = serverWith(async () => requestContext.run({ accessToken: "other", fbUserId: "x" }, async () => { seen = getRequestSignal(); }));
    const controller = new AbortController();
    await handler({}, { signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });

  it("is installed once per server", () => {
    const server = createMockMcpServer();
    installToolRuntime(server as never);
    const wrapped = server.registerTool;
    installToolRuntime(server as never);
    expect(server.registerTool).toBe(wrapped);
  });
});

describe("tool runtime wrapper: running gauge per subject", () => {
  it("refuses a call above the cap even when the handler ignores the signal and the client has gone", async () => {
    vi.stubEnv("MCP_MAX_RUNNING_PER_SUBJECT", "3");
    const gate = deferred();
    const handler = serverWith(async () => { await gate.promise; return "done"; });
    const controllers = [0, 1, 2].map(() => new AbortController());
    const running = controllers.map((c) => as("alice", () => handler({}, { signal: c.signal })));
    await Promise.resolve();
    expect(runningToolCallsForTests()).toEqual({ total: 3, subjects: 1 });

    for (const c of controllers) c.abort();
    await new Promise((r) => setTimeout(r, 20));
    expect(runningToolCallsForTests().total, "an abort does not free the place").toBe(3);

    const refused = as("alice", () => handler({}, { signal: new AbortController().signal }));
    await expect(refused).rejects.toBeInstanceOf(McpError);
    await expect(as("alice", () => handler({}, {}))).rejects.toThrow(/Too many concurrent tool calls/);
    expect(runningToolCallsForTests().total).toBe(3);

    gate.resolve();
    await Promise.all(running);
    expect(runningToolCallsForTests()).toEqual({ total: 0, subjects: 0 });
    await expect(as("alice", () => handler({}, {}))).resolves.toBe("done");
  });

  it("defaults to 8 running calls per subject", async () => {
    expect(DEFAULT_MAX_RUNNING_PER_SUBJECT).toBe(8);
    const gate = deferred();
    const handler = serverWith(async () => { await gate.promise; });
    const calls = Array.from({ length: 8 }, () => as("alice", () => handler({}, {})));
    await expect(as("alice", () => handler({}, {}))).rejects.toThrow(/Too many concurrent tool calls/);
    gate.resolve();
    await Promise.all(calls);
  });

  it("counts each subject on its own", async () => {
    vi.stubEnv("MCP_MAX_RUNNING_PER_SUBJECT", "1");
    const gate = deferred();
    const handler = serverWith(async () => { await gate.promise; return "ok"; });
    const alice = as("alice", () => handler({}, {}));
    const bob = as("bob", () => handler({}, {}));
    await expect(as("alice", () => handler({}, {}))).rejects.toThrow(/Too many/);
    expect(runningToolCallsForTests()).toEqual({ total: 2, subjects: 2 });
    gate.resolve();
    await expect(Promise.all([alice, bob])).resolves.toEqual(["ok", "ok"]);
  });

  it("frees the place when the handler throws, rejects or throws synchronously", async () => {
    vi.stubEnv("MCP_MAX_RUNNING_PER_SUBJECT", "1");
    const handler = serverWith((async (input: unknown) => {
      if ((input as { how: string }).how === "sync") throw new Error("sync");
      if ((input as { how: string }).how === "reject") return Promise.reject(new Error("rejected"));
      return "fine";
    }) as Handler);
    await expect(as("a", () => handler({ how: "sync" }, {}))).rejects.toThrow("sync");
    await expect(as("a", () => handler({ how: "reject" }, {}))).rejects.toThrow("rejected");
    await expect(as("a", () => handler({ how: "ok" }, {}))).resolves.toBe("fine");
    expect(runningToolCallsForTests()).toEqual({ total: 0, subjects: 0 });
  });

  it("falls back to the token, then to a local subject, when there is no user id", async () => {
    vi.stubEnv("MCP_MAX_RUNNING_PER_SUBJECT", "1");
    const gate = deferred();
    const handler = serverWith(async () => { await gate.promise; });
    const first = handler({}, {});
    await expect(handler({}, {})).rejects.toThrow(/Too many/);
    const other = requestContext.run({ accessToken: "synthetic-other-token" }, () => handler({}, {}));
    expect(runningToolCallsForTests()).toEqual({ total: 2, subjects: 2 });
    gate.resolve();
    await Promise.all([first, other]);
  });

  it("gives back a place whose handler never returns, after the longest request the transport allows", async () => {
    vi.useFakeTimers();
    vi.stubEnv("MCP_MAX_RUNNING_PER_SUBJECT", "1");
    const handler = serverWith(() => new Promise(() => undefined));
    void as("alice", () => handler({}, {}));
    await Promise.resolve();
    expect(runningToolCallsForTests().total).toBe(1);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 1);
    expect(runningToolCallsForTests()).toEqual({ total: 0, subjects: 0 });
  });
});

describe("MCP_MAX_RUNNING_PER_SUBJECT", () => {
  it("uses the default when unset or blank, and accepts a positive integer up to 1000", () => {
    expect(readToolRuntimeConfig({})).toEqual({ maxRunningPerSubject: 8 });
    expect(readToolRuntimeConfig({ MCP_MAX_RUNNING_PER_SUBJECT: "  " })).toEqual({ maxRunningPerSubject: 8 });
    expect(readToolRuntimeConfig({ MCP_MAX_RUNNING_PER_SUBJECT: "1" })).toEqual({ maxRunningPerSubject: 1 });
    expect(readToolRuntimeConfig({ MCP_MAX_RUNNING_PER_SUBJECT: "1000" })).toEqual({ maxRunningPerSubject: 1000 });
  });

  it.each(["0", "-1", "1001", "1.5", "abc", "08", "1e3", "99999999999"])("refuses %s instead of silently using the default", (value) => {
    expect(() => readToolRuntimeConfig({ MCP_MAX_RUNNING_PER_SUBJECT: value })).toThrow(/MCP_MAX_RUNNING_PER_SUBJECT must be a positive integer no greater than 1000/);
  });

  it("makes a call fail, not run unbounded, when the set value is unusable", async () => {
    vi.stubEnv("MCP_MAX_RUNNING_PER_SUBJECT", "banana");
    const handler = serverWith(async () => "ran");
    await expect(handler({}, {})).rejects.toThrow(/MCP_MAX_RUNNING_PER_SUBJECT/);
    expect(runningToolCallsForTests().total).toBe(0);
  });
});
