/**
 * Reviewed classification of every baseline (legacy) tool. A tool added, renamed or re-annotated without
 * updating this file makes tests/platform/tool-classification-guard.test.ts fail, which is the point:
 * a new tool must be classified by a human before any deployment mode can expose it.
 */
/** Enabled when DEPLOYMENT_MODE=agency and AGENCY_WRITES_ENABLED is not true. Every one of these must be read only. */
export const READ_ONLY_AGENCY_TOOLS: readonly string[] = Object.freeze([
  "ads_diagnose_underperformance",
  "ads_estimate_audience_size",
  "ads_generate_preview",
  "ads_get_account_info",
  "ads_get_ad_accounts",
  "ads_get_ad_comments",
  "ads_get_ad_creatives",
  "ads_get_ad_details",
  "ads_get_ad_dossier",
  "ads_get_ad_entities",
  "ads_get_ad_images",
  "ads_get_ad_leads",
  "ads_get_ad_preview",
  "ads_get_ad_rules",
  "ads_get_ad_set_details",
  "ads_get_ad_sets",
  "ads_get_ad_studies",
  "ads_get_ad_videos",
  "ads_get_ads",
  "ads_get_audience_details",
  "ads_get_audience_shared_accounts",
  "ads_get_billing_info",
  "ads_get_campaign_details",
  "ads_get_campaigns",
  "ads_get_creative_details",
  "ads_get_creative_media",
  "ads_get_custom_audiences",
  "ads_get_custom_conversions",
  "ads_get_dataset_quality",
  "ads_get_errors",
  "ads_get_gemini_key_status",
  "ads_get_help_article",
  "ads_get_insights",
  "ads_get_instagram_account",
  "ads_get_instagram_media",
  "ads_get_interest_suggestions",
  "ads_get_invoices",
  "ads_get_lead_forms",
  "ads_get_leads",
  "ads_get_opportunity_score",
  "ads_get_pages_for_business",
  "ads_get_pixel_details",
  "ads_get_pixel_events",
  "ads_get_pixels",
  "ads_get_report_results",
  "ads_get_report_status",
  "ads_get_rule_details",
  "ads_get_spend_limit",
  "ads_get_study_details",
  "ads_get_targeting_description",
  "ads_get_video_details",
  "ads_get_video_media",
  "ads_insights_advertiser_context",
  "ads_insights_anomaly_signal",
  "ads_insights_auction_ranking_benchmarks",
  "ads_insights_industry_benchmark",
  "ads_insights_performance_trend",
  "ads_list_tokens",
  "ads_portfolio_summary",
  "ads_rate_status",
  "ads_search_behaviors",
  "ads_search_demographics",
  "ads_search_geo_locations",
  "ads_search_interests",
  "whatsapp_get_analytics",
  "whatsapp_get_business_accounts",
  "whatsapp_get_business_profile",
  "whatsapp_get_flows",
  "whatsapp_get_phone_numbers",
  "whatsapp_get_qr_codes",
  "whatsapp_get_template_analytics",
  "whatsapp_get_templates",
  "whatsapp_get_webhook_subscriptions",
]);
/** Read-only annotated but deliberately disabled in read-only agency mode: paid third-party compute or stored third-party credentials. */
export const READ_ONLY_AGENCY_EXCLUDED_READ_TOOLS: readonly string[] = Object.freeze([
  "ads_analyze_video",
  "ads_library_get_ad_details",
  "ads_library_get_apify_token_status",
  "ads_library_get_results",
  "ads_library_get_run_status",
  "ads_library_list_runs",
]);
/** Non-read baseline tools: provider mutations, paid compute and stored-credential management. Disabled unless AGENCY_WRITES_ENABLED=true. */
export const BASELINE_WRITE_TOOLS: readonly string[] = Object.freeze([
  "ads_activate_entity",
  "ads_bulk_create_video_ads",
  "ads_clone_ad_set_bundle",
  "ads_create_ad",
  "ads_create_ad_creative",
  "ads_create_ad_rule",
  "ads_create_ad_set",
  "ads_create_ad_study",
  "ads_create_async_report",
  "ads_create_budget_schedule",
  "ads_create_campaign",
  "ads_create_custom_audience",
  "ads_create_custom_conversion",
  "ads_create_lead_form",
  "ads_create_lookalike_audience",
  "ads_delete_ad",
  "ads_delete_ad_rule",
  "ads_delete_ad_set",
  "ads_delete_campaign",
  "ads_delete_comment",
  "ads_delete_custom_audience",
  "ads_delete_gemini_key",
  "ads_delete_token",
  "ads_hide_comment",
  "ads_library_abort_run",
  "ads_library_delete_apify_token",
  "ads_library_register_apify_token",
  "ads_library_scrape",
  "ads_register_gemini_key",
  "ads_register_token",
  "ads_reply_comment",
  "ads_run_report_and_wait",
  "ads_set_active_token",
  "ads_share_custom_audience",
  "ads_unshare_custom_audience",
  "ads_update_ad",
  "ads_update_ad_creative",
  "ads_update_ad_rule",
  "ads_update_ad_set",
  "ads_update_ad_url_tags",
  "ads_update_campaign",
  "ads_update_entity",
  "ads_update_spend_cap",
  "ads_upload_ad_image",
  "ads_upload_ad_video",
  "whatsapp_create_flow",
  "whatsapp_create_qr_code",
  "whatsapp_create_template",
  "whatsapp_delete_flow",
  "whatsapp_delete_qr_code",
  "whatsapp_delete_template",
  "whatsapp_deprecate_flow",
  "whatsapp_deregister_phone",
  "whatsapp_publish_flow",
  "whatsapp_register_phone",
  "whatsapp_request_verification_code",
  "whatsapp_subscribe_webhook",
  "whatsapp_unsubscribe_webhook",
  "whatsapp_update_business_profile",
  "whatsapp_update_flow",
  "whatsapp_update_qr_code",
  "whatsapp_update_template",
  "whatsapp_verify_code",
]);
/** Baseline writes with a strict, approval-gated adapter in the platform build. Moving a name here makes it executable. */
export const STRICT_APPROVED_WRITE_SUBSET: readonly string[] = Object.freeze([
  "ads_activate_entity",
  "ads_create_ad",
  "ads_create_ad_creative",
  "ads_create_ad_set",
  "ads_create_async_report",
  "ads_create_campaign",
  "ads_create_custom_audience",
  "ads_create_custom_conversion",
  "ads_create_lead_form",
  "ads_create_lookalike_audience",
  "ads_delete_ad",
  "ads_update_ad",
  "ads_update_ad_creative",
  "ads_update_ad_set",
  "ads_update_campaign",
  "ads_update_entity",
  "ads_upload_ad_image",
  "ads_upload_ad_video",
  "whatsapp_create_flow",
  "whatsapp_create_qr_code",
  "whatsapp_create_template",
  "whatsapp_delete_flow",
  "whatsapp_delete_qr_code",
  "whatsapp_delete_template",
  "whatsapp_deprecate_flow",
  "whatsapp_publish_flow",
  "whatsapp_subscribe_webhook",
  "whatsapp_unsubscribe_webhook",
  "whatsapp_update_business_profile",
  "whatsapp_update_flow",
  "whatsapp_update_qr_code",
  "whatsapp_update_template",
]);
/** Baseline write whose strict form only stores a local review proposal. */
export const STRICT_REVIEW_WORKFLOW_TOOLS: readonly string[] = Object.freeze([
  "ads_update_ad_url_tags",
]);
/** Baseline write replaced in strict mode by an observer that cannot create anything. */
export const STRICT_READ_REPLACEMENTS_OF_BASELINE_WRITES: readonly string[] = Object.freeze([
  "ads_run_report_and_wait",
]);
/** Baseline writes with no strict adapter: strict mode answers LEGACY_STRICT_MIGRATION_HOLD and nothing else. */
export const STRICT_HELD_WRITES: readonly string[] = Object.freeze([
  "ads_bulk_create_video_ads",
  "ads_clone_ad_set_bundle",
  "ads_create_ad_rule",
  "ads_create_ad_study",
  "ads_create_budget_schedule",
  "ads_delete_ad_rule",
  "ads_delete_ad_set",
  "ads_delete_campaign",
  "ads_delete_comment",
  "ads_delete_custom_audience",
  "ads_delete_gemini_key",
  "ads_delete_token",
  "ads_hide_comment",
  "ads_library_abort_run",
  "ads_library_delete_apify_token",
  "ads_library_register_apify_token",
  "ads_library_scrape",
  "ads_register_gemini_key",
  "ads_register_token",
  "ads_reply_comment",
  "ads_set_active_token",
  "ads_share_custom_audience",
  "ads_unshare_custom_audience",
  "ads_update_ad_rule",
  "ads_update_spend_cap",
  "whatsapp_deregister_phone",
  "whatsapp_register_phone",
  "whatsapp_request_verification_code",
  "whatsapp_verify_code",
]);
/** Baseline tools whose readOnlyHint differs between the platform-off and the strict registration, with the strict value. Reviewed individually. */
export const STRICT_ANNOTATION_DRIFT: Readonly<Record<string, boolean>> = Object.freeze({
  ads_run_report_and_wait: true,
  ads_search_geo_locations: false,
  ads_search_interests: false,
  ads_update_ad_url_tags: false,
});
/** Product contracts whose every operation class is READ. */
export const PRODUCT_READ_TOOLS: readonly string[] = Object.freeze([
  "business_get",
  "business_get_asset_permissions",
  "business_list_client_ad_accounts",
  "business_list_client_catalogs",
  "business_list_client_pages",
  "business_list_owned_ad_accounts",
  "business_list_owned_catalogs",
  "business_list_owned_pages",
  "business_list_owned_wabas",
  "business_list_system_users",
  "business_list_users",
  "catalog_get_campaign_input_diagnostics",
  "catalog_get_feed_status",
  "catalog_get_item_diagnostics",
  "catalog_list_assigned_users",
  "catalog_list_product_feeds",
  "catalog_list_product_sets",
  "catalog_list_products",
  "instagram_business_discovery",
  "instagram_get_container_status",
  "instagram_get_insights",
  "instagram_get_media_insights",
  "instagram_get_mentioned_media",
  "instagram_get_mentions",
  "instagram_get_message",
  "instagram_get_profile",
  "instagram_hashtag_search",
  "instagram_list_comments",
  "instagram_list_conversations",
  "instagram_list_media",
  "instagram_login_conversations",
  "instagram_login_get_container_status",
  "instagram_login_get_insights",
  "instagram_login_get_media_insights",
  "instagram_login_get_message",
  "instagram_login_get_messages",
  "instagram_login_list_comments",
  "instagram_login_list_media",
  "instagram_login_profile",
  "leads_get_form",
  "leads_get_lead",
  "leads_list_forms",
  "leads_retrieve",
  "marketing_get_ad_preview",
  "marketing_inspect_creative_image",
  "marketing_inspect_creative_video",
  "marketing_inspect_image",
  "marketing_inspect_video",
  "marketing_list_app_event_types",
  "marketing_list_client_invoice_metadata",
  "marketing_search_ad_library",
  "messenger_get_message",
  "messenger_get_messages",
  "messenger_list_conversations",
  "messenger_list_utility_templates",
  "oembed_facebook",
  "oembed_instagram",
  "pages_get",
  "pages_get_insights",
  "pages_get_subscriptions",
  "pages_get_video_status",
  "pages_list_comments",
  "pages_list_feed",
  "pages_list_posts",
  "pages_list_published_posts",
  "pages_list_scheduled_posts",
  "signals_get_dataset",
  "signals_get_offline_quality",
  "threads_get_conversation",
  "threads_get_mentions",
  "threads_get_post",
  "threads_get_post_insights",
  "threads_get_post_status",
  "threads_get_profile",
  "threads_keyword_search",
  "threads_list_insights",
  "threads_list_pending_replies",
  "threads_list_replies",
  "threads_list_threads",
  "threads_list_threads_publishing_limit",
  "whatsapp_platform_get_analytics",
  "whatsapp_platform_get_flow",
  "whatsapp_platform_get_phone",
  "whatsapp_platform_get_profile",
  "whatsapp_platform_get_qr_code",
  "whatsapp_platform_get_subscriptions",
  "whatsapp_platform_get_template",
  "whatsapp_platform_get_template_analytics",
  "whatsapp_platform_list_flows",
  "whatsapp_platform_list_phones",
  "whatsapp_platform_list_qr_codes",
  "whatsapp_platform_list_templates",
]);
/** Product contracts that can mutate, with the exact operation classes the contract declares. Editing a contract's classes requires editing this table. */
export const PRODUCT_MUTATING_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  instagram_create_carousel_container: ["WRITE_CONTENT"],
  instagram_create_carousel_item: ["WRITE_CONTENT"],
  instagram_create_container: ["WRITE_CONTENT"],
  instagram_create_image_carousel_item: ["WRITE_CONTENT"],
  instagram_create_image_story_container: ["WRITE_CONTENT"],
  instagram_create_reel_container: ["WRITE_CONTENT"],
  instagram_create_story_container: ["WRITE_CONTENT"],
  instagram_delete_comment: ["DELETE"],
  instagram_hide_comment: ["WRITE_CONTENT"],
  instagram_login_create_carousel_container: ["WRITE_CONTENT"],
  instagram_login_create_carousel_item: ["WRITE_CONTENT"],
  instagram_login_create_container: ["WRITE_CONTENT"],
  instagram_login_create_image_carousel_item: ["WRITE_CONTENT"],
  instagram_login_create_image_story_container: ["WRITE_CONTENT"],
  instagram_login_create_reel_container: ["WRITE_CONTENT"],
  instagram_login_create_story_container: ["WRITE_CONTENT"],
  instagram_login_delete_comment: ["DELETE"],
  instagram_login_hide_comment: ["WRITE_CONTENT"],
  instagram_login_publish: ["WRITE_CONTENT"],
  instagram_login_reply_comment: ["WRITE_CONTENT"],
  instagram_login_send_image: ["WRITE_MESSAGING"],
  instagram_publish_container: ["WRITE_CONTENT"],
  instagram_reply_comment: ["WRITE_CONTENT"],
  leads_create_form: ["WRITE_CONTENT"],
  marketing_activate_ad: ["ACTIVATE_SPEND"],
  marketing_create_async_report: ["WRITE_CONTENT"],
  marketing_create_classic_split_study: ["WRITE_AD_CONFIGURATION"],
  marketing_create_disabled_pause_rule: ["WRITE_AD_CONFIGURATION"],
  marketing_create_empty_custom_audience: ["WRITE_AD_CONFIGURATION"],
  marketing_create_lookalike_audience: ["WRITE_AD_CONFIGURATION"],
  marketing_create_purchase_conversion: ["WRITE_AD_CONFIGURATION"],
  marketing_delete_paused_ad: ["DELETE"],
  marketing_upload_image: ["WRITE_CONTENT"],
  marketing_upload_video: ["WRITE_CONTENT"],
  messenger_create_utility_template: ["WRITE_CONTENT"],
  messenger_send_audio: ["WRITE_MESSAGING"],
  messenger_send_button_template: ["WRITE_MESSAGING"],
  messenger_send_file: ["WRITE_MESSAGING"],
  messenger_send_generic_template: ["WRITE_MESSAGING"],
  messenger_send_image: ["WRITE_MESSAGING"],
  messenger_send_quick_replies: ["WRITE_MESSAGING"],
  messenger_send_text: ["WRITE_MESSAGING"],
  messenger_send_utility_template: ["WRITE_MESSAGING"],
  messenger_send_video: ["WRITE_MESSAGING"],
  messenger_sender_action: ["WRITE_MESSAGING"],
  pages_create_feed: ["WRITE_CONTENT"],
  pages_create_photos: ["WRITE_CONTENT"],
  pages_create_videos: ["WRITE_CONTENT"],
  pages_delete_comment: ["DELETE"],
  pages_delete_post: ["DELETE"],
  pages_edit_post: ["WRITE_CONTENT"],
  pages_hide_comment: ["WRITE_CONTENT"],
  pages_reply_comment: ["WRITE_CONTENT"],
  signals_send_crm_lead_event: ["WRITE_NON_FINANCIAL"],
  signals_send_events: ["WRITE_NON_FINANCIAL"],
  signals_send_pixel_events: ["WRITE_NON_FINANCIAL"],
  threads_create_carousel_container: ["WRITE_CONTENT"],
  threads_create_carousel_item: ["WRITE_CONTENT"],
  threads_create_container: ["WRITE_CONTENT"],
  threads_create_image_carousel_item: ["WRITE_CONTENT"],
  threads_create_image_container: ["WRITE_CONTENT"],
  threads_create_video_container: ["WRITE_CONTENT"],
  threads_delete_post: ["DELETE"],
  threads_manage_pending_reply: ["WRITE_CONTENT"],
  threads_manage_reply: ["WRITE_CONTENT"],
  threads_publish_container: ["WRITE_CONTENT"],
  whatsapp_platform_create_flow: ["WRITE_CONTENT"],
  whatsapp_platform_create_qr_code: ["WRITE_CONTENT"],
  whatsapp_platform_create_template: ["WRITE_CONTENT"],
  whatsapp_platform_delete_flow: ["DELETE"],
  whatsapp_platform_delete_qr_code: ["DELETE"],
  whatsapp_platform_delete_template: ["DELETE"],
  whatsapp_platform_deprecate_flow: ["WRITE_CONTENT"],
  whatsapp_platform_publish_flow: ["WRITE_CONTENT"],
  whatsapp_platform_register: ["IDENTITY_OR_ACCESS"],
  whatsapp_platform_request_code: ["IDENTITY_OR_ACCESS"],
  whatsapp_platform_send_audio: ["WRITE_MESSAGING"],
  whatsapp_platform_send_document: ["WRITE_MESSAGING"],
  whatsapp_platform_send_image: ["WRITE_MESSAGING"],
  whatsapp_platform_send_interactive: ["WRITE_MESSAGING"],
  whatsapp_platform_send_message: ["WRITE_MESSAGING"],
  whatsapp_platform_send_template: ["WRITE_MESSAGING"],
  whatsapp_platform_send_video: ["WRITE_MESSAGING"],
  whatsapp_platform_subscribe: ["IDENTITY_OR_ACCESS"],
  whatsapp_platform_unsubscribe: ["DELETE", "IDENTITY_OR_ACCESS"],
  whatsapp_platform_update_flow: ["WRITE_CONTENT"],
  whatsapp_platform_update_profile: ["WRITE_CONTENT"],
  whatsapp_platform_update_qr_code: ["WRITE_CONTENT"],
  whatsapp_platform_update_template: ["WRITE_CONTENT"],
  whatsapp_platform_upload_flow_json: ["WRITE_CONTENT"],
  whatsapp_platform_verify_code: ["IDENTITY_OR_ACCESS"],
});
/** Control, status and workflow tools that only read. */
export const CONTROL_READ_TOOLS: readonly string[] = Object.freeze([
  "meta_admin_get_status",
  "meta_assets_overview",
  "meta_audit_presence",
  "meta_capabilities",
  "meta_capability_status",
  "meta_connection_status",
  "meta_connections_health",
  "meta_get_action_status",
  "meta_get_ad_tracking_change",
  "meta_get_paused_ad_batch",
  "meta_health",
  "meta_inspect_billing_configuration",
  "meta_list_assets",
  "meta_list_capabilities",
  "meta_list_connections",
  "meta_list_events",
  "meta_list_manual_actions",
  "meta_list_prepared_actions",
  "meta_manual_actions",
  "meta_permission_failures",
  "meta_permissions_status",
  "meta_rate_status",
  "meta_recent_errors",
  "meta_research_compare_jobs",
  "meta_research_job_media",
  "meta_research_job_results",
  "meta_research_job_status",
  "meta_research_list_public_acquisitions",
  "meta_signal_status",
  "meta_token_expiry_status",
  "meta_webhook_health",
]);
/** Not read-only annotated, never a Meta write: they GET and store evidence or an encrypted proposal. Strict read-only agency keeps these, and tests/platform/read-only-agency-surface.test.ts pins what each may store. */
export const CONTROL_PREPARATION_TOOLS: readonly string[] = Object.freeze([
  "meta_discover_ad_assets",
  "meta_discover_signal_assets",
  "meta_lookup_ad_targeting",
  "meta_observe_account_owner",
  "meta_observe_ads_compatibility",
  "meta_plan_ad_tracking_change",
  "meta_plan_paused_ads",
  "meta_prepare_action",
  "meta_prepare_app_promotion_access",
  "meta_prepare_publication",
]);
/** The preparation tools a read-only agency deployment keeps: they only read and store evidence or an enrollment proposal. The rest only stage a write nobody can approve there, so they are hidden and refuse. */
export const READ_ONLY_AGENCY_KEPT_PREPARATION_TOOLS: readonly string[] = Object.freeze([
  "meta_discover_ad_assets",
  "meta_discover_signal_assets",
  "meta_lookup_ad_targeting",
  "meta_observe_account_owner",
  "meta_observe_ads_compatibility",
  "meta_prepare_app_promotion_access",
]);
/** Research job state and paid third-party compute. Disabled in read-only agency. */
export const CONTROL_RESEARCH_JOB_TOOLS: readonly string[] = Object.freeze([
  "meta_research_abort_job",
  "meta_research_prepare_job",
  "meta_research_reconcile_cost",
  "meta_research_refresh_job",
  "meta_research_run_job",
]);

