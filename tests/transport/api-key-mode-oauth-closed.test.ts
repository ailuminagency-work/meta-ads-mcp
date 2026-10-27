import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeParams,
  CLAUDE_REDIRECT,
  formHeaders,
  pkce,
  postToken,
  rawRequest,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";

const API_KEY = randomBytes(24).toString("hex");
const PING = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
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
    body: PING,
  });
}

describe("a deployment without a Meta login does not hand out OAuth tokens", () => {
  async function apiKeyServer() {
    server = await startAuthServer({
      META_APP_ID: "",
      META_APP_SECRET: "",
      MCP_API_KEY: API_KEY,
      META_ACCESS_TOKEN: "synthetic-global-meta-token",
      AUTH_ALLOWED_FB_USER_IDS: "",
    });
    return server.origin;
  }

  it("lets an anonymous caller neither register, authorize nor redeem a code", async () => {
    const origin = await apiKeyServer();
    expect((await mcp(origin, {})).status).toBe(401);

    const registration = await fetch(`${origin}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Anyone",
        redirect_uris: ["http://127.0.0.1:38123/cb"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(registration.status).toBe(404);
    expect(((await registration.json()) as { client_id?: string }).client_id).toBeUndefined();

    const { verifier, challenge } = pkce();
    const params = authorizeParams({
      clientId: "any-client",
      challenge,
      redirectUri: "http://127.0.0.1:38123/cb",
      state: "s",
    });
    const authorize = await rawRequest(origin, { target: `/authorize?${params}` });
    expect(authorize.status).toBe(404);
    expect(authorize.location ?? "").not.toContain("code=");
    const authorizeSlash = await rawRequest(origin, { target: `/authorize//?${params}` });
    expect(authorizeSlash.status).toBe(404);
    expect(authorizeSlash.location ?? "").not.toContain("code=");
    const post = await rawRequest(origin, {
      method: "POST",
      target: "/authorize",
      headers: formHeaders(),
      body: params.toString(),
    });
    expect(post.status).toBe(404);

    const token = await postToken(origin, {
      grant_type: "authorization_code",
      client_id: "any-client",
      code: "0".repeat(64),
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(token.status).toBe(404);
    expect((await fetch(`${origin}/revoke`, { method: "POST" })).status).toBe(404);
  });

  it("keeps the API key as the way in, and refuses wrong keys and bearer tokens", async () => {
    const origin = await apiKeyServer();

    expect((await mcp(origin, { "x-api-key": API_KEY })).status).toBe(200);
    expect((await mcp(origin, { authorization: `Bearer ${API_KEY}` })).status).toBe(200);
    expect((await mcp(origin, { "x-api-key": "wrong-key-value" })).status).toBe(401);
    expect((await mcp(origin, { authorization: "Bearer not-the-key" })).status).toBe(401);
  });

  it("still serves the OAuth endpoints, with a login in front of them, when the Meta app is configured", async () => {
    server = await startAuthServer();
    const params = authorizeParams({ clientId: "any-client", challenge: pkce().challenge });
    const anonymous = await rawRequest(server.origin, { target: `/authorize?${params}` });
    expect(anonymous.status).not.toBe(404);
    const registration = await fetch(`${server.origin}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT], token_endpoint_auth_method: "none" }),
    });
    expect(registration.status).toBe(201);
  });
});
