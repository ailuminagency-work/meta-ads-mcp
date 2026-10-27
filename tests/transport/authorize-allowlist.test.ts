import { afterEach, describe, expect, it, vi } from "vitest";
import { saveToken } from "../../src/store/meta-token-repo.js";
import {
  authorizeParams,
  CLAUDE_REDIRECT,
  formHeaders,
  OPERATOR_ID,
  OTHER_OPERATOR_ID,
  pkce,
  registerClient,
  sessionCookieFor,
  startAuthServer,
  type AuthServer,
} from "./auth-flow-harness.js";

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function prepare(env: Record<string, string | undefined> = {}) {
  server = await startAuthServer(env);
  const client = await registerClient(server.origin);
  const { challenge } = pkce();
  const params = authorizeParams({ clientId: client.client_id, challenge });
  for (const fbUserId of [OPERATOR_ID, OTHER_OPERATOR_ID]) {
    await saveToken({
      fbUserId,
      name: "personal",
      accessToken: "synthetic-access-token-value",
      kind: "user",
      expiresAt: null,
      metaUserId: fbUserId,
      metaUserName: "Synthetic",
      setAsDefault: true,
    });
  }
  return { origin: server.origin, params };
}

function clearsSession(response: Response): boolean {
  return response.headers.getSetCookie().some((line) => /^mcp_session=;/.test(line));
}

describe("the /authorize routes re-check the operator against the allowlist", () => {
  it("renders the consent page for an allowlisted operator", async () => {
    const { origin, params } = await prepare({ AUTH_ALLOWED_FB_USER_IDS: `${OPERATOR_ID},${OTHER_OPERATOR_ID}` });
    const jar = await sessionCookieFor(OPERATOR_ID);
    const response = await fetch(`${origin}/authorize?${params}`, { headers: { cookie: jar.header() } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Aprobar");
  });

  it("refuses the consent page and ends the session once the operator is on AUTH_DENIED_FB_USER_IDS", async () => {
    const { origin, params } = await prepare({ AUTH_ALLOWED_FB_USER_IDS: `${OPERATOR_ID},${OTHER_OPERATOR_ID}` });
    const jar = await sessionCookieFor(OPERATOR_ID);
    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);

    const response = await fetch(`${origin}/authorize?${params}`, { headers: { cookie: jar.header() } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("Aprobar");
    expect(clearsSession(response)).toBe(true);

    const reuse = await fetch(`${origin}/authorize?${params}`, { headers: { cookie: jar.header() }, redirect: "manual" });
    expect(reuse.status).toBe(302);
    expect(reuse.headers.get("location")).toContain("/auth/meta?return=");
  });

  it("refuses an operator who was removed from the allowlist while keeping a valid cookie", async () => {
    const { origin, params } = await prepare({ AUTH_ALLOWED_FB_USER_IDS: `${OPERATOR_ID},${OTHER_OPERATOR_ID}` });
    const jar = await sessionCookieFor(OPERATOR_ID);
    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", OTHER_OPERATOR_ID);

    const response = await fetch(`${origin}/authorize?${params}`, { headers: { cookie: jar.header() } });
    expect(response.status).toBe(403);
  });

  it("does not issue an authorization code to a denied operator who submits the consent form", async () => {
    const { origin, params } = await prepare({ AUTH_ALLOWED_FB_USER_IDS: `${OPERATOR_ID},${OTHER_OPERATOR_ID}` });
    const jar = await sessionCookieFor(OPERATOR_ID);
    const body = new URLSearchParams(params);
    body.set("token", "personal");

    const allowed = await fetch(`${origin}/authorize`, {
      method: "POST",
      headers: formHeaders(jar),
      body,
      redirect: "manual",
    });
    expect(allowed.status).toBe(302);
    expect(new URL(allowed.headers.get("location")!).origin).toBe(new URL(CLAUDE_REDIRECT).origin);
    expect(new URL(allowed.headers.get("location")!).searchParams.get("code")).toBeTruthy();

    vi.stubEnv("AUTH_DENIED_FB_USER_IDS", OPERATOR_ID);
    const denied = await fetch(`${origin}/authorize`, {
      method: "POST",
      headers: formHeaders(jar),
      body,
      redirect: "manual",
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("location")).toBeNull();
  });
});
