import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptCredential } from "../../src/platform/connections.js";
import type { Connection, Credential } from "../../src/platform/models.js";
import { FirestorePlatformRepository } from "../../src/platform/repository.js";
import { inspectRuntimeCompatibility } from "../../src/platform/runtime-diagnostics.js";
import { ENVS, hex, K1, K2, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => holder.db,
  getFirestoreRuntimeIdentity: () => ({
    configuredProjectId: "synthetic-project", credentialProjectId: "synthetic-project", serviceAccountEmail: "runtime@synthetic-project.iam.gserviceaccount.com",
    databaseId: "(default)", emulator: false,
  }),
}));

const PLAINTEXT = "synthetic-diagnostic-plaintext";
const principalA = { tenantId: "tenant-a", operatorId: "100" };
let db: FakeFirestore;
let repo: FirestorePlatformRepository;

function connection(tenantId: string, id: string, credentialId: string): Connection {
  return {
    id, tenantId, operatorId: "100", subjectId: "100", metaAppUserId: "100", provider: "META_MARKETING", authStrategy: "facebook_business", credentialId, appId: "123",
    tokenType: "user", scopes: ["ads_read"], assetKeys: [], verifiedAt: Date.now(), expiresAt: null, revokedAt: null, revision: 1,
  };
}

async function seedCredential(tenantId: string, id: string): Promise<Credential> {
  const credential = encryptCredential({ id, tenantId, operatorId: "100", provider: "META_MARKETING", appId: "123", keyVersion: "primary" }, PLAINTEXT);
  await repo.put("credentials", tenantId, id, credential);
  await repo.put("connections", tenantId, `connection-${id}`, connection(tenantId, `connection-${id}`, id));
  return credential;
}

async function seedAdmin(tenantId: string, roles = ["admin"]): Promise<void> {
  await repo.put("members", tenantId, "100", { operatorId: "100", tenantId, roles, allowedClientIds: [], revision: 1, disabledAt: null });
}

beforeEach(() => {
  useKeyEnv(ENVS.k1PlusNext);
  db = new FakeFirestore();
  holder.db = db;
  repo = new FirestorePlatformRepository(db as never);
});
afterEach(() => restoreKeyEnv());

describe("runtime compatibility diagnostic safety properties", () => {
  it("performs no write of any kind and returns no plaintext, ciphertext or key material", async () => {
    await seedAdmin("tenant-a");
    const credential = await seedCredential("tenant-a", "credential-1");
    db.writeLog.length = 0;

    const result = await inspectRuntimeCompatibility(repo, principalA);
    expect(db.writeLog).toEqual([]);
    expect(result.status).toBe("PASS");
    expect(result.encryption).toMatchObject({ credential_records_inspected: 1, successful_in_memory_decryptions: 1, database_writes_performed: 0, active_key_id: "next", required_key_versions: ["next"] });
    const text = JSON.stringify(result);
    for (const forbidden of [PLAINTEXT, credential.payload.ciphertext, credential.payload.iv, credential.payload.tag, hex(K1), hex(K2), K1.toString("base64"), K2.toString("base64")]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("reports only key ids, never fingerprints", async () => {
    await seedAdmin("tenant-a");
    const result = await inspectRuntimeCompatibility(repo, principalA);
    expect(result.encryption.configured_key_ids).toEqual(["next", "primary"]);
    expect(JSON.stringify(result)).not.toMatch(/fingerprint/i);
  });

  it("only inspects the calling administrator's tenant", async () => {
    await seedAdmin("tenant-a");
    await seedCredential("tenant-a", "credential-a");
    await seedCredential("tenant-b", "credential-b");
    const result = await inspectRuntimeCompatibility(repo, principalA);
    expect(result.encryption.credential_records_inspected).toBe(1);
  });

  it("refuses non-administrators, disabled administrators and other tenants' members without reading credentials", async () => {
    await seedCredential("tenant-a", "credential-a");
    await repo.put("members", "tenant-a", "100", { operatorId: "100", tenantId: "tenant-a", roles: ["connection_admin", "approver", "writer"], allowedClientIds: [], revision: 1, disabledAt: null });
    await expect(inspectRuntimeCompatibility(repo, principalA)).rejects.toMatchObject({ reason: "RUNTIME_DIAGNOSTICS_ADMIN_REQUIRED" });
    await repo.put("members", "tenant-a", "100", { operatorId: "100", tenantId: "tenant-a", roles: ["admin"], allowedClientIds: [], revision: 2, disabledAt: Date.now() });
    await expect(inspectRuntimeCompatibility(repo, principalA)).rejects.toMatchObject({ reason: "RUNTIME_DIAGNOSTICS_ADMIN_REQUIRED" });
    await expect(inspectRuntimeCompatibility(repo, { tenantId: "tenant-b", operatorId: "100" })).rejects.toMatchObject({ reason: "RUNTIME_DIAGNOSTICS_ADMIN_REQUIRED" });
  });

  it("holds with a bounded reason instead of reading an unbounded number of connections", async () => {
    await seedAdmin("tenant-a");
    for (let index = 0; index < 101; index++) await repo.put("connections", "tenant-a", `connection-${index}`, connection("tenant-a", `connection-${index}`, `missing-${index}`));
    await expect(inspectRuntimeCompatibility(repo, principalA)).rejects.toMatchObject({ reason: "RUNTIME_DIAGNOSTICS_BOUND_REQUIRED" });
  });

  it("classifies undecryptable and unsupported records as bounded reason codes", async () => {
    await seedAdmin("tenant-a");
    const good = await seedCredential("tenant-a", "credential-good");
    await repo.put("credentials", "tenant-a", "credential-tampered", { ...good, id: "credential-tampered", payload: { ...good.payload, tag: Buffer.alloc(16).toString("base64") } });
    await repo.put("connections", "tenant-a", "connection-tampered", connection("tenant-a", "connection-tampered", "credential-tampered"));
    await repo.put("credentials", "tenant-a", "credential-future", { ...good, id: "credential-future", envelopeVersion: 2 as never });
    await repo.put("connections", "tenant-a", "connection-future", connection("tenant-a", "connection-future", "credential-future"));
    const result = await inspectRuntimeCompatibility(repo, principalA);
    expect(result.status).toBe("HOLD");
    expect(result.encryption.failure_reasons.sort()).toEqual(["CREDENTIAL_DECRYPTION_FAILED", "CREDENTIAL_VERSION_UNSUPPORTED"]);
    expect(result.encryption.successful_in_memory_decryptions).toBe(1);
    expect(JSON.stringify(result)).not.toContain("credential-tampered");
  });

  it("does not inspect the legacy per-user token collections (documented gap)", async () => {
    await seedAdmin("tenant-a");
    db.seed("users/synthetic/meta_tokens/personal", { encryptedToken: { ciphertext: "x", iv: "y", tag: "z" } });
    const result = await inspectRuntimeCompatibility(repo, principalA);
    expect(result.encryption.credential_records_inspected).toBe(0);
    expect(result.rollback.compatibility_proven_by_runtime).toBe(false);
  });
});
