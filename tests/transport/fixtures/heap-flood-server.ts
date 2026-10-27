// Server for heap-pressure-flood.test.ts, run in a child process with a small heap.
// It is the real thing where it matters: createServer() with the full tool registry, the real
// admission middleware and the real MCP transport. Authentication is replaced by a header, and one
// extra tool ignores the abort signal and pins memory, like the handlers that keep running after
// their caller is gone.
import net from "node:net";
import v8 from "node:v8";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

Object.assign(process.env, { DEPLOYMENT_MODE: "upstream", META_API_VERSION: "v26.0", META_APP_ID: "300", TOKEN_ENCRYPTION_KEY: "e".repeat(64), LOG_LEVEL: "fatal" });
(globalThis as { fetch: unknown }).fetch = async () => {
  throw new Error("no network in this fixture");
};

const pinBytes = Number(process.env.FIXTURE_PIN_BYTES ?? 2 * 1024 * 1024);
const holdMs = Number(process.env.FIXTURE_HOLD_MS ?? 8_000);

const { createServer } = await import("../../../src/server.js");
const { createMcpAdmission, readMcpAdmissionConfig } = await import("../../../src/transport/mcp-admission.js");
const { mcpJsonParser } = await import("../../../src/transport/body-limits.js");
const { requestContext } = await import("../../../src/auth/token-store.js");

const admission = createMcpAdmission(readMcpAdmissionConfig());
const app = express();
let running = 0;

app.get("/stats", (_req, res) => {
  res.json({ ...admission.stats(), running, heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576), heapLimitMb: Math.round(v8.getHeapStatistics().heap_size_limit / 1_048_576) });
});

app.post(
  "/mcp",
  (req, _res, next) => {
    (req as unknown as { auth: unknown }).auth = { clientId: "c", extra: { fbUserId: String(req.header("x-test-subject")) } };
    next();
  },
  admission,
  mcpJsonParser(),
  (req, res) => {
    const who = String(req.header("x-test-subject"));
    requestContext.run({ accessToken: `synthetic-user-token-${who}`, fbUserId: who }, async () => {
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = createServer();
        server.registerTool("fixture_ignore_signal", { description: "ignores the abort signal and pins memory", inputSchema: {} }, async () => {
          running += 1;
          const pinned = "x".repeat(pinBytes) + String(running);
          await new Promise((resolve) => setTimeout(resolve, holdMs));
          running -= 1;
          return { content: [{ type: "text" as const, text: String(pinned.length) }] };
        });
        server.registerTool("fixture_noop", { description: "returns at once", inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
        await server.connect(transport);
        const cleanup = (): void => {
          transport.close().catch(() => undefined);
          server.close().catch(() => undefined);
        };
        if (res.destroyed) {
          cleanup();
          return;
        }
        res.once("close", cleanup);
        await transport.handleRequest(req, res, req.body);
      } catch {
        if (!res.headersSent) res.status(500).json({ error: "fixture" });
      }
    });
  },
);

const httpServer = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => httpServer.once("listening", () => resolve()));
process.stdout.write(`LISTENING ${(httpServer.address() as net.AddressInfo).port}\n`);
