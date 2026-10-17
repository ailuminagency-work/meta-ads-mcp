# Frozen-candidate V1 scope reconciliation

Audit date: 2026-10-16. Final source-only comparison of `../platform-expansion-request.txt`, its 15 modules and 25 DoD items, against `generated-tool-inventory.json`. This audit edits documentation only. The release lead regenerated the final source inventory after image/trends/list implementation. Full-suite 9 was intentionally stopped as a source-changing diagnostic; frozen full-suite 10 is **pending**; no pass, deployment or live-provider acceptance is claimed.

Final generated inventory: **370 registered tools; 142 preserved baseline names (65 strict reads, 32 strict write subsets, 1 review workflow, 44 HOLD); 183 canonical definitions (177 verified bounded contracts, 6 HOLD); 45 controls/workflows.** Registration and endpoint verification do not establish live access or whole-module completeness. The generated label ENGINEERING_MIGRATION_HOLD is coarse; classifications below explain the actual boundary.

## All six canonical HOLDs

| Tool | Classification | Exact scope implication |
|---|---|---|
| business_get_asset_permissions | UNVERIFIED CONTRACT / UNFINISHED | A universal BUSINESS/assigned_users schema is not verified. Specific Business user/system-user/asset inventory and catalog assigned-user reads exist; they are not universal permission parity. |
| pages_delete_post | ACTUAL META ELIGIBILITY RESTRICTION | Current PagePost reference limits deletion to select developers. Lumin eligibility is unverified; do not turn this into an available tool. |
| signals_send_events | PARTIAL REPLACEMENT + UNFINISHED | Registered AdsDataset metadata READ exists, but generic DATASET event identity/permission contract remains unverified. Trusted Pixel, physical-store eligibility/offline-quality and CRM lead-stage dispatch are separate supported routes. |
| whatsapp_platform_register | MANUAL-ONLY REPLACEMENT | Protected setup-only v4 OAuth lease and human PIN registration replace MCP secret entry; current endpoint-specific minimum-scope/version ambiguity remains documented. |
| whatsapp_platform_request_code | MANUAL-ONLY REPLACEMENT | Protected setup UI handles phone verification request with exact client/BISU binding; no OTP/PIN model arguments. |
| whatsapp_platform_verify_code | MANUAL-ONLY REPLACEMENT | Protected human secret-entry command handles verification with durable no-resend checkpoints; no model-visible code. |

## All 44 current original-name HOLDs

A bounded replacement closes only its stated subset. It is not backward-compatible implementation of the old broad schema. UNFINISHED and UNVERIFIED CONTRACT are engineering/primary-contract work, not external credential gates.

