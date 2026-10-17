import {z} from "zod";
import {executePlatformProductAction} from "./tools.js";
import {leadFormBody} from "./lead-form-contract.js";
export const LEGACY_LEAD_FORM_WRITE_TOOLS=Object.freeze(["ads_create_lead_form"]);
export function mapLegacyLeadForm(raw:Record<string,unknown>){const value=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),page_id:z.string().regex(/^\d{1,32}$/),name:z.string(),questions:z.array(z.unknown()),privacy_policy_url:z.string(),follow_up_action_url:z.string(),locale:z.string().optional(),approval_id:z.string().max(128).optional(),connection_id:z.string().max(128).optional()}).strict().parse(raw);const input={name:value.name,questions:value.questions,privacy_policy_url:value.privacy_policy_url,follow_up_action_url:value.follow_up_action_url,locale:value.locale??"EN_US"};leadFormBody(input);return {client_id:value.client_id,asset_id:value.page_id,input,...(value.approval_id?{approval_id:value.approval_id}:{}),...(value.connection_id?{connection_id:value.connection_id}:{})};}
export async function executeLegacyLeadForm(raw:Record<string,unknown>){return executePlatformProductAction("leads_create_form",mapLegacyLeadForm(raw));}
