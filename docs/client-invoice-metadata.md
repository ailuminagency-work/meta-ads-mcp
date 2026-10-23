# Client-owned invoice metadata

The default-off invoice feature reads monthly-invoicing metadata only. It never returns invoice amounts, balance/payment details, advertiser/legal names, PDFs, ephemeral CDN URLs or download links. It does not change billing, credit allocation, finance roles or provider objects.

Primary references inspected October 16, 2026:

- Business/business_invoices v26 describes monthly invoices for bill-to legal entities and inclusive issue_start_date/exclusive issue_end_date filters: https://developers.facebook.com/docs/graph-api/reference/business/business_invoices/
- OmegaCustomerTrx v26 documents ad_account_ids as the invoice's account allocation and separately exposes private download/amount fields that Lumin excludes: https://developers.facebook.com/docs/marketing-api/reference/omega-customer-trx/
- User/business_users v26 maps the actual USER token owner to its BusinessUser records: https://developers.facebook.com/docs/graph-api/reference/user/business_users/
- The BusinessUser reference, updated April 14, 2025, documents finance_permission string examples EDITOR and ANALYST. Those actual read-field literals are required conservatively; assignment-role aliases FINANCE_EDITOR/FINANCE_ANALYST, ADMIN, or task names are never translated into proof: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/business-user
- Pinned official SDK 26.0.2 confirms the endpoint and generated fields: https://github.com/facebook/facebook-python-business-sdk/tree/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects

Set LUMIN_INVOICE_METADATA_ENABLED=true only after deploying/reviewing the candidate and configuring a deployment-owned Marketing USER finance profile. invoiceRootIds contains one client Business and 1–20 exact registered client account IDs. The profile permits READ only, with invoice metadata and optional existing account-info reads. Its conservative Lumin scope pack is public_profile, ads_read, business_management and their reviewed dependencies; it is not claimed to be a universal Meta minimum. Actual app approval, BusinessUser endpoint eligibility and monthly-invoicing availability remain external gates.

OAuth proves actual app/USER/current granted scopes, literal finance permission, Business membership, owned-account membership and each account.business relation. It creates no ownership or billing attestation. The client must separately have a durable reviewed Business owner binding (or explicitly reviewed deployment bootstrap) and the protected client-owner billing attestation plus a fresh five-minute actual account-owner observation. meta_observe_account_owner can refresh the separate observation; it does not renew the human attestation.

Each read repeats actual USER and finance-role/account relations, selects a maximum 31-day issue-date window, and returns only invoices whose complete nonempty ad_account_ids set is within the explicitly approved registered account set. The returned invoice_date must independently fall inside the approved issue window; missing or out-of-window dates are withheld even if Meta ignores query filters, and malformed dates fail closed. Mixed-client and unallocated invoices are wholly withheld. No foreign count or global invoice total is returned, and complete_inventory is always false. An atomic final checkpoint compares the exact selected encrypted credential envelope, every original authorization/owner record, indices and privacy/lifecycle locks; financial and deployment deadlines are rechecked synchronously after the await.

Supervised grant refresh inspects actual app/user/scopes and finance/account access again, renews only existing READ grants and root verification, and returns no invented tasks. It does not extend owner/billing attestations or refresh financial-observation timestamps.

The original ads_get_invoices tool has an explicit strict metadata replacement: business_id/account_ids/since/until are required with client context. Legacy PDF, invoice_id/type, billing-period start_date/end_date and arbitrary selectors are rejected instead of silently dropping them. Canonical marketing_list_client_invoice_metadata uses the same guarded implementation.

Fixture/native SDK tests establish local boundaries. No real Meta invoice, role, permission, finance account or billing configuration has been accessed or changed during this engineering work.
