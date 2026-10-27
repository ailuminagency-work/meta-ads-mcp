# Token encryption key migration

This repository uses AES-256-GCM for tenant Meta tokens, Apify tokens, and Gemini keys stored in Firestore. A key version is written into both the encrypted payload and the document metadata. The protected `lumin-google-mcp` project is not a migration target.

## Safety properties

- The default command is read-only dry run.
- The workflow reads `meta_tokens`, `apify_tokens`, and `gemini_keys` through Firestore collection-group queries and validates the expected `users/{fbUserId}/{collection}/{docId}` layout.
- Each applied record is re-read and updated inside a Firestore transaction. A per-operation ledger makes retries and restarts idempotent.
- The plaintext exists only in process memory and is never logged, placed in a command-line argument, or written to the ledger.
- The old key remains in the runtime keyring until verification is complete.
- `SESSION_COOKIE_SECRET`, `OAUTH_SECRET`, and `TOKEN_ENCRYPTION_KEY` are separate rotation decisions. This workflow does not rotate any of them by itself.

## Keyring configuration

The canonical secret is `TOKEN_ENCRYPTION_KEYRING_JSON`:

```json
{"activeKeyId":"next","keys":{"primary":"<64-hex-old-key>","next":"<64-hex-new-key>"}}
```

For a provider with sealed variables, use the split form without retrieving the old value:

- keep the existing sealed `TOKEN_ENCRYPTION_KEY` as the old `primary` key;
- add a newly generated `TOKEN_ENCRYPTION_KEY_NEXT` and, optionally, `TOKEN_ENCRYPTION_KEY_NEXT_ID`;
- the application uses `next` for new writes and keeps `primary` available for old records.

The new value must be generated in the provider's secure secret interface. Do not put a key in Git, a ticket, a shell history, or this chat.

## Commands

Run these from the immutable reviewed commit. The entry point validates its arguments (apply requires a reviewed operation id of 8 to 80 letters, digits, `_` or `-`) and then runs the staging-bound CLI, which refuses any Firestore project, service account or key source other than the explicitly bound staging identity before a client is built:

```bash
npm run migrate:token-encryption
npm run migrate:token-encryption -- --apply --operation-id <reviewed-id>
npm run migrate:token-encryption -- --apply --resume --operation-id <reviewed-id>
npm run migrate:token-encryption -- --verify
```

The first command performs inventory and decryptability checks only. It must report zero failures before an apply is approved. The apply command must be run once in staging first, with a reviewed operation ID, and its ledger and health checks must be retained. The verify command must report every target on the active key and zero failures.

## Rotation gate

Do not remove the old key until all of the following are true:

1. The dry run has zero failures and the inventory has been reviewed.
2. The staging apply has zero failures and a completed operation ledger.
3. Railway staging and Render standby pass `/health`, Firestore read access, and startup-log checks.
4. A second read-only verification pass reports zero records on the old key.
5. The rollback decision is documented: before revocation, restore the old key as active while retaining both keys; after revocation, rollback requires a new recovery plan.

Only after those checks may the old provider secret be revoked. Revocation is a separate approved action and is not performed by this repository command.

## Failure and recovery

If the apply stops, retain both keys, do not delete Firestore data, and resume the same operation ID. A failed record is identified only by a non-secret hash in the report. If a concurrent writer changes a record, the transaction retries against the newest snapshot; the new write path uses the active key.

The migration does not change OAuth grants, provider keys, session cookies, billing, deployments, DNS, or the protected Google MCP project.

## Switching between code lines (rollback and roll-forward)

The ciphertext, IV, tag and AAD formats are identical in `main` (251249e), the staging build (1f08563) and this release line. What differs is the key set. `main` knows exactly one key, `TOKEN_ENCRYPTION_KEY`, and ignores `TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEYRING_JSON` and every key id. This line writes with the active key and stamps its id (`keyVersion`) on the envelope and the document.

