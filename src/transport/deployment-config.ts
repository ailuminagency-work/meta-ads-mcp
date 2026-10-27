import { resolveSecurityConfig } from "./security-config.js";

export function resolveDeploymentMode(env: NodeJS.ProcessEnv = process.env): "upstream" | "awaiting_credentials" | "agency" {
  // Unset must not quietly mean "upstream": a dropped variable would start the
  // service with every tool, the X-Meta-Token override and the shared-credential
  // fallbacks that agency mode exists to forbid.
  if (env.DEPLOYMENT_MODE === undefined && env.NODE_ENV === "production") {
    throw new Error("DEPLOYMENT_MODE must be set explicitly in production (upstream, awaiting_credentials or agency)");
  }
  const mode = env.DEPLOYMENT_MODE ?? "upstream";
  if (mode !== "upstream" && mode !== "awaiting_credentials" && mode !== "agency") {
    throw new Error("Invalid DEPLOYMENT_MODE");
  }
  return mode;
}

export function validateAgencyEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") throw new Error("Agency mode requires NODE_ENV=production");
  const config = resolveSecurityConfig(env);
  if (!config.multiTenantEnabled) throw new Error("Agency mode requires META_APP_ID and META_APP_SECRET");
  for (const name of ["MCP_API_KEY", "META_ACCESS_TOKEN", "META_TOKENS", "FIRESTORE_EMULATOR_HOST", "APIFY_TOKEN", "GEMINI_API_KEY"]) {
    if (env[name]?.trim()) throw new Error(`${name} is forbidden in agency mode`);
  }
  const firestoreProject = env.FIRESTORE_PROJECT_ID?.trim();
  if (!firestoreProject) throw new Error("Agency mode requires explicit FIRESTORE_PROJECT_ID");
  if (env.GOOGLE_CLOUD_PROJECT?.trim() && env.GOOGLE_CLOUD_PROJECT.trim() !== firestoreProject) {
    throw new Error("FIRESTORE_PROJECT_ID and GOOGLE_CLOUD_PROJECT must match");
  }
  const expectedProject = env.LUMIN_EXPECTED_FIRESTORE_PROJECT_ID?.trim();
  if (expectedProject && firestoreProject !== expectedProject) {
    throw new Error("Firestore project is not approved for this deployment");
  }
  if (!env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) throw new Error("Agency mode requires Google Application Default Credentials configuration");
  const url = new URL(env.SERVER_URL ?? "");
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("SERVER_URL must be an HTTPS origin");
  }
  if (env.META_OAUTH_REDIRECT_URI && env.META_OAUTH_REDIRECT_URI !== `${url.origin}/auth/meta/callback`) {
    throw new Error("Meta OAuth callback must match SERVER_URL/auth/meta/callback");
  }
  validateWriteFlags(env);
}

/**
 * Flags that only mean something once platform writes are on: every non-read
 * platform operation is refused unless `platformWritesEnabled()` holds, which
 * needs LUMIN_PLATFORM_WRITES_ENABLED and AGENCY_WRITES_ENABLED both true. With
 * the global switch off these flags change nothing, so setting one is an
 * operator mistake that reads as intent. Startup refuses it.
 */
export const STRICT_WRITE_FLAGS = [
  "LUMIN_PLATFORM_WRITES_ENABLED",
  "LUMIN_MARKETING_ACTIVATION_ENABLED",
  "LUMIN_MARKETING_DELETION_ENABLED",
  "LUMIN_PAUSED_AD_BATCH_ENABLED",
  "LUMIN_TRACKING_CHANGE_ENABLED",
  "LUMIN_MARKETING_CREATIVE_REPLACEMENT_ENABLED",
  "LUMIN_MARKETING_CBO_ENABLED",
  "LUMIN_MARKETING_VIDEO_CREATIVE_ENABLED",
  "LUMIN_MARKETING_APP_PURCHASE_ENABLED",
  "LUMIN_MARKETING_STUDIES_ENABLED",
  "LUMIN_MESSENGER_UTILITY_ENABLED",
  "LUMIN_MESSAGING_ATTACHMENTS_ENABLED",
  "LUMIN_MESSENGER_ATTACHMENTS_ENABLED",
  "LUMIN_PAGE_VIDEO_ENABLED",
  "LUMIN_PUBLISHING_VIDEO_ENABLED",
  "LUMIN_PLATFORM_SIGNALS_ENABLED",
  "LUMIN_CRM_SIGNALS_ENABLED",
] as const;

