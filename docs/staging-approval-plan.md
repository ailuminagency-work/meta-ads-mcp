# Isolated staging deployment and approval plan

Status: PROPOSAL_ONLY / HOLD_FOR_DEPLOYMENT_APPROVAL. This document does not provision, deploy, change IAM, apply indexes/TTL, write a registry, authorize Meta consent, or permit spend. Local fake-provider tests and the ongoing frozen integrated suite are engineering evidence. They are not live Meta or staging acceptance.

## Reviewable deployment proposal

Create a new Railway staging service for this candidate, separate from the existing production service, environment variables, domains, database credentials and deployment triggers. Proposed display name: Lumin Meta Platform V1 Staging. The name is a proposal, not a confirmed existing resource. Select the exact reviewed repository/release identity after the frozen suite and independent reviews finish; do not deploy a moving branch head. Record both the immutable release SHA and source-tree/build identity. If the candidate has no approved release SHA yet, deployment remains blocked rather than inventing one for the bootstrap schema.

Use the repository Dockerfile: its build compiles TypeScript, its runtime is the non-root node user, includes FFmpeg, exposes port3000, runs node dist/index.js and checks /health. Set PORT=3000, NODE_ENV=production, META_API_VERSION=v26.0, THREADS_API_VERSION=v1.0 and INSTAGRAM_API_VERSION=v26.0 where those adapters are selected. A green /health is process availability only.

Use a new Google Cloud staging project and its own Native Firestore default database. The current src/store/firestore.ts constructs Firestore with projectId and does not select a named database; this plan therefore does not invent a FIRESTORE_DATABASE_ID setting. FIRESTORE_PROJECT_ID must identify the staging project. Do not point the service at the production project, use a production emulator endpoint, copy production collections, or migrate production records. Region, project ID, billing account, quotas, budget/alerts and cost ceiling must be explicitly reviewed before resource creation. Earlier production-related approvals or a historical monthly limit do not authorize this separate staging cost.

Create a staging-only runtime service account in that project. The bootstrap plan requires roles/datastore.user and forbids roles/owner, roles/editor and roles/datastore.owner. Keep IAM administration, TTL/index installation and registry application under a separately reviewed provisioning identity. Firestore client rules must deny direct browser access; the server SDK uses IAM, so restrictive client rules do not replace IAM verification. Review effective permissions and project binding before storing credentials in Railway.

Configure exactly one supported Google credential source: Railway secret GOOGLE_CREDENTIALS_JSON, which startup materializes as a restricted temporary ADC file, or a reviewed ADC arrangement supplying GOOGLE_APPLICATION_CREDENTIALS. Do not configure both. FIRESTORE_PROJECT_ID (or the supported GOOGLE_CLOUD_PROJECT fallback) must resolve to the new staging project. Never print credential JSON or include it in an artifact.

## Isolation and secret inventory

Generate independent staging TOKEN_ENCRYPTION_KEY (64 hex characters), SESSION_COOKIE_SECRET and OAUTH_SECRET (each at least32 characters). Do not reuse production values. Credential envelopes currently use keyVersion primary with mandatory identity-bound AAD; there is no configurable multi-key fallback to assume. An encryption-key replacement is a separately reviewed migration or reauthorization exercise, not a rollback shortcut.

Configure secret names only in the review packet:

| Purpose | Supported configuration names | Staging rule |
| --- | --- | --- |
| Primary Meta login | META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID | Dedicated staging Meta app/configuration where available; exact reviewed app identity and consent pack. |
| Platform/session encryption | TOKEN_ENCRYPTION_KEY, SESSION_COOKIE_SECRET, OAUTH_SECRET | New staging values; server storage only. |
| Google runtime identity | GOOGLE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS | One staging-only credential source and least-privilege project binding. |
| Threads or independent Instagram | THREADS_APP_ID, THREADS_APP_SECRET; INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET | Supply only for separately approved adapter journeys. |
| Signed ingress, privacy and workers | Secret references named by their strict deployment profiles | Distinct purpose-bound staging keys; configure only when that slice is approved. |

SERVER_URL must be the exact staging HTTPS origin. META_OAUTH_REDIRECT_URI must equal that origin plus /auth/meta/callback. Each trusted platform profile redirectUri must equal the same origin plus /platform/oauth/PROFILE_ID/callback. Use distinct stage_ profile IDs and staging-only profile JSON; do not copy production ciphertext, credential IDs, operator-index rows, approval records or provider token grants. Profile IDs are organizational namespaces, not isolation guarantees: the separate project, keys, issuer app, current client/asset registry and server-side checks provide isolation.

