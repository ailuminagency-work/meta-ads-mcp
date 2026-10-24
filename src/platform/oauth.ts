import {logOAuthFailure} from "./oauth-diagnostics.js";
import {isCrmOAuthProfile,crmOAuthRoots} from "./crm-oauth.js";
import {isSignalDatasetOAuthProfile,signalDatasetOAuthRoots} from "./dataset-oauth.js";
import {isAppPromotionOAuthProfile,appPromotionOAuthRoots} from "./app-promotion-oauth.js";
import {invoiceProfileRootRefs,invoiceRegisteredScope,INVOICE_METADATA_CAPABILITY} from './business-invoice-metadata.js';
import {MARKETING_STUDY_CAPABILITY} from "./marketing-study-contract.js";
import {studyRegisteredScope,studyProfileRootRefs} from "./marketing-study-proof.js";
import {clientBusinessBound,loadClientBusinessEvidence,clientBusinessExpected,type ClientBusinessEvidence} from "./client-business.js";
import {marketingControlOAuthProof,usesRegisteredMarketingAdProof} from "./marketing-control-oauth-proof.js";
import {productVersion} from "./product-version.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createConnectionChallenge, consumeConnectionChallenge, validateConnectionProfile, type ConnectionChallengeStore, type ConnectionProfile } from "./connection-profiles.js";
import type { AssetGrant, AssetRef, Connection, Credential, Member, MetaAsset, OperationClass, PlatformPrincipal,Client,Tenant } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { PlatformRepository } from "./repository.js";
import { encryptCredential } from "./connections.js";
import { canonicalJson } from "./policy.js";
import {encryptPageInspectionDelegation,pageInspectionDelegationMetadata,type PageInspectionDelegation} from "./page-inspection-delegation.js";
import {facebookActualScopesMatch, classifyMetaPermissionProfiles, type MetaPermissionProfile} from "./oauth-facebook.js";
import { oauthDiscoveryHandoffSchema, type OAuthAssetDiscoveryCandidate, type OAuthAssetRegistrationBridge, type OAuthDiscoveryInspection, type OAuthDiscoveryRequired, type OAuthDiscoveryTransactionStore } from "./oauth-discovery.js";

export interface TrustedOAuthProfile extends ConnectionProfile {
  appPromotionBinding?:import("./app-promotion-contract.js").AppPromotionBinding;
  crmRootIds?:{businessId?:string;accountId:string;pixelId:string};
  datasetRootIds?:{businessId:string;accountId:string};
  invoiceRootIds?:{businessId:string;accountIds:string[]};
  studyRootIds?:{businessId:string;accountId:string;campaignIds:[string,string]};
  marketingControlMode?:"TRAFFIC"|"INSTANT_FORM_LEADS";
  derivedTokenScopes?:string[];
  authorizationContext?:"DIRECT"|"BUSINESS_MANAGER";
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
/** Fixed operational inspector must match the current deployment-owned profile snapshot. */
export function createPageInspectionProfileVerifier(registry:ImmutableOAuthProfileRegistry):(record:PageInspectionDelegation)=>Promise<void> {
 if(!deploymentRegistries.has(registry))throw new PlatformDenied("IMMUTABLE_DEPLOYMENT_OAUTH_PROFILES_REQUIRED");
 return async record=>{const profile=await registry.get(record.profileId);if(!profile||profile.provider!==record.provider||profile.appId!==record.appId||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="page"||createHash("sha256").update(canonicalJson(profile)).digest("hex")!==record.profileHash||canonicalJson([...profile.scopes].sort())!==canonicalJson([...record.scopes].sort()))throw new PlatformDenied("PAGE_INSPECTION_CURRENT_PROFILE_REQUIRED");};
}
export interface InspectedOAuthToken {
  /** Provider-observed permission families. This never changes profile actions. */
  grantedPermissionProfiles?: MetaPermissionProfile[];
  metaAppUserId?:string;
  pageInspection?:{accessToken:string;appId:string;userSubjectId:string;grantedScopes:string[];expiresAt:number};
  clientBusinessId?:string;
  whatsappAssignmentEvidence?:{tenantId:string;clientId:string;appId:string;whatsappAccountId:string;messagingAccountId:string;phoneId:string;dualAccountAssignment:true;source:"META_BUSINESS_SUITE_OWNER_REVIEW";approvedBy:string;checkedAt:number;expiresAt:number};
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
  grantedPermissionProfiles:z.array(z.enum(["META_READ_ONLY","META_MANAGEMENT","META_CONTENT_AND_MESSAGING","META_BUSINESS_OPERATIONS"])).min(1).max(4).optional(),
  metaAppUserId:z.string().regex(/^\d{1,100}$/).optional(),
  pageInspection:z.object({accessToken:z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/),appId:z.string().regex(/^\d{1,100}$/),userSubjectId:z.string().regex(/^\d{1,100}$/),grantedScopes:z.array(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/)).min(1).max(100),expiresAt:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict().optional(),
  clientBusinessId:z.string().regex(/^\d{1,100}$/).optional(),
  whatsappAssignmentEvidence:z.object({tenantId:z.string().min(1),clientId:z.string().min(1),appId:z.string().regex(/^\d{1,100}$/),whatsappAccountId:z.string().regex(/^\d{1,100}$/),messagingAccountId:z.string().regex(/^\d{1,100}$/),phoneId:z.string().regex(/^\d{1,100}$/),dualAccountAssignment:z.literal(true),source:z.literal("META_BUSINESS_SUITE_OWNER_REVIEW"),approvedBy:z.string().min(1),checkedAt:z.number().int().positive(),expiresAt:z.number().int().positive()}).strict().optional(),
  accessToken: z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/),
  provider: z.enum(["META_MARKETING", "META_FACEBOOK_PAGES", "META_INSTAGRAM_FACEBOOK_LOGIN", "META_INSTAGRAM_LOGIN", "META_MESSENGER", "META_WHATSAPP", "META_THREADS", "META_BUSINESS"]),
  appId: z.string().regex(/^[0-9]{1,100}$/), subjectId: z.string().regex(/^[0-9]{1,100}$/),
  tokenType: z.enum(["user", "page", "system_user", "business_integration_system_user", "instagram", "threads"]),
  grantedScopes: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/)).min(1).max(100),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  assets: z.array(z.object({ type: z.enum(["BUSINESS", "AD_ACCOUNT", "PAGE", "INSTAGRAM_ACCOUNT", "DATASET", "PIXEL", "CATALOG", "WABA", "WHATSAPP_ACCOUNT","MESSAGING_ACCOUNT","WHATSAPP_PHONE", "THREADS_ACCOUNT", "APP","CAMPAIGN","AD_SET","CREATIVE","AD","AD_IMAGE","AD_VIDEO","LEAD_FORM","AUDIENCE"]), id: z.string().regex(/^(?:(?:act_)?[0-9]{1,100}|[a-f0-9]{32})$/), tasks: z.array(z.string().regex(/^[A-Z_]{1,100}$/)).max(100) }).strict().refine(asset => asset.type==="AD_IMAGE"?/^[a-f0-9]{32}$/.test(asset.id):/^(?:act_)?[0-9]{1,100}$/.test(asset.id)&&(asset.type === "AD_ACCOUNT" || !asset.id.startsWith("act_")))).min(1).max(98),
}).strict();
export interface VerifiedProviderAdapter {
  provider: Connection["provider"];
  verified: boolean;
  validateProfile(profile:TrustedOAuthProfile):void;
  validateEnrollmentContext?(input:{profile:TrustedOAuthProfile;principal:PlatformPrincipal;clientId:string;client:Client;businessOwnerEvidence?:ClientBusinessEvidence}):void;
  exchangeAndInspectMany?(input:{code:string;profile:TrustedOAuthProfile;appSecret:string;requestedAssets:AssetRef[];registeredAssets?:MetaAsset[];expectedOperatorId?:string}):Promise<InspectedOAuthToken[]>;
  exchangeAndInspect(input: { expectedOperatorId?:string; code: string; profile: TrustedOAuthProfile; appSecret: string; requestedAssets: AssetRef[];registeredAssets?:MetaAsset[] }): Promise<InspectedOAuthToken>;
  inspectAccessToken?(input: { accessToken: string; profile: TrustedOAuthProfile; appSecret: string; requestedAssets: AssetRef[]; registeredAssets?: MetaAsset[]; expectedOperatorId?: string }): Promise<InspectedOAuthToken>;
  discoverAssets?(input:{code:string;profile:TrustedOAuthProfile;appSecret:string}): Promise<InspectedOAuthToken>;
}
export function unverifiedOAuthAdapter(provider: Connection["provider"]): VerifiedProviderAdapter {
  return { provider, verified: false, validateProfile:()=>{throw new PlatformDenied("PRODUCT_OAUTH_ADAPTER_UNVERIFIED_HOLD");},exchangeAndInspect: async () => { throw new PlatformDenied("PRODUCT_OAUTH_ADAPTER_UNVERIFIED_HOLD"); } };
}
export interface ConnectionEnrollment {
  pageInspectionDelegation?:PageInspectionDelegation;
  principal: PlatformPrincipal;
  clientId: string;
  connection: Connection & { subjectId: string };
  credential: Credential;
  grants: AssetGrant[];
  expectedRecords: import("./repository.js").ControlCommit["expected"];
  checkedAt: number;
}
export interface PlatformOAuthDependencies {
  repository: PlatformRepository;
  challenges: ConnectionChallengeStore;
  profiles: ImmutableOAuthProfileRegistry;
  secrets: { get(reference: string): Promise<string> };
  adapters: { get(provider: Connection["provider"]): VerifiedProviderAdapter | null };
  commitVerifiedConnections?: (enrollments:ConnectionEnrollment[])=>Promise<void>;
  commitVerifiedConnection?: (enrollment: ConnectionEnrollment) => Promise<void>;
  discoveryStore?: OAuthDiscoveryTransactionStore;
  assetRegistration?: OAuthAssetRegistrationBridge;
  now?: () => number;
}

