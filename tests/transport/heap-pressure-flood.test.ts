import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// A flood of calls whose handlers ignore the abort signal, against the real createServer(), the real
// admission middleware and the real MCP transport, in a child process with a 128 MiB heap (about 1/4
// of the image's 512 MiB, so the reduced scale needs a lower percentage than production: the young
// generation is a fixed ~48 MiB, so 128 MiB crashes at about 75% of the reported limit, 512 MiB at 91%).

const root = path.resolve(__dirname, "../..");
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const fixture = path.join(root, "tests", "transport", "fixtures", "heap-flood-server.ts");

interface Child {
  process: ChildProcess;
  port: number;
  exited: () => { code: number | null; signal: NodeJS.Signals | null } | null;
  output: () => string;
}

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

async function startChild(env: Record<string, string>): Promise<Child> {
  const child = spawn(tsx, [fixture], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_OPTIONS: "--max-old-space-size=128",
      MCP_RATE_LIMIT_PER_MINUTE: "100000",
      MCP_MAX_IN_FLIGHT: "1000",
      MCP_MAX_IN_FLIGHT_PER_SUBJECT: "1000",
      FIXTURE_HOLD_MS: "6000",
      ...env,
    },
  });
  children.push(child);
  let output = "";
  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  child.on("exit", (code, signal) => (exit = { code, signal }));
  const deadline = Date.now() + 30_000;
  while (!/LISTENING (\d+)/.test(output)) {
    if (exit || Date.now() > deadline) throw new Error(`fixture did not start: ${output.slice(-400)}`);
    await sleep(50);
  }
  return { process: child, port: Number(/LISTENING (\d+)/.exec(output)![1]), exited: () => exit, output: () => output };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const IGNORE_CALL = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fixture_ignore_signal", arguments: {} } });
const NOOP_CALL = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fixture_noop", arguments: {} } });

/** One call from a caller that goes away once the server has taken it (or refused it). */
function dropCall(port: number, subject: string, statuses: Record<string, number>): void {
  const socket = net.connect(port, "127.0.0.1");
  let received = "";
  let seen = false;
  socket.on("error", () => {
    statuses.error = (statuses.error ?? 0) + 1;
  });
  socket.on("data", (chunk) => {
    received += chunk;
    const match = /^HTTP\/1\.1 (\d{3})/.exec(received);
    if (!match || seen) return;
    seen = true;
    statuses[match[1]] = (statuses[match[1]] ?? 0) + 1;
    setTimeout(() => socket.destroy(), match[1] === "200" ? 400 : 0);
  });
  socket.write(
    `POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: ${Buffer.byteLength(IGNORE_CALL)}\r\nx-test-subject: s${subject}\r\n\r\n${IGNORE_CALL}`,
  );
  setTimeout(() => socket.destroy(), 8_000);
}

async function stats(port: number): Promise<{ rejectedHeapPressure: number; heapPressureEngaged: boolean; running: number; heapUsedMb: number } | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/stats`, { signal: AbortSignal.timeout(2_000) });
    return (await response.json()) as never;
  } catch {
    return null;
  }
}

async function probe(port: number): Promise<{ status: number; retryAfter: string | null }> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-test-subject": "probe" },
    body: NOOP_CALL,
    signal: AbortSignal.timeout(3_000),
  });
  await response.text();
  return { status: response.status, retryAfter: response.headers.get("retry-after") };
}

/** Six calls a second from 40 different credentials, until `stop` says so or the deadline passes. */
async function flood(port: number, stop: () => boolean, maxMs: number): Promise<Record<string, number>> {
  const statuses: Record<string, number> = {};
  const started = Date.now();
  let index = 0;
  while (!stop() && Date.now() - started < maxMs) {
    dropCall(port, String(index++ % 40), statuses);
    await sleep(1000 / 6);
  }
  return statuses;
}

describe("a flood of handlers that ignore the abort signal (heap pressure guard)", () => {
  it("control: without the guard the same flood ends the process with the out-of-memory abort", async () => {
    const child = await startChild({ MCP_HEAP_PRESSURE_PERCENT: "off" });
    await flood(child.port, () => child.exited() !== null, 20_000);
    await sleep(500);

    const exit = child.exited();
    expect(exit).not.toBeNull();
    expect(exit?.code === 134 || exit?.signal === "SIGABRT").toBe(true);
    expect(child.output()).toMatch(/heap out of memory/);
  }, 60_000);

  it("with the guard the process stays alive, refuses with 503 and Retry-After, and serves again once the handlers have ended", async () => {
    const child = await startChild({ MCP_HEAP_PRESSURE_PERCENT: "50" });
    let engagedAt = 0;
    const statuses = await flood(
      child.port,
      () => {
        if (child.exited()) return true;
        if (engagedAt === 0) void stats(child.port).then((value) => value?.heapPressureEngaged && (engagedAt = Date.now()));
        return engagedAt !== 0 && Date.now() - engagedAt > 2_500;
      },
      20_000,
    );

    expect(child.exited()).toBeNull();
    expect(engagedAt).toBeGreaterThan(0);
    expect(statuses["503"]).toBeGreaterThan(0);
    const during = await stats(child.port);
    expect(during?.rejectedHeapPressure).toBeGreaterThan(0);
    const refused = await probe(child.port);
    expect(refused.status).toBe(503);
    expect(refused.retryAfter).toBe("5");

    const deadline = Date.now() + 40_000;
    let served = 0;
    while (Date.now() < deadline && served !== 200) {
      expect(child.exited()).toBeNull();
      await sleep(500);
      served = (await probe(child.port)).status;
    }
    expect(served).toBe(200);
    expect(child.exited()).toBeNull();
  }, 120_000);
});
