#!/usr/bin/env bash
# release-preflight-keys.sh - read-only encryption-key pre-flight for the production cutover.
#
# Why it exists: the release line makes the NEXT key the ACTIVE one as soon as
# TOKEN_ENCRYPTION_KEY_NEXT is set (src/auth/keyring.ts), and the production
# variable names already include it. Every login, token refresh and Apify/Gemini
# key registration would then be written under a key that main@251249e cannot
# read, so a rollback would force affected operators to log in again. The safe
# shape is a JSON keyring whose activeKeyId is "primary" (the same value as the
# unchanged TOKEN_ENCRYPTION_KEY), which still READS records stored under any
# other key id. See docs/release/rollback-plan.md section 5.1.
#
# What it does: inspects ONLY the environment of the process it runs in and says,
# without printing any value, key id or fingerprint:
#   - whether each TOKEN_ENCRYPTION_* variable is set,
#   - whether the release line would accept the keyring (same rules as keyring.ts),
#   - whether the parsed active key id is "primary",
#   - whether the active key is the one main@251249e reads (TOKEN_ENCRYPTION_KEY).
# It reads no file, writes nothing, makes no network call and contacts no provider.
# Run it in a fresh shell that carries exactly the variables you intend to deploy
# (for example the platform's run-with-variables command, or values read with
# `read -rs` into a clean `env -i` shell). Variables left over in your own shell
# will be reported as if they were the deployment's.
#
# Exit status: 0 only when every check passed (PASS). 1 when a check failed. 2 for
# usage errors or when node is missing.
#
# Usage: scripts/release-preflight-keys.sh [-h|--help]

set -uo pipefail

usage() {
  sed -n '2,/^# Usage:/p' "$0" | sed 's/^# \{0,1\}//'
}

[ $# -le 1 ] || { echo "unexpected extra arguments" >&2; usage >&2; exit 2; }
case "${1-}" in
  "") ;;
  -h|--help) usage; exit 0 ;;
  *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
esac

command -v node >/dev/null 2>&1 || { echo "node is required to parse the keyring" >&2; exit 2; }

exec node - <<'NODE'
"use strict";

const env = process.env;
const PRIMARY = "primary";
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const HEX64 = /^[0-9a-fA-F]{64}$/;

const VARIABLES = [
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_KEY_ID",
  "TOKEN_ENCRYPTION_KEY_NEXT",
  "TOKEN_ENCRYPTION_KEY_NEXT_ID",
  "TOKEN_ENCRYPTION_KEY_PREVIOUS",
  "TOKEN_ENCRYPTION_KEY_PREVIOUS_ID",
  "TOKEN_ENCRYPTION_KEYRING_JSON",
];

const text = (name) => (typeof env[name] === "string" ? env[name].trim() : "");
const state = (name) => {
  if (typeof env[name] !== "string") return "unset";
  return env[name].trim() === "" ? "empty (treated as unset)" : "set";
};

function buildKeyring() {
  const problems = [];
  const entries = new Map();
  const jsonRaw = text("TOKEN_ENCRYPTION_KEYRING_JSON");

  if (jsonRaw) {
    let parsed;
    try {
      parsed = JSON.parse(jsonRaw);
    } catch {
      problems.push("TOKEN_ENCRYPTION_KEYRING_JSON is not valid JSON");
      return { source: "json", entries, activeId: null, problems };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      problems.push("TOKEN_ENCRYPTION_KEYRING_JSON is not a JSON object");
      return { source: "json", entries, activeId: null, problems };
    }
    if (typeof parsed.activeKeyId !== "string" || typeof parsed.keys !== "object" || parsed.keys === null || Array.isArray(parsed.keys)) {
      problems.push("TOKEN_ENCRYPTION_KEYRING_JSON needs a string activeKeyId and an object keys");
      return { source: "json", entries, activeId: null, problems };
    }
    let badIds = 0;
    let badKeys = 0;
    for (const [id, raw] of Object.entries(parsed.keys)) {
      if (!KEY_ID.test(id)) { badIds += 1; continue; }
      if (typeof raw !== "string" || !HEX64.test(raw.trim())) { badKeys += 1; continue; }
      entries.set(id, raw.trim().toLowerCase());
    }
    if (badIds > 0) problems.push(`${badIds} key id(s) in keys are not valid ids`);
    if (badKeys > 0) problems.push(`${badKeys} key value(s) in keys are not 64 hex characters`);
    if (!KEY_ID.test(parsed.activeKeyId)) {
      problems.push("activeKeyId is not a valid key id");
    } else if (!entries.has(parsed.activeKeyId)) {
      problems.push("activeKeyId is not present in keys");
    }
    const activeId = problems.length === 0 ? parsed.activeKeyId : null;
    return { source: "json", entries, activeId, problems };
  }

  const current = text("TOKEN_ENCRYPTION_KEY");
  const next = text("TOKEN_ENCRYPTION_KEY_NEXT");
  const previous = text("TOKEN_ENCRYPTION_KEY_PREVIOUS");
  const currentId = text("TOKEN_ENCRYPTION_KEY_ID") || PRIMARY;
  const nextId = text("TOKEN_ENCRYPTION_KEY_NEXT_ID") || "next";
  const previousId = text("TOKEN_ENCRYPTION_KEY_PREVIOUS_ID") || "previous";

  const add = (id, raw, label) => {
    if (!KEY_ID.test(id)) { problems.push(`the key id used for ${label} is not a valid id`); return; }
    if (!HEX64.test(raw)) { problems.push(`${label} is not 64 hex characters`); return; }
    entries.set(id, raw.toLowerCase());
  };
  if (current) add(currentId, current, "TOKEN_ENCRYPTION_KEY");
  if (previous) add(previousId, previous, "TOKEN_ENCRYPTION_KEY_PREVIOUS");
  if (next) {
    if (KEY_ID.test(nextId) && entries.has(nextId)) {
      problems.push("TOKEN_ENCRYPTION_KEY_NEXT uses a key id that another key already has");
    } else {
      add(nextId, next, "TOKEN_ENCRYPTION_KEY_NEXT");
    }
  }
  if (entries.size === 0 && problems.length === 0) problems.push("no encryption key is configured");

  const activeId = next ? nextId : currentId;
  if (problems.length === 0 && !entries.has(activeId)) problems.push("the active key is not present in the keyring");
  return { source: "split", entries, activeId: problems.length === 0 ? activeId : null, problems };
}

