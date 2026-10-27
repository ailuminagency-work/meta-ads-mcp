import { Firestore } from "@google-cloud/firestore";
import { logger } from "../utils/logger.js";

let cachedClient: Firestore | undefined;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

export interface FirestoreRuntimeIdentity {
  configuredProjectId: string | null;
  credentialProjectId: string | null;
  serviceAccountEmail: string | null;
  databaseId: string;
  emulator: boolean;
}

/** Return only non-secret runtime identity metadata for authenticated diagnostics. */
export function getFirestoreRuntimeIdentity(): FirestoreRuntimeIdentity {
  const configuredProjectId = process.env.FIRESTORE_PROJECT_ID?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || null;
  const raw = process.env.GOOGLE_CREDENTIALS_JSON?.trim();
  let credentialProjectId: string | null = null;
  let serviceAccountEmail: string | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      credentialProjectId = typeof parsed.project_id === "string" ? parsed.project_id : null;
      serviceAccountEmail = typeof parsed.client_email === "string" ? parsed.client_email : null;
    } catch {
      throw new Error("GOOGLE_CREDENTIALS_JSON is not valid credential JSON");
    }
  }
  const firestore = getFirestore();
  return {
    configuredProjectId,
    credentialProjectId,
    serviceAccountEmail,
    databaseId: firestore.databaseId,
    emulator: !!process.env.FIRESTORE_EMULATOR_HOST,
  };
}

function getServiceAccountCredentials(): ServiceAccountCredentials | undefined {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON?.trim();
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      throw new Error("missing required fields");
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  } catch {
    throw new Error("GOOGLE_CREDENTIALS_JSON is not valid service-account JSON");
  }
}

export function getFirestore(): Firestore {
  if (cachedClient) return cachedClient;

  const projectId =
    process.env.FIRESTORE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const credentials = getServiceAccountCredentials();

  cachedClient = new Firestore({
    ...(projectId ? { projectId } : {}),
    ...(credentials ? { credentials } : {}),
    ignoreUndefinedProperties: true,
  });
  logger.info(
    { projectId: projectId ?? "(adc)", emulator: process.env.FIRESTORE_EMULATOR_HOST ?? null },
    "Firestore client initialized",
  );

  return cachedClient;
}

export function isFirestoreEnabled(): boolean {
  return (
    !!process.env.FIRESTORE_PROJECT_ID ||
    !!process.env.GOOGLE_CLOUD_PROJECT ||
    !!process.env.GOOGLE_CREDENTIALS_JSON ||
    !!process.env.FIRESTORE_EMULATOR_HOST
  );
}

export function resetFirestoreForTests(): void {
  cachedClient = undefined;
}
