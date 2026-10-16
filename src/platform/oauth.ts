import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createConnectionChallenge, consumeConnectionChallenge, validateConnectionProfile, type ConnectionChallengeStore, type ConnectionProfile } from "./connection-profiles.js";
import type { AssetGrant, AssetRef, Connection, Credential, Member, MetaAsset, OperationClass, PlatformPrincipal } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { PlatformRepository } from "./repository.js";
import { encryptCredential } from "./connections.js";
import { canonicalJson } from "./policy.js";

export interface TrustedOAuthProfile extends ConnectionProfile {
  secretReference: string;
  capabilities: string[];
  actions: OperationClass[];
  requiredTasks: string[];
}
const deploymentRegistries = new WeakSet<ImmutableOAuthProfileRegistry>();
/** Profiles are deployment-owned snapshots. Dynamic profile administration needs
 * a future transactional revision CAS and is deliberately unsupported here. */
export class ImmutableOAuthProfileRegistry {
  readonly #profiles: Map<string,TrustedOAuthProfile>;
  readonly get: (id:string)=>Promise<TrustedOAuthProfile|null>;
  constructor(profiles:readonly TrustedOAuthProfile[]) {
    this.#profiles=new Map();
    for(const input of profiles){
      const profile=structuredClone(input);validateConnectionProfile(profile);
      if(this.#profiles.has(profile.id))throw new PlatformDenied("DUPLICATE_DEPLOYMENT_OAUTH_PROFILE");
      this.#profiles.set(profile.id,profile);
    }
    this.get=async id=>{const profile=this.#profiles.get(id);return profile?structuredClone(profile):null;};
    deploymentRegistries.add(this);Object.freeze(this);
  }
}
export interface InspectedOAuthToken {
  accessToken: string;
  provider: Connection["provider"];
  appId: string;
  subjectId: string;
  tokenType: Connection["tokenType"];
  grantedScopes: string[];
  expiresAt: number;
  assets: Array<AssetRef & { tasks: string[] }>;
}
const inspectedTokenSchema = z.object({
  accessToken: z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/),
  provider: z.enum(["META_MARKETING", "META_FACEBOOK_PAGES", "META_INSTAGRAM_FACEBOOK_LOGIN", "META_INSTAGRAM_LOGIN", "META_MESSENGER", "META_WHATSAPP", "META_THREADS", "META_BUSINESS"]),
  appId: z.string().regex(/^[0-9]{1,100}$/), subjectId: z.string().regex(/^[0-9]{1,100}$/),
  tokenType: z.enum(["user", "page", "system_user", "instagram", "threads"]),
  grantedScopes: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/)).min(1).max(100),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  assets: z.array(z.object({ type: z.enum(["BUSINESS", "AD_ACCOUNT", "PAGE", "INSTAGRAM_ACCOUNT", "DATASET", "PIXEL", "CATALOG", "WABA", "THREADS_ACCOUNT", "APP"]), id: z.string().regex(/^(act_)?[0-9]{1,100}$/), tasks: z.array(z.string().regex(/^[A-Z_]{1,100}$/)).max(100) }).strict().refine(asset => asset.type === "AD_ACCOUNT" || !asset.id.startsWith("act_"))).min(1).max(98),
}).strict();
export interface VerifiedProviderAdapter {
  provider: Connection["provider"];
  verified: boolean;
  validateProfile(profile:TrustedOAuthProfile):void;
  exchangeAndInspect(input: { code: string; profile: TrustedOAuthProfile; appSecret: string; requestedAssets: AssetRef[] }): Promise<InspectedOAuthToken>;
}
export function unverifiedOAuthAdapter(provider: Connection["provider"]): VerifiedProviderAdapter {
  return { provider, verified: false, validateProfile:()=>{throw new PlatformDenied("PRODUCT_OAUTH_ADAPTER_UNVERIFIED_HOLD");},exchangeAndInspect: async () => { throw new PlatformDenied("PRODUCT_OAUTH_ADAPTER_UNVERIFIED_HOLD"); } };
}
export interface ConnectionEnrollment {
  principal: PlatformPrincipal;
  clientId: string;
  connection: Connection & { subjectId: string };
  credential: Credential;
  grants: AssetGrant[];
  expectedRecords: Array<{ collection: "tenants" | "members" | "clients" | "assets"; id: string; canonical: string }>;
  checkedAt: number;
}
export interface PlatformOAuthDependencies {
  repository: PlatformRepository;
  challenges: ConnectionChallengeStore;
  profiles: ImmutableOAuthProfileRegistry;
  secrets: { get(reference: string): Promise<string> };
  adapters: { get(provider: Connection["provider"]): VerifiedProviderAdapter | null };
  commitVerifiedConnection?: (enrollment: ConnectionEnrollment) => Promise<void>;
  now?: () => number;
}