| Original tool | Classification | Replacement or remaining work |
|---|---|---|
| ads_delete_campaign | UNFINISHED | No strict tenant-scoped destructive/clone implementation; AD-only control and paused batch creation do not supply campaign/ad-set deletion or clone parity. |
| ads_clone_ad_set_bundle | UNFINISHED | No strict tenant-scoped destructive/clone implementation; AD-only control and paused batch creation do not supply campaign/ad-set deletion or clone parity. |
| ads_delete_ad_set | UNFINISHED | No strict tenant-scoped destructive/clone implementation; AD-only control and paused batch creation do not supply campaign/ad-set deletion or clone parity. |
| ads_insights_auction_ranking_benchmarks | UNVERIFIED CONTRACT / UNFINISHED | Current universal benchmark endpoint/meaning is not established. Fixed Insights exist; no fabricated peer benchmark or claim of a Meta prohibition. |
| ads_insights_industry_benchmark | UNVERIFIED CONTRACT / UNFINISHED | Current universal benchmark endpoint/meaning is not established. Fixed Insights exist; no fabricated peer benchmark or claim of a Meta prohibition. |
| ads_get_targeting_description | UNFINISHED | Reviewed taxonomy/search/estimate tools exist; this general targeting-description contract is not migrated. |
| ads_create_budget_schedule | UNFINISHED | Typed budgets/CBO exist; scheduling requires its own approved state/time/financial contract. |
| ads_share_custom_audience | UNFINISHED | Audience creation/read alternatives do not implement partner sharing, revocation, shared-account enumeration or deletion. These require explicit recipient authority and destructive/organization controls. |
| ads_unshare_custom_audience | UNFINISHED | Audience creation/read alternatives do not implement partner sharing, revocation, shared-account enumeration or deletion. These require explicit recipient authority and destructive/organization controls. |
| ads_get_audience_shared_accounts | UNFINISHED | Audience creation/read alternatives do not implement partner sharing, revocation, shared-account enumeration or deletion. These require explicit recipient authority and destructive/organization controls. |
| ads_delete_custom_audience | UNFINISHED | Audience creation/read alternatives do not implement partner sharing, revocation, shared-account enumeration or deletion. These require explicit recipient authority and destructive/organization controls. |
| ads_get_ad_preview | BOUNDED REPLACEMENT | marketing_get_ad_preview provides authenticated frontend-only preview of an existing registered AD. Arbitrary creative preview generation is deliberately not implied. |
| ads_generate_preview | BOUNDED REPLACEMENT | marketing_get_ad_preview provides authenticated frontend-only preview of an existing registered AD. Arbitrary creative preview generation is deliberately not implied. |
| ads_get_pixel_events | UNVERIFIED CONTRACT / UNFINISHED | Pixel metadata/diagnostics, offline quality and trusted CAPI dispatch exist; they are not a generic raw customer-event retrieval API. |
| ads_hide_comment | BOUNDED REPLACEMENT | Canonical Page/Instagram comment mutations require the exact registered comment ancestry, product token/task and separate human approval. Broad original ad-comment schema remains HOLD. |
| ads_reply_comment | BOUNDED REPLACEMENT | Canonical Page/Instagram comment mutations require the exact registered comment ancestry, product token/task and separate human approval. Broad original ad-comment schema remains HOLD. |
| ads_delete_comment | BOUNDED REPLACEMENT | Canonical Page/Instagram comment mutations require the exact registered comment ancestry, product token/task and separate human approval. Broad original ad-comment schema remains HOLD. |
| ads_create_ad_rule | BOUNDED REPLACEMENT | marketing_create_disabled_pause_rule creates only a DISABLED static registered-AD PAUSE rule with fixed daily evaluation. Arbitrary rules are not implemented. |
| ads_update_ad_rule | UNFINISHED | Disabled-rule creation is not rule update/delete parity; dedicated state/ownership/approval transport remains absent. |
| ads_delete_ad_rule | UNFINISHED | Disabled-rule creation is not rule update/delete parity; dedicated state/ownership/approval transport remains absent. |
| ads_create_ad_study | BOUNDED REPLACEMENT | marketing_create_classic_split_study supports exactly two registered paused same-account campaigns, 50/50 and bounded future dates. General study variants are excluded. |
| ads_update_spend_cap | UNFINISHED / FINANCIAL MANUAL BOUNDARY | No strict account financial-limit mutation is implemented. Client-owned billing and separate explicit approval are mandatory; this is not a Meta API restriction claim. |
| ads_get_help_article | UNFINISHED | No reviewed help-article retrieval transport; ordinary primary documentation links are not this tool implementation. |
| ads_diagnose_underperformance | PARTIAL REPLACEMENT + UNFINISHED | Bounded registered hierarchy dossier, diagnostics and Insights/anomaly observations exist. Causal underperformance diagnosis or recommendations are not proven by these reads. |
| ads_bulk_create_video_ads | BOUNDED REPLACEMENT | Protected paused-ad batch workflow uses typed registered assets, individual approvals and durable checkpoints. The original broad bulk schema remains unavailable; no automatic activation. |
| whatsapp_register_phone | MANUAL-ONLY REPLACEMENT | Default-off protected setup-only OAuth lease/human OTP/PIN UI and once-only UNKNOWN reconciliation replace model-visible secret entry. No ordinary grant is minted from setup. |
| whatsapp_deregister_phone | UNFINISHED / MANUAL-ONLY | Destructive deregistration has no equivalent strict runtime; retain explicit human provider/dashboard handling, never infer safe deregistration from setup support. |
| whatsapp_request_verification_code | MANUAL-ONLY REPLACEMENT | Default-off protected setup-only OAuth lease/human OTP/PIN UI and once-only UNKNOWN reconciliation replace model-visible secret entry. No ordinary grant is minted from setup. |
| whatsapp_verify_code | MANUAL-ONLY REPLACEMENT | Default-off protected setup-only OAuth lease/human OTP/PIN UI and once-only UNKNOWN reconciliation replace model-visible secret entry. No ordinary grant is minted from setup. |
| ads_library_register_apify_token | UNSAFE MANUAL-ONLY BOUNDARY | Raw credentials/global active-token switching are intentionally excluded from MCP. Product-specific protected OAuth, deployment secret storage, scoped connection lifecycle and privacy-bound revoke/delete replace unsafe secret handling. |
| ads_library_get_apify_token_status | BOUNDED REPLACEMENT | Scoped connection/research readiness reports expose configuration status, not credentials. Old vendor-global token status is not aliased. |
| ads_library_delete_apify_token | UNSAFE MANUAL-ONLY BOUNDARY | Raw credentials/global active-token switching are intentionally excluded from MCP. Product-specific protected OAuth, deployment secret storage, scoped connection lifecycle and privacy-bound revoke/delete replace unsafe secret handling. |
| ads_library_scrape | BOUNDED REPLACEMENT | Eight provider-neutral research tools use exact named adapters, human cost approval, durable one-attempt reservation, encrypted results and local-only status/abort where provider recovery is unavailable. Abort never promises actual cancellation. |
| ads_library_get_run_status | BOUNDED REPLACEMENT | Eight provider-neutral research tools use exact named adapters, human cost approval, durable one-attempt reservation, encrypted results and local-only status/abort where provider recovery is unavailable. Abort never promises actual cancellation. |
| ads_library_get_results | BOUNDED REPLACEMENT | Eight provider-neutral research tools use exact named adapters, human cost approval, durable one-attempt reservation, encrypted results and local-only status/abort where provider recovery is unavailable. Abort never promises actual cancellation. |
| ads_library_abort_run | BOUNDED REPLACEMENT | Eight provider-neutral research tools use exact named adapters, human cost approval, durable one-attempt reservation, encrypted results and local-only status/abort where provider recovery is unavailable. Abort never promises actual cancellation. |
| ads_library_get_ad_details | PARTIAL REPLACEMENT + UNFINISHED | Approved bounded search results expose actual returned ad copy/dossier/media. Arbitrary standalone ad-detail fetch and longitudinal trend analysis remain outside the reviewed adapter. |
| ads_register_gemini_key | UNSAFE MANUAL-ONLY BOUNDARY | Raw credentials/global active-token switching are intentionally excluded from MCP. Product-specific protected OAuth, deployment secret storage, scoped connection lifecycle and privacy-bound revoke/delete replace unsafe secret handling. |
| ads_get_gemini_key_status | BOUNDED REPLACEMENT | Scoped connection/research readiness reports expose configuration status, not credentials. Old vendor-global token status is not aliased. |
| ads_delete_gemini_key | UNSAFE MANUAL-ONLY BOUNDARY | Raw credentials/global active-token switching are intentionally excluded from MCP. Product-specific protected OAuth, deployment secret storage, scoped connection lifecycle and privacy-bound revoke/delete replace unsafe secret handling. |
| ads_list_tokens | UNSAFE MANUAL-ONLY BOUNDARY | Raw credentials/global active-token switching are intentionally excluded from MCP. Product-specific protected OAuth, deployment secret storage, scoped connection lifecycle and privacy-bound revoke/delete replace unsafe secret handling. |
| ads_set_active_token | UNSAFE MANUAL-ONLY BOUNDARY | Raw credentials/global active-token switching are intentionally excluded from MCP. Product-specific protected OAuth, deployment secret storage, scoped connection lifecycle and privacy-bound revoke/delete replace unsafe secret handling. |
| ads_register_token | UNSAFE MANUAL-ONLY BOUNDARY | Raw credentials/global active-token switching are intentionally excluded from MCP. Product-specific protected OAuth, deployment secret storage, scoped connection lifecycle and privacy-bound revoke/delete replace unsafe secret handling. |
| ads_delete_token | UNSAFE MANUAL-ONLY BOUNDARY | Raw credentials/global active-token switching are intentionally excluded from MCP. Product-specific protected OAuth, deployment secret storage, scoped connection lifecycle and privacy-bound revoke/delete replace unsafe secret handling. |

