import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { createMcpAdmission, type McpAdmission, type McpAdmissionConfig } from "../../src/transport/mcp-admission.js";
import { logger } from "../../src/utils/logger.js";

let server: http.Server | undefined;
let sockets: net.Socket[] = [];
let held: Array<() => void> = [];
let serverSockets: net.Socket[] = [];

afterEach(async () => {
  for (const release of held.splice(0)) release();
  for (const socket of sockets.splice(0)) socket.destroy();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
  serverSockets = [];
  vi.restoreAllMocks();
});

const config = (overrides: Partial<McpAdmissionConfig> = {}): McpAdmissionConfig => ({
  maxInFlight: 16,
  perSubjectInFlight: 4,
  perSubjectPerWindow: 10_000,
  windowMs: 60_000,
  maxTrackedSubjects: 10_000,
  requestTimeoutMs: 3_700_000,
  ...overrides,
});

async function start(admission: McpAdmission): Promise<number> {
  const app = express();
  app.post(
    "/mcp",
    (req, _res, next) => {
      (req as express.Request & { auth?: unknown }).auth = { clientId: "c", extra: { fbUserId: String(req.headers["x-test-user"]) } };
      next();
    },
    admission,
    (req, res) => {
      if (req.headers["x-hold"] === "1") {
        held.push(() => {
          if (!res.writableEnded && !res.destroyed) res.json({ held: true });
        });
        return;
      }
      res.json({ ok: true });
    },
  );
  server = http.createServer(app);
  server.on("connection", (socket) => serverSockets.push(socket));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

const request = (user: string, hold: boolean): string =>
  `POST /mcp HTTP/1.1\r\nHost: x\r\nx-test-user: ${user}\r\n${hold ? "x-hold: 1\r\n" : ""}Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`;

function pipeline(port: number, user: string, holds: boolean[]): net.Socket {
  const socket = net.connect(port, "127.0.0.1", () => socket.write(holds.map((hold) => request(user, hold)).join("")));
  sockets.push(socket);
  socket.on("error", () => {});
  socket.on("data", () => {});
  return socket;
}

async function until(condition: () => boolean, label: string, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function status(port: number, user: string): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "x-test-user": user, "content-type": "application/json" }, body: "{}" });
  await response.arrayBuffer();
  return response.status;
}

describe("admission slots of pipelined requests (G3D-02)", () => {
  it("returns every slot when the socket of a pipeline of held requests dies", async () => {
    const admission = createMcpAdmission(config());
    const port = await start(admission);
    const socket = pipeline(port, "pipe-a", [true, true, true, true]);
    await until(() => admission.stats().inFlight === 4, "four pipelined requests admitted");

    socket.destroy();

    await until(() => admission.stats().inFlight === 0, "slots returned after the socket closed");
    expect(await status(port, "pipe-a")).toBe(200);
  });

  it("does not leave 15 of 16 slots stuck after five credentials pipeline four requests each and disconnect", async () => {
    const admission = createMcpAdmission(config());
    const port = await start(admission);
    const pipes = ["u1", "u2", "u3", "u4", "u5"].map((user) => pipeline(port, user, [true, true, true, true]));
    await until(() => admission.stats().inFlight === 16, "the instance cap reached");
    for (const socket of pipes) socket.destroy();

    await until(() => admission.stats().inFlight === 0, "all sixteen slots returned");
    for (const release of held.splice(0)) release();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(admission.stats().inFlight).toBe(0);
    for (const user of ["u1", "u2", "u3", "u4", "u5"]) expect(await status(port, user)).toBe(200);
  });

  it("returns the slots of the requests queued behind one that already finished when the socket is aborted", async () => {
    const admission = createMcpAdmission(config());
    const port = await start(admission);
    const socket = pipeline(port, "pipe-b", [false, true, true, true]);
    await until(() => admission.stats().admitted === 4 && admission.stats().inFlight === 3, "head finished, three held");

    socket.destroy();

    await until(() => admission.stats().inFlight === 0, "queued slots returned");
  });

  it("counts a pipeline that finishes normally exactly once: the gauge ends at 0 and the per-subject cap is still 4", async () => {
    const admission = createMcpAdmission(config());
    const port = await start(admission);
    const socket = pipeline(port, "pipe-c", [false, false, false, false]);
    await until(() => admission.stats().inFlight === 0 && admission.stats().admitted === 4, "all four answered");
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(admission.stats().inFlight).toBe(0);

    for (let index = 0; index < 5; index += 1) pipeline(port, "pipe-c", [true]);
    await until(() => admission.stats().inFlight === 4, "exactly four admitted for one subject");
    await until(() => admission.stats().rejectedSubjectInFlight === 1, "the fifth refused");
    expect(admission.stats().inFlight).toBe(4);
  });

  it("returns all the slots of a pipeline once its watchdog fires", async () => {
    const admission = createMcpAdmission(config({ requestTimeoutMs: 150 }));
    const port = await start(admission);
    pipeline(port, "pipe-d", [true, true, true, true]);
    await until(() => admission.stats().inFlight === 4, "four admitted");

    await until(() => admission.stats().timedOut >= 1, "the watchdog fired");

    await until(() => admission.stats().inFlight === 0, "all four slots returned");
  });

  it("does not report a stalled reader for a pipelined response that has simply not been assigned a socket yet", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const admission = createMcpAdmission(config({ responseStallMs: 100, stallCheckMs: 20 }));
    const port = await start(admission);
    const socket = pipeline(port, "pipe-e", [true, false]);
    await until(() => admission.stats().admitted === 2, "both admitted");

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(admission.stats().stalled).toBe(0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("mcp_response_stalled");
    for (const release of held.splice(0)) release();
    await until(() => admission.stats().inFlight === 0, "both answered");
    socket.destroy();
  });

  it("does not accumulate listeners on a long-lived keep-alive socket", async () => {
    const admission = createMcpAdmission(config());
    const port = await start(admission);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const call = () =>
      new Promise<void>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method: "POST", agent, headers: { "x-test-user": "keep", "content-length": 2 } }, (res) => {
          res.resume();
          res.on("end", () => resolve());
        });
        req.on("error", reject);
        req.end("{}");
      });
    for (let index = 0; index < 5; index += 1) await call();
    const baseline = serverSockets[0].listenerCount("close");
    for (let index = 0; index < 100; index += 1) await call();

    expect(serverSockets).toHaveLength(1);
    expect(serverSockets[0].listenerCount("close")).toBe(baseline);
    expect(admission.stats().inFlight).toBe(0);
    agent.destroy();
  });
});
