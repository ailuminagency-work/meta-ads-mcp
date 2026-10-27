import type express from "express";
import { decryptToken, encryptToken } from "../auth/crypto.js";
import { getFirestore, isFirestoreEnabled } from "../store/firestore.js";
import { logger } from "../utils/logger.js";
import { resolveDeploymentMode, validateAgencyEnvironment } from "./deployment-config.js";
import { isShuttingDown } from "./graceful-shutdown.js";
import { resolveSecurityConfig } from "./security-config.js";

export const READINESS_STORAGE_TIMEOUT_MS = 2000;
const DEFAULT_CACHE_TTL_MS = 5000;
const PROBE_DOCUMENT = "mcp_readiness_probe/probe";

export type ReadinessReason =
  | "shutting_down"
  | "deployment_mode_invalid"
  | "deployment_mode_not_serving"
  | "deployment_config_invalid"
  | "keyring_unavailable"
  | "storage_not_configured"
  | "storage_timeout"
  | "storage_unavailable"
  | "readiness_check_failed";

type CheckState = "ok" | "fail" | "skipped";

export interface ReadinessResult {
  ready: boolean;
  reason?: ReadinessReason;
  checks: { deployment: CheckState; keyring: CheckState; storage: CheckState };
}

export interface ReadinessDeps {
  env: NodeJS.ProcessEnv;
  storageConfigured: () => boolean;
  probeStorage: () => Promise<unknown>;
  checkKeyring: () => void;
  isShuttingDown: () => boolean;
  cacheTtlMs: number;
}

/** Round-trips a value through the keyring the process actually encrypts with. */
export function checkEncryptionKeyring(): void {
  const sealed = encryptToken("readiness", "readiness");
  if (decryptToken(sealed, "readiness") !== "readiness") throw new Error("Keyring round trip mismatch");
}

/**
 * A read, not a write: the answer must prove the credential, project binding and
 * network path work, and /ready is unauthenticated so it must not create data.
 * Write permission is therefore not proven here.
 */
async function probeFirestore(): Promise<void> {
  await getFirestore().doc(PROBE_DOCUMENT).get();
}

function defaultDeps(): ReadinessDeps {
  return {
    env: process.env,
    storageConfigured: isFirestoreEnabled,
    probeStorage: probeFirestore,
    checkKeyring: checkEncryptionKeyring,
    isShuttingDown,
    cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  };
}

function boundedProbe(probe: () => Promise<unknown>, timeoutMs: number): Promise<"ok" | "timeout" | "error"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    (async () => probe())().then(
      () => {
        clearTimeout(timer);
        resolve("ok");
      },
      () => {
        clearTimeout(timer);
        resolve("error");
      },
    );
  });
}

type DeploymentVerdict = { ok: true; storageRequired: boolean } | { ok: false; reason: ReadinessReason };

function judgeDeployment(env: NodeJS.ProcessEnv): DeploymentVerdict {
  let mode: ReturnType<typeof resolveDeploymentMode>;
  try {
    mode = resolveDeploymentMode(env);
  } catch {
    return { ok: false, reason: "deployment_mode_invalid" };
  }
  if (mode === "awaiting_credentials") return { ok: false, reason: "deployment_mode_not_serving" };
  try {
    if (mode === "agency") validateAgencyEnvironment(env);
    return { ok: true, storageRequired: mode === "agency" || resolveSecurityConfig(env).multiTenantEnabled };
  } catch {
    return { ok: false, reason: "deployment_config_invalid" };
  }
}

const SHUTTING_DOWN: ReadinessResult = {
  ready: false,
  reason: "shutting_down",
  checks: { deployment: "skipped", keyring: "skipped", storage: "skipped" },
};

/**
 * Readiness is "can this instance do useful work now", unlike /health, which is
 * process liveness: a platform restarts on a failed liveness probe, and
 * restarting does not repair a revoked Firestore credential or an unreachable
 * project. Answers are cached briefly and concurrent callers share one probe so
 * an unauthenticated caller cannot turn this route into Firestore load.
 */
export function createReadinessCheck(overrides: Partial<ReadinessDeps> = {}): () => Promise<ReadinessResult> {
  const deps: ReadinessDeps = { ...defaultDeps(), ...overrides };
  let verdict: DeploymentVerdict | undefined;
  let cached: { at: number; result: ReadinessResult } | undefined;
  let inFlight: Promise<ReadinessResult> | undefined;
  let lastReady: boolean | undefined;

  const evaluate = async (): Promise<ReadinessResult> => {
    verdict ??= judgeDeployment(deps.env);
    const checks: ReadinessResult["checks"] = { deployment: "ok", keyring: "ok", storage: "skipped" };
    let reason: ReadinessReason | undefined;

    if (!verdict.ok) {
      checks.deployment = "fail";
      reason = verdict.reason;
    }
    try {
      deps.checkKeyring();
    } catch {
      checks.keyring = "fail";
      reason ??= "keyring_unavailable";
    }
    if (verdict.ok) {
      if (!deps.storageConfigured()) {
        if (verdict.storageRequired) {
          checks.storage = "fail";
          reason ??= "storage_not_configured";
        }
      } else {
        const outcome = await boundedProbe(deps.probeStorage, READINESS_STORAGE_TIMEOUT_MS);
        checks.storage = outcome === "ok" ? "ok" : "fail";
        if (outcome !== "ok") reason ??= outcome === "timeout" ? "storage_timeout" : "storage_unavailable";
      }
    }

    const result: ReadinessResult = reason ? { ready: false, reason, checks } : { ready: true, checks };
    if (lastReady !== result.ready && (lastReady !== undefined || !result.ready)) {
      logger.warn({ event: "readiness_changed", ready: result.ready, reason: result.reason, checks }, "Readiness changed");
    }
    lastReady = result.ready;
    return result;
  };

  return async () => {
    if (deps.isShuttingDown()) return SHUTTING_DOWN;
    if (cached && Date.now() - cached.at < deps.cacheTtlMs) return cached.result;
    inFlight ??= evaluate()
      .then((result) => {
        cached = { at: Date.now(), result };
        return result;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

export function createReadinessHandler(check: () => Promise<ReadinessResult>): express.RequestHandler {
  return async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let result: ReadinessResult;
    try {
      result = await check();
    } catch {
      res.status(503).json({ status: "not_ready", reason: "readiness_check_failed" satisfies ReadinessReason });
      return;
    }
    if (result.ready) {
      res.status(200).json({ status: "ready", checks: result.checks });
      return;
    }
    res.status(503).json({ status: "not_ready", reason: result.reason, checks: result.checks });
  };
}
