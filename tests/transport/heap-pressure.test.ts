import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import v8 from "node:v8";
import {
  DEFAULT_MCP_HEAP_PRESSURE_PERCENT,
  HEAP_SAMPLE_INTERVAL_MS,
  HeapPressureGuard,
  readHeapPressurePercent,
  type HeapReading,
} from "../../src/transport/heap-pressure.js";
import { createMcpAdmission, readMcpAdmissionConfig, type McpAdmission } from "../../src/transport/mcp-admission.js";
import { logger } from "../../src/utils/logger.js";
import { startAuthServer, type AuthServer } from "./auth-flow-harness.js";

const MIB = 1_048_576;
const LIMIT = 1_000 * MIB;
const at = (percent: number): HeapReading => ({ usedBytes: (percent / 100) * LIMIT, limitBytes: LIMIT });

let server: http.Server | undefined;
let authServer: AuthServer | undefined;

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
  await authServer?.close();
  authServer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A sampler the test steers, and counts. */
function steered(initial: number) {
  const state = { percent: initial, calls: 0 };
  return {
    state,
    sampler: (): HeapReading => {
      state.calls += 1;
      return at(state.percent);
    },
  };
}

describe("HeapPressureGuard", () => {
  const STEP = HEAP_SAMPLE_INTERVAL_MS;

  it("engages only after two consecutive readings above the threshold, at least one interval apart", () => {
    const { state, sampler } = steered(50);
    const guard = new HeapPressureGuard({ percent: 80, sampler });
    let now = 1_000_000;

    expect(guard.isEngaged(now)).toBe(false);
    state.percent = 90;
    now += STEP;
    expect(guard.isEngaged(now)).toBe(false);
    now += STEP;
    expect(guard.isEngaged(now)).toBe(true);
    expect(guard.active).toBe(true);
  });

  it("releases at the first reading below the threshold", () => {
    const { state, sampler } = steered(90);
    const guard = new HeapPressureGuard({ percent: 80, sampler });
    let now = 1_000_000;
    guard.isEngaged(now);
    now += STEP;
    expect(guard.isEngaged(now)).toBe(true);

    state.percent = 79;
    now += STEP;
    expect(guard.isEngaged(now)).toBe(false);
    state.percent = 90;
    now += STEP;
    expect(guard.isEngaged(now)).toBe(false);
    now += STEP;
    expect(guard.isEngaged(now)).toBe(true);
  });

  it("does not engage on one high reading between low ones: uncollected garbage is not pressure", () => {
    const { state, sampler } = steered(60);
    const guard = new HeapPressureGuard({ percent: 80, sampler });
    let now = 1_000_000;
    for (const percent of [60, 95, 60, 95, 60, 95, 60]) {
      state.percent = percent;
      now += STEP;
      expect(guard.isEngaged(now)).toBe(false);
    }
  });

  it("takes at most one reading per interval and answers from the cache in between", () => {
    const { state, sampler } = steered(90);
    const guard = new HeapPressureGuard({ percent: 80, sampler });
    const start = 1_000_000;
    guard.isEngaged(start);
    for (let offset = 0; offset < STEP; offset += 10) guard.isEngaged(start + offset);
    expect(state.calls).toBe(1);

    guard.isEngaged(start + STEP);
    expect(state.calls).toBe(2);
    expect(guard.isEngaged(start + STEP + 1)).toBe(true);
    state.percent = 10;
    expect(guard.isEngaged(start + STEP + STEP - 1)).toBe(true);
    expect(state.calls).toBe(2);
  });

  it("does not pair a high reading with one taken long after it", () => {
    const { sampler } = steered(90);
    const guard = new HeapPressureGuard({ percent: 80, sampler });
    let now = 1_000_000;
    expect(guard.isEngaged(now)).toBe(false);
    now += 60_000;
    expect(guard.isEngaged(now)).toBe(false);
    now += STEP;
    expect(guard.isEngaged(now)).toBe(true);
  });

  it("compares strictly above the threshold and ignores a reading without a limit", () => {
    const exact = steered(80);
    const guard = new HeapPressureGuard({ percent: 80, sampler: exact.sampler });
    guard.isEngaged(1_000_000);
    expect(guard.isEngaged(1_000_000 + STEP)).toBe(false);

    const none = new HeapPressureGuard({ percent: 80, sampler: () => ({ usedBytes: 5, limitBytes: 0 }) });
    none.isEngaged(1_000_000);
    expect(none.isEngaged(1_000_000 + STEP)).toBe(false);
  });

  it("takes a fresh reading when the clock moves backwards", () => {
    const { state, sampler } = steered(90);
    const guard = new HeapPressureGuard({ percent: 80, sampler });
    guard.isEngaged(2_000_000);
    guard.isEngaged(2_000_000 + STEP);
    expect(guard.active).toBe(true);
    state.percent = 10;
    expect(guard.isEngaged(1_000_000)).toBe(false);
  });

  it("is off, and never reads the heap, when the threshold is 0", () => {
    const { sampler, state } = steered(99);
    const guard = new HeapPressureGuard({ percent: 0, sampler });
    for (let step = 0; step < 10; step += 1) expect(guard.isEngaged(1_000_000 + step * STEP)).toBe(false);
    expect(state.calls).toBe(0);
    expect(guard.enabled).toBe(false);
  });

  it("reads the real V8 heap by default", () => {
    const guard = new HeapPressureGuard({ percent: 95 });
    guard.isEngaged(Date.now());
    expect(guard.reading.limitBytes).toBeGreaterThan(0);
    expect(guard.reading.usedBytes).toBeGreaterThan(0);
  });
});

