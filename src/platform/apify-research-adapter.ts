import type {ResearchAdapter,ResearchRequest,ResearchExecutionContext} from './research-job-types.js';
import {ApifyPublicAdsTransport,type ApifyAcquisitionPolicy,hashToken} from './apify-public-ads.js';
import {PlatformDenied} from './models.js';
import {ResearchAdapterRegistry} from './research-adapters.js';
import {canonicalJson} from './policy.js';
export class ApifyPublicAdsAdapter implements ResearchAdapter{
 readonly id='apify_public_ads';readonly version:string;readonly coverage='Public Meta Ad Library search observations; incomplete, no performance or outcome proof';
 readonly controls=Object.freeze({quoteFree:true as const,statusFree:true as const,abortNoAdditionalCharge:true as const,hardSpendCap:true,idempotencyKeys:false});readonly acquisitionRequest;
 private readonly transport:ApifyPublicAdsTransport;
 constructor(policy:ApifyAcquisitionPolicy,fingerprint:string,token:()=>Promise<string>,fetcher:typeof fetch=fetch,now:()=>number=Date.now,current:()=>boolean=()=>true){this.transport=new ApifyPublicAdsTransport(policy,token,fetcher,now,current,fingerprint);this.version=this.transport.version;this.acquisitionRequest=Object.freeze({mode:'APIFY_SYNC_PUBLIC_ADS' as const,providerHardRunCostCap:true as const,providerIdempotency:false as const,maximumResults:policy.maximumResults,maximumRunCostCents:policy.maximumRunCostCents,policyHash:this.version});}
 async quote(request:ResearchRequest){return this.transport.quote(request);}
 async start(request:ResearchRequest,options:{idempotencyKey:string;maximumCostCents:number;execution?:ResearchExecutionContext}){if(!options.execution)throw new PlatformDenied('APIFY_TRUSTED_ONCE_ONLY_JOB_REQUIRED');const receipt=await this.transport.execute(request,{...options,execution:options.execution});return {providerJobId:'local_'+options.idempotencyKey,inlineReceipt:receipt};}
 async status(_providerJobId:string):Promise<{state:'RUNNING'}>{throw new PlatformDenied('APIFY_LOCAL_ONLY_STATUS_INVOICE_RECONCILIATION_REQUIRED');}
 async abort(_providerJobId:string){return {confirmed:false};}
}
type Environment=Record<string,string|undefined>;
export function apifyAcquisitionEnabled(env:Environment=process.env){const f=env.LUMIN_APIFY_PUBLIC_ADS_ENABLED;if(f!==undefined&&!['true','false'].includes(f))throw new PlatformDenied('APIFY_INVALID_FEATURE_FLAG');return env.LUMIN_PLATFORM_ENABLED==='true'&&env.LUMIN_PAID_RESEARCH_ENABLED==='true'&&f==='true';}
export function createEnvironmentApifyPublicAdsAdapter(env:Environment=process.env,fetcher:typeof fetch=fetch):ApifyPublicAdsAdapter|undefined{if(!apifyAcquisitionEnabled(env))return undefined;const raw=env.LUMIN_APIFY_PUBLIC_ADS_POLICY_JSON,key=env.LUMIN_APIFY_API_KEY;if(!raw||Buffer.byteLength(raw)>4096||!key)throw new PlatformDenied('APIFY_HUMAN_REVIEWED_ENVIRONMENT_REQUIRED');let policy:ApifyAcquisitionPolicy;try{policy=JSON.parse(raw);}catch{throw new PlatformDenied('APIFY_HUMAN_REVIEWED_ENVIRONMENT_REQUIRED');}const initial=hashToken(canonicalJson([raw,key])),current=()=>apifyAcquisitionEnabled(env)&&hashToken(canonicalJson([env.LUMIN_APIFY_PUBLIC_ADS_POLICY_JSON??null,env.LUMIN_APIFY_API_KEY??null]))===initial;return new ApifyPublicAdsAdapter(policy,hashToken(key),async()=>{if(!current())throw new PlatformDenied('APIFY_CONFIGURATION_CHANGED_REAPPROVAL_REQUIRED');return env.LUMIN_APIFY_API_KEY!;},fetcher,Date.now,current);}
export function initializeApifyResearchAdapter(registry:ResearchAdapterRegistry,env:Environment=process.env){if(!apifyAcquisitionEnabled(env))return;const adapter=createEnvironmentApifyPublicAdsAdapter(env)!;const prior=registry.get(adapter.id);if(prior){if(prior.version!==adapter.version)throw new PlatformDenied('APIFY_CONFIGURATION_CHANGED_RESTART_REVIEW_REQUIRED');return;}registry.registerAcquisitionOneAttempt(adapter);}
