import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectApprovalRequest, issueHumanApproval, requestProductApproval } from "../../src/platform/approvals.js";
import { authorizeOperation } from "../../src/platform/execution.js";
import { BUDGET_CEILING_GUARD, budgetCeilingGuard } from "../../src/platform/budget-ceiling-guard.js";
import { registerPolicyGuard, unregisterPolicyGuard } from "../../src/platform/policy.js";
import { human, pagesApprovalFixture, pagesContract as contract, pagesCtx as ctx, pagesInput, tenantId, writesEnabledEnv } from "./pages-approval-fixture.js";

vi.setConfig({ testTimeout: 60000 });
const CEILING_GUARD_NAME = "marketing-budget-ceiling";

beforeEach(() => writesEnabledEnv((name, value) => vi.stubEnv(name, value)));
afterEach(() => vi.unstubAllEnvs());

/** Every module that can issue a permit or evaluate a plan for a human, loaded alone in a fresh module graph. */
const ENTRIES: Record<string, () => Promise<unknown>> = {
  execution: () => import("../../src/platform/execution.js"),
  "legacy-write": () => import("../../src/platform/legacy-write.js"),
  "targeting-lookup": () => import("../../src/platform/targeting-lookup.js"),
  "marketing-control-client": () => import("../../src/platform/marketing-control-client.js"),
  tools: () => import("../../src/platform/tools.js"),
  approvals: () => import("../../src/platform/approvals.js"),
  server: () => import("../../src/server.js"),
};

describe("the per-client budget ceiling guard is registered whichever platform module is loaded first", () => {
  it.each(Object.keys(ENTRIES))("importing only %s leaves the guard registered", async entry => {
    vi.resetModules();
    await ENTRIES[entry]();
    const policy = await import("../../src/platform/policy.js");
    let registered = false;
    try { policy.registerPolicyGuard(CEILING_GUARD_NAME, () => undefined); policy.unregisterPolicyGuard(CEILING_GUARD_NAME); } catch { registered = true; }
    expect(registered, `no ceiling guard after importing only ${entry}`).toBe(true);
  });
});

describe("authorization fails closed when the guard is missing", () => {
  it("refuses a permit with POLICY_GUARD_MISSING and leaves the approval unspent", async () => {
    const repo = await pagesApprovalFixture();
    const prepared = await requestProductApproval(repo, ctx, contract, "123", pagesInput), { plan } = await inspectApprovalRequest(repo, human, prepared.id);
    const approvalId = await issueHumanApproval(repo, human, prepared.id);
    unregisterPolicyGuard(BUDGET_CEILING_GUARD);
    try {
      await expect(authorizeOperation(repo, ctx, plan, { writesEnabled: true, approvalId })).rejects.toThrow("POLICY_GUARD_MISSING");
      expect(await repo.get("approvals", tenantId, approvalId)).toMatchObject({ consumedAt: null, operationId: null });
      expect(await repo.list("operations", tenantId)).toEqual([]);
    } finally { registerPolicyGuard(BUDGET_CEILING_GUARD, budgetCeilingGuard); }
    const permit = await authorizeOperation(repo, ctx, plan, { writesEnabled: true, approvalId });
    expect(permit.operationId).toBeTruthy();
  });
});