describe("MCP_HEAP_PRESSURE_PERCENT", () => {
  it("defaults to 80 when unset or empty", () => {
    expect(DEFAULT_MCP_HEAP_PRESSURE_PERCENT).toBe(70);
    expect(readHeapPressurePercent({})).toBe(70);
    expect(readHeapPressurePercent({ MCP_HEAP_PRESSURE_PERCENT: "" })).toBe(70);
    expect(readHeapPressurePercent({ MCP_HEAP_PRESSURE_PERCENT: "  " })).toBe(70);
    expect(readMcpAdmissionConfig({}).heapPressurePercent).toBe(70);
  });

  it.each(["50", "70", "80", "95"])("accepts %s", (value) => {
    expect(readHeapPressurePercent({ MCP_HEAP_PRESSURE_PERCENT: value })).toBe(Number(value));
    expect(readMcpAdmissionConfig({ MCP_HEAP_PRESSURE_PERCENT: value }).heapPressurePercent).toBe(Number(value));
  });

  it.each(["0", "off", "OFF", "Off", " off "])("turns the check off for %j", (value) => {
    expect(readHeapPressurePercent({ MCP_HEAP_PRESSURE_PERCENT: value })).toBe(0);
  });

  it.each(["49", "96", "100", "-1", "80.5", "abc", "08", "1e2", "0x50", "false", "no", "80%"])("refuses %j", (value) => {
    expect(() => readHeapPressurePercent({ MCP_HEAP_PRESSURE_PERCENT: value })).toThrow(/MCP_HEAP_PRESSURE_PERCENT must be an integer from 50 to 95, or 0 or off/);
    expect(() => readMcpAdmissionConfig({ MCP_HEAP_PRESSURE_PERCENT: value })).toThrow(/MCP_HEAP_PRESSURE_PERCENT/);
  });
});

