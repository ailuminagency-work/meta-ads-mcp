# Request-scoped Page token for lead-form metadata

The legacy HTTP lead-form listing previously used the ordinary user credential for the Page leadgen_forms edge. The Page read now derives an authorized Page credential with the current request's user token, verifies the Page identity using /me, and uses that credential only for one GET of form metadata.

The credential remains in memory, is sent only as a Bearer header to the fixed Graph host, is never registered or persisted, and is not returned with results. Redirects are rejected. The complete operation has a 30-second signal deadline, response bodies are bounded, and nested response schemas remove unrequested fields. Provider messages are not surfaced. There are no retries. Module-shared Page-read throttling handles provider usage headers, Retry-After, rate-limit codes and non-JSON HTTP 429 responses. This dedicated state is separate from the general Meta client's rate-state snapshot.

V1 platform-enabled mode retains its existing execution-permit and credential selection path. The helper explicitly rejects platform mode. The legacy helper requires an authenticated HTTP request identity; stdio/global-token-only callers are deliberately rejected instead of falling back to an unrelated credential. No write, enrollment, asset assignment, OAuth scope or billing logic changes.

Certification must include concurrency, wrong-Page identity, missing request context, global fallback denial, malformed response, nested field stripping, credential echoes, provider denial and cooldown tests. Synthetic tests are not live provider acceptance.

Deployment remains separate: identify and certify the actual backend used by the connector before applying the patch. After an authorized deployment, call ads_get_lead_forms for an authorized Page with metadata-only fields. A successful list (including an empty list) proves that read. Permission denials require reviewing the app's granted scopes and Page lead access; do not automatically expand permissions or register a copied Page token. Lead retrieval and form creation are outside this correction.
