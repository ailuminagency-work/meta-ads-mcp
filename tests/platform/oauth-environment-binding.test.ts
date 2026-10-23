import {describe,expect,it} from "vitest";
import {assertConfiguredOAuthApp} from "../../src/platform/connection-runtime.js";
import type {Provider} from "../../src/platform/models.js";
describe("OAuth factory app identity before consent",()=>{
  it.each([
    {provider:"META_MARKETING",prefix:"META"},{provider:"META_BUSINESS",prefix:"META"},{provider:"META_FACEBOOK_PAGES",prefix:"META"},{provider:"META_MESSENGER",prefix:"META"},{provider:"META_INSTAGRAM_FACEBOOK_LOGIN",prefix:"META"},{provider:"META_WHATSAPP",prefix:"META"},{provider:"META_THREADS",prefix:"THREADS"},{provider:"META_INSTAGRAM_LOGIN",prefix:"INSTAGRAM"},
  ])("binds $provider profile to the configured $prefix app and matching secret reference",({provider,prefix})=>{
    const profile={provider:provider as Provider,appId:"123",secretReference:`${prefix}_APP_SECRET`},env={[`${prefix}_APP_ID`]:"123"};expect(()=>assertConfiguredOAuthApp(profile,env)).not.toThrow();
    for(const appId of [undefined,"999","not-numeric"]){expect(()=>assertConfiguredOAuthApp(profile,{[`${prefix}_APP_ID`]:appId})).toThrow("CONFIGURED_APP_BINDING");}
    expect(()=>assertConfiguredOAuthApp({...profile,appId:"999"},env)).toThrow("CONFIGURED_APP_BINDING");expect(()=>assertConfiguredOAuthApp({...profile,secretReference:"OTHER_APP_SECRET"},env)).toThrow("CONFIGURED_APP_BINDING");
  });
});