- **Setting `TOKEN_ENCRYPTION_KEY_NEXT` (or a JSON keyring whose `activeKeyId` is not `primary`) makes every later token write use the new key**: logins, token refreshes, Apify and Gemini key registration. `main` cannot decrypt those records and fails with `Unsupported state or unable to authenticate data`; one re-login rewrites the record under its own key. Until rolling back to `main` is no longer required, leave the new key unset so this line keeps writing under `primary`, which `main` reads (it ignores the extra `keyVersion` members).
- **Setting `TOKEN_ENCRYPTION_KEY_NEXT` (and optionally `TOKEN_ENCRYPTION_KEY_NEXT_ID`) is not a way to merely make a second key readable: in this line's keyring the next key becomes the ACTIVE key (`parseKeyringEnv` builds the keyring with `makeKeyring(next ? nextId : currentId, ...)`), so every login and refresh then writes under `next`, which production `main@251249e` cannot read.** `TOKEN_ENCRYPTION_KEY_NEXT_ID` on its own, without `TOKEN_ENCRYPTION_KEY_NEXT`, changes nothing. The safe way to keep reading `next` records while still writing under `primary` is `TOKEN_ENCRYPTION_KEYRING_JSON` with `activeKeyId` set to `primary` and both keys, for example `{"activeKeyId":"primary","keys":{"primary":"<old>","next":"<new>"}}`; the JSON keyring takes precedence over the split variables. Any environment that already carries `TOKEN_ENCRYPTION_KEY_NEXT` must have it removed or replaced by that JSON keyring before this line is started while a rollback to `main` is still possible. `tests/auth/keyring-active-key.test.ts` pins this behaviour.
- Never remove or rename a key id that stored records carry. A record labelled `next` needs a keyring that contains `next`, otherwise this line fails with `Encryption key version is not available: next`.
- Moving from `main` to this line needs no action: records without a `keyVersion` are tried against every key in the keyring.
- Rolling back after records were written under another key:
  1. If every record is on one key, start `main` with that key's value as `TOKEN_ENCRYPTION_KEY`.
  2. If the corpus is mixed (a partial or failed migration, or logins after the new key was added), first run the reverse migration on this line with `{"activeKeyId":"primary","keys":{"primary":"<old>","next":"<new>"}}` and `--apply --operation-id <new-id>`, require `--verify` to report zero failures, and only then start `main` with the old key as `TOKEN_ENCRYPTION_KEY`.
  3. Platform credentials (`platform_v1/.../credentials`) are not read by `main`; they stay encrypted under the key that wrote them, so every key id must be retained for any later return to this line.
- Without the key a record was written under, rollback cannot succeed and the only repair is a fresh login for the affected users.
- `inspectLegacyTokenCensus` (`src/store/legacy-token-census.ts`) reports, without any identifier or value, which key id decrypts each legacy record and how many records a single-key runtime cannot read.

## Legacy tokens without identity binding (`TOKEN_DECRYPT_ALLOW_LEGACY_NO_AAD`)

Meta tokens are sealed with the owner and token name as associated data (AAD), so a ciphertext copied to another user's record fails to decrypt. Records written before that binding existed carry no AAD, and the token store retries without AAD when the bound read fails. That retry is also the only way a ciphertext moved between users can still be read, so it is now an explicit setting instead of a permanent behaviour:

- `TOKEN_DECRYPT_ALLOW_LEGACY_NO_AAD` unset or `true` (the default) keeps the retry, so data written by older releases keeps working. The server logs one count-free warning at startup while it is on.
- `false` refuses the retry: a record that is not bound to its owner and name is not served. Identity-bound records are unaffected. Any other value stops startup with a configuration error, and a read under such a value fails closed.
- The migration (`npm run migrate:token-encryption`) keeps its own explicit legacy read and re-encrypts those records with the binding; it does not depend on this setting. A user's next login or token refresh also rewrites a record with the binding. Apify and Gemini keys have no such retry.

To turn the retry off safely:

1. Run the census over the whole legacy corpus (`inspectLegacyTokenCensus(db, keyring, { kind: "all" })`, read-only, counts only; the runtime diagnostic's `legacy_tokens` covers only the signed-in administrator's own records) and read `collections.meta_tokens.aadLegacy`. The result is conclusive only when `truncated` is `false`; otherwise raise the limit or run it per user.
2. While it is above zero, run the migration (dry run first, then `--apply` with a reviewed operation id) or let the affected users sign in again, then repeat the census.
3. When it reports 0, set `TOKEN_DECRYPT_ALLOW_LEGACY_NO_AAD=false`, redeploy, and confirm a normal sign-in and an MCP call still work.
4. If a legacy record turns up afterwards, set the variable back to `true` until it has been migrated; nothing is lost by switching it.
