import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../../src/transport/http.js";
import { startAuthServer, type AuthServer } from "./auth-flow-harness.js";

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function withLimitedApp<T>(limit: number, run: (origin: string) => Promise<T>): Promise<T> {
  const app = express();
  app.set("trust proxy", 1);
  app.use(createRateLimiter(limit, 60_000));
  app.get("/", (_req, res) => {
    res.json({ ok: true });
  });
  const listener: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  try {
    return await run(`http://127.0.0.1:${(listener.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
}

async function statuses(origin: string, path: string, forwardedFor: (index: number) => string, count: number) {
  const seen: number[] = [];
  for (let index = 0; index < count; index++) {
    const response = await fetch(origin + path, { headers: { "x-forwarded-for": forwardedFor(index) } });
    seen.push(response.status);
  }
  return seen;
}

describe("rate limiter keys", () => {
  it("shares one bucket across every address in an IPv6 /64", async () => {
    await withLimitedApp(3, async (origin) => {
      const seen = await statuses(origin, "/", (i) => `2001:db8:abcd:12::${i + 1}`, 6);
      expect(seen).toEqual([200, 200, 200, 429, 429, 429]);
    });
  });

  it("does not let a /64 spread across spellings escape its bucket", async () => {
    await withLimitedApp(2, async (origin) => {
      const spellings = [
        "2001:db8:abcd:12::1",
        "2001:DB8:ABCD:0012:0:0:0:2",
        "2001:db8:abcd:12:ffff:ffff:ffff:ffff",
      ];
      expect(await statuses(origin, "/", (i) => spellings[i], 3)).toEqual([200, 200, 429]);
    });
  });

  it("keeps different networks in separate buckets", async () => {
    await withLimitedApp(2, async (origin) => {
      const seen = await statuses(origin, "/", (i) => `2001:db8:abcd:${i + 1}::1`, 6);
      expect(seen).toEqual([200, 200, 200, 200, 200, 200]);
    });
  });

  it("still limits an IPv4 client by address", async () => {
    await withLimitedApp(2, async (origin) => {
      expect(await statuses(origin, "/", () => "203.0.113.9", 3)).toEqual([200, 200, 429]);
      expect(await statuses(origin, "/", () => "203.0.113.10", 1)).toEqual([200]);
    });
  });
});

describe("anonymous login routes are rate limited", () => {
  it.each([
    ["GET /authorize", "/authorize", 120],
    ["GET /auth/meta", "/auth/meta", 60],
    ["GET /auth/meta/callback", "/auth/meta/callback", 60],
  ])("%s answers 429 once a client uses up its allowance", async (_label, path, limit) => {
    server = await startAuthServer();
    const seen = await statuses(server.origin, path, () => "203.0.113.50", limit + 2);
    expect(seen.slice(0, limit).every((status) => status !== 429)).toBe(true);
    expect(seen.slice(limit)).toEqual([429, 429]);

    const otherClient = await statuses(server.origin, path, () => "203.0.113.51", 1);
    expect(otherClient[0]).not.toBe(429);
  });

  it("meters an IPv6 client that rotates through its /64 as one client", async () => {
    server = await startAuthServer();
    const seen = await statuses(server.origin, "/auth/meta", (i) => `2001:db8:77:5::${i + 1}`, 62);
    expect(seen.slice(0, 60).every((status) => status !== 429)).toBe(true);
    expect(seen.slice(60)).toEqual([429, 429]);
  });
});
