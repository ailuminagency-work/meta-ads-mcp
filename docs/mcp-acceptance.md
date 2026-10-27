# MCP connector acceptance (Claude and ChatGPT)

Status: protocol-level evidence from an in-process server with fakes. No real Meta, Google, Claude or ChatGPT traffic was involved, nothing here is a staging or production result, and nothing here authorizes a deployment.

The evidence comes from three artifacts that live in this repository:

| Artifact | What it is |
|---|---|
| `tests/protocol/*.test.ts` | 80 vitest cases that start the real Express application (`startHttpTransport`) in agency mode with in-memory stores, and answer every outbound `fetch` from a fake Graph API. Any request to a host other than `graph.facebook.com` or the loopback test server throws and fails the test. |
| `tests/protocol/known-deviations.probe.ts` | A non-asserting probe that prints what the server actually does where it differs from the specifications (section 4). |
| `scripts/mcp-acceptance.mjs` | A dependency-free script that performs only read-only checks against a deployed `BASE_URL` (section 6). |

Reproduce everything below with:

```bash
LOG_LEVEL=fatal npx vitest run tests/protocol          # 4 files, 80 tests
LOG_LEVEL=fatal npx tsx tests/protocol/known-deviations.probe.ts
```

## 1. Scope and method

- **Boot path.** `bootServer()` in `tests/protocol/harness.ts` sets the environment, resets the OAuth provider, calls the real `startHttpTransport()` and binds the resulting Express app to an ephemeral loopback port. Multi-tenant Meta OAuth uses the in-memory fallbacks the code provides when Firestore is not configured (`InMemoryClientsStore`, `InMemoryAuthCodesStore`, `InMemoryJtiStore`, `InMemoryMetaTokenRepo`); the harness refuses to run if Firestore is configured. All secrets (`OAUTH_SECRET`, `SESSION_COOKIE_SECRET`, `TOKEN_ENCRYPTION_KEY`, `META_APP_SECRET`) are generated at runtime; every Meta id and token in the fixtures is obviously synthetic.
- **Meta login.** The main journey drives the real `/authorize` -> `/auth/meta` -> `/auth/meta/callback` hops; the four Graph calls the callback makes (code exchange, long-lived token exchange, `/me`, `/me/businesses`) are answered by the fake. Other cases create the same stored state directly with `setSession()` and `saveToken()`.
- **Modes exercised.** (a) read-only agency (`DEPLOYMENT_MODE=agency`, `AGENCY_WRITES_ENABLED` unset, `LUMIN_PLATFORM_ENABLED=false`), (b) agency with writes enabled, (c) strict platform (`LUMIN_PLATFORM_ENABLED=true`) read-only, (d) strict platform with `AGENCY_WRITES_ENABLED` and `LUMIN_PLATFORM_WRITES_ENABLED` on. Strict mode uses `InMemoryPlatformRepository` seeded with two tenants and three clients (`tests/protocol/strict-fixture.ts`).
- **Redirect shapes.** The Claude-shaped (`https://claude.ai/api/mcp/auth_callback`) and ChatGPT-shaped (`https://chatgpt.com/connector_platform_oauth_redirect`) redirect URIs are representative shapes, not confirmed against the vendors' current documentation (UNVERIFIED).
- **Specification sources.** The primary pages at modelcontextprotocol.io and the RFC mirrors could not be fetched from this environment (the egress policy refuses the host; `WebFetch` fails DNS). Requirements were taken from `WebSearch` summaries of the 2025-06-18 authorization and transport pages, the 2026-07-28 release notes and changelog, and the text of RFC 6749, 6750, 7009, 7591, 7636, 8252, 8414, 8707, 9110, 9207 and 9728 as known. The wording of each MCP requirement is therefore UNVERIFIED against the primary text; the behaviour columns are not.

Statuses: **PASS** a test or command in this repository demonstrated it. **FAIL** demonstrated to differ from the requirement. **UNVERIFIED** could not be demonstrated here; the reason is given.

## 2. Connector compatibility checklist

Test names are quoted from the files under `tests/protocol/`; `A` = `oauth-acceptance.test.ts`, `T` = `tool-surface.test.ts`, `P` = `transport-posture.test.ts`, `S` = `acceptance-script.test.ts`. `script META-1` etc. are rows of `scripts/mcp-acceptance.mjs`. `D#` refers to the probe output in section 4.

