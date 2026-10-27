import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultTokenName, listTokens, saveToken } from "../../src/store/meta-token-repo.js";
import {
  authorizeParams,
  OPERATOR_ID,
  pkce,
  registerClient,
  sessionCookieFor,
  startAuthServer,
  type AuthServer,
  type CookieJar,
} from "./auth-flow-harness.js";

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function prepare() {
  server = await startAuthServer();
  const client = await registerClient(server.origin);
  for (const [name, isDefault] of [["personal", true], ["secondary", false]] as const) {
    await saveToken({
      fbUserId: OPERATOR_ID,
      name,
      accessToken: `synthetic-${name}-token-value`,
      kind: "user",
      expiresAt: null,
      metaUserId: OPERATOR_ID,
      metaUserName: "Synthetic",
      setAsDefault: isDefault,
    });
  }
  const jar = await sessionCookieFor(OPERATOR_ID);
  const consent = authorizeParams({ clientId: client.client_id, challenge: pkce().challenge });
  consent.set("token", "personal");
  return { origin: server.origin, jar, consent };
}

interface Attempt {
  path: string;
  body: () => URLSearchParams;
}

const ATTEMPTS: Record<string, (consent: URLSearchParams) => Attempt> = {
  "/authorize": (consent) => ({ path: "/authorize", body: () => new URLSearchParams(consent) }),
  "/auth/select-token": () => ({ path: "/auth/select-token", body: () => new URLSearchParams({ name: "secondary" }) }),
  "/auth/delete-token": () => ({ path: "/auth/delete-token", body: () => new URLSearchParams({ name: "secondary" }) }),
  "/auth/register-system-token": () => ({
    path: "/auth/register-system-token",
    body: () => new URLSearchParams({ name: "attacker", access_token: "attacker-supplied-token-value" }),
  }),
  "/auth/logout": () => ({ path: "/auth/logout", body: () => new URLSearchParams() }),
};

function post(origin: string, jar: CookieJar, attempt: Attempt, headers: Record<string, string>) {
  return fetch(origin + attempt.path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header(), ...headers },
    body: attempt.body(),
    redirect: "manual",
  });
}

async function sessionStillWorks(origin: string, jar: CookieJar): Promise<boolean> {
  const response = await fetch(`${origin}/auth/connections`, { headers: { cookie: jar.header() }, redirect: "manual" });
  return response.status === 200;
}

describe.each(Object.keys(ATTEMPTS))("POST %s", (route) => {
  it.each([
    ["a cross-site navigation", { "sec-fetch-site": "cross-site" }],
    ["a sibling-subdomain request", { "sec-fetch-site": "same-site" }],
    ["a request with a foreign Origin and no fetch metadata", { origin: "https://evil.example" }],
    ["a request with a null Origin and no fetch metadata", { origin: "null" }],
  ])("is rejected for %s and changes nothing", async (_label, headers) => {
    const { origin, jar, consent } = await prepare();
    const response = await post(origin, jar, ATTEMPTS[route](consent), headers);

    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("personal");
    expect((await listTokens(OPERATOR_ID)).map((t) => t.name).sort()).toEqual(["personal", "secondary"]);
    expect(await sessionStillWorks(origin, jar)).toBe(true);
  });
});

describe("same-origin posts keep working", () => {
  it("issues an authorization code from the consent form", async () => {
    const { origin, jar, consent } = await prepare();
    const response = await post(origin, jar, ATTEMPTS["/authorize"](consent), { "sec-fetch-site": "same-origin" });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).searchParams.get("code")).toBeTruthy();
  });

  it("selects and deletes tokens when the browser reports same-origin", async () => {
    const { origin, jar } = await prepare();
    const headers = { "sec-fetch-site": "same-origin" };

    expect((await post(origin, jar, ATTEMPTS["/auth/select-token"](new URLSearchParams()), headers)).status).toBe(302);
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("secondary");

    expect((await post(origin, jar, ATTEMPTS["/auth/delete-token"](new URLSearchParams()), headers)).status).toBe(302);
    expect((await listTokens(OPERATOR_ID)).map((t) => t.name)).toEqual(["personal"]);
  });

  it("accepts a matching Origin header when fetch metadata is absent", async () => {
    const { origin, jar } = await prepare();
    const response = await post(origin, jar, ATTEMPTS["/auth/select-token"](new URLSearchParams()), { origin });
    expect(response.status).toBe(302);
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("secondary");
  });

  it("logs out when the browser reports same-origin", async () => {
    const { origin, jar } = await prepare();
    const response = await post(origin, jar, ATTEMPTS["/auth/logout"](new URLSearchParams()), {
      "sec-fetch-site": "same-origin",
    });
    expect(response.status).toBe(200);
    const stale = await fetch(`${origin}/auth/connections`, { headers: { cookie: jar.header() }, redirect: "manual" });
    expect(stale.status).toBe(302);
  });
});
