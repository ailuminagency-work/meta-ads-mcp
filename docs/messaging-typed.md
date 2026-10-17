# Supervised response messaging

This local implementation adds Messenger text quick replies, postback button templates, typing/seen sender actions, and single JPEG image responses. It also adds single JPEG responses for Instagram Login. Every send uses the client's selected credential, an exact registered owner and source asset where applicable, a separately approved operation, and a trusted inbound relationship in the last 24 hours. Provider acceptance is never reported as delivery or a verified human read.

The Messenger subset fixes `messaging_type=RESPONSE` for messages. Sender actions contain only recipient and sender_action, as required by the current guide. Quick replies permit 1–13 text choices, titles up to 20 characters, and a conservative ASCII payload up to 128 characters. Button templates permit 1–3 postback buttons and a 640-character message. URL, payment, login and contact-sharing buttons are excluded from this subset.

A final trusted policy deadline is checked synchronously immediately before the durable mutation claim. Expired windows fail closed. Production policy composition requires a finite deadline from the messaging policy service; the boolean verifier is only an explicit internal test injection.

JPEG sources require actual decode, immutable content-addressed CDN bytes, signed ingestion, independently scoped rights and authenticated human enrollment. `facebook_messaging` and `instagram_messaging` are separate purposes from content publishing. Their source grants contain only the exact messaging image capability and messaging action, intersected with existing parent authority. Publishing rights cannot be substituted. The Instagram Login single-image body follows the September 28, 2026 guide's `message.attachments` object; Messenger uses `message.attachment`. Raw URLs are accepted only when they exactly match the enrolled source evidence, and caller attachment IDs are excluded.

The current exact Page task used by the reviewed Messenger response contracts is `MESSAGE`. No undocumented mapping from `MESSAGING` or `PROFILE_PLUS_*` is inferred. Actual account enrollment must retain exact provider-returned tasks, and will remain unavailable when they do not satisfy the reviewed contract. External-user App Review, Advanced Access and current account permissions are independent gates.

Primary sources, read October 16, 2026:

- [Messenger Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages), updated September 28, 2026.
- [Messenger Quick Replies](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/quick-replies), updated June 17, 2026.
- [Messenger Button Template](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/template/button), updated June 17, 2026.
- [Messenger Postback Button](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/buttons/postback), updated June 17, 2026.
- [Messenger Sender Actions](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/sender-actions), updated January 21, 2026.
- [Instagram Login Send Messages](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api), updated September 28, 2026.

Local fake-provider tests cover native MCP preparation, authenticated human approval, actual messaging-policy service verification and exact provider bodies. These are engineering evidence, not live Meta authorization or staging acceptance. No production deployment or live message was performed.

Generic structured response cards are also supported through `messenger_send_generic_template`:1..10 ordered cards, each a title up to80characters plus subtitle up to80characters or1..3strictpostbackbuttons. The current [Meta generic template reference](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/template/generic) (Apr22,2026) supplies these bounds. This typed subset fixes RESPONSE and disables sharing, and retains the same trusted24h inbound policy, client/Page isolation, separate human approval and final reauthorization. Arbitrary image/link/default-action data is rejected. This structured response tool does not imply eligibility for Messenger Utility messages, whose separate current guide requires `page_utility_messaging` and approved Page-owned templates.