Set CORS_ALLOWED_ORIGINS to the exact approved staging origins, not wildcards. Populate AUTH_ALLOWED_FB_USER_IDS only with freshly inspected app-scoped IDs for the approved staging operators. AUTH_ALLOWED_EMAILS and AUTH_ALLOWED_DOMAINS are supported controls but must not be presumed a replacement for the configured Facebook identity and trusted operator index. Human users complete Meta consent themselves; no token should be pasted into chat.

Agency mode explicitly forbids MCP_API_KEY, META_ACCESS_TOKEN, META_TOKENS, FIRESTORE_EMULATOR_HOST, APIFY_TOKEN and GEMINI_API_KEY. Leave these absent. Paid provider-specific credentials also remain absent while their feature flags are false. Never attach a credit line, change payment methods, or transfer billing ownership. Client ad accounts and billing remain client-owned.

## Locked first deployment

Before Meta credentials are supplied, the proposed first launch uses DEPLOYMENT_MODE=awaiting_credentials. Its intended evidence is a healthy locked service, not usable OAuth or authenticated MCP. All feature flags below remain false. Once the staging-only Meta and Google setup is approved and complete, a separate configuration review may switch to DEPLOYMENT_MODE=agency for controlled acceptance. Agency startup validates HTTPS origin, required secrets, Firestore/ADC and forbidden fallback token settings.

The exact baseline safety flags are:

- AGENCY_WRITES_ENABLED=false and LUMIN_PLATFORM_WRITES_ENABLED=false.
- LUMIN_PLATFORM_ENABLED=false and LUMIN_PLATFORM_OAUTH_ENABLED=false until the staging registry/bootstrap and OAuth review are complete.
- LUMIN_PLATFORM_WEBHOOKS_ENABLED=false, LUMIN_PLATFORM_SIGNALS_ENABLED=false, LUMIN_PLATFORM_MESSAGING_POLICY_ENABLED=false, LUMIN_PLATFORM_OPERATIONS_ENABLED=false.
- LUMIN_FIRST_PARTY_INGRESS_ENABLED=false, LUMIN_CRM_SOURCE_INGRESS_ENABLED=false, LUMIN_CRM_SIGNALS_ENABLED=false, LUMIN_CRM_USER_CREDENTIAL_INSPECTION_ENABLED=false.
- LUMIN_MEDIA_INGRESS_ENABLED=false, LUMIN_VIDEO_INGRESS_ENABLED=false, LUMIN_PAGE_VIDEO_ENABLED=false, LUMIN_PUBLISHING_VIDEO_ENABLED=false.
- LUMIN_MESSAGING_ATTACHMENTS_ENABLED=false, LUMIN_MESSENGER_ATTACHMENTS_ENABLED=false, LUMIN_MESSENGER_UTILITY_ENABLED=false.
- LUMIN_PLATFORM_DISCOVERY_ENABLED=false, LUMIN_SIGNAL_ASSET_DISCOVERY_ENABLED=false, LUMIN_CLIENT_ENROLLMENT_ENABLED=false, LUMIN_BUSINESS_OWNER_BINDINGS_ENABLED=false, LUMIN_ELIGIBILITY_REVIEW_ENABLED=false.
- LUMIN_MARKETING_ACTIVATION_ENABLED=false and LUMIN_MARKETING_DELETION_ENABLED=false throughout this plan, including paused-write acceptance.
- LUMIN_MARKETING_CBO_ENABLED=false, LUMIN_MARKETING_VIDEO_CREATIVE_ENABLED=false, LUMIN_MARKETING_CREATIVE_REPLACEMENT_ENABLED=false, LUMIN_MARKETING_STUDIES_ENABLED=false, LUMIN_MARKETING_APP_PROMOTION_ENABLED=false, LUMIN_MARKETING_APP_PURCHASE_ENABLED=false.
- LUMIN_PAUSED_AD_BATCH_ENABLED=false, LUMIN_TRACKING_CHANGE_ENABLED=false, LUMIN_MARKETING_PREVIEWS_ENABLED=false, LUMIN_INVOICE_METADATA_ENABLED=false, LUMIN_CATALOG_CAMPAIGN_DIAGNOSTICS_ENABLED=false, LUMIN_VIDEO_INSPECTION_ENABLED=false, LUMIN_IMAGE_INSPECTION_ENABLED=false, LUMIN_APP_EVENT_TYPES_ENABLED=false.
- LUMIN_META_PRIVACY_ENABLED=false, LUMIN_PLATFORM_OEMBED_ENABLED=false, LUMIN_HEALTH_ENABLED=false until their exact staging configurations are approved.
- LUMIN_AD_LIBRARY_ENABLED=false, LUMIN_PAID_RESEARCH_ENABLED=false, LUMIN_APIFY_PUBLIC_ADS_ENABLED=false, LUMIN_APIFY_OFFICIAL_ADS_ENABLED=false, LUMIN_GEMINI_TEXT_ENABLED=false. No paid research or vendor run is part of this approval.

