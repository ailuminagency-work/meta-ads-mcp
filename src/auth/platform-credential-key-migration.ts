import { createHash, randomUUID } from "node:crypto";
import type { DocumentReference, Firestore } from "@google-cloud/firestore";
import { decryptTokenDetailed, encryptToken, type EncryptedPayload } from "./crypto.js";
import { parseKeyringEnv, type EncryptionKeyring } from "./keyring.js";

type CredentialRecord = {
  id: string;
  tenantId: string;
  operatorId: string;
  provider: string;
  appId: string;
  envelopeVersion: number;
  keyVersion: string;
  payload: EncryptedPayload;
};

type Candidate = { ref: DocumentReference; recordId: string; original: CredentialRecord; fingerprint: string; aad: string };

export interface PlatformCredentialMigrationReport {
  operationId: string | null;
  dryRun: boolean;
  activeKeyId: string;
  total: number;
  candidates: number;
  rotated: number;
  alreadyCurrent: number;
  verified: number;
  failed: number;
  failures: Array<{ recordId: string; reason: string }>;
}

export interface PlatformCredentialMigrationOptions {
  db: Firestore;
  keyring?: EncryptionKeyring;
  dryRun?: boolean;
  operationId?: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pathHash(collection: string, tenantId: string, id: string): string {
  return digest(JSON.stringify([collection, tenantId, id]));
}

function credentialAad(record: CredentialRecord): string {
  return JSON.stringify(["lumin-platform-credential", 1, record.tenantId, record.operatorId, record.provider, record.appId, record.id]);
}

function parseCredential(ref: DocumentReference, value: unknown): CredentialRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_record");
  const data = value as Record<string, unknown>;
  const parts = ref.path.split("/");
  if (parts.length !== 4 || parts[0] !== "platform_v1" || parts[2] !== "credentials") throw new Error("invalid_path");
  for (const field of ["id", "tenantId", "operatorId", "provider", "appId"] as const) {
    if (typeof data[field] !== "string" || !(data[field] as string).trim()) throw new Error("invalid_identity");
  }
  if (data.envelopeVersion !== 1 || data.keyVersion !== "primary") throw new Error("invalid_envelope");
  const payload = data.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("invalid_payload");
  const p = payload as Record<string, unknown>;
  if (["ciphertext", "iv", "tag", "keyVersion"].some((field) => typeof p[field] !== "string" || !(p[field] as string).length)) throw new Error("invalid_payload");
  const record = data as unknown as CredentialRecord;
  if (parts[1] !== pathHash("tenants", record.tenantId, record.tenantId) ||
      parts[3] !== pathHash("credentials", record.tenantId, record.id)) throw new Error("identity_path_mismatch");
  return record;
}

function candidate(ref: DocumentReference, value: unknown): Candidate {
  const original = parseCredential(ref, value);
  return { ref, recordId: digest(ref.path).slice(0, 24), original,
    fingerprint: digest(JSON.stringify(original)), aad: credentialAad(original) };
}

function authenticate(item: Candidate, keyring: EncryptionKeyring): { plaintext: string; keyVersion: string } {
  const payload = item.original.payload;
  return decryptTokenDetailed(payload, item.aad, payload.keyVersion, keyring);
}

function report(dryRun: boolean, operationId: string | null, keyring: EncryptionKeyring): PlatformCredentialMigrationReport {
  return { operationId, dryRun, activeKeyId: keyring.activeKeyId, total: 0, candidates: 0,
    rotated: 0, alreadyCurrent: 0, verified: 0, failed: 0, failures: [] };
}

function fail(result: PlatformCredentialMigrationReport, recordId: string, reason: string): void {
  result.failed++;
  result.failures.push({ recordId, reason });
}

async function discover(db: Firestore): Promise<Array<{ ref: DocumentReference; value: unknown }>> {
  const snapshot = await db.collectionGroup("credentials").get();
  return snapshot.docs.map((doc) => ({ ref: doc.ref, value: doc.data() }));
}

