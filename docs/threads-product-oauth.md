# Threads product-specific OAuth profiles

The concrete Threads adapter validates deployment-owned profiles against the exact current verified canonical Threads contracts, rather than the previous three read-only capabilities. Each profile must use the Threads app, threads_login and a Threads user token. Its scopes are exactly threads_basic plus the selected contracts' required scopes; actions are exactly READ plus their operation classes. Duplicate/unknown capabilities, extra scopes, Page tasks, foreign token types, business/billing/spend actions and derived-token profiles are rejected before consent.

This does not grant a new permission merely because a contract exists. The user completes Meta consent for the configured immutable profile. The adapter exchanges the one-time code, obtains a long-lived token, inspects it using the same-app TH app access-token viewer and reads the authenticated /me identity. The exchange subject, inspection subject, /me identity, exact granted scope set, registered client account and all expiry bounds must agree. Actual same-app inspection is enforced by Meta; a foreign-app input token is rejected by that endpoint.

The normal OAuth core retains the one-use browser nonce/state challenge, registered client mapping, encrypted credential storage and atomic connection/grant enrollment. No capabilities or assets are inferred from a caller-provided ID or the discovery of another account. Product eligibility, client authority, media rights, human approvals and runtime feature flags remain separate gates after consent.

Tests exercise the concrete adapter and the actual OAuth core with synthetic provider responses: approved publishing scope enrollment, extra authority rejection, missing publish permission, wrong subject, encrypted storage and replay rejection. They are engineering evidence only; live Meta consent, external-client App Review and provider acceptance await separately authorized staging verification.

Primary inspection reference: https://developers.facebook.com/documentation/threads/troubleshooting/debug-access-token (August 18, 2026). Individual product scopes and endpoints are recorded in the generated permission matrix.
