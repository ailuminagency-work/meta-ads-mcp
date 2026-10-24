/**
 * Lumin Meta Connection Recovery Toolbox — Phase 1, policy-only foundation.
 *
 * This module DOES NOT execute OAuth exchanges, change grants, retry one-use
 * authorization codes, or dispatch provider operations. It classifies a
 * previously VERIFIED internal reason into a bounded, security-preserving
 * recovery playbook. Production activation must inject independently reviewed
 * action handlers and revalidate tenant/client/operator authorization.
 *
 * Never pass untrusted exception text, token content, URLs, or identifiers to
 * this module as a recovery reason.
 */

export type RecoveryActor = "automatic_diagnostic" | "account_owner" | "agency_operator" | "engineer" | "security_hold";
export type RecoveryStatus = "NEXT_STEP" | "EXHAUSTED" | "UNKNOWN_CAUSE";
export interface RecoveryTool {
  readonly actor: RecoveryActor;
  readonly title: string;
  readonly instruction: string;
  readonly maxAttempts: number;
  readonly requiresFreshAuthorization: boolean;
  readonly securityBoundary: string;
}

/**
 * Each entry is a distinct predefined recovery procedure, not a bypass.
 * "automatic_diagnostic" is restricted to safe/idempotent reads or waiting;
 * no tool here performs side effects until a separately approved executor is
 * integrated. Non-automatic steps always require the indicated human role.
 */
export const RECOVERY_TOOLS = {
  probe_provider_health: {
    actor: "automatic_diagnostic", title: "Check Meta reachability",
    instruction: "Perform a bounded unauthenticated provider-health check; do not repeat the OAuth code exchange.",
    maxAttempts: 2, requiresFreshAuthorization: false,
    securityBoundary: "No token exchange, no login replay, no resource access.",
  },
  honor_rate_limit: {
    actor: "automatic_diagnostic", title: "Honor Meta Retry-After",
    instruction: "Schedule a single read-only health probe after the provider's validated Retry-After with jitter and a hard upper bound.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Never retry a consumed authorization code or mutation.",
  },
  recheck_storage_health: {
    actor: "automatic_diagnostic", title: "Check encrypted-store availability",
    instruction: "Verify read-only Firestore connectivity and expected schema availability without decrypting or modifying credentials.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "No credential export, re-keying, or tenant data mutation.",
  },
  refresh_mcp_discovery: {
    actor: "automatic_diagnostic", title: "Refresh MCP discovery metadata",
    instruction: "Re-fetch published public MCP/OAuth discovery metadata and compare canonical endpoints; do not register new clients automatically.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Never weaken issuer, audience, PKCE, DCR, or resource checks.",
  },
  verify_existing_connection: {
    actor: "automatic_diagnostic", title: "Check already-authorized connection",
    instruction: "Read connection status only; require an exact existing app, subject, client, tenant, asset and scope match before reporting reusable access.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Never substitute another client, identity, token, or revoked grant.",
  },
  start_fresh_signed_challenge: {
    actor: "account_owner", title: "Start fresh OAuth authorization",
    instruction: "Return to the authenticated connection screen and start a new signed, one-use state-bound Meta consent flow.",
    maxAttempts: 1, requiresFreshAuthorization: true,
    securityBoundary: "Never replay a code, reuse a consumed state, or skip interactive Meta verification.",
  },
  restore_browser_session: {
    actor: "account_owner", title: "Restore operator login session",
    instruction: "Reauthenticate with the correct authorized identity through the normal secure first-party login, then restart consent.",
    maxAttempts: 1, requiresFreshAuthorization: true,
    securityBoundary: "No cookie copying, automatic password entry, or 2FA bypass.",
  },
  restart_on_canonical_origin: {
    actor: "account_owner", title: "Restart from trusted Lumin origin",
    instruction: "Open the official Lumin connection page directly and submit the signed same-origin form.",
    maxAttempts: 1, requiresFreshAuthorization: true,
    securityBoundary: "Do not accept foreign Origin headers or disable CSRF checks.",
  },
  audit_canonical_redirect: {
    actor: "engineer", title: "Audit exact OAuth origin and redirect",
    instruction: "Compare deployed SERVER_URL, provider redirect allowlist and actual browser Origin using sanitized evidence; correct config only after approval.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Never dynamically allow arbitrary origins or callback URLs.",
  },
  reauthorize_exact_scopes: {
    actor: "account_owner", title: "Consent to exact permission profile",
    instruction: "Launch the approved read-only Meta flow with the minimal scopes; require explicit Meta consent when needed.",
    maxAttempts: 1, requiresFreshAuthorization: true,
    securityBoundary: "No silent scope escalation, broad Business Login fallback, or write permission grant.",
  },
  review_scope_mismatch: {
    actor: "engineer", title: "Review trusted versus actual Meta grants",
    instruction: "Compare allowlisted scope names and consent configuration without logging tokens or accepting mutation-capable extras.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Keep fail-closed scope validation and verified app identity.",
  },
  validate_meta_app_binding: {
    actor: "engineer", title: "Validate app and token subject binding",
    instruction: "Check expected Meta app, token type and actor against trusted enrollment evidence with privacy-preserving diagnostics.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "No cross-app, cross-operator or system-user impersonation.",
  },
  repair_provider_schema_contract: {
    actor: "engineer", title: "Correct verified provider response contract",
    instruction: "Review sanitized response shape classification; add narrowly validated compatibility support with regression tests if needed.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "No accept-any schema, payload logging, or opaque token acceptance.",
  },
  review_agency_membership: {
    actor: "agency_operator", title: "Review authorized operator membership",
    instruction: "Verify the correct active tenant, member role and allowed client assignment through audited administration.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Do not auto-create principals, grants or administrator roles.",
  },
  review_client_asset_grants: {
    actor: "agency_operator", title: "Review business and asset grant",
    instruction: "Verify the actual client-owned or explicitly shared business and exact ad-account assignment; request the owner's action when missing.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Never infer client ownership from account name or use unrelated assets.",
  },
  request_owner_partner_access: {
    actor: "account_owner", title: "Request missing Meta partner access",
    instruction: "Ask an authorized business administrator to grant the documented least-privilege partner/asset access through Meta's own workflow.",
    maxAttempts: 1, requiresFreshAuthorization: true,
    securityBoundary: "Cannot bypass Meta Business verification, 2FA or business consent.",
  },
  reauthorize_expired_or_revoked_token: {
    actor: "account_owner", title: "Reauthorize revoked or expired access",
    instruction: "Stop using the invalid credential and complete the supported fresh login or authorized credential-rotation workflow.",
    maxAttempts: 1, requiresFreshAuthorization: true,
    securityBoundary: "Never retry a revoked credential or silently switch user identities.",
  },
  reconcile_existing_enrollment: {
    actor: "agency_operator", title: "Review an existing enrolled connection",
    instruction: "Inspect the current connection and its exact authorized client/assets before deciding whether any fresh consent is necessary.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Never overwrite a connection with another client's credential.",
  },
  fix_mcp_tool_client_contract: {
    actor: "engineer", title: "Repair tool input and client binding",
    instruction: "Align declared MCP tool input schemas with required client_id and validate chosen tenant/client context before dispatch.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "Never omit client_id enforcement or infer a default across multiple clients.",
  },
  inspect_internal_failure: {
    actor: "engineer", title: "Diagnose unknown internal failure",
    instruction: "Investigate with sanitized error category, correlation ID and deployment evidence; do not automatically reauthorize.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "No raw exception serialization, token logs or automatic privilege changes.",
  },
  stop_on_security_denial: {
    actor: "security_hold", title: "Hold on identity or access tampering",
    instruction: "Stop recovery attempts and require independent security review when app, subject, state or client isolation fails.",
    maxAttempts: 1, requiresFreshAuthorization: false,
    securityBoundary: "No fallback credentials, alternate identities or consent bypass.",
  },
} as const satisfies Record<string, RecoveryTool>;

