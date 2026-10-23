# Scoped WhatsApp aggregate analytics

The dedicated account and template analytics adapters perform only read requests. They inspect the selected same-app BISU credential, actual client-business identity and granular Messaging Account assignment, then require current registered same-client phone/template parent closures and explicit analytics READ grants on the same connection. An account ID alone never grants access to its children.

Account metrics support typed messaging, conversation and pricing families. Requests require registered phone IDs; the adapter privately resolves actual business phone numbers for the provider filter and removes those numbers from returned output. Template metrics require registered template IDs. Returned data contains aggregate counts/cost, selected asset IDs and bounded dimensions. Button content, recipient data, credential fields and provider URLs are discarded. These approximate figures do not establish invoice reconciliation or payment ownership.

Local policy restricts a request to at most31days within the last90days; half-hour queries are at most7days. UTC template-day boundaries and30-minute account boundaries are mandatory. Results are bounded; ambiguous IDs, duplicate data points, provider pagination, changed filters/parentage, stale authorization, missing consent and malformed metrics HOLD. Template insights must already be enabled; this adapter never enables the irreversible tracking setting.

The original analytics aliases use the same dedicated transport and authorization. Dates accept strict YYYY-MM-DD or Unix-seconds strings. Account analytics additionally requires `phone_ids` in strict platform mode. Original `phone_numbers` filters are explicitly rejected: public display numbers cannot substitute for registered asset authority. Existing metric/dimension filters are never silently dropped.

All capability and native MCP tests use fake provider responses. No live analytics acceptance or production deployment is established by those tests.

Primary contract: https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics . Official generated account SDK: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/whatsappbusinessaccount.py .
