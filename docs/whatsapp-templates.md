# WhatsApp template management

The dedicated template adapter supports reviewed creation, exact registered-template reads, complete text-component replacement and deletion of one exact template ID/name pair. These are separate operations with separate human approvals. A creation response reports Meta's actual category and review status; submission is not approval, message sending, consent or delivery.

The text-only contract supports one BODY, an optional TEXT HEADER and optional FOOTER. Positional parameters must be contiguous and have exactly matching example values. Utility and marketing creation are supported. Authentication/OTP, media, buttons, arbitrary uploaded handles and message dispatch require separate contracts and are not silently inferred from this adapter.

Actual token inspection verifies app, user, scopes, granular Messaging Account access and client_business_id. Separate deployment-owned fresh owner evidence establishes the registered client-owned WAAC and Messaging Account pair. The exact Messaging Account's template edge proves each existing template's membership before reads or mutations. A bounded 100-row response with further pages holds rather than claiming complete membership proof. It never follows a provider-supplied next URL.

An edit replaces all components and can trigger renewed review. The adapter permits documented APPROVED, REJECTED or PAUSED states; Meta's edit-frequency and category rules still apply. Deletion sends both hsm_id and name. Name-only deletion is excluded because Meta would delete every language sharing that name. DISABLED templates are not deleted. Meta may keep accepted deletions pending, and approved names may remain unavailable for 30 days.

There is no Meta-side compare-and-swap spanning state inspection and mutation. Another administrator could change provider state in between. Each mutation has one durable claim and one network attempt; uncertain outcomes require reconciliation and are not retried automatically. All current client-owned account and billing rules remain in force.

Primary references:

- [Template management and deletion limitations](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management)
- [Text components and parameter examples](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components)
- [Message Templates API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api)

This is a local engineering candidate with fake-provider tests. External-client App Review, Tech Provider eligibility, credentials, owner attestations, consent and separate deployment authorization remain external gates. No live capability is established by these tests.

Original WhatsApp tool names now have strict compatibility mappings for template/Flow metadata reads and the equivalent reviewed mutations. Their client_id and approval_id extensions apply only in platform mode; the baseline implementation is retained when that mode is off. Approval preparation maps the original name to the same canonical product intent, and execution invokes the same product executor, provider checks, single claim and audit completion. Legacy name-only template deletion, arbitrary field selection, combined Flow metadata/content updates and immediate publication are rejected. Flow publication requires the exact reviewed flow_json. Lists return only currently authorized, fresh registered children and clearly retain incomplete-inventory status.
