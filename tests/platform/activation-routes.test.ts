import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { buildStrictLegacyWritePlan, LEGACY_CORE_WRITE_TOOLS } from "../../src/platform/legacy-write.js";
import { mapLegacyEntityUpdate } from "../../src/platform/legacy-entity-update.js";
import { classifyPlan, evaluatePolicy } from "../../src/platform/policy.js";
import { validateContractParameters } from "../../src/platform/clients.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import { LEGACY_MANIFEST } from "../../src/platform/legacy-manifest.js";
import type { AuthorizationSnapshot, OperationContext, OperationPlan } from "../../src/platform/models.js";

beforeEach(() => {
  vi.stubEnv("META_API_VERSION", "v26.0");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
});
afterEach(() => { configurePlatformRepository(undefined); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const STATUS_ATTEMPTS: Array<[string, unknown]> = [
  ["ACTIVE", "ACTIVE"], ["lower case", "active"], ["padded", " ACTIVE "], ["newline suffixed", "ACTIVE\n"], ["inherited", "INHERITED_FROM_SOURCE"],
  ["unpause alias", "UNPAUSED"], ["enabled alias", "ENABLED"], ["archived", "ARCHIVED"], ["deleted", "DELETED"], ["object", { value: "ACTIVE" }], ["array", ["ACTIVE"]],
  ["boolean", true], ["number", 1], ["null", null], ["empty", ""],
];
const CREATE_INPUTS: Record<string, Record<string, unknown>> = {
  ads_create_campaign: { account_id: "101", name: "Synthetic paused campaign", objective: "OUTCOME_TRAFFIC" },
  ads_create_ad_set: { account_id: "101", campaign_id: "201", name: "Synthetic paused ad set", destination_type: "WEBSITE", optimization_goal: "LINK_CLICKS", daily_budget: 1000, targeting: { geo_locations: { countries: ["US"] } } },
  ads_create_ad: { account_id: "101", name: "Synthetic paused ad", ad_set_id: "301", creative_id: "501" },
  ads_create_ad_creative: { account_id: "101", name: "Synthetic creative", page_id: "601", image_hash: "a".repeat(32), link_url: "https://example.com/landing", message: "Synthetic message" },
};
const UPDATE_TARGETS = { ads_update_campaign: ["campaign", "201"], ads_update_ad_set: ["ad_set", "301"], ads_update_ad: ["ad", "401"] } as const;

/** Every string reachable inside a value, including JSON text that parses to nested values. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    if (/^\s*[[{]/.test(value)) { try { strings(JSON.parse(value), out); } catch { /* opaque text */ } }
  } else if (Array.isArray(value)) value.forEach(v => strings(v, out));
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}
const activeAnywhere = (plan: OperationPlan) => strings(plan.parameters).some(s => /^\s*(active|inherited_from_source)\s*$/i.test(s)) || plan.classes.includes("ACTIVATE_SPEND");
const rejected = (build: () => unknown) => { try { build(); return false; } catch { return true; } };

