import {isMetaPrincipalPrivacyLocked} from "../platform/meta-privacy-access.js";
import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  AccessDeniedError,
  InvalidGrantError,
  InvalidTokenError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { logger } from "../utils/logger.js";
import { allowlistHasEmailRules, isAllowed, isDenied } from "./email-allowlist.js";
import { getUser } from "../store/meta-token-repo.js";
import {
  InMemoryAuthCodesStore,
  type AuthCodesStore,
} from "../store/persistent-auth-codes.js";
import { InMemoryClientsStore } from "../store/persistent-clients-store.js";
import { hashPii } from "./token-store.js";
import {
  InMemoryJtiStore,
  type JtiStore,
} from "../store/persistent-jti-store.js";

// Audience separation (CODE-M7): every JWT we mint is tagged with its
// purpose. Verifiers pin the audience so an attacker can't smuggle a
// session JWT into the access-token slot or vice versa, even if a single
// secret rotates and starts being shared. Combined with `type` claim
// checks already in place, this is belt-and-braces.
const ACCESS_AUDIENCE = "mcp-oauth-access";
const REFRESH_AUDIENCE = "mcp-oauth-refresh";

const REFRESH_TTL_SECONDS = 30 * 24 * 3600;
// A client that retries or races its own refresh presents the old token again
// within moments. That is not theft, so inside this window a replay is only
// refused; after it, a replay revokes the whole token chain.
const REFRESH_REUSE_GRACE_SECONDS = 60;
const FAMILY_REVOKED_PREFIX = "rtfam:";
const ROTATED_PREFIX = "rtrot:";
const CODE_REDEEMED_PREFIX = "rtcode:";
const REVOKED_MESSAGE = "User authorization has been revoked";

let cachedSecret: Uint8Array | undefined;

function getJwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const secret = process.env.OAUTH_SECRET;
  if (secret) {
    cachedSecret = new TextEncoder().encode(secret);
    return cachedSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("OAUTH_SECRET environment variable is required in production");
  }

  logger.warn("OAUTH_SECRET not set; generating random secret (tokens won't survive restart)");
  const randomSecret = crypto.randomBytes(32).toString("hex");
  process.env.OAUTH_SECRET = randomSecret;
  cachedSecret = new TextEncoder().encode(randomSecret);
  return cachedSecret;
}

function redeemedCodeKey(code: string): string {
  return CODE_REDEEMED_PREFIX + crypto.createHash("sha256").update(code).digest("hex");
}

