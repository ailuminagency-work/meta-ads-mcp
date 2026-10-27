import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { encryptCredential } from "../../src/platform/connections.js";
import { resolveMetaApiVersion } from "../../src/meta/api-version.js";
import { LEGACY_CORE_READ_TOOLS } from "../../src/platform/legacy-read.js";
import type { AssetGrant, Connection, MetaAsset } from "../../src/platform/models.js";
import { FB_USER_ID, META_APP_ID, OTHER_FB_USER_ID } from "./harness.js";

export interface SeededTenant {
  tenantId: string;
  operatorId: string;
  clientId: string;
  accountId: string;
  campaignId: string;
  connectionToken: string;
}

export const TENANT_A: SeededTenant = {
  tenantId: "tenant-a",
  operatorId: FB_USER_ID,
  clientId: "client-a",
  accountId: "101",
  campaignId: "201",
  connectionToken: "synthetic-narrow-credential-a",
};

export const CLIENT_B: SeededTenant = {
  tenantId: "tenant-a",
  operatorId: "800000000000099",
  clientId: "client-b",
  accountId: "202",
  campaignId: "302",
  connectionToken: "synthetic-narrow-credential-b",
};

export const TENANT_C: SeededTenant = {
  tenantId: "tenant-c",
  operatorId: OTHER_FB_USER_ID,
  clientId: "client-c",
  accountId: "303",
  campaignId: "403",
  connectionToken: "synthetic-narrow-credential-c",
};

async function seedClientAssets(repo: InMemoryPlatformRepository, spec: SeededTenant, memberOperator: string): Promise<void> {
  const now = Date.now();
  const connectionId = `connection-${spec.clientId}`;
  const credentialId = `credential-${spec.clientId}`;
  const base = {
    tenantId: spec.tenantId,
    clientId: spec.clientId,
    provider: "META_MARKETING" as const,
    appId: META_APP_ID,
    verifiedAt: now,
    revokedAt: null,
    revision: 1,
  };
  const key = (suffix: string): string => `${spec.clientId}-${suffix}`;
  const assets: MetaAsset[] = [
    { ...base, key: key("account"), id: spec.accountId, type: "AD_ACCOUNT", parents: [] },
    { ...base, key: key("campaign"), id: spec.campaignId, type: "CAMPAIGN", parents: [{ type: "AD_ACCOUNT", id: spec.accountId }] },
  ];
  await repo.put("clients", spec.tenantId, spec.clientId, {
    id: spec.clientId,
    tenantId: spec.tenantId,
    status: "ACTIVE",
    revision: 1,
    verifiedBusinessIds: [],
  });
  for (const asset of assets) {
    await repo.put("assets", spec.tenantId, asset.key, asset);
    const grant: AssetGrant = {
      id: asset.key,
      tenantId: spec.tenantId,
      clientId: spec.clientId,
      assetKey: asset.key,
      connectionId,
      capabilities: LEGACY_CORE_READ_TOOLS.map((tool) => `legacy.${tool}`),
      actions: ["READ"],
      tasks: [],
      verifiedAt: now,
      expiresAt: now + 3_600_000,
      revokedAt: null,
      revision: 1,
    };
    await repo.put("grants", spec.tenantId, grant.id, grant);
  }
  const connection: Connection = {
    id: connectionId,
    tenantId: spec.tenantId,
    operatorId: memberOperator,
    provider: "META_MARKETING",
    authStrategy: "business_login",
    credentialId,
    appId: META_APP_ID,
    tokenType: "user",
    metaAppUserId: spec.operatorId,
    scopes: ["ads_read"],
    assetKeys: assets.map((asset) => asset.key),
    expiresAt: now + 3_600_000,
    revokedAt: null,
    verifiedAt: now,
    revision: 1,
    eligibility: [
      {
        requirement: `marketing_read_access:${resolveMetaApiVersion()}`,
        verified: true,
        checkedAt: now,
        expiresAt: now + 3_600_000,
        source: "https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi",
      },
    ],
  };
  await repo.put("connections", spec.tenantId, connectionId, connection);
  await repo.put(
    "credentials",
    spec.tenantId,
    credentialId,
    encryptCredential(
      { id: credentialId, tenantId: spec.tenantId, operatorId: memberOperator, provider: "META_MARKETING", appId: META_APP_ID, keyVersion: "primary" },
      spec.connectionToken,
    ),
  );
}

/**
 * tenant-a: FB_USER_ID may use client-a only. client-b sits in the same
 * tenant with full assets and a credential but the operator is not a member of
 * it. tenant-c belongs to a different operator entirely.
 */
export async function seedStrictRepository(): Promise<InMemoryPlatformRepository> {
  const repo = new InMemoryPlatformRepository();
  await repo.put("tenants", TENANT_A.tenantId, TENANT_A.tenantId, { id: TENANT_A.tenantId, status: "ACTIVE", policyRevision: 1, registryRevision: 1, migrationState: "READY" });
  await repo.put("members", TENANT_A.tenantId, FB_USER_ID, { operatorId: FB_USER_ID, tenantId: TENANT_A.tenantId, roles: ["reader"], allowedClientIds: [TENANT_A.clientId], revision: 1, disabledAt: null });
  await repo.put("operatorIndex", "_index", FB_USER_ID, { operatorId: FB_USER_ID, tenantId: TENANT_A.tenantId });
  await seedClientAssets(repo, TENANT_A, FB_USER_ID);
  await seedClientAssets(repo, CLIENT_B, FB_USER_ID);

  await repo.put("tenants", TENANT_C.tenantId, TENANT_C.tenantId, { id: TENANT_C.tenantId, status: "ACTIVE", policyRevision: 1, registryRevision: 1, migrationState: "READY" });
  await repo.put("members", TENANT_C.tenantId, OTHER_FB_USER_ID, { operatorId: OTHER_FB_USER_ID, tenantId: TENANT_C.tenantId, roles: ["reader"], allowedClientIds: [TENANT_C.clientId], revision: 1, disabledAt: null });
  await repo.put("operatorIndex", "_index", OTHER_FB_USER_ID, { operatorId: OTHER_FB_USER_ID, tenantId: TENANT_C.tenantId });
  await seedClientAssets(repo, TENANT_C, OTHER_FB_USER_ID);
  return repo;
}
