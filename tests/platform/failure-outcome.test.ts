import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectApprovalRequest, issueHumanApproval, requestProductApproval } from "../../src/platform/approvals.js";
import { ProductApiError } from "../../src/platform/clients.js";
import { authorizeOperation, claimMutationStep, finishOperation, mutationStepClaimed } from "../../src/platform/execution.js";
import { outcomeAfterFailure, providerRejection } from "../../src/platform/failure-outcome.js";
import { human, pagesApprovalFixture, pagesContract as contract, pagesCtx as ctx, pagesInput, tenantId, writesEnabledEnv } from "./pages-approval-fixture.js";

beforeEach(() => writesEnabledEnv((name, value) => vi.stubEnv(name, value)));
afterEach(() => vi.unstubAllEnvs());

async function permit() {
  const repo = await pagesApprovalFixture(), request = await requestProductApproval(repo, ctx, contract, "123", pagesInput);
  const { plan } = await inspectApprovalRequest(repo, human, request.id), approvalId = await issueHumanApproval(repo, human, request.id);
  return { repo, plan, permit: await authorizeOperation(repo, ctx, plan, { writesEnabled: true, approvalId }) };
}
const provider = contract.provider;

describe("providerRejection: only a proven refusal by Meta frees a plan", () => {
  it.each([
    [400, 100, false, true], [400, 190, false, true], [403, 10, false, true], [404, 803, false, true],
    [429, 4, false, false], [408, 100, false, false], [400, 1, false, false], [400, 2, false, false], [400, 100, true, false],
    [400, null, false, false], [200, 100, false, false], [200, null, false, false], [500, 1, false, false], [500, 100, false, false], [502, null, false, false], [0, null, false, false], [399, 100, false, false],
  ])("HTTP %s code %s transient=%s -> rejection=%s", (status, code, transient, expected) => {
    expect(providerRejection(status, code, transient)).toBe(expected);
  });
});

describe("outcomeAfterFailure", () => {
  it.each([
    ["a local exception before any mutation step", new Error("ECONNRESET on a read")],
    ["a validation denial before any mutation step", new Error("PLATFORM_VALIDATION")],
    ["a Meta refusal", new ProductApiError(provider, 400, 100, null)],
  ])("is FAILED for %s when the mutation step never began", async (_label, error) => {
    const { permit: p } = await permit();
    expect(mutationStepClaimed(p)).toBe(false);
    expect(outcomeAfterFailure(p, error)).toBe("FAILED");
  });

  it.each([
    ["a lost connection (status 0)", new ProductApiError(provider, 0, null, null), "UNKNOWN"],
    ["a 5xx", new ProductApiError(provider, 500, null, null), "UNKNOWN"],
    ["a 5xx with a Graph code", new ProductApiError(provider, 500, 1, null), "UNKNOWN"],
    ["a 4xx that is not a Graph error", new ProductApiError(provider, 400, null, null), "UNKNOWN"],
    ["Graph code 1 (unknown)", new ProductApiError(provider, 400, 1, null), "UNKNOWN"],
    ["Graph code 2 (service)", new ProductApiError(provider, 400, 2, null), "UNKNOWN"],
    ["a 200 that carries an error", new ProductApiError(provider, 200, 100, null), "UNKNOWN"],
    ["a plain exception after the POST was sent", new Error("response unreadable"), "UNKNOWN"],
    ["a Meta refusal of the request body", new ProductApiError(provider, 400, 100, null), "FAILED"],
    ["a rate limit refusal, which does not say whether the write landed", new ProductApiError(provider, 429, 4, null), "UNKNOWN"],
    ["a request timeout status", new ProductApiError(provider, 408, 100, null), "UNKNOWN"],
  ])("is %s -> %s once the mutation step began", async (_label, error, expected) => {
    const { permit: p } = await permit();
    claimMutationStep(p);
    expect(mutationStepClaimed(p)).toBe(true);
    expect(outcomeAfterFailure(p, error)).toBe(expected);
  });

  it("FAILED really releases the lock and UNKNOWN keeps it", async () => {
    const failed = await permit();
    await finishOperation(failed.permit, outcomeAfterFailure(failed.permit, new Error("read failed")));
    expect((await failed.repo.list("operationPlanLocks", tenantId))[0]).toMatchObject({ state: "RELEASED", releasedResult: "FAILED" });
    const unknown = await permit();
    claimMutationStep(unknown.permit);
    await finishOperation(unknown.permit, outcomeAfterFailure(unknown.permit, new Error("socket hang up")));
    expect((await unknown.repo.list("operationPlanLocks", tenantId))[0]).toMatchObject({ state: "HELD" });
  });
});
