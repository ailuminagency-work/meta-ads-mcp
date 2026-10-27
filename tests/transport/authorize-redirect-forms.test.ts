import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { validateAuthorizeQuery } from "../../src/transport/authorize-validation.js";
import {
  approveConsent,
  authorizeParams,
  codeFrom,
  pkce,
  postToken,
  registerClient,
  sessionCookieFor,
  startAuthServer,
  OPERATOR_ID,
  type AuthServer,
} from "./auth-flow-harness.js";
import { saveToken } from "../../src/store/meta-token-repo.js";

const CURSOR_REDIRECT = "cursor://anysphere.cursor-retrieval/oauth/user-lumin/callback";
const VSCODE_REDIRECT = "vscode://vscode.github-authentication/did-authenticate";

function client(redirectUris: string[]): OAuthClientInformationFull {
  return {
    client_id: "synthetic-client",
    client_name: "Synthetic",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: 1,
  };
}

const lookup = (registered: string[]) => async () => client(registered);

describe("validateAuthorizeQuery redirect handling", () => {
  it.each([
    [CURSOR_REDIRECT, "cursor:"],
    [VSCODE_REDIRECT, "vscode:"],
    ["https://claude.ai/api/mcp/auth_callback", "https://claude.ai"],
    ["http://127.0.0.1:33418/", "http://127.0.0.1:33418"],
  ])("gives the consent page's form-action a usable source for %s", async (redirectUri, source) => {
    const result = await validateAuthorizeQuery({ client_id: "synthetic-client", redirect_uri: redirectUri }, lookup([redirectUri]));
    expect(result).toMatchObject({ ok: true, redirectOrigin: source });
  });

  it("accepts any loopback port when the client registered a loopback URI (RFC 8252 section 7.3)", async () => {
    const result = await validateAuthorizeQuery(
      { client_id: "synthetic-client", redirect_uri: "http://127.0.0.1:52000/" },
      lookup(["http://127.0.0.1/"]),
    );
    expect(result).toMatchObject({ ok: true, redirectOrigin: "http://127.0.0.1:52000" });
  });

  it.each([
    ["a different path", "http://127.0.0.1:52000/other", ["http://127.0.0.1/"]],
    ["localhost for 127.0.0.1", "http://localhost:52000/", ["http://127.0.0.1/"]],
    ["another port on a remote https host", "https://claude.ai:8443/api/mcp/auth_callback", ["https://claude.ai/api/mcp/auth_callback"]],
    ["another custom-scheme path", "cursor://anysphere.cursor-retrieval/oauth/other", [CURSOR_REDIRECT]],
    ["a loopback port on a non-loopback registration", "http://evil.example:52000/", ["http://evil.example/"]],
  ])("still rejects %s", async (_label, requested, registered) => {
    const result = await validateAuthorizeQuery({ client_id: "synthetic-client", redirect_uri: requested }, lookup(registered));
    expect(result).toMatchObject({ ok: false, kind: "redirect-mismatch" });
  });
});

describe("the consent page and approval for desktop clients", () => {
  let server: AuthServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function prepare(redirectUris: string[]) {
    server = await startAuthServer();
    const registered = await registerClient(server.origin, redirectUris);
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
    return { origin: server.origin, clientId: registered.client_id, jar: await sessionCookieFor(OPERATOR_ID) };
  }

  it.each([CURSOR_REDIRECT, VSCODE_REDIRECT])("lets the form reach %s through the CSP", async (redirectUri) => {
    const { origin, clientId, jar } = await prepare([redirectUri]);
    const params = authorizeParams({ clientId, redirectUri, challenge: pkce().challenge });

    const page = await fetch(`${origin}/authorize?${params}`, { headers: { cookie: jar.header() } });
    expect(page.status).toBe(200);
    const policy = page.headers.get("content-security-policy")!;
    expect(policy).toContain(`form-action 'self' ${new URL(redirectUri).protocol}`);
    expect(policy).not.toContain("null");
  });

  it("completes a VS Code style loopback flow on an ephemeral port", async () => {
    const { origin, clientId, jar } = await prepare(["http://127.0.0.1:33418/", "http://127.0.0.1/"]);
    const redirectUri = "http://127.0.0.1:52000/";
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ clientId, redirectUri, challenge });

    const page = await fetch(`${origin}/authorize?${params}`, { headers: { cookie: jar.header() } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("form-action 'self' http://127.0.0.1:52000");

    const approved = await approveConsent(origin, jar, params, "personal");
    expect(approved.status).toBe(302);
    expect(new URL(approved.headers.get("location")!).origin).toBe("http://127.0.0.1:52000");

    const exchanged = await postToken(origin, {
      grant_type: "authorization_code",
      client_id: clientId,
      code: codeFrom(approved),
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    expect(exchanged.status).toBe(200);
  });
});
