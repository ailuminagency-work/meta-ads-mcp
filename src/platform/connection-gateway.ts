import type { MetaAsset, OperationContext, OperationPlan, Provider, Connection } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { PlatformRepository } from "./repository.js";
import { selectConnection } from "./connections.js";
import { authorizeOperation, withConnectionCredential, type ExecutionPermit } from "./execution.js";

/** Legitimate connection entry methods. The gateway never invents a new one. */
export type ConnectionMethod =
  | "existing_authorized"
  | "agency_partner"
  | "system_user"
  | "direct_user_oauth"
  | "facebook_business_login"
  | "fresh_authorization";

export type ConnectionEligibility =
  | "ELIGIBLE"
  | "OWNER_ACTION_REQUIRED"
  | "AGENCY_ACTION_REQUIRED"
  | "UNAVAILABLE"
  | "SECURITY_HOLD";

export type AdapterResult<T> =
  | { readonly status: "SUPPORTED"; readonly value: T }
  | { readonly status: "UNSUPPORTED"; readonly reason: string };

/**
 * Common contract for provider-specific connection entry methods.
 * Unsupported operations must return an explicit HOLD result; they must not
 * pretend that an adapter exists or silently select a broader credential.
 */
export interface ConnectionAdapter {
  readonly id: string;
  readonly provider: Provider;
  readonly connectionMethod: ConnectionMethod;
  readonly requiredCapabilities: readonly string[];
  validateEligibility(input: unknown): Promise<AdapterResult<ConnectionEligibility>>;
  discoverAuthorizedAssets(input: unknown): Promise<AdapterResult<readonly MetaAsset[]>>;
  beginAuthorization?(input: unknown): Promise<AdapterResult<{ readonly authorizationUrl: string }>>;
  handleCallback?(input: unknown): Promise<AdapterResult<{ readonly connectionId: string }>>;
  inspectCredential(input: unknown): Promise<AdapterResult<{ readonly tokenType: string; readonly scopes: readonly string[] }>>;
  verifyAssetAccess(input: unknown): Promise<AdapterResult<readonly string[]>>;
  healthCheck(input: unknown): Promise<AdapterResult<{ readonly healthy: boolean }>>;
  classifyFailure(input: unknown): string;
  supportedRecovery(input: unknown): readonly string[];
  revokeOrDisconnect(input: unknown): Promise<AdapterResult<{ readonly revoked: true }>>;
}

export interface ConnectionCandidate {
  readonly method: ConnectionMethod;
  readonly provider: Provider;
  readonly tenantId: string;
  readonly clientId: string;
  readonly connectionId?: string;
  readonly assetKeys: readonly string[];
  readonly tokenType?: Connection["tokenType"];
  readonly scopes: readonly string[];
  readonly requiredHumanAction?: "ACCOUNT_OWNER" | "AGENCY_OPERATOR";
  readonly reason: string;
}

export interface ConnectionGatewayResult {
  readonly status: ConnectionEligibility;
  readonly selectedMethod: ConnectionMethod | null;
  readonly candidate: ConnectionCandidate | null;
  readonly alternatives: readonly ConnectionCandidate[];
  readonly reason: string;
}

const securityStops = new Set([
  "PLATFORM_MEMBERSHIP_REQUIRED",
  "CLIENT_MEMBERSHIP_REQUIRED",
  "ASSET_REGISTRY_BINDING_REQUIRED",
  "SELECTED_CONNECTION_UNAVAILABLE",
  "SCOPED_ASSET_TASK_REFERENCE_REQUIRED",
  "UNREQUESTED_OAUTH_ASSET",
  "OAUTH_MEMBERSHIP_CHANGED",
]);

/**
 * Deterministic, read-only strategy selection around the existing authorization
 * primitives. It evaluates reuse first and returns owner/agency handoff states
 * when a new grant is required. It never exchanges codes or creates records.
 */
export class ConnectionStrategyGateway {
  public constructor(private readonly repository: PlatformRepository) {}

