import {setupPhoneLockKey} from "./whatsapp-setup-types.js";
import {connectionPrivacyAppUserId} from "./privacy-identity.js";
import { encryptToken, decryptToken } from "../auth/crypto.js";
import type { Connection, Credential, MetaAsset, OperationContext, OperationPlan } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { PlatformRepository } from "./repository.js";

function credentialAad(c: Pick<Credential, "id" | "tenantId" | "operatorId" | "provider" | "appId">): string { return JSON.stringify(["lumin-platform-credential", 1, c.tenantId, c.operatorId, c.provider, c.appId, c.id]); }
export function encryptCredential(identity: Omit<Credential, "payload" | "envelopeVersion">, token: string): Credential { if(!token || identity.keyVersion !== "primary" || !identity.id || !identity.tenantId || !identity.operatorId || !identity.appId) throw new PlatformDenied("CREDENTIAL_IDENTITY_REQUIRED"); return {...identity, envelopeVersion: 1, payload: encryptToken(token, credentialAad(identity))}; }
export function decryptCredential(credential: Credential): string { if(credential.envelopeVersion !== 1 || credential.keyVersion !== "primary") throw new PlatformDenied("CREDENTIAL_VERSION_UNSUPPORTED"); return decryptToken(credential.payload, credentialAad(credential)); }
export function credentialSubjectMatches(connection:Connection,assets:MetaAsset[]):boolean{
  const type=connection.tokenType==="page"?"PAGE":connection.tokenType==="threads"?"THREADS_ACCOUNT":connection.tokenType==="instagram"?"INSTAGRAM_ACCOUNT":null;
  if(!type)return true;
  const roots=assets.filter(a=>a.type===type&&a.provider===connection.provider&&a.appId===connection.appId);
  return roots.length===1&&connection.subjectId===roots[0].id;
}
/** A setup mutation quarantines every existing grant for that exact phone. */
export async function assertWhatsAppPhoneUnlocked(repo:PlatformRepository,connection:Connection,assets:MetaAsset[]):Promise<void>{
  if(connection.provider!=="META_WHATSAPP")return;
  const phones=assets.filter(a=>a.provider===connection.provider&&a.appId===connection.appId&&a.type==="WHATSAPP_PHONE");
  if(phones.length&&!repo.isWhatsAppSetupPhoneLocked)throw new PlatformDenied("WHATSAPP_SETUP_LOCK_STORAGE_REQUIRED");
  for(const phone of phones)if(await repo.isWhatsAppSetupPhoneLocked!(setupPhoneLockKey(connection.appId,phone.id)))throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");
}
export async function selectConnection(repo: PlatformRepository, ctx: OperationContext, plan: OperationPlan, assets: MetaAsset[], now = Date.now(), selectedConnectionId?: string): Promise<Connection> {
  if((plan.requiredAssetTasks??[]).some(r=>!assets.some(a=>a.type===r.asset.type&&a.id.replace(/^act_/, "")===r.asset.id.replace(/^act_/, ""))||!r.tasks.length||r.tasks.some(t=>typeof t!=="string"||!t)))throw new PlatformDenied("SCOPED_ASSET_TASK_REFERENCE_REQUIRED");
  const connections = await repo.list("connections", ctx.principal.tenantId);
  const grants = await repo.list("grants", ctx.principal.tenantId);
  const maximumAge = plan.classes.some(c => c !== "READ") ? 5 * 60_000 : 60 * 60_000;
  const locks=new Map<string,boolean>();
  for(const c of connections)if(c.tenantId===ctx.principal.tenantId&&c.operatorId===ctx.principal.operatorId&&!locks.has(c.id))locks.set(c.id,await repo.isAppUserLifecycleLocked?.(c.appId,c.operatorId,connectionPrivacyAppUserId(c))??false);
  const eligible = connections.filter(c => !locks.get(c.id) && credentialSubjectMatches(c,assets) && c.tenantId === ctx.principal.tenantId && c.operatorId === ctx.principal.operatorId && c.provider === ctx.provider && c.revokedAt === null && (c.expiresAt === null || c.expiresAt > now) && c.verifiedAt > 0 && c.verifiedAt <= now && now - c.verifiedAt <= maximumAge && plan.tokenTypes.includes(c.tokenType) && plan.requiredScopes.every(s => c.scopes.includes(s)) && assets.every(a => a.appId === c.appId && c.assetKeys.includes(a.key) && grants.some(g => g.tenantId === c.tenantId && g.clientId === ctx.clientId && g.assetKey === a.key && g.connectionId === c.id && g.revokedAt === null && g.expiresAt > now && g.verifiedAt > 0 && g.verifiedAt <= now && now - g.verifiedAt <= maximumAge && g.capabilities.includes(plan.capability) && plan.classes.every(op => g.actions.includes(op)) && [...(plan.requiredTasks ?? []),...(plan.requiredAssetTasks??[]).filter(r=>r.asset.type===a.type&&r.asset.id.replace(/^act_/, "")===a.id.replace(/^act_/, "")).flatMap(r=>r.tasks)].every(t => g.tasks.includes(t)))));
  for(let i=eligible.length-1;i>=0;i--){try{await assertWhatsAppPhoneUnlocked(repo,eligible[i],assets);}catch(error){if(!(error instanceof PlatformDenied))throw error;eligible.splice(i,1);}}
  if(selectedConnectionId) { const selected = eligible.find(c => c.id === selectedConnectionId); if(!selected) throw new PlatformDenied("SELECTED_CONNECTION_UNAVAILABLE"); return selected; }
  eligible.sort((a,b) => a.scopes.length - b.scopes.length || a.assetKeys.length - b.assetKeys.length || a.id.localeCompare(b.id));
  if(!eligible.length) throw new PlatformDenied("PERMISSION_OR_CONNECTION_REQUIRED");
  return eligible[0];
}
