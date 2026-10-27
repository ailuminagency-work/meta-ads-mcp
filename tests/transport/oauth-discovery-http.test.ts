import express from "express";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, expect, it, vi } from "vitest";
import { startHttpTransport } from "../../src/transport/http.js";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetOAuthProviderForTests();
});

it("advertises the canonical resource metadata on missing and invalid MCP credentials, and serves no OAuth endpoints without a Meta login", async () => {
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

    for (const [method, path] of [
      ["POST", "/register"],
      ["GET", "/authorize?client_id=x&response_type=code"],
      ["POST", "/token"],
      ["POST", "/revoke"],
    ] as const) {
      const response = await fetch(origin + path, { method, headers: { "x-forwarded-proto": "https" }, redirect: "manual" });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(await response.json()).toMatchObject({ error: "oauth_unavailable" });
    }

    for (const claims of [{}, { fb_user_id: "100000000000001" }]) {
      const signed = await new SignJWT({ sub: "forged-client", type: "access", ...claims })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience("mcp-oauth-access")
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(process.env.OAUTH_SECRET!));
      const response = await fetch(origin + "/mcp", { headers: { "x-forwarded-proto": "https", Authorization: `Bearer ${signed}` } });
      expect(response.status).toBe(401);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  }
});
