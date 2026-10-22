import crypto from "node:crypto";
import { logger } from "../utils/logger.js";
import type { DocumentReference } from "@google-cloud/firestore";
import { getFirestore } from "../store/firestore.js";
import {
  resetKeyCache,
  type EncryptedPayload,
} from "./crypto.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const MIGRATION_MODE = "run";
const MARKER_COLLECTION = "_lumin_migrations";
const MARKER_ID = "token-encryption-key";
const MAX_LOCK_AGE_MS = 30 * 60 * 1000;

interface TokenDocument {
  encryptedToken?: EncryptedPayload;
  updatedAt?: number;
}

interface MigrationMarker {
  status: "running" | "completed" | "failed";
  operationId: string;
  startedAt: number;
  completedAt?: number;
  failedAt?: number;
  projectId: string;
  oldKeyFingerprint: string;
  newKeyFingerprint: string;
  total?: number;
  rotated?: number;
  alreadyCurrent?: number;
  failed?: number;
  failureIds?: string[];
  error?: string;
}

function parseKey(raw: string | undefined, name: string): Buffer {
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${name} must be 64 hexadecimal characters`);
  }
  return Buffer.from(raw, "hex");
}

function fingerprint(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function aadFor(userId: string, tokenName: string): string {
  return `mcp_token:${userId}:${tokenName}`;
}

function encryptWithKey(plaintext: string, key: Buffer, aad: string): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptWithKey(
  payload: EncryptedPayload,
  key: Buffer,
  aad?: string,
): string {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function decryptCompatible(
  payload: EncryptedPayload,
  key: Buffer,
  userId: string,
  tokenName: string,
): string {
  try {
    return decryptWithKey(payload, key, aadFor(userId, tokenName));
  } catch {
    return decryptWithKey(payload, key);
  }
}

function runtimeProjectId(): string {
  const projectId =
    process.env.FIRESTORE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) throw new Error("Firestore project ID is required for migration");
  const expected = process.env.LUMIN_EXPECTED_FIRESTORE_PROJECT_ID?.trim();
  if (expected && expected !== projectId) {
    throw new Error("Firestore project identity does not match the expected staging project");
  }
  return projectId;
}

function isFreshRunningMarker(marker: MigrationMarker): boolean {
  return (
    marker.status === "running" &&
    Date.now() - marker.startedAt < MAX_LOCK_AGE_MS
  );
}

async function claimMigration(
  markerRef: DocumentReference,
  projectId: string,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<{ operationId: string; alreadyComplete: boolean }> {
  const operationId = crypto.randomUUID();
  return getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(markerRef);
    const existing = snapshot.exists
      ? (snapshot.data() as MigrationMarker)
      : undefined;

    if (existing?.status === "completed") {
      return { operationId: existing.operationId, alreadyComplete: true };
    }
    if (existing && isFreshRunningMarker(existing)) {
      throw new Error("Token encryption migration is already running");
    }
    if (oldKey.equals(newKey)) {
      throw new Error("TOKEN_ENCRYPTION_KEY and TOKEN_ENCRYPTION_KEY_NEXT must differ");
    }

    const marker: MigrationMarker = {
      status: "running",
      operationId,
      startedAt: Date.now(),
      projectId,
      oldKeyFingerprint: fingerprint(oldKey),
      newKeyFingerprint: fingerprint(newKey),
    };
    tx.set(markerRef, marker, { merge: true });
    return { operationId, alreadyComplete: false };
  });
}

export async function runTokenEncryptionMigration(): Promise<void> {
  if (process.env.TOKEN_ENCRYPTION_MIGRATION !== MIGRATION_MODE) return;

  const projectId = runtimeProjectId();
  const oldKey = parseKey(process.env.TOKEN_ENCRYPTION_KEY, "TOKEN_ENCRYPTION_KEY");
  const newKey = parseKey(
    process.env.TOKEN_ENCRYPTION_KEY_NEXT,
    "TOKEN_ENCRYPTION_KEY_NEXT",
  );
  const db = getFirestore();
  const markerRef = db.collection(MARKER_COLLECTION).doc(MARKER_ID);
  const claim = await claimMigration(markerRef, projectId, oldKey, newKey);

  if (claim.alreadyComplete) {
    // Keep the current process on the new key while the old variable remains
    // available for rollback during the verification window.
    process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY_NEXT;
    resetKeyCache();
    logger.info({
      event: "token_encryption_migration_already_completed",
      projectId,
      operationId: claim.operationId,
      newKeyFingerprint: fingerprint(newKey),
    }, "Token encryption migration already completed");
    return;
  }

  let total = 0;
  let rotated = 0;
  let alreadyCurrent = 0;
  let failed = 0;
  const failureIds: string[] = [];

  try {
    const usersSnapshot = await db.collection("users").get();

    for (const userDocument of usersSnapshot.docs) {
      const tokensSnapshot = await userDocument.ref.collection("meta_tokens").get();

      for (const tokenDocument of tokensSnapshot.docs) {
        total++;
        const tokenId = `${userDocument.id}/${tokenDocument.id}`;
        const data = tokenDocument.data() as TokenDocument;
        if (!data.encryptedToken) {
          failed++;
          failureIds.push(tokenId);
          continue;
        }

        let plaintext: string | undefined;
        let wasAlreadyCurrent = false;
        try {
          plaintext = decryptCompatible(
            data.encryptedToken,
            oldKey,
            userDocument.id,
            tokenDocument.id,
          );
        } catch {
          try {
            // Allows a safely resumed migration after a partial write.
            plaintext = decryptCompatible(
              data.encryptedToken,
              newKey,
              userDocument.id,
              tokenDocument.id,
            );
            alreadyCurrent++;
            wasAlreadyCurrent = true;
          } catch {
            failed++;
            failureIds.push(tokenId);
          }
        }

        if (plaintext === undefined || wasAlreadyCurrent) continue;

        const nextPayload = encryptWithKey(
          plaintext,
          newKey,
          aadFor(userDocument.id, tokenDocument.id),
        );
        const verifyPlaintext = decryptWithKey(
          nextPayload,
          newKey,
          aadFor(userDocument.id, tokenDocument.id),
        );
        if (verifyPlaintext !== plaintext) {
          throw new Error(`Pre-write verification failed for ${tokenId}`);
        }

        await tokenDocument.ref.update({
          encryptedToken: nextPayload,
          updatedAt: Math.floor(Date.now() / 1000),
        });

        const after = await tokenDocument.ref.get();
        const stored = (after.data() as TokenDocument).encryptedToken;
        if (!stored) throw new Error(`Post-write payload missing for ${tokenId}`);
        const storedPlaintext = decryptCompatible(
          stored,
          newKey,
          userDocument.id,
          tokenDocument.id,
        );
        if (storedPlaintext !== plaintext) {
          throw new Error(`Post-write verification failed for ${tokenId}`);
        }
        rotated++;
      }
    }

    if (failed > 0) {
      throw new Error(`Migration could not verify ${failed} token record(s)`);
    }

    const completedAt = Date.now();
    await markerRef.set(
      {
        status: "completed",
        operationId: claim.operationId,
        completedAt,
        total,
        rotated,
        alreadyCurrent,
        failed,
      } satisfies Partial<MigrationMarker>,
      { merge: true },
    );

    process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY_NEXT;
    resetKeyCache();
    logger.info({
      event: "token_encryption_migration_completed",
      projectId,
      operationId: claim.operationId,
      total,
      rotated,
      alreadyCurrent,
      failed,
      newKeyFingerprint: fingerprint(newKey),
    }, "Token encryption migration completed");
  } catch (error) {
    await markerRef.set(
      {
        status: "failed",
        operationId: claim.operationId,
        failedAt: Date.now(),
        total,
        rotated,
        alreadyCurrent,
        failed,
        failureIds,
        error: error instanceof Error ? error.message : "unknown migration error",
      } satisfies Partial<MigrationMarker>,
      { merge: true },
    );
    throw error;
  }
}
