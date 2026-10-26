import { describe, expect, it, vi } from "vitest";
import { runSafeRecoveryDiagnostics } from "../../src/platform/oauth-recovery-runner.js";
import type { RecoveryToolId } from "../../src/platform/oauth-recovery-toolbox.js";

function fixture() {
  const attempted: RecoveryToolId[] = [];
  const ledger = {
    readAttempted: async () => [...attempted],
    claimAttempt: async (action: RecoveryToolId, maxAttempts: number) => {
      if (attempted.filter(x => x === action).length >= maxAttempts) return false;
      attempted.push(action);
      return true;
    },
  };
  return { attempted, ledger };
}

describe("Phase 1 OAuth safe recovery diagnostic runner", () => {
  it("checks a healthy idempotent probe without declaring a connected account", async () => {
    const { ledger, attempted } = fixture();
    const inspect = vi.fn(async () => "HEALTHY" as const);
    const result = await runSafeRecoveryDiagnostics({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE",
      ledger, diagnostic: { inspect },
    });
    expect(result).toEqual({
      status: "DIAGNOSTIC_HEALTHY",
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE",
      actionId: "probe_provider_health",
      actor: "automatic_diagnostic",
      automatedChecks: 1,
    });
    expect(inspect).toHaveBeenCalledOnce();
    expect(attempted).toEqual(["probe_provider_health"]);
  });

  it("uses bounded prebuilt fallback diagnostics, then requires engineering", async () => {
    const { ledger, attempted } = fixture();
    const inspect = vi.fn(async () => "STILL_FAILING" as const);
    const result = await runSafeRecoveryDiagnostics({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE", ledger,
      diagnostic: { inspect }, maxAutomaticChecks: 3,
    });
    expect(result).toMatchObject({
      status: "ACTION_REQUIRED", actionId: "inspect_internal_failure",
      actor: "engineer", automatedChecks: 2,
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(attempted).toEqual(["probe_provider_health", "probe_provider_health"]);
  });

  it("never calls a diagnostic when Meta consent is required", async () => {
    const { ledger, attempted } = fixture();
    const inspect = vi.fn(async () => "HEALTHY" as const);
    const result = await runSafeRecoveryDiagnostics({
      reason: "CONNECTION_CHALLENGE_EXPIRED_REPLAYED_OR_MISMATCHED",
      ledger, diagnostic: { inspect },
    });
    expect(result).toMatchObject({
      status: "ACTION_REQUIRED", actionId: "start_fresh_signed_challenge",
      actor: "account_owner", automatedChecks: 0,
    });
    expect(inspect).not.toHaveBeenCalled();
    expect(attempted).toEqual([]);
  });

  it("does not retry identity, permission or tenant denials", async () => {
    for (const reason of [
      "FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED", "CLIENT_CONNECTION_ADMIN_REQUIRED",
      "FACEBOOK_ACTUAL_USER_SUBJECT_REQUIRED", "FACEBOOK_GRAPH_PERMISSION_DENIED",
      "UNREQUESTED_OAUTH_ASSET",
    ]) {
      const { ledger } = fixture();
      const inspect = vi.fn(async () => "HEALTHY" as const);
      const result = await runSafeRecoveryDiagnostics({
        reason, ledger, diagnostic: { inspect },
      });
      expect(result.status).toBe("ACTION_REQUIRED");
      expect(result.actor).not.toBe("automatic_diagnostic");
      expect(inspect).not.toHaveBeenCalled();
    }
  });

  it("does not allow arbitrary budgets, malformed attempts or unclassified data", async () => {
    const { ledger } = fixture();
    const inspect = vi.fn(async () => "STILL_FAILING" as const);
    const unknown = await runSafeRecoveryDiagnostics({
      reason: "private-secret-from-user", ledger, diagnostic: { inspect },
    });
    expect(unknown).toMatchObject({ status: "HOLD_UNCLASSIFIED", reason: "UNCLASSIFIED" });
    expect(JSON.stringify(unknown)).not.toContain("private-secret");
    expect(inspect).not.toHaveBeenCalled();

    const badBudget = await runSafeRecoveryDiagnostics({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE", ledger,
      diagnostic: { inspect }, maxAutomaticChecks: Number.POSITIVE_INFINITY,
    });
    expect(badBudget.status).toBe("HOLD_AUTOMATIC_BUDGET");
    expect(inspect).not.toHaveBeenCalled();

    const malformed = await runSafeRecoveryDiagnostics({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE",
      ledger: { readAttempted: async () => ["x".repeat(129)], claimAttempt: ledger.claimAttempt },
      diagnostic: { inspect },
    });
    expect(malformed.status).toBe("HOLD_HANDLER_ERROR");
  });

  it("stops if an attempt cannot be durably claimed or a handler fails", async () => {
    const { ledger } = fixture();
    const inspect = vi.fn(async () => "HEALTHY" as const);
    const concurrent = await runSafeRecoveryDiagnostics({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE",
      ledger: { ...ledger, claimAttempt: async () => false },
      diagnostic: { inspect },
    });
    expect(concurrent.status).toBe("HOLD_CONCURRENT");
    expect(inspect).not.toHaveBeenCalled();

    const failed = await runSafeRecoveryDiagnostics({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE", ledger,
      diagnostic: { inspect: async () => { throw new Error("synthetic-token-value"); } },
    });
    expect(failed.status).toBe("HOLD_HANDLER_ERROR");
    expect(JSON.stringify(failed)).not.toContain("synthetic-token-value");
  });
});

