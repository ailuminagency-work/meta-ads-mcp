import {z} from "zod";
import {readRegisteredAdComments,AD_COMMENTS_TOOL} from "./ad-comments-bridge.js";
import {getPlatformRepository,resolveOperationContext} from "./runtime.js";
export const LEGACY_AD_COMMENT_READ_TOOLS=Object.freeze([AD_COMMENTS_TOOL]);
export const LEGACY_AD_COMMENT_SCHEMA=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),ad_id:z.string().regex(/^[1-9]\d{0,31}$/),limit:z.number().int().min(1).max(50).optional(),marketing_connection_id:z.string().min(1).max(128).optional(),page_connection_id:z.string().min(1).max(128).optional()}).strict();
export async function executeLegacyAdComments(raw:unknown){const {client_id,...input}=LEGACY_AD_COMMENT_SCHEMA.parse(raw),context=await resolveOperationContext(client_id,AD_COMMENTS_TOOL,"META_MARKETING"),output=await readRegisteredAdComments(getPlatformRepository(),context,input);return {content:[{type:"text" as const,text:JSON.stringify(output)}]};}
