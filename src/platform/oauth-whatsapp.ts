import {clientBusinessBound,type ClientBusinessEvidence} from "./client-business.js";
import {z} from "zod";
import {readBodyWithLimit} from "../utils/bounded-body.js";
import {PlatformDenied,type Client,type PlatformPrincipal} from "./models.js";
import {validateConnectionProfile} from "./connection-profiles.js";
import type {TrustedOAuthProfile,VerifiedProviderAdapter} from "./oauth.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {expandVerifiedPermissionDependencies} from "./products/permission-dependencies.js";
import {canonicalJson} from "./policy.js";
const id=z.string().regex(/^\d{1,100}$/),token=z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/);
const bindingSchema=z.object({profileId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),tenantId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),clientId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),appId:id,clientBusinessId:id,whatsappAccountId:id,messagingAccountId:id,phoneId:id,dualAccountAssignment:z.literal(true),source:z.literal("META_BUSINESS_SUITE_OWNER_REVIEW"),approvedBy:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),checkedAt:z.number().int().positive(),expiresAt:z.number().int().positive()}).strict();
export type WhatsAppEnrollmentBinding=z.infer<typeof bindingSchema>;
export const whatsappEnrollmentBindingSchema=bindingSchema;
export const WHATSAPP_OAUTH_DOCUMENTATION=Object.freeze(["https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens","https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business","https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers"]);
const equal=(a:readonly string[],b:readonly string[])=>canonicalJson([...a].sort())===canonicalJson([...b].sort());
/** Client-scoped BISU onboarding only. The current WhatsApp account has no
 * Graph endpoint: its separate assignment is explicitly human-reviewed server
 * evidence, never inferred from Messaging access or the interim API cascade. */
