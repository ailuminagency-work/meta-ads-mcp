import {pageVideoOwner,normalizePageVideoStatus} from "./page-video-status.js";
import {pageVideoEnabled} from "./video-flags.js";
import {createHash} from "node:crypto";
import type {ProductContract} from "./products/contracts.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {PlatformDenied} from "./models.js";
import {canonicalJson,classifyPlan} from "./policy.js";
import {assertExecutionPermit,claimMutationStep,getExecutionScope,revalidateExecutionPermit,withConnectionCredential} from "./execution.js";
import {assertContractEligibility,contractPlanParameters,productRateController} from "./clients.js";
import {applyProductTaskRequirements} from "./product-task-requirements.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
import {assertPageVideoSource,validatePageVideoInput} from "./page-video.js";
import {PAGE_VIDEO_TOOL,PAGE_VIDEO_STATUS_CONTRACT,PAGE_VIDEO_STATUS_FIELDS} from "./page-video-contract.js";
export class PageVideoClient {
 constructor(private readonly options:{fetcher?:typeof fetch}={}){}
 async request(rawContract:ProductContract,assetId:string,rawInput:Record<string,unknown>):Promise<unknown>{
  if(rawContract.tool===PAGE_VIDEO_TOOL&&!pageVideoEnabled())throw new PlatformDenied("PAGE_VIDEO_DISABLED_BY_DEPLOYMENT");
  const contract=structuredClone(rawContract),input=structuredClone(rawInput),registered=PRODUCT_CONTRACTS.find(c=>c.tool===rawContract.tool),mutation=contract.tool===PAGE_VIDEO_TOOL;
  if(!registered?.verified||![PAGE_VIDEO_TOOL,PAGE_VIDEO_STATUS_CONTRACT.tool].includes(contract.tool)||contract.provider!=="META_FACEBOOK_PAGES"||contract.method!==(mutation?"POST":"GET")||contract.path!==(mutation?"/{asset_id}/videos":"/{asset_id}")||canonicalJson(contract)!==canonicalJson(registered)||!/^\d{1,32}$/.test(assetId))throw new PlatformDenied("EXACT_PAGE_VIDEO_CONTRACT_REQUIRED");if(mutation)validatePageVideoInput(input);else if(Object.keys(input).length)throw new PlatformDenied("PAGE_VIDEO_STATUS_INPUT_FORBIDDEN");
  const permit=assertExecutionPermit({provider:"META_FACEBOOK_PAGES",mutation,tool:contract.tool}),scope=getExecutionScope(),expectedTasks=applyProductTaskRequirements(structuredClone(scope.plan),contract,scope.snapshot.assets);
  if(scope.plan.capability!==contract.id||canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,assetId,input))||canonicalJson(scope.plan.requiredScopes)!==canonicalJson(contract.requiredScopes)||canonicalJson(scope.plan.tokenTypes)!==canonicalJson(contract.tokenTypes)||canonicalJson({global:scope.plan.requiredTasks??[],scoped:scope.plan.requiredAssetTasks??[]})!==canonicalJson({global:expectedTasks.requiredTasks??[],scoped:expectedTasks.requiredAssetTasks??[]})||canonicalJson(scope.plan.classes)!==canonicalJson(classifyPlan({...scope.plan,classes:contract.operationClasses}))||(scope.plan.createOrCopy??false)!==(contract.createOrCopy??false))throw new PlatformDenied("PAGE_VIDEO_APPROVED_PLAN_MISMATCH");
  const current=()=>{const s=getExecutionScope().snapshot;assertContractEligibility(contract,s.connection);if(!mutation){const owner=pageVideoOwner(assetId,s.assets);if(s.connection.tokenType!=="page"||s.connection.subjectId!==owner.id)throw new PlatformDenied("PAGE_VIDEO_OWNER_CREDENTIAL_REQUIRED");return;}assertPageVideoSource(assetId,input,s.assets);const source=s.assets.find(a=>a.type==="MEDIA"&&a.id===input.source_media_id);if(s.connection.tokenType!=="page"||s.connection.subjectId!==assetId||source?.publicationClaim?.operationId!==permit.operationId)throw new PlatformDenied("PAGE_VIDEO_SINGLE_PUBLICATION_CLAIM_REQUIRED");};
  await revalidateExecutionPermit(permit);current();return withConnectionCredential(permit,async token=>{
   const c=getExecutionScope().snapshot.connection,bucket=createHash("sha256").update(JSON.stringify(["META_FACEBOOK_PAGES",c.appId,createHash("sha256").update(token).digest("hex")])).digest("hex"),body=new URLSearchParams({file_url:String(input.video_url),title:String(input.title),description:String(input.description),published:"true"});
   await revalidateExecutionPermit(permit);current();productRateController.bind(bucket,c.appId);productRateController.check(bucket);if(mutation)claimMutationStep(permit);
   try{const response=await(this.options.fetcher??fetch)(mutation?`https://graph-video.facebook.com/v26.0/${assetId}/videos`:`https://graph.facebook.com/v26.0/${assetId}?${new URLSearchParams({fields:PAGE_VIDEO_STATUS_FIELDS})}`,{method:mutation?"POST":"GET",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/x-www-form-urlencoded"},...(mutation?{body:body.toString()}:{}),redirect:"error",signal:AbortSignal.timeout(30000)});productRateController.observe(bucket,response,null);const value=JSON.parse(await readBodyWithLimit(response,16384)) as {id?:unknown;error?:{code?:unknown}};productRateController.observe(bucket,response,typeof value?.error?.code==="number"?value.error.code:null);if(!response.ok||value.error)throw new Error();if(!mutation){await revalidateExecutionPermit(permit);current();return normalizePageVideoStatus(value,assetId,pageVideoOwner(assetId,getExecutionScope().snapshot.assets).id);}if(typeof value.id!=="string"||!/^\d{1,32}$/.test(value.id))throw new Error();return {id:value.id};}catch{throw new PlatformDenied(mutation?"PAGE_VIDEO_OUTCOME_UNKNOWN_DO_NOT_RETRY":"PAGE_VIDEO_STATUS_READ_UNVERIFIED");}
  });
 }
}
