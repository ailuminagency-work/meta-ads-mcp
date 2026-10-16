# Candidate environment reference

No values in this document are credentials. No production variables were changed.

| Variable | Purpose and enabling rule |
|---|---|
| LUMIN_PLATFORM_ENABLED | Strict platform mode. Defaults off; do not enable until registry migration and acceptance. |
| LUMIN_PLATFORM_WRITES_ENABLED / AGENCY_WRITES_ENABLED | Both must be true for provider mutations; human approval and exact client evidence remain necessary. |
| LUMIN_PLATFORM_OAUTH_ENABLED | Product-specific protected connection routes; also requires platform flag. |
| LUMIN_PLATFORM_OAUTH_PROFILES_JSON | Strict deployment-owned metadata only: profile ID/provider/app ID/strategy/scopes/token types/callback/authorize URL/configuration ID/secret reference/capabilities/actions/tasks. No inline secrets. |
| META_APP_ID / META_APP_SECRET | Facebook app identity and secret, kept in the platform store. Existing production app is unchanged. |
| THREADS_APP_ID / THREADS_APP_SECRET | Separate Threads app identity and secret for verified Threads READ onboarding. |
| INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET | Independent Instagram Login identity; concrete token-inspection adapter remains HOLD. |
| META_API_VERSION | Existing version resolver; Facebook candidate verified contracts are v26.0. |
| THREADS_API_VERSION | Candidate verified v1.0; changing versions requires contract validation. |
| INSTAGRAM_API_VERSION | Explicitly required by the Instagram client; no guessed version. |
| LUMIN_PLATFORM_WEBHOOKS_ENABLED | Requires strict platform flag and trusted subscription mapping. |
| META_WEBHOOK_SUBSCRIPTIONS_JSON | References-only subscriptions bound to exact app identity, product and named secrets. See webhook-environment.md. |
| META_WEBHOOK_VERIFY_TOKEN / INSTAGRAM_WEBHOOK_VERIFY_TOKEN | Separate secret values for the configured provider's webhook challenge. |
| LUMIN_PLATFORM_MESSAGING_POLICY_ENABLED | Installs trusted recipient/window/consent policy; absent evidence denies sends. |
| MESSAGING_RECIPIENT_HMAC_KEY | Dedicated 32-byte key encoded as64 hex characters; secrets store only. |
| LUMIN_PLATFORM_SIGNALS_ENABLED | Requires platform flag and reviewed first-party source integration. |
| LUMIN_FIRST_PARTY_ADAPTER_ID | Approved private integration identifier; setting it does not install or establish that integration. Empty source records remain HOLD. |
| TOKEN_ENCRYPTION_KEY | Existing encryption secret; encrypts scoped credentials and private source/approval content. Never rotate without migration planning. |
| SERVER_URL | Exact HTTPS service origin; provider callback paths must match this origin and profile ID. |

Existing session/OAuth/Firestore configuration remains subject to the baseline security configuration and Railway secret store. Google service-account credentials must remain platform-managed. No new credential should be pasted into chat, committed, or supplied through an MCP argument.

Firestore operations still require separately reviewed TTL and indexes. Enable expireTime TTL on approvalRequests, platform_connection_challenges, platform_webhook_events, platform_messaging_state, platform_messaging_events, platform_messaging_audit, platform_first_party_sources (maximum7 days), platform_first_party_source_audit (90 days), platform_signal_dispatch and platform_signal_dispatch_audit (90 days). Use the source modules and webhooks.md for exact collection-group names before applying any migration. Application expiry is enforced even before asynchronous deletion.
