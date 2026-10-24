# Meta OAuth permission profiles

## Why the previous callback failed

The production deployment requested the `META_READ_ONLY` profile (`public_profile` and `ads_read`). Meta returned a previously granted 15-permission user token, including management, content/messaging, and business-operation permissions. The old validator treated every extra permission as an error and surfaced the provider inspection failure as `OAUTH_CALLBACK_UNAVAILABLE`.

The returned permissions are provider evidence only. They do not prove Meta App Review approval, Marketing API access tier, client asset assignment, business ownership, operator authorization, or permission to spend money.

## Classification

| Profile | Allowlisted scope families | Execution authority |
| --- | --- | --- |
| `META_READ_ONLY` | `ads_read` and explicitly read-only extensions | Read operations in the trusted profile |
| `META_MANAGEMENT` | `ads_management`, `ads_mcp_management`, `pages_manage_ads`, `pages_manage_metadata` | Only a separately reviewed management profile may expose management actions |
| `META_CONTENT_AND_MESSAGING` | Instagram publishing/messaging, Pages messaging, WhatsApp messaging | Only a separately reviewed product profile may expose content or messaging actions |
| `META_BUSINESS_OPERATIONS` | `business_management`, `whatsapp_business_management` | Only a separately reviewed business-operations profile may expose administration actions |

Unknown or missing permissions fail closed. A token can be classified into multiple families; the observed families are stored as `grantedPermissionProfiles` for audit and support diagnostics.

## Execution policy

The deployment-owned OAuth profile remains authoritative for capabilities, actions, required tasks, tenant, client, and asset bindings. Observing management scopes on a read-only connection never promotes that connection, creates campaign writes, changes budgets, publishes content, sends messages, activates spend, or deletes assets. Grants continue to receive the actions declared by the trusted profile.

The permission-family metadata is included in the enrollment audit hash. It is not a credential, is not used as a fallback identity, and cannot bypass Meta consent, client asset verification, operator roles, approval gates, or MCP authorization.

## Connection paths

Operator login and direct Meta marketing consent are separate flows. The plain read-only marketing profile uses explicit scopes instead of a Business Login configuration. A broader token may be retained when every extra scope is allowlisted and the requested profile's required scopes are present, including Meta's implicit `public_profile` omission. A fresh consent is required when the owner must reduce previously granted permissions or when Meta requires a new authorization.

