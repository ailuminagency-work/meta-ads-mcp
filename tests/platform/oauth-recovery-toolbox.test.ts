import { describe, expect, it } from "vitest";
import {
  RECOVERY_PLAYBOOKS,
  RECOVERY_TOOLS,
  chooseRecovery,
  type RecoveryReason,
  type RecoveryToolId,
} from "../../src/platform/oauth-recovery-toolbox.js";

describe("Meta OAuth Phase 1 recovery toolbox", () => {
  it("ships at least ten distinct predefined, bounded recovery procedures", () => {
    const keys = Object.keys(RECOVERY_TOOLS);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(new Set(keys).size).toBe(keys.length);
    for (const tool of Object.values(RECOVERY_TOOLS)) {
      expect(tool.title.length).toBeGreaterThan(4);
      expect(tool.instruction.length).toBeGreaterThan(20);
      expect(tool.securityBoundary.length).toBeGreaterThan(20);
      expect(Number.isSafeInteger(tool.maxAttempts)).toBe(true);
      expect(tool.maxAttempts).toBeGreaterThan(0);
      expect(tool.maxAttempts).toBeLessThanOrEqual(2);
    }
  });

  it("covers the previously observed scope mismatch and Meta response problems", () => {
    expect(chooseRecovery({ reason: "FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED" })).toMatchObject({
      actionId: "review_scope_mismatch",
      tool: { actor: "engineer", requiresFreshAuthorization: false },
    });
    expect(chooseRecovery({
      reason: "FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED",
      attempted: ["review_scope_mismatch"],
    })).toMatchObject({
      actionId: "reauthorize_exact_scopes",
      tool: { actor: "account_owner", requiresFreshAuthorization: true },
    });
    for (const reason of [
      "FACEBOOK_OAUTH_TOKEN_EXCHANGE_RESPONSE_INVALID",
      "FACEBOOK_OAUTH_LONG_TOKEN_RESPONSE_INVALID",
      "FACEBOOK_OAUTH_DEBUG_TOKEN_RESPONSE_INVALID",
      "FACEBOOK_OAUTH_USER_RESPONSE_INVALID",
      "FACEBOOK_OAUTH_PERMISSION_RESPONSE_INVALID",
    ]) {
      expect(chooseRecovery({ reason }).actionId).toBe("repair_provider_schema_contract");
    }
  });

  it("never retries or replays an OAuth code exchange under provider transport ambiguity", () => {
    for (const reason of [
      "FACEBOOK_OAUTH_TRANSPORT_OR_RESPONSE_FAILED",
      "OAUTH_PROVIDER_EXCHANGE_OR_INSPECTION_FAILED",
      "FACEBOOK_OAUTH_RESPONSE_SCHEMA_INVALID",
    ]) {
      expect(chooseRecovery({ reason }).tool?.actor).toBe("engineer");
    }
    expect(chooseRecovery({ reason: "CONNECTION_CHALLENGE_EXPIRED_REPLAYED_OR_MISMATCHED" }))
      .toMatchObject({ actionId: "start_fresh_signed_challenge", tool: { actor: "account_owner" } });
  });

  it("does not auto-resolve Meta permission, identity or tenant authorization failures", () => {
    const disallowed = [
      "FACEBOOK_GRAPH_PERMISSION_DENIED",
      "FACEBOOK_ACTUAL_APP_ID_REQUIRED",
      "FACEBOOK_ACTUAL_USER_SUBJECT_REQUIRED",
      "CLIENT_CONNECTION_ADMIN_REQUIRED",
      "REGISTERED_CLIENT_ROOTS_REQUIRED",
      "OAUTH_MEMBERSHIP_CHANGED",
      "AUTHORIZATION_CHANGED",
      "UNREQUESTED_OAUTH_ASSET",
    ];
    for (const reason of disallowed) {
      const plan = chooseRecovery({ reason });
      expect(plan.tool?.actor).not.toBe("automatic_diagnostic");
      expect(plan.tool?.maxAttempts).toBe(1);
    }
  });

  it("does not use another client or silently escalate Meta scopes as fallback", () => {
    expect(chooseRecovery({ reason: "UNREQUESTED_OAUTH_ASSET" }).actionId)
      .toBe("stop_on_security_denial");
    expect(chooseRecovery({ reason: "FACEBOOK_ACTUAL_USER_SUBJECT_REQUIRED" }).tool?.actor)
      .toBe("security_hold");
    expect(chooseRecovery({ reason: "FACEBOOK_GRAPH_TOKEN_INVALID" })).toMatchObject({
      actionId: "reauthorize_expired_or_revoked_token",
      tool: { requiresFreshAuthorization: true, actor: "account_owner" },
    });
  });

  it("uses automatic actions only for diagnostics and never for user consent", () => {
    const automatic = Object.values(RECOVERY_TOOLS).filter(t => t.actor === "automatic_diagnostic");
    expect(automatic.length).toBeGreaterThanOrEqual(4);
    expect(automatic.every(t => !t.requiresFreshAuthorization)).toBe(true);
    expect(Object.values(RECOVERY_TOOLS).filter(t => t.requiresFreshAuthorization)
      .every(t => t.actor === "account_owner")).toBe(true);
  });

  it("enforces a finite strategy sequence and permanently exhausts attempted recovery", () => {
    for (const [reason, actions] of Object.entries(RECOVERY_PLAYBOOKS) as Array<[RecoveryReason, readonly RecoveryToolId[]]>) {
      const ids = [...actions];
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      expect(chooseRecovery({ reason }).status).toBe("NEXT_STEP");
      for (let n = 0; n < ids.length; n++) {
        expect(chooseRecovery({ reason, attempted: ids.slice(0, n) }).actionId).toBe(ids[n]);
      }
      expect(chooseRecovery({ reason, attempted: ids })).toEqual({
        status: "EXHAUSTED", reason, actionId: null, tool: null, remaining: 0,
      });
    }
  });

  it("bounds a repeat attempt and then stops rather than looping", () => {
    const plan1 = chooseRecovery({ reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE" });
    expect(plan1).toMatchObject({ actionId: "probe_provider_health", tool: { maxAttempts: 2 } });
    const plan2 = chooseRecovery({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE",
      attempted: ["probe_provider_health"],
    });
    expect(plan2.actionId).toBe("probe_provider_health");
    const plan3 = chooseRecovery({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE",
      attempted: ["probe_provider_health", "probe_provider_health"],
    });
    expect(plan3).toMatchObject({ actionId: "inspect_internal_failure" });
    expect(chooseRecovery({
      reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE",
      attempted: ["probe_provider_health", "probe_provider_health", "inspect_internal_failure"],
    }).status).toBe("EXHAUSTED");
  });

  it("never incorporates untrusted exception messages, URLs, identities or tokens in public output", () => {
    const secret = "EAA-SYNTHETIC-NOT-REAL-PRIVATE-VALUE";
    for (const reason of [
      secret,
      "https://untrusted.example/?access_token=secret",
      "FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED: private subject",
      "__proto__",
      "toString",
      "",
    ]) {
      const serialized = JSON.stringify(chooseRecovery({ reason }));
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("untrusted.example");
      expect(serialized).not.toContain("private subject");
      expect(serialized).toContain("UNCLASSIFIED");
    }
  });

  it("refuses missing client_id as a schema repair task rather than weakening client isolation", () => {
    expect(chooseRecovery({ reason: "MCP_TOOL_CLIENT_ID_MISSING" }))
      .toMatchObject({ actionId: "fix_mcp_tool_client_contract", tool: { actor: "engineer" } });
  });

  it("checks existing connections without treating them as a cross-tenant fallback", () => {
    const plan = chooseRecovery({ reason: "PERMISSION_OR_CONNECTION_REQUIRED" });
    expect(plan.actionId).toBe("verify_existing_connection");
    expect(plan.tool?.securityBoundary).toContain("another client");
    expect(chooseRecovery({
      reason: "PERMISSION_OR_CONNECTION_REQUIRED",
      attempted: ["verify_existing_connection"],
    }).actionId).toBe("review_client_asset_grants");
  });
});
