import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { marketingControlFixture } from "./marketing-control-fixture.js";
import { establishFinancialFixture } from "./financial-fixture.js";
import { budgetCeilingDocument } from "./budget-ceiling-fixture.js";
import { BUDGET_CEILINGS_ENV } from "../../src/platform/marketing-budget-ceiling.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { ManualEligibilityService, eligibleHumanRequirements } from "../../src/platform/manual-eligibility-service.js";
import { manualEligibilityIdentity } from "../../src/platform/manual-eligibility.js";
import { issueHumanApproval } from "../../src/platform/approvals.js";

/** A budget ceiling is checked wherever a plan is evaluated: before a human is asked, at issue, and before the single-use approval is consumed. */
const reviewed = { expected_creative_id: "501", expected_campaign_daily_budget: 0, expected_adset_daily_budget: 1000, expected_currency: "USD", expected_campaign_objective: "OUTCOME_TRAFFIC", expected_optimization_goal: "LINK_CLICKS", expected_bid_strategy: "LOWEST_COST_WITHOUT_CAP", expected_bid_amount: 0 };
const within = () => budgetCeilingDocument({ client: { currency: "USD", daily: "10.00" } });
const tooLow = () => budgetCeilingDocument({ client: { currency: "USD", daily: "9.99" } });

