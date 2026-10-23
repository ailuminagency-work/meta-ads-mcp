#!/usr/bin/env node
// This entry point is intentionally disabled. The former script accepted raw
// OLD_KEY and NEW_KEY values, rewrote only Meta tokens, and had no CAS ledger.
// Use the versioned, read-only-by-default TypeScript workflow instead.
console.error("This unsafe rotation entry point is disabled.");
console.error("Use: npm run migrate:token-encryption");
process.exit(2);
