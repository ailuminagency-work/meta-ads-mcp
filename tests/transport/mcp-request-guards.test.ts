import { afterEach, describe, expect, it, vi } from "vitest";
import { saveToken } from "../../src/store/meta-token-repo.js";
import {
  approveConsent,
  authorizeParams,
  CLAUDE_REDIRECT,
  codeFrom,
  OPERATOR_ID,
  pkce,
  postToken,
  registerClient,
  sessionCookieFor,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function bearerFor(env: Record<string, string | undefined> = {}) {
  server = await startAuthServer(env);
  const client = await registerClient(server.origin);
  await saveToken({
    fbUserId: OPERATOR_ID,
    name: "personal",
    accessToken: "synthetic-access-token-value",
    kind: "user",
    expiresAt: null,
    metaUserId: OPERATOR_ID,
    metaUserName: "Synthetic",
    setAsDefault: true,
  });
  const jar = await sessionCookieFor(OPERATOR_ID);
  const { verifier, challenge } = pkce();
  const approved = await approveConsent(
    server.origin,
    jar,
    authorizeParams({ clientId: client.client_id, challenge }),
    "personal",
  );
  const exchanged = await postToken(server.origin, {
    grant_type: "authorization_code",
    client_id: client.client_id,
    code: codeFrom(approved),
    code_verifier: verifier,
    redirect_uri: CLAUDE_REDIRECT,
  });
  expect(exchanged.status).toBe(200);
  const { access_token } = (await exchanged.json()) as { access_token: string };
  return { origin: server.origin, bearer: access_token };
}

function mcp(origin: string, bearer: string | null, init: { headers?: Record<string, string>; body?: string; method?: string } = {}) {
  return fetch(`${origin}/mcp`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...init.headers,
    },
    body: init.method && init.method !== "POST" ? undefined : (init.body ?? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })),
  });
}

describe("Origin validation on /mcp", () => {
  it("accepts a request that carries no Origin header", async () => {
    const { origin, bearer } = await bearerFor();
    expect((await mcp(origin, bearer)).status).toBe(200);
  });

  it("accepts the origins allowlisted for browsers by default (https://claude.ai and https://claude.com)", async () => {
    const { origin, bearer } = await bearerFor();
    expect((await mcp(origin, bearer, { headers: { origin: "https://claude.ai" } })).status).toBe(200);
    expect((await mcp(origin, bearer, { headers: { origin: "https://claude.com" } })).status).toBe(200);
  });

  it.each([
    ["an unknown site", "https://attacker.example"],
    ["a rebound host", "http://rebound.attacker.example:8080"],
    ["a lookalike of an allowed origin", "https://claude.ai.attacker.example"],
    ["an allowed host on another scheme", "http://claude.ai"],
    ["an allowed host on another port", "https://claude.ai:8443"],
    ["a lookalike of the claude.com origin", "https://claude.com.attacker.example"],
    ["claude.com on another scheme", "http://claude.com"],
    ["claude.com on another port", "https://claude.com:8443"],
    ["a subdomain of claude.com", "https://attacker.claude.com"],
    ["the opaque origin", "null"],
  ])("rejects %s even with a valid bearer token", async (_label, hostile) => {
    const { origin, bearer } = await bearerFor();
    const response = await mcp(origin, bearer, { headers: { origin: hostile } });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { jsonrpc: string; error: { code: number }; id: null };
    expect(body).toMatchObject({ jsonrpc: "2.0", id: null });
    expect(body.error.code).toBeLessThan(0);
  });

  it("rejects a hostile origin before authentication, for every /mcp method", async () => {
    const { origin } = await bearerFor();
    for (const method of ["POST", "GET", "DELETE"]) {
      const response = await mcp(origin, null, { method, headers: { origin: "https://attacker.example" } });
      expect(response.status, method).toBe(403);
    }
  });

  it("follows CORS_ALLOWED_ORIGINS", async () => {
    const { origin, bearer } = await bearerFor({ CORS_ALLOWED_ORIGINS: "https://claude.ai, https://chatgpt.com/" });
    expect((await mcp(origin, bearer, { headers: { origin: "https://chatgpt.com" } })).status).toBe(200);
    expect((await mcp(origin, bearer, { headers: { origin: "https://claude.ai" } })).status).toBe(200);
    expect((await mcp(origin, bearer, { headers: { origin: "https://attacker.example" } })).status).toBe(403);
  });

  it("does not interfere with the CORS preflight or the discovery documents", async () => {
    const { origin } = await bearerFor();
    const preflight = await fetch(`${origin}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "https://claude.ai", "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://claude.ai");

    const comPreflight = await fetch(`${origin}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "https://claude.com", "access-control-request-method": "POST" },
    });
    expect(comPreflight.status).toBe(204);
    expect(comPreflight.headers.get("access-control-allow-origin")).toBe("https://claude.com");

    const hostile = await fetch(`${origin}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "https://claude.com.attacker.example", "access-control-request-method": "POST" },
    });
    expect(hostile.headers.get("access-control-allow-origin")).toBeNull();

    const metadata = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`, {
      headers: { origin: "https://attacker.example" },
    });
    expect(metadata.status).toBe(200);
  });
});

describe("malformed JSON on /mcp", () => {
  it("answers with a JSON-RPC parse error and no internals", async () => {
    const { origin, bearer } = await bearerFor();
    const response = await mcp(origin, bearer, { body: "{not json" });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    expect(text).not.toMatch(/SyntaxError|JSON\.parse|body-parser|node_modules|\bat \w+/);
  });

  it("still asks for credentials before looking at the body", async () => {
    const { origin } = await bearerFor();
    expect((await mcp(origin, null, { body: "{not json" })).status).toBe(401);
  });

  it("still processes well-formed requests", async () => {
    const { origin, bearer } = await bearerFor();
    expect((await mcp(origin, bearer)).status).toBe(200);
  });
});
