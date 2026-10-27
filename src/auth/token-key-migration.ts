import crypto from "node:crypto";
import {
  type DocumentReference,
  type Firestore,
} from "@google-cloud/firestore";
import {
  decryptTokenDetailed,
  encryptToken,
  type EncryptedPayload,
} from "./crypto.js";
import { getKeyringStatus, parseKeyringEnv, type EncryptionKeyring } from "./keyring.js";

const OPERATION_ROOT = ["_lumin_migrations", "token_encryption"] as const;
const TARGETS = [
  { collection: "meta_tokens", field: "encryptedToken", prefix: "mcp_token" },
  { collection: "apify_tokens", field: "encryptedToken", prefix: "apify_token" },
  { collection: "gemini_keys", field: "encryptedKey", prefix: "gemini_key" },
] as const;

type Target = (typeof TARGETS)[number];

export interface MigrationOptions {
  db: Firestore;
  keyring?: EncryptionKeyring;
  dryRun?: boolean;
  operationId?: string;
  resume?: boolean;
  maxFailures?: number;
}

export interface MigrationReport {
  /** This migration does not inspect platform/tenant credential records. */
  scope: "legacy-user-token-collections-only";
  operationId: string | null;
  dryRun: boolean;
  activeKeyId: string;
  keyIds: string[];
  total: number;
  candidates: number;
  rotated: number;
  alreadyCurrent: number;
  skipped: number;
  verified: number;
  failed: number;
  failures: Array<{ recordId: string; reason: string }>;
  byCollection: Record<string, { total: number; candidates: number; rotated: number; failed: number }>;
}

interface DiscoveredRecord {
  target: Target;
  ref: DocumentReference;
  recordId: string;
  aad: string;
  payload: EncryptedPayload;
  declaredKeyVersion?: string;
  outerKeyVersion?: string;
}

function recordIdFor(path: string): string {
  return crypto.createHash("sha256").update(path).digest("hex").slice(0, 16);
}

function pathIdentity(ref: DocumentReference, target: Target): { fbUserId: string; docId: string } | null {
  const parts = ref.path.split("/");
  if (parts.length !== 4 || parts[0] !== "users" || parts[2] !== target.collection) return null;
  return { fbUserId: parts[1], docId: parts[3] };
}

function aadFor(target: Target, ref: DocumentReference): string {
  const identity = pathIdentity(ref, target);
  if (!identity) throw new Error("Unexpected encrypted credential document path");
  return `${target.prefix}:${identity.fbUserId}:${identity.docId}`;
}

function payloadFrom(data: Record<string, unknown>, target: Target): EncryptedPayload | null {
  const value = data[target.field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.ciphertext !== "string" ||
    typeof payload.iv !== "string" ||
    typeof payload.tag !== "string"
  ) return null;
  return payload as unknown as EncryptedPayload;
}

interface VersionHint {
  declared: string | undefined;
  tryAllKeys: boolean;
}

/**
 * The runtime read path only honours the envelope's own version and tries every
 * key when the envelope has none. A stored outer label that disagrees with the
 * envelope, or that sits beside a versionless envelope, proves nothing about
 * the key, so those records are authenticated against the whole keyring. Only
 * a label pair that agrees pins a single key.
 */
function versionHint(data: Record<string, unknown>, payload: EncryptedPayload): VersionHint {
  const outer = typeof data.keyVersion === "string" ? data.keyVersion : undefined;
  const inner = typeof payload.keyVersion === "string" ? payload.keyVersion : undefined;
  if (inner === undefined) return { declared: undefined, tryAllKeys: true };
  if (outer !== undefined && outer !== inner) return { declared: undefined, tryAllKeys: true };
  return { declared: inner, tryAllKeys: false };
}

function isCurrent(data: Record<string, unknown>, payload: EncryptedPayload, activeKeyId: string): boolean {
  return data.keyVersion === activeKeyId && payload.keyVersion === activeKeyId;
}

function decryptForMigration(
  payload: EncryptedPayload,
  aad: string,
  hint: VersionHint,
  keyring: EncryptionKeyring,
) {
  const subject = hint.tryAllKeys && typeof payload.keyVersion === "string"
    ? { ciphertext: payload.ciphertext, iv: payload.iv, tag: payload.tag }
    : payload;
  try {
    return { ...decryptTokenDetailed(subject, aad, hint.declared, keyring), usedLegacyAad: false };
  } catch {
    // Legacy records were encrypted without AAD. This fallback is deliberately
    // confined to the migration boundary; all newly written records use AAD.
    return { ...decryptTokenDetailed(subject, undefined, hint.declared, keyring), usedLegacyAad: true };
  }
}

function emptyReport(dryRun: boolean, operationId: string | null, keyring: EncryptionKeyring): MigrationReport {
  const status = getKeyringStatus(keyring);
  return {
    scope: "legacy-user-token-collections-only",
    operationId,
    dryRun,
    activeKeyId: status.activeKeyId,
    keyIds: status.keyIds,
    total: 0,
    candidates: 0,
    rotated: 0,
    alreadyCurrent: 0,
    skipped: 0,
    verified: 0,
    failed: 0,
    failures: [],
    byCollection: Object.fromEntries(TARGETS.map((target) => [target.collection, { total: 0, candidates: 0, rotated: 0, failed: 0 }])),
  };
}

