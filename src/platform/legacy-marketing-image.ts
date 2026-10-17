import {z} from "zod";
import {executePlatformProductAction} from "./tools.js";
export const LEGACY_MARKETING_IMAGE_TOOLS=Object.freeze(["ads_upload_ad_image"]);
export function mapLegacyMarketingImage(raw:Record<string,unknown>){const v=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),account_id:z.string().regex(/^(?:act_)?[0-9]{1,32}$/),source_media_id:z.string().regex(/^jpeg_[a-f0-9]{64}$/),approval_id:z.string().min(1).max(128).optional(),connection_id:z.string().min(1).max(128).optional()}).strict().parse(raw);return {client_id:v.client_id,asset_id:v.account_id,input:{source_media_id:v.source_media_id},...(v.approval_id?{approval_id:v.approval_id}:{}),...(v.connection_id?{connection_id:v.connection_id}:{})};}
export async function executeLegacyMarketingImage(raw:Record<string,unknown>){return executePlatformProductAction("marketing_upload_image",mapLegacyMarketingImage(raw));}
