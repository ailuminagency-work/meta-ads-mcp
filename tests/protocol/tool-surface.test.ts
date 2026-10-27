/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC and OAuth payloads are inspected structurally by the assertions */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  FB_USER_ID,
  OTHER_FB_USER_ID,
  STORED_META_TOKEN,
  bootServer,
  callTool,
  completeOAuthFlow,
  listTools,
  listToolsInProcess,
  mcpPost,
  toolText,
  type FlowResult,
  type Harness,
} from "./harness.js";
import { CLIENT_B, TENANT_A, TENANT_C, seedStrictRepository } from "./strict-fixture.js";
import { LEGACY_MANIFEST } from "../../src/platform/legacy-manifest.js";

type Tool = Awaited<ReturnType<typeof listTools>>[number];

const MUTATING_WORDS = new Set([
  "create", "update", "delete", "activate", "upload", "register", "deregister", "publish", "deprecate",
  "share", "unshare", "hide", "reply", "clone", "bulk", "verify", "request", "run", "send", "remove",
]);

const WRITE_WARNING = "⚠️ Modifies live ads/account data.";

function mutatingWords(name: string): string[] {
  return name.split("_").filter((word) => MUTATING_WORDS.has(word));
}

interface SampleIds {
  clientId: string;
  accountId: string;
  campaignId: string;
}

function sampleValue(schema: any, name: string, ids: SampleIds): unknown {
  if (schema?.const !== undefined) return schema.const;
  if (Array.isArray(schema?.enum)) return schema.enum[0];
  if (schema?.anyOf) return sampleValue(schema.anyOf[0], name, ids);
  if (schema?.oneOf) return sampleValue(schema.oneOf[0], name, ids);
  switch (schema?.type) {
    case "string": {
      if (name === "client_id") return ids.clientId;
      const preferred = /account/.test(name) ? [ids.accountId, `act_${ids.accountId}`] : /campaign|object_id|parent_id/.test(name) ? [ids.campaignId] : [];
      const candidates = [...preferred, "1", "a".repeat(32), `jpeg_${"a".repeat(64)}`, "00000000-0000-4000-8000-000000000000", "2024-01-01", "https://example.invalid/x", "x"];
      if (typeof schema.pattern === "string") {
        const pattern = new RegExp(schema.pattern);
        const hit = candidates.find((candidate) => pattern.test(candidate));
        if (hit) return hit;
      }
      return preferred[0] ?? "x".padEnd(schema.minLength ?? 1, "x");
    }
    case "number":
    case "integer":
      return Math.max(schema.minimum ?? 1, 1);
    case "boolean":
      return false;
    case "array":
      return Array.from({ length: schema.minItems ?? 1 }, () => sampleValue(schema.items ?? { type: "string" }, name, ids));
    case "object": {
      const out: Record<string, unknown> = {};
      for (const key of schema.required ?? []) out[key] = sampleValue(schema.properties?.[key] ?? {}, key, ids);
      return out;
    }
    default:
      return "x";
  }
}

function sampleArguments(tool: Tool, ids: SampleIds): Record<string, unknown> {
  const args = sampleValue(tool.inputSchema, "", ids) as Record<string, unknown>;
  if (tool.inputSchema?.properties?.client_id) args.client_id = ids.clientId;
  return args;
}

const IDS_A: SampleIds = { clientId: TENANT_A.clientId, accountId: TENANT_A.accountId, campaignId: TENANT_A.campaignId };
const IDS_B: SampleIds = { clientId: CLIENT_B.clientId, accountId: CLIENT_B.accountId, campaignId: CLIENT_B.campaignId };

function errorText(reply: Awaited<ReturnType<typeof callTool>>): string {
  return reply.json?.error ? JSON.stringify(reply.json.error) : toolText(reply);
}

function isRejected(reply: Awaited<ReturnType<typeof callTool>>): boolean {
  return reply.status >= 400 || reply.json?.result?.isError === true || reply.json?.error !== undefined;
}

