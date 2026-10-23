# Trusted client ad-image upload

Engineering candidate only. No deployment, live upload, account ownership transfer or billing change is established by this document.

The native marketing_upload_image action and original ads_upload_ad_image compatibility name accept a registered client ad account and source_media_id. The compatibility schema excludes the upstream arbitrary image_url/name interface while the platform is enabled. Platform-disabled baseline behavior remains preserved.

The source must be an actually decoded, immutable JPEG with exact meta_ad_image_upload rights, signed trusted ingress and a separately consumed human source-enrollment review. Upload requires another exact one-use human operation approval, fresh selected credentials/grants, a current actual account-owner observation, and separate client billing attestation. Uploading does not create or activate any ads.

Immediately before upload the server privately downloads the approved source using pinned public DNS, zero redirects, an exact host, an 8 MB limit and a 15-second deadline. It re-decodes and compares the bytes, digest and dimensions with the enrolled evidence, rechecks the private proposal and all current authorization, then makes one fixed v26 adimages POST with Base64 bytes. Provider credentials are never sent to the image host. Caller URLs, local paths, raw bytes, archives and copy_from are excluded.

Only a bounded single image hash is accepted as a receipt. The AD_IMAGE belongs to the registered account; source keys are immutable provenance rather than future authorization parents. The exact image hash is recorded in the durable terminal audit. Network uncertainty, malformed receipts or incomplete durable completion require reconciliation; neither the approval nor the operation is automatically retried.

Primary contract: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py and https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/adimages . Local native tests exercise actual JPEG enrollment, separate approval, account-prefix normalization, byte mutation, authorization revocation during download, receipt registration, unknown outcomes and original-name compatibility. These are provider fixtures, not live Meta acceptance.
