import { assertMigrationFirestoreBinding, createBoundMigrationFirestore } from "./migration-firestore-binding.js";
import { assertMigrationKeyringSource } from "./migration-keyring-source.js";
import {
  getMigrationKeyringStatus,
  runTokenKeyMigration,
  verifyTokenKeyMigration,
} from "./token-key-migration.js";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function valueAfter(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  assertMigrationFirestoreBinding();
  assertMigrationKeyringSource();
  const verify = hasFlag("--verify");
  const apply = hasFlag("--apply");
  const dryRun = !apply && !verify;
  const operationId = valueAfter("--operation-id");
  const maxFailuresRaw = valueAfter("--max-failures");
  const maxFailures = maxFailuresRaw ? Number.parseInt(maxFailuresRaw, 10) : undefined;
  if (maxFailures !== undefined && (!Number.isInteger(maxFailures) || maxFailures < 1)) {
    throw new Error("--max-failures must be a positive integer");
  }

  console.log(JSON.stringify({
    mode: verify ? "verify" : dryRun ? "dry-run" : "apply",
    keyring: getMigrationKeyringStatus(),
    operationId: operationId ?? null,
  }));

  const db = createBoundMigrationFirestore();
  try {
    const report = verify
      ? await verifyTokenKeyMigration(db)
      : await runTokenKeyMigration({
          db,
          dryRun,
          operationId,
          resume: hasFlag("--resume"),
          maxFailures,
        });
    console.log(JSON.stringify(report, null, 2));
    if (report.failed > 0) process.exitCode = 2;
  } finally {
    await db.terminate();
  }
}

main().catch(() => {
  // Provider and credential-loader errors can contain sensitive metadata.
  // The report carries bounded record-level diagnostic categories instead.
  console.error("TOKEN_KEY_MIGRATION_FAILED");
  process.exitCode = 1;
});
