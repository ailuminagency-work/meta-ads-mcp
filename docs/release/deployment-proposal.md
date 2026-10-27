# Deployment proposal: release candidate to staging, then production

Status: PROPOSAL ONLY. This document authorizes nothing. It does not change a Railway variable, create or modify a service, deploy, merge, push or tag. Every step marked OWNER is performed by the owner, after the approval gate above it. It builds on `docs/staging-approval-plan.md` (staging isolation, bootstrap artifacts, the false-flag baseline, the staged acceptance checklist) and `docs/lumin-railway.md`; where they already say something, this file points to them instead of repeating it.

Roles: OWNER (the person who approves and holds the Railway and Google consoles), ENGINEER (prepares evidence, runs checks, never holds production credentials), REVIEWER (independent of whoever wrote the change).

## 0. Release identity

Nothing is deployed from a branch name. The release is one 40-character commit SHA:

1. ENGINEER runs `scripts/release-certify.sh` on a clean checkout of the candidate. It prints the exact SHA and a pass/fail table, and exits 0 only when every step passed for that SHA with HEAD unchanged. A partial run, a dirty tree or a failed step is not a certification.
2. The SHA printed there is the only value that may be entered as the Railway source pin, in staging and in production. If the candidate changes, the SHA changes and every gate below starts again.
3. CI for the same SHA is green: lint, typecheck, tests, build, secret scan, and the Linux Docker build and credential-waiting smoke job (`.github/workflows/ci.yml`). The sandbox that produced this document has no Docker daemon, so the image has not been built by this work; CI is the only image evidence.

Record in the approval packet: SHA, certification summary file, CI run link, reviewer name and date.

## 1. Variables to check, by name

Checked in the Railway variables view by name and presence. Booleans and counts are read by the OWNER; secret values are never displayed, copied or sent. "Absent" means the variable is not defined at all (an empty value is not the same thing to a human reviewing it).

### Mode and write safety

| Name | Staging locked | Staging and production agency read-only | Why |
| --- | --- | --- | --- |
| `DEPLOYMENT_MODE` | `awaiting_credentials` | `agency` | No default unless `NODE_ENV` is unset, `development` or `test`; startup fails if it is unset beside any other `NODE_ENV`, a misspelling such as `prodution` or `Production` included |
| `NODE_ENV` | `production` | `production` | Agency mode requires it |
| `AGENCY_WRITES_ENABLED` | `false` | `false` | Global write switch; anything other than exactly `true` keeps non-read tools disabled. `true` is refused at startup unless `LUMIN_PLATFORM_ENABLED` is exactly `true` too (without the policy engine the baseline write tools would run with no approval, no PAUSED-only rule and no budget ceiling), and a server built from such an environment stays read-only |
| `LUMIN_PLATFORM_ENABLED` | `false` | per the stage plan | Platform policy engine |
| `LUMIN_PLATFORM_WRITES_ENABLED` | `false` | `false` | Needs `AGENCY_WRITES_ENABLED=true` as well |
| Every other write-capable flag (`STRICT_WRITE_FLAGS` in `src/transport/deployment-config.ts`: activation, deletion, paused-ad batch, tracking change, creative replacement, CBO, video creative, app purchase, studies, messenger utility, messaging attachments, page and publishing video, platform and CRM signals) | `false` or absent | `false` or absent | In agency mode startup now refuses `true` unless `AGENCY_WRITES_ENABLED` is exactly `true`, and refuses any value that is not exactly `true` or `false` (so `TRUE`, `1` and `yes` fail rather than silently mean false) |
| `LUMIN_MARKETING_APP_PROMOTION_ENABLED`, `LUMIN_WHATSAPP_SETUP_ENABLED`, `LUMIN_PAID_RESEARCH_ENABLED` | `false` | `false` unless a read-only slice is approved | Reported in the startup line, not rejected |

The startup line `Deployment configuration` echoes the effective result, so the OWNER does not need to read values to confirm them: see 3.

### Required in agency mode (presence only)

