import type {ProductContract} from "./products/contracts.js";
import type {AssetType} from "./models.js";
/** Published objects belong to their owner account. Consumed upload/container
 * inputs remain immutable provenance, never future authorization parents. */
export function publishedProductOwnerType(contract:ProductContract|undefined):AssetType|undefined{
 if(!contract?.verified||contract.method!=="POST")return;
 if(contract.tool==="marketing_create_async_report"&&contract.provider==="META_MARKETING"&&contract.assetType==="AD_ACCOUNT"&&contract.createdAssetType==="REPORT"&&contract.path==="/{asset_id}/insights")return "AD_ACCOUNT";
 if(contract.provider==="META_FACEBOOK_PAGES"&&contract.tool==="pages_reply_comment"&&contract.createdAssetType==="COMMENT"&&contract.assetType==="COMMENT"&&contract.method==="POST"&&contract.path==="/{asset_id}/comments")return "COMMENT";
 if(contract.tool==="messenger_create_utility_template"&&contract.provider==="META_MESSENGER"&&contract.createdAssetType==="TEMPLATE"&&contract.assetType==="PAGE")return "PAGE";
 if(contract.provider==="META_MARKETING"&&contract.assetType==="AD_ACCOUNT"&&((contract.tool==="marketing_upload_video"&&contract.createdAssetType==="AD_VIDEO")||(["marketing_create_empty_custom_audience","marketing_create_lookalike_audience"].includes(contract.tool)&&contract.createdAssetType==="AUDIENCE")))return "AD_ACCOUNT";
 if(contract.tool==="marketing_upload_image"&&contract.provider==="META_MARKETING"&&contract.createdAssetType==="AD_IMAGE"&&contract.assetType==="AD_ACCOUNT")return "AD_ACCOUNT";
 if(contract.tool==="leads_create_form"&&contract.provider==="META_MARKETING"&&contract.createdAssetType==="LEAD_FORM"&&contract.assetType==="PAGE")return "PAGE";
 if(contract.tool==="pages_create_videos"&&contract.provider==="META_FACEBOOK_PAGES"&&contract.createdAssetType==="VIDEO"&&contract.assetType==="PAGE")return "PAGE";
 if(contract.tool==="pages_create_photos"&&contract.provider==="META_FACEBOOK_PAGES"&&contract.createdAssetType==="POST"&&contract.assetType==="PAGE")return "PAGE";
 if(contract.tool==="threads_publish_container"&&contract.provider==="META_THREADS"&&contract.createdAssetType==="POST"&&contract.assetType==="THREADS_ACCOUNT")return "THREADS_ACCOUNT";
 if(((contract.tool==="instagram_publish_container"&&contract.provider==="META_INSTAGRAM_FACEBOOK_LOGIN")||(contract.tool==="instagram_login_publish"&&contract.provider==="META_INSTAGRAM_LOGIN"))&&contract.createdAssetType==="MEDIA"&&contract.assetType==="INSTAGRAM_ACCOUNT")return "INSTAGRAM_ACCOUNT";
 return undefined;
}
export function validCreatedProductId(contract:ProductContract,id:unknown,parentId:string):id is string{
  if(typeof id!=="string")return false;
  if(contract.tool==="marketing_create_purchase_conversion"&&contract.provider==="META_MARKETING"&&contract.assetType==="AD_ACCOUNT"&&contract.createdAssetType==="CUSTOM_CONVERSION"&&contract.method==="POST"&&contract.path==="/{asset_id}/customconversions")return /^[1-9]\d{0,31}$/.test(id);
  if(contract.tool==="marketing_create_classic_split_study"&&contract.provider==="META_MARKETING"&&contract.assetType==="BUSINESS"&&contract.createdAssetType==="STUDY"&&contract.method==="POST"&&contract.path==="/{asset_id}/ad_studies")return /^[0-9]{1,32}$/.test(id);
  if(contract.tool==="marketing_create_disabled_pause_rule"&&contract.provider==="META_MARKETING"&&contract.assetType==="AD_ACCOUNT"&&contract.createdAssetType==="RULE"&&contract.method==="POST"&&contract.path==="/{asset_id}/adrules_library")return /^[0-9]{1,32}$/.test(id);
  if(contract.tool==="marketing_create_async_report"&&contract.provider==="META_MARKETING"&&contract.assetType==="AD_ACCOUNT"&&contract.createdAssetType==="REPORT"&&contract.method==="POST"&&contract.path==="/{asset_id}/insights")return /^[0-9]{1,32}$/.test(id);
  if(contract.provider==="META_MESSENGER"&&contract.tool==="messenger_create_utility_template"&&contract.createdAssetType==="TEMPLATE"&&contract.assetType==="PAGE")return /^[0-9]{1,32}$/.test(id);
  if(contract.provider==="META_MARKETING"&&contract.assetType==="AD_ACCOUNT"&&((contract.tool==="marketing_upload_video"&&contract.createdAssetType==="AD_VIDEO")||(["marketing_create_empty_custom_audience","marketing_create_lookalike_audience"].includes(contract.tool)&&contract.createdAssetType==="AUDIENCE")))return /^[0-9]{1,32}$/.test(id);
  if(contract.provider==="META_MARKETING"&&contract.tool==="marketing_upload_image"&&contract.createdAssetType==="AD_IMAGE")return /^[a-f0-9]{32}$/.test(id);
  if(contract.provider==="META_MARKETING"&&contract.tool==="leads_create_form"&&contract.createdAssetType==="LEAD_FORM")return /^[0-9]{1,32}$/.test(id);
  if(contract.provider==="META_FACEBOOK_PAGES"&&contract.tool==="pages_create_videos"&&contract.createdAssetType==="VIDEO")return /^[0-9]{1,32}$/.test(id);
  // Local bounded identifier syntax only; ownership comes from the approved COMMENT ancestry.
  if(contract.provider==="META_FACEBOOK_PAGES"&&contract.tool==="pages_reply_comment"&&contract.createdAssetType==="COMMENT"&&contract.assetType==="COMMENT"&&contract.method==="POST"&&contract.path==="/{asset_id}/comments")return id.length<=100&&/^[0-9]+(?:_[0-9]+)*$/.test(id);
  if(contract.createdAssetType==="COMMENT")return ((contract.provider==="META_INSTAGRAM_FACEBOOK_LOGIN"&&contract.tool==="instagram_reply_comment")||(contract.provider==="META_INSTAGRAM_LOGIN"&&contract.tool==="instagram_login_reply_comment"))&&contract.assetType==="COMMENT"&&contract.method==="POST"&&contract.path==="/{asset_id}/replies"&&/^[0-9]{1,32}$/.test(id);
  if(contract.provider==="META_WHATSAPP"&&contract.tool==="whatsapp_platform_create_template"&&contract.createdAssetType==="TEMPLATE"&&contract.assetType==="MESSAGING_ACCOUNT")return /^[0-9]{1,32}$/.test(id);
  if(contract.provider==="META_WHATSAPP"&&contract.tool==="whatsapp_platform_create_flow"&&contract.createdAssetType==="FLOW"&&contract.assetType==="MESSAGING_ACCOUNT")return /^[0-9]{1,32}$/.test(id);
  if(contract.provider==="META_FACEBOOK_PAGES"&&contract.createdAssetType==="POST")return /^[0-9]{1,32}_[0-9]{1,32}$/.test(id)&&id.split("_")[0]===parentId;
  return ["META_THREADS","META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN"].includes(contract.provider)&&["MEDIA","POST"].includes(contract.createdAssetType??"")&&/^[0-9]{1,32}$/.test(id);
}
