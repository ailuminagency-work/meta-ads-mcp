# Lumin Meta — Phase 1 Connection Recovery Toolbox

## Status and strict scope

This is an **isolated, compile-time Phase 1 policy foundation**, NOT an enabled
automatic recovery service. Do not treat a catalog of recovery procedures as
proof that production onboarding has been repaired. The implementation is
`src/platform/oauth-recovery-toolbox.ts`, with
`tests/platform/oauth-recovery-toolbox.test.ts`.

No production environment changes, credentials, provider scopes, account grants,
app reviews, data migration, advertising writes, token imports, or automatic
authorization bypass are authorized by this component.

Goal: a deterministic, bounded and reviewable connection recovery toolbox, so
operators do not invent a new technical fix for every client callback failure.

## Two separate connection paths

1. **ChatGPT/Claude/other MCP client -> Lumin MCP**: host authorization,
   OAuth discovery, client registration and MCP tool input contracts.
2. **Lumin operator/client -> Meta**: Meta user identity, account/business
   permission, Business Login/OAuth, token inspection, client-asset binding.

Do not confuse these. A working MCP `initialize` does NOT prove Meta client
access, and Meta consent does NOT prove the MCP tool schema accepts `client_id`.

## User experience

`Add client -> Choose client-owned business/account -> Connect -> Meta approval
if required -> Verify -> Connected.`

All routine operations should use existing verified scoped credentials. A
client's real Meta authorization is needed when an initial grant, revocation,
security challenge, expired access, or new permission requires one.

Account-owner actions should open the supported Meta or Lumin authorization
page, not request tokens, passwords or 2FA codes through an AI conversation.

On failure, show one safe state: **Checking**, **Owner action required**,
**Agency access review**, **Engineering hold**, or **Connected**.
Never display a misleading success status after a 401/403/503 callback.

## Recovery toolbox — implemented decision catalog (21 entries)

The compiled catalog intentionally returns the next *proposed* action, not
arbitrary instructions from the provider. Actions with `automatic_diagnostic`
are **read-only probes only** and may execute only after injection of reviewed
bounded handlers. Every other action is an explicit human or security stop.

| # | ID | Action | Who acts |
|---|---|---|---|
| 01 | probe_provider_health | Bounded Meta reachability check; no OAuth code replay | Diagnostic |
| 02 | honor_rate_limit | Respect Retry-After, jitter and backoff; no mutation retry | Diagnostic |
| 03 | recheck_storage_health | Verify encrypted store is reachable, without changing data | Diagnostic |
| 04 | refresh_mcp_discovery | Check published MCP and OAuth discovery metadata | Diagnostic |
| 05 | verify_existing_connection | Read exact current authorized client connection status | Diagnostic |
| 06 | start_fresh_signed_challenge | Begin a fresh browser-bound, one-use authorization | Account owner |
| 07 | restore_browser_session | Reauthenticate normally, including Meta-required 2FA | Account owner |
| 08 | restart_on_canonical_origin | Restart from trusted same-origin connection page | Account owner |
| 09 | audit_canonical_redirect | Compare trusted origin, redirect and browser origin | Engineer |
| 10 | reauthorize_exact_scopes | Fresh explicit consent with minimal approved permissions | Account owner |
| 11 | review_scope_mismatch | Inspect the safely classified actual/expected scope difference | Engineer |
| 12 | validate_meta_app_binding | Investigate app/subject/token-type mismatch | Engineer |
| 13 | repair_provider_schema_contract | Fix narrowly verified Meta response-format drift | Engineer |
| 14 | review_agency_membership | Check operator role, tenant and allowed-client membership | Agency operator |
| 15 | review_client_asset_grants | Verify actual business and exact authorized asset grants | Agency operator |
| 16 | request_owner_partner_access | Ask client admin for real partner access | Account owner |
| 17 | reauthorize_expired_or_revoked_token | Use Meta's supported reauthorization; no token reuse | Account owner |
| 18 | reconcile_existing_enrollment | Inspect a previous scoped connection before re-onboarding | Agency operator |
| 19 | fix_mcp_tool_client_contract | Align MCP input schema with enforced client_id | Engineer |
| 20 | inspect_internal_failure | Investigate an unknown sanitized failure | Engineer |
| 21 | stop_on_security_denial | Fail closed on identity, state, asset or tenant tampering | Security reviewer |