export function createWhatsAppOAuthAdapter(options:{bindings:readonly WhatsAppEnrollmentBinding[];fetcher?:typeof fetch;now?:()=>number}):VerifiedProviderAdapter & {validateEnrollmentContext(input:{profile:TrustedOAuthProfile;principal:PlatformPrincipal;clientId:string;client:Client;businessOwnerEvidence?:ClientBusinessEvidence}):void}{
 const bindings=z.array(bindingSchema).max(32).parse(structuredClone(options.bindings)),clock=options.now??Date.now;
 if(new Set(bindings.map(b=>b.profileId)).size!==bindings.length)throw new PlatformDenied("WHATSAPP_PROFILE_BINDING_AMBIGUOUS");
 const now=()=>{const n=clock();if(!Number.isSafeInteger(n)||n<=0)throw new PlatformDenied("WHATSAPP_OAUTH_CLOCK_REQUIRED");return n;};
 const binding=(p:TrustedOAuthProfile)=>{const b=bindings.find(b=>b.profileId===p.id),n=now();if(!b||b.appId!==p.appId||b.checkedAt>n||n-b.checkedAt>300000||b.expiresAt<=n||b.expiresAt>b.checkedAt+3600000||new Set([b.whatsappAccountId,b.messagingAccountId,b.phoneId]).size!==3)throw new PlatformDenied("WHATSAPP_DUAL_ASSIGNMENT_OWNER_REVIEW_REQUIRED");return b;};
 const validateProfile=(p:TrustedOAuthProfile)=>{
  validateConnectionProfile(p);binding(p);
  if(p.provider!=="META_WHATSAPP"||p.strategy!=="facebook_business"||p.authorizeUrl!=="https://www.facebook.com/v26.0/dialog/oauth"||!p.configurationId||!id.safeParse(p.configurationId).success||p.secretReference!=="META_APP_SECRET"||p.tokenTypes.length!==1||p.tokenTypes[0]!=="business_integration_system_user"||p.derivedTokenScopes!==undefined||p.authorizationContext!==undefined||p.requiredTasks.length)throw new PlatformDenied("WHATSAPP_BISU_PROFILE_REQUIRED");
  const selected=p.capabilities.map(cap=>PRODUCT_CONTRACTS.find(c=>c.id===cap&&c.provider==="META_WHATSAPP"&&c.verified&&c.tokenTypes.includes("business_integration_system_user")));
  if(!selected.length||selected.some(c=>!c)||new Set(p.capabilities).size!==p.capabilities.length)throw new PlatformDenied("WHATSAPP_VERIFIED_CAPABILITY_REQUIRED");
  const scopes=expandVerifiedPermissionDependencies(["whatsapp_business_management",...selected.flatMap(c=>c!.requiredScopes)]),actions=[...new Set(selected.flatMap(c=>c!.operationClasses))];
  if(scopes.some(s=>!["business_management","whatsapp_business_management","whatsapp_business_messaging"].includes(s))||!equal(p.scopes,scopes)||!equal(p.actions,actions))throw new PlatformDenied("WHATSAPP_INCREMENTAL_SCOPE_PROFILE_REQUIRED");
 };
 const get=async(path:string,query:Record<string,string>,bearer?:string):Promise<unknown>=>{const url=new URL("https://graph.facebook.com/v26.0"+path);url.search=new URLSearchParams(query).toString();try{const response=await(options.fetcher??fetch)(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Accept:"application/json",...(bearer?{Authorization:`Bearer ${bearer}`}:{})}});if(!response.ok){await response.body?.cancel();throw new Error();}const raw:unknown=JSON.parse(await readBodyWithLimit(response,65536));if(!raw||typeof raw!=="object"||Array.isArray(raw)||"error"in raw)throw new Error();return raw;}catch{throw new PlatformDenied("WHATSAPP_OAUTH_PROVIDER_INSPECTION_FAILED");}};
 return {provider:"META_WHATSAPP",verified:true,validateProfile,validateEnrollmentContext({profile,principal,clientId,client,businessOwnerEvidence}){validateProfile(profile);const b=binding(profile);if(b.tenantId!==principal.tenantId||b.clientId!==clientId||client.tenantId!==b.tenantId||client.id!==b.clientId||client.status!=="ACTIVE"||!clientBusinessBound(client,b.clientBusinessId,clock(),businessOwnerEvidence,b.appId))throw new PlatformDenied("WHATSAPP_CLIENT_BUSINESS_BINDING_REQUIRED");},async exchangeAndInspect(input){
  validateProfile(input.profile);const b=binding(input.profile),requested=[{type:"WHATSAPP_ACCOUNT" as const,id:b.whatsappAccountId},{type:"MESSAGING_ACCOUNT" as const,id:b.messagingAccountId},{type:"WHATSAPP_PHONE" as const,id:b.phoneId}];
  if(input.requestedAssets.length!==3||!requested.every(r=>input.requestedAssets.some(a=>a.type===r.type&&a.id===r.id))||!input.code||input.code.length>4096||/[\s\x00-\x1f\x7f]/.test(input.code)||!token.safeParse(input.appSecret).success||input.appSecret.includes("|"))throw new PlatformDenied("WHATSAPP_EXACT_CLIENT_ACCOUNT_CLOSURE_REQUIRED");
  try{
   const exchanged=z.object({access_token:token,expires_in:z.number().int().nonnegative().max(31536000).optional()}).parse(await get("/oauth/access_token",{client_id:input.profile.appId,client_secret:input.appSecret,redirect_uri:input.profile.redirectUri,code:input.code}));
   const debug=z.object({data:z.object({is_valid:z.literal(true),app_id:z.union([id,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),user_id:id,scopes:z.array(z.string()).min(1).max(100),expires_at:z.number().int().nonnegative().max(3153600000),data_access_expires_at:z.number().int().nonnegative().max(3153600000).optional()})}).parse(await get("/debug_token",{input_token:exchanged.access_token},`${input.profile.appId}|${input.appSecret}`)).data;
   if(String(debug.app_id)!==input.profile.appId||new Set(debug.scopes).size!==debug.scopes.length||!equal(debug.scopes,input.profile.scopes))throw new Error();
   // This documented BISU-only field establishes the actual client business;
   // neither a caller-selected token label nor generic system-user type does.
   const me=z.object({id,client_business_id:id}).parse(await get("/me",{fields:"client_business_id"},exchanged.access_token));
   if(me.id!==debug.user_id||me.client_business_id!==b.clientBusinessId)throw new Error();
   let found=false,after:string|undefined;const cursors=new Set<string>();
   for(let page=0;page<5;page++){
    const list=z.object({data:z.array(z.object({id})).max(100),paging:z.object({next:z.unknown().optional(),cursors:z.object({after:z.string().max(2048).optional()}).optional()}).optional()}).parse(await get(`/${b.messagingAccountId}/phone_numbers`,{fields:"id",limit:"100",...(after?{after}:{})},exchanged.access_token));
    if(new Set(list.data.map(r=>r.id)).size!==list.data.length)throw new Error();found=list.data.some(r=>r.id===b.phoneId);if(found||!list.paging?.next)break;const cursor=list.paging.cursors?.after;if(!cursor||!/^[A-Za-z0-9._~+\/=\-]{1,2048}$/.test(cursor)||cursors.has(cursor)||page===4)throw new Error();cursors.add(cursor);after=cursor;
   }
   if(!found)throw new Error();const phone=z.object({id,status:z.enum(["CONNECTED"])}).parse(await get(`/${b.phoneId}`,{fields:"id,status"},exchanged.access_token));if(phone.id!==b.phoneId)throw new Error();
   const checked=now();binding(input.profile);const expiresAt=Math.min(b.expiresAt,...(debug.expires_at?[debug.expires_at*1000]:[]),...(debug.data_access_expires_at?[debug.data_access_expires_at*1000]:[]),...(exchanged.expires_in?[checked+exchanged.expires_in*1000]:[]));
   if(expiresAt<=checked)throw new Error();
   const {profileId:ignoredProfile,clientBusinessId:ignoredBusiness,...whatsappAssignmentEvidence}=b;void ignoredProfile;void ignoredBusiness;return {clientBusinessId:me.client_business_id,whatsappAssignmentEvidence,provider:"META_WHATSAPP",appId:input.profile.appId,subjectId:me.id,tokenType:"business_integration_system_user",accessToken:exchanged.access_token,grantedScopes:[...debug.scopes],expiresAt,assets:requested.map(a=>({...a,tasks:[]}))};
  }catch{throw new PlatformDenied("WHATSAPP_BISU_INSPECTION_FAILED_HOLD");}
 }};
}
