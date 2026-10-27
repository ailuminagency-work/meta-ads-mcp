import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTrustProxyHops } from "../../src/transport/trust-proxy.js";
import { startAuthServer, type AuthServer } from "./auth-flow-harness.js";

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("resolveTrustProxyHops", () => {
  it("defaults to one hop", () => {
    expect(resolveTrustProxyHops({})).toBe(1);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: "" })).toBe(1);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: "  " })).toBe(1);
  });

  it("accepts a whole number of hops from 0 to 10", () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: "0" })).toBe(0);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: " 2 " })).toBe(2);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: "10" })).toBe(10);
  });

  it.each(["abc", "-1", "1.5", "11", "99", "1e1", "0x2", "true", "1,2", "100"])("refuses %j", (value) => {
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: value })).toThrow(/TRUST_PROXY_HOPS must be a whole number/);
  });
});

async function tokenStatuses(origin: string, forwardedFor: (index: number) => string, count: number): Promise<number[]> {
  const seen: number[] = [];
  for (let index = 0; index < count; index++) {
    const response = await fetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": forwardedFor(index) },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: "x", refresh_token: "y" }),
    });
    seen.push(response.status);
    await response.arrayBuffer();
  }
  return seen;
}

describe("TRUST_PROXY_HOPS at startup", () => {
  it("stops the server for a value that is not a hop count", async () => {
    await expect(startAuthServer({ TRUST_PROXY_HOPS: "many" })).rejects.toThrow(/TRUST_PROXY_HOPS must be a whole number/);
  });

  it("keys the rate limits on the entry one hop from the right by default", async () => {
    server = await startAuthServer();
    const seen = await tokenStatuses(server.origin, (i) => `198.51.100.${i + 1}, 203.0.113.7`, 55);
    expect(seen.slice(0, 40).every((status) => status !== 429)).toBe(true);
    expect(seen.slice(50)).toContain(429);
  });

  it("moves the key one entry further left with two hops, so the platform's own proxy is not the client", async () => {
    server = await startAuthServer({ TRUST_PROXY_HOPS: "2" });
    const seen = await tokenStatuses(server.origin, (i) => `198.51.100.${i + 1}, 203.0.113.7`, 55);
    expect(seen.every((status) => status !== 429)).toBe(true);
  });
});
