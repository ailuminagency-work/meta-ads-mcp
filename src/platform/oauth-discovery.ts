import type { AssetRef } from "./models.js";
import type { InspectedOAuthToken } from "./oauth.js";
import type { MetaPermissionProfile } from "./oauth-facebook.js";

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
  }): Promise<{ transactionId: string; expiresAt: number; candidates: OAuthAssetDiscoveryCandidate[] }>;
  commit(input: {
    transactionId: string;
    tenantId: string;
    clientId: string;
    operatorId: string;
    selectedAssets: AssetRef[];
    registrationId: string;
    expectedRevision: number;
  }): Promise<{ registrationId: string; revision: number; assets: AssetRef[] }>;
}

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
}
