import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { createServer as createNodeServer, type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { resetSecretCacheForTests, setSession } from "../../src/auth/session.js";
import { resetOAuthStateSecretForTests } from "../../src/auth/oauth-state.js";
import { resetKeyCacheForTests } from "../../src/auth/crypto.js";
import { resetMetaTokenRepoForTests, saveToken } from "../../src/store/meta-token-repo.js";
import { startHttpTransport } from "../../src/transport/http.js";

const OPERATOR_ID = "100000000000001";
const REDIRECT = "http://127.0.0.1:38123/cb";
const CROSS_SITE_FORM = {
  "Content-Type": "application/x-www-form-urlencoded",
  Origin: "https://evil.example",
  "Sec-Fetch-Site": "cross-site",
};

const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DEPLOYMENT_MODE: "agency",
  SERVER_URL: "http://localhost:3000",
  META_APP_ID: "100000000000099",
  META_APP_SECRET: "synthetic-app-secret-value",
  TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
  SESSION_COOKIE_SECRET: "synthetic-session-cookie-secret-0123456789",
  OAUTH_SECRET: "synthetic-oauth-signing-secret-0123456789abcdef",
  AUTH_ALLOWED_FB_USER_IDS: OPERATOR_ID,
  AUTH_ALLOWED_EMAILS: "",
  AUTH_ALLOWED_DOMAINS: "",
  MCP_API_KEY: "",
  META_ACCESS_TOKEN: "",
  META_TOKENS: "",
  FIRESTORE_PROJECT_ID: "",
  GOOGLE_CLOUD_PROJECT: "",
  FIRESTORE_EMULATOR_HOST: "",
};

let httpServer: Server | undefined;

afterEach(async () => {
  if (httpServer) {
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  }
  httpServer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function boot(env: Record<string, string> = {}): Promise<string> {
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...env })) vi.stubEnv(key, value);
  resetOAuthProviderForTests();
  resetSecretCacheForTests();
  resetOAuthStateSecretForTests();
  resetKeyCacheForTests();
  resetMetaTokenRepoForTests();
  vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Express) {
    httpServer = createNodeServer(this);
    httpServer.listen(0, "127.0.0.1");
    return httpServer;
  } as typeof express.application.listen);
  await startHttpTransport(() => new McpServer({ name: "authorize-path-test", version: "1" }), 0);
  if (!httpServer!.listening) await new Promise<void>((resolve) => httpServer!.once("listening", resolve));
  return `http://127.0.0.1:${(httpServer!.address() as AddressInfo).port}`;
}

interface RawResponse {
  status: number;
  location: string | null;
  body: string;
}

/** Sends the request line exactly as given: fetch would normalise "/authorize//" and "/authorize/.". */
function raw(
  origin: string,
  input: { method?: string; target: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
  const { port } = new URL(origin);
  const body = input.body ?? "";
  const headers = Object.entries({
    Host: `127.0.0.1:${port}`,
    Connection: "close",
    "Content-Length": String(Buffer.byteLength(body)),
    ...input.headers,
  })
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), "127.0.0.1", () => {
      socket.write(`${input.method ?? "GET"} ${input.target} HTTP/1.1\r\n${headers}\r\n${body}`);
    });
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString();
    });
    socket.on("error", reject);
    socket.on("close", () => {
      resolve({
        status: Number((received.split("\r\n")[0] ?? "").split(" ")[1] ?? 0),
        location: /^location: (.*)$/im.exec(received)?.[1]?.trim() ?? null,
        body: received.slice(received.indexOf("\r\n\r\n") + 4),
      });
    });
    socket.setTimeout(5000, () => socket.destroy());
  });
}

async function registerClient(origin: string): Promise<string> {
  const response = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Synthetic client",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeParams(clientId: string, challenge: string, state = "ST"): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource: "http://localhost:3000/mcp",
  });
}

function reachesTheClient(location: string | null): boolean {
  return location !== null && location.startsWith("http://127.0.0.1:38123/");
}

async function prepare(env: Record<string, string> = {}) {
  const origin = await boot(env);
  const clientId = await registerClient(origin);
  const { verifier, challenge } = pkce();
  return { origin, clientId, verifier, params: authorizeParams(clientId, challenge) };
}

