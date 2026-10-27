/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC and OAuth payloads are inspected structurally by the assertions */
import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer as createMcpServer } from "../../src/server.js";
import { startHttpTransport } from "../../src/transport/http.js";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { resetSecretCacheForTests, setSession } from "../../src/auth/session.js";
import { resetOAuthStateSecretForTests } from "../../src/auth/oauth-state.js";
import { isFirestoreEnabled } from "../../src/store/firestore.js";
import { metaApiClient } from "../../src/meta/client.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import type { PlatformRepository } from "../../src/platform/repository.js";
import { saveToken, upsertUser } from "../../src/store/meta-token-repo.js";

export const SERVER_URL = "https://mcp.lumin-acceptance.example";
export const MCP_RESOURCE = `${SERVER_URL}/mcp`;
export const PRM_URL = `${SERVER_URL}/.well-known/oauth-protected-resource/mcp`;
export const FB_USER_ID = "900000000000001";
export const OTHER_FB_USER_ID = "900000000000002";
export const META_APP_ID = "1000000000000001";
export const STORED_META_TOKEN = "synthetic-long-lived-meta-user-token";
export const SHORT_LIVED_META_TOKEN = "synthetic-short-lived-meta-token";
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
export const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";

const SECRETS = {
  OAUTH_SECRET: randomBytes(32).toString("hex"),
  SESSION_COOKIE_SECRET: randomBytes(32).toString("hex"),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  META_APP_SECRET: randomBytes(16).toString("hex"),
};
export const OAUTH_SIGNING_SECRET = SECRETS.OAUTH_SECRET;

export interface BootOptions {
  writes?: boolean;
  platform?: boolean;
  platformWrites?: boolean;
  corsOrigins?: string;
  platformRepository?: PlatformRepository;
  env?: Record<string, string | undefined>;
}

export interface UpstreamCall {
  method: string;
  url: URL;
  headers: Headers;
  body: string | undefined;
}

export interface GraphReply {
  status?: number;
  body: unknown;
}

export type GraphHandler = (call: UpstreamCall) => GraphReply | undefined;

const API_VERSION_PREFIX = /^\/v\d+\.\d+/;

export class FakeUpstream {
  readonly calls: UpstreamCall[] = [];
  readonly blocked: string[] = [];
  private handler: GraphHandler = () => undefined;
  private realFetch: typeof fetch | undefined;

  setHandler(handler: GraphHandler): void {
    this.handler = handler;
  }

  reset(): void {
    this.calls.length = 0;
    this.blocked.length = 0;
  }

  graphCalls(): UpstreamCall[] {
    return this.calls.filter((call) => call.url.hostname === "graph.facebook.com");
  }

  install(): void {
    if (this.realFetch) return;
    const realFetch = globalThis.fetch;
    this.realFetch = realFetch;
    const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw);
      if (url.hostname === "127.0.0.1") return realFetch(input, init);
      if (url.hostname !== "graph.facebook.com") {
        this.blocked.push(`${init?.method ?? "GET"} ${url.origin}`);
        throw new Error(`Blocked non-loopback egress from acceptance test: ${url.origin}`);
      }
      const bodyText = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : undefined;
      const call: UpstreamCall = {
        method: (init?.method ?? "GET").toUpperCase(),
        url,
        headers: new Headers(init?.headers),
        body: bodyText,
      };
      this.calls.push(call);
      const reply = this.handler(call) ?? defaultGraph(call);
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    };
    globalThis.fetch = guarded as typeof fetch;
  }

  restore(): void {
    if (!this.realFetch) return;
    globalThis.fetch = this.realFetch;
    this.realFetch = undefined;
  }
}

export const FAKE_AD_ACCOUNT = {
  id: "act_101",
  account_id: "101",
  name: "Synthetic acceptance ad account",
  account_status: 1,
  currency: "USD",
  timezone_name: "UTC",
  amount_spent: "1234",
};

