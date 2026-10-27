import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assetKey } from "../../src/platform/assets.js";
import { FirestoreConnectionChallengeStore } from "../../src/platform/connection-challenge-store.js";
import { decryptCredential } from "../../src/platform/connections.js";
import { ImmutableOAuthProfileRegistry as HeadRegistry, PlatformOAuthService as HeadService, atomicConnectionEnrollment as headEnrollment, type TrustedOAuthProfile } from "../../src/platform/oauth.js";
import { FirestorePlatformRepository as HeadRepo } from "../../src/platform/repository.js";
import { ImmutableOAuthProfileRegistry as StagingRegistry, PlatformOAuthService as StagingService, atomicConnectionEnrollment as stagingEnrollment } from "../fixtures/crypto/staging-1f08563/platform/oauth.js";
import { FirestorePlatformRepository as StagingRepo } from "../fixtures/crypto/staging-1f08563/platform/repository.js";
import { ENVS, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const operator = "1006", tenant = "tenant-oauth-compat", firstClient = "client-first", secondClient = "client-second";
const account = "101008", business = "114286761376026", TOKEN = "synthetic-oauth-compat-token";

const profile: TrustedOAuthProfile = {
  id: "meta-compat", provider: "META_MARKETING", appId: "3006", strategy: "facebook_business", scopes: ["public_profile", "ads_read"], tokenTypes: ["user"],
  redirectUri: "https://fixture.invalid/platform/oauth/meta-compat/callback", authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth", verified: true,
  secretReference: "fixture-secret-reference",
  capabilities: ["legacy.ads_get_ad_accounts", "legacy.ads_get_account_info", "legacy.ads_get_campaigns", "legacy.ads_get_ad_sets", "legacy.ads_get_ads", "legacy.ads_get_insights"],
  actions: ["READ"], requiredTasks: [],
};

let db: FakeFirestore;
let headRepo: HeadRepo;
let stagingRepo: StagingRepo;
let challenges: FirestoreConnectionChallengeStore;

const adapter = {
  provider: "META_MARKETING" as const,
  verified: true,
  validateProfile: () => {},
  exchangeAndInspect: async () => ({
    accessToken: TOKEN, provider: "META_MARKETING" as const, appId: profile.appId, subjectId: operator, tokenType: "user" as const, grantedScopes: profile.scopes,
    expiresAt: Date.now() + 3_600_000, assets: [{ type: "AD_ACCOUNT" as const, id: account, tasks: [], businessId: business }],
  }),
};

function headService(): HeadService {
  return new HeadService({ repository: headRepo, challenges, profiles: new HeadRegistry([profile]), secrets: { get: async () => "synthetic-private-app-secret" }, adapters: { get: () => adapter }, commitVerifiedConnection: headEnrollment(headRepo) } as never);
}

function stagingService(): InstanceType<typeof StagingService> {
  return new StagingService({ repository: stagingRepo, challenges, profiles: new StagingRegistry([profile]), secrets: { get: async () => "synthetic-private-app-secret" }, adapters: { get: () => adapter }, commitVerifiedConnection: stagingEnrollment(stagingRepo) } as never);
}

async function seed(): Promise<void> {
  await headRepo.put("operatorIndex", "_index", operator, { operatorId: operator, tenantId: tenant });
  await headRepo.put("tenants", tenant, tenant, { id: tenant, status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
  await headRepo.put("members", tenant, operator, { operatorId: operator, tenantId: tenant, roles: ["connection_admin"], allowedClientIds: [firstClient, secondClient], revision: 1, disabledAt: null });
  await headRepo.put("clients", tenant, firstClient, { id: firstClient, tenantId: tenant, status: "ACTIVE", revision: 1, verifiedBusinessIds: [business] });
  await headRepo.put("clients", tenant, secondClient, { id: secondClient, tenantId: tenant, status: "ACTIVE", revision: 1, verifiedBusinessIds: [business] });
}

const key = () => assetKey("META_MARKETING", profile.appId, { type: "AD_ACCOUNT", id: account });

beforeEach(async () => {
  useKeyEnv(ENVS.k1Only);
  db = new FakeFirestore();
  headRepo = new HeadRepo(db as never);
  stagingRepo = new StagingRepo(db as never);
  challenges = new FirestoreConnectionChallengeStore(db as never);
  await seed();
});
afterEach(() => restoreKeyEnv());

async function readEnrollment(repo: HeadRepo | StagingRepo) {
  const [connection] = await repo.list("connections", tenant);
  const [grant] = await repo.list("grants", tenant);
  const asset = await repo.get("assets", tenant, key());
  const credential = await repo.get("credentials", tenant, connection.credentialId);
  return { connection, grant, asset, credential };
}

describe("OAuth challenge and connection documents across the staging@1f08563 / release-line boundary", () => {
  it("a challenge started by staging is consumed by the release line, and the enrolled records decrypt and read back identically", async () => {
    const started = await stagingService().start(operator, firstClient, profile.id);
    const challengePaths = [...db.docs.keys()].filter((path) => path.startsWith("platform_connection_challenges/"));
    expect(challengePaths).toHaveLength(1);
    expect(db.read(challengePaths[0])).toHaveProperty("expireTime");

    const result = await headService().callback({ operatorId: operator, clientId: firstClient, profileId: profile.id, ...started, code: "synthetic-code" });
    expect(result).toMatchObject({ assetCount: 1, provider: "META_MARKETING" });

    const viaHead = await readEnrollment(headRepo);
    expect(viaHead.asset).toMatchObject({ clientId: firstClient, id: account });
    expect(viaHead.grant).toMatchObject({ clientId: firstClient, actions: ["READ"] });
    expect(decryptCredential(viaHead.credential!)).toBe(TOKEN);
    expect(await readEnrollment(stagingRepo)).toEqual(viaHead);
    expect(db.read(challengePaths[0])!.consumedAt).toBeTruthy();
    await expect(headService().callback({ operatorId: operator, clientId: firstClient, profileId: profile.id, ...started, code: "synthetic-code" })).rejects.toBeTruthy();
  });

  it("a challenge started by the release line is consumed by staging (rollback with a login in flight)", async () => {
    const started = await headService().start(operator, firstClient, profile.id);
    const result = await stagingService().callback({ operatorId: operator, clientId: firstClient, profileId: profile.id, ...started, code: "synthetic-code" });
    expect(result).toMatchObject({ assetCount: 1 });
    const viaStaging = await readEnrollment(stagingRepo);
    expect(decryptCredential(viaStaging.credential!)).toBe(TOKEN);
    expect(await readEnrollment(headRepo)).toEqual(viaStaging);
  });

  it("the release line reassociates an account that staging enrolled, keeping the staging connection and credential", async () => {
    const first = await stagingService().start(operator, firstClient, profile.id);
    await stagingService().callback({ operatorId: operator, clientId: firstClient, profileId: profile.id, ...first, code: "synthetic-code-1" });
    const enrolled = await readEnrollment(stagingRepo);

    const second = await headService().start(operator, secondClient, profile.id);
    const result = await headService().callback({ operatorId: operator, clientId: secondClient, profileId: profile.id, ...second, code: "synthetic-code-2" });
    expect(result).toMatchObject({ assetCount: 1, connectionId: enrolled.connection.id });

    const moved = await readEnrollment(headRepo);
    expect(moved.asset).toMatchObject({ clientId: secondClient, revision: enrolled.asset!.revision + 1 });
    expect(moved.grant).toMatchObject({ clientId: secondClient, revision: enrolled.grant.revision + 1 });
    expect(moved.connection.credentialId).toBe(enrolled.connection.credentialId);
    expect(moved.credential).toEqual(enrolled.credential);
    expect(decryptCredential(moved.credential!)).toBe(TOKEN);
  });

  it("staging itself refuses the same move (masked as a provider failure), so a rollback cannot half-apply a reassociation", async () => {
    const first = await headService().start(operator, firstClient, profile.id);
    await headService().callback({ operatorId: operator, clientId: firstClient, profileId: profile.id, ...first, code: "synthetic-code-1" });
    const before = await readEnrollment(headRepo);
    const second = await stagingService().start(operator, secondClient, profile.id);
    await expect(stagingService().callback({ operatorId: operator, clientId: secondClient, profileId: profile.id, ...second, code: "synthetic-code-2" })).rejects.toThrow("OAUTH_PROVIDER_EXCHANGE_OR_INSPECTION_FAILED");
    expect(await readEnrollment(headRepo)).toEqual(before);
  });
});
