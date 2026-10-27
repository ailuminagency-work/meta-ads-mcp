import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultTokenName, listTokens, saveToken } from "../../src/store/meta-token-repo.js";
import {
  authorizeParams,
  formHeaders,
  OPERATOR_ID,
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
  return { origin: server.origin, jar, client };
}

const HOSTILE = ["../../100000000000002/meta_tokens/personal", "a/b", "..", ".", "a.b", "my token", "x".repeat(65), "per\u0000sonal", "personal\n", "__a__", "__name__", "____"];

const post = (origin: string, path: string, jar: Awaited<ReturnType<typeof prepare>>["jar"], body: URLSearchParams) =>
  fetch(origin + path, { method: "POST", headers: formHeaders(jar), body, redirect: "manual" });

async function expectUntouched(): Promise<void> {
  expect(await getDefaultTokenName(OPERATOR_ID)).toBe("personal");
  expect((await listTokens(OPERATOR_ID)).map((t) => t.name).sort()).toEqual(["personal", "secondary"]);
}

describe("token names submitted to the account pages", () => {
  it.each(HOSTILE)("POST /auth/select-token refuses %j with a 400 and changes nothing", async (name) => {
    const { origin, jar } = await prepare();
    const response = await post(origin, "/auth/select-token", jar, new URLSearchParams({ name }));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(JSON.stringify(await response.json())).toMatch(/Invalid token name/);
    await expectUntouched();
  });

  it.each(HOSTILE)("POST /auth/delete-token refuses %j with a 400 and deletes nothing", async (name) => {
    const { origin, jar } = await prepare();
    const response = await post(origin, "/auth/delete-token", jar, new URLSearchParams({ name }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/Invalid token name/);
    await expectUntouched();
  });

  it("keeps a well-formed but unknown name a 404, and still selects and deletes real ones", async () => {
    const { origin, jar } = await prepare();
    expect((await post(origin, "/auth/select-token", jar, new URLSearchParams({ name: "unknown_name" }))).status).toBe(404);
    expect((await post(origin, "/auth/delete-token", jar, new URLSearchParams({ name: "unknown_name" }))).status).toBe(404);
    expect((await post(origin, "/auth/select-token", jar, new URLSearchParams({ name: "secondary" }))).status).toBe(302);
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("secondary");
    expect((await post(origin, "/auth/delete-token", jar, new URLSearchParams({ name: "secondary" }))).status).toBe(302);
    expect((await listTokens(OPERATOR_ID)).map((t) => t.name)).toEqual(["personal"]);
  });
});

describe("registering a system token", () => {
  it.each([...HOSTILE, "__x__"].filter((name) => name.trim() === name))("refuses the name %j with a 400 before any Meta call and stores nothing", async (name) => {
    const { origin, jar } = await prepare();
    const response = await post(origin, "/auth/register-system-token", jar, new URLSearchParams({ name, access_token: "synthetic-system-token-value" }));
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/Invalid token name/);
    await expectUntouched();
  });
});

describe("the consent form token field", () => {
  it.each(HOSTILE)("refuses %j with a 400 and issues no authorization code", async (token) => {
    const { origin, jar, client } = await prepare();
    const params = authorizeParams({ clientId: client.client_id, challenge: pkce().challenge });
    params.set("token", token);
    const response = await post(origin, "/authorize", jar, params);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toMatch(/nombre de token no v|invalid token name/i);
    await expectUntouched();
  });

  it("still approves with a valid token name or with none", async () => {
    const { origin, jar, client } = await prepare();
    for (const token of ["secondary", undefined]) {
      const params = authorizeParams({ clientId: client.client_id, challenge: pkce().challenge });
      if (token) params.set("token", token);
      const response = await post(origin, "/authorize", jar, params);
      expect(response.status).toBe(302);
      expect(new URL(response.headers.get("location")!).searchParams.get("code")).toBeTruthy();
    }
    expect(await getDefaultTokenName(OPERATOR_ID)).toBe("secondary");
  });
});
