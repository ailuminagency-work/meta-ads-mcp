# Policy and approvals

Classes: READ, WRITE_NON_FINANCIAL, WRITE_CONTENT, WRITE_MESSAGING, WRITE_AD_CONFIGURATION, WRITE_BUDGET, ACTIVATE_SPEND, DELETE, BUSINESS_ADMIN, IDENTITY_OR_ACCESS and BILLING. Decisions are ALLOW, DENY and REQUIRE_CONFIRMATION.

Global mutation flags must both permit writes. Membership roles and client access remain necessary. Content, messaging, budgets, spend activation, deletion, business administration, identity/access and billing require a durable human approval. Approval binds actor, client, exact canonical plan, authorization revisions, approver membership/revision and expiry. Consumption and PREPARED audit are atomic. The model cannot issue its own approval through an MCP tool.

Ads creates/copies require explicit PAUSED at the root and every nested status. ACTIVE or inherited status is rejected. Budget and activation are separate risks, including inside generic JSON. Complex multi-step clone/bulk operations remain HOLD until every step and created asset is bound to a reviewed plan.

Each mutating permit permits one network attempt. Unknown network or audit-completion outcome is UNKNOWN and requires reconciliation. Audit stores only allowlisted non-sensitive change metadata; before-state evidence is UNKNOWN unless actually observed.

## Human approval

Review and issuance are served at `/platform/approvals` only while `LUMIN_PLATFORM_ENABLED` is true, and answer 403 while `LUMIN_PLATFORM_WRITES_ENABLED` and `AGENCY_WRITES_ENABLED` are not both `true`. The CSRF token is domain separated from other routers that share `SESSION_COOKIE_SECRET`. Setting `LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER=true` additionally refuses an approver who is the requesting actor. An MCP credential, an MCP tool and a cross-origin form cannot grant an approval; `tests/platform/approval-http-runtime.test.ts` and `approval-http-production.test.ts` drive the real HTTP runtime for the allowed and refused cases.

Request, review and issue all evaluate policy with the live writes flag (`platformWritesEnabled()`), so with either flag off they deny `DISABLED_BY_LUMIN_POLICY` and store no request, approval or audit record. An approval is consumed exactly once, inside `authorizeOperation`, after policy has been evaluated again.

## Policy guards

`registerPolicyGuard(name, guard)` adds a refusal that runs inside `evaluatePolicy` for every non-READ plan. Because approval request, review/issue and `authorizeOperation` all call `evaluatePolicy`, a guard refuses before a human is asked, before an approval is issued and before one is consumed. A guard can only deny: a throwing guard denies with `POLICY_GUARD_FAILED`, and a name cannot be registered twice by different functions. `tests/platform/policy-guard-before-approval.test.ts` pins request, issue and execution with a stand-in guard. The per-client budget ceiling is meant to be registered this way once its module is merged; until then it is enforced at plan binding and at activation only.

## Write preparation

A tool that only stages a proposal for a later write is refused while platform writes are disabled, because nothing can approve or run the proposal: `meta_prepare_action` and `meta_prepare_publication` through the approval path, `ads_update_ad_url_tags` and the tracking planner through `legacy-tracking.ts` and the `meta_plan_tracking_change` policy rule, and in agency deployments `ads_update_ad_url_tags` is also not listed. `meta_plan_paused_ads` does not call policy: with writes disabled it still stores an encrypted paused-ad batch proposal (no Meta request), and the agency read-only listing still includes `meta_prepare_action`, `meta_prepare_publication`, `meta_plan_ad_tracking_change` and `meta_plan_paused_ads`; both need edits outside the policy files. Discovery, observation, targeting lookup, compatibility, owner observation and app promotion access make GET requests only and store evidence or an enrollment proposal; they remain available read-only.

## Mutation inventory

`tests/platform/tool-classification.fixture.ts` classifies all 371 tools the strict build registers: 142 baseline tools (73 read-only agency, 6 read tools kept out of agency, 63 writes of which 32 are approval-gated strict subsets, 1 local review workflow, 1 read replacement and 29 strict holds), 183 product contracts (92 read, 91 mutating with exact operation classes; `marketing_activate_ad` is the only product contract that can start delivery) and 46 control tools. `tests/platform/tool-classification-guard.test.ts` fails when a tool is added without an entry, an entry is stale, `readOnlyHint` disagrees with the class, a baseline-to-strict annotation changes without review, a contract gains or loses a class, a second spend-capable contract appears, or a held write becomes executable. It also asserts the tools a read-only agency deployment enables.

## Account ownership

Account mutations (ad configuration, budget, activation, uploads, audiences, conversions, reports, rules, studies) need a current owner billing attestation and a provider ownership observation that is at most five minutes old. An account that staging `1f08563` reassociated carries neither: it stays readable and every account mutation denies `ACCOUNT_OWNERSHIP_UNVERIFIED` until fresh evidence exists, and again once the observation is older than its window (`tests/platform/account-ownership-reassociated.test.ts`). The decisions that differ from staging are pinned in `tests/platform/policy-staging-delta.test.ts`.
