import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { decryptTokenDetailed, type EncryptedPayload } from "./crypto.js";
import { parseKeyringEnv, type EncryptionKeyring } from "./keyring.js";

type Family = { collection: string; fields: readonly string[]; required?: readonly string[]; root?: boolean; legacyPrefix?: string };

// This is an explicit census of every persisted encryptToken call site. A new
// encrypted field must be added here before the prior key can be retired.
export const ENCRYPTED_CORPUS_FAMILIES: readonly Family[] = [
  { collection: "meta_tokens", fields: ["encryptedToken"], legacyPrefix: "mcp_token" },
  { collection: "apify_tokens", fields: ["encryptedToken"], legacyPrefix: "apify_token" },
  { collection: "gemini_keys", fields: ["encryptedKey"], legacyPrefix: "gemini_key" },
  { collection: "credentials", fields: ["payload"] },
  { collection: "pageInspectionDelegations", fields: ["payload"] },
  { collection: "approvalRequests", fields: ["encryptedPlan"] },
  { collection: "accountOwnershipObservations", fields: ["encryptedProof"] },
  ...["discoveryProposals", "mediaProposals", "videoProposals", "attachmentProposals", "appPromotionProposals", "signalDiscoveryProposals"].map(collection => ({ collection, fields: ["encryptedPlan"] })),
  ...["trackingChangeJobs", "pausedAdBatchJobs"].map(collection => ({ collection, fields: ["encryptedProposal"] })),
  { collection: "compatibilityObservations", fields: ["encryptedProof"] },
  { collection: "targetingLookups", fields: ["encryptedRows"] },
  { collection: "whatsappSetupLeases", fields: ["payload"] },
  { collection: "researchFinancialCheckpoints", fields: ["providerJobReference"] },
  { collection: "researchJobs", fields: ["encryptedRequest", "encryptedProviderReceipt", "encryptedResults"], required: ["encryptedRequest"] },
  { collection: "platform_crm_sources", fields: ["encrypted"], root: true },
  { collection: "platform_crm_meta_leads", fields: ["encrypted"], root: true },
  { collection: "platform_first_party_sources", fields: ["encrypted"], root: true },
];

export type RetirementHoldReason = "INVALID_PATH" | "MISSING_OR_MALFORMED_PAYLOAD" | "OLD_OR_UNKNOWN_KEY" | "UNVERIFIED_AAD" | "AUTHENTICATION_FAILED" | "UNEXPECTED_ENCRYPTED_FIELD" | "INVENTORY_READ_FAILED";
export interface EncryptedCorpusRetirementReport {
  verdict: "PASS" | "HOLD";
  scope: "known-encrypted-families-only";
  keyRetirementAuthorized: false;
  activeKeyId: string;
  families: Record<string, { records: number; envelopes: number; holds: number }>;
  reasons: Record<RetirementHoldReason, number>;
  records: number;
  envelopes: number;
  holds: number;
}

function payload(value: unknown): EncryptedPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.ciphertext !== "string" || typeof p.iv !== "string" || typeof p.tag !== "string" || typeof p.keyVersion !== "string") return null;
  return p as unknown as EncryptedPayload;
}

function envelopeLike(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && ["ciphertext", "iv", "tag"].some(key => key in value);
}

function credentialAad(row: Record<string, unknown>): string | null {
  const keys = ["tenantId", "operatorId", "provider", "appId", "id"] as const;
  if (keys.some(key => typeof row[key] !== "string" || !(row[key] as string).length)) return null;
  return JSON.stringify(["lumin-platform-credential", 1, ...keys.map(key => row[key])]);
}

function credentialPathMatches(path: string, row: Record<string, unknown>): boolean {
  if (row.keyVersion !== "primary") return false;
  const { tenantId, id } = row;
  if (typeof tenantId !== "string" || typeof id !== "string") return false;
  const [root, tenantHash, collection, recordHash] = path.split("/");
  const hash = (collectionName: string, value: string) => createHash("sha256").update(JSON.stringify([collectionName, tenantId, value])).digest("hex");
  return root === "platform_v1" && collection === "credentials" && tenantHash === hash("tenants", tenantId) && recordHash === hash("credentials", id);
}

