import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { encryptCredential } from "../../src/platform/connections.js";
import { AssetDiscoveryService } from "../../src/platform/discovery-service.js";
import { createApprovalRouter } from "../../src/platform/approval-router.js";
import { expandVerifiedPermissionDependencies } from "../../src/platform/products/permission-dependencies.js";
import { reportChainOrphans } from "../../src/platform/marketing-chain-report.js";
import { establishFinancialFixture } from "./financial-fixture.js";
import { budgetCeilingDocument } from "./budget-ceiling-fixture.js";
import { BUDGET_CEILINGS_ENV } from "../../src/platform/marketing-budget-ceiling.js";

const SOURCE = "https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py";
const ORIGIN = "https://fixture.invalid";
const IMAGE_HASH = "a".repeat(32);
const TOKEN = "synthetic-workflow-token";
const actor = { tenantId: "tenant", operatorId: "100" };
const nativeFetch = globalThis.fetch;

type Result = Awaited<ReturnType<Client["callTool"]>>;
const text = (r: Result) => (r.content as Array<{ text: string }>)[0].text;
const json = (r: Result) => JSON.parse(text(r)) as Record<string, unknown>;

interface Harness {
  repo: InMemoryPlatformRepository;
  call: (name: string, args: Record<string, unknown>) => Promise<Result>;
  providerCalls: Array<{ method: string; path: string; body: URLSearchParams | undefined }>;
  posts: () => Array<{ path: string; body: URLSearchParams }>;
  nativeHosts: Set<string>;
  providerHosts: Set<string>;
  violations: string[];
  transcript: string[];
  failNext: { path: string | null };
  humanSignedIn: { value: boolean };
  base: string;
}

let httpServer: Server | undefined;
let closers: Array<() => Promise<void>> = [];
let current: Harness | undefined;

beforeEach(() => {
  for (const key of ["LUMIN_PLATFORM_ENABLED", "LUMIN_PLATFORM_WRITES_ENABLED", "AGENCY_WRITES_ENABLED", "LUMIN_PLATFORM_DISCOVERY_ENABLED"]) {
    vi.stubEnv(key, "true");
  }
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "c".repeat(64));
  vi.stubEnv("META_APP_ID", "300");
  vi.stubEnv("META_API_VERSION", "v26.0");
  vi.stubEnv("DEPLOYMENT_MODE", "legacy");
  vi.stubEnv(BUDGET_CEILINGS_ENV, budgetCeilingDocument({ client: { daily: "50.00", lifetime: "500.00" }, "other-client": { daily: "50.00", lifetime: "500.00" } }));
});