/**
 * Also gate read-only behaviour (app event types, setup inspection, paid
 * research), so they may be on with writes off. Reported, never rejected.
 */
const MIXED_WRITE_FLAGS = [
  "LUMIN_MARKETING_APP_PROMOTION_ENABLED",
  "LUMIN_WHATSAPP_SETUP_ENABLED",
  "LUMIN_PAID_RESEARCH_ENABLED",
] as const;

export const OBSERVED_WRITE_FLAGS = [...STRICT_WRITE_FLAGS, ...MIXED_WRITE_FLAGS] as const;

function present(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

function validateWriteFlags(env: NodeJS.ProcessEnv): void {
  for (const name of ["AGENCY_WRITES_ENABLED", ...OBSERVED_WRITE_FLAGS]) {
    const value = present(env, name);
    if (value !== undefined && value !== "true" && value !== "false") {
      throw new Error(`${name} must be an explicit boolean (true or false)`);
    }
  }
  if (env.AGENCY_WRITES_ENABLED === "true") return;
  const enabled = STRICT_WRITE_FLAGS.filter((name) => env[name] === "true");
  if (enabled.length > 0) {
    throw new Error(
      `Write flags are enabled while AGENCY_WRITES_ENABLED is not true: ${enabled.join(", ")}. Set AGENCY_WRITES_ENABLED=true deliberately or set these flags to false`,
    );
  }
}

/** Matches the runtime's own parsing, which ignores an empty value, but refuses a value it would silently misread. */
export function validateVideoConcurrency(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env.VIDEO_MAX_CONCURRENT_JOBS?.trim();
  if (!raw) return;
  if (!/^0*[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error("VIDEO_MAX_CONCURRENT_JOBS must be a positive integer");
  }
}

export type EffectiveAccess = "locked" | "upstream_unrestricted" | "agency_read_only" | "agency_writes_enabled";

export interface DeploymentSummary {
  deploymentMode: ReturnType<typeof resolveDeploymentMode>;
  effectiveAccess: EffectiveAccess;
  agencyWritesEnabled: boolean;
  platformEnabled: boolean;
  platformWritesEffective: boolean;
  legacyWritesWithoutPolicyEngine: boolean;
  writeFlags: Record<(typeof OBSERVED_WRITE_FLAGS)[number], boolean>;
}

/** Booleans and fixed vocabulary only: safe to log, never a value, id or secret. */
export function describeDeployment(
  mode: ReturnType<typeof resolveDeploymentMode>,
  env: NodeJS.ProcessEnv = process.env,
): DeploymentSummary {
  const agencyWritesEnabled = env.AGENCY_WRITES_ENABLED === "true";
  const platformEnabled = env.LUMIN_PLATFORM_ENABLED === "true";
  const effectiveAccess: EffectiveAccess =
    mode === "awaiting_credentials"
      ? "locked"
      : mode === "upstream"
        ? "upstream_unrestricted"
        : agencyWritesEnabled
          ? "agency_writes_enabled"
          : "agency_read_only";
  return {
    deploymentMode: mode,
    effectiveAccess,
    agencyWritesEnabled,
    platformEnabled,
    platformWritesEffective: agencyWritesEnabled && env.LUMIN_PLATFORM_WRITES_ENABLED === "true",
    legacyWritesWithoutPolicyEngine: mode === "agency" && agencyWritesEnabled && !platformEnabled,
    writeFlags: Object.fromEntries(OBSERVED_WRITE_FLAGS.map((name) => [name, env[name] === "true"])) as DeploymentSummary["writeFlags"],
  };
}
