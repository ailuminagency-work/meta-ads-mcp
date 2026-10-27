import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { vi } from "vitest";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { resetSecretCacheForTests, setSession } from "../../src/auth/session.js";
import { resetOAuthStateSecretForTests } from "../../src/auth/oauth-state.js";
import { resetKeyCacheForTests } from "../../src/auth/crypto.js";
import { resetMetaTokenRepoForTests } from "../../src/store/meta-token-repo.js";
import { startHttpTransport } from "../../src/transport/http.js";

export const OPERATOR_ID = "100000000000001";
export const OTHER_OPERATOR_ID = "100000000000002";
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const BASE_ENV: Record<string, string | undefined> = {
  NODE_ENV: "test",
  DEPLOYMENT_MODE: "upstream",
  SERVER_URL: "http://localhost:3000",
  META_APP_ID: "100000000000099",
  META_APP_SECRET: "synthetic-app-secret-value",
  TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
  SESSION_COOKIE_SECRET: "synthetic-session-cookie-secret-0123456789",
  OAUTH_SECRET: "synthetic-oauth-signing-secret-0123456789abcdef",
  AUTH_ALLOWED_FB_USER_IDS: OPERATOR_ID,
  AUTH_ALLOWED_EMAILS: "",
  AUTH_ALLOWED_DOMAINS: "",
  AUTH_DENIED_FB_USER_IDS: "",
  OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS: "",
  MCP_API_KEY: "",
  META_ACCESS_TOKEN: "",
  META_LOGIN_CONFIG_ID: "",
  LUMIN_PLATFORM_ENABLED: "false",
  LUMIN_META_PRIVACY_ENABLED: undefined,
  FIRESTORE_PROJECT_ID: undefined,
  GOOGLE_CLOUD_PROJECT: undefined,
  GOOGLE_CREDENTIALS_JSON: undefined,
  FIRESTORE_EMULATOR_HOST: undefined,
};

export interface AuthServer {
  origin: string;
  close: () => Promise<void>;
}

/** Boots the real HTTP transport (in-memory stores, multi-tenant Meta OAuth) on a loopback port. */
export async function startAuthServer(env: Record<string, string | undefined> = {}): Promise<AuthServer> {
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...env })) {
    vi.stubEnv(key, value);
  }
  resetOAuthProviderForTests();
  resetSecretCacheForTests();
  resetOAuthStateSecretForTests();
  resetKeyCacheForTests();
  resetMetaTokenRepoForTests();

  const loopbackFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return Promise.reject(new Error(`outbound request to ${url.hostname} blocked in tests`));
    }
    return loopbackFetch(input, init);
  });

  const signals = ["SIGTERM", "SIGINT"] as const;
  const listenersBefore = signals.map((signal) => new Set(process.listeners(signal)));
  const removeShutdownHooks = () => {
    signals.forEach((signal, index) => {
      for (const listener of process.listeners(signal)) {
        if (!listenersBefore[index].has(listener)) process.off(signal, listener);
      }
    });
  };

  let server: Server | undefined;
  vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Express) {
    server = createNodeServer(this);
    server.listen(0, "127.0.0.1");
    return server;
  } as typeof express.application.listen);

  await startHttpTransport(() => new McpServer({ name: "auth-flow-test", version: "1" }), 0);
  if (!server!.listening) await new Promise<void>((resolve) => server!.once("listening", resolve));
  return {
    origin: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        removeShutdownHooks();
        vi.unstubAllGlobals();
        server!.closeAllConnections();
        server!.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((a) => /^\s*(max-age=0|expires=thu, 01 jan 1970)/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** Issues a real session cookie the way the Meta callback would, without calling Meta. */
export async function sessionCookieFor(
  fbUserId: string,
  profile: { email?: string | null; name?: string | null } = {},
): Promise<CookieJar> {
  const jar = new CookieJar();
  await setSession(
    { cookie: (name: string, value: string) => jar.set(name, value) } as never,
    { fbUserId, email: profile.email ?? null, name: profile.name ?? "Synthetic Operator" },
  );
  return jar;
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export async function registerClient(
  origin: string,
  redirectUris: string[] = [CLAUDE_REDIRECT],
  extraHeaders: Record<string, string> = {},
): Promise<{ client_id: string; redirect_uris: string[] }> {
  const response = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify({
      client_name: "Synthetic client",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (response.status !== 201) throw new Error(`registration failed with ${response.status}`);
  return (await response.json()) as { client_id: string; redirect_uris: string[] };
}

export function authorizeParams(input: {
  clientId: string;
  redirectUri?: string;
  challenge: string;
  method?: string;
  state?: string;
  resource?: string;
}): URLSearchParams {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri ?? CLAUDE_REDIRECT,
    state: input.state ?? "synthetic-state",
  });
  if (input.challenge) params.set("code_challenge", input.challenge);
  if (input.method !== "") params.set("code_challenge_method", input.method ?? "S256");
  params.set("resource", input.resource ?? "http://localhost:3000/mcp");
  return params;
}

export function formHeaders(jar?: CookieJar, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/x-www-form-urlencoded",
    "sec-fetch-site": "same-origin",
    ...(jar ? { cookie: jar.header() } : {}),
    ...extra,
  };
}

export async function postToken(origin: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}