All current source-supported LUMIN_*_ENABLED names are enumerated in .env.example with false defaults; verify that exact-name audit again for the final release. Keep profile/binding JSON absent or empty until validated. Relevant exact configuration names include LUMIN_PLATFORM_OAUTH_PROFILES_JSON, LUMIN_MARKETING_APP_PROMOTION_BINDINGS_JSON, LUMIN_WHATSAPP_ENROLLMENT_BINDINGS_JSON, META_WEBHOOK_SUBSCRIPTIONS_JSON, LUMIN_FIRST_PARTY_INGRESS_PROFILES_JSON, LUMIN_MEDIA_INGRESS_PROFILES_JSON, LUMIN_OPERATIONAL_WORKERS_JSON, LUMIN_OPERATIONAL_INGRESS_JSON, LUMIN_WEBHOOK_INDEX_REFRESH_BINDINGS_JSON, LUMIN_META_PRIVACY_IDENTITIES_JSON, LUMIN_META_PRIVACY_WORKERS_JSON and LUMIN_CRM_PROFILES_JSON. Accept only the actual strict schema for each approved adapter; no model-generated grants or arbitrary endpoint configuration.

## Bootstrap and infrastructure review artifacts

Prepare these local artifacts against the final exact release, with no cloud apply side effect:

1. deployment-manifest.json: the exact dryRunProductionBootstrap input, version1, environment staging, approved projectId, releaseSha, staging publicOrigin, same-project serviceAccountEmail, clientBillingOwnership CLIENT_OWNED, verified numeric operatorAllowlist and featureFlags writes/signals/messaging/workers all false.
2. deployment-bootstrap-dry-run.json: actual output of dryRunProductionBootstrap from src/platform/production-bootstrap.ts. Require status DRY_RUN_REVIEW_REQUIRED and retain manifestHash/releaseSha, IAM requirements, indexes, every TTL row and requiredEvidence. This function creates no service, IAM rule, index or TTL policy.
3. registry-manifest.json and registry-bootstrap-dry-run.json: actual dryRunRegistryBootstrap input/output from src/platform/registry-bootstrap.ts. Require REGISTRY_DRY_RUN_OWNER_REVIEW_REQUIRED, complete tenant/member/client/operator-index/asset parent closure, explicit provenance, fresh real evidence, absent or exact beforeHash preconditions and reviewed hashed write paths. No credential, grant or approval import is provided by this dry-run API.
4. staging-environment-review.json: allowlisted variable names, safe flag values, secret presence/match booleans, issuer/project/origin bindings and configuration hashes. Exclude raw secret values, tokens, customer data and credential-bearing URLs.
5. infrastructure-apply-review.md: exact IAM/index/TTL/registry changes, staging-only targets, owner approval and rollback/disable steps. The candidate contains planners, not an approved blanket apply executor; use a separately reviewed provisioning procedure and preserve every CAS prerequisite.

The actual dry-run index plan includes CRM scopeHash/leadHash source and stage-journal queries; client/event/timestamp audit queries; scoped health timestamps; all four event-inbox product/asset filter variants; webhook-event status/nextAttemptAt and status/leaseUntil queries; and worker-job state/nextAttemptAt queries. Do not replace the emitted field order or assume indexes are active before query verification.

Apply only the emitted REQUIRED_TTL_PLANS after review, including signalDiscoveryProposals and appPromotionProposals (five minutes), review/source/media records, operational details and completed privacy records. Preserve conditional retention exactly. In particular:

- No TTL on platform_crm_no_resend, WhatsApp ambiguous phone locks, privacy subject locks or privacy provenance.
- No TTL on unresolved research financial checkpoints; a research budget with nonzero reservedCents must not expire.
- No expireTime on unfinished privacy jobs/receipts/connection targets. Completion scrubs identifiers, actively deletes temporary targets and starts the ninety-day completed jobs/receipts retention. Worker nonces have a two-minute TTL.
- Business-owner artifacts have no storage TTL in the current bootstrap plan; authorization checks their finite at-most24-hour validity and privacy cleanup removes subject-bound records. The business-owner-bootstrap.md guide follows this same production-bootstrap.ts invariant.