beforeEach(() => {
  for (const key of ["LUMIN_PLATFORM_ENABLED", "LUMIN_PLATFORM_WRITES_ENABLED", "AGENCY_WRITES_ENABLED", "LUMIN_MARKETING_ACTIVATION_ENABLED"]) vi.stubEnv(key, "true");
  vi.stubEnv("META_APP_ID", "300"); vi.stubEnv("META_API_VERSION", "v26.0"); vi.stubEnv("DEPLOYMENT_MODE", "legacy"); vi.stubEnv("TOKEN_ENCRYPTION_KEY", "e".repeat(64));
});
afterEach(() => { configurePlatformRepository(undefined); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function world() {
  const f = await marketingControlFixture("success");
  const connected = await f.connect();
  await establishFinancialFixture(f.repo, { tenantId: "tenant", operatorId: "100" }, "client", "account");
  const manual = new ManualEligibilityService(f.repo);
  for (const requirement of eligibleHumanRequirements((await f.repo.get("connections", "tenant", connected.connectionId))!)) {
    const c = (await f.repo.get("connections", "tenant", connected.connectionId))!;
    await manual.attest({ tenantId: "tenant", operatorId: "100" }, "client", c.id, { requirementHash: requirement.requirementHash, documentReferenceHash: "d".repeat(64), ...(requirement.maxAgeMs < 3600000 ? { minutes: Math.floor(requirement.maxAgeMs / 60000) } : { hours: 1 }), reviewedIdentityHash: manualEligibilityIdentity(c, "client"), reviewedConnectionRevision: c.revision });
  }
  configurePlatformRepository(f.repo);
  vi.stubGlobal("fetch", f.fetcher);
  const server = createServer(), client = new Client({ name: "ceiling-at-approval", version: "1" }), [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await requestContext.run({ fbUserId: "100" }, () => client.callTool({ name, arguments: args }));
    const text = (result.content as Array<{ text: string }>)[0].text;
    return { isError: result.isError === true, text, body: JSON.parse(text) as Record<string, unknown> };
  };
  const prepare = () => call("meta_prepare_action", { client_id: "client", tool: "marketing_activate_ad", asset_id: "401", connection_id: connected.connectionId, input: reviewed });
  const activate = (approvalId: string) => call("marketing_activate_ad", { client_id: "client", asset_id: "401", connection_id: connected.connectionId, input: reviewed, approval_id: approvalId });
  const human = { tenantId: "tenant", operatorId: "200" };
  const posts = () => f.network.filter(n => n.startsWith("POST"));
  return { f, call, prepare, activate, human, posts, close: async () => { await client.close(); await server.close(); } };
}

describe("an over-ceiling or unconfigured activation never reaches a human", () => {
  it.each([
    ["one minor unit over the ceiling", tooLow, "BUDGET_CEILING_EXCEEDED"],
    ["no ceiling for the client", () => budgetCeilingDocument({ "other-client": {} }), "BUDGET_CEILING_NOT_CONFIGURED"],
    ["no ceiling document at all", () => undefined, "BUDGET_CEILING_NOT_CONFIGURED"],
    ["a ceiling in another currency", () => budgetCeilingDocument({ client: { currency: "JPY", daily: "100000" } }), "BUDGET_CEILING_CURRENCY_MISMATCH"],
    ["an unreadable ceiling document", () => "{not json", "BUDGET_CEILING_CONFIG_INVALID"],
  ] as Array<[string, () => string | undefined, string]>)("refuses the approval request for %s and stores nothing", async (_label, document, reason) => {
    const document_ = document();
    if (document_ !== undefined) vi.stubEnv(BUDGET_CEILINGS_ENV, document_);
    const w = await world();
    try {
      const prepared = await w.prepare();
      expect(prepared.isError).toBe(true);
      expect(prepared.body).toMatchObject({ status: "HOLD", reason });
      expect(await w.f.repo.list("approvalRequests", "tenant")).toEqual([]);
      expect(await w.f.repo.list("approvals", "tenant")).toEqual([]);
      expect(w.posts()).toEqual([]);
    } finally { await w.close(); }
  });
});

describe("the ceiling is re-checked while the approval is still unspent", () => {
  it("consumes the approval exactly once when the activation stays within the ceiling", async () => {
    vi.stubEnv(BUDGET_CEILINGS_ENV, within());
    const w = await world();
    try {
      const prepared = await w.prepare();
      expect(prepared.isError, prepared.text).toBe(false);
      const approvalId = await issueHumanApproval(w.f.repo, w.human, prepared.body.request_id as string);
      const activated = await w.activate(approvalId);
      expect(activated.isError, activated.text).toBe(false);
      expect(w.posts()).toEqual(["POST:/401"]);
      const [approval] = await w.f.repo.list("approvals", "tenant");
      expect(approval).toMatchObject({ id: approvalId });
      expect(approval.consumedAt).not.toBeNull();
      expect(await w.f.repo.list("operations", "tenant")).toHaveLength(1);
      expect((await w.activate(approvalId)).isError).toBe(true);
      expect(w.posts()).toEqual(["POST:/401"]);
    } finally { await w.close(); }
  });

  it("refuses issue when the ceiling was lowered after the request, and issues nothing", async () => {
    vi.stubEnv(BUDGET_CEILINGS_ENV, within());
    const w = await world();
    try {
      const prepared = await w.prepare();
      expect(prepared.isError, prepared.text).toBe(false);
      vi.stubEnv(BUDGET_CEILINGS_ENV, tooLow());
      await expect(issueHumanApproval(w.f.repo, w.human, prepared.body.request_id as string)).rejects.toThrow("BUDGET_CEILING_EXCEEDED");
      expect(await w.f.repo.list("approvals", "tenant")).toEqual([]);
    } finally { await w.close(); }
  });

  it("refuses execution when the ceiling was lowered after issue, without spending the approval, which works again once the ceiling allows it", async () => {
    vi.stubEnv(BUDGET_CEILINGS_ENV, within());
    const w = await world();
    try {
      const prepared = await w.prepare();
      const approvalId = await issueHumanApproval(w.f.repo, w.human, prepared.body.request_id as string);
      vi.stubEnv(BUDGET_CEILINGS_ENV, tooLow());
      const refused = await w.activate(approvalId);
      expect(refused.isError).toBe(true);
      expect(refused.body).toMatchObject({ reason: "BUDGET_CEILING_EXCEEDED" });
      expect((await w.f.repo.list("approvals", "tenant"))[0]).toMatchObject({ id: approvalId, consumedAt: null, operationId: null });
      expect(await w.f.repo.list("operations", "tenant")).toEqual([]);
      expect(w.posts()).toEqual([]);
      vi.stubEnv(BUDGET_CEILINGS_ENV, within());
      const allowed = await w.activate(approvalId);
      expect(allowed.isError, allowed.text).toBe(false);
      expect(w.posts()).toEqual(["POST:/401"]);
      expect((await w.f.repo.list("approvals", "tenant"))[0].consumedAt).not.toBeNull();
    } finally { await w.close(); }
  });
});

vi.setConfig({ testTimeout: 60000 });