### 2.1 Discovery and challenge

| # | Requirement (spec) | Status | Evidence |
|---|---|---|---|
| C-01 | Protected resource metadata (RFC 9728) served at the path-specific well-known URL; `resource` is `<SERVER_URL>/mcp`; `authorization_servers` names the issuer | PASS | A "publishes RFC 9728 protected resource metadata whose resource is <SERVER_URL>/mcp and whose issuer matches"; script META-1 |
| C-02 | A 401 from `/mcp` carries `WWW-Authenticate: Bearer ... resource_metadata="<PRM URL>"` (RFC 9728 s5.1), for POST, GET and DELETE | PASS | A "answers unauthenticated POST, GET and DELETE with a 401 whose challenge names the resource metadata URL" (exact header string asserted); script AUTH-1 |
| C-03 | Authorization server metadata (RFC 8414): issuer, authorization/token/registration/revocation endpoints, https, same origin | PASS | A "publishes RFC 8414 metadata for the configured issuer with S256 as the only PKCE method"; script META-2, META-4 |
| C-04 | `code_challenge_methods_supported` contains `S256` and not `plain` | PASS | same test (asserted equal to `["S256"]`); script META-3 |
| C-05 | `grant_types_supported` has `authorization_code` and `refresh_token`; public clients (`none`) allowed | PASS | same test; script META-5 |
| C-06 | Metadata documents readable cross-origin from claude.ai and chatgpt.com | PASS | A "keeps discovery documents readable from the claude.ai and chatgpt.com origins" (`access-control-allow-origin: *`) |
| C-07 | RFC 9207 `iss` in authorization responses and `authorization_response_iss_parameter_supported` in metadata (newer MCP revisions) | FAIL | D5; script META-6 reports WARN |
| C-08 | Client ID Metadata Documents (preferred over DCR in the 2026-07-28 revision; DCR retained for compatibility) | FAIL (not implemented; forward-compatibility only) | D5; script META-7 reports WARN |

### 2.2 Registration and redirects

| # | Requirement | Status | Evidence |
|---|---|---|---|
| C-09 | Dynamic client registration (RFC 7591) for public Claude-shaped and ChatGPT-shaped clients, no secret issued | PASS | A "registers a Claude-shaped public client", "registers a ChatGPT-shaped public client" |
| C-10 | Confidential registration returns a secret with an expiry | PASS | A "issues a secret only to clients that ask for client_secret_post" |
| C-11 | Malformed registration (no redirect URIs, `javascript:` redirect) rejected with `invalid_client_metadata`; oversized bodies capped; registrations throttled per address | PASS | A "rejects registrations without redirect URIs and script-scheme redirects", "caps pre-authentication JSON bodies" (413), "throttles registrations from one address" (20 then 429) |
| C-12 | Redirect URIs must be localhost or HTTPS (MCP communication security) | FAIL | D1: registration of `http://attacker.example/callback`, `ftp://files.example/cb` and `https://user:pw@claude.ai/cb` all return 201 |
| C-13 | Exact redirect-URI match at `/authorize`; an unregistered `redirect_uri` or unknown client gets a 400 with no redirect (no open redirect) | PASS | A "never redirects to an unregistered redirect_uri or for an unknown client" (GET and POST) |
| C-14 | Loopback redirects may vary the port (RFC 8252 s7.3) | FAIL (fails closed; affects native loopback clients only) | D10; A "honours only the exact registered loopback redirect (no silent port widening on GET /authorize)" pins the current behaviour |

### 2.3 Authorization code flow, PKCE and resource indicators

