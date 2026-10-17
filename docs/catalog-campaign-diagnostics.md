# Registered catalog campaign input diagnostics

This default-off read combines one explicitly registered Marketing AdSet/Campaign/account with one separately registered Business-provider Catalog/Business. It uses two independent authorized USER credentials and one final atomic authorization checkpoint. A catalog ID appearing in a Marketing response never creates catalog access, ownership or a cross-provider parent relationship.

The pinned official Meta Python SDK 26.0.2 provides the transport/schema evidence:

- [AdSet](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects/adset.py) exposes promoted_object.
- [AdPromotedObject](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects/adpromotedobject.py) exposes product_catalog_id and product_set_id.
- [Campaign](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects/campaign.py) exposes advantage_state_info, whose [typed object](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects/adcampaigngroupadvantagestate.py) has four string state fields.

No catalog-to-campaign inventory edge was found in the pinned ProductCatalog SDK. The implementation therefore reads only the submitted registered AdSet and its exact registered Campaign/account closure. It returns OBSERVED_MATCH, OBSERVED_DIFFERENT_CATALOG or UNKNOWN for the catalog reference, and bounded actual Advantage state strings or null. Foreign catalog/product-set IDs are withheld. Missing fields never imply disabled settings, eligibility or healthy delivery. This is not an exhaustive linked-campaign inventory, an Advantage+ certification, targeting authority or an optimization/write action.

The Catalog half executes the existing catalog_get_item_diagnostics transport, including actual owner_business verification, current client-owned Business evidence, literal catalog MANAGE authority and aggregate-only item diagnostics. Every original authorization row and both actual selected ciphertext envelopes must remain identical at the final dual read boundary. Membership, operator indices, provider app-user privacy and lifecycle locks are checked together; checking two scopes sequentially would leave a disclosure race.

Ordinary Marketing USER OAuth enrolls account roots; it does not directly grant arbitrary existing AdSets. The selected diagnostic capability must already cover a separately reviewed or created registered Campaign/AdSet chain (for example inherited from the approved parent capability set). This diagnostic never imports or repairs that chain.

Enable LUMIN_CATALOG_CAMPAIGN_DIAGNOSTICS_ENABLED only for a reviewed candidate with the platform enabled and both existing credentials/capability grants. SDK schema evidence does not establish live Meta approval, current client permissions, actual Advantage+ availability or successful provider calls. No deployment, real provider read or provider mutation is performed by the fixture tests.
