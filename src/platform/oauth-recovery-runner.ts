import {
  chooseRecovery,
  type RecoveryToolId,
  type RecoveryTool,
} from "./oauth-recovery-toolbox.js";

/**
 * Recovery side effects MUST be wired only through reviewed handlers.
 * For each incident, the ledger must be durably bound to the original tenant,
 * client, operator, provider, profile and incident nonce. Atomic claim prevents
 * two workers from executing the same recovery check concurrently.
 */
export interface RecoveryAttemptLedger {
  readAttempted(): Promise<readonly string[]>;
  claimAttempt(action: RecoveryToolId, maxAttempts: number): Promise<boolean>;
}

/** The handler may perform ONLY the specified read-only diagnostic check. */
export interface SafeRecoveryDiagnostic {
  inspect(action: RecoveryToolId): Promise<"HEALTHY" | "STILL_FAILING">;
}

export type RecoveryRunStatus =
  | "DIAGNOSTIC_HEALTHY"
  | "ACTION_REQUIRED"
  | "EXHAUSTED"
  | "HOLD_UNCLASSIFIED"
  | "HOLD_CONCURRENT"
  | "HOLD_HANDLER_ERROR"
  | "HOLD_AUTOMATIC_BUDGET";

export interface RecoveryRunResult {
  readonly status: RecoveryRunStatus;
  readonly reason: string;
  readonly actionId: RecoveryToolId | null;
  readonly actor: RecoveryTool["actor"] | null;
  readonly automatedChecks: number;
}

/**
 * Execute a finite chain of approved, idempotent diagnostics.
 *
 * No authorization code exchanges, credential refresh, consent, rights changes,
 * or provider writes are invoked here. A HEALTHY result confirms only that the
 * specified diagnostic is healthy, NOT that the Meta connection is authorized.
 * The caller MUST separately verify successful callback persistence and a
 * client-scoped Meta read before displaying "Connected".
 */
export async function runSafeRecoveryDiagnostics(input: {
  readonly reason: string;
  readonly ledger: RecoveryAttemptLedger;
  readonly diagnostic: SafeRecoveryDiagnostic;
  readonly maxAutomaticChecks?: number;
}): Promise<RecoveryRunResult> {
  // Do not accept a caller-controlled unlimited retry budget.
  const requested = input.maxAutomaticChecks ?? 3;
  const budget = Number.isSafeInteger(requested) && requested >= 0
    ? Math.min(requested, 3) : 0;
  let count = 0;

  while (true) {
    let attempts: readonly string[];
    try {
      attempts = await input.ledger.readAttempted();
      if (!Array.isArray(attempts) || attempts.length > 64 ||
        attempts.some(v => typeof v !== "string" || v.length > 128)) {
        return { status: "HOLD_HANDLER_ERROR", reason: "UNCLASSIFIED",
          actionId: null, actor: null, automatedChecks: count };
      }
    } catch {
      return { status: "HOLD_HANDLER_ERROR", reason: "UNCLASSIFIED",
        actionId: null, actor: null, automatedChecks: count };
    }

    const next = chooseRecovery({ reason: input.reason, attempted: attempts });
    if (next.status === "UNKNOWN_CAUSE") {
      return { status: "HOLD_UNCLASSIFIED", reason: "UNCLASSIFIED",
        actionId: next.actionId, actor: next.tool?.actor ?? null,
        automatedChecks: count };
    }
    if (next.status === "EXHAUSTED") {
      return { status: "EXHAUSTED", reason: next.reason,
        actionId: null, actor: null, automatedChecks: count };
    }
    if (!next.tool || !next.actionId) {
      return { status: "HOLD_HANDLER_ERROR", reason: "UNCLASSIFIED",
        actionId: null, actor: null, automatedChecks: count };
    }
    if (next.tool.actor !== "automatic_diagnostic") {
      return { status: "ACTION_REQUIRED", reason: next.reason,
        actionId: next.actionId, actor: next.tool.actor, automatedChecks: count };
    }
    if (count >= budget) {
      return { status: "HOLD_AUTOMATIC_BUDGET", reason: next.reason,
        actionId: next.actionId, actor: next.tool.actor, automatedChecks: count };
    }
    try {
      // Persistent atomic reservation MUST occur before any side effect.
      const claimed = await input.ledger.claimAttempt(
        next.actionId, next.tool.maxAttempts,
      );
      if (!claimed) {
        return { status: "HOLD_CONCURRENT", reason: next.reason,
          actionId: next.actionId, actor: next.tool.actor, automatedChecks: count };
      }
      count++;
      const outcome = await input.diagnostic.inspect(next.actionId);
      if (outcome === "HEALTHY") {
        return { status: "DIAGNOSTIC_HEALTHY", reason: next.reason,
          actionId: next.actionId, actor: next.tool.actor, automatedChecks: count };
      }
      if (outcome !== "STILL_FAILING") {
        return { status: "HOLD_HANDLER_ERROR", reason: next.reason,
          actionId: next.actionId, actor: next.tool.actor, automatedChecks: count };
      }
    } catch {
      // Never retry after an uncertain handler execution.
      return { status: "HOLD_HANDLER_ERROR", reason: next.reason,
        actionId: next.actionId, actor: next.tool.actor, automatedChecks: count };
    }
  }
}
