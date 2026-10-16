import { encryptToken, decryptToken } from "../auth/crypto.js";
import type { Connection, Credential, MetaAsset, OperationContext, OperationPlan } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { PlatformRepository } from "./repository.js";

function credentialAad(c: Pick<Credential, "id" | "tenantId" | "operatorId" | "provider" | "appId">): string { return JSON.stringify(["lumin-platform-credential", 1, c.tenantId, c.operatorId, c.provider, c.appId, c.id]); }
export function encryptCredential(identity: Omit<Credential, "payload" | "envelopeVersion">, token: string): Credential { if(!token || identity.keyVersion !== "primary" || !identity.id || !identity.tenantId || !identity.operatorId || !identity.appId) throw new PlatformDenied("CREDENTIAL_IDENTITY_REQUIRED"); return {...identity, envelopeVersion: 1, payload: encryptToken(token, credentialAad(identity))}; }
export function decryptCredential(credential: Credential): string { if(credential.envelopeVersion !== 1 || credential.keyVersion !== "primary") throw new PlatformDenied("CREDENTIAL_VERSION_UNSUPPORTED"); return decryptToken(credential.payload, credentialAad(credential)); }
export async function selectConnection(repo: PlatformRepository, ctx: OperationContext, plan: OperationPlan, assets: MetaAsset[], now = Date.now(), selectedConnectionId?: string): Promise<Connection> {
  const connections = await repo.list("connections", ctx.principal.tenantId);
  const grants = await repo.list("grants", ctx.principal.tenantId);
  const maximumAge = plan.classes.some(c => c !== "READ") ? 5 * 60_000 : 60 * 60_000;
  const eligible = connections.filter(c => c.tenantId === ctx.principal.tenantId && c.operatorId === ctx.principal.operatorId && c.provider === ctx.provider && c.revokedAt === null && (c.expiresAt === null || c.expiresAt > now) && c.verifiedAt > 0 && c.verifiedAt <= now && now - c.verifiedAt <= maximumAge && plan.tokenTypes.includes(c.tokenType) && plan.requiredScopes.every(s => c.scopes.includes(s)) && assets.every(a => a.appId === c.appId && c.assetKeys.includes(a.key) && grants.some(g => g.tenantId === c.tenantId && g.clientId === ctx.clientId && g.assetKey === a.key && g.connectionId === c.id && g.revokedAt === null && g.expiresAt > now && g.verifiedAt > 0 && g.verifiedAt <= now && now - g.verifiedAt <= maximumAge && g.capabilities.includes(plan.capability) && plan.classes.every(op => g.actions.includes(op)) && (plan.requiredTasks ?? []).every(t => g.tasks.includes(t)))));
  if(selectedConnectionId) { const selected = eligible.find(c => c.id === selectedConnectionId); if(!selected) throw new PlatformDenied("SELECTED_CONNECTION_UNAVAILABLE"); return selected; }
  eligible.sort((a,b) => a.scopes.length - b.scopes.length || a.assetKeys.length - b.assetKeys.length || a.id.localeCompare(b.id));
  if(!eligible.length) throw new PlatformDenied("PERMISSION_OR_CONNECTION_REQUIRED");
  return eligible[0];
}
