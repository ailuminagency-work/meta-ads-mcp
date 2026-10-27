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

const expected = {
  expected_creative_id: "501",
  expected_campaign_daily_budget: 0,
  expected_adset_daily_budget: 1000,
  expected_currency: "USD",
  expected_campaign_objective: "OUTCOME_TRAFFIC",
  expected_optimization_goal: "LINK_CLICKS",
  expected_bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  expected_bid_amount: 0,
};

beforeEach(() => {
  for (const key of ["LUMIN_PLATFORM_ENABLED", "LUMIN_PLATFORM_WRITES_ENABLED", "AGENCY_WRITES_ENABLED", "LUMIN_MARKETING_ACTIVATION_ENABLED"]) {
    vi.stubEnv(key, "true");
  }
  vi.stubEnv("META_APP_ID", "300");
  vi.stubEnv("META_API_VERSION", "v26.0");
  vi.stubEnv("DEPLOYMENT_MODE", "legacy");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "e".repeat(64));
});
afterEach(() => {
  configurePlatformRepository(undefined);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function activate(ceiling: string | undefined, budgetMode = "success") {
  const f = await marketingControlFixture(budgetMode);
  const connected = await f.connect();
  await establishFinancialFixture(f.repo, { tenantId: "tenant", operatorId: "100" }, "client", "account");
  const manual = new ManualEligibilityService(f.repo);
  for (const requirement of eligibleHumanRequirements((await f.repo.get("connections", "tenant", connected.connectionId))!)) {
    const c = (await f.repo.get("connections", "tenant", connected.connectionId))!;
    await manual.attest(
      { tenantId: "tenant", operatorId: "100" },
      "client",
      c.id,
      {
        requirementHash: requirement.requirementHash,
        documentReferenceHash: "d".repeat(64),
        ...(requirement.maxAgeMs < 3600000 ? { minutes: Math.floor(requirement.maxAgeMs / 60000) } : { hours: 1 }),
        reviewedIdentityHash: manualEligibilityIdentity(c, "client"),
        reviewedConnectionRevision: c.revision,
      },
    );
  }
  configurePlatformRepository(f.repo);
  vi.stubGlobal("fetch", f.fetcher);
  if (ceiling !== undefined) vi.stubEnv(BUDGET_CEILINGS_ENV, ceiling);

  const server = createServer();
  const client = new Client({ name: "ceiling-fixture", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const call = (name: string, args: Record<string, unknown>) => requestContext.run({ fbUserId: "100" }, () => client.callTool({ name, arguments: args }));
    const prepared = await call("meta_prepare_action", {
      client_id: "client",
      tool: "marketing_activate_ad",
      asset_id: "401",
      connection_id: connected.connectionId,
      input: expected,
    });
    if (prepared.isError) return { result: prepared, newRequests: [] as string[], network: f.network, refusedBeforeApproval: true };
    const approval = await issueHumanApproval(f.repo, { tenantId: "tenant", operatorId: "200" }, JSON.parse((prepared.content as Array<{ text: string }>)[0].text).request_id);
    const requestsBefore = f.network.length;
    const result = await call("marketing_activate_ad", {
      client_id: "client",
      asset_id: "401",
      connection_id: connected.connectionId,
      input: expected,
      approval_id: approval,
    });
    return { result, newRequests: f.network.slice(requestsBefore), network: f.network, refusedBeforeApproval: false };
  } finally {
    await client.close();
    await server.close();
  }
}

const reason = (result: { content: unknown }) => JSON.stringify(result.content);

describe("activation is held to the client's budget ceiling before any provider request", () => {
  it("activates one ad when the reviewed budget is within the ceiling and the account currency matches", async () => {
    const { result, newRequests, refusedBeforeApproval } = await activate(budgetCeilingDocument({ client: { currency: "USD", daily: "10.00" } }));
    expect(result.isError, reason(result)).not.toBe(true);
    expect(refusedBeforeApproval).toBe(false);
    expect(newRequests.filter((n) => n.startsWith("POST"))).toEqual(["POST:/401"]);
  });

  it("denies when the reviewed budget is one minor unit over the ceiling, with no provider request at all", async () => {
    const { result, newRequests, refusedBeforeApproval } = await activate(budgetCeilingDocument({ client: { currency: "USD", daily: "9.99" } }));
    expect(result.isError).toBe(true);
    expect(refusedBeforeApproval).toBe(true);
    expect(reason(result)).toContain("BUDGET_CEILING_EXCEEDED");
    expect(newRequests).toEqual([]);
  });

  it("denies when the client has no ceiling configured (fail closed)", async () => {
    const { result, newRequests, refusedBeforeApproval } = await activate(undefined);
    expect(result.isError).toBe(true);
    expect(refusedBeforeApproval).toBe(true);
    expect(reason(result)).toContain("BUDGET_CEILING_NOT_CONFIGURED");
    expect(newRequests).toEqual([]);
  });

  it("denies when only another client has a ceiling", async () => {
    const { result, newRequests, refusedBeforeApproval } = await activate(budgetCeilingDocument({ "other-client": {} }));
    expect(result.isError).toBe(true);
    expect(refusedBeforeApproval).toBe(true);
    expect(reason(result)).toContain("BUDGET_CEILING_NOT_CONFIGURED");
    expect(newRequests).toEqual([]);
  });

  it("denies a ceiling expressed in another currency than the reviewed expectation", async () => {
    const { result, newRequests, refusedBeforeApproval } = await activate(budgetCeilingDocument({ client: { currency: "JPY", daily: "100000" } }));
    expect(result.isError).toBe(true);
    expect(refusedBeforeApproval).toBe(true);
    expect(reason(result)).toContain("BUDGET_CEILING_CURRENCY_MISMATCH");
    expect(newRequests).toEqual([]);
  });

  it("denies when the provider reports the account in another currency than the ceiling, after the reviewed expectation matched the ceiling", async () => {
    const { result, newRequests } = await activate(budgetCeilingDocument({ client: { currency: "USD", daily: "10.00" } }), "account-jpy");
    expect(result.isError).toBe(true);
    expect(reason(result)).toContain("BUDGET_CEILING_CURRENCY_MISMATCH");
    expect(newRequests.filter((n) => n.startsWith("POST"))).toEqual([]);
    expect(newRequests).toContain("GET:/act_101");
  });

  it("denies a provider budget above the ceiling with the ceiling's own reason when the reviewed expectation was within it", async () => {
    const { result, newRequests } = await activate(budgetCeilingDocument({ client: { currency: "USD", daily: "10.00" } }), "budget-changed");
    expect(result.isError).toBe(true);
    expect(reason(result)).toContain("BUDGET_CEILING_EXCEEDED");
    expect(newRequests.filter((n) => n.startsWith("POST"))).toEqual([]);
  });

  it("still denies a provider budget that changed after review, even inside the ceiling", async () => {
    const { result, newRequests } = await activate(budgetCeilingDocument({ client: { currency: "USD", daily: "100.00" } }), "budget-changed");
    expect(result.isError).toBe(true);
    expect(newRequests.filter((n) => n.startsWith("POST"))).toEqual([]);
  });
});

vi.setConfig({ testTimeout: 60000 });
