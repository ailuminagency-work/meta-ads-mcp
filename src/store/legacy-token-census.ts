import type { Firestore } from "@google-cloud/firestore";
import { decryptTokenDetailed, type EncryptedPayload } from "../auth/crypto.js";
import { getKeyringStatus, PRIMARY_KEY_ID, type EncryptionKeyring } from "../auth/keyring.js";

const COLLECTIONS = [
  { name: "meta_tokens", field: "encryptedToken", prefix: "mcp_token" },
  { name: "apify_tokens", field: "encryptedToken", prefix: "apify_token" },
  { name: "gemini_keys", field: "encryptedKey", prefix: "gemini_key" },
] as const;

export const LEGACY_CENSUS_RECORD_LIMIT = 500;
export const LEGACY_CENSUS_USER_RECORD_LIMIT = 50;

export type LegacyCensusScope = { kind: "all" } | { kind: "user"; fbUserId: string };

export interface CollectionCensus {
  records: number;
  invalid: number;
  decryptable: number;
  undecryptable: number;
  byDecryptingKey: Record<string, number>;
  byDeclaredVersion: Record<string, number>;
  aadBound: number;
  aadLegacy: number;
  outerVersionDisagrees: number;
}

export interface LegacyTokenCensus {
  scope: "legacy-user-token-collections";
  subject: "all-users" | "one-user";
  readOnly: true;
  activeKeyId: string;
  keyIds: string[];
  limitPerCollection: number;
  truncated: boolean;
  /** Records a single-key runtime holding only the primary key cannot read. */
  recordsNeedingNonPrimaryKey: number;
  collections: Record<(typeof COLLECTIONS)[number]["name"], CollectionCensus>;
}

function empty(): CollectionCensus {
  return {
    records: 0, invalid: 0, decryptable: 0, undecryptable: 0, byDecryptingKey: {}, byDeclaredVersion: {},
    aadBound: 0, aadLegacy: 0, outerVersionDisagrees: 0,
  };
}

function bump(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function payloadOf(data: Record<string, unknown>, field: string): EncryptedPayload | null {
  const value = data[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  return typeof payload.ciphertext === "string" && typeof payload.iv === "string" && typeof payload.tag === "string"
    ? (payload as unknown as EncryptedPayload)
    : null;
}

/**
 * Bounded, read-only census of the legacy per-user credential collections.
 * It reports counts only: no document path, user id, token name or value is
 * returned, and plaintext exists only transiently inside the decryption call.
 */
export async function inspectLegacyTokenCensus(
  db: Firestore,
  keyring: EncryptionKeyring,
  scope: LegacyCensusScope = { kind: "all" },
  limit: number = scope.kind === "all" ? LEGACY_CENSUS_RECORD_LIMIT : LEGACY_CENSUS_USER_RECORD_LIMIT,
): Promise<LegacyTokenCensus> {
  const status = getKeyringStatus(keyring);
  const collections = {} as LegacyTokenCensus["collections"];
  let truncated = false;
  let nonPrimary = 0;

  for (const target of COLLECTIONS) {
    const census = (collections[target.name] = empty());
    const query = scope.kind === "all"
      ? db.collectionGroup(target.name)
      : db.collection("users").doc(scope.fbUserId).collection(target.name);
    const snapshot = await query.limit(limit + 1).get();
    if (snapshot.docs.length > limit) truncated = true;
    for (const doc of snapshot.docs.slice(0, limit)) {
      census.records++;
      const parts = doc.ref.path.split("/");
      const data = doc.data() as Record<string, unknown>;
      const payload = payloadOf(data, target.field);
      if (parts.length !== 4 || parts[0] !== "users" || parts[2] !== target.name || !parts[1] || !parts[3] || !payload) {
        census.invalid++;
        continue;
      }
      const outer = typeof data.keyVersion === "string" ? data.keyVersion : undefined;
      const inner = typeof payload.keyVersion === "string" ? payload.keyVersion : undefined;
      bump(census.byDeclaredVersion, inner ?? outer ?? "legacy");
      if (outer !== inner) census.outerVersionDisagrees++;

      const aad = `${target.prefix}:${parts[1]}:${parts[3]}`;
      let result: { keyVersion: string; bound: boolean } | undefined;
      for (const attempt of [aad, undefined]) {
        try {
          const decrypted = decryptTokenDetailed(payload, attempt, undefined, keyring);
          result = { keyVersion: decrypted.keyVersion, bound: attempt !== undefined };
          break;
        } catch {
          result = undefined;
        }
      }
      if (!result) {
        census.undecryptable++;
        continue;
      }
      census.decryptable++;
      bump(census.byDecryptingKey, result.keyVersion);
      if (result.keyVersion !== PRIMARY_KEY_ID) nonPrimary++;
      if (result.bound) census.aadBound++;
      else census.aadLegacy++;
    }
  }

  return {
    scope: "legacy-user-token-collections",
    subject: scope.kind === "all" ? "all-users" : "one-user",
    readOnly: true,
    activeKeyId: status.activeKeyId,
    keyIds: status.keyIds,
    limitPerCollection: limit,
    truncated,
    recordsNeedingNonPrimaryKey: nonPrimary,
    collections,
  };
}
