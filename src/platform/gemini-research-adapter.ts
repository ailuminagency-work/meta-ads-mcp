import {createHash} from 'node:crypto';
import {z} from 'zod';
import {PlatformDenied} from './models.js';
import {canonicalJson} from './policy.js';
import {GeminiBoundedTextTransport,type GeminiBoundedConfiguration} from './gemini-bounded.js';
import {researchResultSchema,type ResearchAdapter,type ResearchRequest,type ResearchExecutionContext} from './research-job-types.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const geminiInlineReceiptSchema=z.object({requestHash:hash,policyHash:hash,idempotencyKey:hash,result:researchResultSchema,promptTokens:z.number().int().positive().max(4096),outputTokens:z.number().int().min(0).max(2048),estimatedCostCents:z.number().int().min(0).max(100000000),providerHardCostCap:z.literal(false),actualInvoiceVerified:z.literal(false)}).strict();
/** Must be admitted through registerBoundedRequest, never the hard-cap registry path. */
export class GeminiResearchAdapter implements ResearchAdapter{
 readonly id='gemini_text';readonly version:string;readonly coverage='UNSEARCHED_MODEL_TEXT_ANALYSIS_NOT_CURRENT_WEB_RESEARCH';
 readonly controls={quoteFree:true as const,statusFree:true as const,abortNoAdditionalCharge:true as const,hardSpendCap:false,idempotencyKeys:false};
 readonly boundedRequest;private readonly transport:GeminiBoundedTextTransport;
 constructor(policy:GeminiBoundedConfiguration,keyFingerprint:string,apiKey:()=>Promise<string>,fetcher:typeof fetch=fetch,now:()=>number=Date.now,configurationCurrent:()=>boolean=()=>true){if(!/^[a-f0-9]{64}$/.test(keyFingerprint))throw new PlatformDenied('GEMINI_APPROVED_CREDENTIAL_FINGERPRINT_REQUIRED');this.transport=new GeminiBoundedTextTransport(policy,async()=>{const key=await apiKey();if(createHash('sha256').update(key).digest('hex')!==keyFingerprint)throw new PlatformDenied('GEMINI_CREDENTIAL_CHANGED_REAPPROVAL_REQUIRED');return key;},fetcher,now,configurationCurrent);this.boundedRequest=Object.freeze({providerHardCostCap:false as const,providerIdempotency:false as const,grounding:false as const,maximumInputTokens:policy.maximumInputTokens,maximumOutputTokens:policy.maximumOutputTokens,pricingPolicyHash:this.transport.version});this.version=createHash('sha256').update(canonicalJson([this.boundedRequest,keyFingerprint])).digest('hex');}
 async quote(request:ResearchRequest){if(request.providerId!==this.id||request.maxResults!==1||request.sourceReferences.length)throw new PlatformDenied('GEMINI_TEXT_ONLY_RESEARCH_REQUEST_REQUIRED');return this.transport.quote();}
 async start(request:ResearchRequest,options:{idempotencyKey:string;maximumCostCents:number;execution?:ResearchExecutionContext}){const e=options.execution,requestHash=createHash('sha256').update(canonicalJson(request)).digest('hex');if(!e||e.requestHash!==requestHash||!/^[a-f0-9]{64}$/.test(e.planHash)||!e.tenantId||!e.clientId||!e.actorId||!e.jobId||!/^[1-9]\d{0,31}$/.test(e.appId))throw new PlatformDenied('GEMINI_TRUSTED_JOB_EXECUTOR_REQUIRED');await e.assertCurrent();const receipt=await this.transport.execute(request,{idempotencyKey:options.idempotencyKey,maximumCostCents:options.maximumCostCents,assertCurrent:e.assertCurrent});return {providerJobId:'local_'+options.idempotencyKey,inlineReceipt:geminiInlineReceiptSchema.parse(receipt)};}
 async status(_providerJobId:string):Promise<{state:'RUNNING'}>{return {state:'RUNNING'};}
 async abort(_providerJobId:string){return {confirmed:false};}
}
