# Health and readiness

Two routes, two different questions. Neither requires authentication and neither returns a secret, an identifier or an error message.

| Route | Question it answers | Touches Firestore | Used by |
| --- | --- | --- | --- |
| `GET /health` | Is the process up and serving HTTP? | No | The Railway healthcheck path, the image `HEALTHCHECK`, `docker-compose.yml` |
| `GET /ready` | Can this instance do useful work right now? | Yes, one bounded read | The release runbook (post-deploy gate), operators, any load balancer that can drain on 503 |

## Why `/health` stays liveness only

`/health` is the path the platform and the image use to decide whether the process is alive and a new deployment can be accepted. Making it depend on Firestore would turn a storage problem into a deployment failure on every route, including the intentionally inactive credential-waiting deployment, which has no storage and must still be accepted (`docs/lumin-railway.md`). A restart also does not repair a revoked service-account credential or an unreachable project, so restarting on that signal only converts one failure into a crash loop.

The cost of that choice is the audit finding it leaves open: a deployment with broken storage still reports healthy on `/health`. `/ready` closes it, and the deployment runbook (`docs/release/deployment-proposal.md`) makes a 200 from `/ready` a required step after every deploy, with a 503 as a rollback trigger. Pointing the Railway healthcheck at `/ready` instead is a possible later change for agency mode only; it is an owner decision, because it would make a transient Firestore blip block a deploy, and it can never apply to the credential-waiting deployment, where `/ready` is always 503.

`/health` bodies:

- Active server: `{"status":"ok","ffmpeg":true|false}` (`ffmpeg` is the last settled startup probe, never a fresh spawn).
- Credential-waiting: `{"status":"ok","state":"awaiting_credentials","metaConnected":false}`.

## `/ready`

It answers 200 only when all three hold:

1. **Deployment mode is consistent.** `DEPLOYMENT_MODE` resolves to a valid mode, is not `awaiting_credentials`, and in agency mode `validateAgencyEnvironment` still passes (the same checks as startup, including the write-flag rules).
2. **The encryption keyring works.** A value is encrypted and decrypted with the keyring the process really uses (not a fresh parse of the variables).
3. **Storage answers.** One read of a document that does not exist (`mcp_readiness_probe/probe`) completes within **2 seconds**. Storage is mandatory in agency mode and whenever Meta OAuth is configured; a single-tenant deployment with no Firestore configured reports storage as `skipped` and can still be ready.

200 body: `{"status":"ready","checks":{"deployment":"ok","keyring":"ok","storage":"ok"}}`.

503 body: `{"status":"not_ready","reason":"<code>","checks":{...}}`, with each check `ok`, `fail` or `skipped`. Reason codes, in priority order:

| Code | Meaning |
| --- | --- |
| `shutting_down` | SIGTERM/SIGINT received; the instance is draining in-flight requests |
| `deployment_mode_invalid` | `DEPLOYMENT_MODE` is unset in production or not one of the three modes |
| `deployment_mode_not_serving` | Mode is `awaiting_credentials` (the credential-waiting server answers 503 on every route other than `/health`) |
| `deployment_config_invalid` | Agency validation or security configuration fails |
| `keyring_unavailable` | No usable encryption key, or encrypt/decrypt does not round trip |
| `storage_not_configured` | Storage is required and no Firestore project or credential is configured |
| `storage_timeout` | The Firestore read did not finish within 2 s |
| `storage_unavailable` | The Firestore read failed (credential, IAM, project, network) |
| `readiness_check_failed` | The check itself failed unexpectedly |

Only the code is returned. The underlying error is never put in the response; state changes are logged once (`event: readiness_changed`) with the same codes.

### Load safety

`/ready` is public, so it must not become a way to drive Firestore load. Concurrent requests share one in-flight probe, and each answer is reused for 5 seconds. At most one read per instance per 5 seconds reaches Firestore however often the route is hit. A hung Firestore call is abandoned after 2 s; a later probe starts a new call.

### What a 200 does not prove

- **Write permission.** The probe is a read. A runtime account with read-only IAM passes `/ready` and fails on the first write. The runbook's login and encrypted-token persistence checks cover writes.
- **Indexes and TTL policies.** Absent indexes surface as query errors, not as a failed read of one document.
- **Meta connectivity or token validity.** Nothing calls Meta.
- **Anything about a single user's data.** Per-token decrypt failures (for example tokens written under a key this deployment does not have) are invisible to `/ready`; grep the logs for `Unsupported state or unable to authenticate data` after each deploy.

### Other modes

- Credential-waiting deployment: `/health` 200 with `state: awaiting_credentials`; `/ready` and every other route 503. Unchanged.
- Local `upstream` development without Firestore: `/ready` is 200 once the keyring loads.

### Stale sentence elsewhere

`docs/lumin-railway.md` still says that active mode "retains the upstream health contract" and that `/ready` is only for waiting mode. That is no longer true after this change; it is outside the files this work owns and should be updated to point here.
