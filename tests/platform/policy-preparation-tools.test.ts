import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePolicy } from "../../src/platform/policy.js";
import { platformWritesEnabled } from "../../src/platform/runtime.js";
import type { AuthorizationSnapshot, OperationContext, OperationPlan } from "../../src/platform/models.js";

afterEach(() => vi.unstubAllEnvs());

const snapshot = { tenant: { id: "tenant", status: "ACTIVE", migrationState: "READY" }, member: { operatorId: "actor", tenantId: "tenant", roles: ["writer"], allowedClientIds: ["client"], disabledAt: null }, client: { id: "client", tenantId: "tenant", status: "ACTIVE" }, assets: [], grants: [], connection: { id: "connection" } } as unknown as AuthorizationSnapshot;
const ctx = (tool: string): OperationContext => ({ principal: { tenantId: "tenant", operatorId: "actor" }, clientId: "client", tool, provider: "META_MARKETING", requestId: "request" });
const readPlan = (capability: string): OperationPlan => ({ parameters: {}, assets: [], classes: ["READ"], capability, requiredScopes: ["ads_read"], tokenTypes: ["user"] });

const values = [undefined, "true", "false", "TRUE", "1"];
const combinations = values.flatMap(platform => values.map(agency => ({ platform, agency })));

describe("a preparation-only tool is refused whenever platform writes are not enabled", () => {
  it.each(combinations)("platform=$platform agency=$agency: the policy agrees with the runtime about whether writes are enabled", ({ platform, agency }) => {
    for (const [name, value] of [["LUMIN_PLATFORM_WRITES_ENABLED", platform], ["AGENCY_WRITES_ENABLED", agency]] as const) vi.stubEnv(name, value as string);
    const decision = evaluatePolicy(ctx("meta_plan_tracking_change"), readPlan("legacy.ads_get_ad_details"), snapshot, { writesEnabled: false });
    if (platformWritesEnabled()) expect(decision).toMatchObject({ decision: "ALLOW" });
    else expect(decision).toMatchObject({ decision: "DENY", reason: "DISABLED_BY_LUMIN_POLICY" });
  });

  it("does not refuse an ordinary read plan for another tool while writes are disabled", () => {
    vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "false");
    expect(evaluatePolicy(ctx("meta_observe_ads_compatibility"), readPlan("legacy.ads_get_ad_details"), snapshot, { writesEnabled: false })).toMatchObject({ decision: "ALLOW" });
  });
});
