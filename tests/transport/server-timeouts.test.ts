import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import { applyServerTimeouts, SERVER_TIMEOUTS } from "../../src/transport/server-timeouts.js";
import { startAuthServer, type AuthServer } from "./auth-flow-harness.js";

let server: http.Server | undefined;
let authServer: AuthServer | undefined;
let sockets: net.Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
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

async function listen(overrides?: Parameters<typeof applyServerTimeouts>[1]): Promise<number> {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  server.listen(0, "127.0.0.1");
  applyServerTimeouts(server, overrides);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  return (server.address() as net.AddressInfo).port;
}

function raw(port: number, bytes: string): { firstLine: Promise<string | null>; closed: Promise<number> } {
  const started = Date.now();
  const socket = net.connect(port, "127.0.0.1", () => socket.write(bytes));
  sockets.push(socket);
  socket.on("error", () => {});
  let received = "";
  const firstLine = new Promise<string | null>((resolve) => {
    socket.on("data", (chunk) => {
      received += chunk.toString();
      if (received.includes("\r\n")) resolve(received.split("\r\n")[0]);
    });
    setTimeout(() => resolve(null), 3_000).unref();
  });
  const closed = new Promise<number>((resolve) => socket.on("close", () => resolve(Date.now() - started)));
  return { firstLine, closed };
}

describe("explicit HTTP server timeouts (G1R-01, G3R-01)", () => {
  it("defaults to 30 s for a whole request, 15 s for the headers, a keep-alive longer than a proxy's idle timeout, and no socket timeout", () => {
    expect(SERVER_TIMEOUTS).toEqual({ requestTimeoutMs: 30_000, headersTimeoutMs: 15_000, keepAliveTimeoutMs: 65_000, checkIntervalMs: 5_000 });
    const probe = http.createServer();
    applyServerTimeouts(probe);
    expect(probe.requestTimeout).toBe(30_000);
    expect(probe.headersTimeout).toBe(15_000);
    expect(probe.keepAliveTimeout).toBe(65_000);
    expect(probe.timeout).toBe(0);
    expect((probe as http.Server & { connectionsCheckingInterval: number }).connectionsCheckingInterval).toBe(5_000);
    expect(probe.headersTimeout).toBeLessThanOrEqual(probe.requestTimeout);
  });

  it("answers 408 to a request whose body never completes, at the configured time rather than at Node's coarse check", async () => {
    const port = await listen({ requestTimeoutMs: 600, headersTimeoutMs: 300, checkIntervalMs: 100 });
    const call = raw(port, "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Length: 5000\r\n\r\n{\"jsonrpc\"");
    expect(await call.firstLine).toBe("HTTP/1.1 408 Request Timeout");
    expect(await call.closed).toBeLessThan(2_500);
  });

  it("closes a connection whose headers never complete", async () => {
    const port = await listen({ requestTimeoutMs: 600, headersTimeoutMs: 300, checkIntervalMs: 100 });
    const call = raw(port, "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Len");
    expect(await call.closed).toBeLessThan(2_500);
  });

  it("does not cut a request that completes in time, nor an idle keep-alive connection", async () => {
    const port = await listen({ requestTimeoutMs: 600, headersTimeoutMs: 300, checkIntervalMs: 100 });
    const agent = new http.Agent({ keepAlive: true });
    const get = () =>
      new Promise<string>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method: "POST", agent, headers: { "content-length": 2 } }, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve(body));
        });
        req.on("error", reject);
        req.end("{}");
      });
    expect(await get()).toBe("ok");
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(await get()).toBe("ok");
    agent.destroy();
  });

  it("is applied to the real transport", async () => {
    authServer = await startAuthServer({});
    expect(authServer.server.requestTimeout).toBe(30_000);
    expect(authServer.server.headersTimeout).toBe(15_000);
    expect(authServer.server.keepAliveTimeout).toBe(65_000);
    expect(authServer.server.timeout).toBe(0);
  });
});