describe("strict creates can only ever produce PAUSED objects", () => {
  it.each(Object.keys(CREATE_INPUTS))("%s builds a paused plan with no activation anywhere", tool => {
    const plan = buildStrictLegacyWritePlan(tool, CREATE_INPUTS[tool]);
    expect(plan.createOrCopy).toBe(true);
    expect(plan.parameters.status).toBe("PAUSED");
    expect(activeAnywhere(plan)).toBe(false);
    expect(plan.classes).not.toContain("ACTIVATE_SPEND");
    if (tool !== "ads_create_ad_creative") expect((plan.parameters.legacy_write_step as { body: { status: unknown } }).body.status).toBe("PAUSED");
  });

  it.each(Object.keys(CREATE_INPUTS).flatMap(tool => STATUS_ATTEMPTS.map(([label, status]) => [tool, label, status] as const)))("%s rejects root status %s", (tool, _label, status) => {
    expect(rejected(() => buildStrictLegacyWritePlan(tool, { ...CREATE_INPUTS[tool], status }))).toBe(true);
  });

  it.each(Object.keys(CREATE_INPUTS).filter(tool => tool !== "ads_create_ad_creative"))("%s accepts an explicit PAUSED status only", tool => {
    const plan = buildStrictLegacyWritePlan(tool, { ...CREATE_INPUTS[tool], status: "PAUSED" });
    expect(activeAnywhere(plan)).toBe(false);
  });
  it("accepts no status field at all on creatives, which carry no delivery state", () => {
    expect(rejected(() => buildStrictLegacyWritePlan("ads_create_ad_creative", { ...CREATE_INPUTS.ads_create_ad_creative, status: "PAUSED" }))).toBe(true);
  });

  const SIDE_DOORS: Array<[string, Record<string, unknown>]> = [
    ["configured_status", { configured_status: "ACTIVE" }], ["effective_status", { effective_status: "ACTIVE" }], ["status_option", { status_option: "ACTIVE" }],
    ["inherited status option", { status_option: "INHERITED_FROM_SOURCE" }], ["target_status", { target_status: "ACTIVE" }], ["execution_options", { execution_options: ["validate_only"] }],
    ["nested adset spec", { adset_spec: { status: "ACTIVE" } }], ["nested campaign spec", { campaign_spec: { status: "ACTIVE" } }], ["copy source", { source_adset_id: "301", deep_copy: true }],
    ["rename options", { rename_options: { rename_strategy: "NO_RENAME" } }], ["schedule", { start_time: "2026-01-01T00:00:00+0000", status: "PAUSED" }],
    ["json blob status", { status: '{"status":"ACTIVE"}' }], ["adlabels", { adlabels: [{ name: "x" }] }], ["spend cap", { spend_cap: 1 }], ["lifetime budget", { lifetime_budget: 1 }],
  ];
  it.each(Object.keys(CREATE_INPUTS).flatMap(tool => SIDE_DOORS.map(([label, extra]) => [tool, label, extra] as const)))("%s rejects the undeclared field %s", (tool, _label, extra) => {
    expect(rejected(() => buildStrictLegacyWritePlan(tool, { ...CREATE_INPUTS[tool], ...extra }))).toBe(true);
  });

  it.each([
    ["JSON text that parses to an active status", '{"status":"ACTIVE"}'],
    ["JSON text with nested active status", '{"a":[{"status":"active"}]}'],
    ["JSON array holding an active status", '[{"status":"ACTIVE"}]'],
  ])("rejects a free-text name carrying %s", (_label, name) => {
    for (const tool of Object.keys(CREATE_INPUTS)) expect(rejected(() => buildStrictLegacyWritePlan(tool, { ...CREATE_INPUTS[tool], name }))).toBe(true);
  });

  it.each(["campaign_id", "ad_set_id", "creative_id", "page_id", "account_id"])("rejects a non-numeric reference in %s that smuggles a status", key => {
    for (const tool of Object.keys(CREATE_INPUTS)) {
      if (!(key in CREATE_INPUTS[tool])) continue;
      expect(rejected(() => buildStrictLegacyWritePlan(tool, { ...CREATE_INPUTS[tool], [key]: '1","status":"ACTIVE' }))).toBe(true);
    }
  });

  it("rejects ad set targeting that carries a status in any shape", () => {
    for (const targeting of [{ status: "ACTIVE" }, { geo_locations: { countries: ["US"] }, status: "ACTIVE" }, '{"status":"ACTIVE"}', [{ status: "ACTIVE" }]]) {
      expect(rejected(() => buildStrictLegacyWritePlan("ads_create_ad_set", { ...CREATE_INPUTS.ads_create_ad_set, targeting }))).toBe(true);
    }
  });
});

