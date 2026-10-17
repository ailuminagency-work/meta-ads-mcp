import {validateWhatsAppQrParameters} from "./whatsapp-qr-contracts.js";
import {validateWhatsAppAnalyticsParameters} from "./whatsapp-analytics-contracts.js";
import {validateWhatsAppPhoneParameters} from "./whatsapp-phone-contracts.js";
import {z} from "zod";
import {PlatformDenied} from "./models.js";
import {validateWhatsAppTemplateParameters} from "./whatsapp-template-contracts.js";
import {validateWhatsAppFlowParameters} from "./whatsapp-flow-json.js";
import {executePlatformProductAction} from "./tools.js";
import {getPlatformRepository,resolveOperationContext} from "./runtime.js";
import {resolveAuthorizedAssets} from "./assets.js";
export const LEGACY_WHATSAPP_READ_TOOLS=Object.freeze(["whatsapp_get_business_accounts","whatsapp_get_qr_codes","whatsapp_get_templates","whatsapp_get_flows","whatsapp_get_webhook_subscriptions","whatsapp_get_phone_numbers","whatsapp_get_business_profile","whatsapp_get_analytics","whatsapp_get_template_analytics"]);
export const LEGACY_WHATSAPP_WRITE_TOOLS=Object.freeze(["whatsapp_create_qr_code","whatsapp_update_qr_code","whatsapp_delete_qr_code","whatsapp_update_business_profile","whatsapp_subscribe_webhook","whatsapp_unsubscribe_webhook","whatsapp_create_template","whatsapp_update_template","whatsapp_delete_template","whatsapp_create_flow","whatsapp_update_flow","whatsapp_publish_flow","whatsapp_deprecate_flow","whatsapp_delete_flow"]);
export interface LegacyWhatsAppMapping{tool:string;assetId:string;input:Record<string,unknown>;expectedMessagingAccountId?:string;limit?:number}
const numeric=z.string().regex(/^\d{1,32}$/),client=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
/** Pure bounded compatibility mapping. No caller field is silently dropped. */
export function mapLegacyWhatsAppAction(name:string,raw:Record<string,unknown>):LegacyWhatsAppMapping{
 const value=structuredClone(raw),common=z.object({client_id:client,approval_id:z.string().max(128).optional(),connection_id:z.string().max(128).optional()});common.parse(value);delete value.client_id;delete value.approval_id;delete value.connection_id;
 let result:LegacyWhatsAppMapping;
 if(name==="whatsapp_get_business_accounts"){const v=z.object({business_id:numeric,include_client_wabas:z.literal(false),limit:z.number().int().min(1).max(100).optional()}).strict().parse(value);result={tool:"business_list_owned_wabas",assetId:v.business_id,input:{},limit:v.limit??25};
 }else if(["whatsapp_get_qr_codes","whatsapp_create_qr_code","whatsapp_update_qr_code","whatsapp_delete_qr_code"].includes(name)){const {phone_number_id,code,generate_qr_image,...rest}=value;numeric.parse(phone_number_id);if(name==="whatsapp_get_qr_codes"){z.object({}).strict().parse(rest);if(generate_qr_image!==undefined)throw new PlatformDenied("WHATSAPP_QR_UNKNOWN_INPUT_REQUIRED");result={tool:code===undefined?"whatsapp_platform_list_qr_codes":"whatsapp_platform_get_qr_code",assetId:String(phone_number_id),input:code===undefined?{}:{code}};}else if(name==="whatsapp_create_qr_code"){if(code!==undefined)throw new PlatformDenied("WHATSAPP_QR_CREATE_CODE_NOT_ACCEPTED");result={tool:"whatsapp_platform_create_qr_code",assetId:String(phone_number_id),input:{...rest,generate_qr_image:generate_qr_image??"PNG"}};}else{if(generate_qr_image!==undefined)throw new PlatformDenied("WHATSAPP_QR_UNKNOWN_INPUT_REQUIRED");result={tool:name.replace("whatsapp_","whatsapp_platform_"),assetId:String(phone_number_id),input:{...rest,code}};}
 }else if(name==="whatsapp_get_analytics"||name==="whatsapp_get_template_analytics"){
  const date=z.string().refine(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)||/^\d{1,12}$/.test(v)),v=z.object({waba_id:numeric,start:date,end:date,...(name.includes("template")?{template_ids:z.array(numeric).min(1).max(10),metric_types:z.array(z.enum(["SENT","DELIVERED","READ","CLICKED"])).optional()}:{metric_type:z.enum(["MESSAGING","CONVERSATION","PRICING"]).optional(),granularity:z.enum(["HALF_HOUR","DAY","MONTH"]).optional(),phone_ids:z.array(numeric).min(1).max(10),dimensions:z.array(z.string()).optional()})}).strict().parse(value);
  const seconds=(v:string)=>{if(/^\d+$/.test(v))return Number(v);const milliseconds=Date.parse(v+"T00:00:00Z");if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString().slice(0,10)!==v)throw new PlatformDenied("WHATSAPP_ANALYTICS_DATE_REQUIRED");return milliseconds/1000;};const {waba_id,start,end,...input}=v;result={tool:name.replace("whatsapp_","whatsapp_platform_"),assetId:waba_id,input:{...input,start:seconds(start),end:seconds(end),...(!name.includes("template")?{metric_type:(input as Record<string,unknown>).metric_type??"MESSAGING",granularity:(input as Record<string,unknown>).granularity??"DAY"}:{})}};
 }else if(["whatsapp_get_webhook_subscriptions","whatsapp_subscribe_webhook","whatsapp_unsubscribe_webhook"].includes(name)){
  const v=z.object({waba_id:numeric}).strict().parse(value),tool=name==="whatsapp_get_webhook_subscriptions"?"whatsapp_platform_get_subscriptions":name==="whatsapp_subscribe_webhook"?"whatsapp_platform_subscribe":"whatsapp_platform_unsubscribe";result={tool,assetId:v.waba_id,input:{}};
 }else if(name==="whatsapp_get_phone_numbers"){
  const v=z.object({waba_id:numeric.optional(),phone_number_id:numeric.optional(),limit:z.number().int().min(1).max(100).optional()}).strict().parse(value);if(!v.waba_id&&!v.phone_number_id)throw new PlatformDenied("WHATSAPP_REGISTERED_TARGET_REQUIRED");result={tool:v.phone_number_id?"whatsapp_platform_get_phone":"whatsapp_platform_list_phones",assetId:v.phone_number_id??v.waba_id!,input:{},...(v.phone_number_id&&v.waba_id?{expectedMessagingAccountId:v.waba_id}:{}),...(!v.phone_number_id?{limit:v.limit??25}:{})};
 }else if(name==="whatsapp_get_business_profile"){
  const v=z.object({phone_number_id:numeric}).strict().parse(value);result={tool:"whatsapp_platform_get_profile",assetId:v.phone_number_id,input:{}};
 }else if(name==="whatsapp_update_business_profile"){
  const {phone_number_id,...input}=value;numeric.parse(phone_number_id);result={tool:"whatsapp_platform_update_profile",assetId:String(phone_number_id),input};
 }else if(name==="whatsapp_get_templates"||name==="whatsapp_get_flows"){
  const template=name==="whatsapp_get_templates",key=template?"template_id":"flow_id",v=z.object({waba_id:numeric.optional(),[key]:numeric.optional(),limit:z.number().int().min(1).max(100).optional()}).strict().parse(value),target=v[key] as string|undefined;if(!target&&!v.waba_id)throw new PlatformDenied("WHATSAPP_REGISTERED_TARGET_REQUIRED");
  result={tool:template?(target?"whatsapp_platform_get_template":"whatsapp_platform_list_templates"):(target?"whatsapp_platform_get_flow":"whatsapp_platform_list_flows"),assetId:target??numeric.parse(v.waba_id),input:{},...(target&&v.waba_id?{expectedMessagingAccountId:numeric.parse(v.waba_id)}:{}),...(!target?{limit:typeof v.limit==="number"?v.limit:25}:{})};
 }else if(name==="whatsapp_create_template"){
  const {waba_id,...input}=value;numeric.parse(waba_id);if(input.parameter_format===undefined)input.parameter_format="POSITIONAL";result={tool:"whatsapp_platform_create_template",assetId:String(waba_id),input};
 }else if(name==="whatsapp_update_template"){
  const {template_id,...input}=value;numeric.parse(template_id);result={tool:"whatsapp_platform_update_template",assetId:String(template_id),input};
 }else if(name==="whatsapp_delete_template"){
  const v=z.object({waba_id:numeric,hsm_id:numeric,name:z.string()}).strict().parse(value);result={tool:"whatsapp_platform_delete_template",assetId:v.hsm_id,input:{name:v.name},expectedMessagingAccountId:numeric.parse(v.waba_id)};
 }else if(name==="whatsapp_create_flow"){
  const {waba_id,publish,...input}=value;numeric.parse(waba_id);if(publish!==undefined&&publish!==false)throw new PlatformDenied("WHATSAPP_SEPARATE_PUBLISH_APPROVAL_REQUIRED");result={tool:"whatsapp_platform_create_flow",assetId:String(waba_id),input};
 }else if(name==="whatsapp_update_flow"){
  const {flow_id,...input}=value;numeric.parse(flow_id);const json=input.flow_json!==undefined;if(json&&(input.name!==undefined||input.categories!==undefined))throw new PlatformDenied("WHATSAPP_SEPARATE_METADATA_JSON_APPROVALS_REQUIRED");result={tool:json?"whatsapp_platform_upload_flow_json":"whatsapp_platform_update_flow",assetId:String(flow_id),input};
 }else if(["whatsapp_publish_flow","whatsapp_deprecate_flow","whatsapp_delete_flow"].includes(name)){
  const {flow_id,...input}=value;numeric.parse(flow_id);result={tool:name.replace("whatsapp_","whatsapp_platform_"),assetId:String(flow_id),input};
 }else throw new PlatformDenied("WHATSAPP_LEGACY_MAPPING_REQUIRED");
 if(result.tool.includes("qr_code"))validateWhatsAppQrParameters(result.tool,result.input);else if(result.tool.includes("analytics"))validateWhatsAppAnalyticsParameters(result.tool,result.input);else if(result.tool.includes("template"))validateWhatsAppTemplateParameters(result.tool,result.input);else if(result.tool.includes("flow"))validateWhatsAppFlowParameters(result.tool,result.input);else if(result.tool.includes("profile")||result.tool.includes("phone"))validateWhatsAppPhoneParameters(result.tool,result.input);else z.object({}).strict().parse(result.input);return result;
}
export async function executeLegacyWhatsAppAction(name:string,raw:Record<string,unknown>){
 const mapped=mapLegacyWhatsAppAction(name,raw),clientId=client.parse(raw.client_id);
 if(mapped.expectedMessagingAccountId){const ctx=await resolveOperationContext(clientId,mapped.tool,"META_WHATSAPP"),type=mapped.tool.includes("template")?"TEMPLATE":mapped.tool.includes("phone")?"WHATSAPP_PHONE":"FLOW",assets=await resolveAuthorizedAssets(getPlatformRepository(),ctx,[{type,id:mapped.assetId}]);if(!assets.some(a=>a.type===type&&a.id===mapped.assetId&&a.parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===mapped.expectedMessagingAccountId)))throw new PlatformDenied("WHATSAPP_LEGACY_EXACT_PARENT_REQUIRED");}
 const result=await executePlatformProductAction(mapped.tool,{client_id:clientId,asset_id:mapped.assetId,input:mapped.input,...(typeof raw.approval_id==="string"?{approval_id:raw.approval_id}:{}),...(typeof raw.connection_id==="string"?{connection_id:raw.connection_id}:{})});
 if(mapped.limit!==undefined&&!("isError" in result&&result.isError)){if(result.content[0]?.type!=="text")throw new PlatformDenied("WHATSAPP_CANONICAL_TEXT_RESPONSE_REQUIRED");const body=JSON.parse(result.content[0].text);if(Array.isArray(body.data)){body.data=body.data.slice(0,mapped.limit);return {...result,content:[{type:"text" as const,text:JSON.stringify(body)}]};}}return result;
}
