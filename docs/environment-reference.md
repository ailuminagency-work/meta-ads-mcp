# Candidate environment reference

No values in this document are credentials. No production variables were changed.

| Variable | Purpose and enabling rule |
|---|---|
| LUMIN_META_PRIVACY_ENABLED | Default false. Enables signed provider deauthorization/deletion callbacks and a separately signed bounded cleanup worker. It is independent of provider mutation flags. |
| LUMIN_META_PRIVACY_IDENTITIES_JSON | Deployment-owned callback profile IDs with exact configured app/secret-reference bindings. Only META_APP_SECRET, THREADS_APP_SECRET or INSTAGRAM_APP_SECRET may bind their matching app IDs; no inline secrets. |
| LUMIN_META_PRIVACY_WORKERS_JSON | Unique worker IDs, named LUMIN_PRIVACY_WORKER_KEY_* references, and exact allowed app IDs. Each referenced 32-byte hexadecimal key belongs in the platform secret store. |
| LUMIN_PLATFORM_ENABLED | Strict platform mode. Defaults off; do not enable until registry migration and acceptance. |
| LUMIN_PLATFORM_WRITES_ENABLED / AGENCY_WRITES_ENABLED | Both must be true for provider mutations; human approval and exact client evidence remain necessary. In agency mode AGENCY_WRITES_ENABLED=true is refused at startup unless LUMIN_PLATFORM_ENABLED=true too, so the baseline write tools never run without the policy engine. |
| LUMIN_PLATFORM_OAUTH_ENABLED | Product-specific protected connection routes; also requires platform flag. |
| LUMIN_PAUSED_AD_BATCH_ENABLED | Default false. Enables encrypted bounded paused-ad proposals and protected step-by-step review. Each provider mutation still requires its own current approval. |
| LUMIN_TRACKING_CHANGE_ENABLED / LUMIN_MARKETING_CREATIVE_REPLACEMENT_ENABLED | Both default false. Enable the protected one-ad tracking replacement workflow; creation and repoint remain separate approvals, with permanent uncertainty holds. |
| LUMIN_MARKETING_STUDIES_ENABLED | Default false. Enables only the reviewed classic two-campaign split-study subset for a client admin with an immutable scoped OAuth profile. Does not activate campaigns or certify experiment eligibility. |
| LUMIN_MARKETING_PREVIEWS_ENABLED | Default false. Requires the strict platform, HTTPS and authenticated session configuration. Private existing-ad iframe URLs stay in the authenticated browser; MCP receives only a local preview path. |
| LUMIN_PLATFORM_OAUTH_PROFILES_JSON | Strict deployment-owned metadata only: profile ID/provider/app ID/strategy/scopes/token types/callback/authorize URL/configuration ID/secret reference/capabilities/actions/tasks. No inline secrets. |
| META_APP_ID / META_APP_SECRET | Facebook app identity and secret, kept in the platform store. Existing production app is unchanged. |
| THREADS_APP_ID / THREADS_APP_SECRET | Separate Threads app identity and secret for verified Threads READ onboarding. |
| INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET | Independent Instagram Login identity for the reviewed code-exchange and actual account inspection adapter. Fresh permission renewal requires supervised OAuth. |
| META_API_VERSION | Existing version resolver; Facebook candidate verified contracts are v26.0. |
| THREADS_API_VERSION | Candidate verified v1.0; changing versions requires contract validation. |
| INSTAGRAM_API_VERSION | Explicitly required and restricted to reviewed v26.0 contracts; no guessed version. |
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

Additional V1 staging configuration (all optional runtimes remain off until explicitly enabled):