async function membership(repo: PlatformRepository, operatorId: string, clientId: string): Promise<{ principal: PlatformPrincipal; tenant: Tenant; member: Member;client:Client; businessOwnerEvidence:ClientBusinessEvidence; expected: ConnectionEnrollment["expectedRecords"] }> {
  const principal = await repo.resolvePrincipal(operatorId);
  if (!principal || principal.operatorId !== operatorId) throw new PlatformDenied("AUTHENTICATED_PLATFORM_OPERATOR_REQUIRED");
  const [tenant, member, client] = await Promise.all([repo.get("tenants", principal.tenantId, principal.tenantId), repo.get("members", principal.tenantId, operatorId), repo.get("clients", principal.tenantId, clientId)]);
  if (!tenant || tenant.id !== principal.tenantId || tenant.status !== "ACTIVE" || tenant.migrationState !== "READY" || !member || member.operatorId !== operatorId || member.tenantId !== principal.tenantId || member.disabledAt !== null || !member.allowedClientIds.includes(clientId) || !member.roles.some(role => role === "admin" || role === "connection_admin") || !client || client.id !== clientId || client.tenantId !== principal.tenantId || client.status !== "ACTIVE") throw new PlatformDenied("CLIENT_CONNECTION_ADMIN_REQUIRED");
  const businessOwnerEvidence=await loadClientBusinessEvidence(repo,client);
  return { principal, tenant, member,client,businessOwnerEvidence, expected: [{ collection: "tenants", id: tenant.id, canonical: canonicalJson(tenant) }, { collection: "members", id: member.operatorId, canonical: canonicalJson(member) }, { collection: "clients", id: client.id, canonical: canonicalJson(client) },...clientBusinessExpected(businessOwnerEvidence)] };
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
    if(profile.crmRootIds!==undefined&&!isCrmOAuthProfile(profile))throw new PlatformDenied("CRM_OAUTH_ROOTS_PROFILE_FORBIDDEN");
    if(profile.datasetRootIds!==undefined&&!isSignalDatasetOAuthProfile(profile))throw new PlatformDenied("SIGNAL_DISCOVERY_PROFILE_ROOTS_REQUIRED");
    if(profile.appPromotionBinding!==undefined&&!(profile.provider==="META_MARKETING"&&profile.tokenTypes.length===1&&profile.tokenTypes[0]==="user"&&isAppPromotionOAuthProfile(profile)))throw new PlatformDenied("APP_PROMOTION_BINDING_PROFILE_FORBIDDEN");
    if(profile.invoiceRootIds!==undefined&&!(profile.provider==='META_MARKETING'&&profile.tokenTypes.length===1&&profile.tokenTypes[0]==='user'&&profile.capabilities.includes(INVOICE_METADATA_CAPABILITY)))throw new PlatformDenied('INVOICE_ROOTS_PROFILE_FORBIDDEN');
    if(profile.studyRootIds!==undefined&&!(profile.provider==="META_MARKETING"&&profile.tokenTypes.length===1&&profile.tokenTypes[0]==="user"&&profile.capabilities.includes(MARKETING_STUDY_CAPABILITY)))throw new PlatformDenied("STUDY_ROOTS_PROFILE_FORBIDDEN");
    if(profile.marketingControlMode&&!(profile.provider==="META_MARKETING"&&profile.tokenTypes.length===1&&profile.tokenTypes[0]==="user"&&usesRegisteredMarketingAdProof(profile)))throw new PlatformDenied("MARKETING_CONTROL_PROFILE_MODE_REQUIRED");
    if(profile.authorizationContext && profile.provider!=="META_INSTAGRAM_FACEBOOK_LOGIN")throw new PlatformDenied("IG_AUTHORIZATION_CONTEXT_REQUIRED");
    if(profile.derivedTokenScopes && (profile.tokenTypes.length!==1 || profile.tokenTypes[0]!=="page" || !profile.derivedTokenScopes.length || new Set(profile.derivedTokenScopes).size!==profile.derivedTokenScopes.length || profile.derivedTokenScopes.some(scope=>!profile.scopes.includes(scope))))throw new PlatformDenied("DERIVED_PAGE_SCOPE_PROFILE_REQUIRED");
    if (profile.configurationId && !/^[0-9]{1,100}$/.test(profile.configurationId)) throw new PlatformDenied("INVALID_BUSINESS_LOGIN_CONFIGURATION");
    return structuredClone(profile);
  }
  private adapter(profile: TrustedOAuthProfile, allowDiscovery=false): VerifiedProviderAdapter {
    const adapter = this.deps.adapters.get(profile.provider);
    if (!adapter || !adapter.verified || adapter.provider !== profile.provider) throw new PlatformDenied("PRODUCT_OAUTH_ADAPTER_UNVERIFIED_HOLD");
    adapter.validateProfile(profile);
    productVersion(profile.provider);
    if (!allowDiscovery && !this.deps.commitVerifiedConnection && !this.deps.commitVerifiedConnections) throw new PlatformDenied("ATOMIC_CONNECTION_ENROLLMENT_UNAVAILABLE_HOLD");
    return adapter;
  }
  /**
   * The plain Meta marketing reader is intentionally launched with an explicit
   * scope set.  A Business Login configuration can carry unrelated write
   * permissions configured at the app level; using that configuration for a
   * read-only connection makes Meta return a scope superset that must be
   * rejected.  Root-bound and write-capable profiles continue to use their
   * reviewed configuration IDs.
   */
  private static usesDirectReadOnlyScopes(profile: TrustedOAuthProfile): boolean {
    return profile.provider === "META_MARKETING" &&
      profile.strategy === "facebook_business" &&
      profile.tokenTypes.length === 1 && profile.tokenTypes[0] === "user" &&
      profile.actions.length === 1 && profile.actions[0] === "READ" &&
      profile.requiredTasks.length === 0 &&
      profile.derivedTokenScopes === undefined &&
      profile.crmRootIds === undefined && profile.datasetRootIds === undefined &&
      profile.appPromotionBinding === undefined && profile.studyRootIds === undefined &&
      profile.invoiceRootIds === undefined && profile.marketingControlMode === undefined;
  }
  async start(operatorId: string, clientId: string, profileId: string): Promise<{ state: string; browserNonce: string; authorizeUrl: string }> {
    const profile = await this.profile(profileId);
    const adapter=this.adapter(profile,Boolean(this.deps.discoveryStore&&this.deps.assetRegistration));
    const { principal,client,businessOwnerEvidence } = await membership(this.deps.repository, operatorId, clientId);
    adapter.validateEnrollmentContext?.({profile,principal,clientId,client,businessOwnerEvidence});
    const challenge = await createConnectionChallenge(this.deps.challenges, profile, principal, clientId, this.now());
    const authorize = new URL(profile.authorizeUrl);
    authorize.searchParams.set("client_id", profile.appId);
    authorize.searchParams.set("redirect_uri", profile.redirectUri);
    authorize.searchParams.set("state", challenge.state);
    authorize.searchParams.set("response_type", "code");
    if (profile.strategy === "facebook_business" && profile.configurationId && !PlatformOAuthService.usesDirectReadOnlyScopes(profile)) authorize.searchParams.set("config_id", profile.configurationId);
    else authorize.searchParams.set("scope", profile.scopes.join(","));
    return { ...challenge, authorizeUrl: authorize.toString() };
  }
  /** Exchange and inspect a first-time agency credential, then stop before enrollment. */
  async shouldUseFirstTimeDiscovery(operatorId:string,clientId:string,profileId:string):Promise<boolean> {
    if(!this.deps.discoveryStore||!this.deps.assetRegistration)return false;
    const profile=await this.profile(profileId),initial=await membership(this.deps.repository,operatorId,clientId);
    return !(await this.deps.repository.list("assets",initial.principal.tenantId)).some(a=>a.tenantId===initial.principal.tenantId&&a.clientId===clientId&&a.provider===profile.provider&&a.appId===profile.appId&&a.revokedAt===null);
  }
  async discoverFirstTime(input: { operatorId:string; clientId:string; profileId:string; state:string; browserNonce:string; code:string }):Promise<OAuthDiscoveryRequired> {
    const store=this.deps.discoveryStore, registration=this.deps.assetRegistration;
    if(!store||!registration)throw new PlatformDenied("OAUTH_FIRST_TIME_DISCOVERY_UNAVAILABLE");
    if(!input.code||input.code.length>4096)throw new PlatformDenied("INVALID_OAUTH_CALLBACK");
    const profile=await this.profile(input.profileId),adapter=this.adapter(profile,true);
    if(!adapter.discoverAssets)throw new PlatformDenied("OAUTH_PROVIDER_DISCOVERY_UNAVAILABLE");
    const initial=await membership(this.deps.repository,input.operatorId,input.clientId);
    adapter.validateEnrollmentContext?.({profile,principal:initial.principal,clientId:input.clientId,client:initial.client,businessOwnerEvidence:initial.businessOwnerEvidence});
    const existing=(await this.deps.repository.list("assets",initial.principal.tenantId)).some(a=>a.tenantId===initial.principal.tenantId&&a.clientId===input.clientId&&a.provider===profile.provider&&a.appId===profile.appId&&a.revokedAt===null);
    if(existing)throw new PlatformDenied("OAUTH_REGISTERED_ASSET_PATH_REQUIRED");
    await consumeConnectionChallenge(this.deps.challenges,profile,initial.principal,input.clientId,input.state,input.browserNonce,this.now());
    const appSecret=await this.deps.secrets.get(profile.secretReference);if(!appSecret)throw new PlatformDenied("OAUTH_APP_SECRET_REQUIRED");
    let inspected:InspectedOAuthToken;
    try{inspected=inspectedTokenSchema.parse(await adapter.discoverAssets({code:input.code,profile,appSecret}));}catch{throw new PlatformDenied("OAUTH_PROVIDER_DISCOVERY_FAILED");}
    const now=this.now();
    if(inspected.provider!==profile.provider||inspected.appId!==profile.appId||inspected.tokenType!=="user"||inspected.subjectId!==input.operatorId||inspected.expiresAt<=now||!facebookActualScopesMatch(profile.derivedTokenScopes??profile.scopes,inspected.grantedScopes))throw new PlatformDenied("OAUTH_DISCOVERY_TOKEN_BINDING_REQUIRED");
    const observed=classifyMetaPermissionProfiles(profile.derivedTokenScopes??profile.scopes,inspected.grantedScopes);
    if(profile.provider!=="META_MARKETING"||!observed)throw new PlatformDenied("OAUTH_DISCOVERY_PROFILE_REQUIRED");
    const candidates:OAuthAssetDiscoveryCandidate[]=inspected.assets.filter(a=>a.type==="AD_ACCOUNT").map(a=>({type:a.type,id:a.id,providerAssetId:a.id,evidence:{source:"META_ME_ADACCOUNTS",checkedAt:now,expiresAt:Math.min(inspected.expiresAt,now+300000)}}));
    if(!candidates.length||candidates.length>98)throw new PlatformDenied("OAUTH_DISCOVERY_NO_ELIGIBLE_ASSETS");
    const fresh=await membership(this.deps.repository,input.operatorId,input.clientId);
    adapter.validateEnrollmentContext?.({profile,principal:fresh.principal,clientId:input.clientId,client:fresh.client,businessOwnerEvidence:fresh.businessOwnerEvidence});
    if(canonicalJson(initial.expected)!==canonicalJson(fresh.expected))throw new PlatformDenied("OAUTH_MEMBERSHIP_CHANGED");
    const registeredDuringDiscovery=(await this.deps.repository.list("assets",fresh.principal.tenantId)).some(a=>a.tenantId===fresh.principal.tenantId&&a.clientId===input.clientId&&a.provider===profile.provider&&a.appId===profile.appId&&a.revokedAt===null);
    if(registeredDuringDiscovery)throw new PlatformDenied("OAUTH_REGISTERED_ASSET_PATH_REQUIRED");
    const transactionId=randomUUID(),expiresAt=Math.min(inspected.expiresAt,now+300000),inspection:OAuthDiscoveryInspection={provider:inspected.provider,appId:inspected.appId,subjectId:inspected.subjectId,tokenType:inspected.tokenType,grantedScopes:[...inspected.grantedScopes],...(observed?{grantedPermissionProfiles:observed}:{}),expiresAt:inspected.expiresAt};
    const expectedCandidates=structuredClone(candidates), expectedInspection=structuredClone(inspection);
    await store.create({transactionId,tenantId:initial.principal.tenantId,clientId:input.clientId,operatorId:input.operatorId,profileId:profile.id,appId:profile.appId,token:inspected.accessToken,inspection:structuredClone(expectedInspection),candidates:structuredClone(expectedCandidates),expiresAt});
    let started;
    try { started=oauthDiscoveryHandoffSchema.parse(await registration.begin({transactionId,tenantId:fresh.principal.tenantId,clientId:input.clientId,operatorId:input.operatorId,profileId:profile.id,appId:profile.appId,inspection:structuredClone(expectedInspection),candidates:structuredClone(expectedCandidates),expiresAt,expectedRevisions:{tenant:fresh.tenant.registryRevision,member:fresh.member.revision,client:fresh.client.revision}})); }
    catch { throw new PlatformDenied("OAUTH_DISCOVERY_HANDOFF_INVALID"); }
    if(started.transactionId!==transactionId||started.expiresAt<=this.now()||started.expiresAt>expiresAt||canonicalJson(started.candidates)!==canonicalJson(expectedCandidates))throw new PlatformDenied("OAUTH_DISCOVERY_HANDOFF_INVALID");
    return {status:"DISCOVERY_REQUIRED",transactionId,expiresAt:started.expiresAt,candidates:structuredClone(expectedCandidates),registrationId:started.registrationId,revision:started.revision};
  }
  /** Complete a first-time discovery only after the registry has committed the selected root. */
  async completeFirstTime(input:{operatorId:string;clientId:string;profileId:string;transactionId:string;registrationId:string;expectedRevision:number;selectedAssets:AssetRef[]}):Promise<{connectionId:string;connectionIds:string[];connectionCount:number;provider:Connection["provider"];assetCount:number}> {
    const store=this.deps.discoveryStore, registration=this.deps.assetRegistration;
    if(!store||!registration)throw new PlatformDenied("OAUTH_FIRST_TIME_DISCOVERY_UNAVAILABLE");
    const profile=await this.profile(input.profileId), adapter=this.adapter(profile);
    if(profile.provider!=="META_MARKETING"||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="user"||profile.actions.length!==1||profile.actions[0]!=="READ"||profile.requiredTasks.length)throw new PlatformDenied("OAUTH_DISCOVERY_READ_ONLY_PROFILE_REQUIRED");
    const initial=await membership(this.deps.repository,input.operatorId,input.clientId), pending=await store.read({transactionId:input.transactionId,tenantId:initial.principal.tenantId,clientId:input.clientId,operatorId:input.operatorId,now:this.now()});
    if(!pending||pending.profileId!==profile.id||pending.appId!==profile.appId||pending.expiresAt<=this.now()||!input.selectedAssets.length||input.selectedAssets.length>98)throw new PlatformDenied("OAUTH_DISCOVERY_TRANSACTION_UNAVAILABLE");
    const candidateSet=new Set(pending.candidates.map(c=>`${c.type}:${c.id}`));
    if(input.selectedAssets.some(a=>a.type!=="AD_ACCOUNT"||!candidateSet.has(`${a.type}:${a.id}`)))throw new PlatformDenied("OAUTH_DISCOVERY_ASSET_SELECTION_INVALID");
    const current=await membership(this.deps.repository,input.operatorId,input.clientId);
    if(canonicalJson(initial.expected)!==canonicalJson(current.expected))throw new PlatformDenied("OAUTH_MEMBERSHIP_CHANGED");
    const registered=(await this.deps.repository.list("assets",current.principal.tenantId)).filter(a=>a.tenantId===current.principal.tenantId&&a.clientId===input.clientId&&a.provider===profile.provider&&a.appId===profile.appId&&a.revokedAt===null);
    const selected=registered.filter(a=>input.selectedAssets.some(r=>r.type===a.type&&r.id.replace(/^act_/,'')===a.id.replace(/^act_/,'')&&a.verifiedAt<=this.now()));
    if(selected.length!==input.selectedAssets.length||selected.some(a=>a.verifiedAt<=0||this.now()-a.verifiedAt>3600000))throw new PlatformDenied("OAUTH_DISCOVERY_REGISTERED_ASSET_REQUIRED");
    const appSecret=await this.deps.secrets.get(profile.secretReference);if(!appSecret||!adapter.inspectAccessToken)throw new PlatformDenied("OAUTH_DISCOVERY_INSPECTION_UNAVAILABLE");
    const secret=await store.readSecret({transactionId:input.transactionId,tenantId:current.principal.tenantId,clientId:input.clientId,operatorId:input.operatorId,now:this.now()});
    if(!secret)throw new PlatformDenied("OAUTH_DISCOVERY_TRANSACTION_UNAVAILABLE");
    let inspected:InspectedOAuthToken;
    try { inspected=inspectedTokenSchema.parse(await adapter.inspectAccessToken({accessToken:secret.token,profile,appSecret,requestedAssets:input.selectedAssets,registeredAssets:selected,expectedOperatorId:input.operatorId})); }
    catch { throw new PlatformDenied("OAUTH_PROVIDER_REINSPECTION_FAILED"); }
    if(inspected.provider!==profile.provider||inspected.appId!==profile.appId||inspected.subjectId!==input.operatorId||inspected.tokenType!=="user"||!facebookActualScopesMatch(profile.scopes,inspected.grantedScopes)||!inspected.assets.length||inspected.assets.some(a=>!input.selectedAssets.some(r=>r.type===a.type&&r.id.replace(/^act_/,'')===a.id.replace(/^act_/,'')||false)))throw new PlatformDenied("OAUTH_DISCOVERY_TOKEN_BINDING_REQUIRED");
    const observed=classifyMetaPermissionProfiles(profile.scopes,inspected.grantedScopes);if(!observed)throw new PlatformDenied("ACTUAL_PROVIDER_PERMISSION_CLASSIFICATION_REQUIRED");
    const consumed=await store.consume({transactionId:input.transactionId,tenantId:current.principal.tenantId,clientId:input.clientId,operatorId:input.operatorId,now:this.now()});
    if(!consumed||consumed.token!==secret.token)throw new PlatformDenied("OAUTH_DISCOVERY_TRANSACTION_CONSUMED");
    const now=this.now(),connectionId=randomUUID(),credentialId=randomUUID(),connection:Connection & {subjectId:string}={id:connectionId,metaAppUserId:inspected.subjectId,tenantId:current.principal.tenantId,operatorId:input.operatorId,provider:profile.provider,authStrategy:profile.strategy,credentialId,appId:profile.appId,tokenType:"user",subjectId:inspected.subjectId,scopes:[...inspected.grantedScopes],assetKeys:selected.map(a=>a.key),expiresAt:inspected.expiresAt,revokedAt:null,verifiedAt:now,revision:1,grantedPermissionProfiles:[...observed]};
    const credential=encryptCredential({id:credentialId,tenantId:current.principal.tenantId,operatorId:input.operatorId,provider:profile.provider,appId:profile.appId,keyVersion:"primary"},inspected.accessToken);
    const grants=selected.map(asset=>({id:randomUUID(),tenantId:current.principal.tenantId,clientId:input.clientId,assetKey:asset.key,connectionId,capabilities:[...profile.capabilities],actions:[...profile.actions],tasks:[],verifiedAt:now,expiresAt:inspected.expiresAt,revokedAt:null,revision:1}));
    const enrollment:ConnectionEnrollment={principal:current.principal,clientId:input.clientId,connection,credential,grants,expectedRecords:[...current.expected,...selected.map(asset=>({collection:"assets" as const,id:asset.key,canonical:canonicalJson(asset)}))],checkedAt:now};
    if(this.deps.commitVerifiedConnection)await this.deps.commitVerifiedConnection(enrollment);else if(this.deps.commitVerifiedConnections)await this.deps.commitVerifiedConnections([enrollment]);else throw new PlatformDenied("ATOMIC_CONNECTION_ENROLLMENT_UNAVAILABLE_HOLD");
    return {connectionId,connectionIds:[connectionId],connectionCount:1,provider:profile.provider,assetCount:selected.length};
  }
  async associateFirstTime(input:{operatorId:string;clientId:string;profileId:string;transactionId:string;registrationId:string;expectedRevision:number;selectedAssets:AssetRef[]}):Promise<{connectionId:string;connectionIds:string[];connectionCount:number;provider:Connection["provider"];assetCount:number}> {
    const store=this.deps.discoveryStore, registration=this.deps.assetRegistration;if(!store||!registration)throw new PlatformDenied("OAUTH_FIRST_TIME_DISCOVERY_UNAVAILABLE");
    const profile=await this.profile(input.profileId),initial=await membership(this.deps.repository,input.operatorId,input.clientId),pending=await store.read({transactionId:input.transactionId,tenantId:initial.principal.tenantId,clientId:input.clientId,operatorId:input.operatorId,now:this.now()});
    if(!pending||pending.profileId!==profile.id||pending.appId!==profile.appId)throw new PlatformDenied("OAUTH_DISCOVERY_TRANSACTION_UNAVAILABLE");
    const allowed=new Set(pending.candidates.map(c=>`${c.type}:${c.id}`));if(!input.selectedAssets.length||input.selectedAssets.some(a=>!allowed.has(`${a.type}:${a.id}`)))throw new PlatformDenied("OAUTH_DISCOVERY_ASSET_SELECTION_INVALID");
    const committed=await registration.commit({transactionId:input.transactionId,tenantId:initial.principal.tenantId,clientId:input.clientId,operatorId:input.operatorId,provider:profile.provider,appId:profile.appId,selectedAssets:structuredClone(input.selectedAssets),registrationId:input.registrationId,expectedRevision:input.expectedRevision});
    if(committed.registrationId!==input.registrationId||committed.revision!==input.expectedRevision||canonicalJson(committed.assets)!==canonicalJson(input.selectedAssets))throw new PlatformDenied("OAUTH_DISCOVERY_REGISTRATION_ACK_INVALID");
    return this.completeFirstTime(input);
  }
  async callback(input: { operatorId: string; clientId: string; profileId: string; state: string; browserNonce: string; code: string }): Promise<{ connectionId: string; connectionIds:string[];connectionCount:number;provider: Connection["provider"]; assetCount: number }> {
    if (!input.code || input.code.length > 4096) throw new PlatformDenied("INVALID_OAUTH_CALLBACK");
    const profile = await this.profile(input.profileId), adapter = this.adapter(profile);
    const initial = await membership(this.deps.repository, input.operatorId, input.clientId);
    adapter.validateEnrollmentContext?.({profile,principal:initial.principal,clientId:input.clientId,client:initial.client,businessOwnerEvidence:initial.businessOwnerEvidence});
    await consumeConnectionChallenge(this.deps.challenges, profile, initial.principal, input.clientId, input.state, input.browserNonce, this.now());
    const marketingPage=profile.provider==="META_MARKETING"&&profile.tokenTypes.length===1&&profile.tokenTypes[0]==="page";
    const whatsappBisu=profile.provider==="META_WHATSAPP"&&profile.tokenTypes.length===1&&profile.tokenTypes[0]==="business_integration_system_user";
    const marketingUser=profile.provider==="META_MARKETING"&&profile.tokenTypes.length===1&&profile.tokenTypes[0]==="user",businessUser=profile.provider==="META_BUSINESS";
    const registeredAssets=(await this.deps.repository.list("assets", initial.principal.tenantId)).filter(a=>a.tenantId===initial.principal.tenantId&&a.clientId===input.clientId&&a.provider===profile.provider&&a.appId===profile.appId&&a.revokedAt===null),marketingControlUser=marketingUser&&usesRegisteredMarketingAdProof(profile),controlProof=marketingControlUser?marketingControlOAuthProof(registeredAssets,this.now()):undefined;
    const studyRefs=marketingUser&&profile.capabilities.includes(MARKETING_STUDY_CAPABILITY)?studyProfileRootRefs(profile.studyRootIds):undefined,studyCandidates=studyRefs?registeredAssets.filter(a=>studyRefs.some(ref=>ref.type===a.type&&ref.id===a.id.replace(/^act_/,""))):undefined,studyProof=studyCandidates?studyRegisteredScope(studyCandidates,studyRefs!,this.now()):undefined;
    const invoiceRefs=marketingUser&&profile.capabilities.includes(INVOICE_METADATA_CAPABILITY)?invoiceProfileRootRefs(profile.invoiceRootIds):undefined,invoiceCandidates=invoiceRefs?registeredAssets.filter(a=>invoiceRefs.some(ref=>ref.type===a.type&&ref.id===a.id.replace(/^act_/,''))):undefined,invoiceProof=invoiceCandidates?invoiceRegisteredScope(invoiceCandidates,invoiceRefs!,this.now()):undefined;
    const crmRoots=isCrmOAuthProfile(profile)?crmOAuthRoots(profile,registeredAssets,this.now()):undefined;
    const signalDatasetRoots=isSignalDatasetOAuthProfile(profile)?signalDatasetOAuthRoots(profile,registeredAssets,this.now()):undefined;
    const appPromotionRoots=isAppPromotionOAuthProfile(profile)?appPromotionOAuthRoots(profile,registeredAssets,this.now()):undefined;
    const requestedAssets = crmRoots?crmRoots.map(a=>({type:a.type,id:a.id})):signalDatasetRoots?signalDatasetRoots.map(a=>({type:a.type,id:a.id})):appPromotionRoots?appPromotionRoots.map(a=>({type:a.type,id:a.id})):invoiceProof?[invoiceProof.business,...invoiceProof.accounts].map(a=>({type:a.type,id:a.id})):studyProof?[studyProof.business,studyProof.account,...studyProof.campaigns].map(a=>({type:a.type,id:a.id})):controlProof?controlProof.assets.map(a=>({type:a.type,id:a.id})):registeredAssets.filter(asset => asset.tenantId === initial.principal.tenantId && asset.clientId === input.clientId && asset.provider === profile.provider && asset.appId === profile.appId && asset.revokedAt === null && (!marketingUser||(marketingControlUser?["AD_ACCOUNT","PAGE"].includes(asset.type):asset.type==="AD_ACCOUNT")) && (!businessUser||asset.type==="BUSINESS") && (!marketingPage||["PAGE","AD_ACCOUNT"].includes(asset.type)) && (profile.provider!=="META_INSTAGRAM_FACEBOOK_LOGIN"||["PAGE","INSTAGRAM_ACCOUNT"].includes(asset.type)) && (!whatsappBisu||["WHATSAPP_ACCOUNT","MESSAGING_ACCOUNT","WHATSAPP_PHONE"].includes(asset.type)) && (!asset.parents.length || (profile.provider==="META_INSTAGRAM_FACEBOOK_LOGIN" && asset.type==="INSTAGRAM_ACCOUNT" && asset.parents.length===1 && asset.parents[0].type==="PAGE") || (whatsappBisu&&asset.type==="MESSAGING_ACCOUNT"&&asset.parents.length===1&&asset.parents[0].type==="WHATSAPP_ACCOUNT") || (whatsappBisu&&asset.type==="WHATSAPP_PHONE"&&asset.parents.length===2&&asset.parents.some(p=>p.type==="WHATSAPP_ACCOUNT")&&asset.parents.some(p=>p.type==="MESSAGING_ACCOUNT")))).map(asset => ({ type: asset.type, id: asset.id }));
    if (!requestedAssets.length || requestedAssets.length > 98) throw new PlatformDenied("REGISTERED_CLIENT_ROOTS_REQUIRED");
    let inspectedTokens:InspectedOAuthToken[];
    try {
      const appSecret=await this.deps.secrets.get(profile.secretReference);if(!appSecret)throw new Error();
      const exchange={code:input.code,profile,appSecret,requestedAssets,...(crmRoots?{registeredAssets:structuredClone(crmRoots)}:signalDatasetRoots?{registeredAssets:structuredClone(signalDatasetRoots)}:appPromotionRoots?{registeredAssets:structuredClone(appPromotionRoots)}:invoiceProof?{registeredAssets:structuredClone([invoiceProof.business,...invoiceProof.accounts])}:studyProof?{registeredAssets:structuredClone([studyProof.business,studyProof.account,...studyProof.campaigns])}:controlProof?{registeredAssets:structuredClone(controlProof.assets)}:{}),expectedOperatorId:input.operatorId};
      const raw=adapter.exchangeAndInspectMany?await adapter.exchangeAndInspectMany(exchange):[await adapter.exchangeAndInspect(exchange)];
      inspectedTokens=z.array(inspectedTokenSchema).min(1).max(32).parse(raw);
    }catch(error){logOAuthFailure("provider_exchange",error);throw new PlatformDenied("OAUTH_PROVIDER_EXCHANGE_OR_INSPECTION_FAILED");}
    const enrollments:ConnectionEnrollment[]=[];
    for(const inspected of inspectedTokens){
    const now = this.now();
    const observedPermissionProfiles=profile.provider === "META_MARKETING" && profile.tokenTypes.length === 1 && profile.tokenTypes[0] === "user" ? classifyMetaPermissionProfiles(profile.derivedTokenScopes??profile.scopes, inspected.grantedScopes) : null;
    if(profile.provider === "META_MARKETING" && profile.tokenTypes.length === 1 && profile.tokenTypes[0] === "user" && (observedPermissionProfiles===null || (canonicalJson([...inspected.grantedScopes].sort())!==canonicalJson([...(profile.derivedTokenScopes??profile.scopes)].sort()) && !inspected.grantedPermissionProfiles) || inspected.grantedPermissionProfiles && canonicalJson([...inspected.grantedPermissionProfiles].sort())!==canonicalJson([...(observedPermissionProfiles??[])].sort()))) throw new PlatformDenied("ACTUAL_PROVIDER_PERMISSION_CLASSIFICATION_REQUIRED");
    if(profile.provider !== "META_MARKETING" && inspected.grantedPermissionProfiles!==undefined) throw new PlatformDenied("ACTUAL_PROVIDER_PERMISSION_CLASSIFICATION_FORBIDDEN");
    if (inspected.provider !== profile.provider || inspected.appId !== profile.appId || !profile.tokenTypes.includes(inspected.tokenType) || !/^[0-9]{1,100}$/.test(inspected.subjectId) || !inspected.accessToken || inspected.accessToken.length > 16384 || !Number.isSafeInteger(inspected.expiresAt) || inspected.expiresAt <= now || inspected.grantedScopes.length !== new Set(inspected.grantedScopes).size || (profile.provider === "META_MARKETING" && profile.tokenTypes.length === 1 && profile.tokenTypes[0] === "user" ? !facebookActualScopesMatch(profile.derivedTokenScopes??profile.scopes, inspected.grantedScopes) : canonicalJson([...inspected.grantedScopes].sort()) !== canonicalJson([...(profile.derivedTokenScopes??profile.scopes)].sort())) || !inspected.assets.length || inspected.assets.length > 98) throw new PlatformDenied("ACTUAL_PROVIDER_TOKEN_BINDING_REQUIRED");
    if (inspected.tokenType === "user" && inspected.subjectId !== input.operatorId) throw new PlatformDenied("ACTUAL_OPERATOR_SUBJECT_REQUIRED");
    if (canonicalJson(await this.profile(input.profileId)) !== canonicalJson(profile)) throw new PlatformDenied("OAUTH_PROFILE_CHANGED");
    const fresh = await membership(this.deps.repository, input.operatorId, input.clientId);
    adapter.validateEnrollmentContext?.({profile,principal:fresh.principal,clientId:input.clientId,client:fresh.client,businessOwnerEvidence:fresh.businessOwnerEvidence});
    if(whatsappBisu){const evidence=inspected.whatsappAssignmentEvidence;
      if(inspected.tokenType!=="business_integration_system_user"||!inspected.clientBusinessId||!clientBusinessBound(fresh.client,inspected.clientBusinessId,now,fresh.businessOwnerEvidence,profile.appId)||!evidence||evidence.tenantId!==fresh.principal.tenantId||evidence.clientId!==input.clientId||evidence.appId!==profile.appId||evidence.checkedAt>now||now-evidence.checkedAt>300000||evidence.expiresAt<=now||evidence.expiresAt>evidence.checkedAt+3600000||inspected.expiresAt>evidence.expiresAt||inspected.assets.length!==3||!inspected.assets.some(a=>a.type==="WHATSAPP_ACCOUNT"&&a.id===evidence.whatsappAccountId)||!inspected.assets.some(a=>a.type==="MESSAGING_ACCOUNT"&&a.id===evidence.messagingAccountId)||!inspected.assets.some(a=>a.type==="WHATSAPP_PHONE"&&a.id===evidence.phoneId))throw new PlatformDenied("WHATSAPP_ACTUAL_BUSINESS_ASSIGNMENT_REQUIRED");
    }else if(inspected.clientBusinessId!==undefined||inspected.whatsappAssignmentEvidence!==undefined||inspected.tokenType==="business_integration_system_user")throw new PlatformDenied("WHATSAPP_BISU_PROFILE_REQUIRED");
    if (canonicalJson(initial.expected) !== canonicalJson(fresh.expected)) throw new PlatformDenied("OAUTH_MEMBERSHIP_CHANGED");
    const registry = await this.deps.repository.list("assets", fresh.principal.tenantId), assets: MetaAsset[] = [];
    for (const discovered of inspected.assets) {
      if (!requestedAssets.some(a=>a.type===discovered.type && a.id.replace(/^act_/, "")===discovered.id.replace(/^act_/, ""))) throw new PlatformDenied("UNREQUESTED_OAUTH_ASSET");
      const matches = registry.filter(asset => asset.id.replace(/^act_/, "") === discovered.id.replace(/^act_/, "") && asset.type === discovered.type && asset.provider === profile.provider && asset.appId === profile.appId);
      if (matches.length !== 1 || matches[0].tenantId !== fresh.principal.tenantId || matches[0].clientId !== input.clientId || matches[0].revokedAt !== null || matches[0].verifiedAt <= 0 || matches[0].verifiedAt > now || now - matches[0].verifiedAt > 3600000 || (!((marketingPage&&discovered.type==="AD_ACCOUNT"||(marketingControlUser||!!appPromotionRoots)&&discovered.type!=="PAGE")||(profile.provider==="META_INSTAGRAM_FACEBOOK_LOGIN"&&discovered.type==="INSTAGRAM_ACCOUNT"))&&!profile.requiredTasks.every(task => discovered.tasks.includes(task))) || assets.some(asset => asset.key === matches[0].key)) throw new PlatformDenied("REGISTERED_CLIENT_ASSET_AND_TASKS_REQUIRED");
      const linkedCrm=!!crmRoots&&crmRoots.some(a=>a.key===matches[0].key&&canonicalJson(a)===canonicalJson(matches[0]));if(crmRoots&&!linkedCrm)throw new PlatformDenied("CRM_OAUTH_ROOT_CHANGED");
      if(signalDatasetRoots&&!signalDatasetRoots.some(a=>a.key===matches[0].key&&canonicalJson(a)===canonicalJson(matches[0])))throw new PlatformDenied("SIGNAL_DISCOVERY_OAUTH_ROOT_CHANGED");
      if(appPromotionRoots&&!appPromotionRoots.some(a=>a.key===matches[0].key&&canonicalJson(a)===canonicalJson(matches[0])))throw new PlatformDenied("APP_PROMOTION_OAUTH_ROOT_CHANGED");
      const linkedControl=marketingControlUser&&!!controlProof?.assets.some(a=>a.key===matches[0].key&&canonicalJson(a)===canonicalJson(matches[0]));if(marketingControlUser&&!linkedControl)throw new PlatformDenied("MARKETING_CONTROL_OAUTH_ASSET_SNAPSHOT_CHANGED");
      const linkedInvoice=!!invoiceProof&&[invoiceProof.business,...invoiceProof.accounts].some(a=>a.key===matches[0].key&&canonicalJson(a)===canonicalJson(matches[0]));if(invoiceProof&&!linkedInvoice)throw new PlatformDenied('INVOICE_OAUTH_ASSET_SNAPSHOT_CHANGED');
      const linkedStudy=!!studyProof&&[studyProof.business,studyProof.account,...studyProof.campaigns].some(a=>a.key===matches[0].key&&canonicalJson(a)===canonicalJson(matches[0]));if(studyProof&&!linkedStudy)throw new PlatformDenied("CLASSIC_STUDY_OAUTH_ASSET_SNAPSHOT_CHANGED");
      const linkedInstagram=profile.provider==="META_INSTAGRAM_FACEBOOK_LOGIN" && ["page","user"].includes(inspected.tokenType) && matches[0].type==="INSTAGRAM_ACCOUNT" && matches[0].parents.length===1 && matches[0].parents[0].type==="PAGE" && inspected.assets.some(a=>a.type==="PAGE" && a.id===matches[0].parents[0].id && (inspected.tokenType==="page"?a.id===inspected.subjectId:profile.tokenTypes.length===1&&profile.tokenTypes[0]==="user"));
      const linkedPhone=whatsappBisu&&matches[0].type==="WHATSAPP_PHONE"&&matches[0].parents.length===2&&matches[0].parents.some(p=>p.type==="WHATSAPP_ACCOUNT"&&p.id===inspected.whatsappAssignmentEvidence!.whatsappAccountId)&&matches[0].parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===inspected.whatsappAssignmentEvidence!.messagingAccountId);
      const linkedMessaging=whatsappBisu&&matches[0].type==="MESSAGING_ACCOUNT"&&matches[0].parents.length===1&&matches[0].parents[0].type==="WHATSAPP_ACCOUNT"&&matches[0].parents[0].id===inspected.whatsappAssignmentEvidence!.whatsappAccountId;
      if ((!linkedCrm&&!linkedStudy&&!linkedControl&&!linkedInstagram&&!linkedPhone&&!linkedMessaging && matches[0].parents.length) || !linkedStudy&&!linkedControl&&!["BUSINESS", "AD_ACCOUNT", "PAGE", "INSTAGRAM_ACCOUNT", "DATASET", "PIXEL", "CATALOG", "WABA", "WHATSAPP_ACCOUNT","MESSAGING_ACCOUNT","WHATSAPP_PHONE", "THREADS_ACCOUNT", "APP"].includes(matches[0].type)) throw new PlatformDenied("OAUTH_ENROLLMENT_REQUIRES_REGISTERED_ROOTS");
      if(enrollments.some(e=>e.connection.assetKeys.includes(matches[0].key)))throw new PlatformDenied("DUPLICATE_OAUTH_ASSET_TOKEN");
      assets.push(matches[0]);
    }
    if (inspected.tokenType === "page" && ((marketingPage?assets.length!==2||assets.filter(a=>a.type==="AD_ACCOUNT").length!==1:profile.provider==="META_INSTAGRAM_FACEBOOK_LOGIN" ? assets.length!==2 || assets.filter(a=>a.type==="INSTAGRAM_ACCOUNT").length!==1 : assets.length!==1) || assets.filter(a=>a.type==="PAGE").length!==1 || !assets.some(asset => asset.type === "PAGE" && asset.id === inspected.subjectId))) throw new PlatformDenied("ACTUAL_PAGE_SUBJECT_REQUIRED");
    if(profile.provider==="META_INSTAGRAM_FACEBOOK_LOGIN"&&inspected.tokenType==="user"&&(assets.length!==2||assets.filter(a=>a.type==="PAGE").length!==1||assets.filter(a=>a.type==="INSTAGRAM_ACCOUNT").length!==1))throw new PlatformDenied("IG_USER_EXACT_PAGE_ACCOUNT_PAIR_REQUIRED");
    if ((inspected.tokenType === "instagram" || inspected.tokenType === "threads") && !assets.some(asset => asset.id === inspected.subjectId && asset.type === (inspected.tokenType === "threads" ? "THREADS_ACCOUNT" : "INSTAGRAM_ACCOUNT"))) throw new PlatformDenied("ACTUAL_PRODUCT_SUBJECT_REQUIRED");
    const connectionId = randomUUID(), credentialId = randomUUID();
    const inspectionPage=inspected.tokenType==="page"&&["META_MARKETING","META_FACEBOOK_PAGES","META_MESSENGER","META_INSTAGRAM_FACEBOOK_LOGIN"].includes(profile.provider);
    const secondary=inspected.pageInspection;
    if(profile.provider==="META_INSTAGRAM_LOGIN"&&!inspected.metaAppUserId)throw new PlatformDenied("INSTAGRAM_ACTUAL_APP_USER_REQUIRED");
    if(inspected.metaAppUserId&&profile.provider!=="META_INSTAGRAM_LOGIN"&&inspected.metaAppUserId!==(inspected.tokenType==="page"?secondary?.userSubjectId:inspected.subjectId))throw new PlatformDenied("ACTUAL_APP_USER_BINDING_INVALID");
    if(inspectionPage&&!secondary)throw new PlatformDenied("PAGE_INSPECTION_DELEGATION_REQUIRED");
    if(secondary&&(!inspectionPage||inspected.tokenType!=="page"||secondary.appId!==profile.appId||secondary.userSubjectId!==input.operatorId||secondary.expiresAt<=now||secondary.expiresAt<inspected.expiresAt||new Set(secondary.grantedScopes).size!==secondary.grantedScopes.length||canonicalJson([...secondary.grantedScopes].sort())!==canonicalJson([...profile.scopes].sort())||secondary.accessToken===inspected.accessToken))throw new PlatformDenied("PAGE_INSPECTION_OAUTH_BINDING_INVALID");
    const pageInspectionDelegation=secondary?encryptPageInspectionDelegation({id:randomUUID(),purpose:"PAGE_TASK_INSPECTION",tenantId:fresh.principal.tenantId,clientId:input.clientId,operatorId:input.operatorId,appId:profile.appId,provider:profile.provider as PageInspectionDelegation["provider"],profileId:profile.id,profileHash:createHash("sha256").update(canonicalJson(profile)).digest("hex"),connectionId,pageIds:[inspected.subjectId],userSubjectId:secondary.userSubjectId,scopes:[...secondary.grantedScopes],checkedAt:now,expiresAt:Math.min(secondary.expiresAt,inspected.expiresAt),revokedAt:null,envelopeVersion:1,keyVersion:"primary"},secondary.accessToken,now):undefined;
    const credential = encryptCredential({ id: credentialId, tenantId: fresh.principal.tenantId, operatorId: input.operatorId, provider: profile.provider, appId: profile.appId, keyVersion: "primary" }, inspected.accessToken);
    const connection: ConnectionEnrollment["connection"] = { ...(profile.provider==="META_INSTAGRAM_LOGIN"?{tokenIssuedAt:now}:{}), ...(inspected.grantedPermissionProfiles?{grantedPermissionProfiles:[...inspected.grantedPermissionProfiles]}:{}), ...(whatsappBisu?{clientBusinessId:inspected.clientBusinessId!,whatsappAssignmentEvidence:structuredClone(inspected.whatsappAssignmentEvidence!)}:{}),id: connectionId, metaAppUserId:inspected.tokenType==="page"?secondary!.userSubjectId:inspected.metaAppUserId??inspected.subjectId, tenantId: fresh.principal.tenantId, operatorId: input.operatorId, provider: profile.provider, authStrategy: profile.strategy, credentialId, appId: profile.appId, tokenType: inspected.tokenType, subjectId: inspected.subjectId, scopes: [...inspected.grantedScopes], assetKeys: assets.map(asset => asset.key), expiresAt: inspected.expiresAt, revokedAt: null, verifiedAt: now, revision: 1 };
    const grants = assets.map(asset => ({ id: randomUUID(), tenantId: connection.tenantId, clientId: input.clientId, assetKey: asset.key, connectionId, capabilities: [...profile.capabilities], actions: [...profile.actions], tasks: (marketingPage&&asset.type==="AD_ACCOUNT"||(marketingControlUser||!!appPromotionRoots)&&asset.type!=="PAGE"||profile.provider==="META_INSTAGRAM_FACEBOOK_LOGIN"&&asset.type==="INSTAGRAM_ACCOUNT")?[]:[...profile.requiredTasks], verifiedAt: now, expiresAt: inspected.expiresAt, revokedAt: null, revision: 1 }));

      if(pageInspectionDelegation)connection.pageInspectionDelegationId=pageInspectionDelegation.id;
      enrollments.push({principal:fresh.principal,clientId:input.clientId,connection,credential,grants,...(pageInspectionDelegation?{pageInspectionDelegation}:{}),expectedRecords:[...fresh.expected,...[...new Map([...assets,...(controlProof?.assets??[])].map(asset=>[asset.key,asset])).values()].map(asset=>({collection:"assets" as const,id:asset.key,canonical:canonicalJson(asset)}))],checkedAt:now});
    }
    const covered=enrollments.flatMap(e=>e.connection.assetKeys);
    if(covered.length!==requestedAssets.length||requestedAssets.some(ref=>!registeredAssets.some(a=>a.type===ref.type&&a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,"")&&covered.includes(a.key))))throw new PlatformDenied("OAUTH_REQUESTED_ROOT_COVERAGE_REQUIRED");
    if(this.deps.commitVerifiedConnections)await this.deps.commitVerifiedConnections(enrollments);
    else if(enrollments.length===1)await this.deps.commitVerifiedConnection!(enrollments[0]);
    else throw new PlatformDenied("ATOMIC_MULTI_CONNECTION_ENROLLMENT_REQUIRED");
    return {connectionId:enrollments[0].connection.id,connectionIds:enrollments.map(e=>e.connection.id),connectionCount:enrollments.length,provider:profile.provider,assetCount:covered.length};
  }

}
export function atomicConnectionEnrollment(repository: PlatformRepository): (enrollment: ConnectionEnrollment) => Promise<void> {
  return async enrollment => {
    const { connection, credential, grants } = enrollment;
    const metadataHash = createHash("sha256").update(canonicalJson({ connectionId: connection.id, provider: connection.provider, appId: connection.appId, subjectId: connection.subjectId, metaAppUserId:connection.metaAppUserId??null, grantedPermissionProfiles:connection.grantedPermissionProfiles??null, inspection:enrollment.pageInspectionDelegation?pageInspectionDelegationMetadata(enrollment.pageInspectionDelegation):null,clientBusinessId:connection.clientBusinessId??null,whatsappAssignmentEvidence:connection.whatsappAssignmentEvidence??null,scopes: connection.scopes, assets: connection.assetKeys })).digest("hex");
    await repository.commitControlPlane({ tenantId: enrollment.principal.tenantId, expected: enrollment.expectedRecords, writes: [...(enrollment.pageInspectionDelegation?[{collection:"pageInspectionDelegations" as const,id:enrollment.pageInspectionDelegation.id,value:enrollment.pageInspectionDelegation,createOnly:true}]:[]),{ collection: "credentials", id: credential.id, value: credential, createOnly: true }, { collection: "connections", id: connection.id, value: connection, createOnly: true }, ...grants.map(grant => ({ collection: "grants" as const, id: grant.id, value: grant, createOnly: true }))], audit: { id: randomUUID(), tenantId: enrollment.principal.tenantId, clientId: enrollment.clientId, actorId: enrollment.principal.operatorId, event: "CONNECTION_ENROLLED", timestamp: enrollment.checkedAt, subjectId: connection.id, planHash: metadataHash } });
  };
}
export function atomicConnectionEnrollments(repository:PlatformRepository):(enrollments:ConnectionEnrollment[])=>Promise<void>{
  return async enrollments=>{
    if(enrollments.length<1||enrollments.length>32)throw new PlatformDenied("MULTI_CONNECTION_COUNT_INVALID");
    const first=enrollments[0],expected=new Map<string,ConnectionEnrollment["expectedRecords"][number]>(),writes:Parameters<PlatformRepository["commitControlPlane"]>[0]["writes"]=[],ids=new Set<string>();
    for(const e of enrollments){
      if(e.principal.tenantId!==first.principal.tenantId||e.principal.operatorId!==first.principal.operatorId||e.clientId!==first.clientId||e.connection.tenantId!==e.principal.tenantId||e.connection.operatorId!==e.principal.operatorId||e.credential.id!==e.connection.credentialId||e.credential.tenantId!==e.connection.tenantId||e.credential.operatorId!==e.connection.operatorId||e.credential.appId!==e.connection.appId||e.credential.provider!==e.connection.provider||ids.has(e.connection.id)||e.grants.some(g=>g.tenantId!==e.connection.tenantId||g.clientId!==e.clientId||g.connectionId!==e.connection.id||!e.connection.assetKeys.includes(g.assetKey)))throw new PlatformDenied("MULTI_CONNECTION_BINDING_INVALID");
      if(Boolean(e.pageInspectionDelegation)!==Boolean(e.connection.pageInspectionDelegationId)||e.pageInspectionDelegation&&e.pageInspectionDelegation.id!==e.connection.pageInspectionDelegationId)throw new PlatformDenied("PAGE_INSPECTION_ATOMIC_ENROLLMENT_REQUIRED");
      ids.add(e.connection.id);
      for(const record of e.expectedRecords){const key=record.collection+":"+record.id,existing=expected.get(key);if(existing&&existing.canonical!==record.canonical)throw new PlatformDenied("MULTI_CONNECTION_SNAPSHOT_CHANGED");expected.set(key,record);}
      if(e.pageInspectionDelegation)writes.push({collection:"pageInspectionDelegations",id:e.pageInspectionDelegation.id,value:e.pageInspectionDelegation,createOnly:true});
      writes.push({collection:"credentials",id:e.credential.id,value:e.credential,createOnly:true},{collection:"connections",id:e.connection.id,value:e.connection,createOnly:true},...e.grants.map(g=>({collection:"grants" as const,id:g.id,value:g,createOnly:true})));
    }
    if(writes.length>100)throw new PlatformDenied("MULTI_CONNECTION_TRANSACTION_LIMIT");
    const planHash=createHash("sha256").update(canonicalJson(enrollments.map(e=>({connectionId:e.connection.id,provider:e.connection.provider,appId:e.connection.appId,subjectId:e.connection.subjectId,metaAppUserId:e.connection.metaAppUserId??null,grantedPermissionProfiles:e.connection.grantedPermissionProfiles??null,inspection:e.pageInspectionDelegation?pageInspectionDelegationMetadata(e.pageInspectionDelegation):null,clientBusinessId:e.connection.clientBusinessId??null,whatsappAssignmentEvidence:e.connection.whatsappAssignmentEvidence??null,scopes:e.connection.scopes,assets:e.connection.assetKeys})))).digest("hex");
    await repository.commitControlPlane({tenantId:first.principal.tenantId,expected:[...expected.values()],writes,audit:{id:randomUUID(),tenantId:first.principal.tenantId,clientId:first.clientId,actorId:first.principal.operatorId,event:"CONNECTION_ENROLLED",timestamp:Date.now(),subjectId:first.connection.id,planHash}});
  };
}


