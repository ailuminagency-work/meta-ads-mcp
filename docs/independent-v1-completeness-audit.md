# Independent V1 completeness reconciliation — frozen candidate

2026-10-16 source audit. The final regenerated source inventory is **370 registered tools: 142 baseline names (65 strict reads, 32 strict write subsets, 1 review workflow, 44 HOLD), 183 canonical definitions (177 verified bounded contracts, 6 HOLD), and 45 controls/workflows**. Full-suite 9 was intentionally stopped as a changing-source diagnostic; it is not acceptance. A new frozen full-suite 10 is pending. This document records scope, not test certification, staging approval, deployment or live access. Exact classification of all 50 current HOLD entries is in [the scope reconciliation](v1-remaining-engineering-audit.md).

## Original 25-item Definition of Done

| Item | Source evidence / remaining acceptance |
|---|---|
| 1 Existing Ads pass | Baseline names preserved and strict typed subsets implemented; frozen full-suite outcome pending. Broad wrapper HOLD does not equal baseline deletion. |
| 2 Capability registry | Implemented; availability uses current scoped authority and explicit gates, not merely tool registration. |
| 3 Tenant/client asset registry | Implemented with parent closure, owner evidence and atomic enrollment. Actual staging bootstrap remains pending. |
| 4 Policy engine | Implemented including financial/activation, separate human approvals and current actor/issuer/privacy checks; frozen verification pending. |
| 5 Pages | Posts/schedules/photo/video/status/edit, scoped comments/insights/subscriptions implemented; select-developer post deletion remains gated. |
| 6 Instagram | Separate login families; publishing variants, comments/inbox/insights/discovery and actual source/quota/status checks implemented in bounded subsets. |
| 7 Messenger | Text/templates/quick replies/actions/media and distinct Utility consent implemented; no arbitrary promotional bypass. |
| 8 Threads | Dedicated login/client, publishing variants/ordered carousel/quota/replies/insights/discovery implemented. |
| 9 WhatsApp audit/completion | Messaging/templates/static Flows/profile/phone/analytics/QR/subscriptions plus protected setup-only human secrets implemented; unsupported workflow variants remain explicit. |
| 10 Webhooks | Verified signatures, scoped mapping, durable normalized inbox/checkpoints and default-off runtime exist; actual installation/delivery not proven. |
| 11 Lead ingestion | Signed lead metadata, scoped retrieval/attribution, durable event handling and optional downstream boundary exist; no hardwired LeadGate. |
| 12 Conversion/CAPI | Trusted Pixel/offline/CRM stages, source truth/consent/hash/dedup and default-off concrete USER inspection exist; generic Dataset events remain contract gap. |
| 13 Catalog/business | Scoped inventory, ownership, feeds/items/permissions and dual-credential catalog-campaign diagnostics exist; universal permissions abstraction remains unverified. |
| 14 Product OAuth | Multiple narrow profiles, separate credential families and real adapter/core synthetic enrollment exist; live consent/grants remain external. |
| 15 Explicit permissions | Generated inventory contains exact packs/sources/tasks; conservative packs are not claimed universal endpoint minima. |
| 16 Dashboard-only actions | Manual admin/readiness and human setup/credential boundaries exist; no dashboard automation claim. |
| 17 Mutation audit | Durable claims/audit/completion/UNKNOWN checkpoints implemented; frozen review/testing must confirm. |
| 18 Adversarial tenant tests | Numerous targeted tests exist; final totals/results pending release owner report. |
| 19 No secrets | Secret-safe source/fixtures and scans reported by root; final frozen scan evidence pending release report. |
| 20 Production unchanged | No production mutation authorized or performed in this lane; root must attest exact deployed SHA independently. |
| 21 Acceptance checklist | docs/acceptance-checklist.md exists; must record final candidate outcomes instead of stale diagnostics. |
| 22 Final inventory | docs/generated-tool-inventory.{md,json} contains the final regenerated 370-tool source inventory. |
| 23 Permission/review matrix | Generated contract permissions/sources plus app-review and capability matrix exist; current live review status remains unknown. |
| 24 What Lumin can do now | Source capability report available, but final release report must distinguish local synthetic, staging and live authorization. |
| 25 What Meta blocks | Provider restrictions separated from unfinished engineering in exact scope audit; missing implementation must not be called Meta-blocked. |

## Required module coverage versus legacy parity

Modules 1–11 and 13–15 have concrete bounded runtime implementations. Their existence does not imply every investigated optional variant is available. Historical broad wrappers can legitimately remain HOLD when an explicit canonical implementation supplies the requested safe behavior: private frontend preview, registered comment mutations, disabled rule creation, classic split study, protected paused batch creation, secret-free OAuth/setup and bounded research jobs. Campaign/ad-set deletion, clone variants, arbitrary rule mutation and audience sharing are real legacy migration gaps; they should remain visible without automatically declaring the core requested paused-campaign V1 impossible.

Two required behavior gaps identified by the prior audit now have concrete implementations: **Module 12 temporal comparison** compares two actual same-request/provider/build/policy acquisitions under one atomic two-job authority checkpoint, returning bounded observed-sample/copy deltas without market-performance claims; **Module 7 creative-image inspection** verifies the registered creative top-level image_hash against the selected account/image row, actually decodes/reencodes JPEG bytes and withholds images until the final sealed current-authority checkpoint. Unsupported carousel/photo-data/image variants remain explicit. Gemini bounded text analysis exists separately; image/audio semantic interpretation is not implied. See [image inspection](image-inspection.md) and [public acquisition](apify-public-acquisition.md). Generic Dataset events remain a distinct unverified contract; verified Pixel/CRM routes implement specific first-party signal workflows without retyping Dataset identity.

## Verdict and next engineering

Unqualified full-V1 completion remains HOLD pending frozen integrated verification, independent release review and final release reports. The identified image/trends/list engineering gaps now have bounded implementations; do not retain an obsolete missing-feature claim. Do not require unsafe secret-wrapper parity; retain explicit human replacement. Do not label missing temporal comparison/image inspection an external Meta gate. The next gate is verification of this exact bounded candidate; no deployment or paid action is implied.

Staging approval can only follow an exact frozen tested candidate, independent review, install/rollback plan and explicit owner authorization. Actual client-owned assets/billing, credentials/consent, App Review/access tier/Tech Provider and provider behavior remain independent live prerequisites.


The source now also includes `meta_research_list_public_acquisitions`, bounded metadata-only saved acquisition listing with one current union checkpoint (9 targeted tests passed). Temporal comparison has 13 targeted tests passed, including actual approved Memory/Firestore acquisitions, native MCP, archived reads without vendor enablement and post-checkpoint app drift. These are local engineering results, not integrated suite or provider acceptance. Final generated counts are recorded above.


Reported targeted image evidence from its owners: 43 pure/native/contract tests passed, plus one actual synthetic USER OAuth→human source enrollment→separately approved upload→new AD_IMAGE inherited READ grant→decoded SDK image journey; independent Firestore six-case review passed. Final small-hardening rerun and whole frozen integrated verification remain release-owner gates. These are local synthetic observations, not real Meta image/provider acceptance.

The current HOLD classification excludes the now-migrated original creative-image and saved-public-acquisition list aliases. Broader historical variants remain explicit in the scope reconciliation. This is a bounded requested-V1 candidate, not all142 broad original schemas or live-provider certification.
