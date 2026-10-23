import { Firestore } from "@google-cloud/firestore";

/** Require an explicit, single staging identity before any migration can access Firestore. */
export function assertMigrationFirestoreBinding(env: NodeJS.ProcessEnv = process.env): void {
  const approvedProject = "lumin-meta-platform-staging";
  const approvedEmail = "lumin-meta-staging-runtime@lumin-meta-platform-staging.iam.gserviceaccount.com";
  const project = env.FIRESTORE_PROJECT_ID?.trim();
  const expectedProject = env.LUMIN_EXPECTED_FIRESTORE_PROJECT_ID?.trim();
  const expectedEmail = env.LUMIN_EXPECTED_GOOGLE_SERVICE_ACCOUNT?.trim();
  if (project !== approvedProject || expectedProject !== approvedProject || expectedEmail !== approvedEmail) {
    throw new Error("MIGRATION_FIRESTORE_BINDING_REQUIRED");
  }
  if (env.FIRESTORE_EMULATOR_HOST?.trim() || env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      (env.GOOGLE_CLOUD_PROJECT?.trim() && env.GOOGLE_CLOUD_PROJECT?.trim() !== project)) {
    throw new Error("MIGRATION_FIRESTORE_CREDENTIAL_SOURCE_CONFLICT");
  }
  const raw = env.GOOGLE_CREDENTIALS_JSON;
  if (!raw) throw new Error("MIGRATION_FIRESTORE_CREDENTIAL_REQUIRED");
  let credential: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    credential = value as Record<string, unknown>;
  } catch { throw new Error("MIGRATION_FIRESTORE_CREDENTIAL_INVALID"); }
  if (credential.type !== "service_account" || credential.project_id !== project ||
      credential.client_email !== expectedEmail ||
      typeof credential.private_key !== "string" || !credential.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("MIGRATION_FIRESTORE_CREDENTIAL_IDENTITY_MISMATCH");
  }
}

/** Construct a fresh client from the validated source; never reuse ambient ADC or a cached client. */
export function createBoundMigrationFirestore(env: NodeJS.ProcessEnv = process.env): Firestore {
  assertMigrationFirestoreBinding(env);
  const credential = JSON.parse(env.GOOGLE_CREDENTIALS_JSON!) as { client_email: string; private_key: string };
  return new Firestore({
    projectId: "lumin-meta-platform-staging",
    credentials: { client_email: credential.client_email, private_key: credential.private_key },
    ignoreUndefinedProperties: true,
  });
}
