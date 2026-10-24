# Generated V1 tool inventory

Source inventory only. Regenerate with `npm exec tsx scripts/generate-platform-inventory.ts` after the source is frozen. This file establishes neither a tested commit nor deployment, provider permission, owner acceptance or live capability. Baseline tools remain registered; strict migration HOLD is unfinished engineering, not a Meta rejection.

| Measurement | Count |
|---|---:|
| registeredTools | 371 |
| legacyTools | 142 |
| strictLegacyReads | 65 |
| strictLegacyWriteSubsets | 32 |
| strictLegacyReviewWorkflows | 1 |
| legacyEngineeringHolds | 44 |
| productContracts | 183 |
| verifiedProductSubsets | 177 |
| unverifiedProductHolds | 6 |
| controlAndWorkflowTools | 46 |

## Product contracts and permission matrix

| Tool | Module / provider | Registration / contract | Method / path | Required scopes | Token / task subset |
|---|---|---|---|---|---|
| whatsapp_platform_list_flows | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/flows | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_get_flow | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_create_flow | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/flows | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_update_flow | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id} | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_upload_flow_json | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/assets | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_publish_flow | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/publish | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_deprecate_flow | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/deprecate | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_delete_flow | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id} | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_list_templates | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/message_templates | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_create_template | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/message_templates | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_get_template | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_update_template | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id} | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_delete_template | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id}/message_templates | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_get_subscriptions | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/subscribed_apps | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_subscribe | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/subscribed_apps | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_unsubscribe | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id}/subscribed_apps | whatsapp_business_management | business_integration_system_user /  |
| messenger_get_message | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | pages_manage_metadata, pages_read_engagement, pages_messaging, pages_show_list | page / MESSAGING on PAGE |
| instagram_get_message | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_basic, instagram_manage_messages, pages_manage_metadata, pages_read_user_content, pages_show_list, pages_read_engagement | page / MESSAGING |
| instagram_login_get_message | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_business_basic, instagram_business_manage_messages | instagram /  |
| business_get | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | business_management, pages_read_engagement, pages_show_list | user /  |
| business_list_owned_pages | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/owned_pages | business_management, ads_management, pages_read_engagement, pages_show_list | user /  |
| business_list_client_pages | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/client_pages | business_management, ads_management, pages_read_engagement, pages_show_list | user /  |
| business_list_owned_ad_accounts | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/owned_ad_accounts | business_management, ads_management, pages_read_engagement, pages_show_list | user /  |
| business_list_client_ad_accounts | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/client_ad_accounts | business_management, ads_management, pages_read_engagement, pages_show_list | user /  |
| business_list_owned_catalogs | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/owned_product_catalogs | business_management, ads_management, pages_read_engagement, pages_show_list | user /  |
| business_list_client_catalogs | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/client_product_catalogs | business_management, ads_management, pages_read_engagement, pages_show_list | user /  |
| business_list_owned_wabas | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/owned_whatsapp_business_accounts | business_management, ads_management, pages_read_engagement, pages_show_list | user /  |
| business_list_users | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/business_users | business_management, pages_read_engagement, pages_show_list | user /  |
| business_list_system_users | business / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/system_users | business_management, pages_read_engagement, pages_show_list | user /  |
| business_get_asset_permissions | business / META_BUSINESS | registered / ENGINEERING_UNVERIFIED_HOLD | GET /{asset_id}/assigned_users | business_management |  /  |
| pages_get | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | pages_show_list, pages_read_engagement | page /  |
| pages_list_posts | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/posts | pages_read_engagement, pages_read_user_content, pages_show_list | page / CREATE_CONTENT |
| pages_list_published_posts | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/published_posts | pages_read_engagement, pages_read_user_content, pages_show_list | page / CREATE_CONTENT |
| pages_list_scheduled_posts | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/scheduled_posts | pages_read_engagement, pages_read_user_content, pages_show_list | page / CREATE_CONTENT |
| pages_list_feed | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/feed | pages_read_engagement, pages_read_user_content, pages_show_list | page / CREATE_CONTENT |
| pages_get_insights | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/insights | read_insights, pages_read_engagement, pages_show_list | page / ANALYZE |
| pages_get_subscriptions | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/subscribed_apps | pages_manage_metadata, pages_show_list | page / CREATE_CONTENT |
| pages_create_feed | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/feed | pages_manage_posts, pages_read_engagement, pages_show_list | page / CREATE_CONTENT |
| pages_create_videos | Facebook Pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/videos | pages_show_list, pages_read_engagement, pages_manage_posts | page / CREATE_CONTENT on PAGE |
| pages_get_video_status | Facebook Pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | pages_show_list, pages_read_engagement | page / CREATE_CONTENT on PAGE |
| pages_create_photos | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/photos | pages_manage_posts, pages_read_engagement, pages_show_list | page / CREATE_CONTENT, MANAGE, MODERATE |
| pages_edit_post | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id} | pages_manage_posts, pages_read_engagement, pages_show_list | page / CREATE_CONTENT, MANAGE, MODERATE |
| pages_delete_post | pages / META_FACEBOOK_PAGES | registered / ENGINEERING_UNVERIFIED_HOLD | DELETE /{asset_id} | pages_manage_posts |  /  |
| pages_reply_comment | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/comments | pages_manage_engagement, pages_read_engagement, pages_read_user_content, pages_show_list | page / MODERATE on PAGE |
| pages_hide_comment | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id} | pages_manage_engagement, pages_read_engagement, pages_read_user_content, pages_show_list | page / MODERATE, CREATE_CONTENT |
| pages_delete_comment | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id} | pages_manage_engagement, pages_read_engagement, pages_read_user_content, pages_show_list | page / MODERATE, CREATE_CONTENT |
| instagram_get_profile | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_basic, pages_read_engagement, ads_management, business_management, pages_read_user_content, pages_show_list | user /  |
| instagram_list_media | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/media | instagram_basic, pages_read_engagement, ads_management, business_management, pages_read_user_content, pages_show_list | user /  |
| instagram_create_container | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_publish_container | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media_publish | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_get_container_status | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_business_discovery | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_basic, instagram_manage_insights, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user /  |
| instagram_hashtag_search | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /ig_hashtag_search | instagram_basic, pages_read_engagement, ads_management, ads_read, business_management, pages_read_user_content, pages_show_list | user /  |
| instagram_get_mentions | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_get_mentioned_media | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_login_profile | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_business_basic | instagram /  |
| instagram_login_list_media | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/media | instagram_business_basic | instagram /  |
| instagram_login_create_container | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_business_basic, instagram_business_content_publish | instagram /  |
| instagram_login_publish | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media_publish | instagram_business_basic, instagram_business_content_publish | instagram /  |
| instagram_login_get_container_status | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_business_basic, instagram_business_content_publish | instagram /  |
| instagram_login_conversations | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/conversations | instagram_business_basic, instagram_business_manage_messages | instagram /  |
| instagram_login_get_messages | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | instagram_business_basic, instagram_business_manage_messages | instagram /  |
| instagram_list_conversations | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/conversations | instagram_basic, instagram_manage_messages, pages_manage_metadata, pages_read_user_content, pages_show_list, pages_read_engagement | page / MESSAGING |
| messenger_list_conversations | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/conversations | pages_manage_metadata, pages_read_engagement, pages_messaging, pages_show_list | page / MESSAGING |
| messenger_get_messages | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | pages_manage_metadata, pages_read_engagement, pages_messaging, pages_show_list | page / MESSAGING on PAGE |
| messenger_send_text | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE |
| threads_get_profile | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | threads_basic | threads /  |
| threads_list_threads | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/threads | threads_basic | threads /  |
| threads_get_post | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | threads_basic | threads /  |
| threads_list_replies | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/replies | threads_basic, threads_read_replies | threads /  |
| threads_list_insights | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/threads_insights | threads_basic, threads_manage_insights | threads /  |
| threads_get_post_insights | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/insights | threads_basic, threads_manage_insights | threads /  |
| threads_list_threads_publishing_limit | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/threads_publishing_limit | threads_basic, threads_content_publish, threads_manage_replies | threads /  |
| threads_create_container | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/threads | threads_basic, threads_content_publish | threads /  |
| threads_publish_container | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/threads_publish | threads_basic, threads_content_publish | threads /  |
| threads_manage_reply | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/manage_reply | threads_basic, threads_manage_replies | threads /  |
| threads_delete_post | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id} | threads_basic, threads_delete | threads /  |
| threads_get_conversation | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/conversation | threads_basic, threads_read_replies | threads /  |
| threads_list_pending_replies | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/pending_replies | threads_basic, threads_read_replies | threads /  |
| threads_get_post_status | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | threads_basic, threads_content_publish | threads /  |
| threads_manage_pending_reply | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/manage_pending_reply | threads_basic, threads_manage_replies | threads /  |
| leads_list_forms | leads / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/leadgen_forms | ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads, ads_read, business_management | page, user /  |
| leads_get_form | leads / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads, ads_read, business_management | page, user /  |
| leads_retrieve | leads / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/leads | ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads, ads_read, business_management | page, user /  |
| leads_get_lead | leads / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads, ads_read, business_management | page, user /  |
| marketing_list_app_event_types | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/app_event_types | ads_read, ads_management, pages_read_engagement, pages_show_list | user /  |
| marketing_inspect_image | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | ads_read | user /  |
| marketing_inspect_creative_image | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | ads_read | user /  |
| marketing_inspect_video | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | ads_read | user /  |
| marketing_inspect_creative_video | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | ads_read | user /  |
| catalog_get_campaign_input_diagnostics | catalog / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | ads_read | user /  |
| marketing_list_client_invoice_metadata | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/business_invoices | ads_read, business_management, pages_read_engagement, pages_show_list | user /  |
| signals_send_crm_lead_event | signals / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/events | ads_read, ads_management, pages_read_engagement, pages_show_list | user, system_user /  |
| catalog_get_feed_status | catalog / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | catalog_management, business_management, pages_read_engagement, pages_show_list | user / MANAGE on CATALOG |
| catalog_get_item_diagnostics | catalog / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/diagnostics | catalog_management, business_management, pages_read_engagement, pages_show_list | user / MANAGE on CATALOG |
| signals_get_dataset | signals / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{business_id}/ads_dataset | ads_read, business_management, pages_read_engagement, pages_show_list | user /  |
| marketing_create_purchase_conversion | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/customconversions | ads_read, ads_management, pages_read_engagement, pages_show_list | user /  |
| marketing_get_ad_preview | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/previews | ads_read | user /  |
| pages_list_comments | pages / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/comments | pages_read_engagement, pages_read_user_content, pages_show_list | page / MODERATE on PAGE |
| signals_send_events | signals / META_MARKETING | registered / ENGINEERING_UNVERIFIED_HOLD | POST /{asset_id}/events |  |  /  |
| signals_send_pixel_events | signals / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/events | ads_management, pages_read_engagement, ads_read, pages_show_list | system_user /  |
| catalog_list_products | catalog / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/products | catalog_management, business_management, pages_read_engagement, pages_show_list | user / MANAGE |
| catalog_list_product_sets | catalog / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/product_sets | catalog_management, business_management, pages_read_engagement, pages_show_list | user / MANAGE |
| catalog_list_product_feeds | catalog / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/product_feeds | catalog_management, business_management, pages_read_engagement, pages_show_list | user / MANAGE |
| catalog_list_assigned_users | catalog / META_BUSINESS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/assigned_users | ads_management, catalog_management, pages_read_engagement, pages_show_list, business_management | user, system_user /  |
| oembed_facebook | oembed / META_FACEBOOK_PAGES | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /oembed_post |  |  /  |
| oembed_instagram | oembed / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /instagram_oembed |  |  /  |
| whatsapp_platform_send_message | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | whatsapp_business_messaging, whatsapp_business_management | system_user, business_integration_system_user /  |
| whatsapp_platform_register | whatsapp / META_WHATSAPP | registered / ENGINEERING_UNVERIFIED_HOLD | POST /{asset_id}/register |  |  /  |
| whatsapp_platform_request_code | whatsapp / META_WHATSAPP | registered / ENGINEERING_UNVERIFIED_HOLD | POST /{asset_id}/request_code |  |  /  |
| whatsapp_platform_verify_code | whatsapp / META_WHATSAPP | registered / ENGINEERING_UNVERIFIED_HOLD | POST /{asset_id}/verify_code |  |  /  |
| whatsapp_platform_list_phones | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/phone_numbers | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_get_phone | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_get_profile | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/whatsapp_business_profile | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_update_profile | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/whatsapp_business_profile | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_list_qr_codes | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/message_qrdls | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_get_qr_code | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/message_qrdls | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_create_qr_code | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/message_qrdls | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_update_qr_code | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/message_qrdls | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_delete_qr_code | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id}/message_qrdls | whatsapp_business_management | business_integration_system_user /  |
| instagram_list_comments | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/comments | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user /  |
| instagram_reply_comment | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/replies | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user /  |
| instagram_hide_comment | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id} | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user /  |
| instagram_delete_comment | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id} | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user /  |
| instagram_login_list_comments | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/comments | instagram_business_basic, instagram_business_manage_comments | instagram /  |
| instagram_login_reply_comment | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/replies | instagram_business_basic, instagram_business_manage_comments | instagram /  |
| instagram_login_hide_comment | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id} | instagram_business_basic, instagram_business_manage_comments | instagram /  |
| instagram_login_delete_comment | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id} | instagram_business_basic, instagram_business_manage_comments | instagram /  |
| instagram_get_insights | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/insights | instagram_basic, instagram_manage_insights, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user /  |
| instagram_login_get_insights | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/insights | instagram_business_basic, instagram_business_manage_insights | instagram /  |
| instagram_get_media_insights | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/insights | instagram_basic, instagram_manage_insights, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user /  |
| instagram_login_get_media_insights | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/insights | instagram_business_basic, instagram_business_manage_insights | instagram /  |
| threads_keyword_search | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /keyword_search | threads_basic, threads_keyword_search | threads /  |
| threads_get_mentions | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/mentions | threads_basic, threads_manage_mentions | threads /  |
| whatsapp_platform_get_analytics | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id} | whatsapp_business_management | business_integration_system_user /  |
| whatsapp_platform_get_template_analytics | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/template_analytics | whatsapp_business_management | business_integration_system_user /  |
| messenger_send_quick_replies | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE |
| messenger_send_button_template | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE |
| messenger_sender_action | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE |
| messenger_send_generic_template | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE |
| messenger_send_image | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE on PAGE |
| instagram_login_send_image | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | instagram_business_basic, instagram_business_manage_messages | instagram /  |
| instagram_create_reel_container | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_create_story_container | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_create_carousel_item | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_login_create_reel_container | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_business_basic, instagram_business_content_publish | instagram /  |
| instagram_login_create_story_container | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_business_basic, instagram_business_content_publish | instagram /  |
| instagram_login_create_carousel_item | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_business_basic, instagram_business_content_publish | instagram /  |
| instagram_create_image_carousel_item | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_login_create_image_carousel_item | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_business_basic, instagram_business_content_publish | instagram /  |
| instagram_create_image_story_container | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_login_create_image_story_container | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_business_basic, instagram_business_content_publish | instagram /  |
| threads_create_video_container | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/threads | threads_basic, threads_content_publish | threads /  |
| threads_create_carousel_item | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/threads | threads_basic, threads_content_publish | threads /  |
| threads_create_image_container | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/threads | threads_basic, threads_content_publish | threads /  |
| threads_create_image_carousel_item | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/threads | threads_basic, threads_content_publish | threads /  |
| instagram_create_carousel_container | instagram / META_INSTAGRAM_FACEBOOK_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_basic, instagram_content_publish, pages_read_engagement, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT on PAGE |
| instagram_login_create_carousel_container | instagram / META_INSTAGRAM_LOGIN | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/media | instagram_business_basic, instagram_business_content_publish | instagram /  |
| threads_create_carousel_container | threads / META_THREADS | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/threads | threads_basic, threads_content_publish | threads /  |
| signals_get_offline_quality | signals / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /dataset_quality | ads_read, ads_management, pages_read_engagement, pages_show_list | user, system_user /  |
| leads_create_form | leads / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/leadgen_forms | ads_management, pages_manage_ads, pages_read_engagement, pages_show_list | page / ADVERTISE on PAGE |
| marketing_upload_image | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/adimages | ads_management, pages_read_engagement, pages_show_list | user, system_user /  |
| marketing_create_async_report | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/insights | ads_read | user, system_user /  |
| marketing_create_classic_split_study | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/ad_studies | ads_read, ads_management, business_management, pages_read_engagement, pages_show_list | user /  |
| marketing_create_disabled_pause_rule | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/adrules_library | ads_read, ads_management, pages_read_engagement, pages_show_list | user /  |
| marketing_upload_video | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/advideos | ads_management, pages_read_engagement, pages_show_list | user /  |
| marketing_search_ad_library | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /ads_archive | ads_read | user /  |
| marketing_create_empty_custom_audience | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/customaudiences | ads_management, pages_read_engagement, pages_show_list | user /  |
| marketing_create_lookalike_audience | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/customaudiences | ads_management, pages_read_engagement, pages_show_list | user /  |
| marketing_activate_ad | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id} | ads_read, ads_management, pages_read_engagement, pages_show_list | user / ADVERTISE on PAGE |
| marketing_delete_paused_ad | marketing / META_MARKETING | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | DELETE /{asset_id} | ads_read, ads_management, pages_read_engagement, pages_show_list | user / ADVERTISE on PAGE |
| whatsapp_platform_send_template | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_send_interactive | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_send_image | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_send_audio | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_send_video | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| whatsapp_platform_send_document | whatsapp / META_WHATSAPP | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user /  |
| messenger_list_utility_templates | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | GET /{asset_id}/message_templates | page_utility_messaging | page /  |
| messenger_create_utility_template | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/message_templates | page_utility_messaging | page /  |
| messenger_send_utility_template | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | page_utility_messaging | page /  |
| messenger_send_video | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE on PAGE |
| messenger_send_audio | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE on PAGE |
| messenger_send_file | messenger / META_MESSENGER | registered / PRIMARY_VERIFIED_BOUNDED_SUBSET | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE on PAGE |

