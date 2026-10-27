# Rollback plan: release candidate to production deployment 9ee29ef9

Status: PROPOSAL. Nothing in this document has been executed, and no step may be run without the owner's separate approval. It changes no variable and no deployment. It states what can be shown from this repository; what only Railway can confirm is marked UNVERIFIED.

## 1. Target

| Item | Value | Source |
| --- | --- | --- |
| Rollback target | Railway production deployment `9ee29ef9` | Program ledger (Railway deployment list) |
| Code in that deployment | `main` at commit `251249ea91d32fb7cb8d3937ba3f938c547299e8` | Same |
| Deployed | 2026-10-26 23:56 UTC, status SUCCESS | Same |
| Mode | Agency, read-only OAuth | `docs/lumin-railway.md` |
| Source pin on the service | `bd4221b`, which is **not** the running code | Program ledger |

The service's configured source pin differs from the commit that is running. Any action that rebuilds from the service source (a plain redeploy-from-source, a push to the tracked branch while auto-deploy is on) would build the pin or the branch head, not `251249e`. The rollback must therefore reuse the existing deployment `9ee29ef9`, or build from an explicitly pinned `251249e`, and must never rely on whatever the source setting currently says.

Recommended before the release, by the owner: create a tag (for example `prod-9ee29ef9`) at `251249e` and push it, so the rollback source survives branch movement. This workstream cannot push.

## 2. When to roll back

Decide against these triggers during the observation window (`deployment-proposal.md`, step P9). The deploying owner makes the call; none of them is automatic.

- `/ready` is 503 for more than 5 minutes after the new deployment is active.
- Operators cannot complete the Meta login, or a previously working operator is sent back to login.
- Log lines `Unsupported state or unable to authenticate data` for users who were working before the deploy (see 5.1).
- Any provider write, activation or spend that nobody approved. In this case stop writes first (section 4, step 1), then roll back.
- Sustained 5xx or restart loops.

Do not roll back for an isolated tool error, a Meta throttle (that is the circuit breaker working) or a single `/ready` blip (the answer is cached for 5 seconds).

## 3. Before the release, so that rollback is possible

Record all of this before any production change. Record variable names and non-secret values only; never paste a secret into a ticket or chat.

1. The active deployment id (`9ee29ef9`), its commit, and the service source setting (branch, commit pin, auto-deploy on or off).
2. The production variable **names** present, and the value of the non-secret ones that this plan depends on: `DEPLOYMENT_MODE`, `AGENCY_WRITES_ENABLED`, `LUMIN_PLATFORM_ENABLED`, `LUMIN_PLATFORM_WRITES_ENABLED`, `VIDEO_MAX_CONCURRENT_JOBS`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, `NODE_OPTIONS`.
3. Whether any of `TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEYRING_JSON`, `TOKEN_ENCRYPTION_KEY_PREVIOUS`, `TOKEN_ENCRYPTION_KEY_ID`, `TOKEN_ENCRYPTION_KEY_NEXT_ID`, `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID` exists. The program ledger lists `TOKEN_ENCRYPTION_KEY_NEXT` as present on production. This is the single most important input to the data-compatibility analysis in section 5.1: with that variable set, deploying the release candidate unchanged makes `next` the active write key and makes a later rollback lossy. Run `scripts/release-preflight-keys.sh` in an environment that carries production's current variables (section 5.1) and keep its output; today it is expected to report FAIL on "active encryption key id is primary".
4. That deployment `9ee29ef9` is still offered by Railway as a rollback target (UNVERIFIED: how long Railway retains rollbackable deployments).
5. The count of documents in `platform_meta_privacy_subject_locks`, if the collection exists (a count, not contents). It is the input to 5.3.
6. The owner's confirmation of the 5.1 replacement (the JSON keyring staged, the split `TOKEN_ENCRYPTION_KEY_NEXT*` variables removed in the same change, the pre-flight reporting PASS), written down before the deploy, not during an incident.
7. The tool names returned by `tools/list` on deployment `9ee29ef9` for an authenticated operator (names only), so the post-rollback check in section 6 compares against a recorded list instead of a claim.

## 4. Procedure

