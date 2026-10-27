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
3. Whether any of `TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEYRING_JSON`, `TOKEN_ENCRYPTION_KEY_PREVIOUS`, `TOKEN_ENCRYPTION_KEY_ID`, `TOKEN_ENCRYPTION_KEY_NEXT_ID`, `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID` exists. The program ledger lists `TOKEN_ENCRYPTION_KEY_NEXT` as present on production. This is the single most important input to the data-compatibility analysis in section 5.1.
4. That deployment `9ee29ef9` is still offered by Railway as a rollback target (UNVERIFIED: how long Railway retains rollbackable deployments).
5. The count of documents in `platform_meta_privacy_subject_locks`, if the collection exists (a count, not contents). It is the input to 5.3.
6. The owner's decision on 5.1, written down before the deploy, not during an incident.

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

- `251249e` encrypts and decrypts every stored Meta, Apify and Gemini credential with one key, the value of `TOKEN_ENCRYPTION_KEY` (`git show 251249e:src/auth/crypto.ts`). It cannot read a key ring.
- The release candidate builds a key ring (`src/auth/keyring.ts`). Its active key, the one new writes use, is `TOKEN_ENCRYPTION_KEY_NEXT` when that variable is set, otherwise `TOKEN_ENCRYPTION_KEY`. The old key stays available for reads (`docs/token-encryption-key-migration.md`: "the application uses `next` for new writes and keeps `primary` available for old records").
- It also stamps `keyVersion` on each payload and token document (`src/auth/crypto.ts`, `src/store/meta-token-repo.ts`).

Consequences:

- Going forward is safe: records written by `251249e` carry no key version and the release candidate tries the active key and then the others, so it can read them as long as the old key is still `TOKEN_ENCRYPTION_KEY`.
- Going back is **not** safe for anything the release candidate wrote or refreshed under a key other than `TOKEN_ENCRYPTION_KEY`. `251249e` fails to authenticate those with `Unsupported state or unable to authenticate data`, which is the error already seen once on production when it moved between lines. Affected users have to log in again; the data itself is not damaged and the newer key must be kept.
- The extra `keyVersion` fields are ignored by `251249e` (Firestore documents are schemaless and its code reads only ciphertext, iv and tag).

Decision to take and record before the release (section 3, item 6):

- **Option A (preferred for the first release):** remove `TOKEN_ENCRYPTION_KEY_NEXT` and any key-ring variable for the release, so the release candidate keeps writing under `TOKEN_ENCRYPTION_KEY`. Rollback then loses nothing. Key rotation is a separate, later exercise (`docs/token-encryption-key-migration.md`).
- **Option B:** keep `TOKEN_ENCRYPTION_KEY_NEXT`. Then every token refreshed or saved during the release window is written under it, rollback forces those users to log in again, and the new key must never be deleted.

Option A is lossless only if no stored credential is already under the `next` key. The program ledger records that an earlier line already ran on production and that one decrypt failure followed the move to `main`; if that line wrote records under `next`, `251249e` could not read them then and the release candidate cannot read them without `TOKEN_ENCRYPTION_KEY_NEXT` present. So the decision needs an inventory first: the read-only dry run of `npm run migrate:token-encryption` (`docs/token-encryption-key-migration.md`), run by the owner against the production project from the pinned release commit, reports which key each stored credential decrypts under. Nothing here has read production data, so which option is lossless is UNVERIFIED; the data-and-encryption workstream owns the compatibility matrix.

Never delete, replace or rotate any encryption key as part of a rollback (`docs/staging-approval-plan.md`: key replacement "is a separately reviewed migration or reauthorization exercise, not a rollback shortcut").

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
- Dynamic client registrations live in the same collection for both builds. Registration policy changes made on the release line in this program (OAuth workstream) have not been compared against `251249e` here: UNVERIFIED.

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
| Logs since the rollback | No `Unsupported state or unable to authenticate data` for users other than those covered by 5.1 Option B, and no `Failed to start server` |
| Write tools | Absent from the tool list while `AGENCY_WRITES_ENABLED` is not `true` |

`/ready` does not exist on `251249e`; a 404 there is expected.

## 7. After a rollback

1. Write down the trigger, the times, and the deployment ids involved.
2. Keep writes off and automatic deploys off.
3. If 5.1 Option B applied, list who must log in again and tell them; do not attempt to convert their tokens.
4. Reproduce the cause in staging before proposing a new release. A new release needs a new certification of its exact SHA (`scripts/release-certify.sh`) and a new owner approval.

## 8. Not verified here

- Railway's rollback semantics for variables, and how long a deployment stays rollbackable.
- Whether the Railway service has automatic deploys enabled, and what it would build.
- The actual value of every production variable (only names were read, by design). In particular, whether `TOKEN_ENCRYPTION_KEY_NEXT` holds a key that production data was ever written under.
- Anything about the live Firestore contents: no data was read for this document.
