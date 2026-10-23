import type { Firestore } from "@google-cloud/firestore";
import { describe, expect, it, vi } from "vitest";
import type { EncryptionKeyring } from "../../src/auth/keyring.js";
import { parsePlatformCredentialMigrationArgs, runPlatformCredentialMigrationCli } from "../../src/auth/platform-credential-key-migration-cli.js";

const env = {
  FIRESTORE_PROJECT_ID: "lumin-meta-platform-staging",
  LUMIN_EXPECTED_FIRESTORE_PROJECT_ID: "lumin-meta-platform-staging",
  LUMIN_EXPECTED_GOOGLE_SERVICE_ACCOUNT: "lumin-meta-staging-runtime@lumin-meta-platform-staging.iam.gserviceaccount.com",
  GOOGLE_CREDENTIALS_JSON: JSON.stringify({ type: "service_account", project_id: "lumin-meta-platform-staging",
    client_email: "lumin-meta-staging-runtime@lumin-meta-platform-staging.iam.gserviceaccount.com", private_key: "BEGIN PRIVATE KEY synthetic" }),
};
const keyring: EncryptionKeyring = { activeKeyId: "next", keys: new Map([ ["primary", Buffer.alloc(32, 1)], ["next", Buffer.alloc(32, 2)] ]) };

function emptyDb() {
  const terminate = vi.fn(async () => {});
  const db = { collectionGroup: () => ({ get: async () => ({ docs: [] }) }), terminate } as unknown as Firestore;
  return { db, terminate };
}

describe("platform credential migration CLI", () => {
  it("defaults to a read-only dry-run and supports active-key verification", async () => {
    const { db, terminate } = emptyDb();
    const getDb = vi.fn(() => db);
    const dependencies = { getDb, getKeyring: () => keyring };
    const dry = await runPlatformCredentialMigrationCli([], env, dependencies);
    expect(dry).toMatchObject({ mode: "dry-run", report: { dryRun: true, total: 0, failed: 0 } });
    const verified = await runPlatformCredentialMigrationCli(["--verify"], env, dependencies);
    expect(verified).toMatchObject({ mode: "verify", report: { dryRun: true, total: 0, failed: 0 } });
    expect(terminate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["--apply"], ["--verify", "--apply"], ["--operation-id", "operation-1"],
    ["--apply", "--operation-id", "short"], ["--apply", "--operation-id", "operation-1", "operation-1"],
    ["--verify", "--verify"], ["--unknown"],
  ])("rejects ambiguous or unapproved arguments: %j", (...args) => {
    expect(() => parsePlatformCredentialMigrationArgs(args)).toThrow("MIGRATION_ARGUMENTS_INVALID");
  });

  it("requires exact staging binding before opening a Firestore connection", async () => {
    const getDb = vi.fn();
    await expect(runPlatformCredentialMigrationCli([], { ...env, FIRESTORE_PROJECT_ID: "production" },
      { getDb, getKeyring: () => keyring })).rejects.toThrow("MIGRATION_FIRESTORE_BINDING_REQUIRED");
    await expect(runPlatformCredentialMigrationCli([], { ...env, GOOGLE_APPLICATION_CREDENTIALS: "other.json" },
      { getDb, getKeyring: () => keyring })).rejects.toThrow("MIGRATION_FIRESTORE_CREDENTIAL_SOURCE_CONFLICT");
    await expect(runPlatformCredentialMigrationCli([], { ...env, GOOGLE_CREDENTIALS_JSON: "invalid" },
      { getDb, getKeyring: () => keyring })).rejects.toThrow("MIGRATION_FIRESTORE_CREDENTIAL_INVALID");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("does not apply with an ephemeral, single-key, or conflicting key source", async () => {
    const getDb = vi.fn();
    const args = ["--apply", "--operation-id", "operation-123"];
    await expect(runPlatformCredentialMigrationCli(args, env, { getDb, getKeyring: () =>
      ({ activeKeyId: "primary", keys: new Map([["primary", Buffer.alloc(32, 1)]]) }) })).rejects.toThrow("MIGRATION_ROTATION_KEYRING_REQUIRED");
    await expect(runPlatformCredentialMigrationCli([], env, { getDb, getKeyring: () =>
      ({ activeKeyId: "ephemeral", keys: new Map([["ephemeral", Buffer.alloc(32, 1)]]) }) })).rejects.toThrow("MIGRATION_DURABLE_KEY_REQUIRED");
    await expect(runPlatformCredentialMigrationCli([], { ...env, TOKEN_ENCRYPTION_KEYRING_JSON: "{}", TOKEN_ENCRYPTION_KEY: "synthetic" },
      { getDb, getKeyring: () => keyring })).rejects.toThrow("MIGRATION_KEY_SOURCE_CONFLICT");
    expect(getDb).not.toHaveBeenCalled();
  });
});
