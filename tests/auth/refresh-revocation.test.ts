import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  AccessDeniedError,
  InvalidGrantError,
  InvalidTokenError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { createFirestoreDouble } from "../store/firestore-double.js";

const selected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => selected.db,
  isFirestoreEnabled: () => true,
}));

import { oauthProvider, resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { isAllowed, isDenied } from "../../src/auth/email-allowlist.js";
import {
  configureMetaTokenRepo,
  InMemoryMetaTokenRepo,
  resetMetaTokenRepoForTests,
  type MetaTokenRepo,
} from "../../src/store/meta-token-repo.js";
import { FirestoreJtiStore, InMemoryJtiStore } from "../../src/store/persistent-jti-store.js";

const OPERATOR = "100000000000001";
const OTHER_OPERATOR = "100000000000002";

const client: OAuthClientInformationFull = {
  client_id: "synthetic-client",
  client_name: "Synthetic",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  client_id_issued_at: 1,
};

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function login(fbUserId: string | null) {
  oauthProvider.configure({ resolvePendingAuth: () => (fbUserId ? { fbUserId } : null) });
  const redirect = vi.fn();
  const { verifier, challenge } = pkcePair();
  await oauthProvider.authorize(
    client,
    { codeChallenge: challenge, codeChallengeMethod: "S256", redirectUri: client.redirect_uris[0], scopes: [] },
    { redirect } as unknown as Response,
  );
  const code = new URL(redirect.mock.calls[0][1]).searchParams.get("code")!;
  return oauthProvider.exchangeAuthorizationCode(client, code, verifier);
}

const ALLOW_ENV = [
  "AUTH_ALLOWED_FB_USER_IDS",
  "AUTH_ALLOWED_EMAILS",
  "AUTH_ALLOWED_DOMAINS",
  "AUTH_DENIED_FB_USER_IDS",
];

beforeEach(() => {
  vi.stubEnv("OAUTH_SECRET", "x".repeat(64));
  vi.stubEnv("NODE_ENV", "production");
  for (const key of ALLOW_ENV) vi.stubEnv(key, "");
  vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", `${OPERATOR},${OTHER_OPERATOR}`);
  resetOAuthProviderForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetOAuthProviderForTests();
  resetMetaTokenRepoForTests();
});

describe("AUTH_DENIED_FB_USER_IDS", () => {
  it("overrides the allowlist for the listed account only", () => {
    expect(isAllowed({ fbUserId: OPERATOR })).toBe(true);
    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", ` ${OPERATOR} ,999`);
    expect(isDenied(OPERATOR)).toBe(true);
    expect(isAllowed({ fbUserId: OPERATOR })).toBe(false);
    expect(isAllowed({ fbUserId: OTHER_OPERATOR })).toBe(true);
    expect(isDenied(undefined)).toBe(false);
  });

  it("denies a domain-allowlisted account even though its email matches", () => {
    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", "");
    vi.stubEnv("AUTH_ALLOWED_DOMAINS", "agency.example");
    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR);
    expect(isAllowed({ fbUserId: OPERATOR, email: "op@agency.example" })).toBe(false);
    expect(isAllowed({ fbUserId: OTHER_OPERATOR, email: "other@agency.example" })).toBe(true);
  });

  it("stops authorization before a code is issued", async () => {
    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR);
    oauthProvider.configure({ resolvePendingAuth: () => ({ fbUserId: OPERATOR }) });
    const redirect = vi.fn();
    await expect(
      oauthProvider.authorize(
        client,
        { codeChallenge: "c", codeChallengeMethod: "S256", redirectUri: client.redirect_uris[0], scopes: [] },
        { redirect } as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("stops the code exchange for a code issued before the account was denied", async () => {
    oauthProvider.configure({ resolvePendingAuth: () => ({ fbUserId: OPERATOR }) });
    const redirect = vi.fn();
    const { verifier, challenge } = pkcePair();
    await oauthProvider.authorize(
      client,
      { codeChallenge: challenge, codeChallengeMethod: "S256", redirectUri: client.redirect_uris[0], scopes: [] },
      { redirect } as unknown as Response,
    );
    const code = new URL(redirect.mock.calls[0][1]).searchParams.get("code")!;

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR);
    await expect(oauthProvider.exchangeAuthorizationCode(client, code, verifier)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it("revokes an access token that was already issued", async () => {
    const tokens = await login(OPERATOR);
    await expect(oauthProvider.verifyAccessToken(tokens.access_token)).resolves.toBeDefined();

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR);
    await expect(oauthProvider.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(InvalidTokenError);

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OTHER_OPERATOR);
    await expect(oauthProvider.verifyAccessToken(tokens.access_token)).resolves.toBeDefined();
  });

  it("refuses to refresh and burns the refresh token, even if the account is later restored", async () => {
    const tokens = await login(OPERATOR);
    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR);
    await expect(oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toThrow(/revoked/i);

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", "");
    await expect(oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toThrow(/revoked/i);
  });
});

describe("refresh re-evaluates the login allowlist", () => {
  it("fails closed with invalid_grant once the account leaves AUTH_ALLOWED_FB_USER_IDS", async () => {
    const tokens = await login(OPERATOR);
    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OTHER_OPERATOR);

    const failure = await oauthProvider
      .exchangeRefreshToken(client, tokens.refresh_token!)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InvalidGrantError);
    expect((failure as InvalidGrantError).errorCode).toBe("invalid_grant");

    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", `${OPERATOR},${OTHER_OPERATOR}`);
    await expect(oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it("keeps refreshing while the account stays allowlisted", async () => {
    const tokens = await login(OPERATOR);
    const refreshed = await oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!);
    expect(refreshed.refresh_token).toBeTruthy();
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
  });

  describe("email and domain allowlists use the email stored at login", () => {
    let repo: MetaTokenRepo;

    beforeEach(async () => {
      vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", "");
      vi.stubEnv("AUTH_ALLOWED_DOMAINS", "agency.example");
      repo = new InMemoryMetaTokenRepo();
      configureMetaTokenRepo(repo);
      await repo.upsertUser(OPERATOR, {
        id: OPERATOR,
        name: "Operator",
        email: "op@agency.example",
        pictureUrl: null,
      });
    });

    it("refreshes while the stored email is still on an allowed domain", async () => {
      const tokens = await login(OPERATOR);
      await expect(oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!)).resolves.toBeDefined();
    });

    it("refuses once the domain is removed from AUTH_ALLOWED_DOMAINS", async () => {
      const tokens = await login(OPERATOR);
      vi.stubEnv("AUTH_ALLOWED_DOMAINS", "someone-else.example");
      await expect(oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toBeInstanceOf(
        InvalidGrantError,
      );
    });

    it("refuses when no email is on record for the account", async () => {
      vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OTHER_OPERATOR);
      const tokens = await login(OTHER_OPERATOR);
      vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", "");
      await expect(oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toBeInstanceOf(
        InvalidGrantError,
      );
    });

    it("does not burn the refresh token when the lookup itself fails, so the client can retry", async () => {
      const tokens = await login(OPERATOR);
      const lookup = vi.spyOn(repo, "getUser").mockRejectedValueOnce(new Error("storage unavailable"));

      const failure = await oauthProvider
        .exchangeRefreshToken(client, tokens.refresh_token!)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ServerError);
      expect(lookup).toHaveBeenCalledTimes(1);

      await expect(oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!)).resolves.toBeDefined();
    });
  });
});

describe.each([
  ["in-memory jti store", () => new InMemoryJtiStore()],
  ["Firestore jti store", () => new FirestoreJtiStore("mcp_refresh_jti")],
])("rotated refresh token reuse (%s)", (_name, createStore) => {
  const GRACE_MS = 60_000;

  beforeEach(() => {
    selected.db = createFirestoreDouble().db;
    oauthProvider.configure({ refreshJtiStore: createStore() });
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("revokes the whole chain when a rotated token is replayed after the grace window", async () => {
    const first = await login(OPERATOR);
    const second = await oauthProvider.exchangeRefreshToken(client, first.refresh_token!);
    const third = await oauthProvider.exchangeRefreshToken(client, second.refresh_token!);

    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    await expect(oauthProvider.exchangeRefreshToken(client, first.refresh_token!)).rejects.toThrow(
      /revoked|already used/i,
    );

    await expect(oauthProvider.exchangeRefreshToken(client, third.refresh_token!)).rejects.toThrow(
      /revoked|already used/i,
    );
  });

  it("leaves other sign-ins of the same operator alone", async () => {
    const compromised = await login(OPERATOR);
    const unrelated = await login(OPERATOR);
    await oauthProvider.exchangeRefreshToken(client, compromised.refresh_token!);

    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    await expect(oauthProvider.exchangeRefreshToken(client, compromised.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    await expect(oauthProvider.exchangeRefreshToken(client, unrelated.refresh_token!)).resolves.toBeDefined();
  });

  it("only refuses an immediate replay, so a client that retries its own refresh keeps its session", async () => {
    const first = await login(OPERATOR);
    const second = await oauthProvider.exchangeRefreshToken(client, first.refresh_token!);

    await expect(oauthProvider.exchangeRefreshToken(client, first.refresh_token!)).rejects.toThrow(
      /revoked|already used/i,
    );

    await expect(oauthProvider.exchangeRefreshToken(client, second.refresh_token!)).resolves.toBeDefined();
  });

  it("keeps the winner's session when two refreshes race", async () => {
    const first = await login(OPERATOR);
    const settled = await Promise.allSettled([
      oauthProvider.exchangeRefreshToken(client, first.refresh_token!),
      oauthProvider.exchangeRefreshToken(client, first.refresh_token!),
    ]);
    const winner = settled.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      refresh_token?: string;
    }>;
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);

    await expect(oauthProvider.exchangeRefreshToken(client, winner.value.refresh_token!)).resolves.toBeDefined();
  });

  it("treats an explicitly revoked token that is presented later as reuse of that chain", async () => {
    const first = await login(OPERATOR);
    await oauthProvider.revokeToken(client, { token: first.refresh_token! });
    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    await expect(oauthProvider.exchangeRefreshToken(client, first.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it("revokes the chain of a token issued before chains were tracked", async () => {
    const store = createStore();
    oauthProvider.configure({ refreshJtiStore: store });
    const legacyJti = randomBytes(16).toString("hex");
    const now = Math.floor(Date.now() / 1000);
    await store.put(legacyJti, { expiresAt: now + 3600, meta: { clientId: client.client_id, fbUserId: null } });
    const legacyToken = await new SignJWT({ sub: client.client_id, type: "refresh", jti: legacyJti })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setAudience("mcp-oauth-refresh")
      .sign(new TextEncoder().encode(process.env.OAUTH_SECRET!));

    const rotated = await oauthProvider.exchangeRefreshToken(client, legacyToken);
    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    await expect(oauthProvider.exchangeRefreshToken(client, legacyToken)).rejects.toBeInstanceOf(InvalidGrantError);
    await expect(oauthProvider.exchangeRefreshToken(client, rotated.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });
});