export type RecoveryToolId = keyof typeof RECOVERY_TOOLS;

/** Known internal error reason -> ordered sequence of reviewed procedures. */
export const RECOVERY_PLAYBOOKS = {
  META_PROVIDER_TEMPORARILY_UNAVAILABLE: ["probe_provider_health", "inspect_internal_failure"],
  META_PROVIDER_RATE_LIMITED: ["honor_rate_limit", "probe_provider_health", "inspect_internal_failure"],
  ENCRYPTED_STORE_TEMPORARILY_UNAVAILABLE: ["recheck_storage_health", "inspect_internal_failure"],
  MCP_OAUTH_DISCOVERY_MISMATCH: ["refresh_mcp_discovery", "audit_canonical_redirect"],
  MCP_TOOL_CLIENT_ID_MISSING: ["fix_mcp_tool_client_contract"],
  AUTHENTICATED_PLATFORM_OPERATOR_REQUIRED: ["restore_browser_session", "review_agency_membership"],
  ORIGIN_MISMATCH: ["audit_canonical_redirect", "restart_on_canonical_origin"],
  BROWSER_ORIGIN_UNVERIFIED: ["restart_on_canonical_origin", "audit_canonical_redirect"],
  CONNECTION_CHALLENGE_EXPIRED_REPLAYED_OR_MISMATCHED: ["start_fresh_signed_challenge"],
  INVALID_CONNECTION_CHALLENGE_LOOKUP: ["start_fresh_signed_challenge"],
  FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED: ["review_scope_mismatch", "reauthorize_exact_scopes"],
  FACEBOOK_ACTUAL_GRANTED_PERMISSIONS_REQUIRED: ["reauthorize_exact_scopes", "review_scope_mismatch"],
  FACEBOOK_INCREMENTAL_SCOPE_PROFILE_REQUIRED: ["review_scope_mismatch", "reauthorize_exact_scopes"],
  FACEBOOK_ACTUAL_APP_ID_REQUIRED: ["validate_meta_app_binding", "stop_on_security_denial"],
  FACEBOOK_ACTUAL_USER_SUBJECT_REQUIRED: ["stop_on_security_denial"],
  ACTUAL_OPERATOR_SUBJECT_REQUIRED: ["stop_on_security_denial"],
  FACEBOOK_OAUTH_TOKEN_EXCHANGE_RESPONSE_INVALID: ["repair_provider_schema_contract"],
  FACEBOOK_OAUTH_LONG_TOKEN_RESPONSE_INVALID: ["repair_provider_schema_contract"],
  FACEBOOK_OAUTH_DEBUG_TOKEN_RESPONSE_INVALID: ["repair_provider_schema_contract"],
  FACEBOOK_OAUTH_USER_RESPONSE_INVALID: ["repair_provider_schema_contract"],
  FACEBOOK_OAUTH_PERMISSION_RESPONSE_INVALID: ["repair_provider_schema_contract"],
  FACEBOOK_OAUTH_RESPONSE_SCHEMA_INVALID: ["repair_provider_schema_contract"],
  FACEBOOK_OAUTH_TRANSPORT_OR_RESPONSE_FAILED: ["inspect_internal_failure"],
  OAUTH_PROVIDER_EXCHANGE_OR_INSPECTION_FAILED: ["inspect_internal_failure"],
  FACEBOOK_GRAPH_PERMISSION_DENIED: ["review_client_asset_grants", "request_owner_partner_access"],
  CLIENT_CONNECTION_ADMIN_REQUIRED: ["review_agency_membership"],
  REGISTERED_CLIENT_ROOTS_REQUIRED: ["review_client_asset_grants", "request_owner_partner_access"],
  REGISTERED_CLIENT_ASSET_AND_TASKS_REQUIRED: ["review_client_asset_grants", "request_owner_partner_access"],
  FACEBOOK_GRAPH_TOKEN_INVALID: ["reauthorize_expired_or_revoked_token"],
  FACEBOOK_TOKEN_EXPIRED: ["reauthorize_expired_or_revoked_token"],
  OAUTH_MEMBERSHIP_CHANGED: ["review_agency_membership"],
  OAUTH_PROFILE_CHANGED: ["review_scope_mismatch"],
  UNREQUESTED_OAUTH_ASSET: ["stop_on_security_denial"],
  DUPLICATE_OAUTH_ASSET_TOKEN: ["reconcile_existing_enrollment"],
  PERMISSION_OR_CONNECTION_REQUIRED: ["verify_existing_connection", "review_client_asset_grants"],
  SELECTED_CONNECTION_UNAVAILABLE: ["verify_existing_connection", "reauthorize_expired_or_revoked_token"],
  AUTHORIZATION_CHANGED: ["review_agency_membership", "review_client_asset_grants"],
} as const satisfies Record<string, readonly RecoveryToolId[]>;

