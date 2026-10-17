# Registered AdsDataset metadata reads

`signals_get_dataset` is a bounded read of an explicitly registered AdsDataset. It requires the exact DATASET ID plus separately registered Business and advertiser-account references, all with current same-client, same-app, same-provider USER-token READ grants. The initial profile requires reviewed registry/credential bootstrap; automatic Dataset OAuth enrollment and SYSTEM-token enrollment are not claimed.

The dedicated client reads the documented Business `ads_dataset` edge with the exact string `id_filter`, fixed metadata fields and a bounded first page. Both returned wrapper `id` and `dataset_id` must equal the registered DATASET ID. Different wrapper mappings, missing owners, non-consolidated containers, extra matches and pagination remain HOLD. It separately reads the advertiser account and requires exact actual Business ownership references. Current independent human Business ownership evidence remains mandatory; API membership does not establish legal ownership or billing authority.

Only ID, bounded name, consolidated status and exact Business/account IDs reach the model. Provider extras, raw events, customer data and URLs are withheld. There is no automatic discovery/enrollment, Pixel-to-Dataset ID conversion, implicit grant or generic event-write authority. The generic `signals_send_events` route remains HOLD.

Primary contracts are the current official SDK [Business edge](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects/business.py) and [AdsDataset fields](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects/adsdataset.py). The separate plain Dataset class is not used as a substitute. Local ads_read/business_management scopes plus documented dependency scopes are conservative requirements, not a provider minimum-scope claim. Live eligibility, provider access and unknown wrapper mappings require actual authorized verification.

Verification uses synthetic providers only. No live datasets were queried and no dataset event was submitted.

The Page-named dependency scopes pages_read_engagement/pages_show_list are inherited from the audited shared business_management permission dependency graph. They grant no Page tasks and this transport makes no Page API request. They are not claimed as endpoint-specific AdsDataset minima.
