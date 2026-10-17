# Conservative CRM USER OAuth enrollment candidate

Local engineering only. No live Meta token, CRM dispatch or deployment is certified by these fixtures.

The trusted deployment OAuth profile may select `signals.send.crm.lead.event` with `legacy.ads_get_account_info`, optional existing Pixel metadata READ capabilities, exact actions READ and WRITE_NON_FINANCIAL, token type USER, and no Page tasks. The fixed local consent pack is public_profile, ads_read and ads_management plus verified permission dependencies. This is a conservative Lumin boundary, not a claim about Events Manager CRM-specific tokens or Meta endpoint minimum scopes.

`crmRootIds` binds the exact already registered accountId and pixelId. New human-discovered Pixels have both Business and account parents; their profile additionally specifies businessId and the business_management dependency pack. Existing one-account-parent Pixels retain the narrow two-root mode. The complete registered same-client/app closure is checked before consent and again before atomic enrollment. Returned provider IDs do not create assets.

Actual enrollment inspects same-app USER token identity, exact granted scopes and expiry, current account mutation tasks, owner business, and a complete bounded account Pixel membership page. Three-root mode additionally checks actual Business membership and its owned account. A separately reviewed client-business artifact must already authorize that Business. OAuth grants do not establish billing ownership, CRM eligibility, source lead origin, delivery or optimization.

Credential inspection and dispatch remain separately default off behind LUMIN_CRM_SIGNALS_ENABLED and LUMIN_CRM_USER_CREDENTIAL_INSPECTION_ENABLED. Signed Meta lead origin, authorized current private source metadata, signed first-party CRM stages, protected human eligibility records and a fresh one-time mutation approval are all still required. The concrete dispatch inspector rechecks the actual selected USER credential/account/Pixel; universal permit credential pinning prevents same-ID token rotation between outer and nested checks. UNKNOWN does not retry.

The local native journey exercises Dataset USER OAuth, actual fake-provider Pixel discovery, protected human enrollment, a separate CRM USER OAuth grant, signed source ingestion, human action approval and the inspected one-attempt provider request. Its result is provider acceptance only; delivery and optimization remain explicitly unverified.
