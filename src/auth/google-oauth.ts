import { readBodyWithLimit } from "../utils/bounded-body.js";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
}

export interface GoogleIdentity {
  subject: string;
  email: string | null;
  name: string | null;
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

export function loadGoogleOAuthConfig(serverUrl: URL, env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured together");

  const expected = new URL("/auth/google/callback", serverUrl).toString();
  const configured = env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (configured && configured !== expected) {
    throw new Error("GOOGLE_OAUTH_REDIRECT_URI must match SERVER_URL/auth/google/callback");
  }
  return { clientId, clientSecret, redirectUri: expected };
}

export function buildGoogleAuthorizeUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBodyWithLimit(response, 256_000));
  } catch {
    throw new Error("Google OAuth returned an invalid response");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Google OAuth returned an invalid response");
  }
  return parsed as Record<string, unknown>;
}

async function tokenRequest(body: URLSearchParams): Promise<GoogleOAuthTokens> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Google OAuth token request failed");
  }
  const payload = await jsonResponse(response);
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error("Google OAuth token exchange failed");
  }
  const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : null;
  const scopeText = typeof payload.scope === "string" ? payload.scope : "";
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresAt: expiresIn === null ? null : Math.floor(Date.now() / 1000) + expiresIn,
    scopes: scopeText.split(" ").filter(Boolean),
  };
}

export function exchangeGoogleCode(config: GoogleOAuthConfig, code: string): Promise<GoogleOAuthTokens> {
  const body = new URLSearchParams({
    code: required(code, "Google authorization code"),
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  return tokenRequest(body);
}

export function refreshGoogleAccessToken(config: GoogleOAuthConfig, refreshToken: string): Promise<GoogleOAuthTokens> {
  const body = new URLSearchParams({
    refresh_token: required(refreshToken, "Google refresh token"),
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  return tokenRequest(body);
}

export async function fetchGoogleIdentity(accessToken: string): Promise<GoogleIdentity> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${required(accessToken, "Google access token")}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Google identity request failed");
  }
  const payload = await jsonResponse(response);
  if (!response.ok || typeof payload.sub !== "string" || !payload.sub.trim()) {
    throw new Error("Google identity response was invalid");
  }
  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}
