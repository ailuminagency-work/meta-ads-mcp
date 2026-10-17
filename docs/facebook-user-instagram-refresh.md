# Facebook User Instagram authority refresh

The operational adapter uses the existing exact Facebook User connection. It does not rotate a token, request additional permissions, extend source-media rights, renew container processing evidence, or infer App Review eligibility. Token expiry still requires a new authorized OAuth flow.

A separately approved human REFRESH_GRANTS command performs fixed Graph v26.0 reads: debug_token with same-app secret authorization; me id; me/permissions with exact current granted scope equality; bounded me/accounts id/tasks; exact registered Page instagram_business_account; every registered published media id/owner; and each registered comment id/media/parent_id. Literal Page tasks remain scoped to the Page. PROFILE_PLUS aliases are never invented. Background task enumeration is rejected.

Every request checks the current trusted runtime connection and membership/lock state. Host wiring must supply the USER-specific current-state check; the Page-token delegation runtime cannot be reused unchanged because the User connection subject is the app user, not the Page. Human command approval is checked repeatedly during pagination and after provider reads. Shared operational snapshot comparison commits the observed authority refresh atomically.

Approved JPEG source assets and consumed Instagram containers are preservation-only. The helper requires exact trusted evidence and a permanent publication claim for a consumed container. Their original asset, grant, expiry, revision, source rights and status evidence remain byte-for-byte unchanged, including expired records. Only provider-proven Page/account/published-media/comment authority receives new freshness. No old container claim is cleared or made reusable.

Current tests use synthetic tokens, fake provider responses and the in-memory operational store. They cover literal tasks, subject/app/permission/link/owner/comment-parent changes, background denial, lifecycle locking, and actual supervised atomic refresh with preservation. They do not establish live credentials, external-user App Review, production deployment or client acceptance.
