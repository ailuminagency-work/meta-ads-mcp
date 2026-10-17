import {clientBusinessBound} from "./client-business.js";
import {assertWhatsAppOwnerOperational} from "./whatsapp-operational-policy.js";
import {resolveAuthorizedAssets} from "./assets.js";
import {selectConnection} from "./connections.js";
import {createHash} from "node:crypto";
import {z} from "zod";
import {PlatformDenied} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {PRODUCT_CONTRACTS,type ProductContract} from "./products/contracts.js";
import {WHATSAPP_FLOW_CONTRACTS,WHATSAPP_FLOW_TOOLS} from "./whatsapp-flow-contracts.js";
import {validateWhatsAppFlowParameters,validateStaticWhatsAppFlowJson} from "./whatsapp-flow-json.js";
import {assertExecutionPermit,getExecutionScope,revalidateExecutionPermit,claimMutationStep,withConnectionCredential} from "./execution.js";
import {canonicalJson} from "./policy.js";
import {assertContractEligibility,contractPlanParameters,productRateController} from "./clients.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
const id=z.string().regex(/^\d{1,32}$/),statuses=z.enum(["DRAFT","PUBLISHED","DEPRECATED","BLOCKED","THROTTLED"]);
const flowSchema=z.object({id,name:z.string().max(200).optional(),status:statuses,whatsapp_business_account:z.object({id}),application:z.object({id}),validation_errors:z.array(z.unknown()).max(100),json_version:z.string().max(20).optional()});
/** Fixed endpoint, bounded, one-attempt egress. No dynamic endpoint, token import,
 * cloning, provider-next URL, sending, subscription or billing mutation. */
