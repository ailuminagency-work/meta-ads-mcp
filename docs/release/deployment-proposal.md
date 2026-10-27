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
| `DEPLOYMENT_MODE` | `awaiting_credentials` | `agency` | No default in production; startup fails if unset |
| `NODE_ENV` | `production` | `production` | Agency mode requires it |
| `AGENCY_WRITES_ENABLED` | `false` | `false` | Global write switch; anything other than exactly `true` keeps non-read tools disabled |
| `LUMIN_PLATFORM_ENABLED` | `false` | per the stage plan | Platform policy engine |
| `LUMIN_PLATFORM_WRITES_ENABLED` | `false` | `false` | Needs `AGENCY_WRITES_ENABLED=true` as well |
| Every other write-capable flag (`STRICT_WRITE_FLAGS` in `src/transport/deployment-config.ts`: activation, deletion, paused-ad batch, tracking change, creative replacement, CBO, video creative, app purchase, studies, messenger utility, messaging attachments, page and publishing video, platform and CRM signals) | `false` or absent | `false` or absent | In agency mode startup now refuses `true` unless `AGENCY_WRITES_ENABLED` is exactly `true`, and refuses any value that is not exactly `true` or `false` (so `TRUE`, `1` and `yes` fail rather than silently mean false) |
| `LUMIN_MARKETING_APP_PROMOTION_ENABLED`, `LUMIN_WHATSAPP_SETUP_ENABLED`, `LUMIN_PAID_RESEARCH_ENABLED` | `false` | `false` unless a read-only slice is approved | Reported in the startup line, not rejected |

The startup line `Deployment configuration` echoes the effective result, so the OWNER does not need to read values to confirm them: see 3.

### Required in agency mode (presence only)

`META_APP_ID`, `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET`, `OAUTH_SECRET`, at least one of `AUTH_ALLOWED_FB_USER_IDS` / `AUTH_ALLOWED_EMAILS` / `AUTH_ALLOWED_DOMAINS`, `FIRESTORE_PROJECT_ID`, `SERVER_URL` (HTTPS origin only), exactly one of `GOOGLE_CREDENTIALS_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`. Optional and checked if used: `META_OAUTH_REDIRECT_URI` (must equal `SERVER_URL` plus `/auth/meta/callback`), `META_LOGIN_CONFIG_ID` (numeric, and then `AUTH_ALLOWED_FB_USER_IDS` must be numeric ids), `LUMIN_EXPECTED_FIRESTORE_PROJECT_ID` (must equal `FIRESTORE_PROJECT_ID`; recommended in production).

### Must be absent in agency mode

`MCP_API_KEY`, `META_ACCESS_TOKEN`, `META_TOKENS`, `FIRESTORE_EMULATOR_HOST`, `APIFY_TOKEN`, `GEMINI_API_KEY`. Startup fails if any is non-empty.

### Encryption keyring (decision required, see rollback plan 5.1)

`TOKEN_ENCRYPTION_KEY_NEXT`, `TOKEN_ENCRYPTION_KEYRING_JSON`, `TOKEN_ENCRYPTION_KEY_PREVIOUS`, `TOKEN_ENCRYPTION_KEY_ID`, `TOKEN_ENCRYPTION_KEY_NEXT_ID`, `TOKEN_ENCRYPTION_KEY_PREVIOUS_ID`: record which exist. If `TOKEN_ENCRYPTION_KEY_NEXT` is present, the release candidate writes new credentials under it and the previous production build cannot read them. The OWNER records Option A or B from the rollback plan before the production deploy. Do not add, remove or rotate any key during a release other than as that recorded decision says.

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

## 2. Approval gates