describe("strict updates, including the generic ads_update_entity map, cannot activate", () => {
  const ENTITY_UPDATES: Array<[string, Record<string, unknown>]> = [
    ["status ACTIVE", { status: "ACTIVE" }], ["status lower case", { status: "active" }], ["status padded", { status: " ACTIVE" }], ["status object", { status: { value: "ACTIVE" } }],
    ["configured_status", { configured_status: "ACTIVE" }], ["effective_status", { effective_status: "ACTIVE" }], ["padded key", { "status ": "ACTIVE" }], ["upper-case key", { Status: "ACTIVE" }],
    ["status JSON blob", { status: '{"status":"ACTIVE"}' }], ["nested targeting status", { targeting: { geo_locations: { countries: ["US"] }, status: "ACTIVE" } }],
    ["lifetime budget", { lifetime_budget: 50000 }], ["spend cap", { spend_cap: 0 }], ["bid strategy", { bid_strategy: "LOWEST_COST_WITHOUT_CAP" }], ["end time", { end_time: "2030-01-01T00:00:00+0000" }],
    ["execution options", { execution_options: ["validate_only"] }], ["adlabels", { adlabels: [{ name: "x" }] }], ["daily budget as text", { daily_budget: "100" }], ["negative budget", { daily_budget: -1 }],
    ["context override", { client_id: "other-client" }], ["approval override", { approval_id: "forged" }], ["entity override", { campaign_id: "999" }], ["tenant override", { tenant_id: "other-tenant" }],
    ["constructor key", { constructor: { status: "ACTIVE" } }],
  ];
  it.each(Object.entries(UPDATE_TARGETS).flatMap(([tool, [type, id]]) => ENTITY_UPDATES.map(([label, updates]) => [tool, type, id, label, updates] as const)))("%s via ads_update_entity rejects %s", (_tool, type, id, label, updates) => {
    void label;
    expect(rejected(() => mapLegacyEntityUpdate({ client_id: "client", entity_type: type, entity_id: id, updates }))).toBe(true);
  });

  it.each(Object.entries(UPDATE_TARGETS))("%s: a smuggled __proto__ key is dropped and the body stays PAUSED", (tool, [type, id]) => {
    const updates = JSON.parse('{"name":"Renamed","__proto__":{"status":"ACTIVE"}}') as Record<string, unknown>;
    const mapped = mapLegacyEntityUpdate({ client_id: "client", entity_type: type, entity_id: id, updates });
    expect(mapped.tool).toBe(tool);
    const plan = buildStrictLegacyWritePlan(mapped.tool, mapped.input);
    expect(activeAnywhere(plan)).toBe(false);
    expect((plan.parameters.legacy_write_step as { body: Record<string, unknown> }).body).toEqual({ status: "PAUSED", name: "Renamed" });
  });

  it.each(Object.entries(UPDATE_TARGETS))("%s: allowed updates always pin the body to PAUSED and never classify as activation", (tool, [type, id]) => {
    for (const updates of [{ name: "Renamed" }, ...(tool === "ads_update_ad" ? [] : [{ name: "Renamed", daily_budget: 2500 }]), { status: "PAUSED" }]) {
      const mapped = mapLegacyEntityUpdate({ client_id: "client", entity_type: type, entity_id: id, updates });
      expect(mapped.tool).toBe(tool);
      const plan = buildStrictLegacyWritePlan(mapped.tool, mapped.input);
      expect((plan.parameters.legacy_write_step as { body: { status: unknown } }).body.status).toBe("PAUSED");
      expect(plan.classes).not.toContain("ACTIVATE_SPEND");
      expect(activeAnywhere(plan)).toBe(false);
      if ("daily_budget" in updates) expect(plan.classes).toContain("WRITE_BUDGET");
    }
  });

  it.each(Object.entries(UPDATE_TARGETS))("%s typed update rejects every non-PAUSED status", (tool, [, id]) => {
    const key = ({ ads_update_campaign: "campaign_id", ads_update_ad_set: "ad_set_id", ads_update_ad: "ad_id" } as Record<string, string>)[tool];
    for (const [, status] of STATUS_ATTEMPTS) expect(rejected(() => buildStrictLegacyWritePlan(tool, { [key]: id, name: "Renamed", status }))).toBe(true);
  });

  it("keeps creative updates to the name only", () => {
    for (const extra of [{ status: "ACTIVE" }, { object_story_spec: { status: "ACTIVE" } }, { url_tags: "a=b" }, { degrees_of_freedom_spec: {} }]) {
      expect(rejected(() => buildStrictLegacyWritePlan("ads_update_ad_creative", { creative_id: "501", name: "Renamed", ...extra }))).toBe(true);
    }
  });
});

