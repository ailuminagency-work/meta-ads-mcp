# App-install promotion candidate

This module is local engineering in progress. It has not been deployed, exercised against a live client app, or accepted on staging. No credentials, Meta assignments, billing configuration, live campaign, or provider grant was changed by this work.

The promoted client application ID is separate from the OAuth application's identity. The proposed connection uses an explicitly configured Marketing USER profile and existing registered client ad-account and Page roots. OAuth checks the actual same-app user token, exact permissions, actual account manage task, filtered account `advertisable_applications` membership, application store metadata and the literal Page `ADVERTISE` task. It does not automatically install an APP grant.

After those reads, `meta_prepare_app_promotion_access` prepares a short-lived encrypted proposal. An authenticated connection administrator reviews `/platform/app-promotion/:proposalId`, including the client, app ID, account, Page and exact store destination. The signed review is bound to the current principal, plan hash and five-minute deadline. Enrollment is atomic with proposal consumption, narrow APP grant, connection update and audit. A changed credential, role, client, provider subject lock, root record or registry definition denies enrollment. There is no model-accessible enrollment setter.

The environment flags are disabled by default:

| Variable | Candidate purpose |
| --- | --- |
| `LUMIN_PLATFORM_ENABLED` | Select the strict platform candidate. |
| `LUMIN_MARKETING_APP_PROMOTION_ENABLED` | Opt into this module only after owner review. |
| `LUMIN_MARKETING_APP_PROMOTION_BINDINGS_JSON` | Immutable deployment-owned app enrollment definitions, at most 16. Contains metadata only. |
| `LUMIN_PLATFORM_OAUTH_PROFILES_JSON` | Immutable OAuth profiles containing the exact `appPromotionBinding`. |
| `SESSION_COOKIE_SECRET` | Existing secure session/CSRF secret reference. Never put its value in documentation. |
| `TOKEN_ENCRYPTION_KEY` | Existing AES encryption key. Never put its value in documentation. |

Each app enrollment definition contains `profileId`, canonical SHA-256 `profileHash`, OAuth `issuerAppId`, `binding`, and exact approved `capabilities`, `actions`, `scopes`. Its binding contains `tenantId`, `clientId`, `applicationId`, `accountId`, `pageId`, canonical HTTPS `storeUrl`, and `platform` (`IOS` or `ANDROID`). Runtime requires an exact current OAuth profile hash and matching pack; missing or changed deployment metadata stays on HOLD. These JSON settings must not contain access tokens, app secrets or private credentials.

The current renewal adapter is human-review-only and bounds authority to the already enrolled account, Page and APP. It re-reads account tasks, app assignment/store metadata and current Page tasks under the same primary USER credential. Historical enrollment evidence timestamps remain unchanged. It cannot add a different app, broaden a capability/action pack, transfer Page tasks onto an app or refresh unknown descendants. The bounded renewal adapter also checks the registered app-install campaign, ad set, image creative, image and single AD against fixed actual provider reads. Once an AD exists, Page task inspection uses its exact registered ID. Initial enrollment evidence remains historical even after its deadline; current asset/grant access dates come only from fresh provider observations. Financial ownership observations and billing attestations retain their separate original dates and require their own refresh or review.

The local candidate implements a typed paused `OUTCOME_APP_PROMOTION` campaign, `APP_INSTALLS` ad set with exact app/store/mobile targeting, registered-image `INSTALL_MOBILE_APP` creative and paused AD. Every step requires a separately observed exact intent and human approval. A fake-provider native test exercises actual OAuth processing, human app enrollment, provider image discovery and human image enrollment, then the original SDK tool interfaces and atomic registration for all four creation steps. It also exercises the actual supervised renewal service after ten minutes, with expired initial APP evidence/grants, while preserving historical app and financial evidence. These are local engineering tests, not Meta acceptance, delivery, staging or deployment evidence. Runtime mounting and release remain gated by independent review and the final integrated checks. Purchase/app-event optimization remains an explicit engineering HOLD until the actual event-discovery and eligibility response contract is verified. Token consent and app-assignment reads do not establish event delivery, app ownership, installation attribution or live provider acceptance.

Primary contract evidence includes the current Meta [mobile app ads guide](https://developers.facebook.com/documentation/ads-commerce/marketing-api/mobile-app-ads), [app ads overview](https://developers.facebook.com/documentation/app-ads), and official current Python SDK `AdAccount.get_advertisable_applications`, `Application.object_store_urls`, `Campaign.OUTCOME_APP_PROMOTION`, `AdSet.APP_INSTALLS`, and `INSTALL_MOBILE_APP` creative CTA. The guide retains older objective wording in its introduction; the bounded modern example and current SDK take precedence for the planned candidate. No minimum scope or app-event eligibility is inferred from an SDK field alone.

Promoted-app event-name observations are described in [app-event-types.md](app-event-types.md). They are separately disabled by default and require their own approved capability and current manual eligibility evidence. Observing a named event does not unlock app-event optimization or certify delivery.

## Purchase app-event optimization candidate

The optional immutable binding field optimizationMode: PURCHASE selects only OFFSITE_CONVERSIONS, IMPRESSIONS and promoted_object.custom_event_type PURCHASE. Omitted optimizationMode preserves the original APP_INSTALLS binding hash; no default property is inserted. LUMIN_MARKETING_APP_PURCHASE_ENABLED remains false unless explicitly configured. VALUE optimization, arbitrary/custom events and activation are excluded.

Before any action, a separate current protected human artifact must review the exact app SDK/source integration and required Purchase currency/value implementation. Its maximum lifetime is five minutes and it binds the selected credential identity, client and immutable app binding. The fixed readonly app_event_types query must also observe fb_mobile_purchase; only event_name values enter encrypted compatibility evidence. This corroborates an observed event name and does not certify event delivery, app optimization eligibility or business outcomes. Each paused creation still requires its own human action approval.

Primary API shape: https://developers.facebook.com/documentation/app-ads/optimizing-your-app-ad#app-events-opt-via-api . Native fixtures exercise provider acceptance only; live Meta acceptance remains a staging gate.
