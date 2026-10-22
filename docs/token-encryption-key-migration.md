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

Run these from the immutable reviewed commit with the intended Firestore project selected by the provider environment:

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
