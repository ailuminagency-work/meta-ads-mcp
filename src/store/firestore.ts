import { Firestore } from "@google-cloud/firestore";
import { logger } from "../utils/logger.js";

let cachedClient: Firestore | undefined;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
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