function defaultGraph(call: UpstreamCall): GraphReply {
  const path = call.url.pathname.replace(API_VERSION_PREFIX, "");
  if (path === "/oauth/access_token") {
    if (call.url.searchParams.get("grant_type") === "fb_exchange_token") {
      return { body: { access_token: STORED_META_TOKEN, token_type: "bearer", expires_in: 5184000 } };
    }
    return { body: { access_token: SHORT_LIVED_META_TOKEN, token_type: "bearer", expires_in: 3600 } };
  }
  if (path === "/me") {
    return {
      body: {
        id: FB_USER_ID,
        name: "Synthetic Agency Operator",
        email: "operator@lumin-acceptance.example",
        picture: { data: { url: "https://example.invalid/synthetic.png" } },
      },
    };
  }
  if (path === "/me/businesses") return { body: { data: [{ id: "700000000000001", name: "Synthetic Business" }] } };
  if (path === "/me/adaccounts") return { body: { data: [FAKE_AD_ACCOUNT] } };
  if (path === "/act_101") return { body: FAKE_AD_ACCOUNT };
  return { status: 404, body: { error: { message: "Unsupported path in acceptance fake", type: "GraphMethodException", code: 100, fbtrace_id: "ACCEPTANCE" } } };
}

const ENV_DEFAULTS = (opts: BootOptions): Record<string, string | undefined> => ({
  DEPLOYMENT_MODE: "agency",
  AGENCY_WRITES_ENABLED: opts.writes ? "true" : undefined,
  LUMIN_PLATFORM_ENABLED: opts.platform ? "true" : "false",
  LUMIN_PLATFORM_WRITES_ENABLED: opts.platformWrites ? "true" : undefined,
  LUMIN_META_PRIVACY_ENABLED: undefined,
  SERVER_URL,
  META_APP_ID,
  META_APP_SECRET: SECRETS.META_APP_SECRET,
  TOKEN_ENCRYPTION_KEY: SECRETS.TOKEN_ENCRYPTION_KEY,
  SESSION_COOKIE_SECRET: SECRETS.SESSION_COOKIE_SECRET,
  OAUTH_SECRET: SECRETS.OAUTH_SECRET,
  AUTH_ALLOWED_FB_USER_IDS: FB_USER_ID,
  MCP_MAX_IN_FLIGHT: "1000",
  MCP_RATE_LIMIT_PER_MINUTE: "100000",
  AUTH_ALLOWED_EMAILS: undefined,
  AUTH_ALLOWED_DOMAINS: undefined,
  MCP_API_KEY: undefined,
  META_ACCESS_TOKEN: undefined,
  META_TOKENS: undefined,
  APIFY_TOKEN: undefined,
  GEMINI_API_KEY: undefined,
  FIRESTORE_PROJECT_ID: undefined,
  GOOGLE_CLOUD_PROJECT: undefined,
  GOOGLE_CREDENTIALS_JSON: undefined,
  FIRESTORE_EMULATOR_HOST: undefined,
  GOOGLE_APPLICATION_CREDENTIALS: undefined,
  META_OAUTH_REDIRECT_URI: undefined,
  META_LOGIN_CONFIG_ID: undefined,
  CORS_ALLOWED_ORIGINS: opts.corsOrigins,
  ...(opts.env ?? {}),
});

export interface Harness {
  origin: string;
  upstream: FakeUpstream;
  requests: { method: string; path: string }[];
  close(): Promise<void>;
}

