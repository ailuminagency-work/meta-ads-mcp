import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { requestContext } from "../../src/auth/token-store.js";
import { registerTokenTools } from "../../src/tools/tokens.js";
import {
  configureMetaTokenRepo,
  InMemoryMetaTokenRepo,
  resetMetaTokenRepoForTests,
} from "../../src/store/meta-token-repo.js";
import { ENVS, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";
import { createMockMcpServer } from "../setup.js";

const USER = "synthetic-tools-user";
const HOSTILE = ["../../synthetic-other/meta_tokens/personal", "a/b", "..", ".", "a.b", "my token", "x".repeat(65), "per\u0000sonal", "__a__", "__name__", "____"];

type Result = { content: Array<{ type: string; text: string }>; isError?: boolean };
let repo: InMemoryMetaTokenRepo;
let call: (tool: string, args: Record<string, unknown>) => Promise<Result>;
let server: ReturnType<typeof createMockMcpServer>;

beforeEach(async () => {
  useKeyEnv(ENVS.k1Only);
  repo = new InMemoryMetaTokenRepo();
  configureMetaTokenRepo(repo);
  for (const name of ["personal", "secondary"]) {
    await repo.saveToken({ fbUserId: USER, name, accessToken: `synthetic-${name}-token`, kind: "system_user", expiresAt: null, metaUserId: "1", metaUserName: "n", setAsDefault: name === "personal" });
  }
  server = createMockMcpServer();
  registerTokenTools(server as never);
  call = (tool, args) => {
    const registered = server._registeredTools.find((t) => t.name === tool)!;
    return requestContext.run({ accessToken: "synthetic-request-token", fbUserId: USER }, () => registered.handler(args) as Promise<Result>);
  };
});
afterEach(() => {
  resetMetaTokenRepoForTests();
  restoreKeyEnv();
  vi.restoreAllMocks();
});

describe("token tools refuse hostile token names with a clear error", () => {
  it.each(HOSTILE)("ads_set_active_token %j", async (name) => {
    const result = await call("ads_set_active_token", { bm_name: name });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid token name/);
    expect(await repo.getDefaultTokenName(USER)).toBe("personal");
  });

  it.each(HOSTILE)("ads_delete_token %j", async (name) => {
    const result = await call("ads_delete_token", { bm_name: name });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid token name/);
    expect((await repo.listTokens(USER)).map((t) => t.name).sort()).toEqual(["personal", "secondary"]);
  });

  it("the refusal does not echo the submitted name", async () => {
    const result = await call("ads_delete_token", { bm_name: "../../synthetic-other/meta_tokens/personal" });
    expect(result.content[0].text).not.toContain("synthetic-other");
  });

  it.each(["__a__", "__name__", "____", "a/b", "a.b", "x".repeat(65), ""])("the registration schema rejects %j", (name) => {
    const registered = server._registeredTools.find((t) => t.name === "ads_register_token")!;
    const schema = z.object(registered.schema as z.ZodRawShape);
    expect(schema.safeParse({ bm_name: name, access_token: "synthetic-access-token" }).success).toBe(false);
  });

  it.each(["personal", "client_acme", "client-beta", "_a_", "__a", "a__", "___"])("the registration schema accepts %j", (name) => {
    const registered = server._registeredTools.find((t) => t.name === "ads_register_token")!;
    const schema = z.object(registered.schema as z.ZodRawShape);
    expect(schema.safeParse({ bm_name: name, access_token: "synthetic-access-token" }).success).toBe(true);
  });

  it("ordinary names still work", async () => {
    expect((await call("ads_set_active_token", { bm_name: "secondary" })).isError).toBeUndefined();
    expect(await repo.getDefaultTokenName(USER)).toBe("secondary");
    expect((await call("ads_delete_token", { bm_name: "secondary" })).isError).toBeUndefined();
    expect((await repo.listTokens(USER)).map((t) => t.name)).toEqual(["personal"]);
    const missing = await call("ads_delete_token", { bm_name: "never_registered" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/not found/);
  });

  it("deleting the default through the tool leaves no arbitrary default behind", async () => {
    await repo.saveToken({ fbUserId: USER, name: "third", accessToken: "synthetic-third-token", kind: "system_user", expiresAt: null, metaUserId: "1", metaUserName: "n" });
    expect((await call("ads_delete_token", { bm_name: "personal" })).isError).toBeUndefined();
    expect(await repo.getDefaultTokenName(USER)).toBeNull();
  });
});
