# Product-specific authentication

Status: candidate implementation, no production rollout or live-provider acceptance established by this document. Existing production login remains unchanged with strict-platform features disabled.

Connections are bound to tenant, authenticated operator, provider, app, actual token type and client-registered asset roots. A server-owned operator index and active connection-admin/client membership control onboarding. The optional /platform/connections page shows only authorized clients. OAuth initiation accepts protected HTML forms or JSON, requires the exact server Origin and emits secure host-only nonce cookies. Callback routing must exactly match the service origin and profile path.

LUMIN_PLATFORM_OAUTH_ENABLED and LUMIN_PLATFORM_ENABLED must both be true to mount product onboarding. LUMIN_PLATFORM_OAUTH_PROFILES_JSON supplies a bounded, strict deployment-owned profile list. Secret references are provider-bound environment names (META_APP_SECRET, THREADS_APP_SECRET or INSTAGRAM_APP_SECRET); raw secrets are never embedded in profiles, HTML or MCP inputs. ImmutableOAuthProfileRegistry snapshots profiles; dynamic edits are unsupported. Pure adapter validation rejects unsupported permission/action packs before a challenge or consent redirect.

Durable Firestore challenges bind tenant/operator/client/profile hash/callback/browser nonce, expire after10 minutes and consume atomically before exchange. Actual code exchange is followed by token validity/app/subject/type/scope/expiry inspection and requested root identity proof. Actual granted scopes must exactly match the trusted incremental profile; requested scopes are not assumed granted. Credentials, connection metadata, grants and audit enroll atomically with membership/asset CAS and commit-time expiry checks. Credentials use versioned AES-GCM with tenant/operator/provider/app/credential binding; no plaintext or legacy fallback exists.

Facebook v26.0 Marketing consent supports only12 core READ and3 minimal paused-create capability IDs. Scopes are exactly public_profile plus ads_read for READ and ads_management for paused creation. Actions cannot include activation, deletion, billing, identity/admin, content or messaging. Business remains narrow READ. Threads uses its separate app/login and only threads_basic plus3 verified READ capabilities. User account-read proof is not manage-role/billing proof; no Page or management tasks are fabricated. Pages/Messenger Page-token derivation, Instagram and WhatsApp OAuth paths remain HOLD where their concrete adapters are unverified.

Enrollment alone never enables writes. Trusted fresh asset manage-role/access/ownership/billing evidence, grants, write flags and exact human approval are checked separately. Human approval is an authenticated browser decision protected by role/client/Origin/signed CSRF/expiry and transactional one-use checks; no MCP tool can issue its own approval. Tokens, callback codes and internal credential-bearing exchange URLs must remain absent from application/proxy logs; infrastructure log acceptance remains a deployment gate.

Local tests cover replay, swapped clients/nonces, profile and privilege expansion, partial grants, expiration, revocation, transaction failure and authenticated form routing using fake providers. Current Meta App Review, access tier, external-client consent, provider success and production wiring require separate live evidence.

## MCP client OAuth hardening

This section covers the OAuth server that MCP clients (Claude, ChatGPT, Claude Code, Cursor, VS Code) use against this service: dynamic client registration, /authorize, /token and /mcp. It does not change the product-specific onboarding above.

### Variables

| Variable | Default | Effect |
|---|---|---|
| OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS | empty | Comma-separated exact DNS host names added to the https redirect allowlist (any path). Needed for chatgpt.com, platform.openai.com and vscode.dev. Entries with a scheme, port, path, wildcard or IP address are ignored with a warning. |
| AUTH_DENIED_FB_USER_IDS | empty | Comma-separated Facebook user ids refused everywhere, even when AUTH_ALLOWED_* would admit them. |
| CORS_ALLOWED_ORIGINS | https://claude.ai, https://claude.com | Browser origins accepted on /mcp. Setting it replaces the defaults. |

The rate limits below are constants in code. There is no variable to change them.

### Client registration

POST /register accepts a redirect URI only when it is one of:

- https://claude.ai/api/mcp/auth_callback or https://claude.com/api/mcp/auth_callback, exactly: any other path, a query, a trailing slash, a different case or an encoded or dot-segment spelling is refused.
- https on a host named in OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS, with any path. The host must match exactly: no port, no user information, no trailing dot, no percent-encoded spelling, no subdomain. Listing claude.ai or claude.com there does not widen the pinned path.
- http on a loopback address (127.0.0.1, localhost, [::1]) with any port and path, for CLI clients that listen on an ephemeral port.
- A cursor://, vscode:// or vscode-insiders:// URI that names an application host.

Fragments, wildcards, backslashes, whitespace, control characters, other schemes, plain http to a non-loopback host, more than 10 URIs and URIs over 2048 characters are refused. One refused URI refuses the whole registration with HTTP 400 and the error invalid_redirect_uri. The same check runs when a stored client is read, so a client registered before this policy existed with a URI that is no longer allowed is treated as unknown (invalid_client) until its host is added or it registers again.

