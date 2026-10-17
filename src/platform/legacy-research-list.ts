import {z} from 'zod';
import {PlatformDenied} from './models.js';
import {resolveOperationContext} from './runtime.js';
import {getResearchJobService} from './research-runtime.js';
export const LEGACY_RESEARCH_LIST_TOOLS=Object.freeze(['ads_library_list_runs']);
export const LEGACY_RESEARCH_LIST_SCHEMA=z.object({client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),limit:z.number().int().min(1).max(25).optional()}).strict();
export function mapLegacyResearchList(raw:unknown){const parsed=LEGACY_RESEARCH_LIST_SCHEMA.safeParse(raw);if(!parsed.success)throw new PlatformDenied('RESEARCH_LIST_EXPLICIT_CLIENT_AND_LIMIT_REQUIRED');return parsed.data;}
export async function executeLegacyResearchList(raw:unknown){const input=mapLegacyResearchList(raw),ctx=await resolveOperationContext(input.client_id,'ads_library_list_runs','META_MARKETING'),value=await getResearchJobService().listPublicAcquisitions(ctx.principal,input.client_id,input.limit);return {content:[{type:'text' as const,text:JSON.stringify(value)}]};}
