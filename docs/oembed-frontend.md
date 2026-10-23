# Tokenless frontend-only oEmbed previews

Meta removed access-token and App Review requirements for public oEmbed on June15,2026. Current references verify Graph v26.0 GET /oembed_post and /instagram_oembed. The provider tokenless quota is1000requests per endpoint/hour; Lumin also reserves a conservative process-local rolling-hour count before every attempt and honors actual rate headers. Other replicas and third-party actors are not coordinated locally; Meta remains authoritative.

Set LUMIN_PLATFORM_OEMBED_ENABLED=true only with LUMIN_PLATFORM_ENABLED=true to enable the dedicated tools and authenticated /platform/embeds frontend. Default is false. The tools accept an exact client_id, purpose FRONTEND_EMBED and a strict public content URL. The Facebook initial subset is numeric Page/user /posts/{numeric-or-pfbid}; Instagram supports /p/{shortcode}/ and /reel/{shortcode}/. Queries, fragments, credentials, ports, private URLs and arbitrary fetch destinations are rejected. The server fetches only the fixed Meta endpoint, without provider tokens, cookies or redirects, with fields=html and omitscript=true. Facebook additionally selects documented useiframe=true.

MCP responses contain only preview status, an opaque authenticated preview path and expiry. Provider HTML and content URLs never enter model output, registry, persistent audit or logs. Tickets contain HTML only in process memory, have a five-minute expiry and active deletion timer, and are capped at200tickets. Process restarts discard every preview. Provider responses are bounded to128KiB and embed HTML to64KiB. Failed or uncertain requests are not automatically retried.

The preview requires the same authenticated tenant/operator and current active client membership. The server checks membership before/after fetching and at display time; privacy locks are honored. An opaque ticket grants no Meta asset authority. Provider HTML renders in sandbox srcdoc without allow-same-origin, own-origin network or inline scripts. CSP allows external Meta frames/images and only the fixed Instagram embed.js renderer linked by the official guide. Parent cookies cannot be read by the opaque child. No HTML is evaluated by the server. The sandbox may limit provider interactivity; external embed availability is determined by Meta.

This feature exists solely to provide a front-end view. Instagram prohibits consuming, extracting, manipulating or persisting embed metadata/content for analytics or other purposes. No analytics, author IDs, thumbnails, text extraction, public lookup grants or alternative token-bearing endpoint are implemented. Private/inactive/age-restricted/embeds-disabled content and Instagram Stories are unsupported by the documented embedding service.

Primary sources:
- https://developers.facebook.com/blog/post/2026/06/15/tokenless-access-to-meta-oembed-apis
- https://developers.facebook.com/docs/graph-api/reference/oembed-post/
- https://developers.facebook.com/documentation/instagram-platform/oembed

Local tests use fake Meta responses and an ephemeral authenticated test server. Live-provider rendering, browser acceptance, deployment configuration and owner acceptance remain separate checks.