export interface RegisteredToolFact { name: string; readOnlyHint: boolean | undefined; enabled: boolean }
export interface ClassificationInputs {
  /** Every tool the strict platform build registers, enabled or not. */
  registered: readonly RegisteredToolFact[];
  /** The platform-off registration, which carries the baseline annotation. */
  baseline: readonly RegisteredToolFact[];
  /** operationClasses of every product contract. */
  contractClasses: Readonly<Record<string, readonly string[]>>;
  migratedWrites: readonly string[];
  migratedWorkflows: readonly string[];
  migratedReads: readonly string[];
}

const same = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Everything that makes the reviewed classification untrue. An empty result is the only passing state. */
export function classificationProblems(input: ClassificationInputs): string[] {
  const problems: string[] = [];
  const groups: Array<[string, readonly string[]]> = [
    ["READ_ONLY_AGENCY_TOOLS", READ_ONLY_AGENCY_TOOLS], ["READ_ONLY_AGENCY_EXCLUDED_READ_TOOLS", READ_ONLY_AGENCY_EXCLUDED_READ_TOOLS], ["BASELINE_WRITE_TOOLS", BASELINE_WRITE_TOOLS],
    ["PRODUCT_READ_TOOLS", PRODUCT_READ_TOOLS], ["PRODUCT_MUTATING_TOOLS", Object.keys(PRODUCT_MUTATING_TOOLS)],
    ["CONTROL_READ_TOOLS", CONTROL_READ_TOOLS], ["CONTROL_PREPARATION_TOOLS", CONTROL_PREPARATION_TOOLS], ["CONTROL_RESEARCH_JOB_TOOLS", CONTROL_RESEARCH_JOB_TOOLS],
  ];
  const owner = new Map<string, string>();
  for (const [group, names] of groups) for (const name of names) {
    if (owner.has(name)) problems.push(`DUPLICATE_CLASSIFICATION ${name} in ${owner.get(name)} and ${group}`);
    owner.set(name, group);
  }
  const registered = new Map(input.registered.map(t => [t.name, t]));
  for (const name of registered.keys()) if (!owner.has(name)) problems.push(`UNCLASSIFIED_TOOL ${name}`);
  for (const name of owner.keys()) if (!registered.has(name)) problems.push(`STALE_CLASSIFICATION ${name}`);

  const baseline = new Map(input.baseline.map(t => [t.name, t]));
  const readGroups = new Set(["READ_ONLY_AGENCY_TOOLS", "READ_ONLY_AGENCY_EXCLUDED_READ_TOOLS", "PRODUCT_READ_TOOLS", "CONTROL_READ_TOOLS"]);
  for (const [name, tool] of registered) {
    const group = owner.get(name);
    if (!group) continue;
    const drift = STRICT_ANNOTATION_DRIFT[name];
    const expectedRead = drift !== undefined ? drift : readGroups.has(group) || STRICT_READ_REPLACEMENTS_OF_BASELINE_WRITES.includes(name);
    if ((tool.readOnlyHint === true) !== expectedRead) problems.push(`ANNOTATION_MISMATCH ${name} is ${group} but readOnlyHint=${String(tool.readOnlyHint)}`);
    if (baseline.has(name) && drift === undefined && (baseline.get(name)!.readOnlyHint === true) !== (tool.readOnlyHint === true)) problems.push(`UNREVIEWED_ANNOTATION_DRIFT ${name}`);
  }
  for (const name of BASELINE_WRITE_TOOLS) {
    const parts = [STRICT_APPROVED_WRITE_SUBSET, STRICT_REVIEW_WORKFLOW_TOOLS, STRICT_READ_REPLACEMENTS_OF_BASELINE_WRITES, STRICT_HELD_WRITES].filter(list => list.includes(name));
    if (parts.length !== 1) problems.push(`BASELINE_WRITE_WITHOUT_ONE_STRICT_DISPOSITION ${name}`);
  }
  if (!same(STRICT_APPROVED_WRITE_SUBSET, input.migratedWrites)) problems.push(`STRICT_WRITE_SUBSET_CHANGED ${[...STRICT_APPROVED_WRITE_SUBSET.filter(n => !input.migratedWrites.includes(n)), ...input.migratedWrites.filter(n => !STRICT_APPROVED_WRITE_SUBSET.includes(n))].join(",")}`);
  if (!same(STRICT_REVIEW_WORKFLOW_TOOLS, input.migratedWorkflows)) problems.push("STRICT_WORKFLOW_SET_CHANGED");
  for (const name of STRICT_READ_REPLACEMENTS_OF_BASELINE_WRITES) if (!input.migratedReads.includes(name)) problems.push(`READ_REPLACEMENT_NOT_A_STRICT_READ ${name}`);
  for (const name of STRICT_HELD_WRITES) if ([...input.migratedWrites, ...input.migratedWorkflows, ...input.migratedReads].includes(name)) problems.push(`HELD_WRITE_NOW_EXECUTABLE ${name}`);

  const contractNames = Object.keys(input.contractClasses);
  const productNames = new Set([...PRODUCT_READ_TOOLS, ...Object.keys(PRODUCT_MUTATING_TOOLS)]);
  for (const name of contractNames) {
    const classes = input.contractClasses[name];
    if (!productNames.has(name)) continue;
    const readOnly = same(classes, ["READ"]);
    if (readOnly !== PRODUCT_READ_TOOLS.includes(name)) problems.push(`PRODUCT_READ_STATUS_CHANGED ${name}`);
    if (!readOnly && PRODUCT_MUTATING_TOOLS[name] && !same(classes, PRODUCT_MUTATING_TOOLS[name])) problems.push(`PRODUCT_CLASSES_CHANGED ${name} ${classes.join("+")} != ${PRODUCT_MUTATING_TOOLS[name].join("+")}`);
  }
  for (const name of productNames) if (!contractNames.includes(name)) problems.push(`PRODUCT_CONTRACT_MISSING ${name}`);
  for (const name of contractNames) if (!productNames.has(name)) problems.push(`PRODUCT_CONTRACT_UNCLASSIFIED ${name}`);
  const spend = contractNames.filter(name => input.contractClasses[name].some(c => c === "ACTIVATE_SPEND" || c === "WRITE_BUDGET")).sort();
  if (!same(spend, SPEND_OR_BUDGET_PRODUCT_TOOLS)) problems.push(`SPEND_CAPABLE_PRODUCT_SET_CHANGED ${spend.join(",")}`);
  return problems;
}

/** The only product contracts that can start delivery or change a budget. */
export const SPEND_OR_BUDGET_PRODUCT_TOOLS: readonly string[] = Object.freeze(["marketing_activate_ad"]);
