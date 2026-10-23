# Trusted video intake and publication

These routes are candidate engineering and default off. Local tests use synthetic bytes, fake credentials and simulated provider responses. They establish neither Meta app eligibility nor live publication acceptance.

## Facebook Page video

`LUMIN_PAGE_VIDEO_ENABLED=true` permits the dedicated Page-video workflow only when the main platform flag is enabled. Signed intake additionally requires `LUMIN_VIDEO_INGRESS_ENABLED=true`, a deployment-owned `LUMIN_VIDEO_INGRESS_PROFILES_JSON`, an existing session secret, the token encryption key and each profile's referenced ingress key. Profile app IDs must equal the configured Meta app. No credentials belong in profile JSON or committed files.

The raw signed route is `/platform/videos/ingress/:profileId`; authenticated human source review is `/platform/videos/review/:proposalId`. The profile binds the tenant, client, operator, Page, connection, app, exact CDN host and `facebook_video_publishing` rights. Intake does not download an arbitrary URL or call Meta.

The supported bytes are immutable, non-AI-generated MP4, H.264/yuv420p with optional AAC, at most 16 MiB, 60 seconds, 30 frames per second and 1920x1080 or portrait equivalent. Actual full decoding is bounded by input size, pixels, frame count, process deadlines, output limits and single-request concurrency. FFmpeg's `max_alloc` limits individual allocations; it is not a total operating-system memory ceiling. The hosted container must have its separately reviewed memory limit.

Human source enrollment atomically installs only the exact Page-bound source and parent-grant-derived authority. A second human approval binds the publication Page, source, title and description. A dedicated one-attempt client posts only to the fixed Graph Video endpoint. `published=true` is server controlled. No automatic retry, upload phase, arbitrary endpoint or caller token is accepted. Ambiguous outcomes retain a permanent source claim. A returned Video ID is registered atomically; it is not proof that processing or publication completed. The separate status tool requires the actual returned creator Page and reports publication verified only when `ready` and `published=true` both hold.

## Instagram and Threads video

`LUMIN_PUBLISHING_VIDEO_ENABLED` defaults false and requires the main platform flag. `LUMIN_PUBLISHING_VIDEO_PROFILES_JSON` is deployment owned. Its profile additionally specifies an exact list of independently verified video draft tools. Each profile uses a distinct `LUMIN_PUBLISHING_VIDEO_INGRESS_KEY_*` reference, the exact provider app ID and exact `instagram_video_publishing` or `threads_video_publishing` rights. Threads profiles bind `THREADS_APP_ID`. Instagram Login profiles bind `INSTAGRAM_APP_ID`; Facebook Login profiles bind `META_APP_ID`.

The raw signed route is `/platform/publishing-videos/ingress/:profileId`; protected review is `/platform/publishing-videos/review/:proposalId`. Signing binds the entire immutable profile, exact bytes, delivery ID and freshness window. The approved URL must match the configured CDN host. Rights approved for a Facebook Page, another client, another app or another Instagram login strategy cannot substitute.

The initial Instagram and Threads subset is stricter than Meta's maximum: 3–60 seconds, 23–30 frames per second, H.264/yuv420p, progressive, no MP4 edit lists, closed GOPs consisting of IDR I pictures and P pictures, optional AAC at 44.1/48 kHz and at most 128 kbps, maximum 16 MiB and conservative total average bitrate at most 25 Mbps. The service inspects actual container atoms and extracted H.264 slice headers and performs full decoding; it does not trust uploaded codec declarations. Normalized evidence records the actual inspection source.

Exact configured modes are Reels, video Stories and video carousel items. The server fixes each provider media type and child flag. Video AI sources are currently denied. Reels may have a reviewed caption; Stories and carousel items do not accept one in this subset. Carousel children cannot be published directly. A source may support separately approved drafts only within its explicit provider purpose and current rights; it cannot renew its own evidence. Every draft consumes a distinct one-use approval. Unknown draft outcomes do not retry that approval. Publication requires actual readiness, a separate approval and a permanent container claim; unknown publication remains claimed.

Source grants contain only configured verified draft capabilities plus the same provider's exact status/publication capabilities already authorized on every parent. They contain no copied Page tasks. For Facebook Login, current literal `CREATE_CONTENT` authority remains scoped to the linked Page. The source itself is not a publishable container and cannot pass container-kind validation.

Threads standalone video and video carousel-child modes use the same stricter byte envelope with separate Threads rights and exact Threads account authority. The actual standalone native journey covers signed ingress, human source review, separately approved draft/status/publication and UNKNOWN claim retention. Ordered parent carousel contracts and atomic child claims are integrated; their additional native checks remain a separate test result. Merely adding a profile cannot enable an unverified transport.

## Later gates

Before any staging enablement, review the exact deployment revision, container resource limits, profile/key stores, provider app review and scopes, current client-owned assets, current literal tasks, rights artifacts and protected human routes. Real Meta consent, authenticated provider reads, publication authorization and owner acceptance remain separate gates. These instructions do not authorize production activation or a real upload.
