import {z} from "zod";
import {executePlatformProductAction} from "./tools.js";
export const LEGACY_BUSINESS_INVENTORY_TOOLS=Object.freeze(["ads_get_pages_for_business"]);
export const LEGACY_BUSINESS_PAGES_SCHEMA=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),business_id:z.string().regex(/^[1-9]\d{0,31}$/),relationship:z.enum(["owned","client"]),connection_id:z.string().min(1).max(128).optional()}).strict();
export function mapLegacyBusinessPages(raw:unknown){const v=LEGACY_BUSINESS_PAGES_SCHEMA.parse(raw);return {tool:v.relationship==="owned"?"business_list_owned_pages":"business_list_client_pages",args:{client_id:v.client_id,asset_id:v.business_id,input:{},...(v.connection_id?{connection_id:v.connection_id}:{})}};}
export async function executeLegacyBusinessPages(raw:unknown){const mapped=mapLegacyBusinessPages(raw);return executePlatformProductAction(mapped.tool,mapped.args);}
