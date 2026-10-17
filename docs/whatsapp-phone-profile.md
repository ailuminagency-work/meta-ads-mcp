# WhatsApp phone and public business profile

The dedicated adapter lists authorized registered phones, reads one phone's bounded verification/quality metadata, reads its public business profile and performs one separately reviewed profile update. It verifies the actual BISU token's app, subject, scopes and granular Messaging Account access, the client_business_id, fresh dual-account owner evidence, and current phone membership on the exact Messaging Account phone_numbers edge.

Phone registry parents must include the same client's WhatsApp Account and Messaging Account. List output also requires each child's fresh registry verification, current exact get-phone READ capability, grant and selected connection; unregistered or stale children are withheld. The list never claims complete inventory or changes authority.

Profile reads return bounded about/address/description/email/websites/vertical fields. Picture URLs and handles are excluded. Profile updates accept those same public contact fields, require at least one change, and send messaging_product=whatsapp from the server. Website updates accept at most two credential-free HTTPS URLs; undefined/non-business verticals and credential-shaped text are rejected. Updates have one durable claim, one provider attempt and a terminal audit; uncertain results require reconciliation and are not retried automatically.

Phone registration, deregistration, verification-code submission, display-name review and profile picture uploads are separate operations. A quality/verification metadata read does not prove readiness to send, user consent, messaging-window eligibility, delivery or billing ownership.

Original phone/profile tool names map to the same canonical executor in strict platform mode. Arbitrary fields and webhook callback overrides are rejected instead of silently ignored. Original own-app webhook subscription aliases likewise use the dedicated same-app subscription transport and human approval boundary.

Primary references:

- [Business profiles](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles)
- [Business Profile API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-profile-api)
- [Phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers)

All current acceptance evidence uses fake providers. Credentials, current manual eligibility/owner attestations, Meta approval and independent deployment authorization remain external gates.
