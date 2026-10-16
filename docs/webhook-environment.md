# Server-owned webhook environment runtime

The environment adapter makes the HTTP webhook host configurable without embedding subscriptions or secrets in source code. It performs no bootstrap writes. Enabling the host, assigning real assets, provisioning indexes, and configuring Firestore TTL remain separately approved deployment work.

Both `LUMIN_PLATFORM_ENABLED=true` and `LUMIN_PLATFORM_WEBHOOKS_ENABLED=true` are required. `initializeEnvironmentWebhooks()` must run before `platformWebhookRouter()`. With the flags disabled, initialization does not construct a Firestore client. Existing injected test/runtime dependencies are preserved when no explicit subscription JSON is supplied. Explicit JSON replaces injected dependencies only after validation.

`META_WEBHOOK_SUBSCRIPTIONS_JSON` contains server-owned metadata only. For example, with placeholder identifiers:

```json
[
  {
    "id": "lumin-meta-subscription",
    "appId": "123456789",
    "enabled": true,
    "products": ["leads", "pages", "messenger", "whatsapp"],
    "secretReference": "META_APP_SECRET",
    "verifyTokenReference": "META_WEBHOOK_VERIFY_TOKEN"
  }
]
```

Never put secret values, tokens, customer data, or credentials in this JSON. Supported secret references are `META_APP_SECRET` and `INSTAGRAM_APP_SECRET`; supported verification-token references are `META_WEBHOOK_VERIFY_TOKEN` and `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`. Each enabled subscription requires both referenced environment values to be present. Every subscription appId must exactly match META_APP_ID when using META_APP_SECRET, or INSTAGRAM_APP_ID when using INSTAGRAM_APP_SECRET. Missing, malformed or mismatched configured app IDs fail before initialization; a subscription cannot relabel one app secret as another app. References must match their corresponding product/app strategy. Instagram Login uses the Instagram secret/token pair and `META_INSTAGRAM_LOGIN` index provider; Instagram via Facebook Login uses the Meta pair and `META_INSTAGRAM_FACEBOOK_LOGIN`. Threads webhook support is not claimed and `threads` is rejected from this configuration.

Malformed JSON, unknown fields, duplicate subscription IDs/products, unsupported secret references, missing enabled-subscription secrets, and mismatched app strategies fail closed with constant errors that do not include configuration or secret contents.

## Approved asset-index bootstrap

The host resolves each incoming `(appId, product, assetId)` through exactly one server-owned global document:

`platform_webhook_asset_index/{SHA256(JSON.stringify([appId, product, assetId]))}`

Use exported `webhookAssetIndexKey()` to compute proposed document IDs in an approved bootstrap dry run. It does not create or update documents. Clients and MCP callers cannot supply tenant routing or seed these records.

Each document has this exact metadata schema:

| Field | Meaning |
|---|---|
| `tenantId` | Authorized Lumin tenant |
| `clientId` | Authorized client in that tenant |
| `assetKey` | Existing registered asset key |
| `appId` | Exact subscribed app ID |
| `product` | `leads`, `pages`, `instagram`, `messenger`, or `whatsapp` |
| `assetId` | Exact incoming provider asset ID |
| `provider` | Exact supported provider/auth strategy |
| `verifiedAt` | Positive Unix milliseconds; not future and younger than one hour |
| `expiresAt` | Future Unix milliseconds; expired documents cannot route events |
| `revokedAt` | Must be `null`; revoked records are rejected |

The adapter verifies the active/ready tenant, active client, exact registered asset identity, provider, app, client ownership, current freshness, and all registered parents. It performs tenant-scoped reads only after the global index identifies the tenant. It never discovers clients by scanning all tenants. A missing index returns no mapping; malformed, stale, revoked, cross-client, wrong-provider, or wrong-app mappings deny routing.

For WhatsApp, index the phone as `WHATSAPP_PHONE` and its webhook envelope account as `MESSAGING_ACCOUNT`, both under `META_WHATSAPP`. The registered phone requires both Messaging-account and WhatsApp-account parents. The signed ingress bridge separately binds the envelope account to the phone's actual Messaging-account parent. Lead events route to the registered Page under `META_MARKETING`; this does not automatically register or authorize arbitrary lead/form IDs.

## Durable storage and deployment checks

Events use the existing Firestore transactional event store in `platform_webhook_events`, with seven-day metadata retention. Configure Firestore TTL on the `expireTime` timestamp field for event records. Application reads reject expired events even while asynchronous physical deletion is pending. Event checkpoints use hashed metadata and are not raw message/contact storage. No TTL policy or Firestore index was created by this implementation.

Worker queries may require composite indexes for tenant/client/product/asset plus `status` and `nextAttemptAt`, and a separate processing-lease query using `leaseUntil`; use the actual existing adapter queries to generate deployment indexes. The global asset index uses a single document lookup and requires no query index. Its `expiresAt` is a logical routing expiry; trusted bootstrap maintenance must refresh/revoke records and must not silently extend verification.

The HTTP router still validates raw-body HMAC before normalization, durable enqueue, and the opaque signed-batch hook. This environment adapter never mints signature proof or creates messaging opt-in. Live subscription configuration, real client mappings, signature verification, durable enqueue, and provider consent require independent deployment acceptance.
