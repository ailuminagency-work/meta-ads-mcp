import {z} from 'zod';
import {executePlatformProductAction} from './tools.js';
import {INVOICE_METADATA_TOOL,invoiceMetadataInput} from './business-invoice-metadata.js';
export const LEGACY_INVOICE_METADATA_TOOLS=Object.freeze(['ads_get_invoices']);
export const LEGACY_INVOICE_METADATA_SCHEMA=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),business_id:z.string().regex(/^[1-9]\d{0,31}$/),account_ids:z.array(z.string().regex(/^[1-9]\d{0,31}$/)).min(1).max(20),since:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),until:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),connection_id:z.string().min(1).max(128).optional()}).strict();
export function mapLegacyInvoiceMetadata(raw:unknown){const {client_id,business_id,connection_id,...input}=LEGACY_INVOICE_METADATA_SCHEMA.parse(raw);invoiceMetadataInput(input);return {tool:INVOICE_METADATA_TOOL,args:{client_id,asset_id:business_id,input,...(connection_id?{connection_id}:{})}};}
export async function executeLegacyInvoiceMetadata(raw:unknown){const mapped=mapLegacyInvoiceMetadata(raw);return executePlatformProductAction(mapped.tool,mapped.args);}
