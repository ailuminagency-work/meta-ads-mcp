import express from "express";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthProvider, resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const OPERATOR = "100000000000001";

let server: Server;
let origin: string;

beforeEach(async () => {
  vi.stubEnv("OAUTH_SECRET", "x".repeat(64));
  vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OPERATOR);
  resetOAuthProviderForTests();
  oauthProvider.configure({ resolvePendingAuth: () => ({ fbUserId: OPERATOR }) });
  const app = express();
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL("http://localhost:3000"),
      resourceServerUrl: new URL("http://localhost:3000/mcp"),
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
  resetOAuthProviderForTests();
});

async function registerClient(): Promise<string> {
  const response = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function authorize(clientId: string, challenge: string, redirectUri: string | null = REDIRECT) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (redirectUri) params.set("redirect_uri", redirectUri);
  const response = await fetch(`${origin}/authorize?${params}`, { redirect: "manual" });
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location")!).searchParams.get("code")!;
}

async function redeem(body: Record<string, string>) {
  const response = await fetch(`${origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", ...body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

describe("POST /token redirect_uri binding (RFC 6749 section 4.1.3)", () => {
  it("refuses a code exchange that omits the redirect_uri the authorization request carried", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(clientId, challenge);

    const result = await redeem({ client_id: clientId, code, code_verifier: verifier });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_grant");
  });

  it("refuses a code exchange that names a different redirect_uri", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(clientId, challenge);

    const result = await redeem({
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: "https://claude.ai/api/mcp/other_callback",
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_grant");
  });

  it("accepts the exchange when the redirect_uri matches", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(clientId, challenge);

    const result = await redeem({ client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT });
    expect(result.status).toBe(200);
    expect(result.body.access_token).toBeTruthy();
  });

  it("does not demand a redirect_uri the authorization request never carried", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(clientId, challenge, null);

    const result = await redeem({ client_id: clientId, code, code_verifier: verifier });
    expect(result.status).toBe(200);
  });
});

describe("POST /token PKCE and replay", () => {
  it("burns the authorization code when the PKCE check fails", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(clientId, challenge);

    const wrong = await redeem({
      client_id: clientId,
      code,
      code_verifier: randomBytes(32).toString("base64url"),
      redirect_uri: REDIRECT,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("invalid_grant");

    const retry = await redeem({ client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT });
    expect(retry.status).toBe(400);
    expect(retry.body.error).toBe("invalid_grant");
  });

  it("rejects a replayed code after one successful exchange", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(clientId, challenge);
    const body = { client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT };

    expect((await redeem(body)).status).toBe(200);
    const replay = await redeem(body);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
  });

  it("rejects an exchange that sends no code_verifier", async () => {
    const clientId = await registerClient();
    const { challenge } = pkce();
    const code = await authorize(clientId, challenge);

    const result = await redeem({ client_id: clientId, code, redirect_uri: REDIRECT });
    expect(result.status).toBe(400);
  });

  it("refuses the provider-level exchange when the verifier is missing and still burns the code", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await authorize(clientId, challenge);
    const client = (await oauthProvider.clientsStore.getClient(clientId))!;

    await expect(oauthProvider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)).rejects.toThrow(
      /PKCE verification failed/,
    );
    await expect(oauthProvider.exchangeAuthorizationCode(client, code, verifier, REDIRECT)).rejects.toThrow(
      /Invalid authorization code/,
    );
  });
});


describe("POST /token PKCE verifier format (RFC 7636 section 4.1)", () => {
  async function attempt(verifier: string, redirectUri = REDIRECT) {
    const clientId = await registerClient();
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const code = await authorize(clientId, challenge);
    const result = await redeem({ client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri });
    const replay = await redeem({ client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri });
    return { result, replay };
  }

  it.each([
    ["a one character verifier", "a"],
    ["a verifier one character short of 43", "a".repeat(42)],
    ["a verifier one character over 128", "a".repeat(129)],
    ["a verifier with characters outside the unreserved set", "\u00e9".repeat(50)],
    ["a verifier with a space", `${"a".repeat(42)} `],
  ])("refuses %s even when it hashes to the challenge, and burns the code", async (_label, verifier) => {
    const { result, replay } = await attempt(verifier);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_grant");
    expect(replay.status).toBe(400);
  });

  it.each([
    ["the shortest allowed verifier", "a".repeat(43)],
    ["the longest allowed verifier", "Ab0._~-".repeat(18).slice(0, 128)],
  ])("accepts %s", async (_label, verifier) => {
    const { result } = await attempt(verifier);
    expect(result.status).toBe(200);
  });
});
