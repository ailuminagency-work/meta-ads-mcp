# Lumin Railway deployment

This fork supports a locked credential-waiting deployment and a read-only agency runtime. Client accounts and their billing remain owned by clients. No payment credential belongs in this service.

## Locked deployment

`DEPLOYMENT_MODE=awaiting_credentials` starts only the health server. `/health` reports `awaiting_credentials`; `/ready`, MCP, OAuth, and every other route return HTTP 503. The provider runtime is not loaded. Adding credentials does not activate the integration. Railway uses `/health` to accept this intentionally inactive deployment.

The service uses one replica, 1 GB RAM, one CPU, port 3000, Dockerfile builds, and video concurrency one. Development dependencies are removed from the runtime image. The upstream Google Cloud Run workflow is manual-only. Deploy a pinned reviewed commit.

## Credentials to supply through Railway variables

| Variable | Required configuration |
| --- | --- |
| META_APP_ID | Lumin-owned Meta Developer App ID |
| META_APP_SECRET | That app's secret |
| TOKEN_ENCRYPTION_KEY | Independently generated random 32 bytes encoded as 64 hexadecimal characters |
| SESSION_COOKIE_SECRET | Independently generated random secret of at least 32 characters |
| OAUTH_SECRET | Separate random signing secret of at least 32 characters |
| AUTH_ALLOWED_FB_USER_IDS | Comma-separated approved agency operator IDs; exact IDs are preferred |
| AUTH_ALLOWED_EMAILS / AUTH_ALLOWED_DOMAINS | Optional alternative login allowlists; broad domain access permits all users in that domain |
| FIRESTORE_PROJECT_ID | Dedicated Google Cloud project with Firestore Native mode enabled |
| GOOGLE_CREDENTIALS_JSON | Secure ADC service-account or external-account JSON configuration; written to an ephemeral private file at agency startup |
| SERVER_URL | https://meta-ads-mcp-production-9d28.up.railway.app |
| META_OAUTH_REDIRECT_URI | https://meta-ads-mcp-production-9d28.up.railway.app/auth/meta/callback |

Alternatively, provide `GOOGLE_APPLICATION_CREDENTIALS` pointing at a securely provisioned ADC file, instead of `GOOGLE_CREDENTIALS_JSON`. For service accounts, grant only the needed Firestore data access (typically roles/datastore.user), not project Owner/Editor or deployment permissions. Prefer workload identity federation when an actual trusted external identity is available; a configuration file alone does not establish that identity.

Never put real secrets in GitHub, documentation, logs, or chat. Do not set MCP_API_KEY, META_ACCESS_TOKEN, META_TOKENS, FIRESTORE_EMULATOR_HOST, APIFY_TOKEN or GEMINI_API_KEY in agency mode. These are rejected. Never use production Firestore data in tests.

## Meta app and permissions

Configure the Marketing API and the appropriate Facebook Login product for the app. Register the exact callback above, HTTPS app domain, privacy policy, and data deletion process. The current OAuth implementation requests ads_management, ads_read, pages_show_list, pages_read_engagement, business_management, whatsapp_business_management, email and public_profile. WhatsApp is bundled by upstream and is not necessary for ordinary ads management. Do not silently assume unapproved permissions are available. Review the requested permission set and Meta's current app-review requirements when configuring the real app.

Managing external clients requires the appropriate approved access for requested permissions, business verification where required, app mode suitable for external users, and explicit asset grants. Higher Marketing API rate-limit access is separate from permission approval. Credentials alone do not prove any of these conditions.

## Deliberate activation and acceptance

After securely supplying the complete configuration, deliberately change DEPLOYMENT_MODE to agency and redeploy the pinned commit. Invalid or incomplete configuration fails startup. Agency mode rejects shared credential bypasses and caller-supplied Meta token overrides; requests use the OAuth user's encrypted stored token. With AGENCY_WRITES_ENABLED=false (the deployed default), Meta mutation tools, paid video analysis and Ads Library tools are disabled. Keep this false for initial OAuth and read-only acceptance. Explicitly setting true enables the upstream write tools and their existing capabilities, including activation and destructive operations; do that only after approved client assets, live permission checks and human authorization for the rollout. Adding credentials alone does not change either switch.

Verify OAuth round trip, login allowlist rejection, usable ADC/Firestore read and write access, encrypted token persistence after restart, refresh/revocation, and read-only client account access. Register the remote MCP endpoint at SERVER_URL/mcp only after these checks. Use /ready only in waiting mode to distinguish intentional inactivity; active mode retains the upstream health contract and requires live acceptance checks.

The authorization boundary is the assets Meta grants to the authenticated agency operator. This fork does not implement separate per-client account RBAC. For strict client isolation, add a reviewed client/asset mapping covering indirect campaign, ad set, ad and creative IDs before admitting client users. Clients keep their ad accounts, Pages, Instagram assets and payment methods, and grant Lumin partner access. No account or billing ownership transfer is required.

Enabling campaign builds requires deliberate write enablement, selected client assets, and a paused test campaign inspection before any activation authorization. The upstream tools default new entities to PAUSED but can accept ACTIVE; they do not enforce a per-operation human approval or spend cap. For autonomous operation, add those policies before granting unattended write access. The waiting deployment is ready to receive credentials; it is not live Meta integration proof.