`META_APP_ID`, `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET`, `OAUTH_SECRET`, at least one of `AUTH_ALLOWED_FB_USER_IDS` / `AUTH_ALLOWED_EMAILS` / `AUTH_ALLOWED_DOMAINS`, `FIRESTORE_PROJECT_ID`, `SERVER_URL` (HTTPS origin only), exactly one of `GOOGLE_CREDENTIALS_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`. Optional and checked if used: `META_OAUTH_REDIRECT_URI` (must equal `SERVER_URL` plus `/auth/meta/callback`), `META_LOGIN_CONFIG_ID` (numeric, and then `AUTH_ALLOWED_FB_USER_IDS` must be numeric ids), `LUMIN_EXPECTED_FIRESTORE_PROJECT_ID` (must equal `FIRESTORE_PROJECT_ID`; recommended in production).

### Must be absent in agency mode

`MCP_API_KEY`, `META_ACCESS_TOKEN`, `META_TOKENS`, `FIRESTORE_EMULATOR_HOST`, `APIFY_TOKEN`, `GEMINI_API_KEY`. Startup fails if any is non-empty.

### Encryption keyring (required change, not a free choice: see rollback plan 5.1)

Names to record: `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEYRING_JSON`, `TOKEN_ENCRYPTION_KEY_PREVIOUS`, `TOKEN_ENCRYPTION_KEY_ID`, `TOKEN_ENCRYPTION_KEY_NEXT_ID`, `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID`. Never a value.

**Production compatibility fact.** Production's variable names already include `TOKEN_ENCRYPTION_KEY_NEXT`. On the release candidate that variable being set makes `next` the ACTIVE key (`src/auth/keyring.ts`: `makeKeyring(next ? nextId : currentId, ...)`), so every login, token refresh and Apify or Gemini key registration after the deploy is written under `next`. The rollback target `251249e` reads only `TOKEN_ENCRYPTION_KEY` and fails on those records with `Unsupported state or unable to authenticate data`. Deploying the release candidate with that variable unchanged therefore makes a later rollback lossy: affected operators must log in again. The data-and-encryption workstream reproduced this on synthetic data and considers it the likely mechanism of the one decrypt failure seen earlier; **the production root cause is UNVERIFIED** (a wrong or rotated key prints the same text).

**Required change, in the same staged change as the source pin (P5), names only:**