| Variable | Purpose and enabling rule |
|---|---|
| SESSION_COOKIE_SECRET | Existing session signing secret, at least 32 characters; also signs principal-bound human reviews. Store only in the deployment secret store. |
| LUMIN_PLATFORM_DISCOVERY_ENABLED | Enables read-only asset discovery and encrypted human enrollment review. Discovery does not grant assets automatically. |
| LUMIN_WHATSAPP_ENROLLMENT_BINDINGS_JSON | Owner-reviewed, exact client/business/WhatsApp/Messaging/phone assignment metadata. It cannot substitute for actual OAuth, granular access, client ownership or App Review. See whatsapp-onboarding.md. |
| LUMIN_MEDIA_INGRESS_ENABLED / LUMIN_MEDIA_INGRESS_PROFILES_JSON | Signed JPEG intake and human review, with an approved immutable CDN adapter. No arbitrary URL fetching. See trusted-media-ingress.md. |
| LUMIN_MEDIA_INGRESS_KEY_* | Unique per-profile 32-byte hex HMAC secret references; values never appear in profile JSON. |
| LUMIN_FIRST_PARTY_INGRESS_ENABLED / LUMIN_FIRST_PARTY_INGRESS_PROFILES_JSON | Signed private first-party event/consent intake; requires the platform and reviewed adapter identity. Intake alone never dispatches conversions. |
| LUMIN_FIRST_PARTY_INGRESS_KEY_* | Unique approved first-party profile HMAC secrets, kept in the deployment secret store. |
| LUMIN_PLATFORM_OPERATIONS_ENABLED | Enables authenticated lifecycle, reconciliation, paused-job review and bounded signed worker ticks. |
| LUMIN_OPERATIONAL_WORKERS_JSON | Deployment-owned worker identities, exact client/asset scopes, approved adapter IDs and unique key references. |
| LUMIN_WORKER_KEY_* | Independent 32-byte hex worker signing secrets; never embed in worker JSON or HTTP bodies. |
| LUMIN_OPERATIONAL_INGRESS_JSON | Exact verified webhook scope to local inbox adapter/operator mapping. New jobs remain paused. |
| LUMIN_WEBHOOK_INDEX_REFRESH_BINDINGS_JSON | Exact existing webhook mappings eligible for supervised grant-inspection lease renewal; no new grants or mappings. |

Use the pure registry and production bootstrap dry runs to produce the complete candidate index, TTL and IAM review plan from the final source. The earlier collection list above is not an apply script or an exhaustive migration plan: V1 also includes discovery/media proposals, targeting evidence, lifecycle locks, worker nonce leases and the metadata event inbox. No migration, key creation, scheduler activation or provider subscription is performed by writing this reference.

### Instant Form CRM stages

`LUMIN_CRM_SIGNALS_ENABLED` and `LUMIN_CRM_SOURCE_INGRESS_ENABLED` default to false. Enabling either requires the platform flag, exact Meta app ID, a 32-byte secret `LUMIN_CRM_SUBJECT_HMAC_KEY` and bounded `LUMIN_CRM_PROFILES_JSON`. Profiles bind tenant/client/app/Pixel, separate dispatch and lead-read connection IDs, signed webhook subscription and immutable ordered funnel. Each profile names a separately stored ingress HMAC secret; secret values never belong in profile JSON or source control.

The source endpoint is `/platform/crm/source` and accepts only authenticated signed first-party records. Signed CRM input alone cannot prove Meta lead origin: the runtime also requires the actual signed Meta leadgen event and a current authorized Graph metadata read. The dedicated dispatch tool accepts source/consent references and an explicit selected connection, never raw events or tokens. A reviewed trusted credential inspector must prove the selected credential's exact app/Pixel compatibility; absent inspection keeps dispatch unavailable. Local test adapters do not establish real Events Manager token compatibility.

The staging bootstrap dry-run includes source, signed-origin, delivery deduplication, stage journal/audit and customer-consent revocation retention. Installing those TTL/index policies remains a separately approved staging action. Default-off configuration performs no CRM provider egress.

CRM retention includes a separate `platform_crm_no_resend` safety ledger with **no TTL**. It contains only minimal HMAC pseudonymous scope/lead/stage hashes and attempt or customer-withdrawal state. It is not anonymous data. Removing expired detailed journals, encrypted sources, Meta origin references or customer metadata must not remove the no-resend barrier. After detailed history expires, any stage requiring that history remains blocked for reconciliation. The ledger contains no raw lead IDs, contact details, tokens, messages or event payloads.

