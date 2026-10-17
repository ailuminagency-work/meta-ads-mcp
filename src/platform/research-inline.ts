import {geminiInlineReceiptSchema} from './gemini-research-adapter.js';
import {apifyAcquisitionReceiptSchema} from './apify-public-ads.js';
import {PlatformDenied} from './models.js';
import type {ResearchJob} from './research-job-types.js';
export function researchInlineReceipt(job:Pick<ResearchJob,'boundedRequest'|'acquisitionRequest'>,raw:unknown){if(job.acquisitionRequest){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new PlatformDenied('RESEARCH_INLINE_RECEIPT_INVALID');const {estimatedCostCents,...candidate}=raw as Record<string,unknown>;const v=apifyAcquisitionReceiptSchema.parse(candidate);if(estimatedCostCents!==undefined&&estimatedCostCents!==v.maximumRunCostCents)throw new PlatformDenied('RESEARCH_INLINE_RECEIPT_INVALID');return {...v,estimatedCostCents:v.maximumRunCostCents};}if(job.boundedRequest)return geminiInlineReceiptSchema.parse(raw);throw new PlatformDenied('RESEARCH_INLINE_MODE_REQUIRED');}
