import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectApprovalRequest, issueHumanApproval, requestProductApproval } from "../../src/platform/approvals.js";
import { human, pagesApprovalFixture as fixture, pagesContract as contract, pagesCtx as ctx, pagesInput as input, tenantId, writesEnabledEnv } from "./pages-approval-fixture.js";

afterEach(() => vi.unstubAllEnvs());

const flagCombinations: Array<[string, Record<string, string>]> = [
  ["neither flag set", {}],
  ["only LUMIN_PLATFORM_WRITES_ENABLED", { LUMIN_PLATFORM_WRITES_ENABLED: "true" }],
  ["only AGENCY_WRITES_ENABLED", { AGENCY_WRITES_ENABLED: "true" }],
  ["a flag that is not the literal true", { LUMIN_PLATFORM_WRITES_ENABLED: "TRUE", AGENCY_WRITES_ENABLED: "1" }],
];

describe("a deployment with platform writes disabled neither prepares, reviews nor issues an approval", () => {
  it("control: the same journey prepares and issues when both write flags are true", async () => {
    writesEnabledEnv((name, value) => vi.stubEnv(name, value));
    const repo = await fixture();
    const request = await requestProductApproval(repo, ctx, contract, "123", input);
    const approvalId = await issueHumanApproval(repo, human, request.id);
    expect(approvalId).toBeTruthy();
    expect(await repo.list("approvalRequests", tenantId)).toHaveLength(1);
    expect(await repo.list("approvals", tenantId)).toHaveLength(1);
  });

  it.each(flagCombinations)("refuses to prepare a request with %s and stores nothing", async (_label, flags) => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "c".repeat(64));
    for (const [name, value] of Object.entries(flags)) vi.stubEnv(name, value);
    const repo = await fixture();
    await expect(requestProductApproval(repo, ctx, contract, "123", input)).rejects.toThrow("DISABLED_BY_LUMIN_POLICY");
    expect(await repo.list("approvalRequests", tenantId)).toHaveLength(0);
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    expect(await repo.list("audit", tenantId)).toHaveLength(0);
  });

  it("refuses to show or issue a request that was prepared before writes were switched off", async () => {
    writesEnabledEnv((name, value) => vi.stubEnv(name, value));
    const repo = await fixture();
    const request = await requestProductApproval(repo, ctx, contract, "123", input);
    vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "false");
    await expect(inspectApprovalRequest(repo, human, request.id)).rejects.toThrow("DISABLED_BY_LUMIN_POLICY");
    await expect(issueHumanApproval(repo, human, request.id)).rejects.toThrow("DISABLED_BY_LUMIN_POLICY");
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    expect((await repo.list("approvalRequests", tenantId))[0]).toMatchObject({ id: request.id, approvedAt: null, approvalId: null });
    vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "true");
    expect(await issueHumanApproval(repo, human, request.id)).toBeTruthy();
  });
});