describe("agency mode with writes enabled (platform disabled)", () => {
  let h: Harness;
  let flow: FlowResult;

  beforeAll(async () => {
    h = await bootServer({ writes: true });
    flow = await completeOAuthFlow(h.origin);
  });
  afterEach(() => expect(h.upstream.blocked).toEqual([]));
  afterAll(async () => h.close());

  it("exposes the write tools with their destructive/idempotent hints and the live-data warning", async () => {
    const tools = await listTools(h.origin, flow.tokens.access_token);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const writes = tools.filter((tool) => tool.annotations?.readOnlyHint !== true);
    expect(writes.length).toBeGreaterThan(50);
    for (const name of ["ads_create_campaign", "ads_update_campaign", "ads_delete_campaign"]) {
      expect(byName.has(name), name).toBe(true);
      expect(byName.get(name)!.description, name).toContain(WRITE_WARNING);
    }
    expect(byName.get("ads_delete_campaign")!.annotations?.destructiveHint).toBe(true);
    expect(byName.get("ads_create_campaign")!.annotations?.idempotentHint).toBe(false);
    expect(byName.get("ads_get_campaigns")!.annotations?.readOnlyHint).toBe(true);
  });

  it("routes a write call to validation, not to a 'disabled' refusal, and sends nothing to Meta for invalid input", async () => {
    h.upstream.reset();
    const reply = await callTool(h.origin, flow.tokens.access_token, "ads_create_campaign", {});
    expect(isRejected(reply)).toBe(true);
    expect(errorText(reply)).toMatch(/Invalid arguments|invalid/i);
    expect(errorText(reply)).not.toMatch(/disabled/i);
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("still refuses the X-Meta-Token override when writes are enabled", async () => {
    const reply = await mcpPost(
      h.origin,
      flow.tokens.access_token,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ads_create_campaign", arguments: {} } },
      { "x-meta-token": "synthetic-override-token" },
    );
    expect(reply.status).toBe(403);
  });
});

describe("read-only agency mode (platform disabled)", () => {
  let h: Harness;
  let flow: FlowResult;
  let tools: Tool[];
  let writeEnabled: Tool[];

  beforeAll(async () => {
    h = await bootServer();
    flow = await completeOAuthFlow(h.origin);
    tools = await listTools(h.origin, flow.tokens.access_token);
    writeEnabled = (await listToolsInProcess({ AGENCY_WRITES_ENABLED: "true" })) as Tool[];
  });
  afterEach(() => expect(h.upstream.blocked).toEqual([]));
  afterAll(async () => h.close());

  it("lists only read-only tools: every one annotated readOnlyHint, none with a mutating verb or write warning", () => {
    expect(tools.length).toBeGreaterThan(30);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(mutatingWords(tool.name), tool.name).toEqual([]);
      expect(tool.description ?? "", tool.name).not.toContain(WRITE_WARNING);
    }
  });

  it("hides every tool that the writes-enabled build exposes beyond the read-only set", () => {
    expect(writeEnabled.length).toBeGreaterThan(100);
    const visible = new Set(tools.map((tool) => tool.name));
    const hidden = writeEnabled.filter((tool) => !visible.has(tool.name));
    expect(hidden.length).toBeGreaterThan(50);
    for (const tool of writeEnabled.filter((candidate) => candidate.annotations?.readOnlyHint !== true)) {
      expect(visible.has(tool.name), `${tool.name} must be hidden`).toBe(false);
    }
    expect([...visible].every((name) => writeEnabled.some((tool) => tool.name === name))).toBe(true);
  });

  it("rejects tools/call for every hidden tool at the server, not just in the listing, and never reaches Meta", async () => {
    const visible = new Set(tools.map((tool) => tool.name));
    const hidden = writeEnabled.filter((tool) => !visible.has(tool.name));
    h.upstream.reset();
    const accepted: string[] = [];
    for (const tool of hidden) {
      const reply = await callTool(h.origin, flow.tokens.access_token, tool.name, sampleArguments(tool, { clientId: "client-a", accountId: "101", campaignId: "201" }));
      if (!isRejected(reply) || !/disabled/i.test(errorText(reply))) accepted.push(`${tool.name}: ${errorText(reply).slice(0, 120)}`);
    }
    expect(accepted).toEqual([]);
    expect(h.upstream.graphCalls()).toHaveLength(0);
  }, 120_000);

  it("rejects a call to a tool that does not exist", async () => {
    const reply = await callTool(h.origin, flow.tokens.access_token, "ads_does_not_exist", {});
    expect(isRejected(reply)).toBe(true);
  });

  it("serves a read tool with the signed-in user's Meta token and only ever issues GET requests", async () => {
    h.upstream.reset();
    const reply = await callTool(h.origin, flow.tokens.access_token, "ads_get_account_info", { account_id: "101" });
    expect(isRejected(reply)).toBe(false);
    expect(toolText(reply)).toContain("Synthetic acceptance ad account");
    const graph = h.upstream.graphCalls();
    expect(graph.map((call) => call.method)).toEqual(["GET"]);
    expect(graph[0].url.searchParams.get("access_token")).toBe(STORED_META_TOKEN);
  });
});

describe("strict platform mode, read-only agency", () => {
  let h: Harness;
  let operatorA: FlowResult;
  let operatorC: FlowResult;
  let unenrolled: FlowResult;
  let tools: Tool[];
  const UNENROLLED_FB_USER_ID = "900000000000003";

  beforeAll(async () => {
    h = await bootServer({
      platform: true,
      platformRepository: await seedStrictRepository(),
      env: { AUTH_ALLOWED_FB_USER_IDS: [FB_USER_ID, OTHER_FB_USER_ID, UNENROLLED_FB_USER_ID].join(",") },
    });
    operatorA = await completeOAuthFlow(h.origin);
    operatorC = await completeOAuthFlow(h.origin, { viaMetaLogin: false, fbUserId: OTHER_FB_USER_ID });
    unenrolled = await completeOAuthFlow(h.origin, { viaMetaLogin: false, fbUserId: UNENROLLED_FB_USER_ID });
    tools = await listTools(h.origin, operatorA.tokens.access_token);
    h.upstream.setHandler((call) => {
      const path = call.url.pathname.replace(/^\/v\d+\.\d+/, "");
      if (path === "/act_101/campaigns") {
        return { body: { data: [{ id: "201", account_id: "101", name: "Synthetic campaign", status: "PAUSED", objective: "OUTCOME_LEADS" }] } };
      }
      return undefined;
    });
    h.upstream.reset();
  });
  afterEach(() => expect(h.upstream.blocked).toEqual([]));
  afterAll(async () => h.close());

  const callA = (name: string, args: Record<string, unknown>) => callTool(h.origin, operatorA.tokens.access_token, name, args);

  it("requires client_id on every legacy tool it lists, and holds the ones that cannot take it", async () => {
    const legacy = new Set(LEGACY_MANIFEST.map((entry) => entry.name));
    const listedLegacy = tools.filter((tool) => legacy.has(tool.name));
    expect(listedLegacy.length).toBeGreaterThan(40);
    const withoutClient = listedLegacy.filter((tool) => !(tool.inputSchema.required ?? []).includes("client_id"));
    expect(withoutClient.length, "strict mode lists tools whose schema has no client_id; they must all be held").toBeGreaterThan(0);
    h.upstream.reset();
    for (const tool of withoutClient) {
      const reply = await callA(tool.name, sampleArguments(tool, IDS_A));
      expect(isRejected(reply), tool.name).toBe(true);
      expect(errorText(reply), tool.name).toContain("LEGACY_STRICT_MIGRATION_HOLD");
    }
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("exposes exactly the documented set of non-read-only control tools and no provider write", () => {
    const nonReadOnly = tools.filter((tool) => tool.annotations?.readOnlyHint !== true).map((tool) => tool.name).sort();
    expect(nonReadOnly).toEqual(
      [
        "ads_update_ad_url_tags",
        "meta_discover_ad_assets",
        "meta_discover_signal_assets",
        "meta_lookup_ad_targeting",
        "meta_observe_account_owner",
        "meta_observe_ads_compatibility",
        "meta_plan_ad_tracking_change",
        "meta_plan_paused_ads",
        "meta_prepare_action",
        "meta_prepare_app_promotion_access",
        "meta_prepare_publication",
      ].sort(),
    );
    for (const absent of ["ads_create_campaign", "ads_delete_campaign", "ads_update_campaign", "ads_activate_entity", "ads_upload_ad_image"]) {
      expect(tools.some((tool) => tool.name === absent), absent).toBe(false);
    }
  });

  it("reads an authorized client's campaigns with that client's narrow credential, never the login token", async () => {
    h.upstream.reset();
    const reply = await callA("ads_get_campaigns", { client_id: TENANT_A.clientId, account_id: TENANT_A.accountId });
    expect(isRejected(reply), errorText(reply)).toBe(false);
    expect(toolText(reply)).toContain("Synthetic campaign");
    const graph = h.upstream.graphCalls();
    expect(graph).toHaveLength(1);
    expect(graph[0].method).toBe("GET");
    expect(graph[0].url.origin).toBe("https://graph.facebook.com");
    expect(graph[0].url.pathname).toMatch(/\/act_101\/campaigns$/);
    expect(graph[0].headers.get("authorization")).toBe(`Bearer ${TENANT_A.connectionToken}`);
    expect(graph[0].url.searchParams.has("access_token")).toBe(false);
    const wire = JSON.stringify([graph[0].url.href, [...graph[0].headers.entries()], graph[0].body]);
    expect(wire).not.toContain(STORED_META_TOKEN);
    expect(wire).not.toContain(operatorA.tokens.access_token);
    expect(toolText(reply)).not.toContain(TENANT_A.connectionToken);
  });

  it("discovers accounts from the client's registered assets and never from /me", async () => {
    h.upstream.reset();
    const reply = await callA("ads_get_ad_accounts", { client_id: TENANT_A.clientId });
    expect(isRejected(reply), errorText(reply)).toBe(false);
    expect(h.upstream.graphCalls().map((call) => call.url.pathname.replace(/^\/v\d+\.\d+/, ""))).toEqual(["/act_101"]);

    h.upstream.reset();
    const other = await callA("ads_get_ad_accounts", { client_id: TENANT_A.clientId, user_id: "800000000000099" });
    expect(isRejected(other)).toBe(true);
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("denies another client, another tenant's client and unknown clients before any Meta request", async () => {
    h.upstream.reset();
    const attempts: [string, Record<string, unknown>][] = [
      [CLIENT_B.clientId, { account_id: CLIENT_B.accountId }],
      [TENANT_C.clientId, { account_id: TENANT_C.accountId }],
      ["client-does-not-exist", { account_id: "101" }],
    ];
    for (const [clientId, args] of attempts) {
      const reply = await callA("ads_get_campaigns", { client_id: clientId, ...args });
      expect(isRejected(reply), clientId).toBe(true);
      expect(errorText(reply), clientId).toContain("CLIENT_ACCESS_REQUIRED");
    }
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("denies another account or campaign, even under the caller's own client id", async () => {
    h.upstream.reset();
    const foreign = await callA("ads_get_campaigns", { client_id: TENANT_A.clientId, account_id: CLIENT_B.accountId });
    expect(isRejected(foreign)).toBe(true);
    expect(errorText(foreign)).toContain("ASSET_ACCESS_REQUIRED");

    const unregistered = await callA("ads_get_campaigns", { client_id: TENANT_A.clientId, account_id: "999" });
    expect(isRejected(unregistered)).toBe(true);
    expect(errorText(unregistered)).toContain("ASSET_UNREGISTERED_OR_AMBIGUOUS");

    const campaign = await callA("ads_get_campaign_details", { client_id: TENANT_A.clientId, campaign_id: CLIENT_B.campaignId });
    expect(isRejected(campaign)).toBe(true);
    expect(errorText(campaign)).toContain("ASSET_ACCESS_REQUIRED");

    const insights = await callA("ads_get_insights", { client_id: TENANT_A.clientId, object_id: CLIENT_B.campaignId });
    expect(isRejected(insights)).toBe(true);
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("keeps operators apart: a second operator cannot use the first operator's client, and an unenrolled operator can use none", async () => {
    h.upstream.reset();
    const crossTenant = await callTool(h.origin, operatorC.tokens.access_token, "ads_get_campaigns", { client_id: TENANT_A.clientId, account_id: TENANT_A.accountId });
    expect(isRejected(crossTenant)).toBe(true);
    expect(errorText(crossTenant)).toContain("CLIENT_ACCESS_REQUIRED");

    const own = await callTool(h.origin, operatorC.tokens.access_token, "ads_get_campaigns", { client_id: TENANT_C.clientId, account_id: TENANT_C.accountId });
    expect(errorText(own)).not.toContain("CLIENT_ACCESS_REQUIRED");

    h.upstream.reset();
    const stranger = await callTool(h.origin, unenrolled.tokens.access_token, "ads_get_campaigns", { client_id: TENANT_A.clientId, account_id: TENANT_A.accountId });
    expect(isRejected(stranger)).toBe(true);
    expect(errorText(stranger)).toContain("PLATFORM_MEMBERSHIP_REQUIRED");
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("rejects calls that omit or malform the client identifier", async () => {
    h.upstream.reset();
    for (const clientId of [undefined, "", "client-a/../client-b", "client-a?x=1", "a".repeat(129)]) {
      const args: Record<string, unknown> = { account_id: "101" };
      if (clientId !== undefined) args.client_id = clientId;
      const reply = await callA("ads_get_campaigns", args);
      expect(isRejected(reply), JSON.stringify(clientId)).toBe(true);
      expect(errorText(reply), JSON.stringify(clientId)).toMatch(/Invalid arguments|client_id/);
    }
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("fails closed on legacy parameters and alternate-endpoint variants of read tools", async () => {
    h.upstream.reset();
    const variants: [string, string, Record<string, unknown>, RegExp][] = [
      ["breakdowns", "ads_get_insights", { object_id: "201", breakdowns: ["age"] }, /LEGACY_COMPLEX_INSIGHTS_CONTRACT_HOLD/],
      ["filtering", "ads_get_insights", { object_id: "201", filtering: [{ field: "x", operator: "EQUAL", value: "y" }] }, /LEGACY_COMPLEX_INSIGHTS_CONTRACT_HOLD/],
      ["attribution override", "ads_get_insights", { object_id: "201", use_unified_attribution_setting: false }, /LEGACY_ATTRIBUTION_OVERRIDE_HOLD/],
      ["secret field projection", "ads_get_campaigns", { account_id: "101", fields: ["id", "access_token"] }, /LEGACY_FIELD_PROJECTION_DENIED/],
      ["nested field expansion", "ads_get_campaigns", { account_id: "101", fields: ["id", "adaccount{funding_source_details}"] }, /LEGACY_FIELD_PROJECTION_DENIED/],
      ["edge smuggled into an id", "ads_get_campaign_details", { campaign_id: "201/adaccounts" }, /LEGACY_ASSET_ID_INVALID/],
      ["path traversal in an id", "ads_get_campaigns", { account_id: "101/../me" }, /LEGACY_ASSET_ID_INVALID/],
      ["query string in an id", "ads_get_campaign_details", { campaign_id: "201?fields=access_token" }, /LEGACY_ASSET_ID_INVALID/],
      ["unbounded limit", "ads_get_campaigns", { account_id: "101", limit: 100000 }, /Invalid arguments/],
      ["unknown status filter", "ads_get_campaigns", { account_id: "101", status_filter: ["EVERYTHING"] }, /Invalid arguments|STATUS_FILTER_INVALID/],
    ];
    for (const [label, tool, args, expected] of variants) {
      const reply = await callA(tool, { client_id: TENANT_A.clientId, ...args });
      expect(isRejected(reply), label).toBe(true);
      expect(errorText(reply), label).toMatch(expected);
    }
    expect(h.upstream.graphCalls(), "none of the variants may reach Meta").toHaveLength(0);
  }, 120_000);

  it("ignores a caller-supplied access_token instead of forwarding it", async () => {
    h.upstream.reset();
    const attacker = "synthetic-attacker-supplied-token";
    await callA("ads_get_campaigns", { client_id: TENANT_A.clientId, account_id: TENANT_A.accountId, access_token: attacker });
    const graph = h.upstream.graphCalls();
    expect(graph).toHaveLength(1);
    expect(JSON.stringify([graph[0].url.href, [...graph[0].headers.entries()], graph[0].body])).not.toContain(attacker);
    expect(graph[0].headers.get("authorization")).toBe(`Bearer ${TENANT_A.connectionToken}`);
  });

  it("refuses the X-Meta-Token override in strict mode too", async () => {
    h.upstream.reset();
    const reply = await mcpPost(
      h.origin,
      operatorA.tokens.access_token,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ads_get_campaigns", arguments: { client_id: TENANT_A.clientId, account_id: TENANT_A.accountId } } },
      { "x-meta-token": "synthetic-override-token" },
    );
    expect(reply.status).toBe(403);
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

  it("sends no Meta request for any listed tool when called with a client the operator does not belong to", async () => {
    h.upstream.reset();
    const outcomes = { policy: 0, schema: 0, localOnly: [] as string[] };
    for (const tool of tools) {
      const reply = await callA(tool.name, sampleArguments(tool, IDS_B));
      const text = errorText(reply);
      if (!isRejected(reply)) {
        outcomes.localOnly.push(tool.name);
        continue;
      }
      if (/Invalid arguments|Input validation/.test(text)) outcomes.schema += 1;
      else outcomes.policy += 1;
    }
    expect(h.upstream.graphCalls(), "no listed tool may reach Meta on behalf of a foreign client").toHaveLength(0);
    expect(outcomes.policy, "the sweep must exercise the authorization layer, not only schema validation").toBeGreaterThan(30);
    console.info(`foreign-client sweep: ${tools.length} tools, ${outcomes.policy} policy denials, ${outcomes.schema} schema rejections, succeeded without Meta: ${outcomes.localOnly.join(", ") || "none"}`);
  }, 180_000);

  it("confines every Meta request made on behalf of the authorized client to GETs with that client's credential", async () => {
    const own = new Set(["101", "act_101", "201"]);
    const held: string[] = [];
    let requests = 0;
    for (const tool of tools) {
      h.upstream.reset();
      const reply = await callA(tool.name, sampleArguments(tool, IDS_A));
      if (/LEGACY_STRICT_MIGRATION_HOLD/.test(errorText(reply))) {
        held.push(tool.name);
        expect(h.upstream.graphCalls(), `${tool.name} is held and must not call Meta`).toHaveLength(0);
      }
      for (const call of h.upstream.graphCalls()) {
        requests += 1;
        const path = call.url.pathname.replace(/^\/v\d+\.\d+/, "");
        const where = `${tool.name} ${call.method} ${path}`;
        expect(call.method, where).toBe("GET");
        expect(call.headers.get("authorization"), where).toBe(`Bearer ${TENANT_A.connectionToken}`);
        expect(call.url.searchParams.has("access_token"), where).toBe(false);
        expect(path, where).not.toMatch(/^\/(me|debug_token|oauth)/);
        const root = path.split("/")[1];
        expect(own.has(root), `${where}: root object ${root} is not one of the client's registered assets`).toBe(true);
        expect(JSON.stringify([call.url.href, [...call.headers.entries()], call.body]), where).not.toContain(STORED_META_TOKEN);
      }
    }
    expect(requests, "the sweep must produce some real upstream traffic to be meaningful").toBeGreaterThan(5);
    expect(held.length, "unmigrated legacy tools must answer HOLD").toBeGreaterThan(0);
    console.info(`authorized sweep: ${requests} upstream requests across ${tools.length} tools, ${held.length} held: ${held.join(", ")}`);
  }, 180_000);

  it("only ever issued GET requests to the Graph host during the whole strict read-only session", () => {
    const methods = new Set(h.upstream.graphCalls().map((call) => call.method));
    expect([...methods].filter((method) => method !== "GET")).toEqual([]);
  });
});

describe("strict platform mode with the write flags on", () => {
  let h: Harness;
  let operatorA: FlowResult;
  let tools: Tool[];

  beforeAll(async () => {
    h = await bootServer({ platform: true, writes: true, platformWrites: true, platformRepository: await seedStrictRepository() });
    operatorA = await completeOAuthFlow(h.origin);
    tools = await listTools(h.origin, operatorA.tokens.access_token);
    h.upstream.reset();
  });
  afterEach(() => expect(h.upstream.blocked).toEqual([]));
  afterAll(async () => h.close());

  it("requires client_id and an approval reference on the typed write tools", () => {
    const create = tools.find((tool) => tool.name === "ads_create_campaign")!;
    expect(create.inputSchema.required).toContain("client_id");
    expect(Object.keys(create.inputSchema.properties)).toContain("approval_id");
    expect(tools.filter((tool) => tool.annotations?.readOnlyHint !== true).length).toBeGreaterThan(100);
  });

  it("does not let any write call reach Meta without an issued human approval, a write grant and a client membership", async () => {
    const approval = "00000000-0000-4000-8000-000000000000";
    const writes: [string, Record<string, unknown>, string][] = [
      ["ads_update_campaign", { client_id: "client-a", campaign_id: "201", name: "Synthetic rename", status: "PAUSED" }, "PERMISSION_OR_CONNECTION_REQUIRED"],
      ["ads_update_campaign", { client_id: "client-a", campaign_id: "201", name: "Synthetic rename", status: "PAUSED", approval_id: approval }, "PERMISSION_OR_CONNECTION_REQUIRED"],
      ["ads_update_campaign", { client_id: "client-b", campaign_id: "302", name: "Synthetic rename", status: "PAUSED", approval_id: approval }, "CLIENT_ACCESS_REQUIRED"],
      ["ads_update_campaign", { client_id: "client-a", campaign_id: "201", status: "ACTIVE", approval_id: approval }, "UPDATE_MUST_REMAIN_PAUSED"],
      ["ads_create_campaign", { client_id: "client-a", account_id: "act_101", name: "Synthetic", objective: "OUTCOME_LEADS", status: "ACTIVE", approval_id: approval }, "CREATE_MUST_REMAIN_PAUSED"],
      ["ads_delete_campaign", { client_id: "client-a", campaign_id: "201", approval_id: approval }, "LEGACY_STRICT_MIGRATION_HOLD"],
    ];
    h.upstream.reset();
    for (const [name, args, reason] of writes) {
      const reply = await callTool(h.origin, operatorA.tokens.access_token, name, args);
      expect(isRejected(reply), `${name} ${JSON.stringify(args).slice(0, 80)}`).toBe(true);
      expect(errorText(reply), name).toContain(reason);
    }
    expect(h.upstream.graphCalls()).toHaveLength(0);
  });

});
