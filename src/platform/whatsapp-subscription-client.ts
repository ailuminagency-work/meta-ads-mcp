import {clientBusinessBound} from "./client-business.js";
import {assertWhatsAppOwnerOperational} from "./whatsapp-operational-policy.js";
import {z} from "zod";
import {createHash} from "node:crypto";
import {PlatformDenied} from "./models.js";
import {PRODUCT_CONTRACTS,type ProductContract} from "./products/contracts.js";
import {WHATSAPP_SUBSCRIPTION_CONTRACTS} from "./whatsapp-subscription-contracts.js";
import {assertExecutionPermit,getExecutionScope,revalidateExecutionPermit,withConnectionCredential,claimMutationStep} from "./execution.js";
import {assertContractEligibility,contractPlanParameters,productRateController} from "./clients.js";
import {canonicalJson} from "./policy.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
const id=z.string().regex(/^\d{1,100}$/);
export class WhatsAppSubscriptionClient{
 constructor(private readonly options:{getAppSecret(appId:string):Promise<string>;fetcher?:typeof fetch}){}
 async request(contract:ProductContract,assetId:string,input:Record<string,unknown>):Promise<unknown>{
  const known=PRODUCT_CONTRACTS.find(c=>c.tool===contract.tool&&c.provider==="META_WHATSAPP"&&WHATSAPP_SUBSCRIPTION_CONTRACTS.some(raw=>raw.tool===c.tool));if(!known||canonicalJson(contract)!==canonicalJson(known)||!id.safeParse(assetId).success||Object.keys(input).length)throw new PlatformDenied("EXACT_WHATSAPP_SUBSCRIPTION_CONTRACT_REQUIRED");
  const mutation=contract.method!=="GET",permit=assertExecutionPermit({provider:"META_WHATSAPP",tool:contract.tool,mutation}),scope=getExecutionScope(),c=scope.snapshot.connection;
  if(canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,assetId,input))||scope.plan.capability!==contract.id||canonicalJson(scope.plan.classes)!==canonicalJson(contract.operationClasses)||canonicalJson(scope.plan.requiredScopes)!==canonicalJson(contract.requiredScopes)||canonicalJson(scope.plan.tokenTypes)!==canonicalJson(contract.tokenTypes))throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_PLAN_REQUIRED");
  const account=scope.snapshot.assets.filter(a=>a.type==="MESSAGING_ACCOUNT"&&a.id===assetId),waacs=scope.snapshot.assets.filter(a=>a.type==="WHATSAPP_ACCOUNT"),e=c.whatsappAssignmentEvidence;
  if(account.length!==1||waacs.length!==1||c.tokenType!=="business_integration_system_user"||!c.subjectId||!c.clientBusinessId||!clientBusinessBound(scope.snapshot.client,c.clientBusinessId,Date.now(),scope.snapshot.businessOwnerEvidence,c.appId)||!e||e.source!=="META_BUSINESS_SUITE_OWNER_REVIEW"||e.dualAccountAssignment!==true||e.tenantId!==scope.context.principal.tenantId||e.clientId!==scope.context.clientId||e.appId!==c.appId||e.messagingAccountId!==assetId||e.whatsappAccountId!==waacs[0].id||account[0].provider!==c.provider||account[0].appId!==c.appId||!account[0].parents.some(p=>p.type==="WHATSAPP_ACCOUNT"&&p.id===waacs[0].id))throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_CLIENT_CLOSURE_REQUIRED");
  const current=async()=>{await revalidateExecutionPermit(permit);const now=Date.now();assertContractEligibility(contract,c);assertWhatsAppOwnerOperational(c,mutation,now);};
  await current();return withConnectionCredential(permit,async token=>{assertWhatsAppOwnerOperational(c,mutation,Date.now(),token);
   let secret:string;try{secret=await this.options.getAppSecret(c.appId);}catch{throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_APP_SECRET_REQUIRED");}if(!secret||/[|\s\x00-\x1f\x7f]/.test(secret))throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_APP_SECRET_REQUIRED");
   const bucket=createHash("sha256").update(JSON.stringify(["META_WHATSAPP",c.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");
   const request=async(path:string,query:Record<string,string>,method:"GET"|"POST"|"DELETE"="GET",bearer=token)=>{
    await current();productRateController.bind(bucket,c.appId);productRateController.check(bucket);const url=new URL("https://graph.facebook.com/v26.0"+path);url.search=new URLSearchParams(query).toString();if(method!=="GET")claimMutationStep(permit);
    let response:Response;try{response=await(this.options.fetcher??fetch)(url,{method,headers:{Authorization:`Bearer ${bearer}`,"Content-Type":"application/json"},...(method==="POST"?{body:"{}"}:{}),redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_OUTCOME_UNCERTAIN");}
    productRateController.observe(bucket,response,null);let body:unknown;try{body=JSON.parse(await readBodyWithLimit(response,65536));}catch{throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_RESPONSE_INVALID");}if(!response.ok||!body||typeof body!=="object"||Array.isArray(body)||"error"in body)throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_OUTCOME_UNCERTAIN");return body;
   };
   const debug=z.object({data:z.object({is_valid:z.literal(true),app_id:z.union([id,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),user_id:id,scopes:z.array(z.string()).max(100),granular_scopes:z.array(z.object({scope:z.string(),target_ids:z.array(id).max(100)})).max(100)})}).parse(await request("/debug_token",{input_token:token},"GET",`${c.appId}|${secret}`)).data;
   if(String(debug.app_id)!==c.appId||debug.user_id!==c.subjectId||new Set(debug.scopes).size!==debug.scopes.length||canonicalJson([...debug.scopes].sort())!==canonicalJson([...c.scopes].sort())||!debug.granular_scopes.some(g=>g.scope==="whatsapp_business_management"&&g.target_ids.includes(assetId)))throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_ACTUAL_GRANT_REQUIRED");
   const me=z.object({id,client_business_id:id}).parse(await request("/me",{fields:"client_business_id"}));if(me.id!==c.subjectId||me.client_business_id!==c.clientBusinessId)throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_ACTUAL_BUSINESS_REQUIRED");
   const response=await request(`/${assetId}/subscribed_apps`,{},contract.method);
   if(contract.method!=="GET"){const receipt=z.object({success:z.literal(true)}).parse(response);return {success:receipt.success};}
   const list=z.object({data:z.array(z.object({whatsapp_business_api_data:z.object({id})})).max(100),paging:z.object({next:z.unknown().optional()}).optional()}).parse(response);
   if(list.paging?.next)throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_LIST_INCOMPLETE_HOLD");const ids=list.data.map(r=>r.whatsapp_business_api_data.id);if(new Set(ids).size!==ids.length)throw new PlatformDenied("WHATSAPP_SUBSCRIPTION_RESPONSE_INVALID");await current();return {app_id:c.appId,subscribed:ids.includes(c.appId),other_apps_withheld:ids.filter(value=>value!==c.appId).length,delivery_verified:false};
  });
 }
}
