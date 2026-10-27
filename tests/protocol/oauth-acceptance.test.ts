/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC and OAuth payloads are inspected structurally by the assertions */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Browser,
  CHATGPT_CLIENT_METADATA,
  CHATGPT_REDIRECT,
  CLAUDE_CLIENT_METADATA,
  CLAUDE_REDIRECT,
  FB_USER_ID,
  INITIALIZE_BODY,
  MCP_RESOURCE,
  META_APP_ID,
  PRM_URL,
  SERVER_URL,
  SHORT_LIVED_META_TOKEN,
  STORED_META_TOKEN,
  authorizeQuery,
  bootServer,
  callTool,
  completeOAuthFlow,
  createMetaLoginState,
  forgeAccessToken,
  hiddenFields,
  listTools,
  mcpPost,
  nextClientAddress,
  obtainAuthorizationCode,
  pkcePair,
  registerClient,
  tokenRequest,
  toolText,
  type Harness,
  type RegisteredClient,
} from "./harness.js";
import { deleteToken, saveToken } from "../../src/store/meta-token-repo.js";

let h: Harness;

beforeAll(async () => {
  h = await bootServer();
});

afterEach(() => {
  expect(h.upstream.blocked, "nothing may leave the process except to the fake Graph host").toEqual([]);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function optIntoChatGpt(): void {
  vi.stubEnv("OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS", "chatgpt.com");
}

afterAll(async () => {
  await h.close();
});

const EXPECTED_CHALLENGE = (token: string): string =>
  `Bearer error="invalid_token", error_description="${token}", resource_metadata="${PRM_URL}"`;

describe("authorization server and protected resource metadata", () => {
  it("publishes RFC 8414 metadata for the configured issuer with S256 as the only PKCE method", async () => {
    const response = await fetch(h.origin + "/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const metadata = (await response.json()) as Record<string, any>;

    expect(metadata.issuer).toBe(`${SERVER_URL}/`);
    expect(metadata.authorization_endpoint).toBe(`${SERVER_URL}/authorize`);
    expect(metadata.token_endpoint).toBe(`${SERVER_URL}/token`);
    expect(metadata.registration_endpoint).toBe(`${SERVER_URL}/register`);
    expect(metadata.revocation_endpoint).toBe(`${SERVER_URL}/revoke`);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.response_types_supported).toEqual(["code"]);
    expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(metadata.token_endpoint_auth_methods_supported).toContain("none");
    for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
      expect(new URL(metadata[key]).origin, key).toBe(new URL(SERVER_URL).origin);
      expect(new URL(metadata[key]).protocol, key).toBe("https:");
    }
  });

  it("publishes RFC 9728 protected resource metadata whose resource is <SERVER_URL>/mcp and whose issuer matches", async () => {
    const response = await fetch(h.origin + "/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    const resource = (await response.json()) as Record<string, any>;
    const server = (await (await fetch(h.origin + "/.well-known/oauth-authorization-server")).json()) as Record<string, any>;

    expect(resource.resource).toBe(MCP_RESOURCE);
    expect(resource.authorization_servers).toEqual([server.issuer]);
    expect(PRM_URL).toBe(`${SERVER_URL}/.well-known/oauth-protected-resource/mcp`);
  });

  it("keeps discovery documents readable from the claude.ai and chatgpt.com origins", async () => {
    for (const origin of ["https://claude.ai", "https://chatgpt.com"]) {
      for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp"]) {
        const response = await fetch(h.origin + path, { headers: { origin } });
        expect(response.status, `${origin} ${path}`).toBe(200);
        expect(response.headers.get("access-control-allow-origin"), `${origin} ${path}`).toBe("*");
      }
    }
  });

  it("sets the baseline security headers and does not advertise the framework", async () => {
    const response = await fetch(h.origin + "/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-powered-by")).toBeNull();
  });
});

