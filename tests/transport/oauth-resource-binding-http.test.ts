import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), longLived: vi.fn(), profile: vi.fn() }));

vi.mock("../../src/auth/meta-oauth.js", async (original) => ({
  ...(await original<typeof import("../../src/auth/meta-oauth.js")>()),
  exchangeCodeForToken: mocks.exchange,
  exchangeForLongLivedToken: mocks.longLived,
  fetchProfile: mocks.profile,
  fetchPrimaryBusiness: vi.fn(async () => null),
}));

import {
  approveConsent,
  authorizeParams,
  browserLogin,
  CLAUDE_REDIRECT,
  codeFrom,
  OPERATOR_ID,
  pkce,
  postToken,
  registerClient,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";

const MCP = "http://localhost:3000/mcp";
let server: AuthServer | undefined;

beforeEach(() => {
  mocks.exchange.mockResolvedValue({ accessToken: "synthetic-short-lived-token", expiresIn: 3600 });
  mocks.longLived.mockResolvedValue({
    accessToken: "synthetic-long-lived-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
  });
  mocks.profile.mockResolvedValue({ id: OPERATOR_ID, name: "Synthetic Operator", email: null, pictureUrl: null });
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("authorization codes and access tokens stay bound to the redirect URI and the MCP resource", () => {
  it("enforces redirect_uri at /token and the resource at /mcp, and keeps pre-upgrade tokens that name an operator", async () => {
    server = await startAuthServer();
    const origin = server.origin;
    const client = await registerClient(origin);
    const { verifier, challenge } = pkce();
    const { jar } = await browserLogin(origin, "/auth/connections");

    async function issueCode(resource = MCP, explicitRedirect = true): Promise<string> {
      const params = authorizeParams({ clientId: client.client_id, challenge, resource });
      if (!explicitRedirect) params.delete("redirect_uri");
      return codeFrom(await approveConsent(origin, jar, params, "personal"));
    }
    function exchange(code: string, redirectUri?: string) {
      const body: Record<string, string> = {
        grant_type: "authorization_code",
        client_id: client.client_id,
        code,
        code_verifier: verifier,
      };
      if (redirectUri) body.redirect_uri = redirectUri;
      return postToken(origin, body);
    }
    function getMcp(token: string) {
      return fetch(`${origin}/mcp`, { headers: { Authorization: `Bearer ${token}` } });
    }

    expect((await exchange(await issueCode())).status).toBe(400);
    expect((await exchange(await issueCode(), "https://claude.ai/api/mcp/other")).status).toBe(400);
    expect((await exchange(await issueCode(MCP, false))).status).toBe(200);

    const accepted = await exchange(await issueCode(), CLAUDE_REDIRECT);
    expect(accepted.status).toBe(200);
    const tokens = (await accepted.json()) as { access_token: string };
    expect((await getMcp(tokens.access_token)).status).toBe(405);

    const wrongResource = await exchange(await issueCode("https://other.example.com/mcp"), CLAUDE_REDIRECT);
    expect(wrongResource.status).toBe(200);
    const wrongTokens = (await wrongResource.json()) as { access_token: string };
    expect((await getMcp(wrongTokens.access_token)).status).toBe(401);

    const secret = new TextEncoder().encode(process.env.OAUTH_SECRET!);
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT({ sub: client.client_id, type: "access", ...claims })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience("mcp-oauth-access")
        .setExpirationTime("1h")
        .sign(secret);
    expect((await getMcp(await sign({ fb_user_id: OPERATOR_ID }))).status).toBe(405);
    expect((await getMcp(await sign({}))).status).toBe(401);
  });
});
