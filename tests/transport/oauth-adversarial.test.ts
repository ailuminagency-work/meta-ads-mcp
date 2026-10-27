import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  longLived: vi.fn(),
  profile: vi.fn(),
  validate: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => {
  const noop = () => undefined;
  const logger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => logger };
  return { logger };
});
vi.mock("../../src/auth/meta-oauth.js", async (original) => ({
  ...(await original<typeof import("../../src/auth/meta-oauth.js")>()),
  exchangeCodeForToken: mocks.exchange,
  exchangeForLongLivedToken: mocks.longLived,
  fetchProfile: mocks.profile,
  fetchPrimaryBusiness: vi.fn(async () => null),
  validateToken: mocks.validate,
}));

import { getDecryptedToken, getDefaultTokenName, listTokens } from "../../src/store/meta-token-repo.js";
import {
  approveConsent,
  authorizeParams,
  browserLogin,
  CLAUDE_REDIRECT,
  codeFrom,
  CookieJar,
  formHeaders,
  OPERATOR_ID,
  OTHER_OPERATOR_ID,
  pkce,
  postToken,
  registerClient,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";

const BOTH_OPERATORS = `${OPERATOR_ID},${OTHER_OPERATOR_ID}`;
const LOOPBACK_REDIRECT = "http://127.0.0.1:38123/callback";
const GRACE_MS = 60_000;

let server: AuthServer | undefined;

beforeEach(() => {
  mocks.exchange.mockResolvedValue({ accessToken: "synthetic-short-lived-token", expiresIn: 3600 });
  mocks.profile.mockResolvedValue({ id: OPERATOR_ID, name: "Synthetic Operator", email: null, pictureUrl: null });
  mocks.longLived.mockImplementation(async () => ({
    accessToken: `synthetic-long-lived-token-${Math.random().toString(36).slice(2)}`,
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
  }));
  mocks.validate.mockResolvedValue({ valid: true, profile: { id: OPERATOR_ID, name: "Synthetic System User" } });
});

afterEach(async () => {
  vi.useRealTimers();
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function start(env: Record<string, string | undefined> = {}) {
  server = await startAuthServer({ AUTH_ALLOWED_FB_USER_IDS: BOTH_OPERATORS, ...env });
  const origin = server.origin;
  const client = await registerClient(origin);
  const { jar } = await browserLogin(origin, "/auth/connections");
  return { origin, client, jar };
}

type Context = Awaited<ReturnType<typeof start>>;

async function grant(context: Context, tokenName = "personal") {
  const { verifier, challenge } = pkce();
  const params = authorizeParams({ clientId: context.client.client_id, challenge });
  const approved = await approveConsent(context.origin, context.jar, params, tokenName);
  const code = codeFrom(approved);
  const response = await postToken(context.origin, {
    grant_type: "authorization_code",
    client_id: context.client.client_id,
    code,
    code_verifier: verifier,
    redirect_uri: CLAUDE_REDIRECT,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { access_token: string; refresh_token: string };
}

function refresh(context: Context, refreshToken: string, clientId = context.client.client_id) {
  return postToken(context.origin, { grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
}

async function mcpStatus(context: Context, accessToken: string): Promise<number> {
  const response = await fetch(`${context.origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  return response.status;
}

describe("consent phishing through an attacker redirect", () => {
  it("cannot register a client that sends codes to an attacker host", async () => {
    server = await startAuthServer();
    const response = await fetch(`${server.origin}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://evil.example/cb"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_redirect_uri");
  });

  it("does not render a consent page for a forged redirect on a legitimate client", async () => {
    const context = await start();
    const params = authorizeParams({
      clientId: context.client.client_id,
      redirectUri: "https://evil.example/cb",
      challenge: pkce().challenge,
    });
    const response = await fetch(`${context.origin}/authorize?${params}`, {
      headers: { cookie: context.jar.header() },
      redirect: "manual",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("Aprobar");
  });

  it("does not redirect a posted consent form to a forged redirect", async () => {
    const context = await start();
    const params = authorizeParams({
      clientId: context.client.client_id,
      redirectUri: "https://evil.example/cb",
      challenge: pkce().challenge,
    });
    const response = await approveConsent(context.origin, context.jar, params, "personal");
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    ["a suffix on the registered URI", `${CLAUDE_REDIRECT}.evil.example`],
    ["a userinfo trick", "https://claude.ai@evil.example/api/mcp/auth_callback"],
    ["a different path on the same host", "https://claude.ai/api/mcp/other"],
    ["a query on the registered URI", `${CLAUDE_REDIRECT}?next=https://evil.example`],
  ])("rejects %s", async (_label, redirectUri) => {
    const context = await start();
    const params = authorizeParams({
      clientId: context.client.client_id,
      redirectUri,
      challenge: pkce().challenge,
    });
    const page = await fetch(`${context.origin}/authorize?${params}`, {
      headers: { cookie: context.jar.header() },
      redirect: "manual",
    });
    expect(page.status).toBe(400);
    const posted = await approveConsent(context.origin, context.jar, params, "personal");
    expect(posted.status).toBe(400);
    expect(posted.headers.get("location")).toBeNull();
  });

  it("stops serving a client that was registered with an attacker host before the policy existed", async () => {
    server = await startAuthServer({ OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS: "evil.example" });
    const attacker = await registerClient(server.origin, ["https://evil.example/cb"]);
    const { jar } = await browserLogin(server.origin, "/auth/connections");

    vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "");
    const params = authorizeParams({
      clientId: attacker.client_id,
      redirectUri: "https://evil.example/cb",
      challenge: pkce().challenge,
    });
    const page = await fetch(`${server.origin}/authorize?${params}`, {
      headers: { cookie: jar.header() },
      redirect: "manual",
    });
    expect(page.status).toBe(400);
    expect(await page.text()).not.toContain("Aprobar");
    const posted = await approveConsent(server.origin, jar, params, "personal");
    expect(posted.status).toBe(400);
    expect(posted.headers.get("location")).toBeNull();
  });

  it("shows the operator who is asking and where the code will go", async () => {
    const context = await start();
    const params = authorizeParams({ clientId: context.client.client_id, challenge: pkce().challenge });
    const page = await fetch(`${context.origin}/authorize?${params}`, { headers: { cookie: context.jar.header() } });
    const html = await page.text();
    expect(html).toContain("Synthetic client");
    expect(html).toContain("https://claude.ai");
  });
});

describe("authorization code replay", () => {
  it("rejects a second redemption of the same code", async () => {
    const context = await start();
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: context.client.client_id, challenge });
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));
    const body = {
      grant_type: "authorization_code",
      client_id: context.client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    };

    expect((await postToken(context.origin, body)).status).toBe(200);
    const replay = await postToken(context.origin, body);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("revokes the refresh token issued from a code when the code is replayed later", async () => {
    const context = await start();
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: context.client.client_id, challenge });
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));
    const body = {
      grant_type: "authorization_code",
      client_id: context.client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    };
    const redeemed = await postToken(context.origin, body);
    expect(redeemed.status).toBe(200);
    const tokens = (await redeemed.json()) as { refresh_token: string };

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    expect((await postToken(context.origin, body)).status).toBe(400);
    expect((await refresh(context, tokens.refresh_token)).status).toBe(400);
  });

  it("does not let someone who only captured the code redeem it", async () => {
    const context = await start();
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: context.client.client_id, challenge });
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));
    const attempt = (codeVerifier: string) =>
      postToken(context.origin, {
        grant_type: "authorization_code",
        client_id: context.client.client_id,
        code,
        code_verifier: codeVerifier,
        redirect_uri: CLAUDE_REDIRECT,
      });

    expect((await attempt(pkce().verifier)).status).toBe(400);
    expect((await attempt(verifier)).status).toBe(400);
  });

  it("rejects a code after its ten minute lifetime", async () => {
    const context = await start();
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: context.client.client_id, challenge });
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const response = await postToken(context.origin, {
      grant_type: "authorization_code",
      client_id: context.client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("binds the tokens to the signed-in operator, whatever the posted form claims", async () => {
    const context = await start();
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: context.client.client_id, challenge });
    params.set("fb_user_id", OTHER_OPERATOR_ID);
    params.set("fbUserId", OTHER_OPERATOR_ID);
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));
    const response = await postToken(context.origin, {
      grant_type: "authorization_code",
      client_id: context.client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(response.status).toBe(200);
    const tokens = (await response.json()) as { access_token: string; refresh_token: string };

    expect(decodeJwt(tokens.access_token).fb_user_id).toBe(OPERATOR_ID);
    expect(decodeJwt(tokens.refresh_token).fb_user_id).toBe(OPERATOR_ID);
  });
});

