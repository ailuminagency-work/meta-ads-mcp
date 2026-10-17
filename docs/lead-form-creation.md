# Reviewed Page lead-form creation

`leads_create_form` creates one form for an exact registered client Page. The original `ads_create_lead_form` name delegates to the same transport and accepts the canonical action's one-time approval reference. Prepare `leads_create_form` first; a human reviews the Page, questions and destinations before execution.

The Page token must belong to this Page and carry the documented permission pack and literal `ADVERTISE` authority. A fresh provider read must confirm `leadgen_tos_accepted` for the same Page. This service cannot accept terms, switch Pages, use an unscoped user credential or infer Page authority from an ad-account token.

The bounded schema supports full name, email, phone and custom text or selection questions, with distinct question/option keys and at least one email or phone field. Privacy-policy and follow-up destinations must be explicit public HTTPS URLs without credentials, query strings or fragments. English US and Spanish Latin America locales are supported. Higher-intent review and organic-lead filtering are fixed on. Government-ID, store-locator, attachment, scheduling and arbitrary JSON variants remain outside this schema.

The provider receives its documented `privacy_policy` object, rather than an unsupported flat creation parameter. Creation does not create an ad or activate spend. The receipt records only the form ID; atomic completion registers the form under its Page with no Page tasks copied onto the form. Transport uncertainty is recorded for reconciliation, and a consumed approval cannot retry the POST.

Primary references checked 2026-10-16: [Lead Forms for Ads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/create), [Meta's Page SDK definition](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py), and [Meta's privacy-policy object](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/leadgenprivacypolicy.py). The Page SDK also defines the Boolean terms-acceptance field used by the preflight.

Local native tests cover proposal preparation, separate human approval, original-name compatibility, owner-accepted terms, wrong Page rejection, atomic registration and uncertain-outcome no-retry behavior. Fake provider responses establish engineering behavior only. Actual staging Page consent, App Review eligibility and owner acceptance remain separate gates.