export async function bootServer(opts: BootOptions = {}): Promise<Harness> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(ENV_DEFAULTS(opts))) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (isFirestoreEnabled()) throw new Error("Acceptance harness refuses to run with Firestore configured");

  resetOAuthProviderForTests();
  resetSecretCacheForTests();
  resetOAuthStateSecretForTests();
  metaApiClient.resetForTests();
  configurePlatformRepository(opts.platformRepository);

  const upstream = new FakeUpstream();
  upstream.install();

  const signalsBefore = new Map<string, unknown[]>();
  for (const signal of ["SIGTERM", "SIGINT"]) signalsBefore.set(signal, process.listeners(signal as NodeJS.Signals));

  let httpServer: Server | undefined;
  const originalListen = express.application.listen;
  express.application.listen = function patchedListen(this: express.Express) {
    httpServer = createHttpServer(this);
    httpServer.listen(0, "127.0.0.1");
    return httpServer;
  } as typeof express.application.listen;

  try {
    await startHttpTransport((): McpServer => createMcpServer(), 0);
  } finally {
    express.application.listen = originalListen;
  }
  if (!httpServer) throw new Error("HTTP server did not start");
  if (!httpServer.listening) await new Promise<void>((resolve) => httpServer!.once("listening", resolve));
  const origin = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const requests: { method: string; path: string }[] = [];
  httpServer.prependListener("request", (req) => {
    requests.push({ method: req.method ?? "", path: (req.url ?? "").split("?")[0] });
  });

  return {
    origin,
    upstream,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        httpServer!.closeAllConnections();
        httpServer!.close((error) => (error ? reject(error) : resolve()));
      });
      upstream.restore();
      for (const signal of ["SIGTERM", "SIGINT"]) {
        const before = signalsBefore.get(signal) ?? [];
        for (const listener of process.listeners(signal as NodeJS.Signals)) {
          if (!before.includes(listener)) process.removeListener(signal, listener as NodeJS.SignalsListener);
        }
      }
      configurePlatformRepository(undefined);
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

let addressCounter = 1;

/**
 * Distinct client address per flow, honoured because the server runs with
 * "trust proxy" 1. Without it every flow in a file shares one rate-limit bucket.
 */
export function nextClientAddress(): string {
  addressCounter += 1;
  return `10.${(addressCounter >> 8) & 255}.${addressCounter & 255}.7`;
}

export class Browser {
  readonly cookies = new Map<string, string>();
  constructor(
    private readonly origin: string,
    readonly address: string = nextClientAddress(),
  ) {}

  private absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  private cookieHeader(): Record<string, string> {
    if (this.cookies.size === 0) return {};
    return { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
  }

  async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    const response = await fetch(this.origin + path, {
      redirect: "manual",
      headers: { "x-forwarded-for": this.address, ...this.cookieHeader(), ...headers },
    });
    this.absorb(response);
    return response;
  }

  async postForm(path: string, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
    const response = await fetch(this.origin + path, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": this.address, ...this.cookieHeader(), ...headers },
      body: new URLSearchParams(fields),
    });
    this.absorb(response);
    return response;
  }
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  [key: string]: unknown;
}

export async function registerClient(
  origin: string,
  metadata: Record<string, unknown>,
  address: string = nextClientAddress(),
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const response = await fetch(origin + "/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": address },
    body: JSON.stringify(metadata),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers };
}

export const CLAUDE_CLIENT_METADATA = {
  client_name: "Claude",
  redirect_uris: [CLAUDE_REDIRECT],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

export const CHATGPT_CLIENT_METADATA = {
  client_name: "ChatGPT",
  redirect_uris: [CHATGPT_REDIRECT],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

export function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function hiddenFields(html: string, formId: string): Record<string, string> {
  const form = html.match(new RegExp(`<form id="${formId}"[\\s\\S]*?</form>`));
  if (!form) throw new Error(`form ${formId} not found in consent page`);
  const fields: Record<string, string> = {};
  for (const match of form[0].matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"/g)) {
    fields[unescapeHtml(match[1])] = unescapeHtml(match[2]);
  }
  return fields;
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state?: string;
  resource?: string | null;
  extra?: Record<string, string>;
}

export function authorizeQuery(request: AuthorizationRequest): string {
  const query = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: "code",
    code_challenge: request.challenge,
    code_challenge_method: "S256",
    state: request.state ?? "state-" + randomBytes(6).toString("hex"),
    ...request.extra,
  });
  if (request.resource !== null) query.set("resource", request.resource ?? MCP_RESOURCE);
  return query.toString();
}

export interface LoginResult {
  browser: Browser;
  steps: { authorizeStatus: number; metaDialog: URL; callbackStatus: number; callbackLocation: string };
}

/**
 * Drives the real /authorize -> /auth/meta -> /auth/meta/callback hops. Meta's
 * own endpoints are answered by FakeUpstream, so nothing leaves the process.
 */
