import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGoogleAuthorizeUrl, exchangeGoogleCode, fetchGoogleIdentity, loadGoogleOAuthConfig, refreshGoogleAccessToken } from "../../src/auth/google-oauth.js";
import { mockFetchResponse } from "../setup.js";

describe("Google OAuth", () => {
  const serverUrl = new URL("https://staging.example.com");
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("derives and pins the callback endpoint", () => {
    const config = loadGoogleOAuthConfig(serverUrl, { GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: "secret" });
    expect(config?.redirectUri).toBe("https://staging.example.com/auth/google/callback");
    const url = new URL(buildGoogleAuthorizeUrl(config!, "state"));
    expect(url.searchParams.get("redirect_uri")).toBe(config?.redirectUri);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/adwords");
  });

  it("rejects a callback override that does not match the implemented route", () => {
    expect(() => loadGoogleOAuthConfig(serverUrl, { GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: "secret", GOOGLE_OAUTH_REDIRECT_URI: "https://evil.example/callback" })).toThrow(/must match/);
  });

  it("exchanges and refreshes tokens without exposing provider errors", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "openid email" }))
      .mockResolvedValueOnce(mockFetchResponse({ access_token: "next", expires_in: 3600 }))
      .mockResolvedValueOnce(mockFetchResponse({ sub: "google-sub", email: "user@example.com", name: "User" }));
    const config = { clientId: "client", clientSecret: "secret", redirectUri: "https://staging.example.com/auth/google/callback" };
    await expect(exchangeGoogleCode(config, "code")).resolves.toMatchObject({ accessToken: "access", refreshToken: "refresh" });
    await expect(refreshGoogleAccessToken(config, "refresh")).resolves.toMatchObject({ accessToken: "next", refreshToken: null });
    await expect(fetchGoogleIdentity("access")).resolves.toEqual({ subject: "google-sub", email: "user@example.com", name: "User" });
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("sanitizes malformed and failed token responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse({ error: "invalid_grant", private_value: "secret" }, { status: 400 }));
    await expect(exchangeGoogleCode({ clientId: "client", clientSecret: "secret", redirectUri: "https://staging.example.com/auth/google/callback" }, "code")).rejects.toThrow("Google OAuth token exchange failed");
    expect(() => loadGoogleOAuthConfig(serverUrl, { GOOGLE_OAUTH_CLIENT_ID: "client" })).toThrow(/configured together/);
  });
});
