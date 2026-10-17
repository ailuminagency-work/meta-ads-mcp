# Product API rate observations

Primary source: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/

The product controller observes documented x-app-usage percentages, x-ad-account-usage account utilization and reset duration in seconds, and up to32 x-business-use-case-usage observations with estimated_time_to_regain_access in minutes. Only bounded numeric maxima affect local delay. Raw header account IDs, body text, tokens and access-tier assertions are not persisted or exposed.

Lumin conservatively pauses at75% for1second,95% for5seconds, and100% for at least60seconds; these thresholds are local pacing policy, not Meta-guaranteed reset times. A valid provider regain estimate can extend the pause up to24hours. Present malformed, oversized or excessive-cardinality usage receives a60second conservative pause. Existing Retry-After and circuit-breaker waits cannot be shortened by a later successful response. No write automatically retries.

The observations are process-local and keyed by the existing hashed provider/app/credential bucket. Each reviewed client binds that bucket to its exact selected connection app ID; app usage pauses are shared across bound credentials for the same app. BUC/account observations remain local to the credential bucket because foreign header IDs never establish authority. The controller does not coordinate replicas or third-party applications; Meta remains the ultimate rate-limit authority. Missing headers are unknown usage, not evidence of available quota or zero consumption. Product rate status must continue withholding shared global and foreign-client data.
