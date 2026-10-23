import {describe,expect,it,vi} from "vitest";
import {FacebookPagesOAuthAdapter} from "../../src/platform/oauth-pages.js";
import {PRODUCT_CONTRACTS} from "../../src/platform/products/contracts.js";
import {expandVerifiedPermissionDependencies as expand} from "../../src/platform/products/permission-dependencies.js";
import type {TrustedOAuthProfile} from "../../src/platform/oauth.js";
const now=1792180000000,contract=PRODUCT_CONTRACTS.find(c=>c.tool==="pages_list_feed")!;
const derived=expand(contract.requiredScopes);
const profile:TrustedOAuthProfile={id:"pages",provider:"META_FACEBOOK_PAGES",appId:"3001",strategy:"facebook_business",scopes:expand(["public_profile","pages_show_list",...derived]),derivedTokenScopes:derived,tokenTypes:["page"],redirectUri:"https://fixture.invalid/platform/oauth/pages/callback",authorizeUrl:"https://www.facebook.com/v26.0/dialog/oauth",configurationId:"4001",verified:true,secretReference:"synthetic-reference",capabilities:[contract.id],actions:["READ"],requiredTasks:contract.requiredTasks??[]};
const input={code:"synthetic-code",appSecret:"synthetic-secret",profile,expectedOperatorId:"100",requestedAssets:[{type:"PAGE" as const,id:"201"},{type:"PAGE" as const,id:"202"}]};
function fixture(change:{user?:Record<string,unknown>;page?:Record<string,unknown>;identity?:string;tasks?:string[];scopes?:string[];failure?:boolean;reuse?:boolean}={}){
  let exchange=0;
  const fetcher=vi.fn(async(raw:RequestInfo|URL,options?:RequestInit)=>{
    const url=new URL(String(raw)),bearer=new Headers(options?.headers).get("authorization");expect(url.origin).toBe("https://graph.facebook.com");expect(options?.redirect).toBe("error");expect(options?.method).toBe("GET");
    if(change.failure)throw new Error(String(raw));
    let body:unknown;
    if(url.pathname.endsWith("/oauth/access_token"))body={access_token:++exchange===1?"synthetic-short":"synthetic-user",expires_in:3600};
    else if(url.pathname.endsWith("/debug_token")){const user=url.searchParams.get("input_token")==="synthetic-user";expect(bearer).toBe("Bearer 3001|synthetic-secret");body={data:{app_id:"3001",type:user?"USER":"PAGE",user_id:"100",is_valid:true,scopes:user?profile.scopes:(change.scopes??derived),expires_at:user?Math.floor(now/1000)+3600:0,...(user?change.user:change.page)}};}
    else if(url.pathname.endsWith("/me/permissions"))body={data:profile.scopes.map(permission=>({permission,status:"granted"}))};
    else if(url.pathname.endsWith("/100/accounts"))body={data:["201","202"].map(id=>({id,access_token:`synthetic-page-${change.reuse?"201":id}`,tasks:change.tasks??profile.requiredTasks}))};
    else if(url.pathname.endsWith("/me"))body={id:bearer==="Bearer synthetic-user"?"100":change.identity??bearer!.slice("Bearer synthetic-page-".length)};
    else throw new Error("unrecognized fixture route");
    return new Response(JSON.stringify(body));
  });
  return {fetcher,adapter:new FacebookPagesOAuthAdapter("META_FACEBOOK_PAGES",{fetcher,apiVersion:"v26.0",now:()=>now})};
}
describe("inspected Page-token OAuth derivation",()=>{
  it("returns isolated Page credentials bound to inspected identities with finite delegation",async()=>{const f=fixture(),result=await f.adapter.exchangeAndInspectMany(input);expect(result.map(r=>r.subjectId)).toEqual(["201","202"]);expect(result.map(r=>r.accessToken)).toEqual(["synthetic-page-201","synthetic-page-202"]);for(const r of result){expect(r.grantedScopes).toEqual(derived);expect(r.expiresAt).toBe(now+3600000);expect(r.assets).toEqual([{type:"PAGE",id:r.subjectId,tasks:profile.requiredTasks}]);expect(r).not.toHaveProperty("eligibility");}});
  it.each([{user:{user_id:"999"}},{user:{app_id:"999"}},{page:{type:"USER"}},{page:{app_id:"999"}},{page:{profile_id:"999"}},{page:{user_id:"201"}},{identity:"999"},{scopes:[...derived,"ads_management"]},{page:{expires_at:1}},{reuse:true},{tasks:[]},{tasks:["PROFILE_PLUS_CREATE_CONTENT"]}])("rejects independently inspected identity or privilege mismatch %j",async change=>{await expect(fixture(change).adapter.exchangeAndInspectMany(input)).rejects.toThrow("INSPECTION_FAILED_HOLD");});
  it("rejects missing operator and excessive root batches before exchanging",async()=>{const f=fixture();await expect(f.adapter.exchangeAndInspectMany({...input,expectedOperatorId:undefined})).rejects.toThrow();await expect(f.adapter.exchangeAndInspectMany({...input,requestedAssets:Array.from({length:33},(_,i)=>({type:"PAGE",id:String(i+1)}))})).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled();});
  it("rejects single-result interface for multiple roots",async()=>{const f=fixture();await expect(f.adapter.exchangeAndInspect(input)).rejects.toThrow("MULTI_PAGE_ENROLLMENT_REQUIRED");expect(f.fetcher).not.toHaveBeenCalled();});
  it("requires explicit derived scopes and denies profile privilege expansion before consent",()=>{const f=fixture();expect(()=>f.adapter.validateProfile({...profile,derivedTokenScopes:undefined})).toThrow();expect(()=>f.adapter.validateProfile({...profile,actions:["READ","BUSINESS_ADMIN"]})).toThrow();expect(()=>f.adapter.validateProfile({...profile,scopes:[...profile.scopes,"ads_management"]})).toThrow();expect(f.fetcher).not.toHaveBeenCalled();});
  it("sanitizes credential-bearing exchange failures without retries",async()=>{const f=fixture({failure:true});try{await f.adapter.exchangeAndInspectMany(input);throw new Error("must reject");}catch(error){const message=String(error);expect(message).toContain("INSPECTION_FAILED_HOLD");for(const secret of [input.code,input.appSecret,"graph.facebook.com"])expect(message).not.toContain(secret);}expect(f.fetcher).toHaveBeenCalledOnce();});
});
