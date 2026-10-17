# Business inventory evidence and isolation

Verified on 2026-10-16 against Meta's current Business Management documentation and official generated SDK.

The Business Manager support FAQ documents ads_management, pages_read_engagement and business_management for managing client accounts and Pages. The candidate uses that explicit bundle plus the current documented permission dependencies for these seven business inventory reads. This is a conservative documented agency access bundle, not a claim that every field independently requires every scope.

Primary sources:
- https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622
- https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/pages
- https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/ad-accounts
- https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/catalog
- https://www.postman.com/meta/whatsapp-business-platform/request/yr9gqou/owned-and-client-wabas
- https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json

The fixed GET edges are owned_pages, client_pages, owned_ad_accounts, client_ad_accounts, owned_product_catalogs, client_product_catalogs and owned_whatsapp_business_accounts. The fixed projection is id,name. No financial fields, user emails, credit lines, token-bearing fields, arbitrary field expansion, ownership claims or partner mutations are exposed.

An authenticated request must target a separately verified business owned by the selected client. A business that aggregates unrelated agency clients is not an acceptable shortcut. Returned rows are additionally restricted to already registered, fresh, non-revoked children with the exact tenant, client, provider, app and BUSINESS parent. Unknown and foreign rows are withheld without returning their names or IDs. The response explicitly declares incomplete inventory and no authority change. Duplicate normalized IDs fail closed.

A provider list response does not grant a child capability, establish current billing ownership, enroll an account or renew registry evidence. Legacy WABA list identifiers must not be interpreted as proof of the separate new WhatsApp account assignment. WhatsApp product credential enrollment independently enforces its own account model.

The Business OAuth consent pack is derived from the exact selected verified READ contracts. Catalog MANAGE task requirements are not invented from business membership; task-dependent catalog contracts require separate verified task evidence.

Local tests cover foreign tenant/client/app/parent rows, stale and revoked children, duplicate IDs, ambiguous roots and fixed contract metadata. Provider acceptance remains a staging gate after appropriate credentials and app approval evidence are supplied.
