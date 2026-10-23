import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Firestore } from "@google-cloud/firestore";
import { createBoundMigrationFirestore } from "./migration-firestore-binding.js";
import { parseKeyringEnv, type EncryptionKeyring } from "./keyring.js";
import { assertMigrationFirestoreBinding } from "./migration-firestore-binding.js";
import { assertMigrationKeyringSource } from "./migration-keyring-source.js";
import {
  runPlatformCredentialKeyMigration,
  verifyPlatformCredentialKeyMigration,
  type PlatformCredentialMigrationReport,
} from "./platform-credential-key-migration.js";

type Mode = "dry-run" | "verify" | "apply";
type CliOptions = { mode: Mode; operationId?: string };

export function parsePlatformCredentialMigrationArgs(args: string[]): CliOptions {
  let verify = false;
  let apply = false;
  let operationId: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--verify" && !verify) verify = true;
    else if (arg === "--apply" && !apply) apply = true;
    else if (arg === "--operation-id" && operationId === undefined) operationId = args[++index];
    else throw new Error("MIGRATION_ARGUMENTS_INVALID");
  }
  if (verify && apply ||
      operationId !== undefined && !apply ||
      apply && (!operationId || !/^[A-Za-z0-9_-]{8,80}$/.test(operationId))) {
    throw new Error("MIGRATION_ARGUMENTS_INVALID");
  }
  return { mode: apply ? "apply" : verify ? "verify" : "dry-run", operationId };
}

export async function runPlatformCredentialMigrationCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  dependencies: {
    getDb?: () => Firestore;
    getKeyring?: (env: NodeJS.ProcessEnv) => EncryptionKeyring;
  } = {},
): Promise<{ mode: Mode; report: PlatformCredentialMigrationReport }> {
  const options = parsePlatformCredentialMigrationArgs(args);
  assertMigrationFirestoreBinding(env);
  assertMigrationKeyringSource(env);
  const keyring = (dependencies.getKeyring ?? parseKeyringEnv)(env);
  if (keyring.activeKeyId === "ephemeral" || keyring.keys.size === 0) {
    throw new Error("MIGRATION_DURABLE_KEY_REQUIRED");
  }
  if (options.mode === "apply" && (keyring.activeKeyId === "primary" || keyring.keys.size < 2)) {
    throw new Error("MIGRATION_ROTATION_KEYRING_REQUIRED");
  }

  const db = (dependencies.getDb ?? (() => createBoundMigrationFirestore(env)))();
  try {
    const report = options.mode === "verify"
      ? await verifyPlatformCredentialKeyMigration(db, keyring)
      : await runPlatformCredentialKeyMigration({ db, keyring, dryRun: options.mode !== "apply", operationId: options.operationId });
    return { mode: options.mode, report };
  } finally {
    await db.terminate();
  }
}

function diagnosticCode(error: unknown): string {
  if (error instanceof Error && /^MIGRATION_[A-Z_]+$/.test(error.message)) return error.message;
  return "PLATFORM_CREDENTIAL_MIGRATION_FAILED";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPlatformCredentialMigrationCli(process.argv.slice(2))
    .then(({ mode, report }) => {
      console.log(JSON.stringify({ mode, report }));
      if (report.failed > 0) process.exitCode = 2;
    })
    .catch((error: unknown) => {
      console.error(diagnosticCode(error));
      process.exitCode = 1;
    });
}
