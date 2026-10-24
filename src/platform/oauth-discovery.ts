import type { AssetRef } from "./models.js";
import type { InspectedOAuthToken } from "./oauth.js";
import type { MetaPermissionProfile } from "./oauth-facebook.js";
import { z } from "zod";

/** A provider candidate is deliberately smaller than Meta's response. */
export interface OAuthAssetDiscoveryCandidate extends AssetRef {
  providerAssetId: string;
  evidence: {
    source: "META_ME_ADACCOUNTS";
    checkedAt: number;
    expiresAt: number;
  };
}

export interface OAuthDiscoveryInspection {
  provider: InspectedOAuthToken["provider"];
  appId: string;
  subjectId: string;
  tokenType: InspectedOAuthToken["tokenType"];
  grantedScopes: string[];
  grantedPermissionProfiles?: MetaPermissionProfile[];
  expiresAt: number;
}

/** The registry team receives evidence and an opaque transaction, never a token. */
export interface OAuthAssetRegistrationBridge {
  begin(input: {
    transactionId: string;
    tenantId: string;
    clientId: string;
    operatorId: string;
    profileId: string;
    appId: string;
    inspection: OAuthDiscoveryInspection;
    candidates: OAuthAssetDiscoveryCandidate[];
    expiresAt: number;
    expectedRevisions: { tenant: number; member: number; client: number };
  }): Promise<{ transactionId: string; expiresAt: number; candidates: OAuthAssetDiscoveryCandidate[]; registrationId: string; revision: number }>;
  commit(input: {
    transactionId: string;
    tenantId: string;
    clientId: string;
    operatorId: string;
    provider: OAuthDiscoveryInspection["provider"];
    appId: string;
    selectedAssets: AssetRef[];
    registrationId: string;
    expectedRevision: number;
  }): Promise<{ registrationId: string; revision: number; assets: AssetRef[] }>;
}

/** Strict acknowledgement schema; the registry cannot substitute provider candidates. */
export const oauthDiscoveryHandoffSchema = z.object({
  transactionId: z.string().uuid(),
  expiresAt: z.number().int().positive().finite(),
  registrationId: z.string().uuid(),
  revision: z.number().int().positive().finite(),
  candidates: z.array(z.object({
    type: z.literal("AD_ACCOUNT"),
    id: z.string().regex(/^\d{1,100}$/),
    providerAssetId: z.string().regex(/^\d{1,100}$/),
    evidence: z.object({
      source: z.literal("META_ME_ADACCOUNTS"),
      checkedAt: z.number().int().positive().finite(),
      expiresAt: z.number().int().positive().finite(),
    }).strict(),
  }).strict()).max(98),
}).strict();

/** Auth-owned storage keeps the exchanged credential server-side until registration. */
export interface OAuthDiscoveryTransactionStore {
  create(input: {
    transactionId: string;
    tenantId: string;
    clientId: string;
    operatorId: string;
    profileId: string;
    appId: string;
    token: string;
    inspection: OAuthDiscoveryInspection;
    candidates: OAuthAssetDiscoveryCandidate[];
    expiresAt: number;
  }): Promise<void>;
  read(input: { transactionId: string; tenantId: string; clientId: string; operatorId: string; now: number }): Promise<{
    profileId: string;
    appId: string;
    inspection: OAuthDiscoveryInspection;
    candidates: OAuthAssetDiscoveryCandidate[];
    expiresAt: number;
  } | null>;
  readSecret(input: { transactionId: string; tenantId: string; clientId: string; operatorId: string; now: number }): Promise<{
    token: string; inspection: OAuthDiscoveryInspection; candidates: OAuthAssetDiscoveryCandidate[]; expiresAt: number;
  } | null>;
  consume(input: {
    transactionId: string;
    tenantId: string;
    clientId: string;
    operatorId: string;
    now: number;
  }): Promise<{
    token: string;
    inspection: OAuthDiscoveryInspection;
    candidates: OAuthAssetDiscoveryCandidate[];
    expiresAt: number;
  } | null>;
}

export interface OAuthDiscoveryRequired {
  status: "DISCOVERY_REQUIRED";
  transactionId: string;
  expiresAt: number;
  candidates: OAuthAssetDiscoveryCandidate[];
  registrationId: string;
  revision: number;
}