describe("the policy classifier treats every activation spelling as spend activation", () => {
  const base = (parameters: Record<string, unknown>, extra: Partial<OperationPlan> = {}): OperationPlan => ({ parameters, assets: [{ type: "AD", id: "401" }], classes: ["WRITE_AD_CONFIGURATION"], capability: "legacy.synthetic", requiredScopes: ["ads_management"], tokenTypes: ["user"], ...extra });
  it.each([
    ["root status", { status: "ACTIVE" }], ["lower case", { status: "active" }], ["padded", { status: " ACTIVE " }], ["nested object", { step: { body: { status: "ACTIVE" } } }],
    ["nested array", { steps: [{ status: "ACTIVE" }] }], ["JSON blob", { blob: '{"status":"ACTIVE"}' }], ["double encoded JSON blob", { blob: JSON.stringify({ inner: JSON.stringify({ status: "ACTIVE" }) }) }],
    ["upper-case key", { Status: "ACTIVE" }], ["padded key", { "status ": "ACTIVE" }], ["status option", { status_option: "ACTIVE" }], ["target status", { target_status: "ACTIVE" }],
    ["execution options", { execution_options: "ACTIVE" }], ["rule unpause", { execution_spec: { execution_type: "UNPAUSE" } }],
  ])("update plan with %s is classified ACTIVATE_SPEND", (_label, parameters) => {
    expect(classifyPlan(base(parameters))).toContain("ACTIVATE_SPEND");
  });

  it.each([
    ["root status", { status: "ACTIVE" }], ["padded", { status: " ACTIVE " }], ["nested", { step: { body: { status: "ACTIVE" } } }], ["JSON blob", { status: "PAUSED", blob: '{"status":"ACTIVE"}' }],
    ["array", { status: "PAUSED", steps: [{ status: "ACTIVE" }] }], ["inherited", { status: "PAUSED", step: { status_option: "INHERITED_FROM_SOURCE" } }], ["lower inherited", { status: "PAUSED", mode: "inherited_from_source" }],
    ["array status", { status: ["PAUSED"] }], ["missing status", {}], ["configured status", { status: "PAUSED", configured_status: "ACTIVE" }],
  ])("create or copy plan with %s is refused", (_label, parameters) => {
    expect(() => classifyPlan(base(parameters, { createOrCopy: true }))).toThrow("CREATE_MUST_REMAIN_PAUSED");
  });

  it("accepts a create or copy plan that is paused at every level", () => {
    expect(classifyPlan(base({ status: "PAUSED", step: { body: { status: "PAUSED" } }, blob: '{"status":"PAUSED"}' }, { createOrCopy: true }))).toEqual(["WRITE_AD_CONFIGURATION"]);
  });

  it("classifies budgets and spend caps separately from activation", () => {
    expect(classifyPlan(base({ status: "PAUSED", body: { daily_budget: "100" } }))).toEqual(["WRITE_AD_CONFIGURATION", "WRITE_BUDGET"]);
    expect(classifyPlan(base({ blob: '{"spend_cap":"0"}' }))).toContain("WRITE_BUDGET");
    expect(classifyPlan(base({ account_spend_limit: 0 }))).toContain("WRITE_BUDGET");
  });
});

describe("no generic product contract can set ACTIVE", () => {
  const writes = PRODUCT_CONTRACTS.filter(c => c.method !== "GET");
  it("only marketing_activate_ad carries the ACTIVATE_SPEND class", () => {
    expect(PRODUCT_CONTRACTS.filter(c => c.operationClasses.includes("ACTIVATE_SPEND")).map(c => c.tool)).toEqual(["marketing_activate_ad"]);
  });
  it.each(writes.map(c => [c.tool, c] as const))("%s accepts no status-like or free-form input key", (_tool, contract) => {
    for (const key of contract.allowedInputKeys) {
      expect(key, `${contract.tool} exposes ${key}`).not.toMatch(/^(status|configured_status|effective_status|status_option|target_status|execution_options|execution_spec|campaign_spec|adset_spec|copy.*|source_.*(ad|campaign|adset).*)$/i);
    }
    for (const key of ["status", "configured_status", "execution_options", "__proto__", "constructor"]) {
      if (contract.allowedInputKeys.includes(key)) continue;
      expect(() => validateContractParameters(contract, { [key]: "ACTIVE" })).toThrow("UNSUPPORTED_ENDPOINT_PARAMETER");
    }
  });
  it("marketing_activate_ad is denied at policy level unless the deployment flag is explicitly true", () => {
    const ctx: OperationContext = { principal: { tenantId: "t", operatorId: "o" }, clientId: "c", tool: "marketing_activate_ad", provider: "META_MARKETING", requestId: "r" };
    const plan: OperationPlan = { parameters: { asset_id: "401", input: {}, endpointContract: { tool: "marketing_activate_ad" } }, assets: [{ type: "AD", id: "401" }], classes: ["ACTIVATE_SPEND"], capability: "marketing.activate.ad", requiredScopes: ["ads_management"], tokenTypes: ["user"] };
    const snapshot = { tenant: { id: "t", status: "ACTIVE", migrationState: "READY" }, member: { operatorId: "o", tenantId: "t", roles: ["writer", "admin", "approver"], allowedClientIds: ["c"], disabledAt: null }, client: { id: "c", tenantId: "t", status: "ACTIVE", verifiedBusinessIds: [] }, assets: [], grants: [], connection: { id: "k" } } as unknown as AuthorizationSnapshot;
    for (const value of [undefined, "", "false", "1", "TRUE", " true"]) {
      if (value === undefined) vi.stubEnv("LUMIN_MARKETING_ACTIVATION_ENABLED", ""); else vi.stubEnv("LUMIN_MARKETING_ACTIVATION_ENABLED", value);
      expect(evaluatePolicy(ctx, plan, snapshot, { writesEnabled: true })).toMatchObject({ decision: "DENY", reason: "MARKETING_ACTIVATION_DISABLED_BY_DEPLOYMENT" });
    }
    vi.stubEnv("LUMIN_MARKETING_ACTIVATION_ENABLED", "true");
    expect(evaluatePolicy(ctx, plan, { ...snapshot, member: { ...snapshot.member, roles: ["writer", "approver"] } } as AuthorizationSnapshot, { writesEnabled: true })).toMatchObject({ decision: "DENY", reason: "MARKETING_OWNER_ADMIN_REQUIRED" });
    expect(evaluatePolicy(ctx, plan, snapshot, { writesEnabled: false }).decision).toBe("DENY");
  });
});

