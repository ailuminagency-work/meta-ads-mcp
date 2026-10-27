import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuthServer, type AuthServer } from "./auth-flow-harness.js";

const API_KEY = randomBytes(24).toString("hex");
let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mcp(origin: string, headers: Record<string, string>) {
  return fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
}

async function apiKeyServer(): Promise<string> {
  server = await startAuthServer({
    META_APP_ID: "",
    META_APP_SECRET: "",
    MCP_API_KEY: API_KEY,
    META_ACCESS_TOKEN: "synthetic-global-meta-token",
    AUTH_ALLOWED_FB_USER_IDS: "",
  });
  return server.origin;
}

describe("the /mcp API key", () => {
  it("is refused at startup when it is shorter than 32 characters", async () => {
    await expect(startAuthServer({ META_APP_ID: "", META_APP_SECRET: "", MCP_API_KEY: "tiny" })).rejects.toThrow(
      /MCP_API_KEY must be at least 32 characters/,
    );
  });

  it("locks out a client address after repeated wrong keys, even for the right key, and leaves other addresses alone", async () => {
    const origin = await apiKeyServer();
    const attacker = { "x-forwarded-for": "203.0.113.7" };

    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const response = await mcp(origin, { ...attacker, "x-api-key": `guess-${i}` });
      statuses.push(response.status);
      await response.arrayBuffer();
    }
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(20).every((status) => status === 429)).toBe(true);

    const locked = await mcp(origin, { ...attacker, "x-api-key": API_KEY });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBeTruthy();

    const elsewhere = await mcp(origin, { "x-forwarded-for": "203.0.113.8", "x-api-key": API_KEY });
    expect(elsewhere.status).toBe(200);
  });

  it("counts a bearer that is neither the key nor a valid OAuth token, but not a request with no credential", async () => {
    const origin = await apiKeyServer();
    const client = { "x-forwarded-for": "203.0.113.9" };

    for (let i = 0; i < 40; i++) expect((await mcp(origin, client)).status).toBe(401);
    expect((await mcp(origin, { ...client, "x-api-key": API_KEY })).status).toBe(200);

    for (let i = 0; i < 20; i++) {
      const response = await mcp(origin, { ...client, authorization: `Bearer not-a-token-${i}` });
      expect(response.status).toBe(401);
      await response.arrayBuffer();
    }
    expect((await mcp(origin, { ...client, "x-api-key": API_KEY })).status).toBe(429);
  });

  it("does not lock out a client that sends the right key every time", async () => {
    const origin = await apiKeyServer();
    for (let i = 0; i < 60; i++) {
      const response = await mcp(origin, { "x-api-key": API_KEY });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
  });
});
