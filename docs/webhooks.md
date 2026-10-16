# Meta webhook ingestion

The webhook lane is implemented as an injected, metadata-only receiver and durable delivery queue. It is not automatically mounted, does not subscribe a Meta app, and makes no provider or database calls until the host explicitly supplies adapters. Production remains unchanged during development.

Mount `createMetaWebhookRouter(dependencies)` at `/webhooks/meta` **before** the shared `express.json()` middleware. Its final endpoint is `/webhooks/meta/:subscriptionId`. Never restore JSON serialization and call that the original body: Meta signatures cover the exact incoming bytes. Compressed bodies are rejected; JSON body size is limited to 256 KiB, nesting to 32 levels, parsed nodes to 10,000, envelope entries/changes to 100, and normalized event batches to 100.

Dependencies are a trusted subscription lookup, secret-reference resolver, trusted asset mapper, durable event store, and clock. Subscription identifiers select operator-managed configuration; payload values cannot create subscriptions, select secret material, grant access, or assign tenants. Each subscription specifies the app identity and permitted event products. Secret values are never included in returned events or logs.

## Verification and routing

GET verifies `hub.mode=subscribe`, a bounded verification token, and a numeric challenge. Only an enabled subscription with an exact timing-safe matching token receives the challenge. Unknown/disabled subscriptions return 404; invalid challenges return 400; token mismatch returns 403; dependency failures return 503.

POST verifies `X-Hub-Signature-256` using HMAC-SHA256 over raw bytes and timing-safe digest comparison. Invalid signatures return 401 before normalization/storage. The signed JSON envelope is schema-validated and only `page`, `instagram`, and `whatsapp_business_account` objects are accepted. Threads webhooks are explicitly rejected pending a separately verified product contract.

Normalized products:

| Product | Accepted source |
| --- | --- |
| Lead Ads | Page `leadgen`, with lead and form IDs |
| Pages | Page `feed`, `mention`, `comments`, `ratings`, `videos`; feed requires item and verb |
| Instagram | `comments`, `live_comments`, `mentions`, `story_insights`, or messaging envelope |
| Messenger | Page messaging containing message, postback, delivery, or read event |
| WhatsApp | `messages` change with phone-number metadata and individual message/status IDs; sent/delivered/read/failed statuses |

This table is an implemented conservative ingestion contract, not evidence that the production Meta app has subscribed or has access to every field. Additional fields fail closed and need explicit fixtures/contract review before support is enabled. No Meta subscription or App Review submission is made by this module.

Each entry's asset is resolved from the trusted asset registry. Messaging recipients must match the entry asset. WhatsApp requires **both** the WABA entry and the phone number to map to the same tenant/client/product. A signed webhook is proof of app provenance, not proof that an asset belongs to a client. An unmapped or foreign asset rejects the entire batch with 400, and nothing is enqueued.

## Durable queue and downstream adapters

`TransactionalEventStore` uses injected atomic transactions. `firestoreEventDatabase(firestore)` adapts an explicitly provided Firestore instance; it does not create credentials or provision Firestore. `InMemoryAtomicDatabase` is a serialized, rollback-safe test fake, never a production fallback.

Enqueue atomically inserts the complete batch or reports duplicates. Event IDs hash subscription, app, registry-derived tenant/client/product/asset, event kind, and provider event identity. Lead/message IDs produce stable deduplication across rebatched deliveries. Events without provider IDs use a canonicalized value/timestamp hash. The raw payload digest remains provenance only. Pending records are acknowledged with 200 **after** durable enqueue; storage failures return 503 so Meta can retry.

`due(scope, now, limit)` discovers pending/retry records and expired processing leases within an exact tenant/client/product/asset scope. A bounded scheduler must invoke it for trusted configured scopes; it does not enumerate arbitrary client IDs from untrusted requests. `EventWorker.deliver` atomically claims one record for 60 seconds, increments attempts, calls one configured downstream `EventAdapter`, and fences completion by a random lease token. Concurrent workers cannot hold the same live lease. Delivery errors store only the fixed `adapter_failed` classification, never exception details or payload content. Exponential retry starts at two seconds and stops after five failed claims in `dead_letter`.