This catalog covers 36 exact reason classes, including the observed
`FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED`,
`FACEBOOK_OAUTH_DEBUG_TOKEN_RESPONSE_INVALID`,
`CLIENT_CONNECTION_ADMIN_REQUIRED` and the MCP missing-`client_id` case.

### Example deterministic progression

For `FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED`:

1. Review the trusted scopes and the already granted scopes without logging
   tokens or granting write permissions.
2. If that did not resolve the issue, request fresh *owner-approved* consent
   with the fixed minimal read-only profile.
3. If consent or permission is declined, **stop**. No fallback to a broader
   credential, a different identity, or a mutation-capable Business Login.

For transient provider read-only probe failure:

1. Run one bounded reachability probe.
2. A second bounded probe may follow if the first did not prove the state.
3. Stop automated attempts and escalate after the budget is exhausted.

A callback authorization code is **one-use**; never replay it simply because
a provider call timed out. Retry only specifically safe/idempotent read probes.

## Integration contract — implementation work still required

To activate this in the real callback path, an independent engineering PR
must complete all of the following:

1. Feed only a **known internal allowlisted failure reason** into
   `chooseRecovery`. The current generic `OAUTH_CALLBACK_UNAVAILABLE`
   response must never turn raw exception messages into public output.
2. Persist an incident identifier and bounded attempt history keyed to
   the existing tenant, client, operator, profile and current OAuth state.
   These may be represented by stable hashes or references, not bearer tokens.
3. Map recovery suggestions to **separate, reviewed executors**.
   Automatic actions are read-only diagnostics only. Human actions require
   an authenticated operator or account owner, and a **fresh** state when
   Meta consent is needed.
4. Enforce single-flight recovery (CAS/idempotency) and a strict limit on
   actions, elapsed time and queued work. No recursive background retry loops.
5. Revalidate client, tenant, role, current asset grants, app identity,
   token type, scope, privacy restrictions and credential revocation before
   any use of an existing connection.
6. Reject any attempt to escalate scope, alter payment or advertising
   permissions, substitute another client, or circumvent Meta 2FA.
7. Provide a sanitized incident correlation ID, safe failure category,
   owner/operator action and terminal status; never expose token, code,
   `state`, raw Meta provider response or personal identity in logs.
8. Prove the actual callback returns success and persists a verified
   connection for one Lumin-owned and one independently client-owned
   business without per-client code or Railway variable modifications.
9. Test Connect, Reconnect, expired consent, revoked permissions,
   conflicting business ownership, Meta 2FA, app mismatch, provider schema
   drift, stale session, unexpected broad permissions and missing client_id.
10. Obtain independent security review; keep current production source
    untouched until the exact commit passes Linux CI and owner-approved
    deployment acceptance.

## Non-negotiable guardrails

- Initial read-only profile cannot automatically select `ads_management`.
- Never use a token, system-user identity or agency credential belonging to a
  different business/client simply to make a rejected call succeed.
- Do not create tenant permissions, business-ownership records, asset grants or
  billing attestations as a "recovery".
- No automation may skip the Meta consent page, interactive 2FA, business
  verification or revoked access when Meta requires them.
- Do not log raw Meta OAuth response bodies, secrets, authorization codes,
  full callback URLs or bearer credentials.
- Keep callback state one-time, CSRF safeguards, audience/issuer validation,
  precise redirect URLs, encrypted token binding, and fail-closed authorization.
- No new Railway project, no new Meta application and no Google MCP changes.
- Do not activate campaigns, spend, publish, or adjust budgets as part of
  Phase 1.

## Release criteria

**Engineering catalog GO:** toolbox compiles, all strategy-selection and
abuse-case tests pass, all existing CI checks pass, independent review
accepts the bounded plan.

**Live Phase 1 recovery GO:** separate integration and user-facing
acceptance have actually shown one ordinary read-only login, a reconnect
after expiration, and a second independently owned client connection,
with correct tenant separation and no unauthorized writes. Until then,
the new catalog is NOT production-ready automation.
