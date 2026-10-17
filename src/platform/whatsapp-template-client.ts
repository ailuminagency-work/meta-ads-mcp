import {clientBusinessBound} from "./client-business.js";
import {assertWhatsAppOwnerOperational} from "./whatsapp-operational-policy.js";
import {actualUtilityTemplateSnapshot} from "./whatsapp-send-contracts.js";
import {resolveAuthorizedAssets} from "./assets.js";
import {selectConnection} from "./connections.js";
import type {PlatformRepository} from "./repository.js";
import {z} from "zod";
import {createHash} from "node:crypto";
import {PlatformDenied} from "./models.js";
import {PRODUCT_CONTRACTS,type ProductContract} from "./products/contracts.js";
import {WHATSAPP_TEMPLATE_CONTRACTS,validateWhatsAppTemplateParameters} from "./whatsapp-template-contracts.js";
import {assertExecutionPermit,getExecutionScope,revalidateExecutionPermit,withConnectionCredential,claimMutationStep} from "./execution.js";
import {assertContractEligibility,contractPlanParameters,productRateController} from "./clients.js";
import {canonicalJson} from "./policy.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
const id=z.string().regex(/^\d{1,32}$/),template=z.object({id,name:z.string().regex(/^[a-z][a-z0-9_]{0,511}$/),language:z.string().max(20),category:z.enum(["UTILITY","MARKETING","AUTHENTICATION"]),status:z.string().min(1).max(40),components:z.array(z.unknown()).max(100).optional()});
export class WhatsAppTemplateClient{
 constructor(private readonly options:{repository:PlatformRepository;getAppSecret(appId:string):Promise<string>;fetcher?:typeof fetch}){}
 async request(contract:ProductContract,assetId:string,input:Record<string,unknown>):Promise<unknown>{
  contract=structuredClone(contract);input=structuredClone(input);validateWhatsAppTemplateParameters(contract.tool,input);
  const known=PRODUCT_CONTRACTS.find(c=>c.tool===contract.tool&&c.provider==="META_WHATSAPP"&&WHATSAPP_TEMPLATE_CONTRACTS.some(raw=>raw.tool===c.tool));if(!known||canonicalJson(contract)!==canonicalJson(known)||!id.safeParse(assetId).success)throw new PlatformDenied("EXACT_WHATSAPP_TEMPLATE_CONTRACT_REQUIRED");
  const mutation=contract.method!=="GET",permit=assertExecutionPermit({provider:"META_WHATSAPP",tool:contract.tool,mutation}),scope=getExecutionScope(),c=scope.snapshot.connection;
  if(canonicalJson(scope.plan.parameters)!==canonicalJson(contractPlanParameters(contract,assetId,input))||scope.plan.capability!==contract.id||canonicalJson(scope.plan.classes)!==canonicalJson(contract.operationClasses)||canonicalJson(scope.plan.requiredScopes)!==canonicalJson(contract.requiredScopes)||canonicalJson(scope.plan.tokenTypes)!==canonicalJson(contract.tokenTypes))throw new PlatformDenied("WHATSAPP_TEMPLATE_PLAN_REQUIRED");
  const account=scope.snapshot.assets.filter(a=>a.type==="MESSAGING_ACCOUNT"),waacs=scope.snapshot.assets.filter(a=>a.type==="WHATSAPP_ACCOUNT"),target=scope.snapshot.assets.filter(a=>a.id===assetId&&a.type===contract.assetType),e=c.whatsappAssignmentEvidence;
  if(target.length!==1||account.length!==1||waacs.length!==1||c.tokenType!=="business_integration_system_user"||!c.subjectId||!c.clientBusinessId||!clientBusinessBound(scope.snapshot.client,c.clientBusinessId,Date.now(),scope.snapshot.businessOwnerEvidence,c.appId)||!e||e.source!=="META_BUSINESS_SUITE_OWNER_REVIEW"||e.dualAccountAssignment!==true||e.tenantId!==scope.context.principal.tenantId||e.clientId!==scope.context.clientId||e.appId!==c.appId||e.messagingAccountId!==account[0].id||e.whatsappAccountId!==waacs[0].id||account[0].provider!==c.provider||account[0].appId!==c.appId||!account[0].parents.some(p=>p.type==="WHATSAPP_ACCOUNT"&&p.id===waacs[0].id)||(target[0].type==="TEMPLATE"&&!target[0].parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===account[0].id)))throw new PlatformDenied("WHATSAPP_TEMPLATE_CLIENT_CLOSURE_REQUIRED");
  const current=async()=>{await revalidateExecutionPermit(permit);const now=Date.now();assertContractEligibility(contract,c);assertWhatsAppOwnerOperational(c,mutation,now);};
  await current();return withConnectionCredential(permit,async token=>{assertWhatsAppOwnerOperational(c,mutation,Date.now(),token);
   let secret:string;try{secret=await this.options.getAppSecret(c.appId);}catch{throw new PlatformDenied("WHATSAPP_TEMPLATE_APP_SECRET_REQUIRED");}if(!secret||/[|\s\x00-\x1f\x7f]/.test(secret))throw new PlatformDenied("WHATSAPP_TEMPLATE_APP_SECRET_REQUIRED");
   const bucket=createHash("sha256").update(JSON.stringify(["META_WHATSAPP",c.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");
   const request=async(path:string,query:Record<string,string>,method:"GET"|"POST"|"DELETE"="GET",body?:Record<string,unknown>,bearer=token)=>{
    await current();productRateController.bind(bucket,c.appId);productRateController.check(bucket);const url=new URL("https://graph.facebook.com/v26.0"+path);url.search=new URLSearchParams(query).toString();if(method!=="GET")claimMutationStep(permit);
    let response:Response;try{response=await(this.options.fetcher??fetch)(url,{method,headers:{Authorization:`Bearer ${bearer}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new PlatformDenied("WHATSAPP_TEMPLATE_OUTCOME_UNCERTAIN");}
    productRateController.observe(bucket,response,null);let parsed:unknown;try{parsed=JSON.parse(await readBodyWithLimit(response,131072));}catch{throw new PlatformDenied("WHATSAPP_TEMPLATE_RESPONSE_INVALID");}if(!response.ok||!parsed||typeof parsed!=="object"||Array.isArray(parsed)||"error"in parsed)throw new PlatformDenied("WHATSAPP_TEMPLATE_OUTCOME_UNCERTAIN");return parsed;
   };
   const debug=z.object({data:z.object({is_valid:z.literal(true),app_id:z.union([id,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),user_id:id,scopes:z.array(z.string()).max(100),granular_scopes:z.array(z.object({scope:z.string(),target_ids:z.array(id).max(100)})).max(100)})}).parse(await request("/debug_token",{input_token:token},"GET",undefined,`${c.appId}|${secret}`)).data;
   if(String(debug.app_id)!==c.appId||debug.user_id!==c.subjectId||new Set(debug.scopes).size!==debug.scopes.length||canonicalJson([...debug.scopes].sort())!==canonicalJson([...c.scopes].sort())||!debug.granular_scopes.some(g=>g.scope==="whatsapp_business_management"&&g.target_ids.includes(account[0].id)))throw new PlatformDenied("WHATSAPP_TEMPLATE_ACTUAL_GRANT_REQUIRED");
   const me=z.object({id,client_business_id:id}).parse(await request("/me",{fields:"client_business_id"}));if(me.id!==c.subjectId||me.client_business_id!==c.clientBusinessId)throw new PlatformDenied("WHATSAPP_TEMPLATE_ACTUAL_BUSINESS_REQUIRED");
   if(contract.tool==="whatsapp_platform_list_templates"){
    const list=z.object({data:z.array(template).max(100),paging:z.unknown().optional()}).parse(await request(`/${account[0].id}/message_templates`,contract.fixedQuery??{})),data:typeof list.data=[];
    const read=PRODUCT_CONTRACTS.find(candidate=>candidate.tool==="whatsapp_platform_get_template")!;
    for(const row of list.data){try{const ctx={...scope.context,tool:read.tool},assets=await resolveAuthorizedAssets(this.options.repository,ctx,[{type:"TEMPLATE",id:row.id}]);if(!assets.some(a=>a.id===row.id&&a.type==="TEMPLATE"&&a.parents.some(p=>p.type==="MESSAGING_ACCOUNT"&&p.id===account[0].id)))continue;await selectConnection(this.options.repository,ctx,{parameters:contractPlanParameters(read,row.id,{}),assets:[{type:"TEMPLATE",id:row.id}],classes:read.operationClasses,capability:read.id,requiredScopes:read.requiredScopes,tokenTypes:read.tokenTypes},assets,Date.now(),c.id);data.push(row);}catch(error){if(!(error instanceof PlatformDenied))throw error;}}
    await current();return {data,withheld_rows:list.data.length-data.length,complete_inventory:false,authority_change:false};
   }
   let before:z.infer<typeof template>|undefined;
   if(target[0].type==="TEMPLATE"){
    // Membership is established by the exact account's edge, not an inferred template ID.
    const rows=z.object({data:z.array(template).max(100),paging:z.object({next:z.unknown().optional()}).optional()}).parse(await request(`/${account[0].id}/message_templates`,{fields:contract.tool==="whatsapp_platform_get_template"?"id,name,language,category,status,components":"id,name,language,category,status",limit:"100"}));
    const matches=rows.data.filter(row=>row.id===assetId);if(rows.paging?.next||matches.length!==1)throw new PlatformDenied("WHATSAPP_TEMPLATE_ACTUAL_PARENT_REQUIRED");before=matches[0];
    if(contract.tool==="whatsapp_platform_get_template"){await current();const {components,...metadata}=before;let preview:Record<string,unknown>={};if(components){try{const approved=actualUtilityTemplateSnapshot(before);preview={send_snapshot:approved.snapshot,body_parameter_count:approved.parameterCount};}catch{/* Unsupported formats remain readable as metadata only. */}}return {...metadata,...preview};}
    if(before.category==="AUTHENTICATION")throw new PlatformDenied("WHATSAPP_TEMPLATE_AUTHENTICATION_CONTRACT_REQUIRED");
    if(contract.tool==="whatsapp_platform_update_template"&&!['APPROVED','REJECTED','PAUSED'].includes(before.status))throw new PlatformDenied("WHATSAPP_TEMPLATE_EDIT_STATE_REQUIRED");
    if(contract.tool==="whatsapp_platform_delete_template"&&(before.name!==input.name||before.status==="DISABLED"))throw new PlatformDenied("WHATSAPP_TEMPLATE_DELETE_EXACT_ID_NAME_REQUIRED");
   }
   await current();let result:unknown;
   if(contract.tool==="whatsapp_platform_delete_template")result=await request(`/${account[0].id}/message_templates`,{hsm_id:assetId,name:String(input.name)},"DELETE");
   else result=await request(contract.path.replace("{asset_id}",assetId),{},"POST",input);
   if(contract.tool==="whatsapp_platform_create_template"){const created=z.object({id,status:z.string().min(1).max(40),category:z.enum(["UTILITY","MARKETING"])}).parse(result);return {...created};}
   return z.object({success:z.literal(true)}).parse(result);
  });
 }
}