  private async verifyScope(input: {
    readonly context: OperationContext;
    readonly plan: OperationPlan;
    readonly assets: readonly MetaAsset[];
  }): Promise<MetaAsset[]> {
    const { context, plan, assets } = input;
    const tenantId = context.principal.tenantId;
    const operatorId = context.principal.operatorId;
    if (assets.length === 0) throw new PlatformDenied("SCOPED_ASSET_TASK_REFERENCE_REQUIRED");
    const tenant = await this.repository.get("tenants", tenantId, tenantId);
    const member = await this.repository.get("members", tenantId, operatorId);
    const client = await this.repository.get("clients", tenantId, context.clientId);
    if (!tenant || tenant.id !== tenantId || tenant.status !== "ACTIVE" || tenant.migrationState !== "READY" ||
        !member || member.tenantId !== tenantId || member.operatorId !== operatorId ||
        member.disabledAt !== null || !member.roles.some(role => role === "admin" || role === "connection_admin") ||
        !member.allowedClientIds.includes(context.clientId)) {
      throw new PlatformDenied("PLATFORM_MEMBERSHIP_REQUIRED");
    }
    if (!client || client.tenantId !== tenantId || client.id !== context.clientId || client.status !== "ACTIVE") {
      throw new PlatformDenied("CLIENT_MEMBERSHIP_REQUIRED");
    }
    const seen = new Set<string>();
    const seenRefs = new Set<string>();
    const planRefs = new Set((plan.assets ?? []).map(asset => `${asset.type}:${asset.id.replace(/^act_/, "")}`));
    const resolved: MetaAsset[] = [];
    for (const supplied of assets) {
      if (seen.has(supplied.key) || supplied.tenantId !== tenantId || supplied.clientId !== context.clientId ||
          supplied.provider !== context.provider || supplied.revokedAt !== null ||
          (planRefs.size > 0 && !planRefs.has(`${supplied.type}:${supplied.id.replace(/^act_/, "")}`))) {
        throw new PlatformDenied("ASSET_REGISTRY_BINDING_REQUIRED");
      }
      seen.add(supplied.key);
      seenRefs.add(`${supplied.type}:${supplied.id.replace(/^act_/, "")}`);
      const authoritative = await this.repository.get("assets", tenantId, supplied.key);
      if (!authoritative || authoritative.key !== supplied.key || authoritative.id.replace(/^act_/, "") !== supplied.id.replace(/^act_/, "") ||
          authoritative.type !== supplied.type || authoritative.tenantId !== tenantId || authoritative.clientId !== context.clientId ||
          authoritative.provider !== context.provider || authoritative.appId !== supplied.appId || authoritative.revokedAt !== null) {
        throw new PlatformDenied("ASSET_REGISTRY_BINDING_REQUIRED");
      }
      resolved.push(authoritative);
    }
    if (planRefs.size > 0 && (seenRefs.size !== planRefs.size || [...planRefs].some(ref => !seenRefs.has(ref)))) {
      throw new PlatformDenied("ASSET_REGISTRY_BINDING_REQUIRED");
    }
    return resolved;
  }

  public async evaluate(input: {
    readonly context: OperationContext;
    readonly plan: OperationPlan;
    readonly assets: readonly MetaAsset[];
    readonly now?: number;
    readonly selectedConnectionId?: string;
  }): Promise<ConnectionGatewayResult> {
    const { context, plan, assets } = input;
    if (!context.clientId || !context.principal.tenantId || !context.principal.operatorId) {
      return { status: "SECURITY_HOLD", selectedMethod: null, candidate: null,
        alternatives: [], reason: "PLATFORM_MEMBERSHIP_REQUIRED" };
    }
    try {
      const resolvedAssets = await this.verifyScope({ context, plan, assets });
      const connection = await selectConnection(
        this.repository, context, plan, resolvedAssets, input.now ?? Date.now(), input.selectedConnectionId,
      );
      const candidate: ConnectionCandidate = {
        method: "existing_authorized", provider: context.provider,
        tenantId: context.principal.tenantId, clientId: context.clientId,
        connectionId: connection.id, assetKeys: [...connection.assetKeys],
        tokenType: connection.tokenType, scopes: [...connection.scopes],
        reason: "EXACT_AUTHORIZED_CONNECTION_REUSED",
      };
      return { status: "ELIGIBLE", selectedMethod: candidate.method,
        candidate, alternatives: [], reason: candidate.reason };
    } catch (error) {
      const reason = error instanceof PlatformDenied ? error.reason : "CONNECTION_SELECTION_FAILED";
      if (securityStops.has(reason)) {
        return { status: "SECURITY_HOLD", selectedMethod: null, candidate: null,
          alternatives: [], reason };
      }
      if (reason !== "PERMISSION_OR_CONNECTION_REQUIRED") {
        return { status: "UNAVAILABLE", selectedMethod: null, candidate: null,
          alternatives: [], reason };
      }
    }

    const base = {
      provider: context.provider, tenantId: context.principal.tenantId,
      clientId: context.clientId, assetKeys: assets.map(a => a.key), scopes: [...plan.requiredScopes],
    } as const;
    const alternatives: ConnectionCandidate[] = [
      { ...base, method: "agency_partner", requiredHumanAction: "AGENCY_OPERATOR", reason: "PARTNER_ACCESS_REVIEW_REQUIRED" },
      { ...base, method: "system_user", requiredHumanAction: "AGENCY_OPERATOR", reason: "SYSTEM_USER_ELIGIBILITY_REQUIRES_VERIFICATION" },
      { ...base, method: "direct_user_oauth", requiredHumanAction: "ACCOUNT_OWNER", reason: "OWNER_META_CONSENT_REQUIRED" },
      { ...base, method: "facebook_business_login", requiredHumanAction: "ACCOUNT_OWNER", reason: "BUSINESS_LOGIN_CONSENT_REQUIRED" },
      { ...base, method: "fresh_authorization", requiredHumanAction: "ACCOUNT_OWNER", reason: "FRESH_SIGNED_AUTHORIZATION_REQUIRED" },
    ];
    return { status: "OWNER_ACTION_REQUIRED", selectedMethod: "fresh_authorization",
      candidate: alternatives[4], alternatives, reason: "PERMISSION_OR_CONNECTION_REQUIRED" };
  }
}

/**
 * Narrow broker facade. It accepts only a complete operation plan and context,
 * then delegates to the already-reviewed permit and credential checks. It has
 * no global-token or bare-client fallback API.
 */
export class CredentialBroker {
  public constructor(private readonly repository: PlatformRepository) {}

  public authorize(
    context: OperationContext,
    plan: OperationPlan,
    options: Parameters<typeof authorizeOperation>[3],
  ): Promise<ExecutionPermit> {
    return authorizeOperation(this.repository, context, plan, options);
  }

  public withCredential<T>(permit: ExecutionPermit, fn: (token: string) => Promise<T>): Promise<T> {
    return withConnectionCredential(permit, fn);
  }
}

