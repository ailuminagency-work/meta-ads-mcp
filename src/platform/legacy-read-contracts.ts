import type { AssetType } from "./models.js";

export interface AdditionalLegacyReadContract {
  roots:ReadonlyArray<{type:AssetType;input:string}>;
  edge:string;
  entityType:AssetType|"INSIGHTS";
  fields:readonly string[];
  documentation:readonly string[];
  responseIdField?:"hash";
}
const sdk="https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/";
const creativeFields=["id","account_id","name","status","body","title","object_type","image_hash","thumbnail_url","image_url","link_url","url_tags","call_to_action_type"];
const pixelFields=["id","name","creation_time","last_fired_time","is_created_by_business","is_unavailable","automatic_matching_fields","data_use_setting"];
const audienceFields=["id","account_id","name","description","subtype","approximate_count_lower_bound","approximate_count_upper_bound","retention_days","time_created","time_updated","time_content_updated","is_value_based","customer_file_source"];
const accountFields=["id","name","currency","timezone_name","spend_cap","amount_spent","balance","business_name","account_status","disable_reason","min_daily_budget"];
export const ADDITIONAL_LEGACY_READ_CONTRACTS:Readonly<Record<string,AdditionalLegacyReadContract>>=Object.freeze({
  ads_get_report_results:{roots:[{type:"REPORT",input:"report_run_id"}],edge:"/insights",entityType:"INSIGHTS",fields:["account_id","campaign_id","adset_id","ad_id","date_start","date_stop","impressions","clicks","spend","reach","frequency","ctr","cpc","cpm","actions","cost_per_action_type"],documentation:[sdk+"adreportrun.py",sdk+"adsinsights.py"]},
  ads_get_dataset_quality:{roots:[{type:"PIXEL",input:"pixel_id"}],edge:"",entityType:"PIXEL",fields:["id","name","last_fired_time","is_unavailable","match_rate_approx","data_use_setting","enable_automatic_matching","automatic_matching_fields"],documentation:[sdk+"adspixel.py"]},
  ads_get_ad_studies:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"/ad_studies",entityType:"STUDY",fields:["id","name","description","type","created_time","updated_time","start_time","end_time","canceled_time","cooldown_start_time","observation_end_time","results_first_available_date"],documentation:[sdk+"adaccount.py",sdk+"adstudy.py"]},
  ads_get_study_details:{roots:[{type:"STUDY",input:"study_id"}],edge:"",entityType:"STUDY",fields:["id","name","description","type","created_time","updated_time","start_time","end_time","canceled_time","cooldown_start_time","observation_end_time","results_first_available_date"],documentation:[sdk+"adstudy.py"]},
  ads_get_report_status:{roots:[{type:"REPORT",input:"report_run_id"}],edge:"",entityType:"REPORT",fields:["id","account_id","async_status","async_percent_completion","date_start","date_stop","is_running","time_completed","time_ref"],documentation:[sdk+"adreportrun.py", "https://github.com/facebook/facebook-python-business-sdk/blob/main/examples/async.py"]},
  ads_get_ad_creatives:{roots:[{type:"AD",input:"ad_id"},{type:"AD_ACCOUNT",input:"account_id"}],edge:"/adcreatives",entityType:"CREATIVE",fields:creativeFields,documentation:[sdk+"ad.py",sdk+"adaccount.py",sdk+"adcreative.py"]},
  ads_get_creative_details:{roots:[{type:"CREATIVE",input:"creative_id"}],edge:"",entityType:"CREATIVE",fields:creativeFields,documentation:[sdk+"adcreative.py"]},
  ads_get_pixels:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"/adspixels",entityType:"PIXEL",fields:pixelFields,documentation:[sdk+"adaccount.py",sdk+"adspixel.py"]},
  ads_get_pixel_details:{roots:[{type:"PIXEL",input:"pixel_id"}],edge:"",entityType:"PIXEL",fields:pixelFields,documentation:[sdk+"adspixel.py"]},
  ads_get_custom_audiences:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"/customaudiences",entityType:"AUDIENCE",fields:audienceFields,documentation:[sdk+"adaccount.py","https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/custom-audience"]},
  ads_get_audience_details:{roots:[{type:"AUDIENCE",input:"audience_id"}],edge:"",entityType:"AUDIENCE",fields:audienceFields,documentation:["https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/custom-audience"]},
  ads_get_billing_info:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"",entityType:"AD_ACCOUNT",fields:accountFields,documentation:[sdk+"adaccount.py"]},
  ads_get_opportunity_score:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"",entityType:"AD_ACCOUNT",fields:["id","account_id","opportunity_score"],documentation:[sdk+"adaccount.py"]},
  ads_get_spend_limit:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"",entityType:"AD_ACCOUNT",fields:accountFields,documentation:[sdk+"adaccount.py"]},
  ads_get_ad_images:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"/adimages",entityType:"AD_IMAGE",responseIdField:"hash",fields:["id","account_id","hash","name","height","width","original_height","original_width","created_time","updated_time","status","url","url_128","permalink_url","is_associated_creatives_in_adgroups"],documentation:[sdk+"adaccount.py",sdk+"adimage.py"]},
  ads_get_ad_videos:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"/advideos",entityType:"AD_VIDEO",fields:["id","title","description","created_time","updated_time","length","picture","source","permalink_url","published","embeddable","is_instagram_eligible"],documentation:[sdk+"adaccount.py",sdk+"advideo.py"]},
  ads_get_video_details:{roots:[{type:"AD_VIDEO",input:"video_id"}],edge:"",entityType:"AD_VIDEO",fields:["id","title","description","created_time","updated_time","length","picture","source","permalink_url","published","embeddable","is_instagram_eligible"],documentation:[sdk+"advideo.py"]},
  ads_get_ad_rules:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"/adrules_library",entityType:"RULE",fields:["id","account_id","name","status","created_time","updated_time","disable_error_code"],documentation:[sdk+"adaccount.py",sdk+"adrule.py"]},
  ads_get_rule_details:{roots:[{type:"RULE",input:"rule_id"}],edge:"",entityType:"RULE",fields:["id","account_id","name","status","created_time","updated_time","disable_error_code"],documentation:[sdk+"adrule.py"]},
  ads_get_custom_conversions:{roots:[{type:"AD_ACCOUNT",input:"account_id"}],edge:"/customconversions",entityType:"CUSTOM_CONVERSION",fields:["id","account_id","name","description","custom_event_type","default_conversion_value","creation_time","first_fired_time","last_fired_time","is_archived","is_unavailable","retention_days","event_source_type"],documentation:[sdk+"adaccount.py",sdk+"customconversion.py"]},
});
