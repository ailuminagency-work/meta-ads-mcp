import {clientBusinessBound} from "./client-business.js";
import {assertWhatsAppOwnerOperational} from "./whatsapp-operational-policy.js";
import {assertNoCredentialShapedString} from "./input-safety.js";
import {redactCredentials} from "./product-private-response.js";
import {resolveAuthorizedAssets} from "./assets.js";
import {selectConnection} from "./connections.js";
import type {PlatformRepository} from "./repository.js";
import {z} from "zod";
import {createHash} from "node:crypto";
import {PlatformDenied} from "./models.js";
import {PRODUCT_CONTRACTS,type ProductContract} from "./products/contracts.js";
import {WHATSAPP_PHONE_CONTRACTS,validateWhatsAppPhoneParameters,whatsappProfileSchema} from "./whatsapp-phone-contracts.js";
import {assertExecutionPermit,getExecutionScope,revalidateExecutionPermit,withConnectionCredential,claimMutationStep} from "./execution.js";
import {assertContractEligibility,contractPlanParameters,productRateController} from "./clients.js";
import {canonicalJson} from "./policy.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
const id=z.string().regex(/^\d{1,32}$/),phone=z.object({id,verified_name:z.string().max(512).optional(),quality_rating:z.string().max(32).optional(),code_verification_status:z.string().max(40).optional()});
function redactOutput<T>(value:T):T{if(typeof value==="string"){const clean=redactCredentials(value);assertNoCredentialShapedString(clean);return clean as T;}if(Array.isArray(value))return value.map(redactOutput) as T;if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redactOutput(item)])) as T;return value;}
export class WhatsAppPhoneClient{
 constructor(private readonly options:{repository:PlatformRepository;getAppSecret(appId:string):Promise<string>;fetcher?:typeof fetch}){}
 async request(contract:ProductContract,assetId:string,input:Record<string,unknown>):Promise<unknown>{
  contract=structuredClone(contract);input=structuredClone(input);validateWhatsAppPhoneParameters(contract.tool,input);
  const known=PRODUCT_CONTRACTS.find(c=>c.tool===contract.tool&&c.provider==="META_WHATSAPP"&&WHATSAPP_PHONE_CONTRACTS.some(raw=>raw.tool===c.tool));if(!known||canonicalJson(contract)!==canonicalJson(known)||!id.safeParse(assetId).success)throw new PlatformDenied("EXACT_WHATSAPP_PHONE_CONTRACT_REQUIRED");
  const mutation=contract.method!=="GET",permit=assertExecutionPermit({provider:"META_WHATSAPP",tool:contract.tool,mutation}),scope=getExecutionScope(),c=scope.snapshot.connection;
  if(canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,assetId,input))||scope.plan.capability!==contract.id||canonicalJson(scope.plan.classes)!==canonicalJson(contract.operationClasses)||canonicalJson(scope.plan.requiredScopes)!==canonicalJson(contract.requiredScopes)||canonicalJson(scope.plan.tokenTypes)!==canonicalJson(contract.tokenTypes))throw new PlatformDenied("WHATSAPP_PHONE_PLAN_REQUIRED");
  const account=scope.snapshot.assets.filter(a=>a.type==="MESSAGING_ACCOUNT"),waacs=scope.snapshot.assets.filter(a=>a.type==="WHATSAPP_ACCOUNT"),target=scope.snapshot.assets.filter(a=>a.id===assetId&&a.type===contract.assetType),e=c.whatsappAssignmentEvidence;
  if(target.length!==1||account.length!==1||waacs.length!==1||c.tokenType!=="business_integration_system_user"||!c.subjectId||!c.clientBusinessId||!clientBusinessBound(scope.snapshot.client,c.clientBusinessId,Date.now(),scope.snapshot.businessOwnerEvidence,c.appId)||!e||e.source!=="META_BUSINESS_SUITE_OWNER_REVIEW"||e.dualAccountAssignment!==true||e.tenantId!==scope.context.principal.tenantId||e.clientId!==scope.context.clientId||e.appId!==c.appId||e.messagingAccountId!==account[0].id||e.whatsappAccountId!==waacs[0].id||account[0].provider!==c.provider||account[0].appId!==c.appId||!account[0].parents.some(p=>p.type==="WHATSAPP_ACCOUNT"&&p.id===waacs[0].id)||(target[0].type==="WHATSAPP_PHONE"&&(!target[0].parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===account[0].id)||!target[0].parents.some(p=>p.type==="WHATSAPP_ACCOUNT"&&p.id===waacs[0].id))))throw new PlatformDenied("WHATSAPP_PHONE_CLIENT_CLOSURE_REQUIRED");
  const current=async()=>{await revalidateExecutionPermit(permit);const now=Date.now();assertContractEligibility(contract,c);assertWhatsAppOwnerOperational(c,mutation,now);};
  await current();return withConnectionCredential(permit,async token=>{assertWhatsAppOwnerOperational(c,mutation,Date.now(),token);
   let secret:string;try{secret=await this.options.getAppSecret(c.appId);}catch{throw new PlatformDenied("WHATSAPP_PHONE_APP_SECRET_REQUIRED");}if(!secret||/[|\s\x00-\x1f\x7f]/.test(secret))throw new PlatformDenied("WHATSAPP_PHONE_APP_SECRET_REQUIRED");
   const bucket=createHash("sha256").update(JSON.stringify(["META_WHATSAPP",c.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");
   const request=async(path:string,query:Record<string,string>,method:"GET"|"POST"|"DELETE"="GET",body?:Record<string,unknown>,bearer=token)=>{
    await current();productRateController.bind(bucket,c.appId);productRateController.check(bucket);const url=new URL("https://graph.facebook.com/v26.0"+path);url.search=new URLSearchParams(query).toString();if(method!=="GET")claimMutationStep(permit);
    let response:Response;try{response=await(this.options.fetcher??fetch)(url,{method,headers:{Authorization:`Bearer ${bearer}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new PlatformDenied("WHATSAPP_PHONE_OUTCOME_UNCERTAIN");}
    productRateController.observe(bucket,response,null);let parsed:unknown;try{parsed=JSON.parse(await readBodyWithLimit(response,131072));}catch{throw new PlatformDenied("WHATSAPP_PHONE_RESPONSE_INVALID");}if(!response.ok||!parsed||typeof parsed!=="object"||Array.isArray(parsed)||"error"in parsed)throw new PlatformDenied("WHATSAPP_PHONE_OUTCOME_UNCERTAIN");return parsed;
   };
   const debug=z.object({data:z.object({is_valid:z.literal(true),app_id:z.union([id,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),user_id:id,scopes:z.array(z.string()).max(100),granular_scopes:z.array(z.object({scope:z.string(),target_ids:z.array(id).max(100)})).max(100)})}).parse(await request("/debug_token",{input_token:token},"GET",undefined,`${c.appId}|${secret}`)).data;
   if(String(debug.app_id)!==c.appId||debug.user_id!==c.subjectId||new Set(debug.scopes).size!==debug.scopes.length||canonicalJson([...debug.scopes].sort())!==canonicalJson([...c.scopes].sort())||contract.requiredScopes.some(required=>!debug.granular_scopes.some(g=>g.scope===required&&g.target_ids.includes(account[0].id))))throw new PlatformDenied("WHATSAPP_PHONE_ACTUAL_GRANT_REQUIRED");
   const me=z.object({id,client_business_id:id}).parse(await request("/me",{fields:"client_business_id"}));if(me.id!==c.subjectId||me.client_business_id!==c.clientBusinessId)throw new PlatformDenied("WHATSAPP_PHONE_ACTUAL_BUSINESS_REQUIRED");
   const rows=z.object({data:z.array(phone).max(100),paging:z.object({next:z.unknown().optional()}).optional()}).parse(await request(`/${account[0].id}/phone_numbers`,{fields:"id,verified_name,quality_rating,code_verification_status",limit:"100"}));
   if(new Set(rows.data.map(row=>row.id)).size!==rows.data.length)throw new PlatformDenied("WHATSAPP_PHONE_DUPLICATE_ID_HOLD");
   if(contract.tool==="whatsapp_platform_list_phones"){
    const data:typeof rows.data=[],read=PRODUCT_CONTRACTS.find(candidate=>candidate.tool==="whatsapp_platform_get_phone")!;
    for(const row of rows.data){try{const ctx={...scope.context,tool:read.tool},assets=await resolveAuthorizedAssets(this.options.repository,ctx,[{type:"WHATSAPP_PHONE",id:row.id}]),child=assets.find(a=>a.type==="WHATSAPP_PHONE"&&a.id===row.id);if(!child?.parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===account[0].id)||!child.parents.some(p=>p.type==="WHATSAPP_ACCOUNT"&&p.id===waacs[0].id))continue;await selectConnection(this.options.repository,ctx,{parameters:contractPlanParameters(read,row.id,{}),assets:[{type:"WHATSAPP_PHONE",id:row.id}],classes:read.operationClasses,capability:read.id,requiredScopes:read.requiredScopes,tokenTypes:read.tokenTypes},assets,Date.now(),c.id);data.push(row);}catch(error){if(!(error instanceof PlatformDenied))throw error;}}
    await current();return {data:redactOutput(data),withheld_rows:rows.data.length-data.length,complete_inventory:false,authority_change:false};
   }
   const matches=rows.data.filter(row=>row.id===assetId);if(matches.length!==1)throw new PlatformDenied("WHATSAPP_PHONE_ACTUAL_PARENT_REQUIRED");
   if(contract.tool==="whatsapp_platform_get_phone"){await current();return redactOutput({...matches[0]});}
   if(contract.tool==="whatsapp_platform_get_profile"){
    const profile=whatsappProfileSchema.extend({email:z.string().max(254).optional(),vertical:z.string().max(40).optional(),messaging_product:z.literal("whatsapp").optional()}).strip(),result=z.object({data:z.array(profile).length(1)}).parse(await request(`/${assetId}/whatsapp_business_profile`,contract.fixedQuery??{}));await current();return redactOutput(result);
   }
   await current();return z.object({success:z.literal(true)}).parse(await request(`/${assetId}/whatsapp_business_profile`,{},"POST",{...input,messaging_product:"whatsapp"}));
  });
 }
}
