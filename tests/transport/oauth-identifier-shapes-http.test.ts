import express from "express";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirestoreDouble, type FirestoreDouble } from "../store/firestore-double.js";

const selected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => selected.db,
  isFirestoreEnabled: () => true,
}));

import { oauthProvider, resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { FirestoreAuthCodesStore } from "../../src/store/persistent-auth-codes.js";
import { FirestoreClientsStore } from "../../src/store/persistent-clients-store.js";
import { InMemoryJtiStore } from "../../src/store/persistent-jti-store.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const HOSTILE = ["a/b/c", "a/b", "..", "../mcp_clients/victim", "__x__", "x".repeat(300)];
let server: Server;
let origin: string;
let double: FirestoreDouble;

beforeEach(async () => {
  vi.stubEnv("OAUTH_SECRET", "synthetic-oauth-signing-secret-0123456789abcdef");
  double = createFirestoreDouble();
  selected.db = double.db;
  resetOAuthProviderForTests();
  oauthProvider.configure({
    clientsStore: new FirestoreClientsStore(),
    authCodesStore: new FirestoreAuthCodesStore(),
    refreshJtiStore: new InMemoryJtiStore(),
    resolvePendingAuth: () => ({ fbUserId: "100000000000001" }),
    requireRedirectUri: true,
  });
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

async function register(): Promise<string> {
  const response = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  });
  expect(response.status).toBe(201);
  const client = (await response.json()) as OAuthClientInformationFull;
  expect(client.client_id).toMatch(/^[0-9a-f-]{36}$/);
  return client.client_id;
}

function token(body: Record<string, string>) {
  return fetch(`${origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

function touchedHostileIds(): string[] {
  return double.touched.filter((path) => HOSTILE.some((id) => path.endsWith(`/${id}`) || path.includes(`/${id}/`)));
}

describe("code and client_id values that are not shaped like ours are answered with the OAuth 400s", () => {
  it.each(HOSTILE.map((id) => [id.slice(0, 30), id]))("POST /token with the code %s is invalid_grant", async (_label, code) => {
    const clientId = await register();
    const verifier = randomBytes(32).toString("base64url");
    const response = await token({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_grant");
    expect(touchedHostileIds()).toEqual([]);
  });

  it.each(HOSTILE.map((id) => [id.slice(0, 30), id]))("POST /token with the client_id %s is invalid_client", async (_label, id) => {
    const response = await token({
      grant_type: "authorization_code",
      client_id: id,
      code: randomBytes(32).toString("hex"),
      code_verifier: randomBytes(32).toString("base64url"),
      redirect_uri: REDIRECT,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_client");
    expect(touchedHostileIds()).toEqual([]);
  });

  it.each(HOSTILE.map((id) => [id.slice(0, 30), id]))("POST /revoke with the client_id %s is invalid_client", async (_label, id) => {
    const response = await fetch(`${origin}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, token: "whatever" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_client");
    expect(touchedHostileIds()).toEqual([]);
  });

  it.each(HOSTILE.map((id) => [id.slice(0, 30), id]))("GET /authorize with the client_id %s is a 400, not a 500", async (_label, id) => {
    const challenge = createHash("sha256").update(randomBytes(32)).digest("base64url");
    const response = await fetch(
      `${origin}/authorize?${new URLSearchParams({
        client_id: id,
        response_type: "code",
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(touchedHostileIds()).toEqual([]);
  });

  it("still completes the flow for a registered client with a real code", async () => {
    const clientId = await register();
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = await fetch(
      `${origin}/authorize?${new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
      { redirect: "manual" },
    );
    expect(authorize.status).toBe(302);
    const code = new URL(authorize.headers.get("location")!).searchParams.get("code")!;
    expect(code).toMatch(/^[0-9a-f]{64}$/);

    const response = await token({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    });
    expect(response.status).toBe(200);
  });
});
