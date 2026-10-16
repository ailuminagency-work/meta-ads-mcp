import type { PlatformRepository } from "./repository.js";
import { capabilityReadSnapshot } from "./registry-snapshot.js";
import { listLegacyCapabilities } from "./legacy-capabilities.js";
import type { ProductContract } from "./products/contracts.js";
import { PRODUCT_CONTRACTS } from "./products/contracts.js";
import { PlatformDenied, type Connection, type OperationContext, type OperationPlan } from "./models.js";
import { resolveAuthorizedAssets } from "./assets.js";
import { selectConnection } from "./connections.js";
import { evaluatePolicy } from "./policy.js";
import { isOfficialEligibilitySource } from "./clients.js";
import { getPlatformRepository, platformWritesEnabled } from "./runtime.js";

export const CAPABILITY_STATUSES = ["AVAILABLE", "PARTIAL", "NOT_CONNECTED", "PERMISSION_REQUIRED", "ADVANCED_ACCESS_REQUIRED", "APP_REVIEW_REQUIRED", "BUSINESS_VERIFICATION_REQUIRED", "TECH_PROVIDER_REQUIRED", "ACCESS_TIER_REQUIRED", "USER_CONSENT_REQUIRED", "ASSET_ACCESS_REQUIRED", "TOKEN_EXPIRED", "DASHBOARD_ONLY", "UNSUPPORTED_BY_META_API", "DISABLED_BY_LUMIN_POLICY", "UNVERIFIED"] as const;
export type CapabilityStatus = typeof CAPABILITY_STATUSES[number];
export interface CapabilityReport {
  id: string; product: string; provider: string; tool: string; status: CapabilityStatus;
  apiAvailability: "VERIFIED" | "UNVERIFIED"; requiredPermissions: string[]; grantedPermissions: string[];
  connectedAssetIds: string[]; accessLevel: "UNVERIFIED"; appReview: "UNVERIFIED"; businessVerification: "UNVERIFIED";
  techProvider: "UNVERIFIED"; marketingAccessTier: "UNVERIFIED"; userConsentRequired: boolean; pageTasks: string[];
  tokenTypes: string[]; readAvailable: boolean; writeAvailable: boolean; activationAvailable: boolean;
  reasons: string[]; remediation: string[]; documentation: string[];
}
function eligibilityVerified(connection: Connection, contract: ProductContract, now: number, maximumAge: number): boolean {
  return contract.manualRequirements.every(requirement => connection.eligibility?.some(e =>
    e.requirement === requirement && e.verified === true && Number.isFinite(e.checkedAt) &&
    e.checkedAt > 0 && e.checkedAt <= now && now - e.checkedAt <= maximumAge &&
    Number.isFinite(e.expiresAt) && e.expiresAt > now &&
    isOfficialEligibilitySource(e.source),
  ));
}