export async function loginThroughMeta(origin: string, query: string): Promise<LoginResult> {
  const browser = new Browser(origin);
  const authorize = await browser.get("/authorize?" + query);
  const toMeta = authorize.headers.get("location") ?? "";
  const metaStart = await browser.get(toMeta);
  const dialog = new URL(metaStart.headers.get("location") ?? "");
  const callback = await browser.get(
    `/auth/meta/callback?code=synthetic-meta-code&state=${encodeURIComponent(dialog.searchParams.get("state") ?? "")}`,
  );
  return {
    browser,
    steps: {
      authorizeStatus: authorize.status,
      metaDialog: dialog,
      callbackStatus: callback.status,
      callbackLocation: callback.headers.get("location") ?? "",
    },
  };
}

/**
 * Shortcut used where the Meta hop itself is not under test: creates the same
 * stored state the callback creates (user, encrypted token, session cookie) by
 * calling the same modules.
 */
export async function createMetaLoginState(
  browser: Browser,
  options: { fbUserId?: string; token?: string | null } = {},
): Promise<void> {
  const fbUserId = options.fbUserId ?? FB_USER_ID;
  await upsertUser(fbUserId, { id: fbUserId, name: "Synthetic Agency Operator", email: null, pictureUrl: null });
  if (options.token !== null) {
    await saveToken({
      fbUserId,
      name: "personal",
      accessToken: options.token ?? STORED_META_TOKEN,
      kind: "user",
      expiresAt: Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
      metaUserId: fbUserId,
      metaUserName: "Synthetic Agency Operator",
      setAsDefault: true,
    });
  }
  const captured: { value?: string } = {};
  await setSession(
    {
      cookie: (name: string, value: string) => {
        captured.value = `${name}=${value}`;
      },
    } as never,
    { fbUserId, email: null, name: "Synthetic Agency Operator" },
  );
  const [name, ...rest] = (captured.value ?? "").split("=");
  browser.cookies.set(name, rest.join("="));
}

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface FlowOptions {
  clientMetadata?: Record<string, unknown>;
  resource?: string | null;
  tokenResource?: string | null;
  viaMetaLogin?: boolean;
  fbUserId?: string;
}

export interface FlowResult {
  client: RegisteredClient;
  verifier: string;
  challenge: string;
  redirectUri: string;
  code: string;
  state: string;
  tokens: IssuedTokens;
  browser: Browser;
}

export async function tokenRequest(
  origin: string,
  fields: Record<string, string>,
  address: string = nextClientAddress(),
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const response = await fetch(origin + "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": address },
    body: new URLSearchParams(fields),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers };
}

/** Registers a client, signs in, approves consent and returns the authorization code (not yet redeemed). */
export async function obtainAuthorizationCode(
  origin: string,
  options: FlowOptions = {},
): Promise<Omit<FlowResult, "tokens">> {
  const metadata = options.clientMetadata ?? CLAUDE_CLIENT_METADATA;
  const registration = await registerClient(origin, metadata);
  if (registration.status !== 201) throw new Error(`client registration failed: ${registration.status}`);
  const client = registration.body as unknown as RegisteredClient;
  const redirectUri = client.redirect_uris[0];
  const { verifier, challenge } = pkcePair();
  const state = "state-" + randomBytes(6).toString("hex");
  const query = authorizeQuery({ clientId: client.client_id, redirectUri, challenge, state, resource: options.resource });

  let browser: Browser;
  if (options.viaMetaLogin === false) {
    browser = new Browser(origin);
    await createMetaLoginState(browser, { fbUserId: options.fbUserId });
  } else {
    const login = await loginThroughMeta(origin, query);
    if (login.steps.callbackStatus !== 302) throw new Error(`Meta callback failed: ${login.steps.callbackStatus}`);
    browser = login.browser;
  }

  const consent = await browser.get("/authorize?" + query);
  if (consent.status !== 200) throw new Error(`consent page status ${consent.status}`);
  const fields = hiddenFields(await consent.text(), "approve-form");
  const approve = await browser.postForm("/authorize", { ...fields, token: "personal" });
  if (approve.status !== 302) throw new Error(`approve status ${approve.status}`);
  const location = new URL(approve.headers.get("location") ?? "");
  const code = location.searchParams.get("code");
  if (!code) throw new Error("no authorization code in redirect: " + location.search);
  return { client, verifier, challenge, redirectUri, code, state, browser };
}