describe("PKCE downgrade", () => {
  it.each([
    ["the plain method", { method: "plain" }],
    ["no challenge method", { method: "" }],
    ["no challenge", { challenge: "" }],
  ])("never issues a code for %s", async (_label, override) => {
    const context = await start();
    const params = authorizeParams({
      clientId: context.client.client_id,
      challenge: override.challenge ?? pkce().challenge,
      method: override.method,
    });
    const response = await approveConsent(context.origin, context.jar, params, "personal");

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe(new URL(CLAUDE_REDIRECT).origin);
    expect(target.searchParams.get("code")).toBeNull();
    expect(target.searchParams.get("error")).toBe("invalid_request");
  });

  it("rejects a verifier equal to the challenge, as a plain-method client would send, and burns the code", async () => {
    const context = await start();
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: context.client.client_id, challenge });
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));
    const redeem = (codeVerifier: string) =>
      postToken(context.origin, {
        grant_type: "authorization_code",
        client_id: context.client.client_id,
        code,
        code_verifier: codeVerifier,
        redirect_uri: CLAUDE_REDIRECT,
      });

    expect((await redeem(challenge)).status).toBe(400);
    expect((await redeem(verifier)).status).toBe(400);
  });

  it("rejects a redemption that sends no verifier", async () => {
    const context = await start();
    const params = authorizeParams({ clientId: context.client.client_id, challenge: pkce().challenge });
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));
    const response = await postToken(context.origin, {
      grant_type: "authorization_code",
      client_id: context.client.client_id,
      code,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(response.status).toBe(400);
  });
});

