import {getEncryptionKeyringStatus} from "../auth/crypto.js";
import {parseKeyringEnv} from "../auth/keyring.js";
import {getFirestore,getFirestoreRuntimeIdentity} from "../store/firestore.js";
import {inspectLegacyTokenCensus} from "../store/legacy-token-census.js";
import {decryptCredential} from "./connections.js";
import {PlatformDenied,type PlatformPrincipal} from "./models.js";
import type {PlatformRepository} from "./repository.js";

const MAX_CONNECTIONS = 100;

/**
 * Bounded, read-only production compatibility inspection.
 * It deliberately returns metadata only; decrypted credential plaintext is
 * never returned, hashed, logged, or written back. The legacy per-user token
 * census covers only the calling administrator's own records, as counts.
 */
export async function inspectRuntimeCompatibility(repo: PlatformRepository, principal: PlatformPrincipal) {
  const member = await repo.get("members", principal.tenantId, principal.operatorId);
  if (!member || member.tenantId !== principal.tenantId || member.disabledAt !== null || !member.roles.includes("admin")) {
    throw new PlatformDenied("RUNTIME_DIAGNOSTICS_ADMIN_REQUIRED");
  }

  const firestore = getFirestore();
  const probe = await firestore.collection("__lumin_runtime_diagnostics__").doc("__read_only_probe__").get();
  const runtime = getFirestoreRuntimeIdentity();
  const keyring = getEncryptionKeyringStatus();
  const connections = (await repo.list("connections", principal.tenantId))
    .filter(connection => connection.tenantId === principal.tenantId && connection.provider.startsWith("META_"));
  if (connections.length > MAX_CONNECTIONS) throw new PlatformDenied("RUNTIME_DIAGNOSTICS_BOUND_REQUIRED");

  let inspected = 0;
  let decrypted = 0;
  const failures: string[] = [];
  const requiredKeyVersions = new Set<string>();
  const envelopeVersions = new Set<number>();

  for (const connection of connections) {
    const credential = await repo.get("credentials", principal.tenantId, connection.credentialId);
    if (!credential) {
      failures.push("CREDENTIAL_MISSING");
      continue;
    }
    inspected += 1;
    envelopeVersions.add(credential.envelopeVersion);
    requiredKeyVersions.add(credential.payload.keyVersion ?? "legacy");
    try {
      void decryptCredential(credential);
      decrypted += 1;
    } catch (error) {
      failures.push(error instanceof PlatformDenied ? error.reason : "CREDENTIAL_DECRYPTION_FAILED");
    }
  }

  const legacyTokens = await inspectLegacyTokenCensus(firestore, parseKeyringEnv(), {kind: "user", fbUserId: principal.operatorId});
  const uniqueFailures = [...new Set(failures)];
  return {
    status: uniqueFailures.length === 0 ? "PASS" : "HOLD",
    firestore: {
      project_id: runtime.configuredProjectId,
      credential_project_id: runtime.credentialProjectId,
      database_id: runtime.databaseId,
      service_account_email: runtime.serviceAccountEmail,
      emulator: runtime.emulator,
      read_only_probe: {collection: "__lumin_runtime_diagnostics__", document: "__read_only_probe__", exists: probe.exists},
      project_binding_matches: !!runtime.configuredProjectId && !!runtime.credentialProjectId && runtime.configuredProjectId === runtime.credentialProjectId,
    },
    encryption: {
      supported_envelope_versions: [1],
      configured_key_ids: keyring.keyIds,
      active_key_id: keyring.activeKeyId,
      required_key_versions: [...requiredKeyVersions].sort(),
      credential_records_inspected: inspected,
      successful_in_memory_decryptions: decrypted,
      failed_decryptions: failures.length,
      failure_reasons: uniqueFailures,
      migration_candidates: [...requiredKeyVersions].filter(key => key !== keyring.activeKeyId),
      database_writes_performed: 0,
    },
    legacy_tokens: legacyTokens,
    rollback: {
      current_records_are_versioned: [...envelopeVersions].every(version => version === 1),
      rollback_requires_old_key: true,
      compatibility_proven_by_runtime: false,
    },
  };
}