This is **at-least-once delivery**, not exactly-once side effects. If an adapter succeeds and the completion write fails, a worker dies, or delivery exceeds its lease, a later attempt can repeat the adapter call. Adapters must durably deduplicate the supplied idempotency key (`adapterId:eventId`) before downstream side effects and must respect their own timeout. The store represents one configured delivery pipeline; multi-adapter fanout requires independent durable delivery records per adapter and is not claimed here. There is no automatic LeadGate call. A CRM, LeadGate, or another destination may implement `EventAdapter` independently with explicit client consent and authorization.

Only a scoped operator-authorized recovery job should call `replay`. It changes a nonexpired dead-letter to retry; it cannot resurrect delivered, foreign-scope, or expired events. Success atomically records a per-scope/adapter checkpoint. That checkpoint means **last successful completion**, not an ordered provider cursor and never permission to skip earlier pending events. A lead event contains a lead ID and attribution references; it does not fetch lead answers automatically. Authorized lead retrieval/enrichment is a separate boundary.

## Privacy and retention

The worker additionally requires an injected `authorize(event)` callback before every delivery. The host must revalidate current subscription, tenant/client asset assignment, consent and adapter authorization there. A denied event is dead-lettered without invoking the adapter; an authorization dependency failure follows bounded retries. The ingestion-time mapping alone is insufficient after asset reassignment or revocation.

The event record stores bounded IDs, kind, timestamps, trusted tenant/client/asset binding, and provenance. Message bodies, recipients/senders, phone numbers, contact fields, lead answers, and raw request bodies are omitted. No module logger receives payloads or secrets. Default event retention is seven days, configurable up to 30 days. The Firestore adapter writes a top-level timestamp `expireTime`; deployment must enable TTL on that field in `platform_webhook_events`. Expired records are rejected by claims/replay immediately; Firestore TTL deletion is asynchronous. Checkpoints contain only the last event hash/time and are operational metadata.

Optional `EncryptedPayloadVault` is an AES-256-GCM utility with an injected backend, 32-byte key, key-version label, random nonce and reference, and binding/expiry/version authenticated data. It is deliberately **not wired** to the whole received batch: a batch may contain multiple clients, so storing the original batch behind one client's reference would leak data across clients. An explicitly reviewed host integration must isolate each authorized client's fragment, set a shorter retention, keep the binding digest needed for authenticated decrypt, authorize reads, configure backend TTL/deletion, and attach only the opaque reference to the corresponding event. The default receiver never retains raw payloads. No decrypt/retrieval API is exposed in V1.

## Deployment prerequisites and evidence boundary

Before mounting publicly, configure trusted subscriptions, secret references, verified asset mappings, durable Firestore access, TTL, explicit rate/body controls at ingress, a supervised retry scheduler, DLQ operational access, adapter idempotency, and monitoring of counts/latency/error codes only. Firestore queue discovery requires composite indexes combining `event.tenantId`, `event.clientId`, `event.product`, `event.assetId`, `status` and either `nextAttemptAt` or `leaseUntil`. Provision these deliberately; missing indexes fail discovery rather than silently falling back to an unscoped scan. Registry reassignment/removal must also revoke old queued delivery authority in the worker's host authorization layer before delivery.

Tests cover exact-byte signatures, strict format, challenge verification, body limits, invalid product/lead schemas, foreign assets, content omission, concurrent duplicate enqueue/claims, stale-lease fencing, bounded retries/DLQ, scoped replay/checkpoints, optional ciphertext storage, and storage-failure 503. Tests use synthetic fixtures only. No live Meta webhook, subscription, downstream delivery, Firestore transaction, or production deployment is claimed proven by these tests.

Official references: [Meta Graph webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/), [Messenger webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks/), [WhatsApp payload examples](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples/), and [Firestore TTL](https://docs.cloud.google.com/firestore/native/docs/ttl). The Meta documentation endpoints returned rate-limit/access failures during this implementation; field coverage therefore remains explicitly fixture-level until current official product contracts and test-asset delivery are verified. Firestore documentation confirms timestamp TTL fields and asynchronous deletion; claims and replay enforce expiration independently of the deletion schedule.
