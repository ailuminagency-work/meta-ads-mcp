import {z} from 'zod';
import {executePlatformProductAction} from './tools.js';
export const LEGACY_IMAGE_INSPECTION_TOOLS=Object.freeze(['ads_get_creative_media']);
export const LEGACY_IMAGE_INSPECTION_SCHEMA=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),creative_id:z.string().regex(/^[1-9]\d{0,31}$/),image_hash:z.string().regex(/^[a-f0-9]{32}$/),connection_id:z.string().min(1).max(128).optional()}).strict();
export function mapLegacyImageInspection(raw:unknown){const v=LEGACY_IMAGE_INSPECTION_SCHEMA.parse(raw);return{client_id:v.client_id,asset_id:v.creative_id,input:{image_hash:v.image_hash},...(v.connection_id?{connection_id:v.connection_id}:{})};}
export function executeLegacyImageInspection(raw:unknown){return executePlatformProductAction('marketing_inspect_creative_image',mapLegacyImageInspection(raw));}
