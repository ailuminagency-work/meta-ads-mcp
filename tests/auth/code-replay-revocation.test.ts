import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { createFirestoreDouble, type FirestoreDouble } from "../store/firestore-double.js";

const selected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => selected.db,
  isFirestoreEnabled: () => true,
}));

import { oauthProvider, resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { FirestoreAuthCodesStore, InMemoryAuthCodesStore } from "../../src/store/persistent-auth-codes.js";
import { FirestoreJtiStore, InMemoryJtiStore } from "../../src/store/persistent-jti-store.js";

const OPERATOR = "100000000000001";
const GRACE_MS = 60_000;

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

async function issueCode() {
  const redirect = vi.fn();
  const pair = pkcePair();
  await oauthProvider.authorize(
    client,
    { codeChallenge: pair.challenge, codeChallengeMethod: "S256", redirectUri: client.redirect_uris[0], scopes: [] },
    { redirect } as unknown as Response,
  );
  return { ...pair, code: new URL(redirect.mock.calls[0][1]).searchParams.get("code")! };
}

let double: FirestoreDouble;

describe.each([
  [
    "in-memory stores",
    () => ({ codes: new InMemoryAuthCodesStore(), refresh: new InMemoryJtiStore() }),
  ],
  [
    "Firestore stores",
    () => ({ codes: new FirestoreAuthCodesStore(), refresh: new FirestoreJtiStore("mcp_refresh_jti") }),
  ],
])("replaying an authorization code (%s)", (_name, createStores) => {
  beforeEach(() => {
    vi.stubEnv("OAUTH_SECRET", "x".repeat(64));
    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OPERATOR);
    double = createFirestoreDouble();
    selected.db = double.db;
    resetOAuthProviderForTests();
    const stores = createStores();
    oauthProvider.configure({
      authCodesStore: stores.codes,
      refreshJtiStore: stores.refresh,
      resolvePendingAuth: () => ({ fbUserId: OPERATOR }),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetOAuthProviderForTests();
  });

  it("revokes the refresh tokens issued from the code when it is replayed after the grace window", async () => {
    const { code, verifier } = await issueCode();
    const tokens = await oauthProvider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0]);
    const rotated = await oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!);

    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    await expect(
      oauthProvider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0]),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    await expect(oauthProvider.exchangeRefreshToken(client, rotated.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it("only refuses a replay that arrives inside the grace window, so a client retrying its request keeps its session", async () => {
    const { code, verifier } = await issueCode();
    const tokens = await oauthProvider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0]);

    await expect(
      oauthProvider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0]),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    await expect(oauthProvider.exchangeRefreshToken(client, tokens.refresh_token!)).resolves.toBeDefined();
  });

  it("does not touch other sign-ins of the same operator", async () => {
    const first = await issueCode();
    const second = await issueCode();
    await oauthProvider.exchangeAuthorizationCode(client, first.code, first.verifier, client.redirect_uris[0]);
    const unrelated = await oauthProvider.exchangeAuthorizationCode(
      client,
      second.code,
      second.verifier,
      client.redirect_uris[0],
    );

    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    await expect(
      oauthProvider.exchangeAuthorizationCode(client, first.code, first.verifier, client.redirect_uris[0]),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    await expect(oauthProvider.exchangeRefreshToken(client, unrelated.refresh_token!)).resolves.toBeDefined();
  });

  it("revokes nothing for a code that never produced tokens", async () => {
    const { code } = await issueCode();
    await expect(
      oauthProvider.exchangeAuthorizationCode(client, code, "wrong-verifier", client.redirect_uris[0]),
    ).rejects.toThrow(/PKCE verification failed/);

    vi.setSystemTime(Date.now() + GRACE_MS + 1_000);
    const before = new Set(double.data.keys());
    await expect(
      oauthProvider.exchangeAuthorizationCode(client, code, "wrong-verifier", client.redirect_uris[0]),
    ).rejects.toBeInstanceOf(InvalidGrantError);
    await expect(
      oauthProvider.exchangeAuthorizationCode(client, randomBytes(32).toString("hex"), "x", client.redirect_uris[0]),
    ).rejects.toBeInstanceOf(InvalidGrantError);
    expect(new Set(double.data.keys())).toEqual(before);
    expect([...double.data.keys()].some((path) => path.includes("rtfam:"))).toBe(false);
  });

  it("never stores the authorization code itself next to the refresh tokens", async () => {
    const { code, verifier } = await issueCode();
    await oauthProvider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0]);
    expect([...double.data.keys()].some((path) => path.includes(code))).toBe(false);
  });
});
