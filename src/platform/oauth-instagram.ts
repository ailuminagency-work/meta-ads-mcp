import {z} from "zod";
import {readBodyWithLimit} from "../utils/bounded-body.js";
import {assertMetaApiVersion,resolveMetaApiVersion} from "../meta/api-version.js";
import {PlatformDenied} from "./models.js";
import {validateConnectionProfile} from "./connection-profiles.js";
import type {TrustedOAuthProfile,VerifiedProviderAdapter} from "./oauth.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {canonicalJson} from "./policy.js";
const id=z.string().regex(/^\d{1,100}$/),token=z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/);
const equal=(a:readonly string[],b:readonly string[])=>canonicalJson([...a].sort())===canonicalJson([...b].sort());
export const INSTAGRAM_LOGIN_OAUTH_DOCUMENTATION=Object.freeze([
 "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login",
 "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started",
]);
/** Independent Instagram Login: permissions and app-scoped subject come from
 * authenticated code exchange, not an invented Facebook debug_token endpoint. */
export function createInstagramOAuthAdapter(options:{fetcher?:typeof fetch;now?:()=>number;apiVersion?:string}={}):VerifiedProviderAdapter{
 const version=assertMetaApiVersion(options.apiVersion??resolveMetaApiVersion()),verified=version==="v26.0";
 const validateProfile=(profile:TrustedOAuthProfile):void=>{
  validateConnectionProfile(profile);
  if(!verified||profile.provider!=="META_INSTAGRAM_LOGIN"||profile.strategy!=="instagram_login"||profile.authorizeUrl!=="https://www.instagram.com/oauth/authorize"||profile.configurationId!==undefined||profile.derivedTokenScopes!==undefined||!id.safeParse(profile.appId).success||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="instagram"||profile.requiredTasks.length)throw new PlatformDenied("INSTAGRAM_LOGIN_PROFILE_UNVERIFIED_HOLD");
  const contracts=profile.capabilities.map(cap=>PRODUCT_CONTRACTS.find(c=>c.id===cap&&c.provider===profile.provider&&c.verified&&c.tokenTypes.includes("instagram")));
  if(!contracts.length||contracts.some(c=>!c)||new Set(profile.capabilities).size!==profile.capabilities.length)throw new PlatformDenied("INSTAGRAM_LOGIN_CAPABILITY_UNVERIFIED_HOLD");
  const scopes=[...new Set(["instagram_business_basic",...contracts.flatMap(c=>c!.requiredScopes)])],actions=[...new Set(contracts.flatMap(c=>c!.operationClasses))];
  if(scopes.some(scope=>!/^instagram_business_(basic|content_publish|manage_messages|manage_comments|manage_insights)$/.test(scope))||actions.some(action=>!["READ","WRITE_CONTENT","WRITE_MESSAGING","WRITE_NON_FINANCIAL","DELETE"].includes(action))||!equal(profile.scopes,scopes)||!equal(profile.actions,actions))throw new PlatformDenied("INSTAGRAM_LOGIN_SCOPE_OR_ACTION_UNVERIFIED_HOLD");
 };
 const request=async(url:URL,init:RequestInit):Promise<unknown>=>{try{const response=await(options.fetcher??fetch)(url,{...init,redirect:"error",signal:AbortSignal.timeout(15000)});if(!response.ok){await response.body?.cancel();throw new Error();}const body:unknown=JSON.parse(await readBodyWithLimit(response,65536));if(!body||typeof body!=="object"||Array.isArray(body)||"error"in body||"error_type"in body)throw new Error();return body;}catch{throw new PlatformDenied("INSTAGRAM_OAUTH_PROVIDER_RESPONSE_INVALID");}};
 return {provider:"META_INSTAGRAM_LOGIN",verified,validateProfile,async exchangeAndInspect({profile,code,appSecret,requestedAssets}){
  validateProfile(profile);
  if(!token.safeParse(appSecret).success||!code||code.length>4096||/[\s\x00-\x1f\x7f]/.test(code)||requestedAssets.length!==1||requestedAssets[0].type!=="INSTAGRAM_ACCOUNT"||!id.safeParse(requestedAssets[0].id).success)throw new PlatformDenied("INSTAGRAM_EXACT_REGISTERED_ACCOUNT_REQUIRED");
  try{
   const started=(options.now??Date.now)();if(!Number.isSafeInteger(started)||started<=0)throw new Error();
   const form=new FormData();for(const[key,value]of Object.entries({client_id:profile.appId,client_secret:appSecret,grant_type:"authorization_code",redirect_uri:profile.redirectUri,code}))form.set(key,value);
   const short=z.object({data:z.array(z.object({access_token:token,user_id:id,permissions:z.string().min(1).max(4096)})).length(1)}).parse(await request(new URL("https://api.instagram.com/oauth/access_token"),{method:"POST",body:form})).data[0];
   const actual=short.permissions.split(",");if(new Set(actual).size!==actual.length||!equal(actual,profile.scopes))throw new Error();
   const exchange=new URL("https://graph.instagram.com/access_token");exchange.search=new URLSearchParams({grant_type:"ig_exchange_token",client_secret:appSecret,access_token:short.access_token}).toString();
   const long=z.object({access_token:token,token_type:z.literal("bearer"),expires_in:z.number().int().positive().max(5184000)}).parse(await request(exchange,{method:"GET"}));
   const meUrl=new URL(`https://graph.instagram.com/${version}/me`);meUrl.searchParams.set("fields","id,user_id,account_type");
   const me=z.object({data:z.array(z.object({id,user_id:id,account_type:z.enum(["BUSINESS","MEDIA_CREATOR","Business","Media_Creator"])})).length(1)}).parse(await request(meUrl,{method:"GET",headers:{Authorization:`Bearer ${long.access_token}`}})).data[0];
   const now=(options.now??Date.now)(),expiresAt=started+long.expires_in*1000;
   if(!Number.isSafeInteger(now)||now<started||!Number.isSafeInteger(expiresAt)||expiresAt<=now||me.id!==short.user_id||me.user_id!==requestedAssets[0].id)throw new Error();
   return {metaAppUserId:short.user_id,accessToken:long.access_token,provider:"META_INSTAGRAM_LOGIN",appId:profile.appId,subjectId:me.user_id,tokenType:"instagram",grantedScopes:actual,expiresAt,assets:[{...requestedAssets[0],tasks:[]}]};
  }catch{throw new PlatformDenied("INSTAGRAM_OAUTH_INSPECTION_FAILED_HOLD");}
 }};
}