async function membership(repo: PlatformRepository, operatorId: string, clientId: string): Promise<{ principal: PlatformPrincipal; member: Member; expected: ConnectionEnrollment["expectedRecords"] }> {
  const principal = await repo.resolvePrincipal(operatorId);
  if (!principal || principal.operatorId !== operatorId) throw new PlatformDenied("AUTHENTICATED_PLATFORM_OPERATOR_REQUIRED");
  const [tenant, member, client] = await Promise.all([repo.get("tenants", principal.tenantId, principal.tenantId), repo.get("members", principal.tenantId, operatorId), repo.get("clients", principal.tenantId, clientId)]);
  if (!tenant || tenant.id !== principal.tenantId || tenant.status !== "ACTIVE" || tenant.migrationState !== "READY" || !member || member.operatorId !== operatorId || member.tenantId !== principal.tenantId || member.disabledAt !== null || !member.allowedClientIds.includes(clientId) || !member.roles.some(role => role === "admin" || role === "connection_admin") || !client || client.id !== clientId || client.tenantId !== principal.tenantId || client.status !== "ACTIVE") throw new PlatformDenied("CLIENT_CONNECTION_ADMIN_REQUIRED");
  return { principal, member, expected: [{ collection: "tenants", id: tenant.id, canonical: canonicalJson(tenant) }, { collection: "members", id: member.operatorId, canonical: canonicalJson(member) }, { collection: "clients", id: client.id, canonical: canonicalJson(client) }] };
}

