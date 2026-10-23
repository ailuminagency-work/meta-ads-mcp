# Disabled static ad pause rule

`marketing_create_disabled_pause_rule` creates one DISABLED rule for1..10 exact registered ads in a client-owned account. It requires a separate human approval, current authority for each selected ad and its registered ancestors, fresh actual ad/account/campaign/ad-set receipts, and the existing account ownership/financial gates. Local scopes ads_read and ads_management are conservative requirements, not a claim of the provider minimum.

The server owns DAILY scheduling (midnight account timezone), PAUSE execution, LAST_7_DAYS, ACTIVE filtering and the impressions threshold comparison. IDs remain validated decimal strings until deterministic JSON integer serialization; JavaScript floating-point conversion never changes large Meta IDs. The exact serialized specifications are bound into the approved plan. Arbitrary filters, notifications, activation and immediate execution are excluded. A created disabled rule does not prove it will run or produce an outcome. Transport loss or an invalid receipt consumes the attempt and requires reconciliation.

Primary sources: [scheduled rules](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-rules/guides/scheduled-based-rules), [evaluation specification](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-rules/overview/evaluation-spec), and [execution specification](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-rules/overview/execution-spec). The current main guide links the older execution specification; the implementation uses only its documented PAUSE action with no execution options.

Validation uses synthetic providers only. No live rule has been created, activated or executed.
