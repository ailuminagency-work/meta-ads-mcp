import {resolveAuthorizedAssets} from "./assets.js";
import {getPlatformRepository,resolveOperationContext} from "./runtime.js";
import {z} from "zod";
import {PlatformDenied} from "./models.js";
import {validateLeadReadInput} from "./lead-read.js";
import {executePlatformProductAction} from "./tools.js";
export const LEGACY_LEAD_READ_TOOLS=Object.freeze(["ads_get_lead_forms","ads_get_leads","ads_get_ad_leads"]);
export const LEGACY_LEAD_CAPABILITIES=Object.freeze({ads_get_lead_forms:"leads.list.forms",ads_get_leads:"leads.retrieve",ads_get_ad_leads:"leads.retrieve"});
const numeric=z.string().regex(/^\d{1,32}$/),identifier=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const common={client_id:identifier,connection_id:identifier.optional(),limit:z.number().int().min(1).max(100).optional()};
export function mapLegacyLeadAction(name:string,raw:Record<string,unknown>,derivedFormId?:string):{tool:string;assetId:string;input:Record<string,unknown>;limit:number}{
 if(name==="ads_get_lead_forms"){const value=z.object({...common,page_id:numeric}).strict().parse(raw);return {tool:"leads_list_forms",assetId:value.page_id,input:{},limit:value.limit??25};}
 if(name==="ads_get_ad_leads"){const value=z.object({...common,ad_id:numeric,created_since:z.number().int().optional(),created_until:z.number().int().optional()}).strict().parse(raw);if(!derivedFormId)throw new PlatformDenied("LEGACY_AD_LEAD_REGISTERED_FORM_REQUIRED");numeric.parse(derivedFormId);const input={ad_id:value.ad_id,...(value.created_since!==undefined?{created_since:value.created_since}:{}),...(value.created_until!==undefined?{created_until:value.created_until}:{})};validateLeadReadInput("leads_retrieve",input);return {tool:"leads_retrieve",assetId:derivedFormId,input,limit:value.limit??25};}
 if(name==="ads_get_leads"){const value=z.object({...common,form_id:numeric,ad_id:numeric,created_since:z.number().int().optional(),created_until:z.number().int().optional()}).strict().parse(raw),input={ad_id:value.ad_id,...(value.created_since!==undefined?{created_since:value.created_since}:{}),...(value.created_until!==undefined?{created_until:value.created_until}:{})};validateLeadReadInput("leads_retrieve",input);return {tool:"leads_retrieve",assetId:value.form_id,input,limit:value.limit??25};}
 throw new PlatformDenied("LEGACY_LEAD_MAPPING_REQUIRED");
}
/** Compatibility shares canonical selected-ad authorization and private projection; it does not restore broad legacy PII reads. */
export async function executeLegacyLeadAction(name:string,raw:Record<string,unknown>){
 let derivedFormId:string|undefined;if(name==="ads_get_ad_leads"){const clean=z.object({...common,ad_id:numeric,created_since:z.number().int().optional(),created_until:z.number().int().optional()}).strict().parse(raw),ctx=await resolveOperationContext(clean.client_id,"leads_retrieve","META_MARKETING"),assets=await resolveAuthorizedAssets(getPlatformRepository(),ctx,[{type:"AD",id:clean.ad_id}],Date.now(),3600000),ad=assets.find(a=>a.type==="AD"&&a.id===clean.ad_id),creatives=assets.filter(a=>a.type==="CREATIVE"&&ad?.parents.some(p=>p.type==="CREATIVE"&&p.id===a.id));if(creatives.length!==1)throw new PlatformDenied("LEGACY_AD_LEAD_REGISTERED_FORM_REQUIRED");const forms=assets.filter(a=>a.type==="LEAD_FORM"&&creatives[0].parents.some(p=>p.type==="LEAD_FORM"&&p.id===a.id));if(forms.length!==1)throw new PlatformDenied("LEGACY_AD_LEAD_REGISTERED_FORM_REQUIRED");derivedFormId=forms[0].id;}
 const mapped=mapLegacyLeadAction(name,raw,derivedFormId),result=await executePlatformProductAction(mapped.tool,{client_id:identifier.parse(raw.client_id),asset_id:mapped.assetId,input:mapped.input,...(typeof raw.connection_id==="string"?{connection_id:raw.connection_id}:{})});
 if("isError" in result&&result.isError)return result;
 if(result.content[0]?.type!=="text")throw new PlatformDenied("LEGACY_LEAD_CANONICAL_RESPONSE_REQUIRED");const body=JSON.parse(result.content[0].text);if(!Array.isArray(body.data))throw new PlatformDenied("LEGACY_LEAD_CANONICAL_RESPONSE_REQUIRED");
 return {...result,content:[{type:"text" as const,text:JSON.stringify({...body,data:body.data.slice(0,mapped.limit),complete_inventory:false,local_result_limit:mapped.limit})}]};
}