export async function capabilityStatus(ctx: OperationContext, contract: ProductContract, now = Date.now(), repo:PlatformRepository = getPlatformRepository()): Promise<CapabilityReport> {
  const context: OperationContext = { ...ctx, provider: contract.provider, tool: contract.tool };
  const isRead = contract.operationClasses.every(operation => operation === "READ");
  const maximumAge = isRead ? 60 * 60_000 : 5 * 60_000;
  let selected: Connection | undefined;
  const report = (status: CapabilityStatus, reasons: string[], assetIds: string[] = []): CapabilityReport => ({
    id: contract.id, product: contract.product, provider: contract.provider, tool: contract.tool, status,
    apiAvailability: contract.verified ? "VERIFIED" : "UNVERIFIED",
    requiredPermissions: [...contract.requiredScopes], grantedPermissions: [...selected?.scopes ?? []].sort(),
    connectedAssetIds: assetIds, accessLevel: "UNVERIFIED", appReview: "UNVERIFIED",
    businessVerification: "UNVERIFIED", techProvider: "UNVERIFIED", marketingAccessTier: "UNVERIFIED",
    userConsentRequired: status === "NOT_CONNECTED" || status === "USER_CONSENT_REQUIRED",
    pageTasks: [...contract.requiredTasks ?? []], tokenTypes: [...contract.tokenTypes],
    readAvailable: status === "AVAILABLE" && isRead, writeAvailable: status === "AVAILABLE" && !isRead,
    activationAvailable: false, reasons,
    remediation: [...contract.manualRequirements, ...(status === "AVAILABLE" ? [] : ["Verify the product contract, incremental consent, selected connection, current grants, every parent asset and operation policy before execution."])],
    documentation: [...contract.documentation],
  });
  if (!contract.verified) return report("UNVERIFIED", [contract.unverifiedReason ?? "Exact endpoint and permission contract is unverified."]);
  const [tenant, member, client] = await Promise.all([
    repo.get("tenants", context.principal.tenantId, context.principal.tenantId),
    repo.get("members", context.principal.tenantId, context.principal.operatorId),
    repo.get("clients", context.principal.tenantId, context.clientId),
  ]);
  if (!tenant || tenant.id !== context.principal.tenantId || tenant.status !== "ACTIVE" || tenant.migrationState !== "READY") return report("DISABLED_BY_LUMIN_POLICY", ["TENANT_NOT_READY"]);
  if (!member || member.operatorId !== context.principal.operatorId || member.tenantId !== context.principal.tenantId || member.disabledAt !== null || !member.allowedClientIds.includes(context.clientId) || !client || client.id !== context.clientId || client.tenantId !== context.principal.tenantId || client.status !== "ACTIVE") return report("ASSET_ACCESS_REQUIRED", ["CLIENT_MEMBERSHIP_REQUIRED"]);
  if (!isRead && !platformWritesEnabled()) return report("DISABLED_BY_LUMIN_POLICY", ["Platform mutations are disabled by deployment policy."]);
  const connections = (await repo.list("connections", context.principal.tenantId)).filter(connection =>
    connection.tenantId === context.principal.tenantId && connection.operatorId === context.principal.operatorId &&
    connection.provider === contract.provider && connection.revokedAt === null,
  );
  if (!connections.length) return report("NOT_CONNECTED", ["No product-specific connection exists for this operator."]);
  const live = connections.filter(connection => connection.expiresAt === null || connection.expiresAt > now);
  if (!live.length) return report("TOKEN_EXPIRED", ["Product credentials are expired; no broader provider fallback is allowed."]);
  if (!live.some(connection => contract.tokenTypes.includes(connection.tokenType) && contract.requiredScopes.every(scope => connection.scopes.includes(scope)))) return report("PERMISSION_REQUIRED", ["No single connection has the required actual scope grant and token type."]);
  const candidates = (await repo.list("assets", context.principal.tenantId)).filter(asset =>
    asset.tenantId === context.principal.tenantId && asset.clientId === context.clientId &&
    asset.provider === contract.provider && asset.type === contract.assetType && asset.revokedAt === null,
  ).sort((a, b) => a.key.localeCompare(b.key));
  if (!candidates.length) return report("ASSET_ACCESS_REQUIRED", ["No exact-provider client asset is registered."]);
  let fallback: CapabilityReport | undefined;
  const deniedReasons = new Set<string>();
  for (const candidate of candidates) {
    const plan: OperationPlan = {
      parameters: {}, assets: [{ type: candidate.type, id: candidate.id }], classes: [...contract.operationClasses],
      capability: contract.id, requiredScopes: [...contract.requiredScopes], tokenTypes: [...contract.tokenTypes],
      ...(contract.requiredTasks ? { requiredTasks: [...contract.requiredTasks] } : {}),
      ...(contract.createOrCopy ? { createOrCopy: true } : {}),
    };
    try {
      const assets = await resolveAuthorizedAssets(repo, context, plan.assets, now, maximumAge);
      const connection = await selectConnection(repo, context, plan, assets, now);
      selected = connection;
      const grants = (await repo.list("grants", context.principal.tenantId)).filter(grant =>
        grant.connectionId === connection.id && grant.tenantId === context.principal.tenantId &&
        grant.clientId === context.clientId && assets.some(asset => asset.key === grant.assetKey) &&
        grant.revokedAt === null && grant.expiresAt > now,
      );
      const decision = evaluatePolicy(context, plan, { tenant, member, client, assets, connection, grants }, { writesEnabled: platformWritesEnabled() });
      if (decision.decision === "DENY") {
        fallback ??= report("DISABLED_BY_LUMIN_POLICY", [decision.reason]);
        continue;
      }
      const credential = await repo.get("credentials", context.principal.tenantId, connection.credentialId);
      if (!credential || credential.id !== connection.credentialId || credential.tenantId !== connection.tenantId || credential.operatorId !== connection.operatorId || credential.provider !== connection.provider || credential.appId !== connection.appId || credential.envelopeVersion !== 1 || credential.keyVersion !== "primary") {
        fallback ??= report("UNVERIFIED", ["CREDENTIAL_BINDING_REQUIRED"]);
        continue;
      }
      if (!eligibilityVerified(connection, contract, now, maximumAge)) {
        fallback ??= report("UNVERIFIED", ["Fresh independently verified evidence is required for every eligibility condition."], [candidate.id]);
        continue;
      }
      if (decision.decision === "REQUIRE_CONFIRMATION") {
        fallback ??= report("USER_CONSENT_REQUIRED", [decision.reason], [candidate.id]);
        continue;
      }
      return report("AVAILABLE", [], [candidate.id]);
    } catch (error) {
      if (!(error instanceof PlatformDenied)) throw error;
      deniedReasons.add(error.reason);
    }
  }
  if (fallback) return fallback;
  selected = undefined;
  return report("ASSET_ACCESS_REQUIRED", [...deniedReasons].sort().length ? [...deniedReasons].sort() : ["No asset and parent-grant chain satisfies this capability."]);
}
export async function listCapabilities(ctx: OperationContext): Promise<CapabilityReport[]> { const repo=capabilityReadSnapshot(getPlatformRepository()),now=Date.now(),reports:CapabilityReport[]=[];for(let i=0;i<PRODUCT_CONTRACTS.length;i+=8)reports.push(...await Promise.all(PRODUCT_CONTRACTS.slice(i,i+8).map(c=>capabilityStatus(ctx,c,now,repo))));return [...reports,...await listLegacyCapabilities(ctx,repo)]; }