describe("dynamic client registration (RFC 7591)", () => {
  it.each([
    ["Claude-shaped", CLAUDE_CLIENT_METADATA, CLAUDE_REDIRECT],
    ["ChatGPT-shaped", CHATGPT_CLIENT_METADATA, CHATGPT_REDIRECT],
  ])("registers a %s public client", async (_label, metadata, redirect) => {
    if (redirect === CHATGPT_REDIRECT) optIntoChatGpt();
    const registration = await registerClient(h.origin, metadata);
    expect(registration.status).toBe(201);
    expect(registration.headers.get("cache-control")).toBe("no-store");
    expect(typeof registration.body.client_id).toBe("string");
    expect(registration.body.redirect_uris).toEqual([redirect]);
    expect(registration.body.token_endpoint_auth_method).toBe("none");
    expect(registration.body).not.toHaveProperty("client_secret");
  });

  it("refuses the ChatGPT-shaped client until the operator opts chatgpt.com in", async () => {
    const registration = await registerClient(h.origin, CHATGPT_CLIENT_METADATA);
    expect(registration.status).toBe(400);
    expect(registration.body.error).toBe("invalid_redirect_uri");
  });

  it("issues a secret only to clients that ask for client_secret_post", async () => {
    const registration = await registerClient(h.origin, { ...CLAUDE_CLIENT_METADATA, token_endpoint_auth_method: "client_secret_post" });
    expect(registration.status).toBe(201);
    expect(typeof registration.body.client_secret).toBe("string");
    expect(registration.body.client_secret_expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects registrations without redirect URIs and script-scheme redirects", async () => {
    const missing = await registerClient(h.origin, { client_name: "no redirects" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_client_metadata");

    const script = await registerClient(h.origin, { ...CLAUDE_CLIENT_METADATA, redirect_uris: ["javascript:alert(1)"] });
    expect(script.status).toBe(400);
    expect(script.body.error).toBe("invalid_client_metadata");
  });

  it("caps pre-authentication JSON bodies", async () => {
    const response = await fetch(h.origin + "/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextClientAddress() },
      body: JSON.stringify({ ...CLAUDE_CLIENT_METADATA, client_name: "x".repeat(150_000) }),
    });
    expect(response.status).toBe(413);
  });

  it("throttles registrations from one address", async () => {
    const address = nextClientAddress();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 22; attempt += 1) {
      statuses.push((await registerClient(h.origin, CLAUDE_CLIENT_METADATA, address)).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 201)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  it("lets a registered loopback redirect use any port (RFC 8252 7.3) but never another path", async () => {
    const registration = await registerClient(h.origin, {
      client_name: "Native loopback client",
      redirect_uris: ["http://127.0.0.1:53682/callback"],
      token_endpoint_auth_method: "none",
    });
    const clientId = registration.body.client_id as string;
    const { challenge } = pkcePair();
    const exact = await new Browser(h.origin).get("/authorize?" + authorizeQuery({ clientId, redirectUri: "http://127.0.0.1:53682/callback", challenge }));
    expect(exact.status).toBe(302);
    expect(exact.headers.get("location")).toMatch(/^\/auth\/meta\?return=/);

    const otherPort = await new Browser(h.origin).get("/authorize?" + authorizeQuery({ clientId, redirectUri: "http://127.0.0.1:61000/callback", challenge }));
    expect(otherPort.status).toBe(302);
    expect(otherPort.headers.get("location")).toMatch(/^\/auth\/meta\?return=/);

    const otherPath = await new Browser(h.origin).get("/authorize?" + authorizeQuery({ clientId, redirectUri: "http://127.0.0.1:61000/elsewhere", challenge }));
    expect(otherPath.status).toBe(400);
    expect(otherPath.headers.get("location")).toBeNull();
  });
});

describe("authorization code + PKCE, end to end through the Meta login hops", () => {
  it("walks register -> /authorize -> Meta login -> consent -> code -> token -> MCP for a Claude-shaped client", async () => {
    const registration = await registerClient(h.origin, CLAUDE_CLIENT_METADATA);
    const client = registration.body as unknown as RegisteredClient;
    const { verifier, challenge } = pkcePair();
    const state = "state-" + randomBytes(6).toString("hex");
    const query = authorizeQuery({ clientId: client.client_id, redirectUri: CLAUDE_REDIRECT, challenge, state });
    const browser = new Browser(h.origin);

    const unauthenticated = await browser.get("/authorize?" + query);
    expect(unauthenticated.status).toBe(302);
    const toMeta = unauthenticated.headers.get("location")!;
    expect(toMeta.startsWith("/auth/meta?return=")).toBe(true);
    expect(decodeURIComponent(toMeta.slice("/auth/meta?return=".length))).toBe("/authorize?" + query);

    const metaStart = await browser.get(toMeta);
    expect(metaStart.status).toBe(302);
    const dialog = new URL(metaStart.headers.get("location")!);
    expect(dialog.origin).toBe("https://www.facebook.com");
    expect(dialog.searchParams.get("client_id")).toBe(META_APP_ID);
    expect(dialog.searchParams.get("redirect_uri")).toBe(`${SERVER_URL}/auth/meta/callback`);
    expect(dialog.searchParams.get("response_type")).toBe("code");
    expect(dialog.searchParams.get("state")).toBeTruthy();
    const stateCookie = metaStart.headers.getSetCookie().find((line) => line.startsWith("meta_oauth_state="));
    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);

    const callback = await browser.get(`/auth/meta/callback?code=synthetic-meta-code&state=${encodeURIComponent(dialog.searchParams.get("state")!)}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/authorize?" + query);
    const sessionCookie = callback.headers.getSetCookie().find((line) => line.startsWith("mcp_session="));
    expect(sessionCookie).toMatch(/HttpOnly/i);

    const consent = await browser.get("/authorize?" + query);
    expect(consent.status).toBe(200);
    expect(consent.headers.get("cache-control")).toBe("no-store");
    expect(consent.headers.get("content-security-policy")).toContain("form-action 'self' https://claude.ai");
    const page = await consent.text();
    expect(page).toContain("Claude");
    expect(page).toContain("https://claude.ai");
    expect(page).toContain("Ad creation and changes are disabled on this service");

    const approve = await browser.postForm("/authorize", { ...hiddenFields(page, "approve-form"), token: "personal" });
    expect(approve.status).toBe(302);
    const redirect = new URL(approve.headers.get("location")!);
    expect(redirect.origin + redirect.pathname).toBe(CLAUDE_REDIRECT);
    expect(redirect.searchParams.get("state")).toBe(state);
    const code = redirect.searchParams.get("code")!;
    expect(code).toMatch(/^[0-9a-f]{64}$/);

    const exchanged = await tokenRequest(h.origin, {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_REDIRECT,
      resource: MCP_RESOURCE,
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("cache-control")).toBe("no-store");
    expect(exchanged.body.token_type).toMatch(/^bearer$/i);
    expect(exchanged.body.expires_in).toBe(3600);
    expect(typeof exchanged.body.refresh_token).toBe("string");
    const accessToken = exchanged.body.access_token as string;

    const serialized = JSON.stringify(exchanged.body);
    expect(serialized).not.toContain(STORED_META_TOKEN);
    expect(serialized).not.toContain(SHORT_LIVED_META_TOKEN);

    const initialize = await mcpPost(h.origin, accessToken, INITIALIZE_BODY);
    expect(initialize.status).toBe(200);
    expect(initialize.headers.get("content-type")).toContain("text/event-stream");
    expect(initialize.json?.result.serverInfo.name).toBe("meta-ads-mcp");
    expect(initialize.json?.result.capabilities.tools).toBeDefined();

    const initialized = await mcpPost(h.origin, accessToken, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(initialized.status).toBe(202);
    expect(initialized.text).toBe("");

    h.upstream.reset();
    const tools = await listTools(h.origin, accessToken);
    expect(tools.length).toBeGreaterThan(30);
    expect(tools.find((tool) => tool.name === "ads_get_ad_accounts")).toBeDefined();

    const call = await callTool(h.origin, accessToken, "ads_get_ad_accounts", {});
    expect(call.status).toBe(200);
    expect(call.json?.result.isError).not.toBe(true);
    expect(toolText(call)).toContain("Synthetic acceptance ad account");
    expect(toolText(call)).not.toContain(STORED_META_TOKEN);
    expect(toolText(call)).not.toContain(accessToken);

    const graph = h.upstream.graphCalls();
    expect(graph).toHaveLength(1);
    expect(graph[0].method).toBe("GET");
    expect(graph[0].url.pathname).toMatch(/\/me\/adaccounts$/);
    expect(graph[0].url.searchParams.get("access_token")).toBe(STORED_META_TOKEN);
    expect(JSON.stringify([...graph[0].headers.entries()])).not.toContain(accessToken);
  });

  it("completes the same flow for a ChatGPT-shaped client and returns the code to the ChatGPT redirect", async () => {
    optIntoChatGpt();
    const flow = await completeOAuthFlow(h.origin, { clientMetadata: CHATGPT_CLIENT_METADATA });
    expect(flow.redirectUri).toBe(CHATGPT_REDIRECT);
    const initialize = await mcpPost(h.origin, flow.tokens.access_token, INITIALIZE_BODY);
    expect(initialize.status).toBe(200);
    expect((await listTools(h.origin, flow.tokens.access_token)).length).toBeGreaterThan(30);
  });

  it("rotates refresh tokens, refuses replay and honours revocation", async () => {
    const flow = await completeOAuthFlow(h.origin);
    const refreshed = await tokenRequest(h.origin, {
      grant_type: "refresh_token",
      client_id: flow.client.client_id,
      refresh_token: flow.tokens.refresh_token,
      resource: MCP_RESOURCE,
    });
    expect(refreshed.status).toBe(200);
    const next = refreshed.body as unknown as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(flow.tokens.refresh_token);
    expect((await mcpPost(h.origin, next.access_token, INITIALIZE_BODY)).status).toBe(200);

    const replay = await tokenRequest(h.origin, { grant_type: "refresh_token", client_id: flow.client.client_id, refresh_token: flow.tokens.refresh_token });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");

    const otherClient = (await registerClient(h.origin, CLAUDE_CLIENT_METADATA)).body as unknown as RegisteredClient;
    const stolen = await tokenRequest(h.origin, { grant_type: "refresh_token", client_id: otherClient.client_id, refresh_token: next.refresh_token });
    expect(stolen.status).toBe(400);
    expect(stolen.body.error).toBe("invalid_grant");

    const revoke = await fetch(h.origin + "/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": nextClientAddress() },
      body: new URLSearchParams({ client_id: flow.client.client_id, token: next.refresh_token }),
    });
    expect(revoke.status).toBe(200);
    const afterRevoke = await tokenRequest(h.origin, { grant_type: "refresh_token", client_id: flow.client.client_id, refresh_token: next.refresh_token });
    expect(afterRevoke.status).toBe(400);
    expect(afterRevoke.body.error).toBe("invalid_grant");
  });

  it("binds the token to the MCP resource whether or not the client sends RFC 8707 resource", async () => {
    const withoutResource = await completeOAuthFlow(h.origin, { resource: null });
    expect((await mcpPost(h.origin, withoutResource.tokens.access_token, INITIALIZE_BODY)).status).toBe(200);

    const mismatched = await obtainAuthorizationCode(h.origin, { resource: "https://other.example.com/mcp" });
    const response = await tokenRequest(h.origin, {
      grant_type: "authorization_code",
      client_id: mismatched.client.client_id,
      code: mismatched.code,
      code_verifier: mismatched.verifier,
      redirect_uri: mismatched.redirectUri,
      resource: MCP_RESOURCE,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_grant");
  });

  it("returns authorization errors to the registered redirect, never a code", async () => {
    const registration = (await registerClient(h.origin, CLAUDE_CLIENT_METADATA)).body as unknown as RegisteredClient;
    const browser = new Browser(h.origin);
    await createMetaLoginState(browser);
    const { challenge } = pkcePair();
    const base = {
      client_id: registration.client_id,
      redirect_uri: CLAUDE_REDIRECT,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "caller-state",
      resource: MCP_RESOURCE,
      token: "personal",
    };
    for (const [label, override] of [
      ["plain PKCE", { code_challenge_method: "plain" }],
      ["no PKCE challenge", { code_challenge: "" }],
      ["implicit grant", { response_type: "token" }],
    ] as const) {
      const body = { ...base, ...override } as Record<string, string>;
      if (label === "no PKCE challenge") delete body.code_challenge;
      const response = await browser.postForm("/authorize", body);
      expect(response.status, label).toBe(302);
      const location = new URL(response.headers.get("location")!);
      expect(location.origin + location.pathname, label).toBe(CLAUDE_REDIRECT);
      expect(location.searchParams.get("error"), label).toBe("invalid_request");
      expect(location.searchParams.has("code"), label).toBe(false);
    }
  });

  it("never redirects to an unregistered redirect_uri or for an unknown client", async () => {
    const registration = (await registerClient(h.origin, CLAUDE_CLIENT_METADATA)).body as unknown as RegisteredClient;
    const browser = new Browser(h.origin);
    await createMetaLoginState(browser);
    const { challenge } = pkcePair();

    const getAttacker = await browser.get("/authorize?" + authorizeQuery({ clientId: registration.client_id, redirectUri: "https://attacker.example/cb", challenge }));
    expect(getAttacker.status).toBe(400);
    expect(getAttacker.headers.get("location")).toBeNull();

    const getUnknown = await browser.get("/authorize?" + authorizeQuery({ clientId: "no-such-client", redirectUri: CLAUDE_REDIRECT, challenge }));
    expect(getUnknown.status).toBe(400);
    expect(getUnknown.headers.get("location")).toBeNull();

    const post = await browser.postForm("/authorize", {
      client_id: registration.client_id,
      redirect_uri: "https://attacker.example/cb",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      token: "personal",
    });
    expect(post.status).toBe(400);
    expect(post.headers.get("location")).toBeNull();
  });

  it("refuses to issue a code without an authenticated Meta session", async () => {
    const registration = (await registerClient(h.origin, CLAUDE_CLIENT_METADATA)).body as unknown as RegisteredClient;
    const { challenge } = pkcePair();
    const response = await new Browser(h.origin).postForm("/authorize", {
      client_id: registration.client_id,
      redirect_uri: CLAUDE_REDIRECT,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects a Meta callback with a missing or foreign state nonce", async () => {
    const registration = (await registerClient(h.origin, CLAUDE_CLIENT_METADATA)).body as unknown as RegisteredClient;
    const { challenge } = pkcePair();
    const query = authorizeQuery({ clientId: registration.client_id, redirectUri: CLAUDE_REDIRECT, challenge });
    const victim = new Browser(h.origin);
    const start = await victim.get(`/auth/meta?return=${encodeURIComponent("/authorize?" + query)}`);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;

    const attacker = new Browser(h.origin);
    const forged = await attacker.get(`/auth/meta/callback?code=synthetic-meta-code&state=${encodeURIComponent(state)}`);
    expect(forged.status).toBe(400);
    expect(forged.headers.getSetCookie().some((line) => line.startsWith("mcp_session=") && !/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line))).toBe(false);
  });
});

describe("authorization code and PKCE enforcement at /token", () => {
  async function exchange(
    issued: Awaited<ReturnType<typeof obtainAuthorizationCode>>,
    override: Record<string, string | undefined> = {},
  ) {
    const fields: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: issued.client.client_id,
      code: issued.code,
      code_verifier: issued.verifier,
      redirect_uri: issued.redirectUri,
      resource: MCP_RESOURCE,
    };
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) delete fields[key];
      else fields[key] = value;
    }
    return tokenRequest(h.origin, fields);
  }

  it("rejects a PKCE verifier that does not match the challenge", async () => {
    const issued = await obtainAuthorizationCode(h.origin);
    const wrong = await exchange(issued, { code_verifier: pkcePair().verifier });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("invalid_grant");
    expect(wrong.body).not.toHaveProperty("access_token");
  });

  it("rejects a token request that omits the PKCE verifier", async () => {
    const issued = await obtainAuthorizationCode(h.origin);
    const missing = await exchange(issued, { code_verifier: undefined });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_request");
    expect(missing.body).not.toHaveProperty("access_token");
  });

  it("accepts the code once and rejects the replay", async () => {
    const issued = await obtainAuthorizationCode(h.origin);
    expect((await exchange(issued)).status).toBe(200);
    const replay = await exchange(issued);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
  });

  it("rejects a code presented by a different client or with a different redirect_uri", async () => {
    const issued = await obtainAuthorizationCode(h.origin);
    optIntoChatGpt();
    const other = (await registerClient(h.origin, CHATGPT_CLIENT_METADATA)).body as unknown as RegisteredClient;
    const crossClient = await exchange(issued, { client_id: other.client_id });
    expect(crossClient.status).toBe(400);
    expect(crossClient.body.error).toBe("invalid_grant");

    const redirectMismatch = await exchange(issued, { redirect_uri: "https://claude.ai/api/mcp/other_callback" });
    expect(redirectMismatch.status).toBe(400);
    expect(redirectMismatch.body.error).toBe("invalid_grant");
  });

  it("rejects an authorization code after its ten minute lifetime", async () => {
    const issued = await obtainAuthorizationCode(h.origin);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 11 * 60 * 1000 });
    const expired = await exchange(issued);
    expect(expired.status).toBe(400);
    expect(expired.body.error).toBe("invalid_grant");
  });

  it("lets exactly one of two concurrent redemptions of the same code succeed", async () => {
    const issued = await obtainAuthorizationCode(h.origin);
    const results = await Promise.all([exchange(issued), exchange(issued)]);
    expect(results.map((entry) => entry.status).sort()).toEqual([200, 400]);
  });

  it("lets exactly one of two concurrent uses of the same refresh token succeed", async () => {
    const flow = await completeOAuthFlow(h.origin);
    const refresh = () =>
      tokenRequest(h.origin, { grant_type: "refresh_token", client_id: flow.client.client_id, refresh_token: flow.tokens.refresh_token });
    const results = await Promise.all([refresh(), refresh()]);
    expect(results.map((entry) => entry.status).sort()).toEqual([200, 400]);
  });

  it("rejects unsupported grant types", async () => {
    const issued = await obtainAuthorizationCode(h.origin);
    const response = await tokenRequest(h.origin, { grant_type: "client_credentials", client_id: issued.client.client_id });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unsupported_grant_type");
  });
});

describe("bearer enforcement on /mcp (RFC 6750 / RFC 9728)", () => {
  it("answers unauthenticated POST, GET and DELETE with a 401 whose challenge names the resource metadata URL", async () => {
    for (const method of ["POST", "GET", "DELETE"]) {
      const response = await fetch(h.origin + "/mcp", {
        method,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: method === "POST" ? JSON.stringify(INITIALIZE_BODY) : undefined,
      });
      expect(response.status, method).toBe(401);
      expect(response.headers.get("www-authenticate"), method).toBe(EXPECTED_CHALLENGE("Missing Authorization header"));
      expect(await response.json(), method).toMatchObject({ error: "invalid_token" });
    }
  });

  it("does not accept a token supplied in the query string", async () => {
    const flow = await completeOAuthFlow(h.origin);
    const response = await fetch(`${h.origin}/mcp?access_token=${flow.tokens.access_token}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${PRM_URL}"`);
  });

  it("accepts the Bearer scheme case-insensitively and rejects other schemes", async () => {
    const flow = await completeOAuthFlow(h.origin);
    expect((await mcpPost(h.origin, undefined, INITIALIZE_BODY, { authorization: `bearer ${flow.tokens.access_token}` })).status).toBe(200);
    for (const header of ["Basic dXNlcjpwYXNz", "Bearer", `Token ${flow.tokens.access_token}`]) {
      const reply = await mcpPost(h.origin, undefined, INITIALIZE_BODY, { authorization: header });
      expect(reply.status, header).toBe(401);
      expect(reply.headers.get("www-authenticate"), header).toContain(`resource_metadata="${PRM_URL}"`);
    }
  });

  it("rejects garbage, tampered, unsigned, foreign-signed, expired, wrong-audience and wrong-type tokens", async () => {
    const flow = await completeOAuthFlow(h.origin);
    const good = flow.tokens.access_token;
    const [head, body, signature] = good.split(".");
    const flipped = signature.slice(0, -2) + (signature.endsWith("AA") ? "BB" : "AA");
    const unsigned = [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
      body,
      "",
    ].join(".");
    const foreignSecret = randomBytes(32).toString("hex");
    const cases: Record<string, string> = {
      "not a JWT": "not-a-jwt",
      "empty segments": "..",
      "tampered signature": `${head}.${body}.${flipped}`,
      "alg none": unsigned,
      "signed with another secret": await forgeAccessToken({ secret: foreignSecret }),
      "expired": await forgeAccessToken({ expiresInSeconds: -120 }),
      "refresh audience": await forgeAccessToken({ audience: "mcp-oauth-refresh" }),
      "unrelated audience": await forgeAccessToken({ audience: "https://other.example.com" }),
      "type refresh": await forgeAccessToken({ type: "refresh" }),
      "the refresh token itself": flow.tokens.refresh_token,
    };
    h.upstream.reset();
    for (const [label, token] of Object.entries(cases)) {
      const reply = await mcpPost(h.origin, token, INITIALIZE_BODY);
      expect(reply.status, label).toBe(401);
      expect(reply.headers.get("www-authenticate"), label).toContain(`resource_metadata="${PRM_URL}"`);
      expect(reply.headers.get("www-authenticate"), label).toContain('error="invalid_token"');
      expect(reply.text, label).not.toContain("tools");
    }
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("rejects a genuine token that was issued for a different resource", async () => {
    const other = await completeOAuthFlow(h.origin, { resource: "https://other.example.com/mcp" });
    const reply = await mcpPost(h.origin, other.tokens.access_token, INITIALIZE_BODY);
    expect(reply.status).toBe(401);
    expect(reply.headers.get("www-authenticate")).toContain("Token was not issued for this resource");
    expect(reply.headers.get("www-authenticate")).toContain(`resource_metadata="${PRM_URL}"`);
  });

  it("expires access tokens after their one hour lifetime", async () => {
    const flow = await completeOAuthFlow(h.origin);
    expect((await mcpPost(h.origin, flow.tokens.access_token, INITIALIZE_BODY)).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61 * 60 * 1000 });
    const reply = await mcpPost(h.origin, flow.tokens.access_token, INITIALIZE_BODY);
    expect(reply.status).toBe(401);
    expect(reply.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("refuses the X-Meta-Token override in agency mode, even when empty, and never calls Meta", async () => {
    const flow = await completeOAuthFlow(h.origin);
    const call = { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "ads_get_ad_accounts", arguments: {} } };
    h.upstream.reset();
    expect((await mcpPost(h.origin, flow.tokens.access_token, call)).status).toBe(200);
    expect(h.upstream.graphCalls()).toHaveLength(1);
    expect(h.upstream.graphCalls()[0].url.searchParams.get("access_token")).toBe(STORED_META_TOKEN);

    h.upstream.reset();
    for (const value of ["synthetic-override-token", ""]) {
      const reply = await mcpPost(h.origin, flow.tokens.access_token, call, { "x-meta-token": value });
      expect(reply.status, JSON.stringify(value)).toBe(403);
      expect(reply.json).toEqual({ error: "Header token overrides are disabled in agency mode" });
    }
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("does not let X-API-Key stand in for OAuth when no API key is configured", async () => {
    const reply = await mcpPost(h.origin, undefined, INITIALIZE_BODY, { "x-api-key": "synthetic-api-key" });
    expect(reply.status).toBe(401);
    expect(reply.headers.get("www-authenticate")).toContain(`resource_metadata="${PRM_URL}"`);
  });

  it("answers a valid MCP token with no stored Meta token by asking the user to reconnect", async () => {
    const flow = await completeOAuthFlow(h.origin);
    h.upstream.reset();
    try {
      expect(await deleteToken(FB_USER_ID, "personal")).toBe(true);
      const reply = await callTool(h.origin, flow.tokens.access_token, "ads_get_ad_accounts", {});
      expect(reply.status).toBe(401);
      expect(reply.headers.get("www-authenticate")).toContain(`resource_metadata="${PRM_URL}"`);
      expect(reply.json?.error.message).toBe("No Meta token connected for this user. Reconnect via /authorize.");
      expect(h.upstream.graphCalls()).toHaveLength(0);
    } finally {
      await saveToken({
        fbUserId: FB_USER_ID,
        name: "personal",
        accessToken: STORED_META_TOKEN,
        kind: "user",
        expiresAt: Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
        metaUserId: FB_USER_ID,
        metaUserName: "Synthetic Agency Operator",
        setAsDefault: true,
      });
    }
  });

  it("refuses a validly signed token that carries no Meta user identity", async () => {
    const anonymous = await forgeAccessToken({ fbUserId: null });
    h.upstream.reset();
    const reply = await mcpPost(h.origin, anonymous, INITIALIZE_BODY);
    expect(reply.status).toBe(401);
    expect(reply.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(reply.headers.get("www-authenticate")).toContain("Access token is not bound to an operator");
    expect(reply.headers.get("www-authenticate")).toContain(`resource_metadata="${PRM_URL}"`);
    expect(reply.text).not.toContain("tools");
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });
});

describe("Streamable HTTP semantics (stateless POST endpoint)", () => {
  it("negotiates the protocol version and validates the MCP-Protocol-Version header", async () => {
    const flow = await completeOAuthFlow(h.origin);
    const token = flow.tokens.access_token;
    const oldClient = await mcpPost(h.origin, token, { ...INITIALIZE_BODY, params: { ...INITIALIZE_BODY.params, protocolVersion: "1999-01-01" } });
    expect(oldClient.status).toBe(200);
    expect(oldClient.json?.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(oldClient.json?.result.protocolVersion).not.toBe("1999-01-01");

    const list = { jsonrpc: "2.0", id: 5, method: "tools/list" };
    expect((await mcpPost(h.origin, token, list, { "mcp-protocol-version": "2025-06-18" })).status).toBe(200);
    expect((await mcpPost(h.origin, token, list, { "mcp-protocol-version": "2025-03-26" })).status).toBe(200);
    const unsupported = await mcpPost(h.origin, token, list, { "mcp-protocol-version": "1999-01-01" });
    expect(unsupported.status).toBe(400);
    expect(unsupported.json?.error.message).toContain("Unsupported protocol version");
  });

  it("applies POST semantics: 406 without both Accept types, 415 for wrong content type, 202 for notifications, JSON-RPC errors for unknown methods", async () => {
    const flow = await completeOAuthFlow(h.origin);
    const auth = { authorization: `Bearer ${flow.tokens.access_token}` };

    const noAccept = await fetch(h.origin + "/mcp", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(INITIALIZE_BODY) });
    expect(noAccept.status).toBe(406);
    const jsonOnly = await fetch(h.origin + "/mcp", { method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(INITIALIZE_BODY) });
    expect(jsonOnly.status).toBe(406);

    const wrongType = await fetch(h.origin + "/mcp", { method: "POST", headers: { ...auth, "content-type": "text/plain", accept: "application/json, text/event-stream" }, body: "x" });
    expect(wrongType.status).toBe(415);

    const notification = await mcpPost(h.origin, flow.tokens.access_token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification.status).toBe(202);
    expect(notification.text).toBe("");

    const unknown = await mcpPost(h.origin, flow.tokens.access_token, { jsonrpc: "2.0", id: 6, method: "nope/nope" });
    expect(unknown.status).toBe(200);
    expect(unknown.json?.error.code).toBe(-32601);
    expect(unknown.json?.id).toBe(6);
  });

  it("is stateless: no session id is issued and tools/list works without a prior initialize", async () => {
    const flow = await completeOAuthFlow(h.origin);
    const initialize = await mcpPost(h.origin, flow.tokens.access_token, INITIALIZE_BODY);
    expect(initialize.headers.get("mcp-session-id")).toBeNull();
    expect((await listTools(h.origin, flow.tokens.access_token)).length).toBeGreaterThan(30);
  });

  it("answers GET and DELETE on /mcp with 405 for authenticated callers (no SSE stream offered)", async () => {
    const flow = await completeOAuthFlow(h.origin);
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(h.origin + "/mcp", { method, headers: { authorization: `Bearer ${flow.tokens.access_token}`, accept: "text/event-stream" } });
      expect(response.status, method).toBe(405);
      expect(await response.json(), method).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
    }
  });

  it("handles browser preflight for claude.ai and withholds CORS from origins outside the allowlist", async () => {
    const preflight = (origin: string, path = "/mcp") =>
      fetch(h.origin + path, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
      });
    const claude = await preflight("https://claude.ai");
    expect(claude.status).toBe(204);
    expect(claude.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(claude.headers.get("access-control-allow-methods")).toContain("POST");
    expect(claude.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    expect(claude.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");

    for (const origin of ["https://chatgpt.com", "https://attacker.example"]) {
      const denied = await preflight(origin);
      expect(denied.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
    const post = await fetch(h.origin + "/mcp", { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(post.status).toBe(403);
    expect(post.headers.get("access-control-allow-origin")).toBeNull();
    const noOrigin = await fetch(h.origin + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(noOrigin.status).toBe(401);
  });
});
