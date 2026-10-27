import { afterEach, describe, expect, it, vi } from "vitest";
import { distinctApproverRequired, issueHumanApproval, requestProductApproval } from "../../src/platform/approvals.js";
import { actor, human, pagesApprovalFixture, pagesContract, pagesCtx, pagesInput, tenantId, writesEnabledEnv } from "./pages-approval-fixture.js";

afterEach(() => vi.unstubAllEnvs());

function configure(env: { mode?: string; platform?: string; agency?: string; distinct?: string }): void {
  for (const [name, value] of [["DEPLOYMENT_MODE", env.mode], ["LUMIN_PLATFORM_WRITES_ENABLED", env.platform], ["AGENCY_WRITES_ENABLED", env.agency], ["LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER", env.distinct]] as const) vi.stubEnv(name, value as string);
}

describe("distinctApproverRequired", () => {
  it.each([
    ["agency, both write flags true, variable unset", { mode: "agency", platform: "true", agency: "true" }, true],
    ["agency, platform writes off", { mode: "agency", platform: "false", agency: "true" }, false],
    ["agency, agency writes off", { mode: "agency", platform: "true", agency: "false" }, false],
    ["agency, flags unset", { mode: "agency" }, false],
    ["upstream, both write flags true", { mode: "upstream", platform: "true", agency: "true" }, false],
    ["no deployment mode, both write flags true", { platform: "true", agency: "true" }, false],
    ["Agency in another case is not the agency mode", { mode: "AGENCY", platform: "true", agency: "true" }, false],
  ] as const)("default: %s -> %s", (_label, env, expected) => {
    configure(env);
    expect(distinctApproverRequired()).toBe(expected);
  });

  it.each(["true", "TRUE", "True"])("%j turns it on anywhere", distinct => {
    configure({ mode: "upstream", distinct });
    expect(distinctApproverRequired()).toBe(true);
  });

  it.each(["false", "FALSE", "False"])("%j opts out, even in an agency deployment that can write", distinct => {
    configure({ mode: "agency", platform: "true", agency: "true", distinct });
    expect(distinctApproverRequired()).toBe(false);
  });

  it.each(["", " ", "0", "1", "yes", "no", "off", "on", "nope", " false", "false ", "fals", "ture"])("%j is neither true nor false, so it fails closed to on", distinct => {
    for (const mode of ["agency", "upstream", undefined]) {
      configure({ mode, distinct });
      expect(distinctApproverRequired()).toBe(true);
    }
  });
});

describe("a requester who also holds the approver role (the G2 self-approval scenario)", () => {
  async function requesterWhoApproves() {
    writesEnabledEnv((name, value) => vi.stubEnv(name, value));
    const repo = await pagesApprovalFixture(), member = (await repo.get("members", tenantId, actor.operatorId))!;
    await repo.put("members", tenantId, actor.operatorId, { ...member, roles: ["writer", "approver"], revision: member.revision + 1 });
    return { repo, request: await requestProductApproval(repo, pagesCtx, pagesContract, "123", pagesInput) };
  }

  it("cannot issue their own approval in an agency deployment that can write, but a different approver can", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "agency");
    const { repo, request } = await requesterWhoApproves();
    await expect(issueHumanApproval(repo, actor, request.id)).rejects.toThrow("SELF_APPROVAL_FORBIDDEN");
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    expect(await issueHumanApproval(repo, human, request.id)).toBeTruthy();
  });

  it("can only with an explicit opt-out", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "agency");
    vi.stubEnv("LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER", "false");
    const { repo, request } = await requesterWhoApproves();
    expect(await issueHumanApproval(repo, actor, request.id)).toBeTruthy();
  });

  it("keeps the previous default outside agency deployments", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "upstream");
    const { repo, request } = await requesterWhoApproves();
    expect(await issueHumanApproval(repo, actor, request.id)).toBeTruthy();
  });
});
