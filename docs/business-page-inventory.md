# Business Page inventory compatibility

With the platform enabled, `ads_get_pages_for_business` is an explicit scoped inventory adapter. Supply `client_id`, `business_id`, and `relationship` (`owned` or `client`); optionally select an authorized `META_BUSINESS` connection. The adapter calls the corresponding existing `business_list_owned_pages` or `business_list_client_pages` contract.

The old optional account/user fallback is rejected. Business inventory uses separately authorized Business credentials, current independent human owner evidence, and exact client/app grants. The response contains only already registered current client Pages. A returned ID never enrolls a Page, proves legal ownership or billing, or provides a Page access token. The platform-disabled baseline retains its existing behavior.

Native local MCP tests cover both fixed edges, strict schema rejection, foreign-child withholding and private-field projection. These tests use synthetic credentials and provider responses; they do not establish Lumin's current Meta approval or a live Page connection. Canonical source references and permission requirements remain in the generated product inventory.
