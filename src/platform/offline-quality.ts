import {createHash} from "node:crypto";
import type {ProductContract} from "./products/contracts.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {OFFLINE_QUALITY_TOOL} from "./offline-quality-contract.js";
import {PlatformDenied} from "./models.js";
import {canonicalJson} from "./policy.js";
import {assertExecutionPermit,getExecutionScope,revalidateExecutionPermit,withConnectionCredential} from "./execution.js";

import {assertContractEligibility,contractPlanParameters,productRateController} from "./clients.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
export function normalizeOfflineQuality(body:unknown){
 if(!body||typeof body!=="object"||Array.isArray(body)||"error"in body||!("offline"in body)||!Array.isArray(body.offline)||body.offline.length>100)throw new PlatformDenied("OFFLINE_QUALITY_RESPONSE_INVALID");
 const score=(value:unknown)=>{if(value===undefined)return null;if(!value||typeof value!=="object"||Array.isArray(value)||!("score"in value)||typeof value.score!=="number"||!Number.isFinite(value.score)||value.score<0||value.score>10)throw new PlatformDenied("OFFLINE_QUALITY_SCORE_INVALID");return value.score;};
 const known=new Set(["Purchase","Lead","CompleteRegistration","Schedule","ViewContent","Search","AddToCart","AddToWishlist","InitiateCheckout","AddPaymentInfo","Other"]);
 const events=body.offline.map(row=>{if(!row||typeof row!=="object"||Array.isArray(row)||typeof row.event_name!=="string"||!row.event_name||row.event_name.length>100)throw new PlatformDenied("OFFLINE_QUALITY_RESPONSE_INVALID");return {event:known.has(row.event_name)?row.event_name:"CUSTOM_EVENT_NAME_WITHHELD",composite:score(row.composite),match_key:score(row.match_key),frequency:score(row.frequency),freshness:score(row.freshness)};});
 return {observation:"PROVIDER_OFFLINE_EVENT_QUALITY",events,empty:events.length===0,missing_values:"UNKNOWN_NOT_ZERO",health_certification:"NOT_ESTABLISHED",omnichannel_eligibility:"NOT_ESTABLISHED",limitations:"Provider scores only; no raw events, customer identities, provider recommendations, attribution or end-to-end delivery certification."};
}
export class OfflineQualityClient{
 constructor(private readonly fetcher:typeof fetch=fetch){}
 async request(contract:ProductContract,assetId:string,input:Record<string,unknown>){
 contract=structuredClone(contract);input=structuredClone(input);
 const canonical=PRODUCT_CONTRACTS.find(c=>c.tool===OFFLINE_QUALITY_TOOL);if(!canonical||canonicalJson(canonical)!==canonicalJson(contract)||!/^\d{1,100}$/.test(assetId)||Object.keys(input).length)throw new PlatformDenied("OFFLINE_QUALITY_EXACT_CONTRACT_REQUIRED");const permit=assertExecutionPermit({provider:"META_MARKETING",tool:OFFLINE_QUALITY_TOOL,mutation:false}),scope=getExecutionScope();
 if(scope.plan.capability!==contract.id||canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,assetId,input))||canonicalJson(scope.plan.classes)!==canonicalJson(["READ"])||canonicalJson(scope.plan.requiredScopes)!==canonicalJson(contract.requiredScopes)||canonicalJson(scope.plan.tokenTypes)!==canonicalJson(contract.tokenTypes)||scope.plan.requiredTasks?.length||scope.plan.requiredAssetTasks?.length||!scope.snapshot.assets.some(a=>a.type==="PIXEL"&&a.id===assetId&&a.clientId===scope.context.clientId&&a.appId===scope.snapshot.connection.appId))throw new PlatformDenied("OFFLINE_QUALITY_APPROVED_PLAN_REQUIRED");
 await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);return withConnectionCredential(permit,async token=>{const bucket=createHash("sha256").update(JSON.stringify(["META_MARKETING",scope.snapshot.connection.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");productRateController.bind(bucket,scope.snapshot.connection.appId);productRateController.check(bucket);await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);const url=new URL("https://graph.facebook.com/v26.0/dataset_quality");url.search=new URLSearchParams({dataset_id:assetId,fields:"offline"}).toString();let response:Response;try{response=await this.fetcher(url,{method:"GET",redirect:"error",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});}catch{throw new PlatformDenied("OFFLINE_QUALITY_PROVIDER_UNAVAILABLE");}productRateController.observe(bucket,response,null);let raw:unknown;try{raw=JSON.parse(await readBodyWithLimit(response,64000));}catch{throw new PlatformDenied("OFFLINE_QUALITY_RESPONSE_INVALID");}if(!response.ok)throw new PlatformDenied("OFFLINE_QUALITY_PROVIDER_ACCESS_REQUIRED");const result=normalizeOfflineQuality(raw);await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);return result;});
 }
}
