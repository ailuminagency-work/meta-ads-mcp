import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { SignJWT } from "jose";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  AccessDeniedError,
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { oauthProvider, resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { InMemoryAuthCodesStore } from "../../src/store/persistent-auth-codes.js";
import { InMemoryJtiStore } from "../../src/store/persistent-jti-store.js";

const SECRET = "synthetic-oauth-signing-secret-0123456789abcdef";
const VERIFIER = "v".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const OPERATOR = "100000000000001";

const client: OAuthClientInformationFull = {
  client_id: "identity-client",
  client_name: "Identity test",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  client_id_issued_at: Math.floor(Date.now() / 1000),
};

const params = {
  codeChallenge: CHALLENGE,
  codeChallengeMethod: "S256",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  scopes: [],
};

function response(): Response & { redirect: ReturnType<typeof vi.fn> } {
  return { redirect: vi.fn() } as unknown as Response & { redirect: ReturnType<typeof vi.fn> };
}

function signedAccessToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: client.client_id, type: "access", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("mcp-oauth-access")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

beforeEach(() => {
  vi.stubEnv("OAUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OPERATOR);
  vi.stubEnv("AUTH_DENIED_FB_USER_IDS", "");
  resetOAuthProviderForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetOAuthProviderForTests();
});

describe("authorize() requires an authenticated operator", () => {
  it("throws access_denied and stores no code when nobody is logged in", async () => {
    const store = new InMemoryAuthCodesStore();
    const set = vi.spyOn(store, "set");
    oauthProvider.configure({ authCodesStore: store, resolvePendingAuth: () => null });
    const res = response();

    await expect(oauthProvider.authorize(client, params, res)).rejects.toBeInstanceOf(AccessDeniedError);

    expect(set).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("treats an empty identity like no identity", async () => {
    oauthProvider.configure({ resolvePendingAuth: () => ({ fbUserId: "" }) });
    await expect(oauthProvider.authorize(client, params, response())).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("issues a code for a logged-in operator, bound to that operator", async () => {
    oauthProvider.configure({ resolvePendingAuth: () => ({ fbUserId: OPERATOR }) });
    const res = response();
    await oauthProvider.authorize(client, params, res);

    const code = new URL(res.redirect.mock.calls[0][1] as string).searchParams.get("code")!;
    const tokens = await oauthProvider.exchangeAuthorizationCode(client, code, VERIFIER, params.redirectUri);
    const info = await oauthProvider.verifyAccessToken(tokens.access_token);
    expect((info.extra as { fbUserId?: string }).fbUserId).toBe(OPERATOR);
  });
});

describe("tokens and codes without an operator identity are not honoured", () => {
  it("rejects a validly signed access token that has no fb_user_id", async () => {
    await expect(oauthProvider.verifyAccessToken(await signedAccessToken({}))).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects an access token whose fb_user_id is not a string", async () => {
    await expect(
      oauthProvider.verifyAccessToken(await signedAccessToken({ fb_user_id: 100000000000001 })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(oauthProvider.verifyAccessToken(await signedAccessToken({ fb_user_id: "" }))).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("accepts a signed access token that names an operator", async () => {
    const info = await oauthProvider.verifyAccessToken(await signedAccessToken({ fb_user_id: OPERATOR }));
    expect((info.extra as { fbUserId?: string }).fbUserId).toBe(OPERATOR);
  });

  it("refuses to redeem a stored code that has no operator (issued before this check existed)", async () => {
    const store = new InMemoryAuthCodesStore();
    await store.set("c".repeat(64), {
      clientId: client.client_id,
      codeChallenge: CHALLENGE,
      redirectUri: params.redirectUri,
      redirectUriRequired: true,
      resource: undefined,
      fbUserId: undefined,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    oauthProvider.configure({ authCodesStore: store });

    await expect(
      oauthProvider.exchangeAuthorizationCode(client, "c".repeat(64), VERIFIER, params.redirectUri),
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it("refuses a refresh token that has no operator even though its jti is on record", async () => {
    const jti = "j".repeat(32);
    const jtis = new InMemoryJtiStore();
    await jtis.put(jti, { expiresAt: Math.floor(Date.now() / 1000) + 3600, meta: { clientId: client.client_id } });
    oauthProvider.configure({ refreshJtiStore: jtis });
    const refresh = await new SignJWT({ sub: client.client_id, type: "refresh", jti })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("mcp-oauth-refresh")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    await expect(oauthProvider.exchangeRefreshToken(client, refresh)).rejects.toBeInstanceOf(InvalidGrantError);
  });
});