interface InvalidRecord { recordId: string; collection: string; reason: string }

async function discover(db: Firestore): Promise<{ records: DiscoveredRecord[]; invalid: InvalidRecord[] }> {
  const records: DiscoveredRecord[] = [];
  const invalid: InvalidRecord[] = [];
  for (const target of TARGETS) {
    const snapshot = await db.collectionGroup(target.collection).get();
    for (const doc of snapshot.docs) {
      const identity = pathIdentity(doc.ref, target);
      const data = doc.data() as Record<string, unknown>;
      const payload = payloadFrom(data, target);
      if (!identity || !payload) {
        invalid.push({
          recordId: recordIdFor(doc.ref.path),
          collection: target.collection,
          reason: !identity ? "unexpected_document_path" : "invalid_encrypted_payload",
        });
        continue;
      }
      records.push({
        target,
        ref: doc.ref,
        recordId: recordIdFor(doc.ref.path),
        aad: aadFor(target, doc.ref),
        payload,
        declaredKeyVersion: versionHint(data, payload).declared,
        outerKeyVersion: typeof data.keyVersion === "string" ? data.keyVersion : undefined,
      });
    }
  }
  return { records, invalid };
}

function recordDiscoveryFailures(report: MigrationReport, invalid: InvalidRecord[]): void {
  for (const record of invalid) {
    report.failed++;
    report.byCollection[record.collection].total++;
    report.byCollection[record.collection].failed++;
    report.failures.push({ recordId: record.recordId, reason: record.reason });
  }
}

function operationRef(db: Firestore, operationId: string) {
  return db.collection(OPERATION_ROOT[0]).doc(OPERATION_ROOT[1]).collection("operations").doc(operationId);
}

async function initializeOperation(db: Firestore, operationId: string, keyring: EncryptionKeyring, resume: boolean): Promise<void> {
  const ref = operationRef(db, operationId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = snap.data();
      const status = existing?.status;
      if (status === "completed") throw new Error(`Migration operation ${operationId} is already completed`);
      if (!resume || (status !== "running" && status !== "failed")) {
        throw new Error(`Migration operation ${operationId} cannot be resumed`);
      }
      const keyStatus = getKeyringStatus(keyring);
      const originalFingerprints = existing?.keyFingerprints;
      const fingerprintsMatch = typeof originalFingerprints === "object" && originalFingerprints !== null &&
        !Array.isArray(originalFingerprints) &&
        Object.keys(originalFingerprints).length === keyStatus.keyIds.length &&
        keyStatus.keyIds.every((keyId) => (originalFingerprints as Record<string, unknown>)[keyId] === keyStatus.fingerprints[keyId]);
      if (
        existing?.activeKeyId !== keyStatus.activeKeyId ||
        JSON.stringify(existing?.keyIds) !== JSON.stringify(keyStatus.keyIds) ||
        !fingerprintsMatch
      ) throw new Error("Migration operation keyring does not match the original operation");
      tx.update(ref, { status: "running", resumedAt: Date.now() });
      return;
    }
    const keyStatus = getKeyringStatus(keyring);
    tx.create(ref, {
      status: "running",
      startedAt: Date.now(),
      activeKeyId: keyStatus.activeKeyId,
      keyIds: keyStatus.keyIds,
      keyFingerprints: keyStatus.fingerprints,
      counts: { total: 0, rotated: 0, failed: 0 },
    });
  });
}

async function migrateRecord(
  db: Firestore,
  record: DiscoveredRecord,
  operationId: string,
  keyring: EncryptionKeyring,
): Promise<"rotated" | "alreadyCurrent" | "skipped"> {
  const ledgerRef = operationRef(db, operationId).collection("records").doc(record.recordId);
  const result = await db.runTransaction(async (tx) => {
    const ledger = await tx.get(ledgerRef);
    const snap = await tx.get(record.ref);
    if (!snap.exists) throw new Error("record disappeared during migration");
    const data = snap.data() as Record<string, unknown>;
    const payload = payloadFrom(data, record.target);
    if (!payload) throw new Error("encrypted payload disappeared during migration");
    if (ledger.exists && ledger.data()?.status === "completed") {
      if (ledger.data()?.keyVersion !== keyring.activeKeyId || !isCurrent(data, payload, keyring.activeKeyId)) {
        throw new Error("completed ledger no longer matches active-key record");
      }
      decryptTokenDetailed(payload, record.aad, keyring.activeKeyId, keyring);
      return "skipped" as const;
    }
    const hint = versionHint(data, payload);
    const now = Date.now();

    if (isCurrent(data, payload, keyring.activeKeyId)) {
      decryptTokenDetailed(payload, record.aad, keyring.activeKeyId, keyring);
      tx.set(ledgerRef, { status: "completed", result: "alreadyCurrent", completedAt: now, keyVersion: keyring.activeKeyId });
      return "alreadyCurrent" as const;
    }

    const decrypted = decryptForMigration(payload, record.aad, hint, keyring);
    const replacement = encryptToken(decrypted.plaintext, record.aad, keyring);
    tx.update(record.ref, {
      [record.target.field]: replacement,
      keyVersion: keyring.activeKeyId,
      updatedAt: Math.floor(now / 1000),
      keyMigration: {
        operationId,
        fromKeyVersion: decrypted.keyVersion,
        legacyAad: decrypted.usedLegacyAad,
        migratedAt: now,
      },
    });
    tx.set(ledgerRef, {
      status: "completed",
      result: "rotated",
      completedAt: now,
      keyVersion: keyring.activeKeyId,
      fromKeyVersion: decrypted.keyVersion,
      legacyAad: decrypted.usedLegacyAad,
    });
    return "rotated" as const;
  });

  const after = await record.ref.get();
  const data = after.data() as Record<string, unknown> | undefined;
  const payload = data ? payloadFrom(data, record.target) : null;
  if (!payload || data?.keyVersion !== keyring.activeKeyId) throw new Error("post-write verification failed");
  decryptTokenDetailed(payload, record.aad, keyring.activeKeyId, keyring);
  return result;
}