describe("heap pressure in the /mcp admission", () => {
  let clock = 1_700_000_000_000;

  async function start(admission: McpAdmission): Promise<string> {
    const app = express();
    app.post(
      "/mcp",
      (req, _res, next) => {
        const user = req.headers["x-test-user"];
        (req as express.Request & { auth?: unknown }).auth = { clientId: "synthetic-client", extra: typeof user === "string" ? { fbUserId: user } : {} };
        next();
      },
      admission,
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function call(base: string, user = "user-a"): Promise<{ status: number; retryAfter: string | null; body: string }> {
    const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "x-test-user": user, "content-type": "application/json" }, body: "{}" });
    return { status: response.status, retryAfter: response.headers.get("retry-after"), body: await response.text() };
  }

  function admissionWith(percent: number, sampler: () => HeapReading, overrides: Record<string, number> = {}): McpAdmission {
    clock = 1_700_000_000_000;
    return createMcpAdmission(
      { maxInFlight: 16, perSubjectPerWindow: 120, windowMs: 60_000, maxTrackedSubjects: 10_000, heapPressurePercent: percent, heapSampler: sampler, ...overrides },
      () => clock,
    );
  }

  it("refuses with 503, Retry-After 5 and a JSON-RPC error once the guard is engaged, and serves again at the first low reading", async () => {
    const { state, sampler } = steered(50);
    const admission = admissionWith(80, sampler);
    const base = await start(admission);
    expect((await call(base)).status).toBe(200);

    state.percent = 92;
    clock += HEAP_SAMPLE_INTERVAL_MS;
    expect((await call(base)).status).toBe(200);
    clock += HEAP_SAMPLE_INTERVAL_MS;
    const refused = await call(base);

    expect(refused.status).toBe(503);
    expect(refused.retryAfter).toBe("5");
    expect(JSON.parse(refused.body)).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Server is under memory pressure; retry after the interval in the Retry-After header" },
      id: null,
    });
    expect(admission.stats().rejectedHeapPressure).toBe(1);
    expect(admission.stats().heapPressureEngaged).toBe(true);

    state.percent = 40;
    clock += HEAP_SAMPLE_INTERVAL_MS;
    expect((await call(base)).status).toBe(200);
    expect(admission.stats().heapPressureEngaged).toBe(false);
  });

  it("takes no slot and spends no rate allowance for a refused call", async () => {
    const { state, sampler } = steered(95);
    const admission = admissionWith(80, sampler, { perSubjectPerWindow: 2 });
    const base = await start(admission);
    await call(base);
    clock += HEAP_SAMPLE_INTERVAL_MS;
    for (let index = 0; index < 10; index += 1) expect((await call(base)).status).toBe(503);
    expect(admission.stats()).toMatchObject({ inFlight: 0, admitted: 1, rejectedRate: 0, rejectedHeapPressure: 10 });

    state.percent = 10;
    clock += HEAP_SAMPLE_INTERVAL_MS;
    expect((await call(base)).status).toBe(200);
    expect((await call(base)).status).toBe(429);
  });

  it("counts the refusals but writes one warning, then one more per 30 seconds, without the subject", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { sampler } = steered(95);
    const admission = admissionWith(80, sampler);
    const base = await start(admission);
    await call(base, "user-secret-looking-id");
    clock += HEAP_SAMPLE_INTERVAL_MS;

    for (let index = 0; index < 200; index += 1) await call(base, "user-secret-looking-id");
    const lines = () => warn.mock.calls.filter((entry) => (entry[0] as { event?: string }).event === "mcp_heap_pressure_refused");
    expect(lines()).toHaveLength(1);
    expect(admission.stats().rejectedHeapPressure).toBe(200);

    for (let second = 0; second < 29; second += 1) {
      clock += 1_000;
      await call(base);
    }
    expect(lines()).toHaveLength(1);
    clock += 1_000;
    await call(base);
    expect(lines()).toHaveLength(2);
    expect(lines()[1][0]).toMatchObject({ event: "mcp_heap_pressure_refused", thresholdPercent: 80, heapLimitMb: 1000, refusedSinceLastLog: 199 + 29 + 1 });
    expect(JSON.stringify(lines())).not.toContain("user-secret-looking-id");
  });

  it("is off when the percentage is 0, however full the heap reads", async () => {
    const { sampler, state } = steered(99);
    const admission = admissionWith(0, sampler);
    const base = await start(admission);
    for (let step = 0; step < 6; step += 1) {
      clock += HEAP_SAMPLE_INTERVAL_MS;
      expect((await call(base)).status).toBe(200);
    }
    expect(state.calls).toBe(0);
    expect(admission.stats().rejectedHeapPressure).toBe(0);
  });

  it("is off in a config without the field, so the existing limits behave as before", async () => {
    clock = 1_700_000_000_000;
    const admission = createMcpAdmission({ maxInFlight: 16, perSubjectPerWindow: 120, windowMs: 60_000, maxTrackedSubjects: 10_000 }, () => clock);
    const base = await start(admission);
    clock += HEAP_SAMPLE_INTERVAL_MS;
    expect((await call(base)).status).toBe(200);
  });
});

