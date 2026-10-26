# Lumin agency client management (proposed; disabled by default)

The existing staging connection page only lists clients contained in the current
operator's tenant-bound member record at `members.allowedClientIds`.
This is **not** a Meta advertising-account ID.

This change adds a protected **agency tenant administrator** UI at
`/platform/clients/` on the **existing** service. It is unavailable unless
`LUMIN_PLATFORM_ENABLED=true` and the new,
default-off `LUMIN_CLIENT_MANAGEMENT_ENABLED=true`.

- **Assign existing client:** checks that the same-tenant client exists and is
  active, and adds its ID to the current administrator's permitted client list.
- **Create client profile:** creates only a tenant-owned client record and assigns
  it to the current administrator. No Meta account ID is entered or assumed;
  the actual account must be selected in the separately reviewed OAuth discovery.
- Both actions require an actual authenticated, enabled tenant **admin**,
  5-minute signed session-bound review, exact browser origin, secure cookie,
  current tenant/member/client compare-and-swap, complete write-scope validation,
  and an immutable audit event.
- They create **no** Meta tokens, asset grants, registered assets, verified
  ownership/billing assertion, approved campaign, ad, budget or spending right.
- Cross-tenant records, disabled clients, duplicate assignments, old CSRF reviews,
  and non-admin operators fail closed.
- This is intentionally a staging-reviewed first iteration, **not** an operator
  invitation system or a license to manage arbitrary clients. Staff-level
  per-client assignment/revocation requires a separate reviewed authorization UX.

Use the staging page after staging code review, CI, and an authorized flag
activation. For a record such as `amazing-decks-seattle`,
**select Assign** if it already exists; **Create** only if a separate
registry inspection proves it does not exist. Never duplicate client IDs.

After assigning the existing client, use
`/platform/connections/` for first-time Meta consent and discovery.
Client assignment alone never proves Meta access. Keep the installed production
ChatGPT connector unchanged and test against a separately configured staging
OAuth MCP connector. Do not promote production or advertising writes until live
authenticated read/isolation acceptance passes.
