import express from "express";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, expect, it, vi } from "vitest";
import { startHttpTransport } from "../../src/transport/http.js";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetOAuthProviderForTests();
});

it("advertises the canonical resource metadata on missing and invalid MCP credentials", async () => {
  for (const [key, value] of Object.entries({
    NODE_ENV: "production",
    DEPLOYMENT_MODE: "legacy",
    SERVER_URL: "https://agency.example.com",
    META_APP_ID: "",
    META_APP_SECRET: "",
    MCP_API_KEY: "",
    LUMIN_PLATFORM_ENABLED: "false",
    LUMIN_META_PRIVACY_ENABLED: "false",
    OAUTH_SECRET: randomBytes(32).toString("hex"),
  })) vi.stubEnv(key, value);
  resetOAuthProviderForTests();

  let server: Server | undefined;
  vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Express) {
    server = createNodeServer(this);
    server.listen(0, "127.0.0.1");
    return server;
  } as typeof express.application.listen);

  await startHttpTransport(() => new McpServer({ name: "discovery-test", version: "1" }), 0);
  if (!server!.listening) await new Promise<void>(resolve => server!.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;

  try {
    const metadataPath = "/.well-known/oauth-protected-resource/mcp";
    const metadata = await fetch(origin + metadataPath, { headers: { "x-forwarded-proto": "https" } });
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: "https://agency.example.com/mcp",
      authorization_servers: ["https://agency.example.com/"],
    });

    for (const method of ["GET", "POST", "DELETE"]) {
      for (const credential of [undefined, "invalid-test-credential"]) {
        const headers: Record<string, string> = { "x-forwarded-proto": "https" };
        if (credential) headers.Authorization = `Bearer ${credential}`;
        const response = await fetch(origin + "/mcp", { method, headers });
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain(
          `resource_metadata="https://agency.example.com${metadataPath}"`,
        );
        expect(await response.json()).toMatchObject({ error: "invalid_token" });
      }
    }

    const registration = await fetch(origin + "/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ redirect_uris: ["https://client.example.com/callback"], token_endpoint_auth_method: "none" }),
    });
    expect(registration.status).toBe(201);
    const client = await registration.json() as OAuthClientInformationFull;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    async function issueCode(resource = "https://agency.example.com/mcp", explicitRedirect = true) {
      const query = new URLSearchParams({
        client_id: client.client_id,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource,
      });
      if (explicitRedirect) query.set("redirect_uri", "https://client.example.com/callback");
      const response = await fetch(origin + "/authorize?" + query, {
        headers: { "x-forwarded-proto": "https" }, redirect: "manual",
      });
      expect(response.status).toBe(302);
      return new URL(response.headers.get("location")!).searchParams.get("code")!;
    }
    async function exchange(code: string, redirectUri?: string) {
      const body = new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier });
      if (redirectUri) body.set("redirect_uri", redirectUri);
      return fetch(origin + "/token", {
        method: "POST",
        headers: { "x-forwarded-proto": "https", "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    }
    expect((await exchange(await issueCode())).status).toBe(400);
    expect((await exchange(await issueCode(), "https://client.example.com/different")).status).toBe(400);
    expect((await exchange(await issueCode("https://agency.example.com/mcp", false))).status).toBe(200);
    const accepted = await exchange(await issueCode(), "https://client.example.com/callback");
    expect(accepted.status).toBe(200);
    const tokens = await accepted.json() as { access_token: string };
    async function getMcp(token: string) {
      return fetch(origin + "/mcp", { headers: { "x-forwarded-proto": "https", Authorization: `Bearer ${token}` } });
    }
    expect((await getMcp(tokens.access_token)).status).toBe(405);
    const wrongResource = await exchange(await issueCode("https://other.example.com/mcp"), "https://client.example.com/callback");
    expect(wrongResource.status).toBe(200);
    const wrongTokens = await wrongResource.json() as { access_token: string };
    expect((await getMcp(wrongTokens.access_token)).status).toBe(401);

    const legacyToken = await new SignJWT({ sub: client.client_id, type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("mcp-oauth-access")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.OAUTH_SECRET!));
    expect((await getMcp(legacyToken)).status).toBe(405);
  } finally {
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  }
});
