# Ownership and billing completion contract

Advertising authorization still requires all operation, operator, grant, connection, approval and deployment policy checks. Account classification alone never authorizes execution.

Agency ownership additionally requires the operator-controlled deployment bindings `LUMIN_AGENCY_TENANT_ID`, `LUMIN_AGENCY_INTERNAL_CLIENT_ID` and `LUMIN_AGENCY_META_BUSINESS_ID`. All three must match the account and its current, independently verified business evidence. Missing or mismatched bindings produce `UNVERIFIED`. An agency business cannot be attested as client-funded for an external client. These settings carry no default identities and must only be configured after independent verification; this change does not install them or enable advertising writes.

The signed human ownership review records artifact-backed billing responsibility. It resets `billingOwnershipVerified` to false, including replacement attestations. Only the atomic ownership-observation completion can set it true, after validating the current human attestation, explicit provider account/business proof, member, business binding, connection and read grant. The account revision and all expected records are compared atomically. A stale or revoked attestation/observation fails authorization even when the historical boolean remains true. New observations are valid for at most five minutes; the human attestation is not a substitute for that refresh.

Test fixtures use this same service and transaction path. They do not directly set verified billing flags. No live billing verification or tenant provisioning is implied by synthetic test success.

## Automated configuration inspection

`meta_inspect_billing_configuration` performs fresh read-only Meta configuration reporting. It requires no billing attestation and never changes liability, ownership or spending authority. Account/member/grant/connection authorization applies independently to both client and agency reads.

The trusted deployment setting `LUMIN_AGENCY_BILLING_COMPARISON_JSON` contains exactly clientId, accountKey and connectionId references for an enrolled agency account. The agency client and tenant must match the trusted agency deployment binding. Each invocation obtains a separate read permit for that agency scope and verifies its live business owner before comparing its current funding configuration to the selected client's. No recurring human funding inventory is required. Missing or unavailable agency evidence cannot produce CLIENT_OWNED_BILLING_CONFIGURED. The comparison covers only that configured agency account; different funding IDs do not establish different underlying cards or legal liability.

Results include source, sanitized receipt digest, selected identities and a checked timestamp. They are point-in-time observations, not reusable authorization (expires_at equals checked_at). Payment display details and raw funding IDs are never returned. No Meta writes or account/evidence promotions occur. Spending and independent billing-liability gates remain unchanged.