function pkceVerifierMatches(verifier: string | undefined, challenge: string | undefined): boolean {
  if (!verifier || !challenge) return false;
  const computed = Buffer.from(crypto.createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

export interface PendingAuthSession {
  fbUserId: string;
}

export class MetaAdsOAuthProvider implements OAuthServerProvider {
  private clientsStoreImpl: OAuthRegisteredClientsStore = new InMemoryClientsStore();
  private authCodesImpl: AuthCodesStore = new InMemoryAuthCodesStore();
  private refreshJtiStoreImpl: JtiStore = new InMemoryJtiStore();
  private pendingAuthResolver: () => PendingAuthSession | null = () => null;
  private defaultResource: URL | undefined;
  private requireRedirectUri = true;

  // The SDK would otherwise verify the PKCE challenge before calling
  // exchangeAuthorizationCode, which leaves the code redeemable after a wrong
  // verifier. Verifying here, after the code has been consumed, makes every
  // failed attempt burn it.
  readonly skipLocalPkceValidation = true;

  configure(opts: {
    clientsStore?: OAuthRegisteredClientsStore;
    authCodesStore?: AuthCodesStore;
    refreshJtiStore?: JtiStore;
    resolvePendingAuth?: () => PendingAuthSession | null;
    defaultResource?: URL | null;
    requireRedirectUri?: boolean;
  }): void {
    if (opts.clientsStore) this.clientsStoreImpl = opts.clientsStore;
    if (opts.authCodesStore) this.authCodesImpl = opts.authCodesStore;
    if (opts.refreshJtiStore) this.refreshJtiStoreImpl = opts.refreshJtiStore;
    if (opts.resolvePendingAuth) this.pendingAuthResolver = opts.resolvePendingAuth;
    if (opts.defaultResource !== undefined) this.defaultResource = opts.defaultResource ?? undefined;
    if (opts.requireRedirectUri !== undefined) this.requireRedirectUri = opts.requireRedirectUri;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.clientsStoreImpl;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const code = crypto.randomBytes(32).toString("hex");
    const pending = this.pendingAuthResolver();
    if (pending?.fbUserId && isDenied(pending.fbUserId)) {
      throw new AccessDeniedError("This account is not permitted to authorize clients");
    }
    const suppliedRedirectUri = res.req?.method === "POST"
      ? res.req.body?.redirect_uri
      : res.req?.query?.redirect_uri;

    await this.authCodesImpl.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      redirectUriRequired: this.requireRedirectUri && typeof suppliedRedirectUri === "string",
      resource: (params.resource ?? this.defaultResource)?.href,
      fbUserId: pending?.fbUserId,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (params.state) {
      redirectUrl.searchParams.set("state", params.state);
    }

    logger.info(
      { clientId: client.client_id, subject: hashPii(pending?.fbUserId) },
      "Authorization code issued",
    );
    res.redirect(302, redirectUrl.toString());
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const entry = await this.authCodesImpl.get(authorizationCode);
    if (!entry) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    if (entry.clientId !== client.client_id) {
      throw new InvalidGrantError(
        "Authorization code was issued to a different client",
      );
    }
    if (entry.expiresAt < Math.floor(Date.now() / 1000)) {
      await this.authCodesImpl.delete(authorizationCode);
      throw new InvalidGrantError("Authorization code has expired");
    }
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // Atomic get-and-delete: under concurrent exchange requests, only the
    // first caller sees the entry. RFC 6749 §10.5: codes must be single-use.
    const entry = await this.authCodesImpl.consume(authorizationCode);
    if (!entry) {
      await this.handleCodeReplay(authorizationCode, client.client_id);
      throw new InvalidGrantError("Invalid authorization code");
    }

    if (entry.clientId !== client.client_id) {
      throw new InvalidGrantError(
        "Authorization code was issued to a different client",
      );
    }
    if (entry.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidGrantError("Authorization code has expired");
    }

    if ((entry.redirectUriRequired || redirectUri !== undefined) && redirectUri !== entry.redirectUri) {
      throw new InvalidGrantError("Authorization code redirect URI mismatch");
    }
    if (entry.resource && resource && resource.href !== entry.resource) {
      throw new InvalidGrantError("Authorization code resource mismatch");
    }

    if (!pkceVerifierMatches(codeVerifier, entry.codeChallenge)) {
      throw new InvalidGrantError("PKCE verification failed");
    }

    if (entry.fbUserId && !(await this.isSubjectAuthorized(entry.fbUserId))) {
      throw new InvalidGrantError(REVOKED_MESSAGE);
    }

    const familyId = crypto.randomBytes(16).toString("hex");
    const redeemedAt = Math.floor(Date.now() / 1000);
    // Lets a later replay of this code find, and revoke, the tokens it produced.
    // Keyed by a hash so the code itself is not kept beside the refresh tokens.
    await this.refreshJtiStoreImpl
      .put(redeemedCodeKey(authorizationCode), {
        expiresAt: redeemedAt + REFRESH_TTL_SECONDS,
        meta: { kind: "code_redeemed", family: familyId, redeemedAt },
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "Could not record the redeemed authorization code; a replay will not revoke its tokens");
      });

    return this.generateTokens({
      clientId: client.client_id,
      resource:
        resource ?? (entry.resource ? new URL(entry.resource) : undefined),
      fbUserId: entry.fbUserId,
      familyId,
    });
  }

  private async handleCodeReplay(authorizationCode: string, clientId: string): Promise<void> {
    try {
      const redeemed = await this.refreshJtiStoreImpl.get(redeemedCodeKey(authorizationCode));
      const family = redeemed?.meta?.family;
      if (typeof family !== "string") return;
      const redeemedAt = redeemed?.meta?.redeemedAt;
      const now = Math.floor(Date.now() / 1000);
      if (typeof redeemedAt === "number" && now - redeemedAt < REFRESH_REUSE_GRACE_SECONDS) return;
      await this.revokeFamily(family, clientId);
      logger.warn(
        { clientId, family: hashPii(family) },
        "An authorization code was redeemed again; the tokens issued from it have been revoked",
      );
    } catch (error) {
      logger.error({ err: error, clientId }, "Could not record an authorization code replay");
    }
  }

  private async revokeFamily(familyId: string, clientId: string): Promise<void> {
    await this.refreshJtiStoreImpl.put(FAMILY_REVOKED_PREFIX + familyId, {
      expiresAt: Math.floor(Date.now() / 1000) + REFRESH_TTL_SECONDS,
      meta: { kind: "family_revoked", clientId },
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const secret = getJwtSecret();

    const { payload } = await jwtVerify(refreshToken, secret, {
      algorithms: ["HS256"],
      audience: REFRESH_AUDIENCE,
    }).catch(() => {
      throw new InvalidGrantError("Invalid refresh token");
    });

    if (payload.type !== "refresh") {
      throw new InvalidGrantError("Token is not a refresh token");
    }
    if (payload.sub !== client.client_id) {
      throw new InvalidGrantError(
        "Refresh token was issued to a different client",
      );
    }
    const boundResource = typeof payload.resource === "string" ? new URL(payload.resource) : undefined;
    if (boundResource && resource && boundResource.href !== resource.href) {
      throw new InvalidGrantError("Refresh token resource mismatch");
    }
    // jti must be present in the allow-list — i.e. issued by us, not yet
    // revoked, and not yet rotated. Old tokens issued before this code
    // existed don't carry a jti and would be rejected here, which is the
    // intended behaviour after rolling out the change.
    if(typeof payload.fb_user_id==="string"&&await isMetaPrincipalPrivacyLocked(payload.fb_user_id))throw new InvalidGrantError("User authorization has been revoked");
    const jti = typeof payload.jti === "string" ? payload.jti : null;
    if (!jti) {
      throw new InvalidGrantError("Refresh token missing jti");
    }
    const familyId = typeof payload.fid === "string" ? payload.fid : jti;
    if (await this.refreshJtiStoreImpl.has(FAMILY_REVOKED_PREFIX + familyId)) {
      throw new InvalidGrantError("Refresh token has been revoked or already used");
    }
    const subject = typeof payload.fb_user_id === "string" ? payload.fb_user_id : undefined;
    if (subject && !(await this.isSubjectAuthorized(subject))) {
      await this.refreshJtiStoreImpl.consume(jti);
      logger.warn(
        { clientId: client.client_id, subject: hashPii(subject) },
        "Refresh refused: the account is no longer authorized",
      );
      throw new InvalidGrantError(REVOKED_MESSAGE);
    }
    // Atomic consume: under concurrent refresh requests with the same
    // token, only one wins. Without this, has()+delete() were two
    // separate calls, leaving a replay window across instances backed by
    // Firestore (and breaking the rotation guarantee in-memory under
    // sufficient async interleaving). Even if generateTokens fails after
    // this, the worst case is the user has to re-authorize.
    const rotated = await this.refreshJtiStoreImpl.consume(jti, {
      tombstone: {
        id: ROTATED_PREFIX + jti,
        entry: {
          expiresAt: Math.floor(Date.now() / 1000) + REFRESH_REUSE_GRACE_SECONDS,
          meta: { kind: "rotated" },
        },
      },
    });
    if (!rotated) {
      await this.handleRefreshReplay(jti, familyId, client.client_id, subject);
      throw new InvalidGrantError(
        "Refresh token has been revoked or already used",
      );
    }

    return this.generateTokens({
      clientId: client.client_id,
      resource: boundResource ?? resource,
      fbUserId: subject,
      familyId,
    });
  }

  private async handleRefreshReplay(
    jti: string,
    familyId: string,
    clientId: string,
    subject: string | undefined,
  ): Promise<void> {
    try {
      if (await this.refreshJtiStoreImpl.has(ROTATED_PREFIX + jti)) return;
      // The token is validly signed and unexpired yet no longer redeemable, and
      // it was not rotated moments ago: whoever holds it may have copied it.
      // Every token in the chain, including the one the legitimate client now
      // holds, is refused from here on so the next sign-in re-establishes who
      // owns it.
      await this.revokeFamily(familyId, clientId);
      logger.warn(
        { clientId, subject: hashPii(subject), family: hashPii(familyId) },
        "Rotated refresh token was presented again; its token chain has been revoked",
      );
    } catch (error) {
      logger.error({ err: error, clientId }, "Could not record a refresh token reuse");
    }
  }

  private async isSubjectAuthorized(fbUserId: string): Promise<boolean> {
    if (isDenied(fbUserId)) return false;
    if (isAllowed({ fbUserId })) return true;
    if (!allowlistHasEmailRules()) return false;
    try {
      const user = await getUser(fbUserId);
      return isAllowed({ email: user?.email ?? null, fbUserId });
    } catch (error) {
      logger.error({ err: error, subject: hashPii(fbUserId) }, "Could not re-check the account allowlist");
      throw new ServerError("Unable to confirm that the account is still authorized");
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const secret = getJwtSecret();

    // Throw the SDK's typed error so requireBearerAuth responds with
    // 401 + WWW-Authenticate (triggering the client's refresh flow).
    // A plain Error here falls through to the SDK's generic 500 path,
    // which leaves clients stuck pretending the server is down once
    // their 1h access token expires.
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      audience: ACCESS_AUDIENCE,
    }).catch(() => {
      throw new InvalidTokenError("Invalid access token");
    });

    if(typeof payload.fb_user_id==="string"&&await isMetaPrincipalPrivacyLocked(payload.fb_user_id))throw new InvalidTokenError("User authorization has been revoked");
    if (payload.type !== "access") {
      throw new InvalidTokenError("Token is not an access token");
    }
    if (typeof payload.fb_user_id === "string" && isDenied(payload.fb_user_id)) {
      throw new InvalidTokenError(REVOKED_MESSAGE);
    }

    const extra: Record<string, unknown> = {};
    if (typeof payload.fb_user_id === "string") {
      extra.fbUserId = payload.fb_user_id;
    }

    const authInfo: AuthInfo = {
      token,
      clientId: payload.sub!,
      scopes: [],
      expiresAt: payload.exp,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    };
    if (payload.resource) {
      authInfo.resource = new URL(payload.resource as string);
    } else if (this.defaultResource) {
      // Pre-upgrade tokens belong to this single-resource service; retain them until normal rotation.
      authInfo.resource = this.defaultResource;
    }
    return authInfo;
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    // RFC 7009: best-effort revoke. We can only revoke refresh tokens (the
    // ones we track jtis for). Access tokens are 1h TTL and stateless.
    const token = request.token;
    if (!token) return;
    try {
      const { payload } = await jwtVerify(token, getJwtSecret(), {
        algorithms: ["HS256"],
        audience: REFRESH_AUDIENCE,
      });
      if (payload.type === "refresh" && payload.sub === client.client_id && typeof payload.jti === "string") {
        await this.refreshJtiStoreImpl.delete(payload.jti);
        logger.info({ jti: payload.jti }, "Refresh token revoked");
      }
    } catch {
      // Silently ignore — RFC 7009 §2.2: revocation responses must succeed
      // even on unrecognised tokens. Tokens that aren't a refresh JWT fall
      // through here and we treat them as already revoked / unknown.
    }
  }

  private async generateTokens(input: {
    clientId: string;
    resource?: URL;
    fbUserId?: string;
    familyId?: string;
  }): Promise<OAuthTokens> {
    const secret = getJwtSecret();
    const now = Math.floor(Date.now() / 1000);

    const claims: Record<string, unknown> = {
      sub: input.clientId,
      type: "access",
    };
    const resource = input.resource ?? this.defaultResource;
    if (resource) claims.resource = resource.href;
    if(input.fbUserId&&await isMetaPrincipalPrivacyLocked(input.fbUserId))throw new InvalidGrantError("User authorization has been revoked");
    if (input.fbUserId && isDenied(input.fbUserId)) throw new InvalidGrantError(REVOKED_MESSAGE);
    if (input.fbUserId) claims.fb_user_id = input.fbUserId;

    const accessToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setAudience(ACCESS_AUDIENCE)
      .sign(secret);

    // Refresh tokens carry a jti recorded in the refresh allow-list.
    // Exchange-refresh deletes the jti before minting a new pair (rotation),
    // and revokeToken can wipe it on demand.
    const refreshJti = crypto.randomBytes(16).toString("hex");
    const familyId = input.familyId ?? refreshJti;
    const refreshExpiresAt = now + REFRESH_TTL_SECONDS;
    const refreshClaims: Record<string, unknown> = {
      sub: input.clientId,
      type: "refresh",
      jti: refreshJti,
      fid: familyId,
    };
    if (resource) refreshClaims.resource = resource.href;
    if (input.fbUserId) refreshClaims.fb_user_id = input.fbUserId;

    const refreshToken = await new SignJWT(refreshClaims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(refreshExpiresAt)
      .setAudience(REFRESH_AUDIENCE)
      .sign(secret);

    await this.refreshJtiStoreImpl.put(refreshJti, {
      expiresAt: refreshExpiresAt,
      meta: {
        clientId: input.clientId,
        fbUserId: input.fbUserId ?? null,
        family: familyId,
      },
    });

    logger.info(
      { clientId: input.clientId, subject: hashPii(input.fbUserId) },
      "Tokens issued",
    );

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
    };
  }
}

export const oauthProvider: MetaAdsOAuthProvider = new MetaAdsOAuthProvider();

export function resetOAuthProviderForTests(): void {
  cachedSecret = undefined;
  oauthProvider.configure({
    clientsStore: new InMemoryClientsStore(),
    authCodesStore: new InMemoryAuthCodesStore(),
    refreshJtiStore: new InMemoryJtiStore(),
    resolvePendingAuth: () => null,
    defaultResource: null,
    requireRedirectUri: true,
  });
}
