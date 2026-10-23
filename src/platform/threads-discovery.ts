import {createHash} from "node:crypto";
import {z} from "zod";
import {PlatformDenied} from "./models.js";
import type {ProductContract} from "./products/contracts.js";
import {assertExecutionPermit,getExecutionScope,revalidateExecutionPermit,withConnectionCredential} from "./execution.js";
import {assertContractEligibility,contractPlanParameters,productRateController,productVersion,validateContractParameters} from "./clients.js";
import {canonicalJson} from "./policy.js";

import {readBodyWithLimit} from "../utils/bounded-body.js";
export {THREADS_DISCOVERY_TOOLS,THREADS_DISCOVERY_CONTRACTS,THREADS_DISCOVERY_QUERY,validateThreadsDiscoveryInput,normalizeThreadsDiscovery} from "./threads-discovery-contracts.js";
import {THREADS_DISCOVERY_TOOLS,THREADS_DISCOVERY_QUERY,validateThreadsDiscoveryInput,normalizeThreadsDiscovery} from "./threads-discovery-contracts.js";
export class ThreadsDiscoveryClient{
 constructor(private readonly fetcher:typeof fetch=fetch){}
 async request(contract:ProductContract,assetId:string,input:Record<string,unknown>):Promise<unknown>{
  if(!THREADS_DISCOVERY_TOOLS.includes(contract.tool)||contract.provider!=="META_THREADS"||!contract.verified)throw new PlatformDenied("THREADS_DISCOVERY_CONTRACT_REQUIRED");
  validateThreadsDiscoveryInput(contract.tool,input);validateContractParameters(contract,input);
  const permit=assertExecutionPermit({provider:"META_THREADS",tool:contract.tool}),scope=getExecutionScope(),connection=scope.snapshot.connection;
  if(connection.tokenType!=="threads"||connection.subjectId!==assetId||scope.plan.capability!==contract.id||canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,assetId,input))||scope.snapshot.assets.filter(a=>a.id===assetId&&a.type==="THREADS_ACCOUNT"&&a.provider==="META_THREADS"&&a.appId===connection.appId).length!==1)throw new PlatformDenied("THREADS_DISCOVERY_SUBJECT_REQUIRED");
  return withConnectionCredential(permit,async token=>{
   const bucket=createHash("sha256").update(JSON.stringify([connection.provider,connection.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");
   const read=async(path:string,query:Record<string,string>)=>{await revalidateExecutionPermit(permit);assertContractEligibility(contract,connection);productRateController.bind(bucket,connection.appId);productRateController.check(bucket);const url=new URL(`/${productVersion("META_THREADS")}${path}`,"https://graph.threads.com");url.search=new URLSearchParams(query).toString();let response:Response;try{response=await this.fetcher(url,{method:"GET",headers:{Authorization:`Bearer ${token}`},redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new PlatformDenied("THREADS_DISCOVERY_TRANSPORT_HOLD");}productRateController.observe(bucket,response,null);let body:unknown;try{body=JSON.parse(await readBodyWithLimit(response,131072));}catch{throw new PlatformDenied("THREADS_DISCOVERY_RESPONSE_HOLD");}if(!response.ok||!body||typeof body!=="object"||"error"in body)throw new PlatformDenied("THREADS_DISCOVERY_PROVIDER_HOLD");await revalidateExecutionPermit(permit);assertContractEligibility(contract,connection);return body;};
   const subject=z.object({id:z.literal(assetId)}).safeParse(await read("/me",{fields:"id"}));if(!subject.success)throw new PlatformDenied("THREADS_DISCOVERY_ACTUAL_SUBJECT_REQUIRED");
   const limit=Number(input.limit??25),query={fields:THREADS_DISCOVERY_QUERY.fields,limit:String(limit),...(contract.tool==="threads_keyword_search"?{q:String(input.q),search_type:String(input.search_type??"TOP")}:{} )};
   return normalizeThreadsDiscovery(await read(contract.tool==="threads_keyword_search"?"/keyword_search":`/${assetId}/mentions`,query),limit);
  });
 }
}