Full primary references and per-contract human/App Review/ownership requirements are in the adjacent JSON. They describe required evidence, not Lumin's current approvals.

## Original baseline tools

| Tool | Provider | Strict platform subset |
|---|---|---|
| ads_get_ad_accounts | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_account_info | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_pages_for_business | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_campaigns | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_campaign_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_campaign | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_update_campaign | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_delete_campaign | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_ad_sets | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_ad_set_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_clone_ad_set_bundle | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_create_ad_set | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_update_ad_set | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_delete_ad_set | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_ads | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_ad_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_ad | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_update_ad | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_update_ad_url_tags | META_MARKETING | STRICT_LOCAL_REVIEW_WORKFLOW |
| ads_delete_ad | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_get_ad_creatives | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_creative_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_ad_creative | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_update_ad_creative | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_upload_ad_image | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_get_ad_images | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_ad_videos | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_video_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_upload_ad_video | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_get_creative_media | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_video_media | META_MARKETING | STRICT_BOUNDED_READ |
| ads_analyze_video | GEMINI | STRICT_BOUNDED_READ |
| ads_get_ad_dossier | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_ad_entities | META_MARKETING | STRICT_BOUNDED_READ |
| ads_update_entity | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_activate_entity | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_get_insights | META_MARKETING | STRICT_BOUNDED_READ |
| ads_insights_performance_trend | META_MARKETING | STRICT_BOUNDED_READ |
| ads_insights_anomaly_signal | META_MARKETING | STRICT_BOUNDED_READ |
| ads_insights_auction_ranking_benchmarks | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_insights_industry_benchmark | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_insights_advertiser_context | META_MARKETING | STRICT_BOUNDED_READ |
| ads_search_interests | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_interest_suggestions | META_MARKETING | STRICT_BOUNDED_READ |
| ads_search_behaviors | META_MARKETING | STRICT_BOUNDED_READ |
| ads_search_demographics | META_MARKETING | STRICT_BOUNDED_READ |
| ads_search_geo_locations | META_MARKETING | STRICT_BOUNDED_READ |
| ads_estimate_audience_size | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_targeting_description | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_create_budget_schedule | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_lead_forms | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_leads | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_ad_leads | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_lead_form | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_get_custom_audiences | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_audience_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_custom_audience | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_create_lookalike_audience | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_share_custom_audience | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_unshare_custom_audience | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_audience_shared_accounts | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_delete_custom_audience | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_ad_preview | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_generate_preview | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_pixels | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_pixel_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_pixel_events | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_custom_conversions | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_custom_conversion | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_get_ad_comments | META_MARKETING | STRICT_BOUNDED_READ |
| ads_hide_comment | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_reply_comment | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_delete_comment | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_ad_rules | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_ad_rule | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_rule_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_update_ad_rule | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_delete_ad_rule | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_ad_studies | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_ad_study | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_study_details | META_MARKETING | STRICT_BOUNDED_READ |
| ads_create_async_report | META_MARKETING | STRICT_APPROVED_WRITE_SUBSET |
| ads_get_report_status | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_report_results | META_MARKETING | STRICT_BOUNDED_READ |
| ads_run_report_and_wait | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_billing_info | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_spend_limit | META_MARKETING | STRICT_BOUNDED_READ |
| ads_update_spend_cap | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_invoices | META_MARKETING | STRICT_BOUNDED_READ |
| ads_rate_status | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_opportunity_score | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_dataset_quality | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_errors | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_help_article | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_diagnose_underperformance | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_portfolio_summary | META_MARKETING | STRICT_BOUNDED_READ |
| ads_bulk_create_video_ads | META_MARKETING | ENGINEERING_MIGRATION_HOLD |
| ads_get_instagram_account | META_MARKETING | STRICT_BOUNDED_READ |
| ads_get_instagram_media | META_MARKETING | STRICT_BOUNDED_READ |
| whatsapp_get_business_accounts | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_get_phone_numbers | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_register_phone | META_WHATSAPP | ENGINEERING_MIGRATION_HOLD |
| whatsapp_deregister_phone | META_WHATSAPP | ENGINEERING_MIGRATION_HOLD |
| whatsapp_request_verification_code | META_WHATSAPP | ENGINEERING_MIGRATION_HOLD |
| whatsapp_verify_code | META_WHATSAPP | ENGINEERING_MIGRATION_HOLD |
| whatsapp_get_business_profile | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_update_business_profile | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_get_templates | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_create_template | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_update_template | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_delete_template | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_get_analytics | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_get_template_analytics | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_get_flows | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_create_flow | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_update_flow | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_publish_flow | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_deprecate_flow | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_delete_flow | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_get_qr_codes | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_create_qr_code | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_update_qr_code | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_delete_qr_code | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_get_webhook_subscriptions | META_WHATSAPP | STRICT_BOUNDED_READ |
| whatsapp_subscribe_webhook | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| whatsapp_unsubscribe_webhook | META_WHATSAPP | STRICT_APPROVED_WRITE_SUBSET |
| ads_library_register_apify_token | APIFY | ENGINEERING_MIGRATION_HOLD |
| ads_library_get_apify_token_status | APIFY | ENGINEERING_MIGRATION_HOLD |
| ads_library_delete_apify_token | APIFY | ENGINEERING_MIGRATION_HOLD |
| ads_library_scrape | APIFY | ENGINEERING_MIGRATION_HOLD |
| ads_library_get_run_status | APIFY | ENGINEERING_MIGRATION_HOLD |
| ads_library_get_results | APIFY | ENGINEERING_MIGRATION_HOLD |
| ads_library_abort_run | APIFY | ENGINEERING_MIGRATION_HOLD |
| ads_library_list_runs | APIFY | STRICT_BOUNDED_READ |
| ads_library_get_ad_details | APIFY | ENGINEERING_MIGRATION_HOLD |
| ads_register_gemini_key | GEMINI | ENGINEERING_MIGRATION_HOLD |
| ads_get_gemini_key_status | GEMINI | ENGINEERING_MIGRATION_HOLD |
| ads_delete_gemini_key | GEMINI | ENGINEERING_MIGRATION_HOLD |
| ads_list_tokens | META_CREDENTIALS | ENGINEERING_MIGRATION_HOLD |
| ads_set_active_token | META_CREDENTIALS | ENGINEERING_MIGRATION_HOLD |
| ads_register_token | META_CREDENTIALS | ENGINEERING_MIGRATION_HOLD |
| ads_delete_token | META_CREDENTIALS | ENGINEERING_MIGRATION_HOLD |

