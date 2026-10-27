#!/usr/bin/env node
// `npm run migrate:token-encryption` must never reach Firestore through a
// weaker path than the reviewed CLI: it validates the arguments, then hands over
// to the CLI that enforces the exact staging project/service-account binding and
// the single key source before any client is constructed.

const FLAGS_WITH_VALUE = new Set(["--operation-id", "--max-failures"]);
const FLAGS = new Set(["--apply", "--verify", "--resume"]);

function invalidArguments(): never {
  console.error("MIGRATION_ARGUMENTS_INVALID");
  process.exit(1);
}

function validateArguments(args: string[]): void {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) invalidArguments();
    seen.add(arg);
    if (FLAGS.has(arg)) continue;
    if (!FLAGS_WITH_VALUE.has(arg)) invalidArguments();
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) invalidArguments();
    values.set(arg, value);
  }
  const apply = seen.has("--apply");
  if (apply && seen.has("--verify")) invalidArguments();
  if (!apply && (seen.has("--operation-id") || seen.has("--resume"))) invalidArguments();
  if (apply && !/^[A-Za-z0-9_-]{8,80}$/.test(values.get("--operation-id") ?? "")) invalidArguments();
  const maxFailures = values.get("--max-failures");
  if (maxFailures !== undefined && !/^[1-9]\d{0,5}$/.test(maxFailures)) invalidArguments();
}

validateArguments(process.argv.slice(2));
await import("../src/auth/token-key-migration-cli.js");
