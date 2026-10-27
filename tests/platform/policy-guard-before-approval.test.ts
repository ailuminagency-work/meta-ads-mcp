import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectApprovalRequest, issueHumanApproval, requestProductApproval } from "../../src/platform/approvals.js";
import { authorizeOperation } from "../../src/platform/execution.js";
import { PlatformDenied } from "../../src/platform/models.js";
import { evaluatePolicy, registerPolicyGuard, unregisterPolicyGuard } from "../../src/platform/policy.js";
import { actor, clientId, human, pagesApprovalFixture as fixture, pagesContract as contract, pagesCtx as ctx, pagesInput as input, tenantId, writesEnabledEnv } from "./pages-approval-fixture.js";

const GUARD = "synthetic-ceiling-stand-in";

beforeEach(() => writesEnabledEnv((name, value) => vi.stubEnv(name, value)));
afterEach(() => { unregisterPolicyGuard(GUARD); vi.unstubAllEnvs(); });

const deny = (reason = "BUDGET_CEILING_EXCEEDED") => registerPolicyGuard(GUARD, () => { throw new PlatformDenied(reason); });

describe("a policy guard refuses before a human is asked, before issuance and before an approval is consumed", () => {
  it("stops the approval request itself, so nothing is stored and no human is asked", async () => {
    const repo = await fixture();
    deny();
    await expect(requestProductApproval(repo, ctx, contract, "123", input)).rejects.toThrow("BUDGET_CEILING_EXCEEDED");
    expect(await repo.list("approvalRequests", tenantId)).toHaveLength(0);
    expect(await repo.list("audit", tenantId)).toHaveLength(0);
  });

  it("stops issuance of a request that was prepared before the guard started refusing", async () => {
    const repo = await fixture();
    const request = await requestProductApproval(repo, ctx, contract, "123", input);
    deny();
    await expect(inspectApprovalRequest(repo, human, request.id)).rejects.toThrow("BUDGET_CEILING_EXCEEDED");
    await expect(issueHumanApproval(repo, human, request.id)).rejects.toThrow("BUDGET_CEILING_EXCEEDED");
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
  });

  it("stops execution without consuming an issued approval and without creating an operation", async () => {
    const repo = await fixture();
    const request = await requestProductApproval(repo, ctx, contract, "123", input);
    const { plan } = await inspectApprovalRequest(repo, human, request.id);
    const approvalId = await issueHumanApproval(repo, human, request.id);
    deny();
    await expect(authorizeOperation(repo, ctx, plan, { writesEnabled: true, approvalId })).rejects.toThrow("BUDGET_CEILING_EXCEEDED");
    expect((await repo.list("approvals", tenantId))[0]).toMatchObject({ id: approvalId, consumedAt: null, operationId: null });
    expect(await repo.list("operations", tenantId)).toHaveLength(0);
    unregisterPolicyGuard(GUARD);
    const permit = await authorizeOperation(repo, ctx, plan, { writesEnabled: true, approvalId });
    expect(permit.operationId).toBeTruthy();
    expect((await repo.list("approvals", tenantId))[0]).toMatchObject({ id: approvalId, operationId: permit.operationId });
    expect((await repo.list("approvals", tenantId))[0].consumedAt).not.toBeNull();
    await expect(authorizeOperation(repo, ctx, plan, { writesEnabled: true, approvalId })).rejects.toThrow();
    expect(await repo.list("operations", tenantId)).toHaveLength(1);
  });

  it("consumes the approval exactly once when every registered guard passes", async () => {
    const repo = await fixture();
    const seen: string[] = [];
    registerPolicyGuard(GUARD, (c, p) => { seen.push(c.tool + ":" + p.classes.join(",")); });
    const request = await requestProductApproval(repo, ctx, contract, "123", input);
    const { plan } = await inspectApprovalRequest(repo, human, request.id);
    const approvalId = await issueHumanApproval(repo, human, request.id);
    await authorizeOperation(repo, ctx, plan, { writesEnabled: true, approvalId });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen)).toEqual(new Set(["pages_create_feed:WRITE_CONTENT"]));
    expect(await repo.list("operations", tenantId)).toHaveLength(1);
  });

  it("fails closed when a guard breaks, and a guard cannot turn a denial into an allowance", async () => {
    const repo = await fixture();
    registerPolicyGuard(GUARD, () => { throw new Error("guard defect with internal detail"); });
    await expect(requestProductApproval(repo, ctx, contract, "123", input)).rejects.toThrow("POLICY_GUARD_FAILED");
    unregisterPolicyGuard(GUARD);
    const snapshot = { tenant: { id: tenantId, status: "ACTIVE", migrationState: "READY" }, member: { operatorId: actor.operatorId, tenantId, roles: ["reader"], allowedClientIds: [clientId], disabledAt: null }, client: { id: clientId, tenantId, status: "ACTIVE" }, assets: [], grants: [], connection: { id: "c" } } as never;
    registerPolicyGuard(GUARD, () => undefined);
    expect(evaluatePolicy(ctx, { parameters: {}, assets: [], classes: ["WRITE_CONTENT"], capability: contract.id, requiredScopes: [], tokenTypes: [] }, snapshot, { writesEnabled: true })).toMatchObject({ decision: "DENY", reason: "WRITE_ROLE_REQUIRED" });
  });

  it("refuses a second module registering over an existing guard name, so a guard cannot be replaced silently", async () => {
    const repo = await fixture();
    deny();
    expect(() => registerPolicyGuard(GUARD, () => undefined)).toThrow("POLICY_GUARD_ALREADY_REGISTERED");
    await expect(requestProductApproval(repo, ctx, contract, "123", input)).rejects.toThrow("BUDGET_CEILING_EXCEEDED");
  });

  it("does not run for read-only plans", async () => {
    const guard = vi.fn(() => { throw new PlatformDenied("SHOULD_NOT_RUN"); });
    registerPolicyGuard(GUARD, guard);
    const snapshot = { tenant: { id: tenantId, status: "ACTIVE", migrationState: "READY" }, member: { operatorId: actor.operatorId, tenantId, roles: ["reader"], allowedClientIds: [clientId], disabledAt: null }, client: { id: clientId, tenantId, status: "ACTIVE" }, assets: [], grants: [], connection: { id: "c" } } as never;
    expect(evaluatePolicy(ctx, { parameters: {}, assets: [], classes: ["READ"], capability: "x", requiredScopes: [], tokenTypes: [] }, snapshot, { writesEnabled: false })).toMatchObject({ decision: "ALLOW" });
    expect(guard).not.toHaveBeenCalled();
  });
});