1. Leave `TOKEN_ENCRYPTION_KEY` untouched.
2. Add `TOKEN_ENCRYPTION_KEYRING_JSON` with `activeKeyId` `primary` and `keys` containing `primary` (the current `TOKEN_ENCRYPTION_KEY` value) and `next` (the value now in `TOKEN_ENCRYPTION_KEY_NEXT`; use `TOKEN_ENCRYPTION_KEY_NEXT_ID`'s value as the id if that variable exists). The release candidate then still reads any record stored under `next` and writes under `primary`, which `251249e` can read.
3. Remove `TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEY_NEXT_ID`, `TOKEN_ENCRYPTION_KEY_PREVIOUS` and `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID`.
4. Run `scripts/release-preflight-keys.sh` (read-only, prints no value) against exactly the variables that will be live. It must report `RESULT: PASS`. Run against production's variables today it is expected to report `FAIL active encryption key id is primary`.

Never remove or rename a key id that stored records carry. Never rotate, delete or replace a key during the release or a rollback. Roll back with the unchanged `TOKEN_ENCRYPTION_KEY`. If the stored corpus is mixed, use the reverse migration in rollback plan 5.1, which currently needs a reviewed production binding. `/ready` cannot replace the pre-flight: its keyring check passes whichever key is active.

### Runtime

| Name | Expected | Why |
| --- | --- | --- |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30` or more | Railway's default is 0, which ends the old deployment at once. The server waits up to 25 s for in-flight requests after SIGTERM, but only if Railway allows that window |
| `PORT` | `3000` | The image exposes 3000 and its health check targets it |
| `VIDEO_MAX_CONCURRENT_JOBS` | absent, or a positive integer; `1` on one CPU and 1 GB | A set value that is not a positive integer now fails startup in `upstream` and `agency` modes |
| `NODE_OPTIONS` | absent (the image sets `--max-old-space-size=512` for 1 GB), or sized for a larger container | A variable overrides the image default |
| `META_API_VERSION` | `v26.0` | Supported version pin |
| `CORS_ALLOWED_ORIGINS` | exact approved origins, no wildcard | |
| `LOG_LEVEL` | `info` | The startup line is info level |

### Request limits on `/mcp` and trusted-source ingress (hardening round 1)

| Name | Default | Meaning |
| --- | --- | --- |
| `MCP_MAX_IN_FLIGHT` | `16` | Authenticated `POST /mcp` requests in flight on one instance. The next one gets 429 with `Retry-After` and a JSON-RPC body; the slot is released when the response ends or the client disconnects. A set value that is not a positive integer up to 1000 stops startup |
| `MCP_MAX_IN_FLIGHT_PER_SUBJECT` | `4` | The same cap for one authenticated subject, so one credential cannot take every slot; its fifth concurrent call gets 429 while other subjects are served (1 to 1000) |
| `MCP_REQUEST_TIMEOUT_SECONDS` | `3700` | A `/mcp` request still unanswered after this long is ended with a 504 and its slot freed (30 to 7200). The default sits above the longest tool call a client can ask for: `ads_run_report_and_wait` waits up to `max_wait_seconds` 3600 (default 600), video and Gemini calls run 180 to 240 s, bulk ad creation 180 s. An operator who never uses report waits beyond a few minutes should lower it, for example to 300 |
| `MCP_RATE_LIMIT_PER_MINUTE` | `120` | Calls per authenticated subject in a sliding minute; the same 429. A value that is not a positive integer up to 100000 stops startup |
| (fixed) | 1 MB | Largest `/mcp` body. No tool takes inline media (the base64 fields exist only on the signed ingress routes). Nesting deeper than 64 or more than 20,000 objects and arrays is refused before parsing. A bulk request above 1 MB gets 413 |

Rejections are counted and logged (`event: mcp_admission_rejected`, a hashed subject, never an identifier). One operator whose client fans out more than 4 simultaneous calls will see 429s with `Retry-After: 1`, and the instance as a whole refuses the 17th; raise either cap only with the 1 GB memory budget in mind. The slot is taken before the body is read on purpose: reading first would let any valid token make the server buffer bodies without bound.

The HTTP server now sets its own timeouts instead of Node's defaults: 30 s for a whole request (408), 15 s for the headers, a 65 s keep-alive (longer than a typical proxy's idle timeout; the Railway edge value is not published here, UNVERIFIED), checked every 5 s, and no socket timeout. A request body that never finishes therefore frees its slot after 30 s, not 300 s. A response the client has stopped reading is destroyed after 60 s without progress and frees its slot. Together with the per-subject cap this bounds what one stolen or hostile credential can hold.

**Trusted-source ingress stays OFF in this release.** `LUMIN_MEDIA_INGRESS_ENABLED` and the video, attachment and publishing-video ingress flags default to false and the production variable set must not contain them as true. If an owner later enables one, the signer has to change first: the body signature `x-lumin-signature` covers the bytes and can only be checked after they are buffered, so each request must also carry `x-lumin-request-signature`, an HMAC over the profile, timestamp, delivery id and exact `Content-Length` (helpers `mediaIngressPreauthSignature`, `videoIngressPreauthSignature`, `attachmentIngressPreauthSignature`, `publishingVideoIngressPreauthSignature`). The server verifies it from the headers alone, before reading the body and before taking the single in-flight slot, and buffers no more than the signed length. A delivery id is remembered per profile for 600 s (at most 1,000 per profile) once its request is processed or in flight, and a repeat is answered 409 before it can take the slot, so a captured header set cannot be replayed to hold it; an attempt that failed its body signature, was cut off or hit a server error releases the id, so the sender can retry the same delivery. Outside test and development runs a request without it is refused with 401. `LUMIN_INGRESS_ALLOW_LEGACY_BODY_SIGNATURE=true` re-admits the body-only signature and with it the memory and slot exposure the review found; leave it unset. The protocol description in `docs/trusted-media-ingress.md` still lists only the body signature and has to be updated with the signer (documentation outside this workstream's files).

### CI/CD trust (owner action, UNVERIFIED from here)

The workflows now follow least privilege (`tests/scripts/workflow-permissions.test.ts`): every workflow grants only `contents: read` at the top, the `id-token: write` OIDC token exists only in the `deploy` job of `deploy.yml`, which runs no repository code, the preflight jobs that run `npm ci` and the tests hold no write permission and no longer leave the job token in `.git/config`, and `packages: write` is held only by the jobs that publish. The one job that still runs repository code with a write token is `publish.yml` `npm`, because `npm publish` runs the package's `prepublishOnly` script (build and tests); splitting it needs pinned artifact actions this repository does not use yet.

What the repository cannot fix is the cloud side. `scripts/setup-gcloud.sh` creates the Workload Identity provider with a condition on the repository only and binds the deploy service account to the whole repository, so any OIDC token the repository can mint, from any branch or job, can impersonate an account that holds `roles/secretmanager.admin`, `roles/run.developer`, `roles/iam.serviceAccountUser` and `roles/artifactregistry.writer`. The OWNER narrows that trust to the main branch and the `production` environment (an `assertion.ref` and environment condition on the provider and the binding), or removes the bindings if Cloud Run is no longer a target now that production runs on Railway. The live provider condition, the environment reviewers and the branch protection were not visible to this review, so the real exposure is UNVERIFIED. `deploy.yml` can still be dispatched on any ref and passes `secrets: inherit` to `publish.yml`; both are left as found.

Two smaller findings are documented rather than changed. `.gitleaks.toml` allowlists every `.env*` path and the CI secret scan runs gitleaks only, so a force-added `.env.production` with real values would pass CI; the file-name guard exists only in the local guard scripts and `scripts/release-certify.sh` (its `files` step fails on any tracked `.env*` other than `.env.example`), and `.gitignore` stops accidental adds. The local scanner `scan-secrets.sh` now has the Apify token pattern that `.gitleaks.toml` already had, but it still skips a whole line that contains a word such as `fixture` or `placeholder`, so gitleaks, whose allowlist applies to the matched secret, remains the stronger gate.

### Operator actions for the merged OAuth and financial-safety changes (names only)

These settings come from the OAuth and financial-safety workstreams that are merged into the release line. They are described here from those workstreams' reports; re-read their own documentation after the merge, because their exact formats are UNVERIFIED on the branch that holds this document. The OWNER decides and records each one before G4. Values never enter the record.

| Name | Action | If it is not done |
| --- | --- | --- |
| `OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS` | Comma-separated exact hosts (no scheme, path or wildcard) allowed as HTTPS redirect hosts besides the built-in `claude.ai` and `claude.com`, which are pinned to the exact path `/api/mcp/auth_callback`. `chatgpt.com` is NOT built in (a Custom GPT callback on that host is attacker-registrable); add it, `platform.openai.com` or `vscode.dev` only for clients you actually use. Which client builds send which redirect is UNVERIFIED | One redirect URI outside the policy rejects the whole registration with `invalid_redirect_uri`, so that client cannot connect |
| `AUTH_DENIED_FB_USER_IDS` | Decide whether any Facebook user id must be denied from the first minute. Absent is the expected state when nobody has been revoked. It is honoured at login, authorize, code exchange, refresh and access-token verification, on the next request after the process sees the variable | A user who should be cut off is not |
| `CORS_ALLOWED_ORIGINS` | Exact origins, comma-separated, no wildcard. The default is `https://claude.ai` and `https://claude.com`; the OAuth workstream was asked to add `claude.com`, and the engineer confirms the default in the merged `src/transport/http.ts` (this branch still shows `https://claude.ai` only). On the merged line it also gates the `Origin` header on `/mcp` | A request that carries an `Origin` not in the list gets 403 before authentication. Requests without an `Origin` header (server-to-server clients) and preflights are not affected. Add the origin of any browser-based client in use |
| `DEPLOYMENT_MODE` | Set it explicitly: `agency` for the read-only release (`awaiting_credentials` on a locked stage). There is no default outside an unset, `development` or `test` `NODE_ENV` | Startup refuses to run, and `/ready` would say `deployment_mode_invalid` |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30` or more | Railway's default is 0: the old deployment ends at once and in-flight requests are cut |
| `AGENCY_WRITES_ENABLED`, `LUMIN_PLATFORM_WRITES_ENABLED` | Confirm by name and value that both are `false` (or absent). The program ledger lists the names but nobody has read the values | A `true` would enable provider writes |
| `LUMIN_MARKETING_BUDGET_CEILINGS` | No default. One strict JSON document that lists, per client, the currency and the maximum daily and lifetime budget. It is inert in the read-only release (budget checks apply only in strict write mode) but must exist and be valid before any write is ever enabled. With `LUMIN_PLATFORM_ENABLED` true an unreadable document stops startup (it is parsed once there, not at the first budget write); `LUMIN_PLATFORM_ENABLED` itself must be exactly `true` or `false` or startup fails. Before enrolling a non-USD client the OWNER verifies Meta's currency offsets against Meta's current currency codes page: the offset table in `src/meta/currency.ts` rests on secondary sources (UNVERIFIED), and an unlisted currency fails closed | A client with no entry is denied every budget-bearing write (`BUDGET_CEILING_NOT_CONFIGURED`); an unreadable document denies them all (`BUDGET_CEILING_CONFIG_INVALID`) |

**Known effect at cutover.** OAuth clients that were registered before the new redirect policy and whose redirect URIs fail it are served as unknown (`invalid_client`). Those clients must re-register (in practice, the operator removes and adds the connector again). This repository has no list of such clients; the stored registrations are in the `mcp_clients` collection and were not read.

## 2. Approval gates

| Gate | Who approves | Evidence | Unlocks |
| --- | --- | --- | --- |
| G0 Release identity | OWNER | Section 0 packet | Anything below |
| G1 Staging deploy | OWNER | Staging approval packet from `docs/staging-approval-plan.md` (release SHA, service and domain, Google project, IAM identities, cost ceiling, false-flag baseline, test accounts, rollback target) | Staging steps S1 to S4 |
| G2 Staging credentials and agency mode | OWNER | Locked-stage evidence from S4 | S5 onward |
| G3 Staging paused-write window | OWNER, separately and only if wanted | The exact test ad account and plan, per `docs/staging-approval-plan.md` | Optional S9; never part of the read-only production release |
| G4 Production release | OWNER, in writing, new and distinct from every earlier approval | Staging acceptance record, independent review, rollback plan section 3 completed, the key pre-flight `RESULT: PASS` (cutover checklist, section 5), the operator actions table decided | Production steps P1 to P8 |
| G5 Production writes | OWNER, separate | Out of scope here; this proposal ships production read-only | Not covered |

An approval covers the SHA it names and nothing else. Approval to deploy a locked or read-only service does not authorize provider writes, messaging, signals, paid research, activation, deletion or production data migration.

## 3. What the logs and probes should show

At startup, one line (`Deployment configuration`) with `deploymentMode`, `effectiveAccess` (`locked`, `agency_read_only`, `agency_writes_enabled` or `upstream_unrestricted`), `agencyWritesEnabled`, `platformEnabled`, `platformWritesEffective`, `legacyWritesWithoutPolicyEngine`, and every write-capable flag as a boolean. No value, id or secret is in it. For a read-only agency release the expected line is `effectiveAccess: agency_read_only`, `agencyWritesEnabled: false`, `platformWritesEffective: false`, `legacyWritesWithoutPolicyEngine: false`, and every entry of `writeFlags` false.

Probes (see `docs/release/health-and-readiness.md`): `/health` is liveness and is what Railway uses; `/ready` is 200 only when Firestore answers within 2 s, the keyring works and the mode is consistent. After every deploy a 200 from `/ready` is required, because `/health` does not notice a broken Firestore.

## 4. Staging

Preconditions: G0 and G1. Use the staging service and Google project defined by `docs/staging-approval-plan.md`; never the production project, secrets, domain or database. The staging service in the program ledger is asleep with its own source pin and a staged, unapplied configuration change. Inspect that staged change in the dashboard and discard it unless it is exactly what the packet says; do not apply it by accident while changing something else.

| Step | Who | Action | Verify |
| --- | --- | --- | --- |
| S1 | OWNER | Turn off automatic deploys for the staging service. Confirm no deployment is building or initializing | Deployment list shows nothing in progress |
| S2 | OWNER | Set the source commit pin to the release SHA. Stage every variable change in section 1 for the locked baseline (`DEPLOYMENT_MODE=awaiting_credentials`, all flags false, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` at 30 or more) and apply them as one change | Variables checked by name against section 1 |
| S3 | OWNER | Deploy once | The deployment's commit equals the SHA; status success |
| S4 | ENGINEER | Verify the locked stage | `/health` body is `{"status":"ok","state":"awaiting_credentials","metaConnected":false}`; `/ready`, `/mcp` and `/authorize` return 503; the log has a `Deployment configuration` line with `deploymentMode: awaiting_credentials`, `effectiveAccess: locked` and no `Failed to start server` |
| G2 | OWNER | Approve staging credentials and agency mode | |
| S5 | OWNER | Supply the staging-only secrets and Google credential source through the platform secret store (names in section 1). Switch `DEPLOYMENT_MODE` to `agency` with `AGENCY_WRITES_ENABLED=false`. Apply as one change, deploy once | Deployment active; no second deployment started |
| S6 | ENGINEER | Verify read-only agency | Startup line: `effectiveAccess: agency_read_only`, all write flags false. `/health` 200. `/ready` 200 with `deployment`, `keyring`, `storage` all `ok`. Unauthenticated `/mcp` gives 401 with a resource-metadata challenge. OAuth discovery documents resolve. `scripts/release-preflight-keys.sh` against the staging variable set reports `RESULT: PASS` (a rehearsal of the production gate) |
| S7 | OWNER and ENGINEER | Human acceptance: an allowlisted operator logs in; a non-allowlisted login is rejected; a read-only tool returns data; the tool list matches the approved read-only inventory (the policy workstream's finding F-RO says strict read-only agency exposed tools without a read-only hint; re-check after that fix lands that each such tool is hidden or inert, rather than assuming none exist) | Per `docs/staging-approval-plan.md`, locked and read-only stage |
| S8 | ENGINEER | Restart persistence and draining: redeploy once, then confirm the same operator is still logged in or can log in, stored tokens decrypt (no `Unsupported state or unable to authenticate data` in the log), and during a redeploy with a request in flight the log shows `Shutting down: no new connections` then `HTTP server closed cleanly` | Log evidence; if the old deployment is cut off instead, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` is not in effect |
| S9 | OWNER | Optional paused-write window under G3 | `docs/staging-approval-plan.md`, paused-write stage. Return both write switches to `false` at the end |
| S10 | OWNER | Revocation and rollback drill on staging: roll the staging service back to its previous deployment using the procedure in `docs/release/rollback-plan.md` sections 4 and 6, and confirm `/health` and login behave as that plan says | Recorded outcome |

Staging exit: an acceptance record per journey (accepted, blocked or rejected) with timestamps, the SHA, redacted evidence and the log lines above. The sandbox that prepared this cannot reach `*.up.railway.app`; the probes in S4 and S6 run from a machine that can, by the OWNER or by the acceptance script the MCP workstream provides.

## 5. Production

Preconditions: G4, and all of `docs/release/rollback-plan.md` section 3 recorded. Production ships **read-only**: `DEPLOYMENT_MODE=agency`, `AGENCY_WRITES_ENABLED=false`, `LUMIN_PLATFORM_WRITES_ENABLED=false`, every write-capable flag false.

| Step | Who | Action | Verify |
| --- | --- | --- | --- |
| P1 | OWNER | Record the current deployment (`9ee29ef9`), its commit, and the service source settings. Confirm the rollback target is still offered | Rollback plan section 3 items 1 to 4 |
| P2 | OWNER | Confirm by name that the section 1 write-flag rows are false or absent, and that no forbidden variable (`MCP_API_KEY`, `META_ACCESS_TOKEN`, `META_TOKENS`, `FIRESTORE_EMULATOR_HOST`, `APIFY_TOKEN`, `GEMINI_API_KEY`) is defined | The ledger's open item: the owner must confirm the production write flags are false |
| P3 | OWNER | Stage the keyring replacement from section 1 (`TOKEN_ENCRYPTION_KEY` untouched, `TOKEN_ENCRYPTION_KEYRING_JSON` with `activeKeyId` `primary`, the `TOKEN_ENCRYPTION_KEY_NEXT*` and `_PREVIOUS*` variables removed) and run `scripts/release-preflight-keys.sh` against exactly that variable set. Run the read-only inventory dry run if it is wanted to size a rollback | `RESULT: PASS` saved with the packet; written record of which `TOKEN_ENCRYPTION_KEY_*` names existed before and after |
| P4 | OWNER | Turn off automatic deploys for the production service (or confirm the tracked branch cannot move), and confirm nothing is building. Do not merge anything to `main` while it auto-deploys: a merge there redeploys production | Deployment list clean |
| P5 | OWNER | In one staged change: set the source commit pin to the release SHA, set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to 30 or more, apply the P3 keyring replacement, and make no other edit | One staged change set, reviewed by a second person |
| P6 | OWNER | Apply the change and deploy once, inside an agreed window. No second deployment, variable edit or restart while it runs | Exactly one new deployment; commit equals the SHA |
| P7 | ENGINEER | Probe from outside: `/health` 200; `/ready` 200 (if 503, note `reason` and go to the rollback triggers); unauthenticated `/mcp` 401 with challenge; discovery documents | The startup line shows `effectiveAccess: agency_read_only`, all flags false, no `Failed to start server` |
| P8 | OWNER and ENGINEER | One allowlisted operator logs in and makes a read-only call. Search the log since the deploy for `Unsupported state or unable to authenticate data` | None for users who worked before the deploy |
| P9 | OWNER | Observe for an agreed period (suggested 60 minutes). Triggers in rollback plan section 2 | `/ready` stays 200, no restart loop, no unexpected writes |
| P10 | OWNER | Record the outcome, keep automatic deploys off until the owner decides otherwise, and keep the rollback plan open for the observation period | Written record |

### Cutover checklist (every box ticked, with its evidence, before P6)

Each box is a gate, not a suggestion. An unticked box blocks the deploy; the record shows who ticked it and when, with names and booleans only.

- [ ] **Active encryption key id is primary at cutover.** `scripts/release-preflight-keys.sh`, run against exactly the variable set that will be live, prints `RESULT: PASS` (its three checks: the key ring is accepted, the active key id is `primary`, the active key is the one `251249e` reads). The output is attached to the packet; it contains no value.
- [ ] `TOKEN_ENCRYPTION_KEY` is the unchanged secret that deployment `9ee29ef9` uses (no rotation, no replacement).
- [ ] `TOKEN_ENCRYPTION_KEYRING_JSON` is staged with `activeKeyId` `primary`, a `primary` entry equal to `TOKEN_ENCRYPTION_KEY`, and an entry for every other key id that stored records may carry (`next`, or the value of `TOKEN_ENCRYPTION_KEY_NEXT_ID`). No key id was renamed or dropped.
- [ ] `TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEY_NEXT_ID`, `TOKEN_ENCRYPTION_KEY_PREVIOUS` and `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID` no longer exist in the staged variables.
- [ ] The write-flag rows of section 1 are `false` or absent, `AGENCY_WRITES_ENABLED` and `LUMIN_PLATFORM_WRITES_ENABLED` included, and no forbidden variable is defined.
- [ ] Each row of the operator actions table has a recorded decision, `DEPLOYMENT_MODE` is set explicitly, and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` is 30 or more.
- [ ] The re-registration effect of the redirect policy is accepted, and the affected operators are told.
- [ ] The GCP Workload Identity trust used by `deploy.yml` is narrowed to the main branch and the `production` environment, or its bindings are removed (owner action, CI/CD trust above).
- [ ] Rollback plan section 3 is complete, including the written statement of the keyring change and which `TOKEN_ENCRYPTION_KEY_*` names existed before and after.
- [ ] Release identity (section 0) and CI for the same SHA are green.

### No overlapping deploys, in one place

1. Automatic deploys off before the first step, back on only by an explicit later decision.
2. The source is a commit SHA, never a branch.
3. Variable changes are staged and applied together with the pin, so one change set causes one deployment.
4. The deployment list is checked before and after: nothing in progress before, exactly one new deployment after.
5. Nobody restarts the service, edits a variable or merges to the tracked branch while a deployment is in progress or during the observation period without recording it.

## 6. Evidence to keep

The certification summary and its SHA; the CI run for that SHA; the approval for each gate; the variable-name checks (names and booleans only); the key pre-flight output (`RESULT: PASS`, no value in it); the `Deployment configuration` line from each deployment; the `/health` and `/ready` responses; the login and read-only call results; the draining log lines; the rollback drill outcome; and every deviation from this table. No secret, token, key, credential file, customer message or personal identifier belongs in the record.

## 7. Open items before this can be approved

- Whether the `next` key held in production's `TOKEN_ENCRYPTION_KEY_NEXT` protects any stored record, and whether the earlier decrypt failure was this mechanism (production root cause UNVERIFIED). The required change in section 1 is safe either way; the inventory only sizes how many operators a rollback could still affect.
- Whether a production reverse migration is wanted for a mixed corpus; it needs a separately reviewed production binding (rollback plan 5.1).
- Whether the platform secret interface accepts the keyring as a single-line JSON value in the shape section 1 describes.
- The formats of the OAuth and financial-safety variables in the operator actions table, which are UNVERIFIED until those workstreams are merged and their documentation is re-read.
- Whether Railway's rollback restores the target deployment's variables (rollback plan section 8).
- Whether the Docker image builds and passes its smoke test for the final SHA (remote CI only).
- Whether `/ready` should become the Railway healthcheck path for agency mode after staging shows it is stable (`docs/release/health-and-readiness.md`).
- Updating the sentence in `docs/lumin-railway.md` that says `/ready` exists only for waiting mode.
