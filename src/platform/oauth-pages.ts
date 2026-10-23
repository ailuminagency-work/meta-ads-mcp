import {z} from "zod";
import {readBodyWithLimit} from "../utils/bounded-body.js";
import {assertMetaApiVersion,resolveMetaApiVersion} from "../meta/api-version.js";
import {PlatformDenied,type AssetRef} from "./models.js";
import type {InspectedOAuthToken,TrustedOAuthProfile,VerifiedProviderAdapter} from "./oauth.js";
import {validateConnectionProfile} from "./connection-profiles.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {expandVerifiedPermissionDependencies} from "./products/permission-dependencies.js";
import {canonicalJson} from "./policy.js";

type PageProvider="META_FACEBOOK_PAGES"|"META_MESSENGER"|"META_INSTAGRAM_FACEBOOK_LOGIN"|"META_MARKETING";
type Input={code:string;profile:TrustedOAuthProfile;appSecret:string;requestedAssets:AssetRef[];expectedOperatorId?:string};
const id=z.string().regex(/^\d{1,100}$/),token=z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/);
const scopes=z.array(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/)).min(1).max(100);
const seconds=z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER/1000));
const exchangeSchema=z.object({access_token:token,expires_in:z.number().int().positive().max(31536000)});
const debugSchema=z.object({data:z.object({app_id:z.union([id,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),type:z.enum(["USER","PAGE"]),user_id:id,is_valid:z.literal(true),scopes,expires_at:seconds,data_access_expires_at:seconds.optional(),profile_id:id.optional()})});
const equal=(a:readonly string[],b:readonly string[]):boolean=>canonicalJson([...a].sort())===canonicalJson([...b].sort());
export const FACEBOOK_PAGE_OAUTH_DOCUMENTATION=Object.freeze([
  "https://developers.facebook.com/documentation/pages-api/getting-started",
  "https://www.postman.com/meta/facebook/request/bqfxwbp/get-access-tokens-of-pages-you-manage",
  "https://www.postman.com/meta/instagram/request/lpx8lul/get-access-tokens-of-pages-you-manage",
  "https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow",
  "https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived",
  "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started",
  "https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user",
]);
/** USER exchange credentials remain transient; each PAGE result has its own
 * inspected token, exact registered root and literal provider task evidence. */
export class FacebookPagesOAuthAdapter implements VerifiedProviderAdapter {
  readonly verified:boolean;
  private readonly version:string;
  private readonly fetcher:typeof fetch;
  private readonly clock:()=>number;
  constructor(readonly provider:PageProvider,options:{fetcher?:typeof fetch;apiVersion?:string;now?:()=>number}={}){
    if(!["META_FACEBOOK_PAGES","META_MESSENGER","META_INSTAGRAM_FACEBOOK_LOGIN","META_MARKETING"].includes(provider))throw new PlatformDenied("PAGE_PROVIDER_ADAPTER_REQUIRED");
    this.version=assertMetaApiVersion(options.apiVersion??resolveMetaApiVersion());this.verified=this.version==="v26.0";this.fetcher=options.fetcher??fetch;this.clock=options.now??Date.now;
  }
  validateProfile(profile:TrustedOAuthProfile):void {
    validateConnectionProfile(profile);
    const userInstagram=this.provider==="META_INSTAGRAM_FACEBOOK_LOGIN"&&profile.tokenTypes.length===1&&profile.tokenTypes[0]==="user";
    if(!this.verified||profile.provider!==this.provider||profile.strategy!=="facebook_business"||profile.authorizeUrl!==`https://www.facebook.com/${this.version}/dialog/oauth`||profile.tokenTypes.length!==1||(!userInstagram&&profile.tokenTypes[0]!=="page")||!id.safeParse(profile.appId).success)throw new PlatformDenied("VERIFIED_PAGE_PROFILE_REQUIRED");
    if(this.provider==="META_MARKETING"){
      const writes=["legacy.ads_create_campaign","legacy.ads_create_ad_set","legacy.ads_create_ad_creative","legacy.ads_create_ad"],reads=["legacy.ads_get_account_info","legacy.ads_get_campaign_details","legacy.ads_get_creative_details","legacy.ads_get_ad_set_details","legacy.ads_get_campaigns","legacy.ads_get_ad_images","legacy.ads_get_custom_audiences","legacy.ads_get_ad_videos","legacy.ads_get_video_details","legacy.ads_get_lead_forms","legacy.ads_search_geo_locations","legacy.ads_search_interests"],read=profile.actions.includes("READ"),allowed=[...writes,...(read?reads:[])],derived=expandVerifiedPermissionDependencies(["ads_management","ads_read","pages_manage_ads"]),requested=expandVerifiedPermissionDependencies(["public_profile",...derived]);
      if(profile.authorizationContext!==undefined||!profile.capabilities.length||new Set(profile.capabilities).size!==profile.capabilities.length||profile.capabilities.some(c=>!allowed.includes(c))||!profile.capabilities.some(c=>writes.includes(c))||(read&&!profile.capabilities.some(c=>reads.includes(c)))||!equal(profile.actions,["WRITE_AD_CONFIGURATION","WRITE_BUDGET",...(read?["READ"]:[])])||!equal(profile.requiredTasks,["ADVERTISE"])||!equal(profile.scopes,requested)||!profile.derivedTokenScopes||(!equal(profile.derivedTokenScopes,derived)&&!equal(profile.derivedTokenScopes,[...derived,"public_profile"])))throw new PlatformDenied("MARKETING_PAGE_LEAD_PROFILE_REQUIRED");
      return;
    }
    const selected=profile.capabilities.map(capability=>PRODUCT_CONTRACTS.find(c=>c.id===capability&&c.provider===this.provider&&c.verified&&c.tokenTypes.includes(userInstagram?"user":"page")));
    if(!selected.length||selected.some(c=>!c)||new Set(profile.capabilities).size!==profile.capabilities.length)throw new PlatformDenied("PAGE_CAPABILITY_PROFILE_UNVERIFIED");
    const contracts=selected.map(c=>c!);
    const actions=[...new Set(contracts.flatMap(c=>c.operationClasses))],tasks=[...new Set(contracts.flatMap(c=>c.requiredTasks??[]))];
    if(actions.some(action=>!["READ","WRITE_CONTENT","WRITE_MESSAGING","WRITE_NON_FINANCIAL","DELETE"].includes(action))||!equal(profile.actions,actions)||!equal(profile.requiredTasks,tasks))throw new PlatformDenied("PAGE_OPERATION_OR_TASK_PROFILE_UNVERIFIED");
    if(profile.authorizationContext!==undefined&&this.provider!=="META_INSTAGRAM_FACEBOOK_LOGIN")throw new PlatformDenied("IG_AUTHORIZATION_CONTEXT_REQUIRED");
    const businessManager=this.provider==="META_INSTAGRAM_FACEBOOK_LOGIN"&&profile.authorizationContext==="BUSINESS_MANAGER";
    const derived=expandVerifiedPermissionDependencies([...contracts.flatMap(c=>c.requiredScopes),...(this.provider==="META_INSTAGRAM_FACEBOOK_LOGIN"?["instagram_basic","pages_read_engagement"]:[])]),requested=expandVerifiedPermissionDependencies(["public_profile","pages_show_list",...derived,...(businessManager?["ads_read"]:[])]);
    const candidatePacks=[derived,[...derived,"public_profile"],...(businessManager?[[...derived,"ads_read"],[...derived,"public_profile","ads_read"]]:[])];
    if(userInstagram){if(profile.derivedTokenScopes!==undefined||!equal(profile.scopes,requested))throw new PlatformDenied("IG_USER_INCREMENTAL_SCOPE_BINDING_REQUIRED");return;}
    if(!equal(profile.scopes,requested)||!profile.derivedTokenScopes||!candidatePacks.some(pack=>equal(profile.derivedTokenScopes!,pack)))throw new PlatformDenied("PAGE_INCREMENTAL_SCOPE_BINDING_REQUIRED");
  }
  private now():number{const now=this.clock();if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("PAGE_OAUTH_CLOCK_REQUIRED");return now;}
  private async get(path:string,query:Record<string,string>,bearer?:string):Promise<unknown>{
    const url=new URL(`/${this.version}${path}`,"https://graph.facebook.com");for(const [key,value]of Object.entries(query))url.searchParams.set(key,value);
    try{const response=await this.fetcher(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Accept:"application/json",...(bearer?{Authorization:`Bearer ${bearer}`}:{})}});if(!response.ok){await response.body?.cancel();throw new Error();}const body:unknown=JSON.parse(await readBodyWithLimit(response,131072));if(!body||typeof body!=="object"||Array.isArray(body)||"error"in body)throw new Error();return body;}catch{throw new PlatformDenied("PAGE_OAUTH_TRANSPORT_OR_RESPONSE_FAILED");}
  }
  async exchangeAndInspect(input:Input):Promise<InspectedOAuthToken>{
    if(input.requestedAssets.length!==(["META_INSTAGRAM_FACEBOOK_LOGIN","META_MARKETING"].includes(this.provider)?2:1))throw new PlatformDenied("MULTI_PAGE_ENROLLMENT_REQUIRED");return (await this.exchangeAndInspectMany(input))[0];
  }
  async exchangeAndInspectMany(input:Input):Promise<InspectedOAuthToken[]>{
    this.validateProfile(input.profile);
    const linked=this.provider==="META_INSTAGRAM_FACEBOOK_LOGIN",userInstagram=linked&&input.profile.tokenTypes[0]==="user",marketing=this.provider==="META_MARKETING",pageRoots=input.requestedAssets.filter(a=>a.type==="PAGE"),instagramRoots=input.requestedAssets.filter(a=>a.type==="INSTAGRAM_ACCOUNT"),adAccounts=input.requestedAssets.filter(a=>a.type==="AD_ACCOUNT");
    if(!id.safeParse(input.expectedOperatorId).success||!token.safeParse(input.appSecret).success||input.appSecret.includes("|")||!input.code||input.code.length>4096||/[\s\x00-\x1f\x7f]/.test(input.code)||!pageRoots.length||input.requestedAssets.length>32||(!linked&&!marketing&&pageRoots.length>25)||input.requestedAssets.some(a=>(a.type!=="PAGE"&&(!linked||a.type!=="INSTAGRAM_ACCOUNT")&&(!marketing||a.type!=="AD_ACCOUNT"))||!id.safeParse(a.type==="AD_ACCOUNT"?a.id.replace(/^act_/,""):a.id).success)||new Set(input.requestedAssets.map(a=>a.type+":"+a.id.replace(/^act_/,""))).size!==input.requestedAssets.length||(linked&&(pageRoots.length>16||instagramRoots.length!==pageRoots.length))||(userInstagram&&pageRoots.length!==1)||(marketing&&(pageRoots.length!==1||adAccounts.length!==1||input.requestedAssets.length!==2)))throw new PlatformDenied("PAGE_OAUTH_OPERATOR_AND_REGISTERED_ROOTS_REQUIRED");
    try{
      const {profile,appSecret}=input,issued=this.now(),appAuthentication=`${profile.appId}|${appSecret}`;
      const short=exchangeSchema.parse(await this.get("/oauth/access_token",{client_id:profile.appId,client_secret:appSecret,redirect_uri:profile.redirectUri,code:input.code}));
      const long=exchangeSchema.parse(await this.get("/oauth/access_token",{client_id:profile.appId,client_secret:appSecret,grant_type:"fb_exchange_token",fb_exchange_token:short.access_token}));
      const user=debugSchema.parse(await this.get("/debug_token",{input_token:long.access_token},appAuthentication)).data;
      if(user.type!=="USER"||String(user.app_id)!==profile.appId||user.user_id!==input.expectedOperatorId||user.expires_at<=0||new Set(user.scopes).size!==user.scopes.length||!equal(user.scopes,profile.scopes))throw new Error();
      const me=z.object({id}).parse(await this.get("/me",{fields:"id"},long.access_token));if(me.id!==user.user_id)throw new Error();
      const permission=z.object({data:z.array(z.object({permission:z.string(),status:z.enum(["granted","declined","expired"])})).max(100),paging:z.object({next:z.unknown().optional()}).optional()}).parse(await this.get("/me/permissions",{},long.access_token));
      if(permission.paging?.next||new Set(permission.data.map(p=>p.permission)).size!==permission.data.length||!equal(permission.data.filter(p=>p.status==="granted").map(p=>p.permission),profile.scopes))throw new Error();
      const requested=new Set(pageRoots.map(a=>a.id)),pages=new Map<string,{id:string;access_token:string;tasks:string[]}>();let after:string|undefined;
      for(let page=0;page<10;page++){
        const response=z.object({data:z.array(z.object({id,access_token:token,tasks:z.array(z.string().regex(/^[A-Z_]{1,100}$/)).max(100)})).max(100),paging:z.object({next:z.unknown().optional(),cursors:z.object({after:z.string().max(2048).optional()}).optional()}).optional()}).parse(await this.get(`/${user.user_id}/accounts`,{fields:"id,access_token,tasks",limit:"100",...(after?{after}:{})},long.access_token));
        for(const found of response.data)if(requested.has(found.id)){if(pages.has(found.id)||new Set(found.tasks).size!==found.tasks.length||!profile.requiredTasks.every(task=>found.tasks.includes(task)))throw new Error();pages.set(found.id,found);}
        if(pages.size===requested.size)break;if(!response.paging?.next)break;const cursor=response.paging.cursors?.after;if(!cursor||cursor===after||!/^[A-Za-z0-9._~+\/=\-]{1,2048}$/.test(cursor))throw new Error();after=cursor;
      }
      if(pages.size!==requested.size)throw new Error();
      const userExpiry=Math.min(issued+long.expires_in*1000,user.expires_at*1000,...(user.data_access_expires_at?[user.data_access_expires_at*1000]:[]));
      const result:InspectedOAuthToken[]=[],seenInstagram=new Set<string>();
      for(const root of pageRoots){
        const page=pages.get(root.id)!,inspected=userInstagram?user:debugSchema.parse(await this.get("/debug_token",{input_token:page.access_token},appAuthentication)).data;
        if(!userInstagram){if(inspected.type!=="PAGE"||String(inspected.app_id)!==profile.appId||inspected.user_id!==input.expectedOperatorId||(inspected.profile_id!==undefined&&inspected.profile_id!==root.id)||new Set(inspected.scopes).size!==inspected.scopes.length||!equal(inspected.scopes,profile.derivedTokenScopes!))throw new Error();const pageIdentity=z.object({id}).parse(await this.get("/me",{fields:"id"},page.access_token));if(pageIdentity.id!==root.id)throw new Error();}
        // A documented non-expiring PAGE token is capped by the inspected USER
        // delegation lifetime; zero is never reinterpreted as infinite authority.
        const expiresAt=Math.min(userExpiry,...(inspected.expires_at?[inspected.expires_at*1000]:[]),...(inspected.data_access_expires_at?[inspected.data_access_expires_at*1000]:[]));
        if(!Number.isSafeInteger(expiresAt)||expiresAt<=this.now())throw new Error();
        const assets:InspectedOAuthToken["assets"]=[{type:"PAGE",id:root.id,tasks:[...page.tasks]}];
        if(marketing){const accountId=adAccounts[0].id.replace(/^act_/,""),account=z.object({id:z.string().regex(/^act_\d{1,100}$/),account_id:id}).parse(await this.get(`/act_${accountId}`,{fields:"id,account_id"},page.access_token));if(account.id!==`act_${accountId}`||account.account_id!==accountId)throw new Error();assets.push({type:"AD_ACCOUNT",id:accountId,tasks:[]});}
        if(linked){
          // The current IG User reference specifies a USER token for this
          // identity proof. Only the explicit USER strategy enrolls that credential;
          // the Page strategy does not substitute it as the product token.
          const relation=z.object({id,instagram_business_account:z.object({id})}).parse(await this.get(`/${root.id}`,{fields:"id,instagram_business_account"},long.access_token));
          const instagramId=relation.instagram_business_account.id;
          if(relation.id!==root.id||!instagramRoots.some(a=>a.id===instagramId)||seenInstagram.has(instagramId))throw new Error();
          const identity=z.object({id}).parse(await this.get(`/${instagramId}`,{fields:"id"},long.access_token));if(identity.id!==instagramId)throw new Error();
          seenInstagram.add(instagramId);assets.push({type:"INSTAGRAM_ACCOUNT",id:instagramId,tasks:[]});
        }
        result.push({...(!userInstagram?{pageInspection:{accessToken:long.access_token,appId:profile.appId,userSubjectId:user.user_id,grantedScopes:[...user.scopes],expiresAt:userExpiry}}:{}),accessToken:userInstagram?long.access_token:page.access_token,provider:this.provider,appId:profile.appId,subjectId:userInstagram?user.user_id:root.id,tokenType:userInstagram?"user":"page",grantedScopes:[...inspected.scopes],expiresAt,assets});
      }
      if(new Set(result.map(r=>r.accessToken)).size!==result.length||(linked&&seenInstagram.size!==instagramRoots.length))throw new Error();return result;
    }catch{throw new PlatformDenied("PAGE_OAUTH_INSPECTION_FAILED_HOLD");}
  }
}