describe("the heap guard through the real HTTP transport", () => {
  const KEY = "synthetic-mcp-api-key-".concat("a1b2".repeat(8));
  const META_TOKEN = "synthetic-meta-token-".concat("x9".repeat(8));
  const API_ENV = { META_APP_ID: "", META_APP_SECRET: "", MCP_API_KEY: KEY, META_ACCESS_TOKEN: "", AUTH_ALLOWED_FB_USER_IDS: "" };
  const authed = { "x-api-key": KEY, "x-meta-token": META_TOKEN };
  const PING = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });

  const post = async (origin: string, headers: Record<string, string>) => {
    const response = await fetch(`${origin}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: PING });
    await response.arrayBuffer();
    return { status: response.status, retryAfter: response.headers.get("retry-after") };
  };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("answers an unauthenticated call with 401 even while the heap is full, and an authenticated one with 503 once two readings agree", async () => {
    const heap = vi.spyOn(v8, "getHeapStatistics");
    const readings = (percent: number) => heap.mockReturnValue({ used_heap_size: percent * MIB, heap_size_limit: 100 * MIB } as ReturnType<typeof v8.getHeapStatistics>);
    readings(97);
    authServer = await startAuthServer(API_ENV);
    const origin = authServer.origin;

    expect((await post(origin, {})).status).toBe(401);
    expect((await post(origin, { "x-api-key": "wrong-key" })).status).toBe(401);
    expect((await post(origin, authed)).status).toBe(200);
    await wait(HEAP_SAMPLE_INTERVAL_MS + 60);
    expect((await post(origin, authed)).status).toBe(503);
    const refused = await post(origin, authed);
    expect(refused).toEqual({ status: 503, retryAfter: "5" });
    expect((await post(origin, {})).status).toBe(401);
    expect((await post(origin, { "x-api-key": "wrong-key" })).status).toBe(401);

    readings(30);
    await wait(HEAP_SAMPLE_INTERVAL_MS + 60);
    expect((await post(origin, authed)).status).toBe(200);
  });

  it("is off with MCP_HEAP_PRESSURE_PERCENT=off", async () => {
    vi.spyOn(v8, "getHeapStatistics").mockReturnValue({ used_heap_size: 99 * MIB, heap_size_limit: 100 * MIB } as ReturnType<typeof v8.getHeapStatistics>);
    authServer = await startAuthServer({ ...API_ENV, MCP_HEAP_PRESSURE_PERCENT: "off" });
    for (let step = 0; step < 3; step += 1) {
      expect((await post(authServer.origin, authed)).status).toBe(200);
      await wait(HEAP_SAMPLE_INTERVAL_MS + 60);
    }
  });

  it.each(["0.5", "49", "96", "abc", "-5"])("refuses to start when MCP_HEAP_PRESSURE_PERCENT is %s", async (value) => {
    await expect(startAuthServer({ ...API_ENV, MCP_HEAP_PRESSURE_PERCENT: value })).rejects.toThrow(/MCP_HEAP_PRESSURE_PERCENT must be an integer from 50 to 95/);
  });
});
