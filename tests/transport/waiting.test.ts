import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createWaitingApp } from "../../src/transport/waiting.js";
import { resolveDeploymentMode, validateAgencyEnvironment } from "../../src/transport/deployment-config.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe("credential waiting deployment", () => {
  it("serves liveness and denies every provider and MCP route without credentials", async () => {
    server = createWaitingApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", state: "awaiting_credentials", metaConnected: false });
    for (const route of ["/ready", "/mcp", "/authorize", "/register", "/token", "/auth/meta/callback", "/.well-known/oauth-authorization-server"]) {
      for (const method of ["GET", "POST"]) {
        const response = await fetch(base + route, { method });
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
  });
  it("rejects misspelled modes rather than activating upstream behavior", () => {
    expect(() => resolveDeploymentMode({ DEPLOYMENT_MODE: "waiting" })).toThrow();
  });
  it("rejects an incomplete agency configuration", () => {
    expect(() => validateAgencyEnvironment({ NODE_ENV: "production" })).toThrow();
  });
  const valid: NodeJS.ProcessEnv = {
    NODE_ENV: "production", META_APP_ID: "123", META_APP_SECRET: "test-app-secret",
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
    SESSION_COOKIE_SECRET: "test-session-".repeat(4), OAUTH_SECRET: "test-signing-".repeat(4),
    AUTH_ALLOWED_FB_USER_IDS: "123", FIRESTORE_PROJECT_ID: "test-project",
    GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/google.json", SERVER_URL: "https://agency.example.com",
  };
  it("accepts complete agency configuration", () => {
    expect(() => validateAgencyEnvironment(valid)).not.toThrow();
  });
  it.each(["MCP_API_KEY", "META_ACCESS_TOKEN", "META_TOKENS", "FIRESTORE_EMULATOR_HOST", "APIFY_TOKEN", "GEMINI_API_KEY"])("rejects %s bypass configuration", (key) => {
    expect(() => validateAgencyEnvironment({ ...valid, [key]: "test-value" })).toThrow(/forbidden/);
  });
  it("rejects callback substitution and ambiguous write configuration", () => {
    expect(() => validateAgencyEnvironment({ ...valid, META_OAUTH_REDIRECT_URI: "https://other.example.com/callback" })).toThrow(/callback/);
    expect(() => validateAgencyEnvironment({ ...valid, AGENCY_WRITES_ENABLED: "yes" })).toThrow(/boolean/);
  });
});
