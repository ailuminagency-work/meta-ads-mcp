# Lumin Meta Platform — agency-only operating model and release gates

Status: **mandatory release requirements**, not a claim of implemented controls.
Owner: Lead Orchestrator. Independent reviewer, adversarial tester and Final Release Governor must approve each gate.

## Product boundary

Lumin Agency staff operate the application internally. Clients **do not sign in to Lumin's platform** in V1. A client authorizes Lumin through supported Meta Business partner/asset task access or other product-specific consent flows. Future client-facing SaaS is out of scope; do not complicate V1 onboarding with client seats.

Lumin manages authorized assets and bills a separate management/subscription fee. **Each client keeps ownership of its Meta Business portfolio, ad account, Page, Instagram account, datasets, catalog, messages and billing relationship with Meta.** Request least-privilege asset tasks (ads, content, messages, insights) for supported channels, not administrator/control rights by default. The client's authorization may be revoked.

## Financial firewall — HARD DENY, NOT A WARNING

For every external-client paid advertising request, resolve verified client -> Meta business -> ad account -> owner -> delegated tasks -> billing attestation **before any mutation**, including campaign/ad/ad-set creation, budget editing, state changes, boosting, and any effect that can create spend.

Treat missing, stale, contradictory, revoked, ambiguous or unverified evidence as **DENY**. Required evidence:

- Ad account registered to the correct client and exact Meta ad account ID; no operator-supplied raw-ID bypass.
- Client-controlled legal/business ownership and confirmed partner delegation to Lumin for intended tasks.
- Human-authorized, time-bounded verification inside Meta Billing & Payments that an eligible client payment card is on file for the exact ad account and that **no Lumin agency card, credit line, backup funding source or shared agency payment facility** can be charged.
- Customer contract states Meta ad spend is the client's direct responsibility and Lumin's fees are separate; an API guard alone does not override Meta's billing contracts or guarantee absence of legal liability.
- Currency, spend caps, outstanding balance, account status and funding restrictions inspected as appropriate before release.
- Signed/dated evidence reference and reviewer; expiration/revalidation after payment/profile/ownership changes.
- Account marked client-owned; if Meta reports Lumin as the account Business and that conflicts with the client's claimed ownership, **HOLD until reconciled, regardless of card presence**.

**Never enter, store, attach or replace a client's card.** A Boolean `has_payment_method`, presence of a billing-related API field, ad account ACTIVE status, or a paid campaign from history is **NOT** ownership proof. No automatic payment-source switching. If Meta offers invoice/credit lines instead of a card, this V1 policy blocks until the owner explicitly approves a policy change.

Technical enforcement:
- Immutable relationship mapping per client + verified account; validate ancestry for campaign, ad set, ad, creative and billing objects.
- Evaluate policy on every provider-bound action, not just the MCP tool description or UI.
- `externalClient && !currentBillingAttestation && paidMutation` => deny before network request.
- `externalClient && fundingOwner !== client && paidMutation` => deny before network request.
- `externalClient && adAccountOwner !== client && paidMutation` => deny before network request.
- `externalClient && missingAssetGrant && paidMutation` => deny before network request.
- `paidMutation && isActivationOrBudgetChange` => separate explicit human approval bound to exact client/account/action, budget, currency and expiration.
- New paid ads/campaigns/ad sets must be **PAUSED** at creation; independent activation gate; no autonomous ad-spend activation.
- Formal tests must prove zero provider requests for every denied path, including raw-ID substitution, stale attestation, races, client switch and credential refresh.

Organic Page/Instagram/Threads publishing and scheduling do **not** require a card. They require correct client/asset authorization, platform publishing permissions and appropriate content approval. Schedule/retry/report only API-backed supported functionality; unsupported channels or posting types remain HOLD.

## Release and acceptance stages

Reported local immutable candidate:
- `feat/lumin-meta-platform-v1`, commit `3cafba1c1145b829f6d09c06ce879e5cd9761537`
- tree `0727c6baa26d55ed4f8ba11dc38716304984f900`
- Test evidence reported by builder: 4,120/4,120 in 359 files; needs independent staging acceptance.
- Production baseline: `251249ea91d32fb7cb8d3937ba3f938c547299e8`.

Separate private Railway staging project:
- name `lumin-meta-platform-v1-staging`
- project `24f5879b-6eb1-4d18-b60a-2f23e69d6f61`
- staging environment `578695f9-d4c0-47e2-ab71-71caeafa7736`

**G0 — Remote source:** Push the exact local candidate branch from the original Codex computer and verify remote SHA/tree equality, clean status and secret-scan result. Do not create a substitute V1 branch from production.
**G1 — Cloud Linux build:** Build the exact candidate Dockerfile in staging, pin SHA and image digest, smoke-test port, health, ready, MCP initialization and startup. No home NAS or local Docker needed.
**G2 — Staging isolation:** Staging-only OAuth app or permitted staging configuration; separate encryption secrets, restricted Firestore storage, allowlists and webhooks. Never clone production secrets or share production token persistence. Establish infrastructure spending ceiling before provisioning billable resources.
**G3 — Security:** verify tenant ID ancestry, permission status, one-time approvals, fail-closed billing, no accidental spend, audits, token revocation/rotation, webhook signatures, idempotency, monitoring, restart persistence, rollback.
**G4 — Live Meta acceptance:** Test actual authorized account reads and granted product scopes. Mark every capability as verified, restricted or HOLD. Meta App Review/Tech Provider/access-tier constraints remain external gates.
**G5 — Client billing:** Independent Meta Billing UI verification for every client ad account; unresolved owner/billing mismatch blocks paid advertising. Specifically verify any account whose API-reported Business appears to belong to Lumin.
**G6 — Safe write acceptance:** Only after gates above, explicitly authorized PAUSED test object (staging asset), verify exact Ads Manager object and immutable audit. **$0 Meta advertising spend** during initial staging.
**G7 — Production release:** Independent Release Governor plus owner approve exact scope and rollout after staging proof. No main merge, production deploy, Meta app publication, or ad activation without explicit authorization.

## Evidence/reporting

Final status must give: pushed SHA + immutable tree, container digest, staging service URL, staging credentials separation, verified client assets/grants, ad billing source attestation status (without card numbers), access tier, tool inventory VERIFIED/RESTRICTED/HOLD, tests and attack results, app review gates, rollback plan, and GO/HOLD.

## Engineering roles
1. Lead Orchestrator — dependency DAG, scope and evidence ledger; never presume success.
2. Domain Leads — Meta provider, OAuth/identity, security, backend/data, operations, billing compliance, client UX.
3. Builders — bounded implementation.
4. Independent Reviewers — non-builders challenge results.
5. Adversarial Testers — raw object ID, client switching, authorization/billing bypasses, spend activation, failed OAuth, token leakage, webhook replay.
6. Final Release Governor — decides release status from evidence, separately from implementation.