describe("refresh after the operator loses access", () => {
  it("refuses the refresh token once the operator leaves the allowlist", async () => {
    const context = await start();
    const tokens = await grant(context);
    expect(await mcpStatus(context, tokens.access_token)).not.toBe(401);

    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OTHER_OPERATOR_ID);
    const response = await refresh(context, tokens.refresh_token);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_grant");

    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", BOTH_OPERATORS);
    expect((await refresh(context, tokens.refresh_token)).status).toBe(400);
  });

  it("cuts off a live access token and the refresh token immediately through the deny list", async () => {
    const context = await start();
    const tokens = await grant(context);
    expect(await mcpStatus(context, tokens.access_token)).not.toBe(401);

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);
    expect(await mcpStatus(context, tokens.access_token)).toBe(401);
    expect((await refresh(context, tokens.refresh_token)).status).toBe(400);
  });

  it("does not let a denied operator sign in again", async () => {
    const context = await start();
    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);
    const { callback } = await browserLogin(context.origin, "/auth/connections", new CookieJar());
    expect(callback.status).toBe(403);
  });
});

describe("refresh token reuse", () => {
  it("refuses an immediate replay without ending the legitimate session", async () => {
    const context = await start();
    const first = await grant(context);
    const secondResponse = await refresh(context, first.refresh_token);
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as { refresh_token: string };

    expect((await refresh(context, first.refresh_token)).status).toBe(400);
    expect((await refresh(context, second.refresh_token)).status).toBe(200);
  });

  it("revokes every token in the chain when the thief replays after the legitimate rotation", async () => {
    const context = await start();
    const first = await grant(context);
    const second = (await (await refresh(context, first.refresh_token)).json()) as { refresh_token: string };

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    const replay = await refresh(context, first.refresh_token);
    expect(replay.status).toBe(400);

    const legitimate = await refresh(context, second.refresh_token);
    expect(legitimate.status).toBe(400);
    expect(((await legitimate.json()) as { error: string }).error).toBe("invalid_grant");
  });
});