TTL deletion is asynchronous storage cleanup, never an authorization clock or permission to retry UNKNOWN. Verify policy state and required indexes independently; do not wait for eventual deletion to deny expired access.

## Approval boundary

The deployment approval packet must identify: exact release/build, new Railway project/environment/service/domain, new Google project/default database/region, runtime and provisioning IAM identities, billing owner and explicit staging cost ceiling, exact bootstrap hashes/writes, secret destination names, OAuth app/configuration/redirects and operator allowlist, initial false flags, accepted manual client ownership/billing evidence model, permitted test accounts and rollback target.

Only after that concrete packet is reviewed may provisioning, secret installation, staging bootstrap or deployment occur. Approval to deploy a locked/read-only service does not authorize provider writes, consent on someone else's behalf, messaging, CAPI/CRM sends, paid research, activation, deletion, or production migration. The historical fifty-dollar answer and earlier production setup approvals are not inherited authorization for this proposal.

## Staged acceptance checklist

Record actual timestamps, release/build identity, app/project/origin and redacted evidence per journey. Mark blocked/unknown honestly; local test passes do not substitute for these checks.

### Locked and read-only stage

- Verify new service/project/key/origin isolation, clean deployment logs and no production resource or provider action. Confirm restart retains intended state in the staging database.
- Verify /health, HTTPS behavior, unauthenticated /mcp challenge and OAuth discovery. These are prerequisites only.
- After separate approval, enable LUMIN_PLATFORM_ENABLED and LUMIN_PLATFORM_OAUTH_ENABLED for the reviewed staging profiles; both write switches remain false. Apply only the approved complete staging registry closure.
- Complete human Meta consent/callback using the staging issuer and exact redirect. Inspect same-app identity, actual granted scopes/tasks/expiry and registered client roots. Never interpret a returned public ID as an automatic grant.
- Authenticate Codex MCP; verify initialize, tools/list and one real authorized read. Verify a second client/foreign asset is denied. Inspect truthful capability HOLD reasons instead of treating registration as access.
- Verify human review pages reject foreign origin, CSRF/replay, changed profile/credential, withdrawn membership or client mapping. Test safe revocation with a dedicated staging grant, then confirm old access fails before further data or mutation egress.

### Separately approved paused-write stage

- Owner approves the exact dedicated client-owned test ad account, current billing/Business artifact and bounded paused creation plan. No spend authorization is implied by creating a budgeted PAUSED object.
- Review the actual scopes/tasks/access artifacts and fresh readonly compatibility/ownership evidence. Enable only the required slice and both AGENCY_WRITES_ENABLED and LUMIN_PLATFORM_WRITES_ENABLED for the scheduled acceptance window. Activation/deletion/paid/messaging/signals remain false.
- Prepare one typed plan; a current authenticated human approves that exact client/actor/asset/body/revision hash. Execute one request. Verify actual provider configured status PAUSED, correct parent/account/Page/creative references and durable operation/audit/registry completion. Receipt acceptance is not delivery or an outcome.
- Use a separate fresh review/approval for each next creation. Do not auto-chain or reuse approvals. For APP PURCHASE, independently enable its flag only after the exact SDK currency/value/source artifact and actual event-name corroboration are reviewed; metadata is not optimization certification.
- Confirm repeated/expired approvals and mid-flight credential/grant/operator-index withdrawal are denied. For transport uncertainty retain UNKNOWN/PARTIAL and permanent one-attempt barriers; reconcile by an explicit readonly investigation, never automatic resend.
- Return both write switches to false when the window ends. Keep created test objects PAUSED; any cleanup provider deletion needs a separate explicit owner approval.

### Revocation and rollback drill

- Revoke a staging connection locally, exercise the supported provider-consent withdrawal/deauthorization path under separate approval, and verify actual provider-subject and platform-operator lock coverage. Do not revoke any production grant or entire app user unintentionally.
- Verify privacy/revocation workers only after their exact signed configuration is separately approved. Check pending tombstones, consumed approvals, publication/deletion/repoint claims, customer no-resend barriers and reserved-spend records survive restarts and rollback.
- Disable write/ingress/worker flags first. Roll back only the staging image to the exact recorded compatible release, or stop the new staging service. Do not restore an old database snapshot over newer locks/audit/consumed approvals, delete ambiguity claims, reuse old secrets to bypass revocation, or point production at the staging database.
- Confirm production service/deployment/database/environment are unchanged. Preserve redacted evidence and staging logs; set final status to accepted, blocked or rejected for each individual journey.

Owner acceptance and a new production rollout proposal are required after staging. This plan grants no production deploy, production write or advertising spend authority.