function main() {
  const out = (line) => process.stdout.write(`${line}\n`);
  const warnings = [];
  const checks = [];

  out("ENCRYPTION KEY PRE-FLIGHT (read-only; no value, key id or fingerprint is printed)");
  out("scope   : the environment of this process only; no file is read, nothing is written");
  out("");
  out("variable".padEnd(34) + "state");
  for (const name of VARIABLES) out(name.padEnd(34) + state(name));
  out("");

  const keyring = buildKeyring();
  const jsonSet = keyring.source === "json";
  out("keyring source".padEnd(34) + (jsonSet
    ? "TOKEN_ENCRYPTION_KEYRING_JSON (the split variables are ignored by the application while it is set)"
    : "split variables"));

  const mainKey = text("TOKEN_ENCRYPTION_KEY");
  const mainKeyOk = HEX64.test(mainKey);
  const parsedOk = keyring.problems.length === 0;

  checks.push({
    name: "TOKEN_ENCRYPTION_KEY is set and 64 hex characters (main@251249e reads only this)",
    ok: mainKeyOk,
    detail: mainKeyOk ? "" : "set it to the unchanged production value; rollback depends on it",
  });
  checks.push({
    name: "the release line accepts the keyring",
    ok: parsedOk,
    detail: parsedOk ? `${keyring.entries.size} key id(s) available for reads` : keyring.problems.join("; "),
  });

  if (parsedOk) {
    const activeIsPrimary = keyring.activeId === PRIMARY;
    let reason = "";
    if (!activeIsPrimary) {
      if (jsonSet) reason = "activeKeyId in TOKEN_ENCRYPTION_KEYRING_JSON is not primary";
      else if (text("TOKEN_ENCRYPTION_KEY_NEXT")) reason = "TOKEN_ENCRYPTION_KEY_NEXT is set, so the NEXT key becomes the active key and every new write goes under it";
      else reason = "TOKEN_ENCRYPTION_KEY_ID is not primary";
    }
    checks.push({ name: "active encryption key id is primary", ok: activeIsPrimary, detail: reason });

    const activeValue = keyring.entries.get(keyring.activeId);
    const sameKey = mainKeyOk && activeValue === mainKey.toLowerCase();
    let sameDetail = "";
    if (!sameKey) {
      if (!mainKeyOk) sameDetail = "cannot compare: TOKEN_ENCRYPTION_KEY is missing or malformed";
      else if (!jsonSet && text("TOKEN_ENCRYPTION_KEY_NEXT")) sameDetail = "the active key is TOKEN_ENCRYPTION_KEY_NEXT, which main@251249e does not know";
      else sameDetail = "the active key differs from TOKEN_ENCRYPTION_KEY; records written now would be unreadable by main@251249e";
    }
    checks.push({ name: "the active key is the key main@251249e reads (TOKEN_ENCRYPTION_KEY)", ok: sameKey, detail: sameDetail });
  } else {
    checks.push({ name: "active encryption key id is primary", ok: false, detail: "not evaluated: the keyring is not valid" });
  }

  if (jsonSet) {
    for (const name of ["TOKEN_ENCRYPTION_KEY_NEXT", "TOKEN_ENCRYPTION_KEY_NEXT_ID", "TOKEN_ENCRYPTION_KEY_PREVIOUS", "TOKEN_ENCRYPTION_KEY_PREVIOUS_ID", "TOKEN_ENCRYPTION_KEY_ID"]) {
      if (text(name)) warnings.push(`${name} is set but ignored while TOKEN_ENCRYPTION_KEYRING_JSON is set; remove it so that removing the JSON later cannot silently change the active key`);
    }
  } else if (text("TOKEN_ENCRYPTION_KEY_NEXT_ID") && !text("TOKEN_ENCRYPTION_KEY_NEXT")) {
    warnings.push("TOKEN_ENCRYPTION_KEY_NEXT_ID is set without TOKEN_ENCRYPTION_KEY_NEXT and has no effect");
  }

  out("");
  for (const check of checks) {
    out(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
    if (check.detail) out(`      ${check.detail}`);
  }
  for (const warning of warnings) out(`WARN: ${warning}`);
  out("");

  const failed = checks.filter((check) => !check.ok).length;
  if (failed > 0) {
    out(`RESULT: FAIL - ${failed} check(s) failed. Do not cut over. See docs/release/rollback-plan.md section 5.1.`);
    return 1;
  }
  out("RESULT: PASS - the active key id is primary and it is the key main@251249e reads");
  return 0;
}

try {
  process.exitCode = main();
} catch {
  process.stdout.write("RESULT: FAIL - the pre-flight failed unexpectedly (nothing was printed from the environment)\n");
  process.exitCode = 1;
}
NODE