Anthropic documents https://claude.ai/api/mcp/auth_callback as Claude's callback and says it may move to https://claude.com/api/mcp/auth_callback, so both are on by default.

chatgpt.com is not a default host. Anyone with a ChatGPT account can publish a Custom GPT whose Action OAuth callback is a path on chatgpt.com, so trusting the host would let an anonymous attacker register a client whose callback hands an approved authorization code to their GPT. To use ChatGPT as a client, set OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS=chatgpt.com (and platform.openai.com for its app review flow); every path on a listed host is then accepted, so the residual risk is the one just described, limited to operators who approve a consent page that names that host. VS Code builds that also register https://vscode.dev/redirect need vscode.dev and insiders.vscode.dev listed the same way. Which client builds register which URIs has not been verified against the real clients.

Two kinds of redirect stay open by design. Loopback http (127.0.0.1, localhost, [::1]) accepts any port and path because CLI clients listen on an ephemeral port (RFC 8252); a process on the operator's machine can bind a port and receive a code the operator approved for a client of the same name. The cursor://, vscode:// and vscode-insiders:// schemes accept any application host, so an application registered for the scheme on the operator's machine, or a deep link such as vscode://attacker.publisher/callback, can receive a code; the consent page shows the full redirect host and scheme so an operator can tell. Neither is a network-attacker risk, and both need the operator to approve a consent page for a client they did not start.

### Authorization codes and tokens

- /token requires the redirect_uri used at /authorize and a PKCE code_verifier (S256). The code is consumed before the verifier is checked, so any failed redemption (wrong verifier, client, redirect_uri or resource) burns the code.
- Access tokens last one hour and refresh tokens 30 days. Refresh tokens rotate on every use.
- Login, GET and POST /authorize, code exchange, refresh and every access-token verification check AUTH_DENIED_FB_USER_IDS, so a denied user loses access on the next request once the process has the new value. Refresh and code exchange also re-run the allowlist, using the email stored at login; a user removed from AUTH_ALLOWED_* keeps a live access token until it expires (up to one hour) but cannot refresh it. Denial returns invalid_grant and burns the refresh token.
- A rotated refresh token presented again after a 60 second grace window revokes every refresh token of that chain; inside the window the replay is only refused, so a client retry does not lose its session. An authorization code redeemed a second time outside the same window revokes the refresh tokens issued from it. Access tokens already issued from either chain stay valid until they expire; the deny list is the immediate cut-off.
- The markers live in the existing mcp_refresh_jti collection with an expiresAt field. A Firestore TTL policy on that field is expected; it has not been verified.
- Error redirects from /authorize carry the client's state parameter.

### /mcp requests

A request that carries an Origin header not listed in CORS_ALLOWED_ORIGINS is refused with HTTP 403 and a JSON-RPC error before authentication. A request without an Origin header (non-browser MCP clients) and OPTIONS preflights are not affected. If a client turns out to send an Origin, add it to CORS_ALLOWED_ORIGINS before deploying. The Host header is not validated. A malformed JSON body on /mcp is answered with a JSON-RPC -32700 error after authentication.

### Rate limits and CSRF

Limits are counted per client address per 15 minutes, with IPv6 addresses grouped by their /64 and IPv4-mapped addresses counted as IPv4:

| Route | Requests |
|---|---|
| /authorize | 120 |
| /auth/meta | 60 |
| /auth/meta/callback | 60 |
| /token | 60 |
| /register | 20 |
| /auth/register-apify-token | 10 |
| /auth/register-gemini-key | 10 |

Exceeding a limit returns HTTP 429. The server trusts one proxy hop (trust proxy = 1); if more proxies sit in front of it, every client shares one address, which has not been checked on the deployment platform.

POST /authorize, /auth/logout, /auth/select-token, /auth/register-system-token and /auth/delete-token refuse a cross-site request: Sec-Fetch-Site is checked first, then Origin, and a request carrying neither header is allowed, as for the Apify and Gemini key routes.

### Logs

The OAuth routes, the OAuth provider and the /mcp token middleware write Facebook user ids and emails to logs only as a 12 character hash (field fbUserId for ids). They do not log authorization codes or tokens.

### Operator checklist before a deploy

1. Decide on OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS for the clients in use (chatgpt.com, platform.openai.com, vscode.dev).
2. Confirm CORS_ALLOWED_ORIGINS covers every browser client that calls /mcp.
3. Confirm the TTL policy on mcp_refresh_jti.expiresAt.
4. Record the deny list procedure: edit AUTH_DENIED_FB_USER_IDS and redeploy. There is no admin endpoint for per-user revocation.