The CRM customer-hashing secret and immutable funnel are pinned to a permanent scope namespace in the no-resend ledger. Changing either across a restart must block dispatch pending an explicit history-preserving migration; it must never create a fresh implicit send history. Encryption-key rotation is a separate operation and does not authorize changing the CRM subject-hashing namespace.

Legacy Marketing reads now expose a protected, one-hour human access observation through the existing eligibility review service. That observation does not grant Meta scopes or assets or certify Meta approval. A newly issued durable observation is checked with its exact issuer, identity and expiration and is included in permit snapshots; withdrawal or issuer revocation blocks use. Fixture-only metadata is not evidence of completed real onboarding.

The current [Meta Marketing authorization guide](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization), updated May 5, 2026 and inspected October 16, distinguishes permission access levels (Standard/Advanced) from the Marketing API access tier (Limited/Full). Managing other businesses' accounts requires Advanced access to the relevant ads permissions. The current candidate records required human observations; it does not establish Lumin's actual approval or tier. Legacy WRITE access observations are bounded to five minutes and can be reviewed through the minutes-based human form. Other requirement lifetimes remain bounded by their individual policy. Reviewing access never grants provider permissions or changes account ownership/billing.

The default-off `LUMIN_APP_EVENT_TYPES_ENABLED` enables only registered promoted-app event-name observations, with the immutable app-promotion profile and USER consent. It grants no optimization or event-send authority. See [app-event-types.md](app-event-types.md).

`LUMIN_CRM_USER_CREDENTIAL_INSPECTION_ENABLED` defaults false and installs only the concrete same-app USER token inspector for signed CRM conversion-lead dispatch. `LUMIN_CRM_SIGNALS_ENABLED`, immutable source profiles, actual selected-client Pixel/account access, independent ownership/financial review and separately approved source-truth events remain required. Dedicated Events Manager and system-user token inspection are not inferred.

Optional public-ad acquisition uses default-off `LUMIN_APIFY_PUBLIC_ADS_ENABLED`, deployment-owned metadata in `LUMIN_APIFY_PUBLIC_ADS_POLICY_JSON`, and `LUMIN_APIFY_API_KEY` in the platform secret store. Enabling a flag does not approve a vendor, authorize spend or issue a job approval. The pinned actor/build and one-request run cap require current human policy review; no provider idempotency or invoice amount is invented.

`LUMIN_APIFY_OFFICIAL_ADS_ENABLED` separately enables the explicitly reviewed Apify-maintained actor adapter. `LUMIN_APIFY_OFFICIAL_ADS_POLICY_JSON` fixes its actor/build and bounded run policy; `LUMIN_APIFY_OFFICIAL_API_KEY` belongs only in the platform secret store. This mode never silently borrows a community actor's output schema. Public media observations are decoded ephemerally under separate purpose/provenance, with a short private cache and a final current job/identity checkpoint; they create no client Meta asset grants. Provider selection, secrets and paid use remain separate human decisions.

### Hardening round 1 (G3 findings)

| Variable | Purpose and enabling rule |
|---|---|
| MCP_MAX_IN_FLIGHT | Default 16. Authenticated `POST /mcp` requests allowed in flight on one instance; the next gets 429 with Retry-After. A set value must be a positive integer up to 1000 or startup fails. |
| MCP_RATE_LIMIT_PER_MINUTE | Default 120. Calls per authenticated subject in a sliding minute, refused with 429 and Retry-After beyond it. A set value must be a positive integer up to 100000 or startup fails. |
| LUMIN_INGRESS_ALLOW_LEGACY_BODY_SIGNATURE | Default unset. Outside test and development runs the media, video, attachment and publishing-video ingress routes require the pre-authenticated `x-lumin-request-signature` header and refuse a request that has only the body signature. Setting this to exactly `true` re-admits the body-only signature, which can only be checked after the body is buffered; leave it unset. |
| LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER | Agency startup accepts only unset, `true` or `false` (any letter case) and refuses anything else, so a misspelled value cannot silently read as false. When true, the operator who requested an approval cannot also issue it. |
