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
  if (env.AGENCY_WRITES_ENABLED && !["false", "true"].includes(env.AGENCY_WRITES_ENABLED)) {
    throw new Error("AGENCY_WRITES_ENABLED must be an explicit boolean");
  }
}