describe("second login and token selection", () => {
  it("keeps the operator's chosen system user token as default across another login", async () => {
    const context = await start();
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("personal");

    const register = await fetch(`${context.origin}/auth/register-system-token`, {
      method: "POST",
      headers: formHeaders(context.jar),
      body: new URLSearchParams({ name: "agency_system", access_token: "synthetic-system-token-value" }),
      redirect: "manual",
    });
    expect(register.status).toBe(302);
    const select = await fetch(`${context.origin}/auth/select-token`, {
      method: "POST",
      headers: formHeaders(context.jar),
      body: new URLSearchParams({ name: "agency_system" }),
      redirect: "manual",
    });
    expect(select.status).toBe(302);
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("agency_system");

    await browserLogin(context.origin, "/auth/connections");

    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("agency_system");
    await expect(getDecryptedToken(OPERATOR_ID)).resolves.toBe("synthetic-system-token-value");
    expect((await listTokens(OPERATOR_ID)).map((t) => t.name).sort()).toEqual(["agency_system", "personal"]);

    const tokens = await (async () => {
      const { verifier, challenge } = pkce();
      const params = authorizeParams({ clientId: context.client.client_id, challenge });
      const approved = await approveConsent(context.origin, context.jar, params);
      const exchanged = await postToken(context.origin, {
        grant_type: "authorization_code",
        client_id: context.client.client_id,
        code: codeFrom(approved),
        code_verifier: verifier,
        redirect_uri: CLAUDE_REDIRECT,
      });
      return (await exchanged.json()) as { access_token: string };
    })();
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("agency_system");
    expect(await mcpStatus(context, tokens.access_token)).not.toBe(401);
  });

  it("keeps the first token as default across repeated logins, so the MCP never loses its token", async () => {
    const context = await start();
    await browserLogin(context.origin, "/auth/connections");
    await browserLogin(context.origin, "/auth/connections");

    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("personal");
    const tokens = await grant(context, "");
    expect(await mcpStatus(context, tokens.access_token)).not.toBe(401);
  });

  it("does not let another operator select or delete this operator's tokens", async () => {
    const context = await start();
    const registered = await fetch(`${context.origin}/auth/register-system-token`, {
      method: "POST",
      headers: formHeaders(context.jar),
      body: new URLSearchParams({ name: "operator_only", access_token: "synthetic-operator-system-token" }),
      redirect: "manual",
    });
    expect(registered.status).toBe(302);

    mocks.profile.mockResolvedValue({ id: OTHER_OPERATOR_ID, name: "Other Operator", email: null, pictureUrl: null });
    const { jar: otherJar } = await browserLogin(context.origin, "/auth/connections");

    for (const path of ["/auth/select-token", "/auth/delete-token"]) {
      const response = await fetch(context.origin + path, {
        method: "POST",
        headers: formHeaders(otherJar),
        body: new URLSearchParams({ name: "operator_only", fb_user_id: OPERATOR_ID }),
        redirect: "manual",
      });
      expect(response.status).toBe(404);
    }
    expect((await listTokens(OPERATOR_ID)).map((t) => t.name).sort()).toEqual(["operator_only", "personal"]);
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("personal");
    expect(await getDefaultTokenName(OTHER_OPERATOR_ID)).toBe("personal");
  });
});

describe("cross-client code redemption", () => {
  it("does not let a second client redeem a code issued to the first, even with its own PKCE pair", async () => {
    const context = await start();
    const attacker = await registerClient(context.origin, [LOOPBACK_REDIRECT]);
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: context.client.client_id, challenge });
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));

    const stolen = await postToken(context.origin, {
      grant_type: "authorization_code",
      client_id: attacker.client_id,
      code,
      code_verifier: pkce().verifier,
      redirect_uri: LOOPBACK_REDIRECT,
    });
    expect(stolen.status).toBe(400);
    expect(((await stolen.json()) as { error: string }).error).toBe("invalid_grant");

    const owner = await postToken(context.origin, {
      grant_type: "authorization_code",
      client_id: context.client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(owner.status).toBe(400);
  });

  it("does not let a second client redeem the first client's code even if it learned the verifier", async () => {
    const context = await start();
    const attacker = await registerClient(context.origin, [CLAUDE_REDIRECT]);
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId: context.client.client_id, challenge });
    const code = codeFrom(await approveConsent(context.origin, context.jar, params, "personal"));

    const response = await postToken(context.origin, {
      grant_type: "authorization_code",
      client_id: attacker.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
    });
    expect(response.status).toBe(400);
  });

  it("does not let a second client use the first client's refresh token", async () => {
    const context = await start();
    const attacker = await registerClient(context.origin, [LOOPBACK_REDIRECT]);
    const tokens = await grant(context);

    const response = await refresh(context, tokens.refresh_token, attacker.client_id);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_grant");
  });
});
