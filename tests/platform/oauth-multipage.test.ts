import {createHash} from "node:crypto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {InMemoryConnectionChallengeStore} from "../../src/platform/connection-challenge-store.js";
import {PlatformOAuthService,ImmutableOAuthProfileRegistry,atomicConnectionEnrollments,type TrustedOAuthProfile,type InspectedOAuthToken} from "../../src/platform/oauth.js";
const tenant="synthetic-tenant",client="synthetic-client",operator="100";
const profile:TrustedOAuthProfile={id:"synthetic-pages",provider:"META_FACEBOOK_PAGES",appId:"300",strategy:"facebook_business",scopes:["public_profile","pages_show_list","pages_read_engagement"],derivedTokenScopes:["pages_show_list","pages_read_engagement"],tokenTypes:["page"],redirectUri:"https://fixture.invalid/platform/oauth/synthetic-pages/callback",authorizeUrl:"https://www.facebook.com/v26.0/dialog/oauth",verified:true,secretReference:"synthetic",capabilities:["pages.get.page"],actions:["READ"],requiredTasks:[]};
beforeEach(()=>vi.stubEnv("TOKEN_ENCRYPTION_KEY","e".repeat(64)));
afterEach(()=>vi.unstubAllEnvs());
async function fixture(change:"bad-second"|"expired-second"|"missing-second"|"role-change"|"commit-expiry"|"commit-stale-asset"|undefined=undefined){
 const repo=new InMemoryPlatformRepository(),now=Date.now();
 await repo.put("operatorIndex","_index",operator,{operatorId:operator,tenantId:tenant});
 await repo.put("tenants",tenant,tenant,{id:tenant,status:"ACTIVE",migrationState:"READY",registryRevision:1,policyRevision:1});
 await repo.put("members",tenant,operator,{operatorId:operator,tenantId:tenant,roles:["connection_admin"],allowedClientIds:[client],revision:1,disabledAt:null});
 await repo.put("clients",tenant,client,{id:client,tenantId:tenant,status:"ACTIVE",revision:1,verifiedBusinessIds:[]});
 for(const id of ["201","202"])await repo.put("assets",tenant,id,{key:id,id,type:"PAGE",provider:profile.provider,appId:profile.appId,tenantId:tenant,clientId:client,parents:[],verifiedAt:now-1,revokedAt:null,revision:1});
 const exchange=vi.fn(async()=>{
  if(change==="role-change"){const member=(await repo.get("members",tenant,operator))!;await repo.put("members",tenant,operator,{...member,roles:["reader"],revision:2});}
  return ["201","202"].slice(0,change==="missing-second"?1:2).map((id,index):InspectedOAuthToken=>({pageInspection:{accessToken:"synthetic-user",appId:profile.appId,userSubjectId:operator,grantedScopes:[...profile.scopes],expiresAt:now+3600000},accessToken:`synthetic-${id}`,provider:profile.provider,appId:index&&change==="bad-second"?"999":profile.appId,subjectId:id,tokenType:"page",grantedScopes:profile.derivedTokenScopes!,expiresAt:index&&change==="expired-second"?now-1:now+3600000,assets:[{type:"PAGE",id,tasks:[]}]}));
 });
 const commit=atomicConnectionEnrollments(repo);
 const service=new PlatformOAuthService({repository:repo,challenges:new InMemoryConnectionChallengeStore(),profiles:new ImmutableOAuthProfileRegistry([profile]),secrets:{get:async()=>"synthetic-app-secret"},adapters:{get:()=>({provider:profile.provider,verified:true,validateProfile:()=>{},exchangeAndInspect:async()=>{throw new Error("single interface forbidden");},exchangeAndInspectMany:exchange})},commitVerifiedConnections:async enrollments=>{if(change==="commit-expiry")enrollments[1].connection.expiresAt=Date.now()-1;if(change==="commit-stale-asset"){for(const e of enrollments)e.connection.expiresAt=now+7200000;vi.spyOn(Date,"now").mockReturnValue(now+3600001);}await commit(enrollments);}});
 const started=await service.start(operator,client,profile.id);
 return {repo,exchange,callback:()=>service.callback({operatorId:operator,clientId:client,profileId:profile.id,...started,code:"synthetic-code"})};
}
describe("atomic multi-Page OAuth enrollment",()=>{
 it("enrolls every requested Page with encrypted separate credentials and one atomic audit",async()=>{const f=await fixture(),result=await f.callback();expect(result.connectionCount).toBe(2);expect(result.assetCount).toBe(2);expect(result.connectionIds).toHaveLength(2);expect(await f.repo.list("connections",tenant)).toHaveLength(2);expect(await f.repo.list("credentials",tenant)).toHaveLength(2);expect(await f.repo.list("grants",tenant)).toHaveLength(2);expect(await f.repo.list("controlAudit",tenant)).toHaveLength(1);expect(JSON.stringify(await f.repo.list("credentials",tenant))).not.toContain("synthetic-201");expect(f.exchange).toHaveBeenCalledOnce();});
 it("blocks atomic multi-Page enrollment under an app-user lifecycle lock",async()=>{const f=await fixture();f.repo.enrollmentLocks.set(createHash("sha256").update(JSON.stringify(["meta-app-user",profile.appId,operator])).digest("hex"),{state:"UNKNOWN"});await expect(f.callback()).rejects.toThrow("APP_USER_LIFECYCLE_ENROLLMENT_LOCKED");for(const collection of ["connections","credentials","grants","pageInspectionDelegations","controlAudit"] as const)expect(await f.repo.list(collection,tenant)).toHaveLength(0);});
 it.each(["bad-second","expired-second","missing-second","role-change","commit-expiry","commit-stale-asset"] as const)("leaves zero partial enrollments after %s",async change=>{const f=await fixture(change);await expect(f.callback()).rejects.toThrow();for(const collection of ["connections","credentials","grants","controlAudit"] as const)expect(await f.repo.list(collection,tenant)).toHaveLength(0);vi.restoreAllMocks();});
});