## Staging scope verdict

**HOLD for final V1 acceptance until the new frozen suite/release review completes; no full original-feature parity claim.** A separately labeled, bounded frozen-candidate staging evaluation can be considered only after suite 10 and independent release review pass and the owner explicitly accepts the bounded scope. No staging deployment is authorized by this document. Source preparation, staging approval, deployment and live acceptance remain separate gates.

Required behavior still not fully supplied includes destructive campaign/ad-set/audience/rule operations and cloning; general budget schedules/sharing; broader carousel/photo-data creative-image variants; universal Business permission and generic Dataset-event contracts; benchmark semantics; general causal diagnosis; general paid-provider run enumeration and arbitrary ad-detail acquisition. A new two-existing-acquisition comparison now supplies bounded temporal sample/copy deltas; it does not claim longitudinal market-performance inference. Some are optional variants of implemented core workflows, but the original full-control scope cannot silently exclude them. Typed paused creation/control, sampled copy statistics and video frames must not be renamed as all variants or semantic/longitudinal analysis.

Actual external prerequisites remain product credentials/consent, current scopes/tasks/asset grants, applicable App Review/Advanced Access/access tier, Business Verification/Tech Provider/v4 setup, client ownership/billing and approved source/consent. Optional Gemini/Apify selection, credentials and research budget are unapproved; the Google $50 infrastructure budget is unrelated. Provider eligibility is not an excuse for the unfinished rows above.

Suite 10, build/lint/secret evidence, independent findings and final acceptance reports must be attached by the release owner. No actual Meta delivery/publication/conversion, paid provider execution, runtime Firestore/index/TTL installation or production mutation is established here.

## Completed strict replacements removed from the current HOLD list

- `ads_get_creative_media`: registered top-level creative image_hash→actual account/image membership→real JPEG decode and sealed final authority. Canonical creative-video inspection is separate. Carousel/photo-data/arbitrary URL variants remain excluded.
- `ads_library_list_runs`: aliases the current-client saved PUBLIC acquisition list, bounded to25 metadata records under one atomic authority checkpoint; no paid-provider-wide listing or query/results projection.

Bounded image inspection, two-acquisition temporal sample comparison and saved public-acquisition listing close the concrete required gaps identified in this audit. Historical broad wrapper variants remain explicit above and must not be called external Meta restrictions. Full bounded-V1 staging approval is pending the exact frozen full-suite10, independent release review and explicit owner authorization. No full142 broad-schema parity or live provider acceptance is claimed.
