import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  exchange: vi.fn(),
  longLived: vi.fn(),
  profile: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => {
  const logger = {
    info: mocks.log,
    warn: mocks.log,
    error: mocks.log,
    debug: mocks.log,
    fatal: mocks.log,
    trace: mocks.log,
    child: () => logger,
  };
  return { logger };
});
vi.mock("../../src/auth/meta-oauth.js", async (original) => ({
  ...(await original<typeof import("../../src/auth/meta-oauth.js")>()),
  exchangeCodeForToken: mocks.exchange,
  exchangeForLongLivedToken: mocks.longLived,
  fetchProfile: mocks.profile,
  fetchPrimaryBusiness: vi.fn(async () => null),
}));

import { hashPii } from "../../src/auth/token-store.js";
import { deleteToken, getDecryptedToken, listTokens, saveToken } from "../../src/store/meta-token-repo.js";
import {
  approveConsent,
  authorizeParams,
  codeFrom,
  OPERATOR_ID,
  pkce,
  postToken,
  registerClient,
  startAuthServer,
  CLAUDE_REDIRECT,
  type AuthServer,
} from "./auth-flow-harness.js";

const OPERATOR_EMAIL = "operator.synthetic@agency.example";
let server: AuthServer | undefined;

function messagesAbout(fbUserId: string): string[] {
  return mocks.log.mock.calls
    .filter(([fields]) => fields && typeof fields === "object" && fields.subject === hashPii(fbUserId))
    .map(([, message]) => String(message));
}

function capturedLogs(): string {
  return JSON.stringify(mocks.log.mock.calls, (_key, value) =>
    value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : value,
  );
}

beforeEach(() => {
  mocks.log.mockReset();
  mocks.exchange.mockResolvedValue({ accessToken: "synthetic-short-lived-token", expiresIn: 3600 });
  mocks.longLived.mockResolvedValue({
    accessToken: "synthetic-long-lived-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
  });
  mocks.profile.mockResolvedValue({ id: OPERATOR_ID, name: "Synthetic Operator", email: OPERATOR_EMAIL, pictureUrl: null });
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("auth log output never carries raw account identifiers", () => {
  it("covers login, consent, code exchange, refresh and token resolution", async () => {
    const { browserLogin } = await import("./auth-flow-harness.js");
    server = await startAuthServer();
    const client = await registerClient(server.origin);
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: client.client_id, challenge });
    const consentPath = `/authorize?${params}`;

    const { jar, callback } = await browserLogin(server.origin, consentPath);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(consentPath);

    const consent = await fetch(server.origin + consentPath, { headers: { cookie: jar.header() } });
    expect(consent.status).toBe(200);

    const approved = await approveConsent(server.origin, jar, params, "personal");
    expect(approved.status).toBe(302);
    const exchanged = await postToken(server.origin, {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: codeFrom(approved),
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(exchanged.status).toBe(200);
    const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string };

    const refreshed = await postToken(server.origin, {
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };

    mocks.longLived.mockResolvedValueOnce({
      accessToken: "synthetic-renewed-token",
      expiresAt: Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
    });
    const mcp = await fetch(`${server.origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${next.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(mcp.status).not.toBe(401);

    await deleteToken(OPERATOR_ID, "personal");
    const orphaned = await fetch(`${server.origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${next.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    });
    expect(orphaned.status).toBe(401);

    expect(capturedLogs()).not.toContain(OPERATOR_ID);
    expect(messagesAbout(OPERATOR_ID)).toEqual(
      expect.arrayContaining([
        "Authorization code issued",
        "Tokens issued",
        "Refreshed long-lived Meta token",
        "Failed to resolve user Meta token",
      ]),
    );
  });

  it("covers a failed token refresh and a missing token", async () => {
    const { browserLogin } = await import("./auth-flow-harness.js");
    server = await startAuthServer();
    const client = await registerClient(server.origin);
    const params = authorizeParams({ clientId: client.client_id, challenge: pkce().challenge });
    const { jar } = await browserLogin(server.origin, `/authorize?${params}`);
    expect((await listTokens(OPERATOR_ID)).map((t) => t.name)).toEqual(["personal"]);

    const serverUrl = new URL("http://localhost:3000");
    mocks.longLived.mockRejectedValueOnce(new Error("provider unavailable"));
    await getDecryptedToken(OPERATOR_ID, "personal", serverUrl);
    await getDecryptedToken(OPERATOR_ID, "personal");
    await expect(getDecryptedToken(OPERATOR_ID, "missing")).rejects.toThrow(/not found/);
    await expect(getDecryptedToken("100000000000777")).rejects.toThrow(/No Meta token registered/);

    await saveToken({
      fbUserId: OPERATOR_ID,
      name: "stale",
      accessToken: "synthetic-expired-token",
      kind: "user",
      expiresAt: Math.floor(Date.now() / 1000) - 60,
      metaUserId: OPERATOR_ID,
      metaUserName: "Synthetic",
    });
    mocks.longLived.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(getDecryptedToken(OPERATOR_ID, "stale", serverUrl)).rejects.toThrow(/expired and refresh failed/);

    const sessionOnly = await fetch(`${server.origin}/auth/connections`, { headers: { cookie: jar.header() } });
    expect(sessionOnly.status).toBe(200);

    expect(capturedLogs()).not.toContain(OPERATOR_ID);
    expect(capturedLogs()).not.toContain("100000000000777");
    expect(messagesAbout(OPERATOR_ID)).toEqual(
      expect.arrayContaining([
        "Long-lived token refresh failed; using existing token",
        "Cannot refresh long-lived token: META_APP_ID/SECRET not configured",
        "Long-lived token refresh failed and token is expired",
      ]),
    );
  });

  it("covers a rejected login and a refused refresh", async () => {
    const { browserLogin } = await import("./auth-flow-harness.js");
    server = await startAuthServer();
    const client = await registerClient(server.origin);
    const params = authorizeParams({ clientId: client.client_id, challenge: pkce().challenge });

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);
    const { callback } = await browserLogin(server.origin, `/authorize?${params}`);
    expect(callback.status).toBe(403);

    expect(capturedLogs()).not.toContain(OPERATOR_ID);
    expect(capturedLogs()).not.toContain(OPERATOR_EMAIL);
  });
});