Everything here is performed by the owner in the Railway dashboard (or by the owner's CLI session). Nothing is scripted from this repository.

1. **Stop writes, if writes were ever enabled.** Set `AGENCY_WRITES_ENABLED` to `false` (it is read at startup, so this takes effect with the rollback deployment; see step 5). If a write is in flight or ambiguous, do not retry it: reconcile by reading provider state (`docs/operations.md`: reconcile before any new approval).
2. **Prevent overlapping deploys.** Turn off automatic deploys for the service, or confirm that the tracked branch will not move, for the duration. Confirm no other deployment is building or initializing. A second deployment landing during a rollback is the most likely way to end up on an unintended build.
3. **Roll back.** Use Railway's rollback action on deployment `9ee29ef9`. Fallback if it is not offered: pin the service source to commit `251249ea91d32fb7cb8d3937ba3f938c547299e8` explicitly and deploy that one commit (this rebuilds, so it takes longer).
4. **Do not edit variables during the rollback** except those named in step 1 and section 5.1. Railway applies staged variable changes by deploying; batch them into the one rollback deployment instead of triggering a second one. UNVERIFIED: whether Railway's rollback restores the variables as they were when `9ee29ef9` ran or applies the current ones. Assume current, and compare against the section 3 record afterwards.
5. **Confirm what is running.** The active deployment id is `9ee29ef9` (or the pinned rebuild), its commit is `251249e`, and the deployment log shows a normal start with no `Failed to start server` line. Note that `251249e` predates the startup configuration line, `/ready` and the graceful-shutdown handler, so none of them will appear; that is expected.
6. **Verify** (section 6).
7. **Hold.** Leave automatic deploys off until the cause is understood and the owner approves rolling forward again.

### Draining on the rollback target

`251249e` has no SIGTERM handler (`installGracefulShutdown` does not exist in its `http.ts`). `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` only gives a process time to finish work if the process stops accepting and finishes it. The release candidate does; the rollback target does not. Rolling back therefore ends in-flight requests on the release candidate's replacement at once, whatever the draining setting is. Expect a brief error window and do not read it as a failed rollback.

## 5. Data compatibility

What the release candidate (`40ec828` lineage) writes, and whether `251249e` can still use it. Each statement below is from the code in this repository; see the cited file.

### 5.1 Encryption key selection (decides whether users must log in again)

**Critical fact: with `TOKEN_ENCRYPTION_KEY_NEXT` set, the release candidate writes under a key that the rollback target cannot read.**

- `251249e` encrypts and decrypts every stored Meta, Apify and Gemini credential with one key, the value of `TOKEN_ENCRYPTION_KEY` (`git show 251249e:src/auth/crypto.ts`). It cannot read a key ring and ignores every key id.
- The release candidate builds a key ring (`src/auth/keyring.ts`). Its active key, the one every new write uses, is chosen by `parseKeyringEnv()` as `makeKeyring(next ? nextId : currentId, ...)`: **whenever `TOKEN_ENCRYPTION_KEY_NEXT` is set, `next` is the active key.** A `TOKEN_ENCRYPTION_KEYRING_JSON` whose `activeKeyId` is not `primary` does the same. The old key stays available for reads only (`docs/token-encryption-key-migration.md`: "the application uses `next` for new writes and keeps `primary` available for old records").
- Production's variable **names** already include `TOKEN_ENCRYPTION_KEY_NEXT` (program ledger; names only were read, never values).
- The release candidate stamps `keyVersion` on each payload and token document (`src/auth/crypto.ts`, `src/store/meta-token-repo.ts`). `251249e` ignores the extra field.

Deploying the release candidate with that variable unchanged would therefore make every login, token refresh and Apify or Gemini key registration write under `next`. `251249e` fails to authenticate those records with `Unsupported state or unable to authenticate data`. **A rollback would be lossy: every operator whose credentials were written or refreshed during the release window has to log in again.** The data is not damaged and the `next` key must be kept.

| Stored credential was written by | Under key id | Read by `251249e` with the unchanged `TOKEN_ENCRYPTION_KEY` | Read by the release candidate |
| --- | --- | --- | --- |
| `251249e` | none (no `keyVersion`) | Yes | Yes, every key is tried, active key first, as long as the old key is still in the key ring |
| Release candidate | `primary` (same value as `TOKEN_ENCRYPTION_KEY`) | Yes | Yes |
| Release candidate | `next`, or any other id | **No**: exactly `Unsupported state or unable to authenticate data` | Yes, only while that id is in the key ring (otherwise `Encryption key version is not available: next`) |

These rows come from the data-and-encryption workstream's compatibility matrix (84 writer and reader combinations, `tests/auth/crypto-compat-matrix.test.ts`, and the stored-document tests in `tests/store/meta-token-repo-compat.test.ts`, present once that workstream is merged into the release line). They are test results against synthetic keys, not observations of production.

**Hypothesis about the earlier incident, not a finding.** The one decrypt failure seen on production, on the first request after it moved from the stack branch to `main`, is consistent with this mechanism: a line that wrote under `next`, then `main` reading with `TOKEN_ENCRYPTION_KEY`. It is also what a wrong or rotated `TOKEN_ENCRYPTION_KEY` would print, byte for byte. The production root cause is **UNVERIFIED**. The non-secret discriminator, for an affected operator's own `users/{id}/meta_tokens/*` document, is the `keyVersion` field (outer and inside `encryptedToken`): a value other than `primary` supports the `next` explanation; absent or `primary` with the same error points at a key value mismatch or corruption. Never open the ciphertext.

#### Required before cutover (names only; never write a value into a ticket, chat or shell history)

The OWNER, in the platform's secret interface, in the one staged change that also applies the source pin:

1. **Keep `TOKEN_ENCRYPTION_KEY` exactly as it is.** `251249e` reads only this, the release candidate's own security configuration requires it, and the rollback uses it unchanged.
2. **Add `TOKEN_ENCRYPTION_KEYRING_JSON`** with `activeKeyId` set to `primary` and `keys` holding two entries: `primary` = the current value of `TOKEN_ENCRYPTION_KEY`, and `next` = the value now stored in `TOKEN_ENCRYPTION_KEY_NEXT`. If `TOKEN_ENCRYPTION_KEY_NEXT_ID` exists on production, use that id in place of `next`; if `TOKEN_ENCRYPTION_KEY_PREVIOUS` exists, add it under `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID` (or `previous`). The ids must be exactly the ids stored records carry. The release candidate then still **reads** any record stored under `next` and **writes** under `primary`, which `251249e` can read.
3. **Remove** `TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEY_NEXT_ID`, `TOKEN_ENCRYPTION_KEY_PREVIOUS` and `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID` in that same change. While the JSON is set the application ignores them, but a leftover would silently become the active key if the JSON were ever removed.
4. **Run the pre-flight** (below). It must report `RESULT: PASS` before the deploy is started.

Rules that hold for the whole release window:

- Never remove or rename a key id that stored records carry. A record labelled `next` needs a key ring that contains `next`.
- Never delete, replace or rotate any encryption key as part of a rollback (`docs/staging-approval-plan.md`: key replacement "is a separately reviewed migration or reauthorization exercise, not a rollback shortcut"). Rotating to a new active key is a separate later exercise (`docs/token-encryption-key-migration.md`), started only after the rollback window has closed.
- Do not "just remove `TOKEN_ENCRYPTION_KEY_NEXT`" instead. That keeps writes under `primary`, but any record already stored under `next` then fails on the release candidate itself with `Encryption key version is not available: next`, with no rollback involved.
- Do not keep `TOKEN_ENCRYPTION_KEY_NEXT` as it is for a release that must stay rollbackable.

#### Pre-flight: `scripts/release-preflight-keys.sh`

Read-only. It inspects only the environment of the process it runs in, reads no file, writes nothing and calls nothing, and prints no value, key id or fingerprint. It reports which of `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_ID`, `TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEY_NEXT_ID`, `TOKEN_ENCRYPTION_KEY_PREVIOUS`, `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID` and `TOKEN_ENCRYPTION_KEYRING_JSON` are set, applies the same rules as `src/auth/keyring.ts` (a test compares it with that parser case by case), and checks three things: the key ring is acceptable, the parsed active key id is `primary`, and the active key is the key `251249e` reads (`TOKEN_ENCRYPTION_KEY`). Exit status 0 only when all pass.

Run it in a fresh shell that carries exactly the variables that will be live, for example through the platform's own run-with-variables command, or with values read by `read -rs` into a shell started with `env -i`. Variables left in your own shell are reported as if they were the deployment's.

| Environment it is run in | Expected |
| --- | --- |
| Production today (`TOKEN_ENCRYPTION_KEY` and `TOKEN_ENCRYPTION_KEY_NEXT` present) | `FAIL active encryption key id is primary`: the warning that the unchanged cutover would be lossy |
| The intended change (`TOKEN_ENCRYPTION_KEY` unchanged, `TOKEN_ENCRYPTION_KEYRING_JSON` as above, split variables removed) | `RESULT: PASS` |

A `PASS` proves the shape of the configuration. It does not prove that the `next` value is the key any stored record was written under, and it cannot see Firestore; that remains the owner's inventory (next paragraph).

#### Inventory and the mixed case

The read-only dry run of `npm run migrate:token-encryption` (`docs/token-encryption-key-migration.md`), or the legacy token census from the data-and-encryption workstream, reports which key each stored credential decrypts under without printing an identifier or a value. Run it by the owner from the pinned release commit before the cutover, to size how many operators a rollback could still affect. Nothing here has read production data, so that number is UNVERIFIED.

- Records already stored under `next` before the release (if any) were unreadable by `251249e` before the release and stay so after a rollback, until a login or token refresh on the release candidate rewrites them under `primary`. That is the status quo, not a cost of this release.
- If the stored corpus is mixed (a partial or failed migration, or logins made after a non-`primary` key became active), use the reverse migration described by the data-and-encryption workstream (section "Switching between code lines" of `docs/token-encryption-key-migration.md`, added when that workstream is merged): on the release candidate, with the key ring `{activeKeyId: "primary", keys: {primary: <old key>, next: <new key>}}`, run `--apply` with a new operation id, require `--verify` to report zero failures, and only then start `251249e` with the old key. **Caveat:** with the data-and-encryption workstream merged, `npm run migrate:token-encryption` is bound to the staging identity and refuses any other project, so a production reverse migration needs a separately reviewed binding change before it can be run. Until that exists, the only repair for a mixed production corpus is a fresh login for the affected operators.
- Platform credentials (`platform_*` collections) are not read by `251249e` at all; they stay under the key that wrote them, so every key id must be retained for any later return to the release candidate.

Decision record (section 3, item 6): the owner writes down that the replacement above was staged, that the pre-flight reported PASS, and which `TOKEN_ENCRYPTION_KEY_*` names existed before and after.

### 5.2 Platform collections written by the release candidate

`251249e` contains no `src/platform` code at all (zero files at that commit). The registry, grants, approvals, operation claims, audit records, webhook and worker state that the release candidate creates under `platform_*` collections are therefore ignored by the rollback target. They stay in Firestore and are valid again when the release candidate returns. Consequences:

- Do **not** restore an older Firestore export over them, delete them, or remove ambiguity claims, consumed approvals, locks or audit rows: `docs/staging-approval-plan.md` forbids it, because that would erase the evidence that stops a repeated provider write.
- Time-to-live policies keep running in Firestore regardless of which build is serving.
- Any platform operation that was UNKNOWN or ATTEMPTED at the moment of rollback stays that way; reconcile it from provider state after the release candidate is back, never by resending.

### 5.3 Privacy and revocation locks are not honoured by the rollback target

The release candidate refuses legacy personal writes for a subject that has a lock in `platform_meta_privacy_subject_locks` (`src/store/legacy-privacy-write.ts`, applied to token, Apify, Gemini, auth-code and JTI writes). `251249e` does not know that collection. If a user was erased or revoked while the release candidate ran, the rollback target would accept a fresh login and write that user's records again.

If the count recorded in section 3 item 5 is greater than zero, or any erasure or revocation happened during the release window, the owner must decide before rolling back whether to accept that, and record the decision. This is a compliance question, not a technical one, and it is the strongest reason to keep the release window short and read-only.

### 5.4 Sessions, authorization codes, client registrations

- `SESSION_COOKIE_SECRET` and `OAUTH_SECRET` are read by both builds; if neither is rotated, sessions and issued tokens remain valid across a rollback. Rotating either during a release logs everyone out and is not part of a rollback.
- The release candidate adds an optional `redirectUriRequired` field to stored authorization codes. `251249e` ignores it. Codes are short-lived; an operator in the middle of logging in at the moment of rollback may have to start again.
- Dynamic client registrations live in the same collection for both builds. The OAuth workstream (merged into the release line) adds a redirect URI policy that `/register` and the client lookup enforce, so a client stored earlier whose redirect URIs fail it is served as unknown and has to register again (`deployment-proposal.md`, operator actions). `251249e` has no such policy (its client store and `src/transport/authorize-validation.ts` only compare against the URIs stored at registration; `git grep` of `251249e` finds no policy and no allowlist variable), so after a rollback those clients are served again and the stricter check is gone until the release candidate returns.
- The OAuth workstream adds a per-user deny list (`AUTH_DENIED_FB_USER_IDS`), refresh-token reuse detection and re-checks of the allowlist at refresh. `251249e` has none of them (no occurrence of `AUTH_DENIED_FB_USER_IDS` in its source). A user denied during the release window can log in again on `251249e` unless that user is also removed from `AUTH_ALLOWED_FB_USER_IDS`, `AUTH_ALLOWED_EMAILS` or the domain allowlist before or at the rollback; the owner records who was denied and does that. The extra `rtfam:` and `rtrot:` documents the reuse detection writes into `mcp_refresh_jti` are ignored by `251249e`.
- `/mcp` on the release candidate also refuses a request whose `Origin` header is not in `CORS_ALLOWED_ORIGINS`; `251249e` uses that variable only for response headers. Keeping the variable unchanged across a rollback is harmless.

### 5.5 State that is lost on restart, by design

Write pacing, usage headers, circuit breakers, the object-to-account cache and the per-tenant video quotas are in memory on a single replica. A rollback resets them. Meta's own throttle state is not reset, so a circuit that was open on the release candidate can be re-opened by the first throttled call on the rollback target.

## 6. Verification after a rollback

Run from a machine that can reach the service (the build sandbox cannot reach `*.up.railway.app`). Use the production origin from the owner's records. Expected results are for the `251249e` build.

| Check | Expected |
| --- | --- |
| `GET /health` | 200, `{"status":"ok", ...}` |
| `GET /mcp` without credentials | 401 with a `WWW-Authenticate` challenge naming the resource metadata URL |
| `GET /.well-known/oauth-protected-resource/mcp` | 200, JSON naming the `/mcp` resource |
| An operator completes Meta login and a read-only tool call returns data | Works, with no re-login prompt for users whose tokens were written under `TOKEN_ENCRYPTION_KEY` |
| Logs since the rollback | No `Unsupported state or unable to authenticate data` for users other than those whose credentials were already stored under a key other than `TOKEN_ENCRYPTION_KEY` before the release (5.1), and no `Failed to start server` |
| Write tools | The tool list equals the list recorded in section 3 item 7. Do not assume write tools are absent: the audit found read-only agency exposing tools without a read-only hint on the release line, and that was not checked on `251249e` here (UNVERIFIED) |

`/ready` does not exist on `251249e`; a 404 there is expected.

## 7. After a rollback

1. Write down the trigger, the times, and the deployment ids involved.
2. Keep writes off and automatic deploys off.
3. If any stored credential is under a key other than `TOKEN_ENCRYPTION_KEY` (possible only if the 5.1 replacement was skipped or undone, or the records predate the release), list who must log in again and tell them; do not attempt to convert their tokens by hand. Re-check that `TOKEN_ENCRYPTION_KEY` is unchanged and that no `TOKEN_ENCRYPTION_KEY_NEXT*` variable was added back.
4. Reproduce the cause in staging before proposing a new release. A new release needs a new certification of its exact SHA (`scripts/release-certify.sh`) and a new owner approval.

## 8. Not verified here

- Railway's rollback semantics for variables, and how long a deployment stays rollbackable.
- Whether the Railway service has automatic deploys enabled, and what it would build.
- The actual value of every production variable (only names were read, by design). In particular, whether `TOKEN_ENCRYPTION_KEY_NEXT` holds a key that production data was ever written under, and whether any production record carries a non-`primary` `keyVersion`.
- The production root cause of the one observed `Unsupported state or unable to authenticate data` line. The `next` mechanism in 5.1 reproduces the exact text on synthetic data and fits the timeline, but a wrong or rotated `TOKEN_ENCRYPTION_KEY` produces the same text. Nothing in this repository can tell them apart without reading production data.
- That the JSON keyring variable is accepted by the platform's secret interface in the exact shape 5.1 describes (a single-line JSON value). The pre-flight validates the shape locally with synthetic data only.
- Anything about the live Firestore contents: no data was read for this document.
