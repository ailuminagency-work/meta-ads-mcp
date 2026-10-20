# Google provider foundation

Status: isolated implementation, not connected to MCP or deployed. No authenticated Google API calls have been verified.

`src/providers/google/client.ts` constructs requests for Ads GAQL reporting, Ads non-committing validation, Search Console Search Analytics and a GA4 channel report. Ads requests use v25; Analytics uses the v1beta Data API. Verify the supported API version before release.

## Authorization boundary

Create the client only with a server-authenticated platform subject and persisted, independently verified Google resource grants. `GoogleAccountBinding` is not a tool input schema and must never be accepted directly from an AI client or website content. Its constructor is not authentication. No environment-token or Facebook-identity fallback is supplied.

The injected token resolver receives the bound subject and required OAuth scope. It must retrieve the correct encrypted provider grant, enforce granted scopes and revocation, refresh credentials safely and return a short-lived access token. Those responsibilities are not implemented by this module.

`loginCustomerIds` optionally maps a bound Ads client account to the manager account through which Google has verified its access. The constructor checks IDs and copies this mapping. Manager headers are sent only to Ads requests. The server must verify the manager/client relationship before persisting a mapping; a syntactically valid mapping does not prove account ownership.

## Safety and operations

- Account, site and property bindings are checked before credential resolution.
- The only mutation method forces `validateOnly: true` and `partialFailure: false`. No committing method is provided.
- Origins and endpoints are fixed. Redirects are refused, HTTP calls have a 15-second deadline, and request/response bodies have byte limits.
- Credential, provider-response and transport errors are replaced with sanitized errors. The caller must not log bearer headers or raw token-resolver errors.
- Validation accepts 1–100 operations and rejects references to a different Ads customer.
- Ads reporting accepts an optional page token. Search Console returns at most 1,000 top rows, not an exhaustive crawl or complete dataset. GA4 report dimensions and metrics are intentionally fixed.
- No automatic retries are performed. Add per-tenant quota controls, approved retry policies, safe diagnostic request IDs and durable audit events before exposing the provider.
- Returned advertiser text is untrusted data; it must never grant permission to execute another operation.

## Release gates

Google Cloud/API configuration, OAuth consent, deployed callback validation, encrypted persistent Google grants, provider-neutral tenant identity, scope/revocation tests, real manager/client tests and read-only API comparisons remain required. OAuth approval in an AI client does not itself authorize activation or spending changes.

Before adding live writes, implement immutable change proposals, payload-bound expiring approvals, durable idempotency, ambiguous-outcome reconciliation, emergency stop and independent adversarial tests. Do not replace non-committing validation with BatchJob execution.

## Verification

`tests/providers/google/client.test.ts` checks request construction, forced validation mode, account isolation boundaries, copied grants, manager-header isolation, invalid IDs/dates, sanitized errors and response limits. Tests use synthetic resource identifiers and substituted transport; passing them does not establish live Google access or complete tenant isolation.

Run the repository checks and pinned secret scanner before committing or deploying, as required by `AGENTS.md`.

## Official references

- https://developers.google.com/google-ads/api/docs/concepts/call-structure
- https://developers.google.com/google-ads/api/docs/api-policy/access-levels
- https://developers.google.com/google-ads/api/docs/best-practices/testing
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
