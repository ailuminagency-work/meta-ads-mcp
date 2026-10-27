import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lines: [] as string[],
  exchange: vi.fn(),
  longLived: vi.fn(),
  profile: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", async () => {
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace" },
    {
      write: (line: string) => {
        mocks.lines.push(line);
      },
    },
  );
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
import { deleteToken } from "../../src/store/meta-token-repo.js";
import {
  approveConsent,
  authorizeParams,
  browserLogin,
  codeFrom,
  OPERATOR_ID,
  pkce,
  postToken,
  registerClient,
  startAuthServer,
  CLAUDE_REDIRECT,
  type AuthServer,
  type CookieJar,
} from "./auth-flow-harness.js";

const OPERATOR_EMAIL = "operator.synthetic@agency.example";
// Logged by src/store/meta-token-repo.ts, which this suite does not cover.
const TOKEN_STORE_MESSAGES = new Set([
  "Refreshed long-lived Meta token",
  "Long-lived token refresh failed; using existing token",
  "Cannot refresh long-lived token: META_APP_ID/SECRET not configured",
  "Long-lived token refresh failed and token is expired",
]);
let server: AuthServer | undefined;

type LogEntry = { msg?: unknown; fbUserId?: unknown; error?: unknown };

function entries(): LogEntry[] {
  return mocks.lines.map((line) => JSON.parse(line) as LogEntry);
}

function messagesAbout(fbUserId: string): string[] {
  return entries()
    .filter((entry) => entry.fbUserId === hashPii(fbUserId))
    .map((entry) => String(entry.msg));
}

/** Every serialized line from the transport and the OAuth provider, with error messages and stacks. */
function ownedLogs(): string {
  return mocks.lines.filter((line) => !TOKEN_STORE_MESSAGES.has((JSON.parse(line) as LogEntry).msg as string)).join("");
}

async function issueTokens(origin: string): Promise<{
  jar: CookieJar;
  consentPath: string;
  clientId: string;
  tokens: { access_token: string; refresh_token: string };
}> {
  const client = await registerClient(origin);
  const { verifier, challenge } = pkce();
  const params = authorizeParams({ clientId: client.client_id, challenge });
  const consentPath = `/authorize?${params}`;

  const { jar, callback } = await browserLogin(origin, consentPath);
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe(consentPath);

  const consent = await fetch(origin + consentPath, { headers: { cookie: jar.header() } });
  expect(consent.status).toBe(200);

  const approved = await approveConsent(origin, jar, params, "personal");
  expect(approved.status).toBe(302);
  const exchanged = await postToken(origin, {
    grant_type: "authorization_code",
    client_id: client.client_id,
    code: codeFrom(approved),
    code_verifier: verifier,
    redirect_uri: CLAUDE_REDIRECT,
  });
  expect(exchanged.status).toBe(200);
  return {
    jar,
    consentPath,
    clientId: client.client_id,
    tokens: (await exchanged.json()) as { access_token: string; refresh_token: string },
  };
}

function ping(origin: string, accessToken: string, id: number): Promise<Response> {
  return fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }),
  });
}

beforeEach(() => {
  mocks.lines.length = 0;
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
    server = await startAuthServer();
    const { clientId, tokens } = await issueTokens(server.origin);

    const refreshed = await postToken(server.origin, {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };

    expect((await ping(server.origin, next.access_token, 1)).status).not.toBe(401);

    await deleteToken(OPERATOR_ID, "personal");
    expect((await ping(server.origin, next.access_token, 2)).status).toBe(401);

    expect(ownedLogs()).not.toContain(OPERATOR_ID);
    expect(messagesAbout(OPERATOR_ID)).toEqual(
      expect.arrayContaining(["Authorization code issued", "Tokens issued", "Failed to resolve user Meta token"]),
    );
    const unresolved = entries().find((entry) => entry.msg === "Failed to resolve user Meta token");
    expect(String(unresolved?.error)).toContain(hashPii(OPERATOR_ID));
  });

  it("covers a refused refresh and a consent page opened after the account was denied", async () => {
    server = await startAuthServer();
    const { clientId, tokens, jar, consentPath } = await issueTokens(server.origin);

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);
    const refreshed = await postToken(server.origin, {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(400);
    const consent = await fetch(server.origin + consentPath, { headers: { cookie: jar.header() } });
    expect(consent.status).toBe(403);

    expect(ownedLogs()).not.toContain(OPERATOR_ID);
    expect(messagesAbout(OPERATOR_ID)).toEqual(
      expect.arrayContaining([
        "Refresh refused: the account is no longer authorized",
        "Rejected /authorize: account is no longer allowed",
      ]),
    );
  });

  it("covers a rejected login", async () => {
    server = await startAuthServer();
    const client = await registerClient(server.origin);
    const params = authorizeParams({ clientId: client.client_id, challenge: pkce().challenge });

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);
    const { callback } = await browserLogin(server.origin, `/authorize?${params}`);
    expect(callback.status).toBe(403);

    expect(ownedLogs()).not.toContain(OPERATOR_ID);
    expect(ownedLogs()).not.toContain(OPERATOR_EMAIL);
  });
});
