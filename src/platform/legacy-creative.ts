import {z} from "zod";
import {PlatformDenied,type AssetRef} from "./models.js";
import {assertNoCredentialShapedString} from "./input-safety.js";
const id=z.string().regex(/^\d{1,32}$/),copy=z.string().max(4000).refine(value=>!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value));
const schema=z.object({page_id:id,image_hash:z.string().regex(/^[a-f0-9]{32}$/i),lead_form_id:id.optional(),link_url:z.string().max(2048).optional(),message:copy.optional(),headline:copy.optional(),description:copy.optional(),call_to_action_type:z.enum(["LEARN_MORE","SHOP_NOW","GET_QUOTE","CONTACT_US","SIGN_UP","APPLY_NOW","DOWNLOAD","SUBSCRIBE"]).optional()}).strict();
export function buildLegacyImageCreative(input:Record<string,unknown>):{story:Record<string,unknown>;assets:AssetRef[];destinationOrigin:string}{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new PlatformDenied("LEGACY_TYPED_IMAGE_CREATIVE_REQUIRED");const data=parsed.data;
 const lead=!!data.lead_form_id;if(lead&&data.link_url!==undefined&&data.link_url!=="https://fb.me/")throw new PlatformDenied("LEAD_CREATIVE_FIXED_DESTINATION_REQUIRED");
 if(lead&&data.call_to_action_type!==undefined&&!["APPLY_NOW","DOWNLOAD","GET_QUOTE","LEARN_MORE","SIGN_UP","SUBSCRIBE"].includes(data.call_to_action_type))throw new PlatformDenied("LEAD_CREATIVE_CTA_REQUIRED");
 if(!lead&&data.call_to_action_type!==undefined&&!["LEARN_MORE","SHOP_NOW","GET_QUOTE","CONTACT_US"].includes(data.call_to_action_type))throw new PlatformDenied("LEGACY_CREATIVE_CTA_REQUIRED");
 let destination:URL;try{destination=new URL(lead?"https://fb.me/":data.link_url??"");}catch{throw new PlatformDenied("LEGACY_CREATIVE_DESTINATION_REQUIRED");}
 if(destination.protocol!=="https:"||destination.username||destination.password||destination.hash||destination.port||!destination.hostname.includes(".")||destination.hostname.endsWith(".local")||destination.hostname.endsWith(".localhost")||/^(?:\d+\.){3}\d+$/.test(destination.hostname)||destination.hostname.includes(":"))throw new PlatformDenied("LEGACY_CREATIVE_DESTINATION_REQUIRED");
 for(const value of Object.values(data))if(typeof value==="string")assertNoCredentialShapedString(value);
 const link:Record<string,unknown>={image_hash:data.image_hash.toLowerCase(),link:destination.toString()};
 for(const[source,target]of [["message","message"],["headline","name"],["description","description"]] as const)if(data[source]!==undefined)link[target]=data[source];
 if(lead||data.call_to_action_type)link.call_to_action={type:data.call_to_action_type??"SIGN_UP",value:lead?{lead_gen_form_id:data.lead_form_id}:{link:destination.toString()}};
 return {story:{page_id:data.page_id,link_data:link},assets:[{type:"PAGE",id:data.page_id},{type:"AD_IMAGE",id:data.image_hash.toLowerCase()},...(lead?[{type:"LEAD_FORM" as const,id:data.lead_form_id!}]:[])],destinationOrigin:destination.origin};
}
