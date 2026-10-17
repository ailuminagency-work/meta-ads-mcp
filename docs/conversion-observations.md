# Conversion dispatch and diagnostics

This candidate implements reference-only first-party event dispatch. The private source adapter supplies actual events and current consent; MCP callers supply source and consent references. Customer match values are normalized and hashed, while source content stays out of tool results and audit summaries. Dispatch checkpoints prevent automatic retries after uncertain outcomes.

`meta_signal_status` reads one authorized Pixel's local checkpoint after rechecking the original source, consent and membership. `ACCEPTED` records the provider's event-count receipt. It does not establish attribution, customer matching quality or successful business outcomes. The read neither sends nor retries an event. A missing checkpoint is unknown rather than evidence of delivery failure.

`signals_get_offline_quality` uses the documented `/v26.0/dataset_quality` endpoint, with the registered client Pixel as the server-bound dataset parameter. It returns provider scores for composite quality, match keys, frequency and freshness. Missing scores remain unknown; custom event names and recommendation text are withheld. The conservative permission pack requires `ads_read` plus `ads_management`, a user/system-user credential, current dataset access and independently verified access-tier evidence. It does not grant omnichannel advertising eligibility.

Reference checked 2026-10-16: [Meta's offline Dataset Quality API](https://developers.facebook.com/documentation/ads-commerce/conversions-api/dataset-quality-api/offline-events).

Physical-store dispatch first reads the exact registered Pixel's `is_consolidated_container` value. A foreign ID, missing value or false result prevents the event POST. This uses Meta's documented consolidation test; it does not infer an unrelated DATASET asset from a Pixel ID. Generic DATASET tools remain unavailable until their own ownership and credential mapping is established. The candidate retains a conservative seven-day local event-age policy, including physical-store events; older offline transactions require a separately reviewed policy expansion.

Reference checked 2026-10-16: [Meta's offline conversion integration](https://developers.facebook.com/documentation/ads-commerce/conversions-api/offline-events).

The private event schema accepts consent-bound Limited Data Use options with documented explicit US state codes 1000–1013 and country 1. It preserves the source's choice and rejects incomplete or unknown combinations. Automatic geolocation and raw customer IP addresses are excluded from this subset. Lumin makes no legal applicability decision on the customer's behalf.

Reference checked 2026-10-16: [Meta's data-processing option reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/data-processing-options).

Meta's test-event code does not isolate events from targeting or measurement. This candidate therefore offers local fixture validation and provider-side Events Manager verification as separate gates; it accepts neither caller-fabricated conversions nor a test-code shortcut to a real client dataset. Native tests use fake transports exclusively.

Reference checked 2026-10-16: [Using the Conversions API](https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api).
