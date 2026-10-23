import { randomUUID } from "node:crypto";
import { getCurrentFbUserId } from "../auth/token-store.js";
import { getFirestore } from "../store/firestore.js";
import { FirestorePlatformRepository, type PlatformRepository } from "./repository.js";
import { PlatformDenied, type OperationContext, type Provider } from "./models.js";

let repository: PlatformRepository | undefined;
export function platformEnabled(): boolean { const value = process.env.LUMIN_PLATFORM_ENABLED; if (value !== undefined && value !== "true" && value !== "false") throw new PlatformDenied("INVALID_PLATFORM_FEATURE_FLAG"); return value === "true"; }
export function platformWritesEnabled(): boolean { return process.env.LUMIN_PLATFORM_WRITES_ENABLED === "true" && process.env.AGENCY_WRITES_ENABLED === "true"; }
export function configurePlatformRepository(value: PlatformRepository | undefined): void { repository = value; }
export function getPlatformRepository(): PlatformRepository {
  if (!platformEnabled()) throw new PlatformDenied("DISABLED_BY_LUMIN_POLICY");
  if (!repository) repository = new FirestorePlatformRepository(getFirestore());
  return repository;
}
export async function resolveOperationContext(clientId: string, tool: string, provider: Provider): Promise<OperationContext> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(clientId)) throw new PlatformDenied("CLIENT_CONTEXT_REQUIRED");
  const operator = getCurrentFbUserId();
  if (!operator) throw new PlatformDenied("AUTHENTICATED_OPERATOR_REQUIRED");
  const repo = getPlatformRepository();
  const principal = await repo.resolvePrincipal(operator);
  if (!principal) throw new PlatformDenied("PLATFORM_MEMBERSHIP_REQUIRED");
  const member = await repo.get("members", principal.tenantId, operator);
  const client = await repo.get("clients", principal.tenantId, clientId);
  const tenant = await repo.get("tenants", principal.tenantId, principal.tenantId);
  if (!member || !member.roles.some(role=>["reader","writer","admin","approver","connection_admin"].includes(role)) || member.disabledAt !== null || member.tenantId !== principal.tenantId || !member.allowedClientIds.includes(clientId) || !client || client.tenantId !== principal.tenantId || client.status !== "ACTIVE" || !tenant || tenant.status !== "ACTIVE" || tenant.migrationState !== "READY") throw new PlatformDenied("CLIENT_ACCESS_REQUIRED");
  return { principal, clientId, tool, provider, requestId: randomUUID() };
}
