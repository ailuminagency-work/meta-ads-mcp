# Policy and approvals

Classes: READ, WRITE_NON_FINANCIAL, WRITE_CONTENT, WRITE_MESSAGING, WRITE_AD_CONFIGURATION, WRITE_BUDGET, ACTIVATE_SPEND, DELETE, BUSINESS_ADMIN, IDENTITY_OR_ACCESS and BILLING. Decisions are ALLOW, DENY and REQUIRE_CONFIRMATION.

Global mutation flags must both permit writes. Membership roles and client access remain necessary. Content, messaging, budgets, spend activation, deletion, business administration, identity/access and billing require a durable human approval. Approval binds actor, client, exact canonical plan, authorization revisions, approver membership/revision and expiry. Consumption and PREPARED audit are atomic. The model cannot issue its own approval through an MCP tool.

Ads creates/copies require explicit PAUSED at the root and every nested status. ACTIVE or inherited status is rejected. Budget and activation are separate risks, including inside generic JSON. Complex multi-step clone/bulk operations remain HOLD until every step and created asset is bound to a reviewed plan.

Each mutating permit permits one network attempt. Unknown network or audit-completion outcome is UNKNOWN and requires reconciliation. Audit stores only allowlisted non-sensitive change metadata; before-state evidence is UNKNOWN unless actually observed. Human approval issuance/UI is not yet production integrated.