describe("/authorize//: the SDK handler is not reachable around the login and consent checks", () => {
  it("refuses an anonymous GET and issues no authorization code", async () => {
    const { origin, params } = await prepare();

    const control = await raw(origin, { target: `/authorize?${params}` });
    expect(control.status).toBe(302);
    expect(control.location).toMatch(/^\/auth\/meta\?return=/);

    const attack = await raw(origin, { target: `/authorize//?${params}` });
    expect(attack.location ?? "").not.toContain("code=");
    expect(reachesTheClient(attack.location)).toBe(false);
    expect(attack.status).toBe(404);
  });

  it("refuses a cross-site POST that carries no cookie", async () => {
    const { origin, params } = await prepare();

    const control = await raw(origin, {
      method: "POST",
      target: "/authorize",
      headers: CROSS_SITE_FORM,
      body: params.toString(),
    });
    expect(control.status).toBe(401);
    expect(control.location ?? "").not.toContain("code=");

    const attack = await raw(origin, {
      method: "POST",
      target: "/authorize//",
      headers: CROSS_SITE_FORM,
      body: params.toString(),
    });
    expect(attack.location ?? "").not.toContain("code=");
    expect(reachesTheClient(attack.location)).toBe(false);
    expect(attack.status).toBe(404);
  });

  it("leaves nothing to redeem: no code, so no access token and no refresh token", async () => {
    const { origin, clientId, verifier, params } = await prepare();
    const attack = await raw(origin, { target: `/authorize//?${params}` });
    const code = attack.location ? new URL(attack.location, origin).searchParams.get("code") : null;
    expect(code).toBeNull();

    const exchanged = await fetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: "0".repeat(64),
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      }),
    });
    expect(exchanged.status).toBe(400);
  });

  it("answers every shape of the path with a login redirect or 404, never a redirect to the client", async () => {
    const { origin, params } = await prepare();
    const targets = [
      "/authorize",
      "/authorize/",
      "/authorize//",
      "/authorize///",
      "/Authorize",
      "/AUTHORIZE/",
      "/AUTHORIZE//",
      "/authorize/.",
      "/authorize//.",
      "/authorize/%2e",
      "/authorize;a=b",
      "//authorize",
      "/./authorize",
      "/x/../authorize",
      "/authorize%2f",
      "/%61uthorize",
      "/authorize%00",
      "/authorize.json",
      "/authorize/x",
      "/authorize//x",
      "/authorize/%2f",
      "/authorize/%5c",
      "/authorize/;/",
      "/authorize/ /",
    ];
    for (const target of targets) {
      for (const method of ["GET", "HEAD"]) {
        const response = await raw(origin, { method, target: `${target}?${params}` });
        expect(reachesTheClient(response.location), `${method} ${target}`).toBe(false);
        expect(response.location ?? "", `${method} ${target}`).not.toContain("code=");
      }
      const post = await raw(origin, {
        method: "POST",
        target,
        headers: CROSS_SITE_FORM,
        body: params.toString(),
      });
      expect(reachesTheClient(post.location), `POST ${target}`).toBe(false);
      expect(post.location ?? "", `POST ${target}`).not.toContain("code=");
    }
  });

  it("sends only the exact path on to the SDK router: variants are 404 there", async () => {
    const { origin, params } = await prepare();
    for (const target of ["/authorize//", "/authorize///", "/authorize/.", "/authorize/x", "/authorize/%2e"]) {
      const response = await raw(origin, { target: `${target}?${params}` });
      expect(response.status, target).toBe(404);
    }
  });

  it("answers an absolute-form request target without issuing a code", async () => {
    const { origin, params } = await prepare();
    const response = await raw(origin, { target: `http://127.0.0.1/authorize//?${params}` });
    expect(response.location ?? "").not.toContain("code=");
  });

  it("does not issue a code through a variant path even to a signed-in operator", async () => {
    const { origin, params } = await prepare();
    await saveToken({
      fbUserId: OPERATOR_ID,
      name: "personal",
      accessToken: "synthetic-access-token-value",
      kind: "user",
      expiresAt: null,
      metaUserId: OPERATOR_ID,
      metaUserName: "Synthetic",
      setAsDefault: true,
    });
    let cookie = "";
    await setSession(
      { cookie: (name: string, value: string) => (cookie = `${name}=${value}`) } as never,
      { fbUserId: OPERATOR_ID, email: null, name: "Synthetic Operator" },
    );
    for (const target of ["/authorize/", "/AUTHORIZE", "/authorize//", "/authorize/."]) {
      const response = await raw(origin, {
        method: "POST",
        target,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
        body: new URLSearchParams({ ...Object.fromEntries(params), token: "personal" }).toString(),
      });
      expect(response.status, target).toBe(404);
      expect(response.location ?? "", target).not.toContain("code=");
    }
  });

  it("still lets the logged-in operator approve through the real consent form", async () => {
    const { origin, clientId, verifier, params } = await prepare();
    await saveToken({
      fbUserId: OPERATOR_ID,
      name: "personal",
      accessToken: "synthetic-access-token-value",
      kind: "user",
      expiresAt: null,
      metaUserId: OPERATOR_ID,
      metaUserName: "Synthetic",
      setAsDefault: true,
    });
    let cookie = "";
    await setSession(
      { cookie: (name: string, value: string) => (cookie = `${name}=${value}`) } as never,
      { fbUserId: OPERATOR_ID, email: null, name: "Synthetic Operator" },
    );

    const consent = await fetch(`${origin}/authorize?${params}`, { headers: { cookie } });
    expect(consent.status).toBe(200);

    const approved = await fetch(`${origin}/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({ ...Object.fromEntries(params), token: "personal" }),
      redirect: "manual",
    });
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get("location")!).searchParams.get("code");
    expect(code).toBeTruthy();

    const exchanged = await fetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: code!,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      }),
    });
    expect(exchanged.status).toBe(200);
  });
});
