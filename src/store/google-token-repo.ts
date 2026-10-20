import { getFirestore } from "./firestore.js";
import { decryptToken, encryptToken, type EncryptedPayload } from "../auth/crypto.js";
import type { GoogleOAuthTokens } from "../auth/google-oauth.js";

const REFRESH_SKEW_SECONDS = 60;

function aadFor(subject: string): string { return `google_grant:${subject}`; }

export interface GoogleGrantDoc {
  encryptedRefreshToken: EncryptedPayload;
  encryptedAccessToken: EncryptedPayload | null;
  expiresAt: number | null;
  scopes: string[];
  googleSubject: string;
  email: string | null;
  customerIds: string[];
  loginCustomerIds: Record<string, string>;
  searchConsoleSites: string[];
  analyticsPropertyIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GoogleGrantSummary {
  connected: boolean;
  googleSubject: string | null;
  email: string | null;
  scopes: string[];
  customerIds: string[];
  searchConsoleSites: string[];
  analyticsPropertyIds: string[];
  updatedAt: number | null;
}

export interface GoogleGrantInput {
  userId: string;
  tokens: GoogleOAuthTokens;
  googleSubject: string;
  email: string | null;
  customerIds?: string[];
  loginCustomerIds?: Record<string, string>;
  searchConsoleSites?: string[];
  analyticsPropertyIds?: string[];
  existingRefreshToken?: string | null;
}

export interface GoogleTokenRepo {
  saveGrant(input: GoogleGrantInput): Promise<void>;
  getGrant(userId: string): Promise<GoogleGrantDoc | null>;
  getSummary(userId: string): Promise<GoogleGrantSummary>;
  deleteGrant(userId: string): Promise<void>;
  getAccessToken(userId: string, scope: string, refresh: (token: string) => Promise<GoogleOAuthTokens>): Promise<string>;
}

function decrypt(payload: EncryptedPayload, userId: string): string {
  return decryptToken(payload, aadFor(userId));
}

function summarize(doc: GoogleGrantDoc | null): GoogleGrantSummary {
  if (!doc) return { connected: false, googleSubject: null, email: null, scopes: [], customerIds: [], searchConsoleSites: [], analyticsPropertyIds: [], updatedAt: null };
  return { connected: true, googleSubject: doc.googleSubject, email: doc.email, scopes: [...doc.scopes], customerIds: [...doc.customerIds], searchConsoleSites: [...doc.searchConsoleSites], analyticsPropertyIds: [...doc.analyticsPropertyIds], updatedAt: doc.updatedAt };
}

export class InMemoryGoogleTokenRepo implements GoogleTokenRepo {
  private readonly grants = new Map<string, GoogleGrantDoc>();

