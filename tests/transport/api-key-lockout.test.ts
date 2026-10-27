import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuthServer, type AuthServer } from "./auth-flow-harness.js";

const KEY = "synthetic-mcp-api-key-".concat("a1b2".repeat(8));
const META_TOKEN = "synthetic-meta-token-".concat("x9".repeat(8));
const PING = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
const API_ENV = { META_APP_ID: "", META_APP_SECRET: "", MCP_API_KEY: KEY, META_ACCESS_TOKEN: "", AUTH_ALLOWED_FB_USER_IDS: "" };

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function status(origin: string, headers: Record<string, string>): Promise<number> {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: PING,
  });
  await response.arrayBuffer();
  return response.status;
}

const wrongKey = (index: number) => ({ "x-api-key": `wrong-key-${index}` });
const validHeader = { "x-api-key": KEY, "x-meta-token": META_TOKEN };
const validBearer = { authorization: `Bearer ${KEY}`, "x-meta-token": META_TOKEN };

describe("API-key lockout never blocks the valid key (G1R-02)", () => {
  it("locks out wrong keys after 20 failures from one address", async () => {
    server = await startAuthServer(API_ENV);
    const seen: number[] = [];
    for (let index = 0; index < 25; index += 1) seen.push(await status(server.origin, wrongKey(index)));
    expect(seen.filter((code) => code === 401)).toHaveLength(20);
    expect(seen.filter((code) => code === 429)).toHaveLength(5);
  });

  it("still serves the valid key, in either header, from an address that is locked out", async () => {
    server = await startAuthServer(API_ENV);
    for (let index = 0; index < 25; index += 1) await status(server.origin, wrongKey(index));
    expect(await status(server.origin, wrongKey(99))).toBe(429);

    expect(await status(server.origin, validHeader)).toBe(200);
    expect(await status(server.origin, validBearer)).toBe(200);
  });

  it("keeps refusing wrong keys from that address, and does not count the valid requests as failures", async () => {
    server = await startAuthServer(API_ENV);
    for (let index = 0; index < 25; index += 1) await status(server.origin, wrongKey(index));
    for (let index = 0; index < 30; index += 1) expect(await status(server.origin, validHeader)).toBe(200);
    expect(await status(server.origin, wrongKey(100))).toBe(429);
    expect(await status(server.origin, { authorization: "Bearer not-the-key" })).toBe(429);
  });

  it("does not let valid-key traffic use up the allowance of a client that later mistypes", async () => {
    server = await startAuthServer(API_ENV);
    for (let index = 0; index < 100; index += 1) expect(await status(server.origin, validHeader)).toBe(200);
    const seen: number[] = [];
    for (let index = 0; index < 20; index += 1) seen.push(await status(server.origin, wrongKey(index)));
    expect(seen.every((code) => code === 401)).toBe(true);
  });
});