| # | Requirement | Status | Evidence |
|---|---|---|---|
| C-15 | End to end: register, `/authorize`, Meta login, consent, code, token, `initialize`, `tools/list`, `tools/call` | PASS | A "walks register -> /authorize -> Meta login -> consent -> code -> token -> MCP for a Claude-shaped client"; "completes the same flow for a ChatGPT-shaped client..." |
| C-16 | Consent page names the client and the redirect target; CSP `form-action` limited to that origin; `Cache-Control: no-store` | PASS | same test (asserts `form-action 'self' https://claude.ai`, client name, redirect origin, read-only wording) |
| C-17 | No authorization code without an authenticated Meta session | PASS | A "refuses to issue a code without an authenticated Meta session" |
| C-18 | Meta callback bound to the browser that started it (state nonce cookie) | PASS | A "rejects a Meta callback with a missing or foreign state nonce" |
| C-19 | PKCE S256 enforced: `plain`, missing challenge and non-`code` response types are returned as errors, never a code | PASS | A "returns authorization errors to the registered redirect, never a code" |
| C-20 | `state` echoed on a successful redirect | PASS | A walkthrough test (asserts the caller's `state`) |
| C-21 | `state` echoed on an error redirect (RFC 6749 s4.1.2.1) | FAIL | D2 (`error=invalid_request state=(absent)`); cause is the SDK authorize handler assigning `state` only after parameter validation succeeds |
| C-22 | Wrong PKCE verifier, and a missing verifier, are rejected with no token | PASS | A "rejects a PKCE verifier that does not match the challenge", "rejects a token request that omits the PKCE verifier" |
| C-23 | Code single use; replay rejected; concurrent redemption yields exactly one token | PASS | A "accepts the code once and rejects the replay", "lets exactly one of two concurrent redemptions of the same code succeed" |
| C-24 | Code bound to its client and redirect URI | PASS | A "rejects a code presented by a different client or with a different redirect_uri" |
| C-25 | Code expires (ten minutes) | PASS | A "rejects an authorization code after its ten minute lifetime" (clock moved 11 minutes) |
| C-26 | Replay of a code revokes tokens already issued from it; a failed verification burns the code (SHOULD) | FAIL | D6, D7 |
| C-27 | RFC 8707 `resource` accepted on authorize and token requests; authorize/token mismatch rejected; clients that omit it get a token bound to `/mcp` | PASS | A "binds the token to the MCP resource whether or not the client sends RFC 8707 resource" |
| C-28 | Unknown `resource` refused with `invalid_target` (RFC 8707 s2, SHOULD) | FAIL (the resource server rejects the token, so no access results) | D9 |
| C-29 | Unsupported grant types rejected | PASS | A "rejects unsupported grant types" |

### 2.4 Tokens and bearer enforcement

| # | Requirement | Status | Evidence |
|---|---|---|---|
| C-30 | Token responses are `Cache-Control: no-store`; no Meta token in any OAuth or tool response | PASS | A walkthrough test |
| C-31 | Refresh-token rotation, replay rejected, other client's refresh rejected, concurrent refresh yields exactly one success | PASS | A "rotates refresh tokens, refuses replay and honours revocation", "lets exactly one of two concurrent uses of the same refresh token succeed" |
| C-32 | Revocation endpoint (RFC 7009) | PASS | A "rotates refresh tokens, refuses replay and honours revocation" |
| C-33 | Resource server validates audience: a genuine token issued for another resource is refused | PASS | A "rejects a genuine token that was issued for a different resource" |
| C-34 | Garbage, tampered, unsigned (`alg: none`), foreign-signed, expired, wrong-audience, wrong-type tokens and a refresh token used as an access token all return 401 `invalid_token` with the resource metadata URL, and never reach Meta | PASS | A "rejects garbage, tampered, unsigned, foreign-signed, expired, wrong-audience and wrong-type tokens" |
| C-35 | Real access tokens expire after one hour | PASS | A "expires access tokens after their one hour lifetime" |
| C-36 | Token only in the `Authorization` header (not the query string); scheme matched case-insensitively; other schemes refused | PASS | A "does not accept a token supplied in the query string", "accepts the Bearer scheme case-insensitively and rejects other schemes" |
| C-37 | 403 `insufficient_scope` | Not applicable | The server issues no scopes and publishes no `scopes_supported` |

### 2.5 Streamable HTTP

| # | Requirement | Status | Evidence |
|---|---|---|---|
| C-38 | POST requires `Accept` listing both `application/json` and `text/event-stream` (406 otherwise) and `Content-Type: application/json` (415 otherwise) | PASS | A "applies POST semantics: 406 without both Accept types, 415 for wrong content type, 202 for notifications, JSON-RPC errors for unknown methods" |
| C-39 | Notifications return 202 with no body; requests return an SSE stream; unknown methods return a JSON-RPC error | PASS | same test; walkthrough test (`content-type: text/event-stream`) |
| C-40 | GET (and DELETE) on the MCP endpoint return 405 because no SSE stream is offered | PASS | A "answers GET and DELETE on /mcp with 405 for authenticated callers (no SSE stream offered)"; script MCP-6 |
| C-41 | The 405 carries an `Allow` header (RFC 9110 s15.5.6) | FAIL | D3; script MCP-6 reports WARN |
| C-42 | Protocol version negotiation at `initialize`; unsupported `MCP-Protocol-Version` header rejected with 400 | PASS | A "negotiates the protocol version and validates the MCP-Protocol-Version header"; script MCP-7 |
| C-43 | Stateless operation: no session id is issued and `tools/list` works without a prior `initialize` | PASS | A "is stateless: no session id is issued and tools/list works without a prior initialize" |
| C-44 | Malformed JSON answered with a JSON-RPC parse error | FAIL (HTML 400 from Express; in a non-production `NODE_ENV` the body contains a stack trace) | D8 |
| C-45 | Servers validate the `Origin` header (DNS rebinding) | FAIL (a bearer token is still required, so the exposure is limited) | D11 |

### 2.6 CORS and transport security

| # | Requirement | Status | Evidence |
|---|---|---|---|
| C-46 | Browser preflight from claude.ai to `/mcp` is allowed with `Authorization` and `Content-Type`; other origins get no CORS headers | PASS | A "handles browser preflight for claude.ai and withholds CORS from origins outside the allowlist" |
| C-47 | chatgpt.com preflight is allowed | PASS only when `CORS_ALLOWED_ORIGINS` includes it; the default allowlist is `https://claude.ai` and `https://claude.com` | P "echoes exactly the configured origins and nothing else"; D4b |
| C-48 | Browser clients can send `MCP-Protocol-Version` and read `WWW-Authenticate` / `Mcp-Session-Id` | FAIL (allowed headers are `Content-Type, Authorization, X-API-Key, X-Meta-Token, Mcp-Session-Id`; nothing is exposed) | D4; script CORS rows report WARN. Matters only to a client running in a browser; whether the Claude and ChatGPT connectors call from the vendors' servers instead is UNVERIFIED |
| C-49 | Production: plain HTTP redirected to the https origin (`/health` exempt), HSTS over https | PASS (non-multi-tenant production boot) | P "redirects plain-HTTP requests to the https origin, exempts /health and sends HSTS over https" |
| C-50 | Same, in the agency production configuration | UNVERIFIED | Multi-tenant production refuses to start without Firestore, so it cannot be booted in-process |

### 2.7 Agency-specific controls

| # | Requirement | Status | Evidence |
|---|---|---|---|
| C-51 | `X-Meta-Token` refused with 403 in agency mode, including an empty value; nothing reaches Meta | PASS | A "refuses the X-Meta-Token override in agency mode, even when empty, and never calls Meta"; control P "honours the header override when DEPLOYMENT_MODE is upstream" shows the refusal is mode-specific; script MCP-8 |
| C-52 | `X-API-Key` cannot replace OAuth when no API key is configured | PASS | A "does not let X-API-Key stand in for OAuth when no API key is configured" |
| C-53 | A valid MCP token whose user has no stored Meta token gets a 401 challenge naming the resource metadata and asking to reconnect | PASS | A "answers a valid MCP token with no stored Meta token by asking the user to reconnect" |
| C-54 | A validly signed token with no Meta user identity gets a 401 | PASS | A "refuses a validly signed token that carries no Meta user identity" |
| C-55 | The Meta token used for a read is the signed-in user's stored token; the MCP bearer never reaches Meta | PASS | A walkthrough test (Graph call carries the stored token, not the MCP access token) |
| C-56 | `__Host-` / `Secure` cookie attributes in production | UNVERIFIED | Cookie names are fixed at module load from `NODE_ENV`; the production configuration cannot be booted in-process |
| C-57 | Firestore-backed client, code and JTI stores across instances; real Meta login and app configuration; real Claude and ChatGPT connectors | UNVERIFIED | Require staging |

## 3. Tool surface per mode

All rows are in `tests/protocol/tool-surface.test.ts`. `h.upstream` is the fake Graph recorder.

| # | Mode | Claim | Status | Evidence |
|---|---|---|---|---|
| T-01 | Read-only agency | `tools/list` returns only tools annotated `readOnlyHint`; none has a mutating verb in its name or the live-data write warning | PASS | "lists only read-only tools: every one annotated readOnlyHint..." (73 tools; the baseline has 142) |
| T-02 | Read-only agency | Every tool that the writes-enabled build exposes beyond that set is hidden | PASS | "hides every tool that the writes-enabled build exposes beyond the read-only set" |
| T-03 | Read-only agency | `tools/call` on each hidden tool is rejected by the server (`Tool ... disabled`), not just omitted from the listing, and sends nothing to Meta | PASS | "rejects tools/call for every hidden tool at the server, not just in the listing, and never reaches Meta" |
| T-04 | Read-only agency | A read tool works with the user's stored token and only issues GET requests | PASS | "serves a read tool with the signed-in user's Meta token and only ever issues GET requests" |
| T-05 | Writes enabled | Write tools are listed with `destructiveHint` / `idempotentHint` and the warning; a write call reaches input validation, not a "disabled" refusal | PASS | "exposes the write tools with their destructive/idempotent hints and the live-data warning", "routes a write call to validation..." |
| T-06 | Strict platform | `client_id` is required on every legacy tool that is callable; the legacy tools that cannot take it answer `LEGACY_STRICT_MIGRATION_HOLD` | PASS | "requires client_id on every legacy tool it lists, and holds the ones that cannot take it" |
| T-07 | Strict platform | An authorized client read uses that client's narrow connection credential in the `Authorization` header, with no `access_token` parameter, never the login token | PASS | "reads an authorized client's campaigns with that client's narrow credential, never the login token" |
| T-08 | Strict platform | Another client in the same tenant, another tenant's client, an unknown client, another client's account or campaign, and an unregistered account are denied before any Meta request | PASS | "denies another client, another tenant's client and unknown clients...", "denies another account or campaign, even under the caller's own client id", "keeps operators apart..." |
| T-09 | Strict platform | Sweep: all 206 listed tools called with a foreign `client_id` produce no Meta request | PASS | "sends no Meta request for any listed tool when called with a client the operator does not belong to" (output: `206 tools, 203 policy denials, 3 schema rejections, succeeded without Meta: none`) |
| T-10 | Strict platform | Sweep: all 206 listed tools called for the authorized client produce only GET requests carrying that client's credential, to registered root objects, never `/me` or `/oauth` | PASS | "confines every Meta request made on behalf of the authorized client to GETs with that client's credential" (output: `23 upstream requests across 206 tools, 11 held`) |
| T-11 | Strict platform | Legacy parameters and alternate-endpoint variants fail closed: `breakdowns`, `filtering`, attribution override, secret or nested field projections, edges / traversal / query strings smuggled into ids, unbounded `limit`, unknown status filters | PASS | "fails closed on legacy parameters and alternate-endpoint variants of read tools" |
| T-12 | Strict platform | `ads_get_ad_accounts` never calls `/me`; a foreign `user_id` is refused | PASS | "discovers accounts from the client's registered assets and never from /me" |
| T-13 | Strict platform | A caller-supplied `access_token` argument is ignored, not forwarded | PASS | "ignores a caller-supplied access_token instead of forwarding it" |
| T-14 | Strict platform | `X-Meta-Token` refused | PASS | "refuses the X-Meta-Token override in strict mode too" |
| T-15 | Strict platform, read-only agency | Exactly six tools lack `readOnlyHint`: the `meta_*` evidence and enrollment tools (`meta_observe_ads_compatibility`, `meta_observe_account_owner`, `meta_lookup_ad_targeting`, `meta_discover_ad_assets`, `meta_discover_signal_assets`, `meta_prepare_app_promotion_access`). They issue Graph GETs and write only evidence or enrollment proposals to the store. `ads_update_ad_url_tags`, `meta_prepare_action`, `meta_prepare_publication`, `meta_plan_paused_ads` and `meta_plan_ad_tracking_change` are disabled while writes are off. The list is asserted exactly, and no provider write tool (`ads_create_*`, `ads_delete_*`, `ads_update_campaign`, `ads_activate_entity`, `ads_upload_*`) is listed | PASS | "exposes exactly the documented set of non-read-only control tools and no provider write"; every Graph request in the strict read-only session was a GET |
| T-16 | Strict platform, write flags on | A write call cannot reach Meta without a write grant, client membership, an issued approval and a PAUSED payload; the legacy destructive tool is held | PASS | "does not let any write call reach Meta without an issued human approval, a write grant and a client membership" (reasons asserted: `PERMISSION_OR_CONNECTION_REQUIRED`, `CLIENT_ACCESS_REQUIRED`, `UPDATE_MUST_REMAIN_PAUSED`, `CREATE_MUST_REMAIN_PAUSED`, `LEGACY_STRICT_MIGRATION_HOLD`) |

Behaviour that differs from, or is not stated by, the documentation:

1. **Strict read-only agency is not "no write tool" in the literal sense.** `src/server.ts` keeps six non-read-only evidence and enrollment tools enabled by name when the platform is on (T-15); the preparation and planning tools that used to be in that set are now disabled while writes are off (Team B1, see `docs/policy-engine.md`). By design (`docs/architecture.md`, `docs/policy-engine.md`) they prepare reviewable proposals and cannot approve, and the schema of `ads_update_ad_url_tags` forces `dry_run: true`; this suite shows that no call to them produced a non-GET provider request, but it did not drive a successful preparation through (UNVERIFIED). A connector's permission UI will show them as write-capable. In platform-disabled agency mode the literal criterion is met (T-01).
2. **Strict mode lists eleven tools that can only answer HOLD** (`ads_get_help_article`, `ads_list_tokens`, `ads_get_gemini_key_status`, `ads_get_ad_preview`, `ads_generate_preview`, `ads_get_pixel_events`, `ads_get_audience_shared_accounts`, `ads_get_targeting_description`, `ads_diagnose_underperformance`, `ads_insights_auction_ranking_benchmarks`, `ads_insights_industry_benchmark`). They fail closed, as `docs/architecture.md` describes, but they are advertised to the model.
3. **Tool-count documentation disagrees.** `docs/acceptance-checklist.md` says 370 registered names; `docs/generated-tool-inventory.md` says 371, and the strict write-enabled server lists 371.
4. **Unknown arguments are dropped, not rejected** (T-13). The result is safe, but a caller that passes `access_token` is not told it was ignored.
5. `README.md` presents `X-API-Key` plus `X-Meta-Token` as the server-to-server path without saying that agency mode refuses both (C-51, C-52).

## 4. Deviations to triage

**Status after the round-1 fixes** (probe re-run on the integration tip after the independent review): D1, D1b, D2, D6, D8 and D10 are resolved in code (registration policy, `state` echoed on error redirects, a wrong PKCE verifier burns the code, malformed JSON gets a JSON-RPC parse error, loopback redirects may vary the port); D11 is resolved (a foreign `Origin` gets 403). D3 (405 without `Allow`), D4/D4b (CORS allow/expose headers; chatgpt.com not allowed by default), D5 (RFC 9207 `iss`, Client ID Metadata Documents), D7 (refresh tokens are revoked on replay; access tokens stay valid for up to one hour) and D9 (`/token` does not bind an unknown `resource`) remain open and low. Rows in sections 2 and 3 marked FAIL for the resolved items describe the frozen candidate f190dca; re-run the probe to refresh them. The text below is the original triage.

Output of `LOG_LEVEL=fatal npx tsx tests/protocol/known-deviations.probe.ts` (trimmed). None is patched here; `src/` was not touched. Severity is the author's judgement for a read-only agency service in front of Claude and ChatGPT.

| ID | Observation | Requirement | Severity | Where a fix would go |
|---|---|---|---|---|
| D1 | `POST /register` accepts `http://attacker.example/callback`, `ftp://files.example/cb`, `https://user:pw@claude.ai/cb` (HTTP 201) | MCP authorization, communication security: localhost or HTTPS only | Low to medium. The consent page shows the redirect target and only allow-listed Meta users can approve, but a code could be delivered over plaintext | `src/store/persistent-clients-store.ts` or a registration wrapper (OAuth surface: needs review) |
| D2 | Authorization error redirects omit `state` | RFC 6749 s4.1.2.1 | Low | MCP SDK 1.32.1 `authorize.js` (state is assigned after validation); upgrade or pre-validate in the custom GET handler |
| D3 | `405` on `GET`/`DELETE /mcp` has no `Allow` header | RFC 9110 s15.5.6 | Low | `src/transport/http.ts`, two handlers |
| D4, D4b | CORS allows `Content-Type, Authorization, X-API-Key, X-Meta-Token, Mcp-Session-Id`; exposes nothing; default allowlist lacks chatgpt.com | Streamable HTTP clients send `MCP-Protocol-Version`; a browser reads `WWW-Authenticate` only if exposed | Low for server-side connectors; blocks browser-resident clients | `src/transport/http.ts` CORS options; `CORS_ALLOWED_ORIGINS` |
| D5 | No `iss` parameter, no `authorization_response_iss_parameter_supported`, no `client_id_metadata_document_supported` | RFC 9207; 2026-07-28 revision (per release notes, UNVERIFIED against primary text) | Low today, rising as clients start requiring it | `src/auth/oauth-provider.ts`, metadata construction |
| D6 | A wrong verifier returns 400 but the code stays redeemable (correct verifier then returns 200) | OAuth 2.1 hardening | Low (codes are 256-bit; `/token` is rate limited) | `src/auth/oauth-provider.ts` |
| D7 | Replaying a used code returns 400 but the access token issued by the first use still works | RFC 6749 s4.1.2 (SHOULD revoke) | Low | `src/auth/oauth-provider.ts` |
| D8 | Malformed JSON to `/mcp` returns Express HTML 400 (with stack trace unless `NODE_ENV=production`; agency mode requires production) | JSON-RPC parse error | Low | `src/transport/body-limits.ts` plus an error handler |
| D9 | `/token` mints a token for any `resource` URL; `/mcp` then rejects it | RFC 8707 s2 (`invalid_target`, SHOULD) | Informational | `src/auth/oauth-provider.ts` |
| D10 | Registered `:53682`, requested `:61000` loopback redirect gives 400 at `GET /authorize` | RFC 8252 s7.3 | Informational (fails closed) | `src/transport/authorize-validation.ts` |
| D11 | `Origin` and `Host` are not validated on `/mcp` (200 with `Origin: https://attacker.example`, `Host: rebound.attacker.example`) | Streamable HTTP security warning (DNS rebinding) | Low (bearer required) | `src/transport/http.ts` |

If the orchestrator approves, D1, D2, D3, D4 and D5 can each be added to the suite as `it.fails` cases that start passing when fixed; they are not in the suite now because the charter forbids marked failures without approval.

## 5. Not covered

- Real Claude or ChatGPT connector behaviour: redirect URIs, `resource` parameter use, retry and token-refresh timing, header sets, whether they call from a browser.
- Anything with Firestore: multi-instance code and JTI consistency, TTL cleanup, privacy locks (`isMetaPrincipalPrivacyLocked` returns false without Firestore and `LUMIN_META_PRIVACY_ENABLED` unset).
- The production agency boot path (`validateAgencyEnvironment`, secure cookies, Railway or Cloud Run proxy headers).
- Real Graph response shapes, rate limiting and error mapping; real Meta login configuration.
- Primary text of the MCP specification (section 1).
- Mutation checks of the assertions against modified `src/` (the temporary edit needed was refused by the permission system and was not attempted another way). The assertions were instead exercised against both sides of a configuration switch where one exists: writes enabled vs read-only (T-01, T-05), upstream vs agency `X-Meta-Token` (C-51), configured vs default CORS (C-47), production vs test transport (C-49), and each sweep asserts it produced non-trivial traffic or denials so it cannot pass vacuously.

## 6. `scripts/mcp-acceptance.mjs` (for the program owner)

Dependency-free (Node 18+). Read-only by construction: `GET` for metadata and `/health`, `OPTIONS` for CORS preflight, and `POST /mcp` limited to JSON-RPC `initialize`, `notifications/initialized`, `tools/list` and one `tools/call`. It does not register a client, run an OAuth flow, or call a tool that the server does not annotate `readOnlyHint: true` (and refuses names with mutating verbs). The bearer token is sent only to `BASE_URL/mcp`, is never printed, and any echo of it (and any JWT-shaped string, `Bearer ...`, `EAA...` or `access_token=` value) in a server reply is replaced with `[REDACTED]` before printing.

```bash
BASE_URL=https://staging.example \
MCP_BEARER_TOKEN=<access token for a test user> \
READ_TOOL=ads_get_account_info READ_TOOL_ARGS='{"account_id":"<test account>"}' \
EXPECT_READ_ONLY=true \
node scripts/mcp-acceptance.mjs
```

Optional: `EXPECTED_ORIGIN` (when the server advertises a different origin than `BASE_URL`), `CORS_ORIGINS`, `OUTPUT=json`. Exit code 0 when no row is FAIL, 1 when any is, 2 for a usage error. WARN rows are the standing gaps in section 4 and SHOULD-level items; SKIP means the check does not apply (no token, plain HTTP).

Output against the in-process server (read-only agency, fake Graph, `READ_TOOL=ads_get_account_info`, `EXPECT_READ_ONLY=true`):

```text
ID                CHECK                                                                          RESULT  DETAIL
----------------  -----------------------------------------------------------------------------  ------  ------
META-1            RFC 9728 PRM names <origin>/mcp and an authorization server                    PASS    resource=https://mcp.lumin-acceptance.example/mcp authorization_servers=1
META-2            AS metadata issuer equals the advertised authorization server                  PASS    issuer=https://mcp.lumin-acceptance.example/
META-3            PKCE: S256 advertised and plain not advertised                                 PASS    code_challenge_methods_supported=["S256"]
META-4            authorization, token and registration endpoints are advertised over https      PASS    all present
META-5            authorization_code + refresh_token grants, public clients (none)               PASS    grants=["authorization_code","refresh_token"] auth=["client_secret_post","none"]
META-6            RFC 9207 iss parameter advertised                                              WARN    not advertised (SHOULD in newer MCP revisions)
META-7            Client ID Metadata Documents advertised                                        WARN    not advertised (dynamic client registration is the only path)
AUTH-1            unauthenticated POST /mcp: 401 + WWW-Authenticate resource_metadata (PRM URL)  PASS    status=401 challenge=Bearer error="invalid_token", error_description="Missing Authorization header", resource_metadata="https://mcp.lumin-accepta
AUTH-2            an invalid bearer token is rejected with 401                                   PASS    status=401
MCP-1             initialize returns protocolVersion, serverInfo and tools capability            PASS    protocolVersion=2025-06-18 server=meta-ads-mcp
MCP-2             notifications/initialized is acknowledged with 202                             PASS    status=202
MCP-3             tools/list returns well-formed tools                                           PASS    status=200 tools=73
MCP-4             tool surface is read-only (readOnlyHint on every tool, no mutating verbs)      PASS    non-read-only listed: 0; mutating-looking read-only names: 0
MCP-5             read tool ads_get_account_info returns data                                    PASS    316 characters returned (content not printed)
MCP-6             GET /mcp is 405 (no SSE stream) and carries Allow                              WARN    status=405 allow=(none)
MCP-7             unsupported MCP-Protocol-Version header is rejected with 400                   PASS    status=400
MCP-8             X-Meta-Token override is refused with 403 (agency mode)                        PASS    refused
NET-1             /health answers 200                                                            PASS    status=200
NET-2             HSTS is sent over https                                                        SKIP    BASE_URL is not https
CORS-claude.ai    browser preflight from https://claude.ai (informational)                       WARN    allow-origin=https://claude.ai missing-allow-headers=mcp-protocol-version expose-www-authenticate=false
CORS-chatgpt.com  browser preflight from https://chatgpt.com (informational)                     WARN    allow-origin=(none) missing-allow-headers=mcp-protocol-version expose-www-authenticate=false

Summary: 15 PASS, 5 WARN, 1 SKIP
Requests made: 14 (GET, POST, OPTIONS); JSON-RPC methods: initialize(unauthenticated), initialize(invalid token), initialize, notifications/initialized, tools/list, tools/call:ads_get_account_info, tools/list, tools/list
```

Against a strict-platform staging server the script's `READ_TOOL_ARGS` must include `client_id`, and MCP-4 will WARN (or FAIL with `EXPECT_READ_ONLY=true`) because of the six evidence and enrollment tools in T-15.