function aadFor(family: Family, path: string, row: Record<string, unknown>, field: string): string | null {
  const parts = path.split("/");
  if (family.legacyPrefix) {
    if (parts.length !== 4 || parts[0] !== "users" || parts[2] !== family.collection || !parts[1] || !parts[3]) return null;
    return `${family.legacyPrefix}:${parts[1]}:${parts[3]}`;
  }
  if (family.collection === "credentials" && field === "payload") return credentialAad(row);
  return null;
}

function validPath(family: Family, path: string): boolean {
  const parts = path.split("/");
  if (family.root) return parts.length === 2 && parts[0] === family.collection && !!parts[1];
  if (family.legacyPrefix) return parts.length === 4 && parts[0] === "users" && parts[2] === family.collection && !!parts[1] && !!parts[3];
  return parts.length === 4 && parts[0] === "platform_v1" && !!parts[1] && parts[2] === family.collection && !!parts[3];
}

function unlistedEnvelope(value: unknown, listedFields: readonly string[], topLevel = true): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => unlistedEnvelope(item, [], false));
  for (const [key, nested] of Object.entries(value)) {
    if (topLevel && listedFields.includes(key)) continue;
    if (envelopeLike(nested) || unlistedEnvelope(nested, [], false)) return true;
  }
  return false;
}

export async function inspectEncryptedCorpusForRetirement(db: Firestore, keyring: EncryptionKeyring = parseKeyringEnv()): Promise<EncryptedCorpusRetirementReport> {
  const reasons: EncryptedCorpusRetirementReport["reasons"] = { INVALID_PATH: 0, MISSING_OR_MALFORMED_PAYLOAD: 0, OLD_OR_UNKNOWN_KEY: 0, UNVERIFIED_AAD: 0, AUTHENTICATION_FAILED: 0, UNEXPECTED_ENCRYPTED_FIELD: 0, INVENTORY_READ_FAILED: 0 };
  const families: EncryptedCorpusRetirementReport["families"] = {};
  let records = 0, envelopes = 0, holds = 0;
  for (const family of ENCRYPTED_CORPUS_FAMILIES) {
    const bucket = families[family.collection] = { records: 0, envelopes: 0, holds: 0 };
    const hold = (reason: RetirementHoldReason) => { reasons[reason]++; bucket.holds++; holds++; };
    try {
      const snapshot = await (family.root ? db.collection(family.collection) : db.collectionGroup(family.collection)).get();
      for (const doc of snapshot.docs) {
        bucket.records++; records++;
        if (!validPath(family, doc.ref.path)) { hold("INVALID_PATH"); continue; }
        const row = doc.data() as Record<string, unknown>;
        if (!row || typeof row !== "object") { hold("MISSING_OR_MALFORMED_PAYLOAD"); continue; }
        if (family.collection === "credentials" && !credentialPathMatches(doc.ref.path, row)) { hold("INVALID_PATH"); continue; }
        if (unlistedEnvelope(row, family.fields)) hold("UNEXPECTED_ENCRYPTED_FIELD");
        let present = 0;
        for (const field of family.fields) {
          const raw = row[field];
          if (raw === undefined || raw === null) continue;
          present++; bucket.envelopes++; envelopes++;
          const p = payload(raw);
          if (!p) { hold("MISSING_OR_MALFORMED_PAYLOAD"); continue; }
          // Credential.keyVersion is an envelope schema label ("primary");
          // payload.keyVersion names the actual cryptographic key.
          if (p.keyVersion !== keyring.activeKeyId || (family.legacyPrefix && row.keyVersion !== keyring.activeKeyId)) { hold("OLD_OR_UNKNOWN_KEY"); continue; }
          const aad = aadFor(family, doc.ref.path, row, field);
          if (!aad) { hold("UNVERIFIED_AAD"); continue; }
          try { decryptTokenDetailed(p, aad, p.keyVersion, keyring); }
          catch { hold("AUTHENTICATION_FAILED"); }
        }
        if (present === 0 || family.required?.some(field => row[field] === undefined || row[field] === null)) hold("MISSING_OR_MALFORMED_PAYLOAD");
      }
    } catch { hold("INVENTORY_READ_FAILED"); }
  }
  return { verdict: holds === 0 ? "PASS" : "HOLD", scope: "known-encrypted-families-only", keyRetirementAuthorized: false, activeKeyId: keyring.activeKeyId, families, reasons, records, envelopes, holds };
}
