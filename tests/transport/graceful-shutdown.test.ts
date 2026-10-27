import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import http, { type Server } from "node:http";
import { installGracefulShutdown } from "../../src/transport/graceful-shutdown.js";

let server: Server | undefined;
afterEach(async () => {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
});

function fakeProcess() {
  const emitter = new EventEmitter();
  return {
    emitter,
    source: { on: emitter.on.bind(emitter), off: emitter.off.bind(emitter) } as unknown as Pick<NodeJS.Process, "on" | "off">,
  };
}

async function listen(handler: http.RequestListener): Promise<number> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

describe("installGracefulShutdown", () => {
  it("lets an in-flight request finish, refuses new connections, then exits 0", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const port = await listen(async (_req, res) => {
      await gate;
      res.end("done");
    });
    const { emitter, source } = fakeProcess();
    const exited = new Promise<number>((resolve) => {
      installGracefulShutdown(server!, { signalSource: source, exit: resolve, graceMs: 5_000 });
    });

    const inflight = fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 50));
    emitter.emit("SIGTERM", "SIGTERM");
    await new Promise((r) => setTimeout(r, 50));

    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    release();
    expect(await inflight).toBe("done");
    expect(await exited).toBe(0);
  });

  it("gives up after the grace period when a request never finishes and exits 1", async () => {
    const port = await listen(() => {
      /* never responds */
    });
    const { emitter, source } = fakeProcess();
    const exited = new Promise<number>((resolve) => {
      installGracefulShutdown(server!, { signalSource: source, exit: resolve, graceMs: 100 });
    });

    const hung = fetch(`http://127.0.0.1:${port}/`).catch(() => "aborted");
    await new Promise((r) => setTimeout(r, 50));
    emitter.emit("SIGTERM", "SIGTERM");

    expect(await exited).toBe(1);
    expect(await hung).toBe("aborted");
  });

  it("exits immediately on a second signal", async () => {
    await listen((_req, res) => res.end());
    const { emitter, source } = fakeProcess();
    const exit = vi.fn();
    installGracefulShutdown(server!, { signalSource: source, exit, graceMs: 60_000 });

    emitter.emit("SIGINT", "SIGINT");
    emitter.emit("SIGINT", "SIGINT");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("returns a function that removes its listeners", async () => {
    await listen((_req, res) => res.end());
    const { emitter, source } = fakeProcess();
    const uninstall = installGracefulShutdown(server!, { signalSource: source, exit: vi.fn() });
    expect(emitter.listenerCount("SIGTERM")).toBe(1);
    uninstall();
    expect(emitter.listenerCount("SIGTERM")).toBe(0);
  });
});
