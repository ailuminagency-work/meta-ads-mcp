import { inspectEncryptedCorpusForRetirement } from "./encrypted-corpus-retirement.js";
import { createBoundMigrationFirestore } from "./migration-firestore-binding.js";
import { assertMigrationKeyringSource } from "./migration-keyring-source.js";

async function main(): Promise<void> {
  assertMigrationKeyringSource();
  const db = createBoundMigrationFirestore();
  try {
    const report = await inspectEncryptedCorpusForRetirement(db);
    console.log(JSON.stringify(report));
    if (report.verdict !== "PASS") process.exitCode = 2;
  } finally {
    await db.terminate();
  }
}

main().catch(() => {
  console.error("ENCRYPTED_CORPUS_RETIREMENT_INVENTORY_UNAVAILABLE");
  process.exitCode = 1;
});
