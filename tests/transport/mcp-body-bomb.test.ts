import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  MCP_MAX_JSON_CONTAINERS,
  MCP_MAX_JSON_DEPTH,
  mcpJsonParser,
  preAuthJsonParser,
} from "../../src/transport/body-limits.js";
import { mcpBodyErrorHandler } from "../../src/transport/mcp-guards.js";

let server: http.Server | undefined;
let handlerRuns = 0;

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  handlerRuns = 0;
});

async function start(): Promise<string> {
  const app = express();
  app.use(preAuthJsonParser());
  app.post("/register", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/mcp", mcpJsonParser(), (_req, res) => {
    handlerRuns += 1;
    res.json({ jsonrpc: "2.0", id: 1, result: {} });
  });
  app.use("/mcp", mcpBodyErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(base: string, path: string, body: Buffer | string): Promise<{ status: number; body: string; ms: number }> {
  const payload = typeof body === "string" ? Buffer.from(body) : body;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${path}`,
      { method: "POST", headers: { "content-type": "application/json", "content-length": payload.length } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text, ms: Date.now() - started }));
      },
    );
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNRESET" || error.code === "EPIPE") resolve({ status: 0, body: error.code, ms: Date.now() - started });
      else reject(error);
    });
    req.end(payload);
  });
}

const rpc = (argument: string) =>
  `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ads_get_campaigns","arguments":{"junk":${argument}}}}`;

const nestedArrays = (depth: number) => "[".repeat(depth) + "]".repeat(depth);

function largeParses(spy: ReturnType<typeof vi.spyOn>, minChars: number): number {
  return spy.mock.calls.filter(([text]) => typeof text === "string" && text.length >= minChars).length;
}

describe("authenticated /mcp body is bounded before it is parsed (G3-01)", () => {
  it("refuses the 10 MB nested-array body without parsing it, without running the handler and without a heap spike", async () => {
    const base = await start();
    const spy = vi.spyOn(JSON, "parse");
    const body = rpc(nestedArrays(5_000_000));
    expect(body.length).toBeGreaterThan(10_000_000);
    expect(body.length).toBeLessThan(10 * 1_048_576);
    const heapBefore = process.memoryUsage().heapUsed;

    const response = await post(base, "/mcp", body);

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid request" }, id: null });
    expect(handlerRuns).toBe(0);
    expect(largeParses(spy, 10_000)).toBe(0);
    expect(response.ms).toBeLessThan(1_500);
    expect((process.memoryUsage().heapUsed - heapBefore) / 1_048_576).toBeLessThan(64);
  });

  it("refuses a body that fits the byte cap but nests 450,000 levels deep, before JSON.parse", async () => {
    const base = await start();
    const spy = vi.spyOn(JSON, "parse");
    const body = rpc(nestedArrays(450_000));
    expect(body.length).toBeLessThan(1_000_000);
    const heapBefore = process.memoryUsage().heapUsed;

    const response = await post(base, "/mcp", body);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid request" }, id: null });
    expect(handlerRuns).toBe(0);
    expect(largeParses(spy, 10_000)).toBe(0);
    expect((process.memoryUsage().heapUsed - heapBefore) / 1_048_576).toBeLessThan(32);
  });

  it("refuses a flat array of 300,000 empty objects (the allocation-heavy shape) before JSON.parse", async () => {
    const base = await start();
    const spy = vi.spyOn(JSON, "parse");
    const body = rpc(`[${"{},".repeat(300_000)}{}]`);
    expect(body.length).toBeLessThan(1_000_000);

    const response = await post(base, "/mcp", body);

    expect(response.status).toBe(400);
    expect(handlerRuns).toBe(0);
    expect(largeParses(spy, 10_000)).toBe(0);
  });

  it("refuses a flat array of empty arrays and a deep chain of objects the same way", async () => {
    const base = await start();
    const flatArrays = await post(base, "/mcp", rpc(`[${"[],".repeat(300_000)}[]]`));
    const objectChain = await post(base, "/mcp", rpc(`${'{"a":'.repeat(100_000)}1${"}".repeat(100_000)}`));
    expect(flatArrays.status).toBe(400);
    expect(objectChain.status).toBe(400);
    expect(handlerRuns).toBe(0);
  });

  it("accepts nesting at the depth limit and refuses one level more", async () => {
    const base = await start();
    const wrapper = 3;
    const atLimit = await post(base, "/mcp", rpc(nestedArrays(MCP_MAX_JSON_DEPTH - wrapper)));
    const over = await post(base, "/mcp", rpc(nestedArrays(MCP_MAX_JSON_DEPTH - wrapper + 1)));
    expect(atLimit.status).toBe(200);
    expect(over.status).toBe(400);
    expect(handlerRuns).toBe(1);
  });

  it("accepts the container limit and refuses one container more", async () => {
    const base = await start();
    const envelope = 3;
    const atLimit = await post(base, "/mcp", rpc(`[${Array.from({ length: MCP_MAX_JSON_CONTAINERS - envelope - 1 }, () => "{}").join(",")}]`));
    const over = await post(base, "/mcp", rpc(`[${Array.from({ length: MCP_MAX_JSON_CONTAINERS - envelope }, () => "{}").join(",")}]`));
    expect(atLimit.status).toBe(200);
    expect(over.status).toBe(400);
    expect(handlerRuns).toBe(1);
  });

  it("does not count brackets and quotes that sit inside strings", async () => {
    const base = await start();
    const brackets = JSON.stringify("[".repeat(400_000) + '\\"' + "{".repeat(400_000));
    const response = await post(base, "/mcp", rpc(brackets));
    expect(response.status).toBe(200);
    expect(handlerRuns).toBe(1);
  });

  it("still passes a large but legitimate request of about 900 KB", async () => {
    const base = await start();
    const ids = Array.from({ length: 46_000 }, (_, index) => `"${String(100000000000000 + index)}"`).join(",");
    const filters = Array.from({ length: 400 }, (_, index) => `{"field":"name","operator":"CONTAIN","value":"campaign ${index}"}`).join(",");
    const body = rpc(`{"ids":[${ids}],"filtering":[${filters}],"targeting":{"geo_locations":{"countries":["US","DE"],"regions":[{"key":"1"}]}}}`);
    expect(body.length).toBeGreaterThan(800_000);
    expect(body.length).toBeLessThan(1_000_000);

    const response = await post(base, "/mcp", body);

    expect(response.status).toBe(200);
    expect(handlerRuns).toBe(1);
  });

  it("caps the byte size at 1 MB for the authenticated route", async () => {
    const base = await start();
    const padded = (bytes: number) => rpc(JSON.stringify("x".repeat(bytes)));
    expect((await post(base, "/mcp", padded(1_000_000))).status).toBe(200);
    expect((await post(base, "/mcp", padded(1_100_000))).status).toBe(413);
    expect((await post(base, "/mcp", padded(11_000_000))).status).toBe(413);
  });

  it("rejects a non-UTF-8 charset instead of scanning bytes it cannot read", async () => {
    const base = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const payload = Buffer.from(rpc("1"), "utf16le");
      const req = http.request(
        `${base}/mcp`,
        { method: "POST", headers: { "content-type": "application/json; charset=utf-16le", "content-length": payload.length } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
    expect(status).toBe(415);
    expect(handlerRuns).toBe(0);
  });

  it("gives the unauthenticated routes the same structural limit", async () => {
    const base = await start();
    const response = await post(base, "/register", nestedArrays(45_000));
    expect(response.status).toBe(400);
    expect((await post(base, "/register", '{"redirect_uris":["https://claude.ai/cb"]}')).status).toBe(200);
  });

  it("does not echo any of the body in an error", async () => {
    const base = await start();
    const marker = "synthetic-body-marker-7c1f";
    const response = await post(base, "/mcp", rpc(`{"${marker}":${nestedArrays(100)}}`));
    expect(response.status).toBe(400);
    expect(response.body).not.toContain(marker);
  });
});