export async function runPlatformCredentialKeyMigration(options: PlatformCredentialMigrationOptions): Promise<PlatformCredentialMigrationReport> {
  const keyring = options.keyring ?? parseKeyringEnv();
  const dryRun = options.dryRun ?? true;
  const operationId = dryRun ? null : options.operationId ?? randomUUID();
  const result = report(dryRun, operationId, keyring);
  const docs = await discover(options.db);
  result.total = docs.length;
  const candidates: Candidate[] = [];
  for (const doc of docs) {
    const recordId = digest(doc.ref.path).slice(0, 24);
    try {
      const item = candidate(doc.ref, doc.value);
      authenticate(item, keyring);
      candidates.push(item);
      if (item.original.payload.keyVersion !== keyring.activeKeyId) result.candidates++;
      if (dryRun) result.verified++;
    } catch {
      fail(result, recordId, "invalid_or_unauthenticated_credential");
    }
  }
  if (dryRun || result.failed) return result;

  const operationRef = options.db.collection("_lumin_migrations").doc("platform_credential_encryption")
    .collection("operations").doc(operationId!);
  await options.db.runTransaction(async (tx) => {
    const snap = await tx.get(operationRef);
    if (snap.exists) throw new Error("migration_operation_exists");
    tx.create(operationRef, { status: "running", activeKeyId: keyring.activeKeyId, total: result.total, startedAt: Date.now() });
  });

  for (const item of candidates) {
    const ledgerRef = operationRef.collection("records").doc(item.recordId);
    try {
      const status = await options.db.runTransaction(async (tx) => {
        const [snapshot, ledger] = await Promise.all([tx.get(item.ref), tx.get(ledgerRef)]);
        if (ledger.exists) throw new Error("migration_record_already_processed");
        if (!snapshot.exists) throw new Error("credential_changed");
        const current = candidate(item.ref, snapshot.data());
        if (current.fingerprint !== item.fingerprint) throw new Error("credential_changed");
        const decrypted = authenticate(current, keyring);
        const isCurrent = current.original.payload.keyVersion === keyring.activeKeyId;
        const replacement = isCurrent ? current.original.payload : encryptToken(decrypted.plaintext, current.aad, keyring);
        if (!isCurrent) tx.update(item.ref, { payload: replacement });
        tx.create(ledgerRef, { status: "completed", result: isCurrent ? "alreadyCurrent" : "rotated",
          keyVersion: keyring.activeKeyId, completedAt: Date.now() });
        return { state: isCurrent ? "alreadyCurrent" : "rotated", expectedPayload: JSON.stringify(replacement) };
      });
      const after = await item.ref.get();
      const verified = candidate(item.ref, after.data());
      if (verified.original.payload.keyVersion !== keyring.activeKeyId ||
          JSON.stringify(verified.original.payload) !== status.expectedPayload) throw new Error("post_verify_failed");
      authenticate(verified, keyring);
      result.verified++;
      if (status.state === "rotated") result.rotated++;
      else result.alreadyCurrent++;
    } catch {
      fail(result, item.recordId, "transaction_or_verification_failed");
    }
  }
  await operationRef.update({ status: result.failed ? "failed" : "completed", finishedAt: Date.now(),
    counts: { total: result.total, candidates: result.candidates, rotated: result.rotated,
      alreadyCurrent: result.alreadyCurrent, verified: result.verified, failed: result.failed } });
  return result;
}

export async function verifyPlatformCredentialKeyMigration(db: Firestore, keyring: EncryptionKeyring = parseKeyringEnv()): Promise<PlatformCredentialMigrationReport> {
  const result = report(true, null, keyring);
  for (const doc of await discover(db)) {
    result.total++;
    const recordId = digest(doc.ref.path).slice(0, 24);
    try {
      const item = candidate(doc.ref, doc.value);
      if (item.original.payload.keyVersion !== keyring.activeKeyId) throw new Error("not_current");
      authenticate(item, keyring);
      result.verified++;
    } catch {
      fail(result, recordId, "active_key_verification_failed");
    }
  }
  return result;
}