export class WhatsAppFlowClient{
 constructor(private readonly options:{repository:PlatformRepository;getAppSecret(appId:string):Promise<string>;fetcher?:typeof fetch}){}
 async request(contract:ProductContract,assetId:string,input:Record<string,unknown>={}):Promise<unknown>{
  contract=structuredClone(contract);input=structuredClone(input);validateWhatsAppFlowParameters(contract.tool,input);
  const known=PRODUCT_CONTRACTS.find(c=>c.tool===contract.tool&&c.provider==="META_WHATSAPP"&&WHATSAPP_FLOW_CONTRACTS.some(raw=>raw.tool===c.tool));
  if(!known||!WHATSAPP_FLOW_TOOLS.includes(contract.tool)||canonicalJson(known)!==canonicalJson(contract)||!id.safeParse(assetId).success)throw new PlatformDenied("EXACT_WHATSAPP_FLOW_CONTRACT_REQUIRED");
  const mutation=contract.method!=="GET",permit=assertExecutionPermit({provider:"META_WHATSAPP",tool:contract.tool,mutation}),scope=getExecutionScope();
  if(scope.plan.capability!==contract.id||canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,assetId,input))||canonicalJson(scope.plan.requiredScopes)!==canonicalJson(contract.requiredScopes)||canonicalJson(scope.plan.tokenTypes)!==canonicalJson(contract.tokenTypes)||canonicalJson(scope.plan.classes)!==canonicalJson(contract.operationClasses))throw new PlatformDenied("APPROVED_WHATSAPP_FLOW_PLAN_REQUIRED");
  const target=scope.snapshot.assets.find(a=>a.id===assetId&&a.type===contract.assetType),accounts=scope.snapshot.assets.filter(a=>a.type==="MESSAGING_ACCOUNT"),waacs=scope.snapshot.assets.filter(a=>a.type==="WHATSAPP_ACCOUNT");
  const c=scope.snapshot.connection,e=c.whatsappAssignmentEvidence;
  if(!target||accounts.length!==1||waacs.length!==1||c.provider!=="META_WHATSAPP"||c.tokenType!=="business_integration_system_user"||!c.subjectId||!c.clientBusinessId||!clientBusinessBound(scope.snapshot.client,c.clientBusinessId,Date.now(),scope.snapshot.businessOwnerEvidence,c.appId)||!e||e.tenantId!==scope.context.principal.tenantId||e.clientId!==scope.context.clientId||e.appId!==c.appId||e.messagingAccountId!==accounts[0].id||e.whatsappAccountId!==waacs[0].id||e.source!=="META_BUSINESS_SUITE_OWNER_REVIEW"||e.dualAccountAssignment!==true||!accounts[0].parents.some(p=>p.type==="WHATSAPP_ACCOUNT"&&p.id===waacs[0].id)||(target.type==="FLOW"&&!target.parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===accounts[0].id)))throw new PlatformDenied("EXACT_WHATSAPP_CLIENT_FLOW_CLOSURE_REQUIRED");
  const current=async()=>{await revalidateExecutionPermit(permit);const now=Date.now();assertContractEligibility(contract,c);assertWhatsAppOwnerOperational(c,mutation,now);};
  await current();
  return withConnectionCredential(permit,async token=>{assertWhatsAppOwnerOperational(c,mutation,Date.now(),token);
   const bucket=createHash("sha256").update(JSON.stringify(["META_WHATSAPP",c.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");
   const fetcher=this.options.fetcher??fetch;
   const request=async(path:string,query:Record<string,string>,init:RequestInit={}):Promise<unknown>=>{
    await current();productRateController.bind(bucket,c.appId);productRateController.check(bucket);const url=new URL("https://graph.facebook.com/v26.0"+path);url.search=new URLSearchParams(query).toString();
    if(init.method&&init.method!=="GET")claimMutationStep(permit);let response:Response;try{response=await fetcher(url,{...init,method:init.method??"GET",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,...Object.fromEntries(new Headers(init.headers).entries())}});}catch{throw new PlatformDenied("WHATSAPP_FLOW_PROVIDER_OUTCOME_UNCERTAIN");}
    productRateController.observe(bucket,response,null);const text=await readBodyWithLimit(response,131072);let body:unknown;try{body=JSON.parse(text);}catch{throw new PlatformDenied("WHATSAPP_FLOW_PROVIDER_SCHEMA_INVALID");}if(!response.ok||!body||typeof body!=="object"||Array.isArray(body)||"error"in body)throw new PlatformDenied("WHATSAPP_FLOW_PROVIDER_OUTCOME_UNCERTAIN");return body;
   };
   let secret:string;try{secret=await this.options.getAppSecret(c.appId);}catch{throw new PlatformDenied("WHATSAPP_APP_SECRET_REQUIRED");}if(!secret||/[|\s\x00-\x1f\x7f]/.test(secret))throw new PlatformDenied("WHATSAPP_APP_SECRET_REQUIRED");
   const debug=z.object({data:z.object({is_valid:z.literal(true),app_id:z.union([id,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),user_id:id,scopes:z.array(z.string()).max(100),granular_scopes:z.array(z.object({scope:z.string(),target_ids:z.array(id).min(1).max(100)})).max(100)})}).parse(await request("/debug_token",{input_token:token},{headers:{Authorization:`Bearer ${c.appId}|${secret}`}})).data;
   if(String(debug.app_id)!==c.appId||debug.user_id!==c.subjectId||canonicalJson([...debug.scopes].sort())!==canonicalJson([...c.scopes].sort())||contract.requiredScopes.some(s=>!debug.granular_scopes.some(g=>g.scope===s&&g.target_ids.includes(accounts[0].id))))throw new PlatformDenied("WHATSAPP_FLOW_GRANULAR_SCOPE_PROOF_REQUIRED");
   const me=z.object({id,client_business_id:id}).parse(await request("/me",{fields:"client_business_id"}));if(me.id!==c.subjectId||me.client_business_id!==c.clientBusinessId)throw new PlatformDenied("WHATSAPP_FLOW_BISU_BUSINESS_REQUIRED");
   const preflight=async()=>{const f=flowSchema.parse(await request(`/${assetId}`,{fields:"id,name,status,json_version,validation_errors,whatsapp_business_account,application"}));if(f.id!==assetId||f.whatsapp_business_account.id!==accounts[0].id||f.application.id!==c.appId)throw new PlatformDenied("WHATSAPP_FLOW_ACTUAL_PARENT_APP_REQUIRED");return f;};
   if(contract.tool==="whatsapp_platform_list_flows"){
    const list=z.object({data:z.array(z.object({id,name:z.string().max(200).optional(),status:statuses})).max(100),paging:z.unknown().optional()}).parse(await request(`/${assetId}/flows`,contract.fixedQuery??{}));
    const registry=await this.options.repository.list("assets",scope.context.principal.tenantId),data:typeof list.data=[];const read=PRODUCT_CONTRACTS.find(candidate=>candidate.tool==="whatsapp_platform_get_flow")!;for(const row of list.data){if(registry.filter(a=>a.id===row.id&&a.type==="FLOW"&&a.tenantId===scope.context.principal.tenantId&&a.clientId===scope.context.clientId&&a.provider==="META_WHATSAPP"&&a.appId===c.appId&&a.revokedAt===null&&a.parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===assetId)).length!==1)continue;try{const ctx={...scope.context,tool:read.tool},assets=await resolveAuthorizedAssets(this.options.repository,ctx,[{type:"FLOW",id:row.id}]);await selectConnection(this.options.repository,ctx,{parameters:contractPlanParameters(read,row.id,{}),assets:[{type:"FLOW",id:row.id}],classes:read.operationClasses,capability:read.id,requiredScopes:read.requiredScopes,tokenTypes:read.tokenTypes},assets,Date.now(),c.id);data.push(row);}catch(error){if(!(error instanceof PlatformDenied))throw error;}}await current();return {data,withheld_rows:list.data.length-data.length,complete_inventory:false,authority_change:false};
   }
   let before:ReturnType<typeof flowSchema.parse>|undefined;
   if(target.type==="FLOW")before=await preflight();
   if(contract.method==="GET"){await current();return {id:before!.id,...(before!.name?{name:before!.name}:{}),status:before!.status,validation_error_count:before!.validation_errors.length,whatsapp_business_account:{id:accounts[0].id},application:{id:c.appId}};}
   if(before){const required=contract.tool==="whatsapp_platform_deprecate_flow"?"PUBLISHED":"DRAFT";if(before.status!==required)throw new PlatformDenied("WHATSAPP_FLOW_STATE_TRANSITION_REQUIRED");}
   if(contract.tool==="whatsapp_platform_publish_flow"){
    if(before!.validation_errors.length||before!.json_version!=="7.3")throw new PlatformDenied("WHATSAPP_FLOW_VALIDATED_JSON_REQUIRED");
    const assets=z.object({data:z.array(z.object({name:z.string(),asset_type:z.string(),download_url:z.string()})).max(10)}).parse(await request(`/${assetId}/assets`,{})),json=assets.data.filter(a=>a.name==="flow.json"&&a.asset_type==="FLOW_JSON");
    if(json.length!==1)throw new PlatformDenied("WHATSAPP_FLOW_JSON_ASSET_REQUIRED");const url=new URL(json[0].download_url);
    if(url.protocol!=="https:"||url.username||url.password||url.hash||url.port||!(url.hostname.endsWith(".fbcdn.net")||url.hostname==="fbcdn.net"))throw new PlatformDenied("WHATSAPP_FLOW_META_JSON_HOST_REQUIRED");
    await current();let response:Response;try{response=await fetcher(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new PlatformDenied("WHATSAPP_FLOW_JSON_READ_REQUIRED");}if(!response.ok)throw new PlatformDenied("WHATSAPP_FLOW_JSON_READ_REQUIRED");const actual=validateStaticWhatsAppFlowJson(await readBodyWithLimit(response,65536));if(actual!==input.flow_json)throw new PlatformDenied("WHATSAPP_FLOW_APPROVED_JSON_CHANGED");
   }
   // Recheck after every asynchronous preflight and immediately before the one mutation claim.
   await current();productRateController.check(bucket);
   let init:RequestInit;
   if(contract.tool==="whatsapp_platform_upload_flow_json"){const form=new FormData();form.set("name","flow.json");form.set("asset_type","FLOW_JSON");form.set("file",new Blob([String(input.flow_json)],{type:"application/json"}),"flow.json");init={method:"POST",body:form};}
   else{const body=contract.tool==="whatsapp_platform_create_flow"?{...input,publish:false}:contract.tool==="whatsapp_platform_publish_flow"?{}:input;init={method:contract.method,headers:{"Content-Type":"application/json"},...(contract.method!=="DELETE"?{body:JSON.stringify(body)}:{})};}
   const result=await request(contract.path.replace("{asset_id}",assetId),{},init);
   if(contract.tool==="whatsapp_platform_create_flow"){const row=z.object({id,success:z.literal(true).optional(),validation_errors:z.array(z.unknown()).max(100).optional()}).parse(result);return {id:row.id,success:true,validation_error_count:row.validation_errors?.length??0};}
   const receipt=z.object({success:z.literal(true),validation_errors:z.array(z.unknown()).max(100).optional()}).parse(result);return {success:true,validation_error_count:receipt.validation_errors?.length??0};
  });
 }
}