export async function completeOAuthFlow(origin: string, options: FlowOptions = {}): Promise<FlowResult> {
  const issued = await obtainAuthorizationCode(origin, options);
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: issued.client.client_id,
    code: issued.code,
    code_verifier: issued.verifier,
    redirect_uri: issued.redirectUri,
  };
  const tokenResource = options.tokenResource === undefined ? options.resource : options.tokenResource;
  if (tokenResource !== null) fields.resource = tokenResource ?? MCP_RESOURCE;
  const exchanged = await tokenRequest(origin, fields);
  if (exchanged.status !== 200) throw new Error(`token exchange failed: ${exchanged.status} ${JSON.stringify(exchanged.body)}`);
  return { ...issued, tokens: exchanged.body as unknown as IssuedTokens };
}

export interface McpReply {
  status: number;
  headers: Headers;
  text: string;
  json: Record<string, any> | undefined;
}

export function parseMcpBody(contentType: string, text: string): Record<string, any> | undefined {
  if (!text) return undefined;
  if (contentType.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    return data.length ? JSON.parse(data[data.length - 1]) : undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function mcpPost(
  origin: string,
  token: string | undefined,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<McpReply> {
  const response = await fetch(origin + "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, json: parseMcpBody(response.headers.get("content-type") ?? "", text) };
}

export const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "acceptance-client", version: "1.0.0" },
  },
};

export interface ListedTool {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  inputSchema: any;
  description?: string;
}

export async function listTools(origin: string, token: string): Promise<ListedTool[]> {
  const tools: any[] = [];
  let cursor: string | undefined;
  do {
    const reply = await mcpPost(origin, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: cursor ? { cursor } : {} });
    if (reply.status !== 200 || !reply.json?.result) throw new Error(`tools/list failed: ${reply.status} ${reply.text.slice(0, 200)}`);
    tools.push(...reply.json.result.tools);
    cursor = reply.json.result.nextCursor;
  } while (cursor);
  return tools;
}

export async function callTool(origin: string, token: string, name: string, args: Record<string, unknown>, id = 3): Promise<McpReply> {
  return mcpPost(origin, token, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
}

export async function forgeAccessToken(claims: {
  type?: string;
  audience?: string;
  resource?: string | null;
  expiresInSeconds?: number;
  fbUserId?: string | null;
  secret?: string;
  sub?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { sub: claims.sub ?? "forged-client", type: claims.type ?? "access" };
  if (claims.resource !== null) payload.resource = claims.resource ?? MCP_RESOURCE;
  if (claims.fbUserId !== null) payload.fb_user_id = claims.fbUserId ?? FB_USER_ID;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now - 7200)
    .setAudience(claims.audience ?? "mcp-oauth-access")
    .setExpirationTime(now + (claims.expiresInSeconds ?? 3600))
    .sign(new TextEncoder().encode(claims.secret ?? SECRETS.OAUTH_SECRET));
}

export function toolText(reply: McpReply): string {
  const content = reply.json?.result?.content;
  if (!Array.isArray(content)) return JSON.stringify(reply.json ?? reply.text);
  return content.map((part: { text?: string }) => part.text ?? "").join("\n");
}


/**
 * Lists the tools a server built under the given environment would publish,
 * without HTTP. The environment is applied only while the server is created,
 * which is when the registry decides what is enabled.
 */
export async function listToolsInProcess(
  env: Record<string, string | undefined>,
): Promise<{ name: string; annotations?: { readOnlyHint?: boolean } }[]> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let server: McpServer;
  try {
    server = createMcpServer();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const client = new Client({ name: "acceptance-in-process", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  } finally {
    await client.close();
    await server.close();
  }
}