afterEach(async () => {
  const h = current;
  current = undefined;
  for (const close of closers.reverse()) await close();
  closers = [];
  configurePlatformRepository(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (h) {
    expect(h.violations, "provider contract violations").toEqual([]);
    expect([...h.nativeHosts], "only loopback may reach the real network stack").toEqual(h.nativeHosts.size ? ["127.0.0.1"] : []);
    expect([...h.providerHosts].every((host) => host === "graph.facebook.com")).toBe(true);
    console.log(`\n=== TRANSCRIPT: ${expect.getState().currentTestName} ===\n${h.transcript.join("\n")}\n`);
  }
});

async function harness(): Promise<Harness> {
  const repo = new InMemoryPlatformRepository();
  const now = Date.now();
  await repo.put("tenants", "tenant", "tenant", { id: "tenant", status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
  for (const id of ["100", "200"]) {
    await repo.put("operatorIndex", "_index", id, { operatorId: id, tenantId: "tenant" });
    await repo.put("members", "tenant", id, { operatorId: id, tenantId: "tenant", roles: ["admin"], allowedClientIds: ["client", "other-client"], disabledAt: null, revision: 1 });
  }
  for (const id of ["client", "other-client"]) {
    await repo.put("clients", "tenant", id, { id, tenantId: "tenant", status: "ACTIVE", verifiedBusinessIds: [id === "client" ? "900" : "910"], revision: 1 });
  }
  const base = { tenantId: "tenant", provider: "META_MARKETING" as const, appId: "300", verifiedAt: now, revokedAt: null, revision: 1 };
  const mine = { ...base, clientId: "client" };
  const theirs = { ...base, clientId: "other-client" };
  await repo.put("assets", "tenant", "account", { ...mine, key: "account", type: "AD_ACCOUNT", id: "101", parents: [], ownerBusinessId: "900", billingOwnershipVerified: true, ownershipEvidenceSource: SOURCE, ownershipEvidenceVerifiedAt: now });
  await repo.put("assets", "tenant", "page", { ...mine, key: "page", type: "PAGE", id: "601", parents: [] });
  await repo.put("assets", "tenant", "o-account", { ...theirs, key: "o-account", type: "AD_ACCOUNT", id: "901", parents: [], ownerBusinessId: "910", billingOwnershipVerified: true, ownershipEvidenceSource: SOURCE, ownershipEvidenceVerifiedAt: now });
  await repo.put("assets", "tenant", "o-campaign", { ...theirs, key: "o-campaign", type: "CAMPAIGN", id: "951", parents: [{ type: "AD_ACCOUNT", id: "901" }] });
  await repo.put("assets", "tenant", "o-adset", { ...theirs, key: "o-adset", type: "AD_SET", id: "961", parents: [{ type: "CAMPAIGN", id: "951" }, { type: "AD_ACCOUNT", id: "901" }] });
  await repo.put("assets", "tenant", "o-creative", { ...theirs, key: "o-creative", type: "CREATIVE", id: "971", parents: [{ type: "AD_ACCOUNT", id: "901" }] });
  const capabilities = ["ads_create_campaign", "ads_create_ad_set", "ads_create_ad_creative", "ads_create_ad", "ads_update_ad_set", "ads_get_account_info", "ads_get_campaign_details", "ads_get_creative_details", "ads_get_ad_set_details", "ads_get_lead_forms", "ads_get_ad_images"].map((t) => `legacy.${t}`);
  const grant = (key: string, clientId: string, tasks: string[]) => repo.put("grants", "tenant", key, { id: key, tenantId: "tenant", clientId, assetKey: key, connectionId: "connection", capabilities, actions: ["READ", "WRITE_AD_CONFIGURATION", "WRITE_BUDGET"], tasks, verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1 });
  await grant("account", "client", []);
  await grant("page", "client", ["ADVERTISE"]);
  for (const key of ["o-account", "o-campaign", "o-adset", "o-creative"]) await grant(key, "other-client", []);
  await repo.put("connections", "tenant", "connection", {
    id: "connection", tenantId: "tenant", operatorId: "100", provider: "META_MARKETING", appId: "300", credentialId: "credential", authStrategy: "synthetic", tokenType: "page", subjectId: "601",
    scopes: expandVerifiedPermissionDependencies(["ads_read", "ads_management", "pages_manage_ads"]),
    assetKeys: ["account", "page", "o-account", "o-campaign", "o-adset", "o-creative"], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1,
    eligibility: ["marketing_read_access:v26.0", "marketing_write_access:v26.0", "marketing_lead_terms_accepted:601"].map((requirement) => ({ requirement, source: SOURCE, verified: true, checkedAt: now, expiresAt: now + 300000 })),
  });
  await repo.put("credentials", "tenant", "credential", encryptCredential({ id: "credential", tenantId: "tenant", operatorId: "100", provider: "META_MARKETING", appId: "300", keyVersion: "primary" }, TOKEN));

  const providerCalls: Harness["providerCalls"] = [];
  const nativeHosts = new Set<string>();
  const providerHosts = new Set<string>();
  const violations: string[] = [];
  const failNext = { path: null as string | null };
  let story: unknown;
  const ids: Record<string, string> = { campaigns: "201", adsets: "301", adcreatives: "501", ads: "401" };

  const provider = async (raw: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
    const url = new URL(String(raw));
    providerHosts.add(url.hostname);
    const method = options?.method ?? "GET";
    const body = options?.body ? new URLSearchParams(String(options.body)) : undefined;
    providerCalls.push({ method, path: url.pathname, body });
    if (url.origin !== "https://graph.facebook.com") violations.push(`unexpected origin ${url.origin}`);
    if (new Headers(options?.headers).get("authorization") !== `Bearer ${TOKEN}`) violations.push(`missing bearer on ${url.pathname}`);
    if (url.searchParams.has("access_token")) violations.push("token in query string");
    if (options?.redirect !== "error") violations.push("redirect not refused");
    const path = url.pathname;
    if (method === "POST") {
      const edge = path.split("/").pop()!;
      if (body?.get("status") !== (edge === "adcreatives" ? null : "PAUSED")) violations.push(`non-PAUSED write to ${path}`);
      if (failNext.path === edge) {
        failNext.path = null;
        return new Response(JSON.stringify({ error: { message: "synthetic provider outage", code: 2 } }), { status: 500 });
      }
      if (edge === "adcreatives") story = JSON.parse(body!.get("object_story_spec")!);
      return new Response(JSON.stringify({ id: ids[edge] }));
    }
    const reply = path.endsWith("/adimages")
      ? { data: [{ hash: IMAGE_HASH, account_id: "101", name: "Client image" }] }
      : path.endsWith("/leadgen_forms") ? { data: [{ id: "701", name: "Client form", status: "ACTIVE" }] }
      : path.endsWith("/act_101") ? { id: "act_101", account_id: "101" }
      : path.endsWith("/601") ? { id: "601" }
      : path.endsWith("/201") ? { id: "201", account_id: "101", objective: "OUTCOME_LEADS", buying_type: "AUCTION", status: "PAUSED", daily_budget: "0", lifetime_budget: "0", special_ad_categories: [] }
      : path.endsWith("/301") ? { id: "301", account_id: "101", campaign_id: "201", destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION", promoted_object: { page_id: "601" } }
      : path.endsWith("/501") ? { id: "501", account_id: "101", object_story_spec: story }
      : {};
    return new Response(JSON.stringify(reply));
  };
  vi.stubGlobal("fetch", (input: RequestInfo | URL, options?: RequestInit) => {
    const hostname = new URL(input instanceof Request ? input.url : String(input)).hostname;
    if (hostname === "127.0.0.1") {
      nativeHosts.add(hostname);
      return nativeFetch(input, options);
    }
    if (hostname === "graph.facebook.com") return provider(input, options);
    nativeHosts.add(hostname);
    throw new Error(`blocked non-loopback host ${hostname}`);
  });

  await establishFinancialFixture(repo, actor, "client", "account");
  configurePlatformRepository(repo);

  const humanSignedIn = { value: false };
  const app = express();
  app.use(cookieParser());
  app.use("/platform/approvals", createApprovalRouter({ repo, origin: ORIGIN, csrfSecret: "synthetic-csrf-secret-".repeat(4), resolveSession: async () => (humanSignedIn.value ? { tenantId: "tenant", operatorId: "200" } : null) }));
  httpServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => httpServer!.once("listening", resolve));
  const server = httpServer;
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const mcp = createServer();
  const client = new Client({ name: "synthetic-financial-workflow", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(st), client.connect(ct)]);
  closers.push(async () => { await client.close(); await mcp.close(); });

  const h: Harness = {
    repo, nativeHosts, providerHosts, violations, transcript: [], failNext, humanSignedIn,
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    call: (name, args) => requestContext.run({ fbUserId: "100" }, () => client.callTool({ name, arguments: args })),
    providerCalls,
    posts: () => providerCalls.filter((c) => c.method === "POST").map((c) => ({ path: c.path, body: c.body! })),
  };
  current = h;

  const discovery = new AssetDiscoveryService(repo, { fetcher: provider as unknown as typeof fetch });
  const ctx = { principal: actor, clientId: "client", provider: "META_MARKETING" as const, tool: "meta_discover_ad_assets", requestId: "synthetic" };
  for (const kind of ["AD_IMAGE", "LEAD_FORM"] as const) {
    const proposed = await discovery.prepare(ctx, "account", kind, "connection");
    await discovery.enroll({ tenantId: "tenant", operatorId: "200" }, proposed.proposalId, proposed.planHash);
  }
  h.providerCalls.length = 0;
  h.transcript.push(`[00] connect: synthetic client "client" (account 101, page 601, ceiling USD 50.00/day), human approver 200 via approval router; image + lead form enrolled by human discovery`);
  return h;
}

const STEPS: Array<[string, Record<string, unknown>]> = [
  ["ads_create_campaign", { account_id: "101", page_id: "601", name: "Reviewed lead campaign", objective: "OUTCOME_LEADS" }],
  ["ads_create_ad_set", { account_id: "101", campaign_id: "201", name: "Reviewed lead adset", destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION", daily_budget: 2000, bid_amount: 100, promoted_object: { page_id: "601" }, targeting: { geo_locations: { countries: ["US"] } } }],
  ["ads_create_ad_creative", { account_id: "101", page_id: "601", lead_form_id: "701", image_hash: IMAGE_HASH, name: "Reviewed lead creative", link_url: "https://fb.me/", message: "Reviewed client copy" }],
  ["ads_create_ad", { account_id: "101", ad_set_id: "301", creative_id: "501", page_id: "601", lead_form_id: "701", name: "Reviewed lead ad" }],
];

let stepNumber = 0;
const label = (n: number) => String(n).padStart(2, "0");

/** observe -> prepare -> human approval through the approval router -> status. Returns the approval id. */
async function approve(h: Harness, tool: string, input: Record<string, unknown>): Promise<string> {
  const observed = await h.call("meta_observe_ads_compatibility", { client_id: "client", connection_id: "connection", tool, input });
  expect(observed.isError, text(observed)).not.toBe(true);
  const prepared = await h.call("meta_prepare_action", { client_id: "client", tool, asset_id: "101", input });
  expect(prepared.isError, text(prepared)).not.toBe(true);
  const meta = json(prepared) as { request_id: string; review_path: string };
  h.humanSignedIn.value = false;
  expect((await nativeFetch(h.base + meta.review_path)).status, "the model cannot approve: review needs a human session").toBe(403);
  h.humanSignedIn.value = true;
  const review = await nativeFetch(h.base + meta.review_path);
  const html = await review.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  const cookie = review.headers.get("set-cookie")!.split(";")[0];
  const approved = await nativeFetch(h.base + meta.review_path, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ csrf, decision: "approve" }) });
  expect(approved.status).toBe(200);
  h.humanSignedIn.value = false;
  const status = await h.call("meta_get_action_status", { client_id: "client", request_id: meta.request_id });
  expect(status.isError, text(status)).not.toBe(true);
  const approvalId = (json(status) as { approval_id: string }).approval_id;
  expect(approvalId).toBeTruthy();
  h.transcript.push(`[${label(++stepNumber)}] ${tool}: observed, prepared, human-approved via router (approval ${approvalId.slice(0, 8)}…)`);
  return approvalId;
}

async function execute(h: Harness, tool: string, input: Record<string, unknown>, approvalId: string): Promise<Result> {
  const before = h.posts().length;
  const result = await h.call(tool, { ...input, client_id: "client", approval_id: approvalId });
  h.transcript.push(`[${label(++stepNumber)}] ${tool}: ${result.isError ? "DENIED/FAILED" : "executed"} -> ${text(result).slice(0, 160)} (provider writes +${h.posts().length - before})`);
  return result;
}

async function chain(h: Harness, upTo = STEPS.length): Promise<void> {
  for (const [tool, input] of STEPS.slice(0, upTo)) {
    const approval = await approve(h, tool, input);
    const result = await execute(h, tool, input, approval);
    expect(result.isError, text(result)).not.toBe(true);
    expect(json(result).registered).toBe(true);
  }
}

beforeEach(() => { stepNumber = 0; });

/** A second, USER-token connection over the registered chain: the only kind of connection marketing_activate_ad can select. */
async function seedUserConnection(h: Harness): Promise<void> {
  const now = Date.now();
  const assets = (await h.repo.list("assets", "tenant")).filter((a) => a.clientId === "client");
  await h.repo.put("connections", "tenant", "user-connection", {
    id: "user-connection", tenantId: "tenant", operatorId: "100", provider: "META_MARKETING", appId: "300", credentialId: "credential", authStrategy: "synthetic", tokenType: "user",
    scopes: expandVerifiedPermissionDependencies(["public_profile", "ads_read", "ads_management"]), assetKeys: assets.map((a) => a.key), verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1,
    eligibility: ["marketing_read_access:v26.0", "marketing_write_access:v26.0"].map((requirement) => ({ requirement, source: SOURCE, verified: true, checkedAt: now, expiresAt: now + 300000 })),
  });
  for (const a of assets) {
    await h.repo.put("grants", "tenant", `user-${a.key}`, {
      id: `user-${a.key}`, tenantId: "tenant", clientId: "client", assetKey: a.key, connectionId: "user-connection", capabilities: ["marketing.activate.ad", "legacy.ads_get_account_info"],
      actions: ["READ", "ACTIVATE_SPEND"], tasks: a.type === "PAGE" ? ["ADVERTISE"] : [], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1,
    });
  }
}

const ACTIVATION_INPUT = {
  expected_creative_id: "501",
  expected_campaign_daily_budget: 0,
  expected_adset_daily_budget: 2000,
  expected_currency: "USD",
  expected_campaign_objective: "OUTCOME_LEADS",
  expected_optimization_goal: "LEAD_GENERATION",
  expected_bid_strategy: "LOWEST_COST_WITH_BID_CAP",
  expected_bid_amount: 100,
};

/** Calls a tool and records the denial; never throws so the caller can assert on the exact reason. */
async function attempt(h: Harness, note: string, tool: string, args: Record<string, unknown>): Promise<Result> {
  const before = h.providerCalls.length;
  const result = await h.call(tool, args);
  h.transcript.push(`[${label(++stepNumber)}] ${note}: ${tool} -> ${result.isError ? "DENIED" : "ALLOWED"} ${text(result).slice(0, 140)} (provider requests +${h.providerCalls.length - before})`);
  return result;
}

describe("campaign -> ad set -> creative -> ad financial safety workflow (synthetic client, fake provider)", () => {
  it("creates the whole chain PAUSED through four separately approved steps", async () => {
    const h = await harness();
    await chain(h);
    const posts = h.posts();
    expect(posts.map((p) => p.path)).toEqual(["/v26.0/act_101/campaigns", "/v26.0/act_101/adsets", "/v26.0/act_101/adcreatives", "/v26.0/act_101/ads"]);
    expect(posts.filter((p) => p.path !== "/v26.0/act_101/adcreatives").every((p) => p.body.get("status") === "PAUSED")).toBe(true);
    expect(posts.some((p) => [...p.body.values()].some((v) => /ACTIVE/.test(v)))).toBe(false);
    expect(posts[1].body.get("daily_budget")).toBe("2000");
    const assets = await h.repo.list("assets", "tenant");
    expect(assets.filter((a) => a.clientId === "client" && ["CAMPAIGN", "AD_SET", "CREATIVE", "AD"].includes(a.type)).map((a) => a.type).sort()).toEqual(["AD", "AD_SET", "CAMPAIGN", "CREATIVE"]);
    expect((await h.repo.list("operations", "tenant")).filter((o) => o.state === "SUCCEEDED")).toHaveLength(4);
    expect(reportChainOrphans("client", assets, await h.repo.list("operations", "tenant"))).toEqual({ clientId: "client", orphans: [], unresolvedOperations: [] });
    expect(JSON.stringify(await h.repo.list("controlAudit", "tenant"))).not.toContain(TOKEN);
  });

  it("never activates: the deployment flag and a human approval are both required, and create/update refuse ACTIVE", async () => {
    const h = await harness();
    await chain(h);
    const writes = h.posts().length;
    await seedUserConnection(h);
    const activate = (approval?: string) => attempt(h, "activation", "marketing_activate_ad", { client_id: "client", asset_id: "401", connection_id: "user-connection", input: ACTIVATION_INPUT, ...(approval ? { approval_id: approval } : {}) });

    const noFlag = await activate();
    expect(noFlag.isError).toBe(true);
    expect(text(noFlag)).toContain("MARKETING_ACTIVATION_DISABLED_BY_DEPLOYMENT");
    const bogus = await activate("00000000-0000-4000-8000-000000000000");
    expect(bogus.isError).toBe(true);
    expect(text(bogus)).toContain("MARKETING_ACTIVATION_DISABLED_BY_DEPLOYMENT");

    vi.stubEnv("LUMIN_MARKETING_ACTIVATION_ENABLED", "true");
    const noApproval = await activate();
    expect(noApproval.isError).toBe(true);
    expect(text(noApproval)).toContain("HUMAN_APPROVAL_REQUIRED");
    const forged = await activate("00000000-0000-4000-8000-000000000000");
    expect(forged.isError).toBe(true);
    expect(text(forged)).toContain("APPROVAL_INVALID_OR_REPLAYED");

    const campaign = await attempt(h, "create with ACTIVE", "ads_create_campaign", { ...STEPS[0][1], status: "ACTIVE", client_id: "client" });
    const adset = await attempt(h, "update ad set to ACTIVE", "ads_update_ad_set", { ad_set_id: "301", status: "ACTIVE", client_id: "client" });
    const ad = await attempt(h, "update ad to ACTIVE", "ads_update_ad", { ad_id: "401", status: "ACTIVE", client_id: "client" });
    const generic = await attempt(h, "generic entity update to ACTIVE", "ads_update_entity", { client_id: "client", entity_type: "ad", entity_id: "401", updates: { status: "ACTIVE" } });
    expect(text(campaign)).toContain("CREATE_MUST_REMAIN_PAUSED");
    for (const denied of [adset, ad, generic]) expect(text(denied)).toContain("UPDATE_MUST_REMAIN_PAUSED");
    for (const denied of [campaign, adset, ad, generic]) expect(denied.isError).toBe(true);

    expect(h.posts()).toHaveLength(writes);
    expect(h.posts().some((p) => [...p.body.values()].some((v) => v === "ACTIVE"))).toBe(false);
    expect((await h.repo.list("operations", "tenant")).filter((o) => o.tool === "marketing_activate_ad")).toHaveLength(0);
  });

  it("denies an over-ceiling budget before any approval is consumed or provider request is built, and fails closed without a ceiling", async () => {
    const h = await harness();
    await chain(h, 1);
    const overCeiling = { ...STEPS[1][1], daily_budget: 5001 };
    const requestsBefore = (await h.repo.list("approvalRequests", "tenant")).length;
    const writesBefore = h.posts().length;

    const observed = await attempt(h, "ad set 1 minor unit over the USD 50.00/day ceiling", "meta_observe_ads_compatibility", { client_id: "client", connection_id: "connection", tool: "ads_create_ad_set", input: overCeiling });
    expect(observed.isError).toBe(true);
    expect(text(observed)).toContain("BUDGET_CEILING_EXCEEDED");
    const prepared = await attempt(h, "prepare the same ad set", "meta_prepare_action", { client_id: "client", tool: "ads_create_ad_set", asset_id: "101", input: overCeiling });
    expect(prepared.isError).toBe(true);
    expect(text(prepared)).toContain("BUDGET_CEILING_EXCEEDED");
    const direct = await attempt(h, "execute without approval", "ads_create_ad_set", { ...overCeiling, client_id: "client" });
    expect(direct.isError).toBe(true);
    expect(text(direct)).toContain("BUDGET_CEILING_EXCEEDED");
    const update = await attempt(h, "raise an existing ad set past the ceiling", "ads_update_ad_set", { ad_set_id: "301", daily_budget: 9_999_999, client_id: "client" });
    expect(update.isError).toBe(true);
    expect(text(update)).toContain("BUDGET_CEILING_EXCEEDED");
    expect((await h.repo.list("approvalRequests", "tenant")).length).toBe(requestsBefore);
    expect(h.posts()).toHaveLength(writesBefore);

    const approval = await approve(h, "ads_create_ad_set", STEPS[1][1]);
    const raised = await attempt(h, "execute an approval for USD 20.00 with a USD 60.00 budget", "ads_create_ad_set", { ...STEPS[1][1], daily_budget: 6000, client_id: "client", approval_id: approval });
    expect(raised.isError).toBe(true);
    expect(text(raised)).toContain("BUDGET_CEILING_EXCEEDED");
    expect((await h.repo.get("approvals", "tenant", approval))?.consumedAt, "the approval is still unspent").toBeNull();
    const withinButChanged = await attempt(h, "execute the same approval with a different in-ceiling budget", "ads_create_ad_set", { ...STEPS[1][1], daily_budget: 3000, client_id: "client", approval_id: approval });
    expect(withinButChanged.isError).toBe(true);
    expect(h.posts()).toHaveLength(writesBefore);

    const exact = { ...STEPS[1][1], daily_budget: 5000 };
    const exactApproval = await approve(h, "ads_create_ad_set", exact);
    const atCeiling = await execute(h, "ads_create_ad_set", exact, exactApproval);
    expect(atCeiling.isError, text(atCeiling)).not.toBe(true);
    expect(h.posts().at(-1)!.body.get("daily_budget")).toBe("5000");

    vi.stubEnv(BUDGET_CEILINGS_ENV, budgetCeilingDocument({ "other-client": {} }));
    const unconfigured = await attempt(h, "client without a configured ceiling", "meta_observe_ads_compatibility", { client_id: "client", connection_id: "connection", tool: "ads_create_ad_set", input: STEPS[1][1] });
    expect(unconfigured.isError).toBe(true);
    expect(text(unconfigured)).toContain("BUDGET_CEILING_NOT_CONFIGURED");
    vi.stubEnv(BUDGET_CEILINGS_ENV, "{broken");
    const unreadable = await attempt(h, "unreadable ceiling document", "meta_observe_ads_compatibility", { client_id: "client", connection_id: "connection", tool: "ads_create_ad_set", input: STEPS[1][1] });
    expect(unreadable.isError).toBe(true);
    expect(text(unreadable)).toContain("BUDGET_CEILING_CONFIG_INVALID");
  });

  it("makes every approval one-use: replaying an executed step is denied and writes nothing", async () => {
    const h = await harness();
    const [tool, input] = STEPS[0];
    const approval = await approve(h, tool, input);
    const first = await execute(h, tool, input, approval);
    expect(first.isError, text(first)).not.toBe(true);
    expect(h.posts()).toHaveLength(1);
    expect((await h.repo.get("approvals", "tenant", approval))?.consumedAt).not.toBeNull();

    const replay = await attempt(h, "replay the consumed approval", tool, { ...input, client_id: "client", approval_id: approval });
    expect(replay.isError).toBe(true);
    expect(text(replay)).toContain("APPROVAL_INVALID_OR_REPLAYED");
    const reused = await attempt(h, "reuse the campaign approval for the ad set", "ads_create_ad_set", { ...STEPS[1][1], client_id: "client", approval_id: approval });
    expect(reused.isError).toBe(true);
    expect(h.posts()).toHaveLength(1);
    expect((await h.repo.list("assets", "tenant")).filter((a) => a.clientId === "client" && a.type === "CAMPAIGN")).toHaveLength(1);
    expect((await h.repo.list("operations", "tenant")).filter((o) => o.tool === "ads_create_campaign")).toHaveLength(1);
  });

  it("leaves nothing active when the provider fails mid-chain, and reports the orphans", async () => {
    const h = await harness();
    await chain(h, 2);
    h.failNext.path = "adcreatives";
    const [tool, input] = STEPS[2];
    const approval = await approve(h, tool, input);
    const failed = await execute(h, tool, input, approval);
    expect(failed.isError).toBe(true);
    expect(text(failed)).toContain("LEGACY_WRITE_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED");

    const retried = await attempt(h, "retry the failed creative with the spent approval", tool, { ...input, client_id: "client", approval_id: approval });
    expect(retried.isError).toBe(true);
    const adWithoutCreative = await attempt(h, "continue to the ad without a registered creative", "meta_observe_ads_compatibility", { client_id: "client", connection_id: "connection", tool: "ads_create_ad", input: STEPS[3][1] });
    expect(adWithoutCreative.isError).toBe(true);

    const writes = h.posts();
    expect(writes.map((p) => p.path.split("/").pop())).toEqual(["campaigns", "adsets", "adcreatives"]);
    expect(writes.some((p) => [...p.body.values()].some((v) => v === "ACTIVE"))).toBe(false);
    const assets = await h.repo.list("assets", "tenant");
    expect(assets.some((a) => a.clientId === "client" && (a.type === "AD" || a.type === "CREATIVE"))).toBe(false);

    const report = reportChainOrphans("client", assets, await h.repo.list("operations", "tenant"));
    h.transcript.push(`[${label(++stepNumber)}] orphan report: ${JSON.stringify(report)}`);
    expect(report.orphans).toEqual([
      { type: "AD_SET", id: "301", reason: "AD_SET_WITHOUT_AD" },
      { type: "CAMPAIGN", id: "201", reason: "CAMPAIGN_WITHOUT_AD" },
    ].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)));
    expect(report.unresolvedOperations).toEqual([expect.objectContaining({ tool: "ads_create_ad_creative", state: "UNKNOWN" })]);
  });

  it("rejects another client's asset ids and approvals, before any provider request", async () => {
    const h = await harness();
    await chain(h, 1);
    const writes = h.posts().length;
    const reads = h.providerCalls.length;
    const foreign: Array<[string, string, Record<string, unknown>]> = [
      ["ad set under the other client's campaign 951", "ads_create_ad_set", { ...STEPS[1][1], campaign_id: "951" }],
      ["campaign on the other client's account 901", "ads_create_campaign", { ...STEPS[0][1], account_id: "901" }],
      ["ad on the other client's ad set 961 and creative 971", "ads_create_ad", { account_id: "101", ad_set_id: "961", creative_id: "971", page_id: "601", lead_form_id: "701", name: "Cross-client ad" }],
      ["ad using the other client's creative 971", "ads_create_ad", { account_id: "101", ad_set_id: "301", creative_id: "971", page_id: "601", lead_form_id: "701", name: "Cross-client creative" }],
    ];
    for (const [note, tool, input] of foreign) {
      const observed = await attempt(h, `observe ${note}`, "meta_observe_ads_compatibility", { client_id: "client", connection_id: "connection", tool, input });
      const prepared = await attempt(h, `prepare ${note}`, "meta_prepare_action", { client_id: "client", tool, asset_id: tool === "ads_create_campaign" ? "901" : "101", input });
      const direct = await attempt(h, `execute ${note}`, tool, { ...input, client_id: "client" });
      for (const result of [observed, prepared, direct]) expect(result.isError, note).toBe(true);
    }
    const mine = await approve(h, "ads_create_ad_set", STEPS[1][1]);
    const stolen = await attempt(h, "use client's approval as other-client", "ads_create_ad_set", { ...STEPS[1][1], client_id: "other-client", approval_id: mine });
    expect(stolen.isError).toBe(true);
    const wrongAccount = await attempt(h, "use client's approval against the other account", "ads_create_ad_set", { ...STEPS[1][1], account_id: "901", client_id: "client", approval_id: mine });
    expect(wrongAccount.isError).toBe(true);
    expect(h.posts()).toHaveLength(writes);
    expect(h.providerCalls.slice(reads).some((c) => /\/(901|951|961|971)\b/.test(c.path))).toBe(false);
    expect((await h.repo.get("approvals", "tenant", mine))?.consumedAt, "the approval was not spent by a foreign attempt").toBeNull();
  });
});
