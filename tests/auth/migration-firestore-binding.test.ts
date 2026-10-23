import { describe, expect, it, vi } from "vitest";
import { assertMigrationFirestoreBinding, createBoundMigrationFirestore } from "../../src/auth/migration-firestore-binding.js";

const env = () => ({
  FIRESTORE_PROJECT_ID: "lumin-meta-platform-staging",
  LUMIN_EXPECTED_FIRESTORE_PROJECT_ID: "lumin-meta-platform-staging",
  LUMIN_EXPECTED_GOOGLE_SERVICE_ACCOUNT: "lumin-meta-staging-runtime@lumin-meta-platform-staging.iam.gserviceaccount.com",
  GOOGLE_CREDENTIALS_JSON: JSON.stringify({
    type: "service_account", project_id: "lumin-meta-platform-staging",
    client_email: "lumin-meta-staging-runtime@lumin-meta-platform-staging.iam.gserviceaccount.com",
    private_key: "-----BEGIN " + "PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----",
  }),
});

describe("migration Firestore binding", () => {
  it("accepts one exact explicit project and service account", () => {
    expect(() => assertMigrationFirestoreBinding(env())).not.toThrow();
  });
  it.each([
    { FIRESTORE_PROJECT_ID: "production" },
    { FIRESTORE_PROJECT_ID: "production", LUMIN_EXPECTED_FIRESTORE_PROJECT_ID: "production" },
    { LUMIN_EXPECTED_FIRESTORE_PROJECT_ID: "production" },
    { LUMIN_EXPECTED_GOOGLE_SERVICE_ACCOUNT: "other@lumin-meta-platform-staging.iam.gserviceaccount.com" },
    { GOOGLE_APPLICATION_CREDENTIALS: "C:/fallback.json" },
    { GOOGLE_CLOUD_PROJECT: "production" },
    { FIRESTORE_EMULATOR_HOST: "localhost:8080" },
    { GOOGLE_CREDENTIALS_JSON: "{}" },
    { GOOGLE_CREDENTIALS_JSON: JSON.stringify({ type: "external_account", project_id: "lumin-meta-platform-staging" }) },
  ])("rejects conflicting project, identity, or fallback source %#", change => {
    expect(() => assertMigrationFirestoreBinding({ ...env(), ...change })).toThrow();
  });
  it("rejects ADC when sealed credential is absent", () => {
    const candidate: NodeJS.ProcessEnv = { ...env() };
    delete candidate.GOOGLE_CREDENTIALS_JSON;
    expect(() => assertMigrationFirestoreBinding(candidate)).toThrow("MIGRATION_FIRESTORE_CREDENTIAL_REQUIRED");
  });
  it("rejects a self-consistent production project and service account", () => {
    const productionProject = "lumin-meta-production";
    const productionEmail = `runtime@${productionProject}.iam.gserviceaccount.com`;
    const candidate: NodeJS.ProcessEnv = {
      ...env(),
      FIRESTORE_PROJECT_ID: productionProject,
      LUMIN_EXPECTED_FIRESTORE_PROJECT_ID: productionProject,
      LUMIN_EXPECTED_GOOGLE_SERVICE_ACCOUNT: productionEmail,
      GOOGLE_CREDENTIALS_JSON: JSON.stringify({
        type: "service_account", project_id: productionProject, client_email: productionEmail,
        private_key: "-----BEGIN " + "PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----",
      }),
    };
    expect(() => assertMigrationFirestoreBinding(candidate)).toThrow("MIGRATION_FIRESTORE_BINDING_REQUIRED");
  });
  it("constructs from the validated staging environment, ignoring ambient process identity", async () => {
    vi.stubEnv("FIRESTORE_PROJECT_ID", "unrelated-production");
    try {
      const db = createBoundMigrationFirestore(env());
      expect((db as unknown as { _projectId: string })._projectId).toBe("lumin-meta-platform-staging");
      await db.terminate();
    } finally { vi.unstubAllEnvs(); }
  });
});
