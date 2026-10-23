# WhatsApp Flows

The platform supports separately reviewed Flow draft creation, metadata edits, JSON uploads, reads, publication, deprecation and draft deletion. Every mutation requires an exact human approval and a single durable execution claim. Creation always sends publish=false. A created draft with provider validation errors is registered with a PARTIAL audit outcome for correction; it is never automatically published.

The dedicated transport checks the actual token's app, subject, both WhatsApp scopes and granular Messaging Account assignment, the client business, the deployment-owned dual-account owner attestation, and the registered WAAC → Messaging Account → Flow parent chain. Fresh manual eligibility records are trusted operator attestations; a documentation URL alone does not prove app review or account approval. Existing client-owned account and billing boundaries remain in force.

The static JSON builder uses Flow JSON 7.3 and supports bounded text, text inputs, text areas, dropdowns and a single-date CalendarPicker. buildWhatsAppBookingRequestFlow builds an appointment request using client-supplied appointment choices, timezone, dates and time slots. The business must confirm availability. This form does not reserve a calendar slot, collect payment, send a message, or claim a scheduling integration. Completion payload bindings refer only to fields in the same form; credential inputs, external endpoints and arbitrary expressions are rejected.

Publication separately compares the exact approved canonical JSON with Meta's current flow.json asset, verifies the Flow's app and parent, DRAFT status, JSON version and absence of validation errors, then makes one publication request. Meta offers no transaction spanning this read and publication: another administrator could edit the Flow between them. The platform does not claim a Meta-side compare-and-swap guarantee. An uncertain mutation is retained for reconciliation and is never automatically retried.

Paused operational jobs have an authenticated review page at /jobs/:id/review under the configured operational host mount. It explains the job and current state and offers only state-appropriate controls. A signed, expiring, principal-bound and exact-revision form prevents stale reviews from changing a newer job. Starting a job only changes its durable scheduling state; it does not fabricate provider access or bypass current worker authorization.

These modules are engineering candidates with fake-provider acceptance tests. They are not a deployed service or proof of live Meta approval. Default-off runtime flags and explicit deployment authorization remain required.

Primary references:

- [Flows API guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi)
- [Flow components](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/components)
- [Flow JSON](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowjson)
- [Supported versions](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/changelogs)