## Local control and workflows

- meta_prepare_action
- meta_get_action_status
- meta_admin_get_status
- meta_list_assets
- meta_list_connections
- meta_list_capabilities
- meta_list_manual_actions
- meta_discover_signal_assets
- meta_prepare_app_promotion_access
- meta_health
- meta_connections_health
- meta_webhook_health
- meta_rate_status
- meta_recent_errors
- meta_permission_failures
- meta_token_expiry_status
- meta_manual_actions
- meta_signal_status
- meta_capabilities
- meta_capability_status
- meta_connection_status
- meta_permissions_status
- meta_assets_overview
- meta_audit_presence
- meta_prepare_publication
- meta_list_prepared_actions
- meta_list_events
- meta_discover_ad_assets
- meta_lookup_ad_targeting
- meta_observe_ads_compatibility
- meta_observe_account_owner
- meta_inspect_billing_configuration
- meta_research_prepare_job
- meta_research_run_job
- meta_research_job_status
- meta_research_refresh_job
- meta_research_job_results
- meta_research_abort_job
- meta_research_reconcile_cost
- meta_research_job_media
- meta_research_compare_jobs
- meta_research_list_public_acquisitions
- meta_plan_paused_ads
- meta_get_paused_ad_batch
- meta_plan_ad_tracking_change
- meta_get_ad_tracking_change
