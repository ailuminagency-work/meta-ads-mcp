import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectApprovalRequest, issueHumanApproval, requestProductApproval } from "../../src/platform/approvals.js";
import { authorizeOperation, finishOperation } from "../../src/platform/execution.js";
import { human, pagesApprovalFixture, pagesContract as contract, pagesCtx as ctx, pagesInput, tenantId, writesEnabledEnv } from "./pages-approval-fixture.js";

beforeEach(() => writesEnabledEnv((name, value) => vi.stubEnv(name, value)));
afterEach(() => vi.unstubAllEnvs());

type Repo = Awaited<ReturnType<typeof pagesApprovalFixture>>;
const request = (repo: Repo, input: Record<string, unknown> = pagesInput) => requestProductApproval(repo, ctx, contract, "123", input);
async function approved(repo: Repo, input: Record<string, unknown> = pagesInput) {
  const prepared = await request(repo, input), { plan } = await inspectApprovalRequest(repo, human, prepared.id);
  return { plan, approvalId: await issueHumanApproval(repo, human, prepared.id) };
}
const authorize = (repo: Repo, plan: Awaited<ReturnType<typeof approved>>["plan"], approvalId: string) => authorizeOperation(repo, ctx, plan, { writesEnabled: true, approvalId });
async function attempt(repo: Repo, result: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "PARTIAL", input: Record<string, unknown> = pagesInput) {
  const { plan, approvalId } = await approved(repo, input), permit = await authorize(repo, plan, approvalId);
  await finishOperation(permit, result);
  return { plan, approvalId, permit };
}

describe("authorizeOperation and the approval path refuse a plan whose earlier attempt was not reconciled", () => {
  it.each(["UNKNOWN", "PARTIAL"] as const)("after %s: a new approval request for the identical plan is denied and stores nothing", async result => {
    const repo = await pagesApprovalFixture();
    await attempt(repo, result);
    const before = (await repo.list("approvalRequests", tenantId)).length;
    await expect(request(repo)).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
    expect(await repo.list("approvalRequests", tenantId)).toHaveLength(before);
    expect(await repo.list("operations", tenantId)).toHaveLength(1);
  });

  it.each(["UNKNOWN", "PARTIAL"] as const)("after %s: an approval that was already issued for the same plan is refused and stays unspent", async result => {
    const repo = await pagesApprovalFixture();
    const early = await approved(repo);
    await attempt(repo, result);
    await expect(authorize(repo, early.plan, early.approvalId)).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
    expect(await repo.get("approvals", tenantId, early.approvalId)).toMatchObject({ consumedAt: null, operationId: null });
    expect(await repo.list("operations", tenantId)).toHaveLength(1);
  });

  it("after UNKNOWN: a request prepared earlier can be neither reviewed nor issued", async () => {
    const repo = await pagesApprovalFixture();
    const early = await request(repo);
    await attempt(repo, "UNKNOWN");
    await expect(inspectApprovalRequest(repo, human, early.id)).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
    await expect(issueHumanApproval(repo, human, early.id)).rejects.toThrow("PRIOR_ATTEMPT_UNRECONCILED");
    expect(await repo.list("approvals", tenantId)).toHaveLength(1);
  });

  it.each(["SUCCEEDED", "FAILED"] as const)("after %s: the identical plan can be requested, approved and run again", async result => {
    const repo = await pagesApprovalFixture();
    await attempt(repo, result);
    const second = await attempt(repo, result);
    expect(second.permit.operationId).toBeTruthy();
    expect((await repo.list("operations", tenantId)).map(o => o.state)).toEqual([result, result]);
  });

  it("a different plan is not blocked by an unreconciled one", async () => {
    const repo = await pagesApprovalFixture();
    await attempt(repo, "UNKNOWN");
    const other = await attempt(repo, "SUCCEEDED", { message: "A different reviewed action" });
    expect(other.permit.operationId).toBeTruthy();
    expect((await repo.list("operations", tenantId)).map(o => o.state).sort()).toEqual(["SUCCEEDED", "UNKNOWN"]);
  });

  it("two racing executions of the same plan with two valid approvals produce one operation and one unspent approval", async () => {
    const repo = await pagesApprovalFixture();
    const first = await approved(repo), second = await approved(repo);
    const outcomes = await Promise.allSettled([authorize(repo, first.plan, first.approvalId), authorize(repo, second.plan, second.approvalId)]);
    expect(outcomes.map(o => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(String(((outcomes.find(o => o.status === "rejected") as PromiseRejectedResult).reason as Error).message)).toBe("PRIOR_ATTEMPT_UNRECONCILED");
    expect(await repo.list("operations", tenantId)).toHaveLength(1);
    expect((await repo.list("approvals", tenantId)).filter(a => a.consumedAt === null)).toHaveLength(1);
  });
});