export async function runTokenKeyMigration(options: MigrationOptions): Promise<MigrationReport> {
  const keyring = options.keyring ?? parseKeyringEnv();
  const dryRun = options.dryRun ?? true;
  const operationId = dryRun ? null : options.operationId ?? crypto.randomUUID();
  const report = emptyReport(dryRun, operationId, keyring);
  const discovered = await discover(options.db);
  report.total = discovered.records.length + discovered.invalid.length;
  recordDiscoveryFailures(report, discovered.invalid);
  for (const record of discovered.records) {
    const bucket = report.byCollection[record.target.collection];
    bucket.total++;
    if (record.outerKeyVersion !== keyring.activeKeyId || record.payload.keyVersion !== keyring.activeKeyId) {
      report.candidates++;
      bucket.candidates++;
    }
  }

  if (dryRun) {
    for (const record of discovered.records) {
      try {
        const data = (await record.ref.get()).data() as Record<string, unknown>;
        const payload = payloadFrom(data, record.target);
        if (!payload) throw new Error("encrypted payload disappeared during dry-run");
        decryptForMigration(payload, record.aad, versionHint(data, payload), keyring);
        report.verified++;
      } catch {
        report.failed++;
        report.byCollection[record.target.collection].failed++;
        report.failures.push({ recordId: record.recordId, reason: "decrypt_failed" });
      }
    }
    return report;
  }

  if (discovered.invalid.length > 0) {
    // Do not create a ledger or change any credential when discovery is incomplete.
    return report;
  }

  await initializeOperation(options.db, operationId!, keyring, options.resume ?? false);
  const maxFailures = options.maxFailures ?? 10;
  for (const record of discovered.records) {
    try {
      const result = await migrateRecord(options.db, record, operationId!, keyring);
      report.verified++;
      if (result === "rotated") {
        report.rotated++;
        report.byCollection[record.target.collection].rotated++;
      } else if (result === "alreadyCurrent") {
        report.alreadyCurrent++;
      } else {
        report.skipped++;
      }
    } catch {
      report.failed++;
      report.byCollection[record.target.collection].failed++;
      report.failures.push({ recordId: record.recordId, reason: "record_failed" });
      if (report.failed >= maxFailures) break;
    }
  }

  const status = report.failed === 0 && report.verified === discovered.records.length ? "completed" : "failed";
  await operationRef(options.db, operationId!).update({
    status,
    finishedAt: Date.now(),
    counts: {
      total: report.total,
      rotated: report.rotated,
      alreadyCurrent: report.alreadyCurrent,
      skipped: report.skipped,
      verified: report.verified,
      failed: report.failed,
    },
  });
  return report;
}

export async function verifyTokenKeyMigration(
  db: Firestore,
  keyring: EncryptionKeyring = parseKeyringEnv(),
): Promise<MigrationReport> {
  const report = emptyReport(true, null, keyring);
  const discovered = await discover(db);
  report.total = discovered.records.length + discovered.invalid.length;
  recordDiscoveryFailures(report, discovered.invalid);
  for (const record of discovered.records) {
    report.byCollection[record.target.collection].total++;
    try {
      const snap = await record.ref.get();
      const data = snap.data() as Record<string, unknown>;
      const payload = payloadFrom(data, record.target);
      if (!payload || data.keyVersion !== keyring.activeKeyId || payload.keyVersion !== keyring.activeKeyId) {
        throw new Error("record is not on the active key version");
      }
      decryptTokenDetailed(payload, record.aad, keyring.activeKeyId, keyring);
      report.verified++;
    } catch {
      report.failed++;
      report.failures.push({ recordId: record.recordId, reason: "active_key_verification_failed" });
    }
  }
  return report;
}

export function getMigrationKeyringStatus(keyring: EncryptionKeyring = parseKeyringEnv()) {
  return getKeyringStatus(keyring);
}