export type RecoveryReason = keyof typeof RECOVERY_PLAYBOOKS;

export interface RecoveryInput {
  /** Must come from a trusted, internally classified reason, not exception text. */
  readonly reason: string;
  /** Strategy IDs already attempted in this SAME recovery incident. */
  readonly attempted?: readonly string[];
}
export interface RecoveryDecision {
  readonly status: RecoveryStatus;
  readonly reason: string;
  readonly actionId: RecoveryToolId | null;
  readonly tool: RecoveryTool | null;
  readonly remaining: number;
}

/**
 * Deterministic, bounded selector. Never interprets provider raw text.
 *
 * Automatic steps are read-only diagnostics (not OAuth token exchanges).
 * A real executor must maintain a durable per-incident attempt ledger and
 * verify the same tenant/client/operator and current permissions at execution.
 */
export function chooseRecovery(input: RecoveryInput): RecoveryDecision {
  if (!Object.hasOwn(RECOVERY_PLAYBOOKS, input.reason)) {
    return { status: "UNKNOWN_CAUSE", reason: "UNCLASSIFIED", actionId: "inspect_internal_failure",
      tool: RECOVERY_TOOLS.inspect_internal_failure, remaining: 0 };
  }
  const key = input.reason as RecoveryReason;
  const steps: readonly RecoveryToolId[] = RECOVERY_PLAYBOOKS[key];
  const tried = input.attempted ?? [];
  for (let i = 0; i < steps.length; i++) {
    const actionId = steps[i];
    const tool: RecoveryTool = RECOVERY_TOOLS[actionId];
    if (tried.filter(x => x === actionId).length >= tool.maxAttempts) continue;
    return { status: "NEXT_STEP", reason: key, actionId, tool, remaining: steps.length - i - 1 };
  }
  return { status: "EXHAUSTED", reason: key, actionId: null, tool: null, remaining: 0 };
}

