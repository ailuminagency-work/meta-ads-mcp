# Bounded Threads public discovery

Current primary documentation was read on2026-10-16: [keyword and topic tag search](https://developers.facebook.com/documentation/threads/keyword-search), updated2026-01-21, and [mentions](https://developers.facebook.com/documentation/threads/threads-mentions), updated2025-03-27. The implementation uses separate Threads OAuth and the configured Threads API version.

`threads_keyword_search` requires `threads_basic` and `threads_keyword_search`. The bounded initial schema accepts a keyword, TOP or RECENT ordering and a limit of1..100. Arbitrary fields, usernames, time windows, topic-tag mode, raw URLs and automatic pagination are excluded from this initial subset. The server owns the `/keyword_search` request and the projection `id,media_type,timestamp`.

`threads_get_mentions` requires `threads_basic` and `threads_manage_mentions`. It queries only the current authenticated account's mentions. Both tools independently read `/me?fields=id` and require that actual subject to match the exact registered client Threads account before discovering results.

Public keyword results require Meta approval. Before approval Meta restricts results to the authenticated user's posts. Mentions without Advanced Access include only mentions by app testers; private users' media is excluded. The server requires independently recorded public-access eligibility instead of presenting those restricted results as complete competitor research or brand monitoring.

Meta's keyword search allowance is2200 queries per user across apps in a rolling24-hour period. Repeated keywords count; queries with no results do not. Meta also excludes sensitive keywords. The shared provider rate controller blocks known exhausted buckets and observes actual response headers; it does not claim to know remaining quota consumed by other apps. Calls do not retry provider requests automatically.

Each call returns at most one page of public IDs, media types and timestamps, plus a `has_more` boolean. It never returns raw continuation URLs, text, usernames, credentials or media URLs. Empty results remain uncertain. Public discoveries never create client assets, grants, publishing authority or cross-client access. Local native-MCP tests use fake provider responses and do not certify live external-client grants.