  async saveGrant(input: GoogleGrantInput): Promise<void> {
    const old = this.grants.get(input.userId);
    const refreshToken = input.tokens.refreshToken ?? input.existingRefreshToken ?? (old ? decrypt(old.encryptedRefreshToken, input.userId) : null);
    if (!refreshToken) throw new Error("Google authorization did not return a refresh token");
    const now = Math.floor(Date.now() / 1000);
    this.grants.set(input.userId, {
      encryptedRefreshToken: encryptToken(refreshToken, aadFor(input.userId)),
      encryptedAccessToken: encryptToken(input.tokens.accessToken, aadFor(input.userId)),
      expiresAt: input.tokens.expiresAt,
      scopes: [...new Set(input.tokens.scopes.length ? input.tokens.scopes : (old?.scopes ?? []))],
      googleSubject: input.googleSubject,
      email: input.email,
      customerIds: [...(input.customerIds ?? old?.customerIds ?? [])],
      loginCustomerIds: { ...(input.loginCustomerIds ?? old?.loginCustomerIds ?? {}) },
      searchConsoleSites: [...(input.searchConsoleSites ?? old?.searchConsoleSites ?? [])],
      analyticsPropertyIds: [...(input.analyticsPropertyIds ?? old?.analyticsPropertyIds ?? [])],
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async getGrant(userId: string): Promise<GoogleGrantDoc | null> { return this.grants.get(userId) ?? null; }
  async getSummary(userId: string): Promise<GoogleGrantSummary> { return summarize(await this.getGrant(userId)); }
  async deleteGrant(userId: string): Promise<void> { this.grants.delete(userId); }

  async getAccessToken(userId: string, scope: string, refresh: (token: string) => Promise<GoogleOAuthTokens>): Promise<string> {
    const grant = this.grants.get(userId);
    if (!grant || !grant.scopes.includes(scope)) throw new Error("Google scope is not granted");
    const now = Math.floor(Date.now() / 1000);
    if (grant.encryptedAccessToken && (grant.expiresAt === null || grant.expiresAt > now + REFRESH_SKEW_SECONDS)) return decrypt(grant.encryptedAccessToken, userId);
    const next = await refresh(decrypt(grant.encryptedRefreshToken, userId));
    grant.encryptedAccessToken = encryptToken(next.accessToken, aadFor(userId));
    grant.expiresAt = next.expiresAt;
    grant.updatedAt = now;
    if (next.scopes.length) grant.scopes = [...new Set(next.scopes)];
    return next.accessToken;
  }
}

export class FirestoreGoogleTokenRepo implements GoogleTokenRepo {
  private ref(userId: string) { return getFirestore().collection("users").doc(userId).collection("google").doc("default"); }

  async saveGrant(input: GoogleGrantInput): Promise<void> {
    const ref = this.ref(input.userId);
    const old = (await ref.get()).data() as GoogleGrantDoc | undefined;
    const refreshToken = input.tokens.refreshToken ?? input.existingRefreshToken ?? (old ? decrypt(old.encryptedRefreshToken, input.userId) : null);
    if (!refreshToken) throw new Error("Google authorization did not return a refresh token");
    const now = Math.floor(Date.now() / 1000);
    const doc: GoogleGrantDoc = {
      encryptedRefreshToken: encryptToken(refreshToken, aadFor(input.userId)),
      encryptedAccessToken: encryptToken(input.tokens.accessToken, aadFor(input.userId)),
      expiresAt: input.tokens.expiresAt,
      scopes: [...new Set(input.tokens.scopes.length ? input.tokens.scopes : (old?.scopes ?? []))],
      googleSubject: input.googleSubject,
      email: input.email,
      customerIds: [...(input.customerIds ?? old?.customerIds ?? [])],
      loginCustomerIds: { ...(input.loginCustomerIds ?? old?.loginCustomerIds ?? {}) },
      searchConsoleSites: [...(input.searchConsoleSites ?? old?.searchConsoleSites ?? [])],
      analyticsPropertyIds: [...(input.analyticsPropertyIds ?? old?.analyticsPropertyIds ?? [])],
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    await ref.set(doc);
  }
  async getGrant(userId: string): Promise<GoogleGrantDoc | null> { const s = await this.ref(userId).get(); return s.exists ? s.data() as GoogleGrantDoc : null; }
  async getSummary(userId: string): Promise<GoogleGrantSummary> { return summarize(await this.getGrant(userId)); }
  async deleteGrant(userId: string): Promise<void> { await this.ref(userId).delete(); }
  async getAccessToken(userId: string, scope: string, refresh: (token: string) => Promise<GoogleOAuthTokens>): Promise<string> {
    const grant = await this.getGrant(userId);
    if (!grant || !grant.scopes.includes(scope)) throw new Error("Google scope is not granted");
    const now = Math.floor(Date.now() / 1000);
    if (grant.encryptedAccessToken && (grant.expiresAt === null || grant.expiresAt > now + REFRESH_SKEW_SECONDS)) return decrypt(grant.encryptedAccessToken, userId);
    const next = await refresh(decrypt(grant.encryptedRefreshToken, userId));
    await this.ref(userId).update({ encryptedAccessToken: encryptToken(next.accessToken, aadFor(userId)), expiresAt: next.expiresAt, updatedAt: now, ...(next.scopes.length ? { scopes: [...new Set(next.scopes)] } : {}) });
    return next.accessToken;
  }
}
