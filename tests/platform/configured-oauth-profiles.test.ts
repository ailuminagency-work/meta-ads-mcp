import {describe,expect,it} from "vitest";
import {configuredOAuthProfiles} from "../../src/platform/connection-runtime.js";
const origin="https://staging.example.com";
const profile={id:"ads",provider:"META_MARKETING",appId:"300",strategy:"facebook_business",scopes:["ads_read"],tokenTypes:["user"],redirectUri:`${origin}/platform/oauth/ads/callback`,authorizeUrl:"https://www.facebook.com/v26.0/dialog/oauth",verified:true,secretReference:"META_APP_SECRET",capabilities:["legacy.ads_get_campaigns"],actions:["READ"],requiredTasks:[]};
const environment=(profiles:unknown=[profile])=>({META_APP_ID:"300",META_APP_SECRET:"synthetic-secret",LUMIN_PLATFORM_OAUTH_PROFILES_JSON:JSON.stringify(profiles)});
describe("deployment-owned OAuth profiles shared by login and operational inspection",()=>{
 it("takes an immutable registry snapshot while keeping secrets out of metadata",async()=>{const env=environment(),result=configuredOAuthProfiles(origin,env);result.profiles[0].scopes.push("ads_management");env.META_APP_ID="999";expect((await result.registry.get("ads"))?.scopes).toEqual(["ads_read"]);expect(JSON.stringify(result.profiles)).not.toContain("synthetic-secret");});
 it.each([
  {...profile,appId:"999"},
  {...profile,redirectUri:"https://foreign.example.com/platform/oauth/ads/callback"},
  {...profile,redirectUri:`${origin}/platform/oauth/other/callback`},
  {...profile,authorizeUrl:"https://foreign.example.com/v26.0/dialog/oauth"},
  {...profile,secretReference:"THREADS_APP_SECRET"},
  {...profile,scopes:["ads_read","ads_read"]},
  {...profile,access_token:"synthetic-token"},
 ])("rejects changed deployment app, callback, authorization host or secret binding",candidate=>{expect(()=>configuredOAuthProfiles(origin,environment([candidate]))).toThrow();});
 it("rejects duplicate IDs, malformed metadata and missing named secrets",()=>{expect(()=>configuredOAuthProfiles(origin,environment([profile,profile]))).toThrow();expect(()=>configuredOAuthProfiles(origin,{...environment(),LUMIN_PLATFORM_OAUTH_PROFILES_JSON:"{"})).toThrow();expect(()=>configuredOAuthProfiles(origin,{...environment(),META_APP_SECRET:""})).toThrow();});
 it.each(["http://staging.example.com",`${origin}/path`,`${origin}?query=yes`])("requires an exact HTTPS service origin",value=>{expect(()=>configuredOAuthProfiles(value,environment())).toThrow();});
});
it('rejects deployment-only control mode on unrelated profiles before presenting consent',()=>{for(const candidate of [{...profile,marketingControlMode:'TRAFFIC'},{...profile,provider:'META_THREADS',strategy:'threads_login',tokenTypes:['threads'],marketingControlMode:'TRAFFIC'},{...profile,tokenTypes:['page'],marketingControlMode:'INSTANT_FORM_LEADS'}])expect(()=>configuredOAuthProfiles(origin,environment([candidate]))).toThrow();});
it('retains an immutable explicitly typed control mode for the exact Marketing USER profile',async()=>{const candidate={...profile,marketingControlMode:'TRAFFIC',capabilities:['marketing.activate.ad'],actions:['READ','ACTIVATE_SPEND'],scopes:['ads_read','ads_management','public_profile'],requiredTasks:['ADVERTISE']},configured=configuredOAuthProfiles(origin,environment([candidate]));expect((await configured.registry.get('ads'))?.marketingControlMode).toBe('TRAFFIC');candidate.marketingControlMode='INSTANT_FORM_LEADS';expect((await configured.registry.get('ads'))?.marketingControlMode).toBe('TRAFFIC');});
