import { z } from "zod";
import { readBodyWithLimit } from "../utils/bounded-body.js";
import { assertMetaApiVersion, resolveMetaApiVersion } from "../meta/api-version.js";
import { PlatformDenied, type AssetRef } from "./models.js";
import { validateConnectionProfile } from "./connection-profiles.js";
import { canonicalJson } from "./policy.js";
import type { InspectedOAuthToken, TrustedOAuthProfile, VerifiedProviderAdapter } from "./oauth.js";
import { LEGACY_CORE_READ_TOOLS } from "./legacy-read.js";
import { LEGACY_CORE_WRITE_TOOLS } from "./legacy-write.js";

export const FACEBOOK_OAUTH_DOCUMENTATION=Object.freeze([
  "https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow",
  "https://developers.facebook.com/documentation/facebook-login/guides/access-tokens",
  "https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived",
  "https://www.postman.com/meta/whatsapp-business-platform/request/i1mz7w8/debug-token",
  "https://developers.facebook.com/docs/graph-api/reference/user/businesses/",
]);
const TOKEN=z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/);
const ID=z.string().regex(/^\d{1,100}$/);
const SCOPE=z.string().regex(/^[a-z][a-z0-9_]{0,100}$/);
const tokenResponse=z.object({access_token:TOKEN,token_type:z.string().optional(),expires_in:z.number().int().positive().max(31536000)});
const debugResponse=z.object({data:z.object({app_id:z.union([ID,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),type:z.literal("USER"),user_id:ID,is_valid:z.literal(true),scopes:z.array(SCOPE).min(1).max(100),expires_at:z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER/1000)),data_access_expires_at:z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER/1000)).optional()})});
const permissionResponse=z.object({data:z.array(z.object({permission:SCOPE,status:z.enum(["granted","declined","expired"])})).max(100),paging:z.object({next:z.unknown().optional()}).optional()});
const scopeKey=(scopes:string[])=>canonicalJson([...scopes].sort());
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const parsed=schema.safeParse(value);if(!parsed.success)throw new PlatformDenied("FACEBOOK_OAUTH_RESPONSE_SCHEMA_INVALID");return parsed.data;}
interface FacebookAdapterOptions { fetcher?:typeof fetch; apiVersion?:string; now?:()=>number; timeoutMs?:number }
export class FacebookBusinessOAuthAdapter implements VerifiedProviderAdapter {
  readonly verified:boolean;
  private readonly version:string;
  private readonly fetcher:typeof fetch;
  private readonly clock:()=>number;
  private readonly timeoutMs:number;
  constructor(readonly provider:"META_MARKETING"|"META_BUSINESS",options:FacebookAdapterOptions={}) {
    if(!["META_MARKETING","META_BUSINESS"].includes(provider))throw new PlatformDenied("FACEBOOK_PROVIDER_ADAPTER_UNVERIFIED_HOLD");
    this.version=assertMetaApiVersion(options.apiVersion??resolveMetaApiVersion());
    this.verified=this.version==="v26.0";
    this.fetcher=options.fetcher??fetch;this.clock=options.now??Date.now;this.timeoutMs=options.timeoutMs??15000;
    if(!Number.isSafeInteger(this.timeoutMs)||this.timeoutMs<1||this.timeoutMs>30000)throw new PlatformDenied("FACEBOOK_OAUTH_TIMEOUT_INVALID");
  }
  private now():number{const now=this.clock();if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("FACEBOOK_OAUTH_CLOCK_INVALID");return now;}
  private async get(path:string,parameters:Record<string,string>,bearer?:string):Promise<unknown>{
    const url=new URL(`/${this.version}${path}`,"https://graph.facebook.com");
    for(const [key,value] of Object.entries(parameters))url.searchParams.set(key,value);
    try {
      const response=await this.fetcher(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),headers:{Accept:"application/json",...(bearer?{Authorization:`Bearer ${bearer}`}:{})}});
      if(!response.ok)throw new PlatformDenied("FACEBOOK_OAUTH_PROVIDER_REJECTED");
      const body:unknown=JSON.parse(await readBodyWithLimit(response,131072));
      if(!body||typeof body!=="object"||Array.isArray(body)||"error" in body)throw new PlatformDenied("FACEBOOK_OAUTH_PROVIDER_REJECTED");
      return body;
    } catch {throw new PlatformDenied("FACEBOOK_OAUTH_TRANSPORT_OR_RESPONSE_FAILED");}
  }
  validateProfile(profile:TrustedOAuthProfile):void {
    if(!this.verified)throw new PlatformDenied("FACEBOOK_OAUTH_VERSION_CONTRACT_UNVERIFIED_HOLD");
    validateConnectionProfile(profile);
    if(profile.provider!==this.provider||profile.strategy!=="facebook_business"||profile.authorizeUrl!==`https://www.facebook.com/${this.version}/dialog/oauth`||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="user"||!ID.safeParse(profile.appId).success)throw new PlatformDenied("FACEBOOK_USER_PROFILE_REQUIRED");
    if(!profile.scopes.includes("public_profile"))throw new PlatformDenied("FACEBOOK_BASELINE_SCOPE_REQUIRED");
    if(this.provider==="META_MARKETING") {
      const read=profile.actions.includes("READ"),write=profile.actions.includes("WRITE_AD_CONFIGURATION");
      const readCapabilities=LEGACY_CORE_READ_TOOLS.map(tool=>`legacy.${tool}`),writeCapabilities=LEGACY_CORE_WRITE_TOOLS.map(tool=>`legacy.${tool}`);
      if(!profile.actions.length||new Set(profile.actions).size!==profile.actions.length||profile.actions.some(action=>!["READ","WRITE_AD_CONFIGURATION","WRITE_BUDGET"].includes(action))||(!write&&profile.actions.includes("WRITE_BUDGET"))||!profile.capabilities.length||new Set(profile.capabilities).size!==profile.capabilities.length||profile.capabilities.some(capability=>!((read&&readCapabilities.includes(capability))||(write&&writeCapabilities.includes(capability))))|| (write&&!profile.capabilities.some(capability=>writeCapabilities.includes(capability))) || (read&&!profile.capabilities.some(capability=>readCapabilities.includes(capability))))throw new PlatformDenied("FACEBOOK_MARKETING_PROFILE_PRIVILEGE_EXPANSION_HOLD");
      const required=["public_profile",...(read?["ads_read"]:[]),...(write?["ads_management"]:[])];
      if(scopeKey(profile.scopes)!==scopeKey(required))throw new PlatformDenied("FACEBOOK_INCREMENTAL_SCOPE_PROFILE_REQUIRED");
      // Enrollment proves token consent and account identity only. No manage-role,
      // billing ownership, app access tier or mutation eligibility is inferred.
    } else {
      if(!profile.scopes.includes("business_management"))throw new PlatformDenied("FACEBOOK_BASELINE_SCOPE_REQUIRED");
      if(!profile.actions.length||profile.actions.some(action=>action!=="READ"))throw new PlatformDenied("FACEBOOK_WRITE_ASSET_TASK_PROOF_UNVERIFIED_HOLD");
      if(profile.scopes.some(scope=>!["public_profile","business_management"].includes(scope)))throw new PlatformDenied("FACEBOOK_INCREMENTAL_SCOPE_PROFILE_REQUIRED");
    }
    if(profile.requiredTasks.length)throw new PlatformDenied("FACEBOOK_USER_TASK_INSPECTION_UNVERIFIED_HOLD");
  }
  private validate(profile:TrustedOAuthProfile,appSecret:string,requested:AssetRef[],code:string):void {
    this.validateProfile(profile);
    if(!TOKEN.safeParse(appSecret).success||!code||code.length>4096||/[\s\x00-\x1f\x7f]/.test(code))throw new PlatformDenied("FACEBOOK_OAUTH_INPUT_INVALID");
    const type=this.provider==="META_MARKETING"?"AD_ACCOUNT":"BUSINESS";
    if(!requested.length||requested.length>98||requested.some(a=>a.type!==type||! /^(?:act_)?\d{1,100}$/.test(a.id)||(a.type!=="AD_ACCOUNT"&&a.id.startsWith("act_")))||new Set(requested.map(a=>a.id.replace(/^act_/,""))).size!==requested.length)throw new PlatformDenied("FACEBOOK_REGISTERED_ROOT_TYPE_REQUIRED");
  }
  private async proveAssets(token:string,requested:AssetRef[]):Promise<InspectedOAuthToken["assets"]> {
    if(this.provider==="META_MARKETING") {
      const result:InspectedOAuthToken["assets"]=[];
      for(const asset of requested){
        const id=asset.id.replace(/^act_/,"");
        const object=parse(z.object({id:z.string().regex(/^act_\d{1,100}$/),account_id:ID}),await this.get(`/act_${id}`,{fields:"id,account_id"},token));
        if(object.id!==`act_${id}`||object.account_id!==id)throw new PlatformDenied("FACEBOOK_ASSET_READ_PROOF_MISMATCH");
        result.push({type:"AD_ACCOUNT",id,tasks:[]});
      }
      return result;
    }
    const found=new Set<string>();let after:string|undefined;
    for(let page=0;page<5;page++){
      const body=parse(z.object({data:z.array(z.object({id:ID})).max(100),paging:z.object({next:z.unknown().optional(),cursors:z.object({after:z.string().max(2048).optional()}).optional()}).optional()}),await this.get("/me/businesses",{fields:"id",limit:"100",...(after?{after}:{})},token));
      for(const business of body.data)if(requested.some(a=>a.id===business.id))found.add(business.id);
      if(found.size===requested.length)return requested.map(a=>({...a,tasks:[]}));
      if(!body.paging?.next)break;
      const cursor=body.paging.cursors?.after;
      if(!cursor||cursor===after||! /^[A-Za-z0-9._~+\/=\-]{1,2048}$/.test(cursor))throw new PlatformDenied("FACEBOOK_ASSET_PROOF_CURSOR_INVALID");after=cursor;
    }
    throw new PlatformDenied("FACEBOOK_BUSINESS_MEMBERSHIP_PROOF_REQUIRED");
  }
  async exchangeAndInspect(input:{code:string;profile:TrustedOAuthProfile;appSecret:string;requestedAssets:AssetRef[]}):Promise<InspectedOAuthToken> {
    this.validate(input.profile,input.appSecret,input.requestedAssets,input.code);
    const {profile,appSecret}=input;
    const issuedAt=this.now();
    // Current manual-flow contract requires GET query credentials. These URLs
    // stay server-side and are never logged or attached to thrown errors.
    const short=parse(tokenResponse,await this.get("/oauth/access_token",{client_id:profile.appId,client_secret:appSecret,redirect_uri:profile.redirectUri,code:input.code}));
    if(short.token_type&&short.token_type.toLowerCase()!=="bearer")throw new PlatformDenied("FACEBOOK_TOKEN_TYPE_MISMATCH");
    const long=parse(tokenResponse,await this.get("/oauth/access_token",{grant_type:"fb_exchange_token",client_id:profile.appId,client_secret:appSecret,fb_exchange_token:short.access_token}));
    if(long.token_type&&long.token_type.toLowerCase()!=="bearer")throw new PlatformDenied("FACEBOOK_TOKEN_TYPE_MISMATCH");
    const token=long.access_token;
    const debug=parse(debugResponse,await this.get("/debug_token",{input_token:token},`${profile.appId}|${appSecret}`)).data;
    if(String(debug.app_id)!==profile.appId||new Set(debug.scopes).size!==debug.scopes.length||scopeKey(debug.scopes)!==scopeKey(profile.scopes))throw new PlatformDenied("FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED");
    const inspectedAt=this.now();
    const expiry=Math.min(issuedAt+long.expires_in*1000,debug.expires_at*1000,...(debug.data_access_expires_at?[debug.data_access_expires_at*1000]:[]));
    if(!Number.isSafeInteger(expiry)||expiry<=inspectedAt)throw new PlatformDenied("FACEBOOK_TOKEN_EXPIRED");
    const me=parse(z.object({id:ID}),await this.get("/me",{fields:"id"},token));
    if(me.id!==debug.user_id)throw new PlatformDenied("FACEBOOK_ACTUAL_USER_SUBJECT_REQUIRED");
    const permissions=parse(permissionResponse,await this.get("/me/permissions",{},token));
    if(permissions.paging?.next||new Set(permissions.data.map(p=>p.permission)).size!==permissions.data.length)throw new PlatformDenied("FACEBOOK_PERMISSION_INSPECTION_INCOMPLETE");
    const granted=permissions.data.filter(p=>p.status==="granted").map(p=>p.permission);
    if(scopeKey(granted)!==scopeKey(debug.scopes))throw new PlatformDenied("FACEBOOK_ACTUAL_GRANTED_PERMISSIONS_REQUIRED");
    const assets=await this.proveAssets(token,input.requestedAssets);
    if(this.now()>=expiry)throw new PlatformDenied("FACEBOOK_TOKEN_EXPIRED");
    return {accessToken:token,provider:this.provider,appId:profile.appId,subjectId:me.id,tokenType:"user",grantedScopes:granted,expiresAt:expiry,assets};
  }
}