| Gate | Who approves | Evidence | Unlocks |
| --- | --- | --- | --- |
| G0 Release identity | OWNER | Section 0 packet | Anything below |
| G1 Staging deploy | OWNER | Staging approval packet from `docs/staging-approval-plan.md` (release SHA, service and domain, Google project, IAM identities, cost ceiling, false-flag baseline, test accounts, rollback target) | Staging steps S1 to S4 |
| G2 Staging credentials and agency mode | OWNER | Locked-stage evidence from S4 | S5 onward |
| G3 Staging paused-write window | OWNER, separately and only if wanted | The exact test ad account and plan, per `docs/staging-approval-plan.md` | Optional S9; never part of the read-only production release |
| G4 Production release | OWNER, in writing, new and distinct from every earlier approval | Staging acceptance record, independent review, rollback plan section 3 completed, the keyring decision | Production steps P1 to P8 |
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
| S6 | ENGINEER | Verify read-only agency | Startup line: `effectiveAccess: agency_read_only`, all write flags false. `/health` 200. `/ready` 200 with `deployment`, `keyring`, `storage` all `ok`. Unauthenticated `/mcp` gives 401 with a resource-metadata challenge. OAuth discovery documents resolve |
| S7 | OWNER and ENGINEER | Human acceptance: an allowlisted operator logs in; a non-allowlisted login is rejected; a read-only tool returns data; the tool list has no write tools | Per `docs/staging-approval-plan.md`, locked and read-only stage |
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
| P3 | OWNER | Record the keyring decision (Option A or B, rollback plan 5.1), supported by the read-only inventory dry run if Option A is chosen | Written decision |
| P4 | OWNER | Turn off automatic deploys for the production service (or confirm the tracked branch cannot move), and confirm nothing is building. Do not merge anything to `main` while it auto-deploys: a merge there redeploys production | Deployment list clean |
| P5 | OWNER | In one staged change: set the source commit pin to the release SHA, set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to 30 or more, apply the P3 decision, and make no other edit | One staged change set, reviewed by a second person |
| P6 | OWNER | Apply the change and deploy once, inside an agreed window. No second deployment, variable edit or restart while it runs | Exactly one new deployment; commit equals the SHA |
| P7 | ENGINEER | Probe from outside: `/health` 200; `/ready` 200 (if 503, note `reason` and go to the rollback triggers); unauthenticated `/mcp` 401 with challenge; discovery documents | The startup line shows `effectiveAccess: agency_read_only`, all flags false, no `Failed to start server` |
| P8 | OWNER and ENGINEER | One allowlisted operator logs in and makes a read-only call. Search the log since the deploy for `Unsupported state or unable to authenticate data` | None for users who worked before the deploy |
| P9 | OWNER | Observe for an agreed period (suggested 60 minutes). Triggers in rollback plan section 2 | `/ready` stays 200, no restart loop, no unexpected writes |
| P10 | OWNER | Record the outcome, keep automatic deploys off until the owner decides otherwise, and keep the rollback plan open for the observation period | Written record |

### No overlapping deploys, in one place

1. Automatic deploys off before the first step, back on only by an explicit later decision.
2. The source is a commit SHA, never a branch.
3. Variable changes are staged and applied together with the pin, so one change set causes one deployment.
4. The deployment list is checked before and after: nothing in progress before, exactly one new deployment after.
5. Nobody restarts the service, edits a variable or merges to the tracked branch while a deployment is in progress or during the observation period without recording it.

## 6. Evidence to keep

The certification summary and its SHA; the CI run for that SHA; the approval for each gate; the variable-name checks (names and booleans only); the `Deployment configuration` line from each deployment; the `/health` and `/ready` responses; the login and read-only call results; the draining log lines; the rollback drill outcome; and every deviation from this table. No secret, token, key, credential file, customer message or personal identifier belongs in the record.

## 7. Open items before this can be approved

- Which keyring option applies (needs the owner's inventory of what key the stored credentials are under).
- Whether Railway's rollback restores the target deployment's variables (rollback plan section 8).
- Whether the Docker image builds and passes its smoke test for the final SHA (remote CI only).
- Whether `/ready` should become the Railway healthcheck path for agency mode after staging shows it is stable (`docs/release/health-and-readiness.md`).
- Updating the sentence in `docs/lumin-railway.md` that says `/ready` exists only for waiting mode.
