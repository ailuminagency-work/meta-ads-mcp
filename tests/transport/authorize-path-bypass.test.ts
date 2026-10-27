import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  codeFrom,
  OPERATOR_ID,
  pkce,
  postToken,
  rawRequest,
  registerClient,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";

const REDIRECT = "http://127.0.0.1:38123/cb";
const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Origin: "https://evil.example",
  "Sec-Fetch-Site": "cross-site",
};
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

async function prepare() {
  server = await startAuthServer();
  const client = await registerClient(server.origin, [REDIRECT]);
  const { verifier, challenge } = pkce();
  const params = authorizeParams({ clientId: client.client_id, challenge, redirectUri: REDIRECT, state: "ST" });
  return { origin: server.origin, client, verifier, params };
}

function reachesTheClient(location: string | null): boolean {
  return location !== null && location.startsWith("http://127.0.0.1:38123/");
}

describe("/authorize//: the SDK handler is not reachable around the login, consent and CSRF checks", () => {
  it("refuses an anonymous GET and issues no authorization code", async () => {
    const { origin, params } = await prepare();

    const control = await rawRequest(origin, { target: `/authorize?${params}` });
    expect(control.status).toBe(302);
    expect(control.location).toMatch(/^\/auth\/meta\?return=/);

    const response = await rawRequest(origin, { target: `/authorize//?${params}` });
    expect(response.location ?? "").not.toContain("code=");
    expect(reachesTheClient(response.location)).toBe(false);
    expect(response.status).toBe(404);
  });

  it("refuses a cross-site POST that carries no cookie", async () => {
    const { origin, params } = await prepare();

    const control = await rawRequest(origin, {
      method: "POST",
      target: "/authorize",
      headers: FORM_HEADERS,
      body: params.toString(),
    });
    expect(control.status).toBe(403);

    const response = await rawRequest(origin, {
      method: "POST",
      target: "/authorize//",
      headers: FORM_HEADERS,
      body: params.toString(),
    });
    expect(response.location ?? "").not.toContain("code=");
    expect(reachesTheClient(response.location)).toBe(false);
    expect(response.status).toBe(404);
  });

  it("cannot redeem anything: no code, so no token and no refresh token", async () => {
    const { origin, client, verifier, params } = await prepare();
    const attack = await rawRequest(origin, { target: `/authorize//?${params}` });
    const code = attack.location ? new URL(attack.location, origin).searchParams.get("code") : null;
    expect(code).toBeNull();

    const exchanged = await postToken(origin, {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: "0".repeat(64),
      code_verifier: verifier,
      redirect_uri: REDIRECT,
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
      const url = `${target}?${params}`;
      for (const method of ["GET", "HEAD"]) {
        const response = await rawRequest(origin, { method, target: url });
        expect(reachesTheClient(response.location), `${method} ${target}`).toBe(false);
        expect(response.location ?? "", `${method} ${target}`).not.toContain("code=");
      }
      const post = await rawRequest(origin, {
        method: "POST",
        target,
        headers: FORM_HEADERS,
        body: params.toString(),
      });
      expect(reachesTheClient(post.location), `POST ${target}`).toBe(false);
      expect(post.location ?? "", `POST ${target}`).not.toContain("code=");
    }
  });

  it("answers an absolute-form request target without issuing a code", async () => {
    const { origin, params } = await prepare();
    const response = await rawRequest(origin, { target: `http://127.0.0.1/authorize//?${params}` });
    expect(response.location ?? "").not.toContain("code=");
  });

  it("still lets the logged-in operator approve through the real consent form", async () => {
    const { origin, client, verifier, params } = await prepare();
    const { jar } = await browserLogin(origin, `/authorize?${params}`);

    const approved = await approveConsent(origin, jar, params, "personal");
    expect(approved.status).toBe(302);
    const exchanged = await postToken(origin, {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: codeFrom(approved),
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    });
    expect(exchanged.status).toBe(200);
  });
});