export const MANUAL_ACTIONS = [
  { id: "app_review", status: "APP_REVIEW_REQUIRED", whyManual: "Review submission and approval require Meta's dashboard and human business evidence.", location: "Meta for Developers → app → Review → App Review", input: "Verified product permissions, screencast, test instructions and privacy/deletion evidence", verification: "Record approved access level and test with a consenting external client; an admin-only success is insufficient." },
  { id: "business_verification", status: "UNVERIFIED", whyManual: "Product-specific eligibility and business identity cannot be inferred from token success.", location: "Meta for Developers → app → Review → Verification (confirm current dashboard location)", input: "Business identity and product eligibility evidence", verification: "Inspect actual dashboard status and independently verify required product access." },
  { id: "app_publication", status: "DASHBOARD_ONLY", whyManual: "Publishing the app is a separately authorized dashboard action.", location: "Meta for Developers → app → Publish", input: "Approved access, verified privacy and data deletion configuration", verification: "Confirm published status and external-client consent without changing asset ownership." },
  { id: "login_profiles", status: "USER_CONSENT_REQUIRED", whyManual: "A client must consent to the specific product and assets; do not request every scope at once.", location: "Facebook Login for Business → Configurations; separate Instagram Login and Threads app settings", input: "Minimum verified scopes and exact redirect URI for each supported provider", verification: "Validate actual granted permissions, token subject, token type and assets after callback." },
  { id: "tech_provider", status: "UNVERIFIED", whyManual: "Tech Provider/Embedded Signup eligibility is product-specific and must not be assumed.", location: "Meta app's WhatsApp/Embedded Signup onboarding (verify exact current dashboard route)", input: "Official eligibility and client consent requirements", verification: "Confirm approval and shared asset discovery; credit-line sharing requires separate explicit authorization." },
  { id: "marketing_access_tier", status: "ACCESS_TIER_REQUIRED", whyManual: "Higher Marketing API rate access is distinct from permission approval.", location: "Meta app → Review → App Review → Marketing API access tier (verify current label)", input: "Meta's current usage/success evidence and business requirements", verification: "Inspect the awarded tier and actual returned usage headers; do not assume permission parity." },
] as const;