export class PlatformOAuthService {
  constructor(private readonly deps: PlatformOAuthDependencies) {
    if(!deploymentRegistries.has(deps.profiles))throw new PlatformDenied("IMMUTABLE_DEPLOYMENT_OAUTH_PROFILES_REQUIRED");
    // Capture the immutable profile registry so changing the caller's dependency
    // object cannot replace the trusted deployment snapshot after construction.
    this.deps={...deps,profiles:deps.profiles};
  }
  private now(): number { const now = (this.deps.now ?? Date.now)(); if (!Number.isSafeInteger(now) || now <= 0) throw new PlatformDenied("INVALID_OAUTH_CLOCK"); return now; }
  private async profile(id: string): Promise<TrustedOAuthProfile> {
    const profile = await this.deps.profiles.get(id);
    if (!profile || profile.id !== id) throw new PlatformDenied("TRUSTED_CONNECTION_PROFILE_REQUIRED");
    validateConnectionProfile(profile);
    if (!profile.secretReference || !profile.capabilities.length || !profile.actions.length) throw new PlatformDenied("TRUSTED_CONNECTION_PROFILE_REQUIRED");
    if (profile.configurationId && !/^[0-9]{1,100}$/.test(profile.configurationId)) throw new PlatformDenied("INVALID_BUSINESS_LOGIN_CONFIGURATION");
    return structuredClone(profile);
  }
  private adapter(profile: TrustedOAuthProfile): VerifiedProviderAdapter {
    const adapter = this.deps.adapters.get(profile.provider);
    if (!adapter || !adapter.verified || adapter.provider !== profile.provider) throw new PlatformDenied("PRODUCT_OAUTH_ADAPTER_UNVERIFIED_HOLD");
    adapter.validateProfile(profile);
    if (!this.deps.commitVerifiedConnection) throw new PlatformDenied("ATOMIC_CONNECTION_ENROLLMENT_UNAVAILABLE_HOLD");
    return adapter;
  }
  async start(operatorId: string, clientId: string, profileId: string): Promise<{ state: string; browserNonce: string; authorizeUrl: string }> {
    const profile = await this.profile(profileId);
    this.adapter(profile);
    const { principal } = await membership(this.deps.repository, operatorId, clientId);
    const challenge = await createConnectionChallenge(this.deps.challenges, profile, principal, clientId, this.now());
    const authorize = new URL(profile.authorizeUrl);
    authorize.searchParams.set("client_id", profile.appId);
    authorize.searchParams.set("redirect_uri", profile.redirectUri);
    authorize.searchParams.set("state", challenge.state);
    authorize.searchParams.set("response_type", "code");
    if (profile.strategy === "facebook_business" && profile.configurationId) authorize.searchParams.set("config_id", profile.configurationId);
    else authorize.searchParams.set("scope", profile.scopes.join(","));
    return { ...challenge, authorizeUrl: authorize.toString() };
  }
  async callback(input: { operatorId: string; clientId: string; profileId: string; state: string; browserNonce: string; code: string }): Promise<{ connectionId: string; provider: Connection["provider"]; assetCount: number }> {
    if (!input.code || input.code.length > 4096) throw new PlatformDenied("INVALID_OAUTH_CALLBACK");
    const profile = await this.profile(input.profileId), adapter = this.adapter(profile);
    const initial = await membership(this.deps.repository, input.operatorId, input.clientId);
    await consumeConnectionChallenge(this.deps.challenges, profile, initial.principal, input.clientId, input.state, input.browserNonce, this.now());
    const requestedAssets = (await this.deps.repository.list("assets", initial.principal.tenantId)).filter(asset => asset.tenantId === initial.principal.tenantId && asset.clientId === input.clientId && asset.provider === profile.provider && asset.appId === profile.appId && asset.revokedAt === null && !asset.parents.length).map(asset => ({ type: asset.type, id: asset.id }));
    if (!requestedAssets.length || requestedAssets.length > 98) throw new PlatformDenied("REGISTERED_CLIENT_ROOTS_REQUIRED");
    let inspected: InspectedOAuthToken;
    try {
      const appSecret = await this.deps.secrets.get(profile.secretReference);
      if (!appSecret) throw new Error("missing secret");
      const parsed = inspectedTokenSchema.safeParse(await adapter.exchangeAndInspect({ code: input.code, profile, appSecret, requestedAssets }));
      if (!parsed.success) throw new Error("invalid provider inspection");
      inspected = parsed.data;
    } catch { throw new PlatformDenied("OAUTH_PROVIDER_EXCHANGE_OR_INSPECTION_FAILED"); }
    const now = this.now();
    if (inspected.provider !== profile.provider || inspected.appId !== profile.appId || !profile.tokenTypes.includes(inspected.tokenType) || !/^[0-9]{1,100}$/.test(inspected.subjectId) || !inspected.accessToken || inspected.accessToken.length > 16384 || !Number.isSafeInteger(inspected.expiresAt) || inspected.expiresAt <= now || inspected.grantedScopes.length !== new Set(inspected.grantedScopes).size || canonicalJson([...inspected.grantedScopes].sort()) !== canonicalJson([...profile.scopes].sort()) || !inspected.assets.length || inspected.assets.length > 98) throw new PlatformDenied("ACTUAL_PROVIDER_TOKEN_BINDING_REQUIRED");
    if (inspected.tokenType === "user" && inspected.subjectId !== input.operatorId) throw new PlatformDenied("ACTUAL_OPERATOR_SUBJECT_REQUIRED");
    if (canonicalJson(await this.profile(input.profileId)) !== canonicalJson(profile)) throw new PlatformDenied("OAUTH_PROFILE_CHANGED");
    const fresh = await membership(this.deps.repository, input.operatorId, input.clientId);
    if (canonicalJson(initial.expected) !== canonicalJson(fresh.expected)) throw new PlatformDenied("OAUTH_MEMBERSHIP_CHANGED");
    const registry = await this.deps.repository.list("assets", fresh.principal.tenantId), assets: MetaAsset[] = [];
    for (const discovered of inspected.assets) {
      if (!requestedAssets.some(a=>a.type===discovered.type && a.id.replace(/^act_/, "")===discovered.id.replace(/^act_/, ""))) throw new PlatformDenied("UNREQUESTED_OAUTH_ASSET");
      const matches = registry.filter(asset => asset.id.replace(/^act_/, "") === discovered.id.replace(/^act_/, "") && asset.type === discovered.type && asset.provider === profile.provider && asset.appId === profile.appId);
      if (matches.length !== 1 || matches[0].tenantId !== fresh.principal.tenantId || matches[0].clientId !== input.clientId || matches[0].revokedAt !== null || matches[0].verifiedAt <= 0 || matches[0].verifiedAt > now || now - matches[0].verifiedAt > 3600000 || !profile.requiredTasks.every(task => discovered.tasks.includes(task)) || assets.some(asset => asset.key === matches[0].key)) throw new PlatformDenied("REGISTERED_CLIENT_ASSET_AND_TASKS_REQUIRED");
      if (matches[0].parents.length || !["BUSINESS", "AD_ACCOUNT", "PAGE", "INSTAGRAM_ACCOUNT", "DATASET", "PIXEL", "CATALOG", "WABA", "THREADS_ACCOUNT", "APP"].includes(matches[0].type)) throw new PlatformDenied("OAUTH_ENROLLMENT_REQUIRES_REGISTERED_ROOTS");
      assets.push(matches[0]);
    }
    if (inspected.tokenType === "page" && !assets.some(asset => asset.type === "PAGE" && asset.id === inspected.subjectId)) throw new PlatformDenied("ACTUAL_PAGE_SUBJECT_REQUIRED");
    if ((inspected.tokenType === "instagram" || inspected.tokenType === "threads") && !assets.some(asset => asset.id === inspected.subjectId && asset.type === (inspected.tokenType === "threads" ? "THREADS_ACCOUNT" : "INSTAGRAM_ACCOUNT"))) throw new PlatformDenied("ACTUAL_PRODUCT_SUBJECT_REQUIRED");
    const connectionId = randomUUID(), credentialId = randomUUID();
    const credential = encryptCredential({ id: credentialId, tenantId: fresh.principal.tenantId, operatorId: input.operatorId, provider: profile.provider, appId: profile.appId, keyVersion: "primary" }, inspected.accessToken);
    const connection: ConnectionEnrollment["connection"] = { id: connectionId, tenantId: fresh.principal.tenantId, operatorId: input.operatorId, provider: profile.provider, authStrategy: profile.strategy, credentialId, appId: profile.appId, tokenType: inspected.tokenType, subjectId: inspected.subjectId, scopes: [...inspected.grantedScopes], assetKeys: assets.map(asset => asset.key), expiresAt: inspected.expiresAt, revokedAt: null, verifiedAt: now, revision: 1 };
    const grants = assets.map(asset => ({ id: randomUUID(), tenantId: connection.tenantId, clientId: input.clientId, assetKey: asset.key, connectionId, capabilities: [...profile.capabilities], actions: [...profile.actions], tasks: [...profile.requiredTasks], verifiedAt: now, expiresAt: inspected.expiresAt, revokedAt: null, revision: 1 }));
    await this.deps.commitVerifiedConnection!({ principal: fresh.principal, clientId: input.clientId, connection, credential, grants, expectedRecords: [...fresh.expected, ...assets.map(asset => ({ collection: "assets" as const, id: asset.key, canonical: canonicalJson(asset) }))], checkedAt: now });
    return { connectionId, provider: profile.provider, assetCount: assets.length };
  }
}

export function atomicConnectionEnrollment(repository: PlatformRepository): (enrollment: ConnectionEnrollment) => Promise<void> {
  return async enrollment => {
    const { connection, credential, grants } = enrollment;
    const metadataHash = createHash("sha256").update(canonicalJson({ connectionId: connection.id, provider: connection.provider, appId: connection.appId, subjectId: connection.subjectId, scopes: connection.scopes, assets: connection.assetKeys })).digest("hex");
    await repository.commitControlPlane({ tenantId: enrollment.principal.tenantId, expected: enrollment.expectedRecords, writes: [{ collection: "credentials", id: credential.id, value: credential, createOnly: true }, { collection: "connections", id: connection.id, value: connection, createOnly: true }, ...grants.map(grant => ({ collection: "grants" as const, id: grant.id, value: grant, createOnly: true }))], audit: { id: randomUUID(), tenantId: enrollment.principal.tenantId, clientId: enrollment.clientId, actorId: enrollment.principal.operatorId, event: "CONNECTION_ENROLLED", timestamp: enrollment.checkedAt, subjectId: connection.id, planHash: metadataHash } });
  };
}
