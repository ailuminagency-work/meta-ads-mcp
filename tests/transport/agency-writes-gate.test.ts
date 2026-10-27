import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { validateAgencyEnvironment } from "../../src/transport/deployment-config.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const agencyEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  DEPLOYMENT_MODE: "agency",
  META_APP_ID: "300",
  META_APP_SECRET: "s".repeat(32),
  SERVER_URL: "https://mcp.example.test",
  FIRESTORE_PROJECT_ID: "proj",
  GOOGLE_APPLICATION_CREDENTIALS: "/x.json",
  SESSION_COOKIE_SECRET: "c".repeat(48),
  OAUTH_SECRET: "o".repeat(48),
  TOKEN_ENCRYPTION_KEY: "e".repeat(64),
  AUTH_ALLOWED_FB_USER_IDS: "900000000000001",
  ...extra,
});

describe("AGENCY_WRITES_ENABLED needs the policy engine (G2-02)", () => {
  it("refuses startup when writes are enabled and LUMIN_PLATFORM_ENABLED is absent", () => {
    expect(() => validateAgencyEnvironment(agencyEnv({ AGENCY_WRITES_ENABLED: "true" }))).toThrow(
      /AGENCY_WRITES_ENABLED=true requires LUMIN_PLATFORM_ENABLED=true/,
    );
  });

  it.each(["false", "", "TRUE", "1", "yes"])("refuses startup when LUMIN_PLATFORM_ENABLED is %j", (value) => {
    expect(() => validateAgencyEnvironment(agencyEnv({ AGENCY_WRITES_ENABLED: "true", LUMIN_PLATFORM_ENABLED: value }))).toThrow(
      /requires LUMIN_PLATFORM_ENABLED=true/,
    );
  });

  it("accepts writes with the policy engine on, and read-only agency with it off", () => {
    expect(() => validateAgencyEnvironment(agencyEnv({ AGENCY_WRITES_ENABLED: "true", LUMIN_PLATFORM_ENABLED: "true" }))).not.toThrow();
    expect(() => validateAgencyEnvironment(agencyEnv({ AGENCY_WRITES_ENABLED: "false" }))).not.toThrow();
    expect(() => validateAgencyEnvironment(agencyEnv())).not.toThrow();
  });
});

describe("LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER is a strict boolean", () => {
  it.each(["true", "false", "TRUE", "False", "tRuE"])("accepts %s", (value) => {
    expect(() => validateAgencyEnvironment(agencyEnv({ LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER: value }))).not.toThrow();
  });

  it("treats an unset or empty value as unset", () => {
    expect(() => validateAgencyEnvironment(agencyEnv())).not.toThrow();
    expect(() => validateAgencyEnvironment(agencyEnv({ LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER: "" }))).not.toThrow();
  });

  it.each(["1", "0", "yes", "no", "on", "off", "enabled", " true", "true ", "tru", "truee", "null"])(
    "refuses %j instead of silently reading it as false",
    (value) => {
      expect(() => validateAgencyEnvironment(agencyEnv({ LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER: value }))).toThrow(
        /LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER must be true or false/,
      );
    },
  );
});

describe("createServer fails closed on the same combination", () => {
  async function toolNames(env: Record<string, string | undefined>): Promise<{ names: string[]; posts: string[]; call: (name: string, args: Record<string, unknown>) => Promise<unknown> }> {
    for (const [key, value] of Object.entries({ META_API_VERSION: "v26.0", META_APP_ID: "300", LUMIN_PLATFORM_ENABLED: undefined, AGENCY_WRITES_ENABLED: undefined, ...env })) {
      if (value === undefined) vi.stubEnv(key, "");
      else vi.stubEnv(key, value);
      if (value === undefined) delete process.env[key];
    }
    const posts: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string; body?: unknown }) => {
      if (init?.method && init.method !== "GET") posts.push(`${init.method} ${new URL(String(input)).pathname} ${String(init.body)}`);
      return new Response(JSON.stringify({ success: true, id: "1", data: [] }), { headers: { "content-type": "application/json" } });
    });
    const server = createServer();
    const client = new Client({ name: "g2", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    const { tools } = await client.listTools();
    return {
      names: tools.map((tool) => tool.name),
      posts,
      call: (name, args) => requestContext.run({ accessToken: "synthetic", fbUserId: "100" }, () => client.callTool({ name, arguments: args }).catch((error: unknown) => ({ error: String(error) }))),
    };
  }

  it("exposes no baseline write tool and sends no write when agency writes are on and the policy engine is off", async () => {
    const { names, posts, call } = await toolNames({ DEPLOYMENT_MODE: "agency", AGENCY_WRITES_ENABLED: "true" });

    expect(names).not.toContain("ads_update_entity");
    expect(names).not.toContain("ads_activate_entity");
    expect(names).not.toContain("ads_create_campaign");
    await call("ads_update_entity", { entity_type: "ad_set", entity_id: "123456789", updates: { status: "ACTIVE", daily_budget: 900000000 } });
    await call("ads_activate_entity", { entity_type: "campaign", entity_id: "123456789", status: "ACTIVE" });
    expect(posts).toEqual([]);
  });

  it("matches the read-only agency tool list when writes are off", async () => {
    const closed = await toolNames({ DEPLOYMENT_MODE: "agency", AGENCY_WRITES_ENABLED: "true" });
    const readOnly = await toolNames({ DEPLOYMENT_MODE: "agency", AGENCY_WRITES_ENABLED: "false" });
    expect([...closed.names].sort()).toEqual([...readOnly.names].sort());
  });

  it("keeps the tools in the unrestricted upstream mode, so their absence above is the gate and not the registry", async () => {
    const { names } = await toolNames({ DEPLOYMENT_MODE: "upstream" });
    expect(names).toContain("ads_update_entity");
    expect(names).toContain("ads_activate_entity");
  });
});
