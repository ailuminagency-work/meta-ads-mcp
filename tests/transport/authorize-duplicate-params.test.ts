import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), longLived: vi.fn(), profile: vi.fn() }));

vi.mock("../../src/auth/meta-oauth.js", async (original) => ({
  ...(await original<typeof import("../../src/auth/meta-oauth.js")>()),
  exchangeCodeForToken: mocks.exchange,
  exchangeForLongLivedToken: mocks.longLived,
  fetchProfile: mocks.profile,
  fetchPrimaryBusiness: vi.fn(async () => null),
}));

import {
  authorizeParams,
  browserLogin,
  formHeaders,
  OPERATOR_ID,
  pkce,
  registerClient,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";

let server: AuthServer | undefined;

beforeEach(() => {
  mocks.exchange.mockResolvedValue({ accessToken: "synthetic-short-lived-token", expiresIn: 3600 });
  mocks.longLived.mockResolvedValue({
    accessToken: "synthetic-long-lived-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
  });
  mocks.profile.mockResolvedValue({ id: OPERATOR_ID, name: "Synthetic Operator", email: null, pictureUrl: null });
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("a repeated /authorize parameter is a 400, never a 500", () => {
  async function prepare() {
    server = await startAuthServer();
    const client = await registerClient(server.origin);
    const params = authorizeParams({ clientId: client.client_id, challenge: pkce().challenge });
    const { jar } = await browserLogin(server.origin, `/authorize?${params}`);
    return { origin: server.origin, client, params, jar };
  }

  it.each([
    ["redirect_uri", "https://evil.example/x"],
    ["client_id", "another-client"],
    ["state", "second-state"],
    ["code_challenge", "second-challenge"],
    ["resource", "http://localhost:3000/other"],
  ])("answers a logged-in GET with two %s parameters with 400", async (name, second) => {
    const { origin, params, jar } = await prepare();
    const response = await fetch(`${origin}/authorize?${params}&${name}=${encodeURIComponent(second)}`, {
      headers: { cookie: jar.header() },
      redirect: "manual",
    });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("only once");
    expect(body).not.toContain("TypeError");
    expect(body).not.toContain("at ");
  });

  it("answers an anonymous GET with a repeated parameter with 400 and no login redirect", async () => {
    const { origin, params } = await prepare();
    const response = await fetch(`${origin}/authorize?${params}&client_id=again`, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("answers a consent POST with a repeated field with a client error", async () => {
    const { origin, params, jar } = await prepare();
    const body = new URLSearchParams(params);
    body.set("token", "personal");
    body.append("redirect_uri", "https://evil.example/x");
    const response = await fetch(`${origin}/authorize`, {
      method: "POST",
      headers: formHeaders(jar),
      body,
      redirect: "manual",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.headers.get("location") ?? "").not.toContain("code=");
  });

  it("still serves the consent page when nothing is repeated", async () => {
    const { origin, params, jar } = await prepare();
    const response = await fetch(`${origin}/authorize?${params}`, { headers: { cookie: jar.header() } });
    expect(response.status).toBe(200);
  });
});