describe("strict runtime: copy, batch, schedule and rule routes are held; activation never reaches the network", () => {
  const network = vi.fn(async () => { throw new Error("network must not be reached"); });
  beforeEach(() => {
    vi.stubEnv("LUMIN_PLATFORM_ENABLED", "true");
    vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "true");
    vi.stubEnv("AGENCY_WRITES_ENABLED", "true");
    vi.stubEnv("DEPLOYMENT_MODE", "legacy");
    vi.stubEnv("META_APP_ID", "300");
    network.mockClear();
    vi.stubGlobal("fetch", network);
  });

  async function withClient<T>(run: (call: (name: string, args: Record<string, unknown>) => Promise<{ isError?: boolean; text: string }>) => Promise<T>): Promise<T> {
    const repo = new InMemoryPlatformRepository();
    await repo.put("operatorIndex", "_index", "100", { tenantId: "tenant", operatorId: "100" });
    await repo.put("tenants", "tenant", "tenant", { id: "tenant", status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
    await repo.put("clients", "tenant", "client", { id: "client", tenantId: "tenant", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
    await repo.put("members", "tenant", "100", { operatorId: "100", tenantId: "tenant", roles: ["writer", "admin", "approver"], allowedClientIds: ["client"], disabledAt: null, revision: 1 });
    configurePlatformRepository(repo);
    const server = createServer(), client = new Client({ name: "activation-routes", version: "1" }), [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    try {
      return await run(async (name, args) => {
        const result = await requestContext.run({ fbUserId: "100" }, () => client.callTool({ name, arguments: args }));
        return { isError: result.isError as boolean | undefined, text: JSON.stringify(result.content) };
      });
    } finally { await client.close(); await server.close(); }
  }

  const HELD: Array<[string, Record<string, unknown>]> = [
    ["ads_clone_ad_set_bundle", { account_id: "101", source_ad_set_id: "301", target_ad_set: { name: "Copy", status: "ACTIVE" }, creative_overrides: [{ status: "ACTIVE" }], dry_run: false, idempotency_key: "idem-fixture-0001" }],
    ["ads_bulk_create_video_ads", { account_id: "101", ad_set_id: "301", page_id: "601", videos: [{ url: "https://example.com/a.mp4", name: "a" }], message: "m", headline: "h", link_url: "https://example.com", status: "ACTIVE" }],
    ["ads_create_budget_schedule", { campaign_id: "201", budget_value: 100, budget_value_type: "ABSOLUTE", time_start: 1893456000, time_end: 1893542400 }],
    ["ads_create_ad_rule", { account_id: "101", name: "r", evaluation_spec: { evaluation_type: "SCHEDULE" }, execution_spec: { execution_type: "UNPAUSE" }, schedule_spec: { schedule_type: "DAILY" } }],
    ["ads_update_ad_rule", { rule_id: "901", status: "ENABLED", execution_spec: { execution_type: "UNPAUSE" } }],
    ["ads_update_spend_cap", { account_id: "101", spend_cap: 0 }],
    ["ads_delete_campaign", { campaign_id: "201" }],
    ["ads_delete_ad_set", { ad_set_id: "301" }],
    ["ads_create_ad_study", { account_id: "101", name: "s", start_time: 1893456000, end_time: 1893542400, type: "SPLIT_TEST", cells: [] }],
  ];
  it.each(HELD)("%s is held and cannot reach the network", async (name, args) => {
    await withClient(async call => {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/LEGACY_STRICT_MIGRATION_HOLD|Input validation error|invalid_type|required/i);
    });
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    ["ads_update_entity", { client_id: "client", entity_type: "campaign", entity_id: "201", updates: { status: "ACTIVE" } }],
    ["ads_update_entity", { client_id: "client", entity_type: "ad", entity_id: "401", updates: { status: "ACTIVE", daily_budget: 100 } }],
    ["ads_update_campaign", { client_id: "client", campaign_id: "201", status: "ACTIVE" }],
    ["ads_update_ad_set", { client_id: "client", ad_set_id: "301", status: "ACTIVE" }],
    ["ads_update_ad", { client_id: "client", ad_id: "401", status: "ACTIVE" }],
    ["ads_create_campaign", { client_id: "client", account_id: "101", name: "c", objective: "OUTCOME_TRAFFIC", status: "ACTIVE" }],
    ["ads_create_ad_set", { ...CREATE_INPUTS.ads_create_ad_set, client_id: "client", status: "ACTIVE" }],
    ["ads_create_ad", { ...CREATE_INPUTS.ads_create_ad, client_id: "client", status: "ACTIVE" }],
  ])("%s with an ACTIVE status is refused before any authorization or network", async (name, args) => {
    await withClient(async call => {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/UPDATE_MUST_REMAIN_PAUSED|CREATE_MUST_REMAIN_PAUSED|Input validation error|ENTITY_UPDATE|LEGACY_/);
    });
    expect(network).not.toHaveBeenCalled();
  });

  it("ads_activate_entity accepts only an AD with every reviewed expectation and still needs a deployment flag, admin roles and a human approval", async () => {
    const full = { client_id: "client", entity_type: "AD", entity_id: "401", status: "ACTIVE", expected_creative_id: "501", expected_campaign_daily_budget: 1000, expected_adset_daily_budget: 0, expected_currency: "USD", expected_campaign_objective: "OUTCOME_TRAFFIC", expected_optimization_goal: "LINK_CLICKS", expected_bid_strategy: "LOWEST_COST_WITHOUT_CAP", expected_bid_amount: 0 };
    await withClient(async call => {
      for (const broken of [{ entity_type: "CAMPAIGN" }, { entity_type: "AD_SET" }, { status: "PAUSED" }, { status: "ACTIVATE" }, { expected_creative_id: undefined }, { unexpected: true }, { client_id: undefined }]) {
        const result = await call("ads_activate_entity", { ...full, ...broken });
        expect(result.isError).toBe(true);
      }
      const complete = await call("ads_activate_entity", full);
      expect(complete.isError).toBe(true);
      expect(complete.text).toMatch(/ASSET_UNREGISTERED_OR_AMBIGUOUS|MARKETING_ACTIVATION_DISABLED_BY_DEPLOYMENT|PLATFORM_|CLIENT_|PERMISSION/);
      vi.stubEnv("LUMIN_MARKETING_ACTIVATION_ENABLED", "true");
      const flagged = await call("ads_activate_entity", full);
      expect(flagged.isError).toBe(true);
    });
    expect(network).not.toHaveBeenCalled();
  });

  it("every manifest write tool is either a typed PAUSED adapter, an approved product alias or held", () => {
    const writes = LEGACY_MANIFEST.filter(entry => !entry.baselineReadOnlyHint).map(entry => entry.name);
    expect(writes.filter(name => LEGACY_CORE_WRITE_TOOLS.includes(name)).sort()).toEqual([...LEGACY_CORE_WRITE_TOOLS].sort());
  });
});
