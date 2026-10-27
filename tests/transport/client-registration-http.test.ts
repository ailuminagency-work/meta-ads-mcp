import express from "express";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirestoreDouble } from "../store/firestore-double.js";

const selected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => selected.db,
  isFirestoreEnabled: () => true,
}));

import { oauthProvider, resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import {
  FirestoreClientsStore,
  InMemoryClientsStore,
} from "../../src/store/persistent-clients-store.js";

interface Harness {
  origin: string;
  close: () => Promise<void>;
}

async function startRouter(): Promise<Harness> {
  const app = express();
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL("http://localhost:3000"),
      resourceServerUrl: new URL("http://localhost:3000/mcp"),
    }),
  );
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

function register(origin: string, redirectUris: string[]): Promise<Response> {
  return fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Synthetic client",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
}

const stores = [
  ["FirestoreClientsStore", () => new FirestoreClientsStore()],
  ["InMemoryClientsStore", () => new InMemoryClientsStore()],
] as const;

describe.each(stores)("POST /register with %s", (_name, create) => {
  let harness: Harness;

  beforeEach(async () => {
    vi.stubEnv("OAUTH_SECRET", "x".repeat(64));
    selected.db = createFirestoreDouble().db;
    resetOAuthProviderForTests();
    oauthProvider.configure({ clientsStore: create() });
    harness = await startRouter();
  });

  afterEach(async () => {
    await harness.close();
    vi.unstubAllEnvs();
    resetOAuthProviderForTests();
  });

  it("refuses to register an attacker redirect and reports invalid_redirect_uri", async () => {
    const response = await register(harness.origin, ["https://evil.example/cb"]);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; error_description: string };
    expect(body.error).toBe("invalid_redirect_uri");
    expect(body.error_description).not.toContain("evil.example");
  });

  it.each([
    ["javascript: URI", "javascript:alert(1)"],
    ["plain http on a remote host", "http://evil.example/cb"],
    ["fragment", "https://claude.ai/cb#x"],
    ["wildcard host", "https://*.claude.ai/cb"],
    ["userinfo", "https://claude.ai@evil.example/cb"],
    ["lookalike of claude.com", "https://claude.com.evil.example/x"],
    ["plain http on claude.com", "http://claude.com/x"],
    ["unlisted custom scheme", "myapp://callback"],
  ])("refuses a %s redirect", async (_label, uri) => {
    const response = await register(harness.origin, [uri]);
    expect(response.status).toBe(400);
    expect(response.status).not.toBe(201);
    expect(["invalid_redirect_uri", "invalid_client_metadata"]).toContain(
      ((await response.json()) as { error: string }).error,
    );
  });

  it("refuses a registration that mixes a legitimate and a hostile redirect", async () => {
    const response = await register(harness.origin, [
      "https://claude.ai/api/mcp/auth_callback",
      "https://evil.example/cb",
    ]);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_redirect_uri");
  });

  const LEGITIMATE: Array<[string, string[], string]> = [
    ["Claude", ["https://claude.ai/api/mcp/auth_callback"], "https://claude.ai/api/mcp/auth_callback"],
    ["Claude on claude.com", ["https://claude.com/api/mcp/auth_callback"], "https://claude.com/api/mcp/auth_callback"],
    [
      "ChatGPT",
      ["https://chatgpt.com/connector_platform_oauth_redirect"],
      "https://chatgpt.com/connector_platform_oauth_redirect",
    ],
    [
      "Claude Code loopback",
      ["http://localhost:54321/callback"],
      "http://localhost:54321/callback",
    ],
    [
      "Cursor",
      ["cursor://anysphere.cursor-retrieval/oauth/user-lumin/callback"],
      "cursor://anysphere.cursor-retrieval/oauth/user-lumin/callback",
    ],
    [
      "VS Code",
      ["http://127.0.0.1:33418/", "vscode://vscode.github-authentication/did-authenticate"],
      "http://127.0.0.1:33418/",
    ],
  ];

  it.each(LEGITIMATE)(
    "still completes registration, authorization and token exchange for %s",
    async (_client, redirectUris, chosenRedirect) => {
      const registration = await register(harness.origin, redirectUris);
      expect(registration.status).toBe(201);
      const registered = (await registration.json()) as OAuthClientInformationFull;
      expect(registered.redirect_uris).toEqual(redirectUris);

      oauthProvider.configure({ resolvePendingAuth: () => ({ fbUserId: "100000000000001" }) });
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const authorize = await fetch(
        `${harness.origin}/authorize?${new URLSearchParams({
          client_id: registered.client_id,
          response_type: "code",
          redirect_uri: chosenRedirect,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "synthetic-state",
        })}`,
        { redirect: "manual" },
      );
      expect(authorize.status).toBe(302);
      const location = new URL(authorize.headers.get("location")!);
      expect(`${location.protocol}//${location.host}${location.pathname}`).toBe(
        (() => {
          const expected = new URL(chosenRedirect);
          return `${expected.protocol}//${expected.host}${expected.pathname}`;
        })(),
      );
      expect(location.searchParams.get("state")).toBe("synthetic-state");
      const code = location.searchParams.get("code")!;
      expect(code).toBeTruthy();

      const token = await fetch(`${harness.origin}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: registered.client_id,
          code,
          code_verifier: verifier,
          redirect_uri: chosenRedirect,
        }),
      });
      expect(token.status).toBe(200);
      expect(await token.json()).toMatchObject({ token_type: "Bearer" });
    },
  );

  it("accepts a ChatGPT-style registration only for hosts the operator allowlisted", async () => {
    const hosted = ["https://tools.agency.example/oauth/callback"];
    expect((await register(harness.origin, hosted)).status).toBe(400);
    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "tools.agency.example");
    expect((await register(harness.origin, hosted)).status).toBe(201);
  });
});
