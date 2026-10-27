import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), longLived: vi.fn(), profile: vi.fn(), validate: vi.fn() }));

vi.mock("../../src/auth/meta-oauth.js", async (original) => ({
  ...(await original<typeof import("../../src/auth/meta-oauth.js")>()),
  exchangeCodeForToken: mocks.exchange,
  exchangeForLongLivedToken: mocks.longLived,
  fetchProfile: mocks.profile,
  fetchPrimaryBusiness: vi.fn(async () => null),
  validateToken: mocks.validate,
}));

import { listTokens } from "../../src/store/meta-token-repo.js";
import {
  authorizeParams,
  browserLogin,
  formHeaders,
  OPERATOR_ID,
  OTHER_OPERATOR_ID,
  pkce,
  registerClient,
  startAuthServer,
  type AuthServer,
  type CookieJar,
} from "./auth-flow-harness.js";

let server: AuthServer | undefined;

beforeEach(() => {
  mocks.exchange.mockResolvedValue({ accessToken: "synthetic-short", expiresIn: 3600 });
  mocks.profile.mockResolvedValue({ id: OPERATOR_ID, name: "Synthetic Operator", email: "op@corp.example", pictureUrl: null });
  mocks.longLived.mockResolvedValue({
    accessToken: "synthetic-long-lived-token",
    expiresAt: Math.floor(Date.now() / 1000) + 5_000_000,
  });
  mocks.validate.mockResolvedValue({ valid: true, profile: { id: "999", name: "Synthetic System User" } });
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function loggedIn(): Promise<{ origin: string; jar: CookieJar }> {
  server = await startAuthServer({ AUTH_ALLOWED_FB_USER_IDS: `${OPERATOR_ID},${OTHER_OPERATOR_ID}` });
  const { jar } = await browserLogin(server.origin, "/auth/connections");
  const page = await fetch(`${server.origin}/auth/connections`, { headers: { cookie: jar.header() }, redirect: "manual" });
  expect(page.status).toBe(200);
  return { origin: server.origin, jar };
}

function registerSystemToken(origin: string, jar: CookieJar, name: string) {
  return fetch(`${origin}/auth/register-system-token`, {
    method: "POST",
    headers: formHeaders(jar),
    redirect: "manual",
    body: new URLSearchParams({
      name,
      access_token: "synthetic-system-user-token-0123456789",
      return: "/auth/connections",
    }),
  });
}

describe("a live session does not outlast the deny list or the allowlist", () => {
  for (const [label, revoke] of [
    ["AUTH_DENIED_FB_USER_IDS", () => vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID)],
    ["removal from AUTH_ALLOWED_FB_USER_IDS", () => vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OTHER_OPERATOR_ID)],
  ] as const) {
    it(`stops serving the account pages once the operator is out through ${label}`, async () => {
      const { origin, jar } = await loggedIn();
      revoke();

      const page = await fetch(`${origin}/auth/connections`, { headers: { cookie: jar.header() }, redirect: "manual" });
      expect(page.status).toBe(302);
      expect(page.headers.get("location")).toMatch(/^\/auth\/meta\?return=/);

      const registered = await registerSystemToken(origin, jar, "persist_after_deny");
      expect(registered.status).toBe(401);
      expect((await listTokens(OPERATOR_ID)).map((token) => token.name)).not.toContain("persist_after_deny");

      const select = await fetch(`${origin}/auth/select-token`, {
        method: "POST",
        headers: formHeaders(jar),
        redirect: "manual",
        body: new URLSearchParams({ name: "personal", return: "/auth/connections" }),
      });
      expect(select.status).toBe(401);

      const del = await fetch(`${origin}/auth/delete-token`, {
        method: "POST",
        headers: formHeaders(jar),
        redirect: "manual",
        body: new URLSearchParams({ name: "personal", return: "/auth/connections" }),
      });
      expect(del.status).toBe(401);
      expect((await listTokens(OPERATOR_ID)).map((token) => token.name)).toContain("personal");
    });
  }

  it("still tells a denied operator why /authorize refuses and ends the session there", async () => {
    const { origin, jar } = await loggedIn();
    const client = await registerClient(origin);
    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);

    const response = await fetch(
      `${origin}/authorize?${authorizeParams({ clientId: client.client_id, challenge: pkce().challenge })}`,
      { headers: { cookie: jar.header() }, redirect: "manual" },
    );
    expect(response.status).toBe(403);
  });

  it("leaves another operator's session alone", async () => {
    const { origin } = await loggedIn();
    mocks.profile.mockResolvedValue({ id: OTHER_OPERATOR_ID, name: "Other Operator", email: null, pictureUrl: null });
    const { jar: other } = await browserLogin(origin, "/auth/connections");
    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);

    const page = await fetch(`${origin}/auth/connections`, { headers: { cookie: other.header() }, redirect: "manual" });
    expect(page.status).toBe(200);
  });
});
