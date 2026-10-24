import express from "express";
import type { Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { PlatformDenied } from "../../src/platform/models.js";
import { logger } from "../../src/utils/logger.js";
import {
  CALLBACK_RECOVERY, classifyCallbackQuery, classifyCallbackServiceFailure,
  renderCallbackRecoveryHtml,
} from "../../src/platform/oauth-callback-recovery.js";
import { createPlatformOAuthRouter } from "../../src/platform/oauth-router.js";
import type { PlatformOAuthService } from "../../src/platform/oauth.js";

let server:Server|undefined;
afterEach(async()=>{
  vi.restoreAllMocks();
  if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  server=undefined;
});

async function fixture(input?:{
  operator?:string|null;
  callback?:()=>Promise<unknown>;
}) {
  const callback=vi.fn(input?.callback??(async()=>({assetCount:1})));
  const app=express();
  app.use("/oauth",createPlatformOAuthRouter({
    publicOrigin:"https://fixture.invalid",
    getSessionOperator:async()=>input?.operator===undefined?"fixture-operator":input.operator,
    service:{callback} as unknown as PlatformOAuthService,
  }));
  server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server!.once("listening",resolve));
  const address=server.address();
  if(!address||typeof address==="string")throw Error("Invalid test server");
  const endpoint="http://127.0.0.1:"+address.port+"/oauth/meta-readonly/callback";
  return {callback,endpoint};
}
const state="a".repeat(64);
const validQuery="?state="+state+"&code=synthetic-code";
const cookieName="__Host-lumin-connect-"+state;
const encodedCookie=(data:unknown)=>Buffer.from(JSON.stringify(data)).toString("base64url");
const nonce="b".repeat(64);
const cookieHeader=(raw:string)=>cookieName+"="+raw;

it("provides at least 15 distinct, explicit safe callback recovery resolutions",()=>{
  const keys=Object.keys(CALLBACK_RECOVERY);
  expect(keys.length).toBeGreaterThanOrEqual(15);
  for(const action of Object.values(CALLBACK_RECOVERY)){
    expect(action.title.length).toBeGreaterThan(9);
    expect(action.explanation.length).toBeGreaterThan(25);
    expect(action.actionPath).toBe("/platform/connections/");
    expect(["operator","account_owner","agency_operator","engineer"]).toContain(action.actor);
    const html=renderCallbackRecoveryHtml(keys.find(key=>CALLBACK_RECOVERY[key as keyof typeof CALLBACK_RECOVERY]===action)! as keyof typeof CALLBACK_RECOVERY);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("access_token=");
    expect(html).toContain('href="/platform/connections/"');
  }
});

it.each([
  ["missing state", {code:"secret-code"}, "CALLBACK_STATE_MISSING"],
  ["invalid state", {state:"secret-state",code:"secret-code"}, "CALLBACK_STATE_INVALID"],
  ["duplicate state", {state:[state,"other"],code:"secret-code"}, "CALLBACK_STATE_DUPLICATED"],
  ["missing code", {state}, "CALLBACK_CODE_MISSING"],
  ["empty code", {state,code:""}, "CALLBACK_CODE_INVALID"],
  ["large code", {state,code:"x".repeat(4097)}, "CALLBACK_CODE_INVALID"],
  ["duplicate code", {state,code:["a","b"]}, "CALLBACK_CODE_DUPLICATED"],
  ["provider denial", {error:"access_denied",state,error_description:"private"}, "PROVIDER_CONSENT_DENIED"],
  ["provider error", {error:"temporarily_unavailable",state,error_description:"private"}, "PROVIDER_AUTHORIZATION_ERROR"],
  ["ambiguous success and failure", {error:"access_denied",state,code:"secret"}, "CALLBACK_AMBIGUOUS_RESULT"],
  ["unexpected query", {state,code:"secret",extraneous:"private"}, "CALLBACK_QUERY_INVALID"],
  ["invalid profile", {state,code:"secret"}, "CALLBACK_PROFILE_INVALID"],
] as const)("classifies %s without echoing untrusted fields",(_name,query,reason)=>{
  const result=classifyCallbackQuery(query,reason==="CALLBACK_PROFILE_INVALID"?"invalid/path":"meta-readonly");
  expect(result).toBe(reason);
  expect(JSON.stringify(result)).not.toContain("private");
});

it("accepts exact valid query shape without falsely marking a successful callback",()=>{
  expect(classifyCallbackQuery({state,code:"synthetic-code"},"meta-readonly")).toBeNull();
});

it.each([
  ["CONNECTION_CHALLENGE_EXPIRED_REPLAYED_OR_MISMATCHED","CONNECTION_CHALLENGE_INVALID"],
  ["FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED","AUTHORIZATION_SCOPE_REVIEW"],
  ["FACEBOOK_OAUTH_DEBUG_TOKEN_RESPONSE_INVALID","PROVIDER_RESPONSE_REVIEW"],
  ["CLIENT_CONNECTION_ADMIN_REQUIRED","AUTHORIZATION_ASSET_REVIEW"],
  ["FACEBOOK_GRAPH_PERMISSION_DENIED","AUTHORIZATION_ASSET_REVIEW"],
  ["sensitive-private-provider-message","CALLBACK_SERVICE_REVIEW"],
] as const)("maps service failure %s to known action", (reason,recovery)=>{
  const classified=classifyCallbackServiceFailure(reason);
  expect(classified).toBe(recovery);
  expect(JSON.stringify(renderCallbackRecoveryHtml(classified))).not.toContain("sensitive-private-provider-message");
});

it.each([
  ["absent",undefined,"CALLBACK_COOKIE_MISSING"],
  ["not base64url","--not-canonical@@","CALLBACK_COOKIE_INVALID"],
  ["bad JSON",Buffer.from("not-json").toString("base64url"),"CALLBACK_COOKIE_INVALID"],
  ["missing nonce",encodedCookie({clientId:"fixture-client"}),"CALLBACK_NONCE_INVALID"],
  ["invalid nonce",encodedCookie({clientId:"fixture-client",nonce:{toString:null}}),"CALLBACK_NONCE_INVALID"],
  ["forged client",encodedCookie({clientId:"fixture-client",nonce,admin:true}),"CALLBACK_COOKIE_INVALID"],
] as const)("returns 403 rather than generic 503 for %s browser state",async(_label,cookie,reason)=>{
  const warn=vi.spyOn(logger,"warn").mockImplementation(()=>{});
  const {callback,endpoint}=await fixture();
  const headers=cookie===undefined?{}:{cookie:cookieHeader(cookie)};
  const res=await fetch(endpoint+validQuery,{headers});
  expect(res.status).toBe(403);
  expect(callback).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    {event:"platform_oauth_callback_blocked",reason},
    "Platform OAuth callback requires a new authorized action",
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-client");
});

it("gives a safe HTML restart option without invoking Meta or reusing a callback",async()=>{
  const {callback,endpoint}=await fixture();
  const res=await fetch(endpoint+"?error=access_denied&error_description=synthetic-private-token",{headers:{accept:"text/html"}});
  expect(res.status).toBe(400);
  const html=await res.text();
  expect(html).toContain("Meta permission was not approved");
  expect(html).toContain('href="/platform/connections/"');
  expect(html).not.toContain("synthetic-private-token");
  expect(html).not.toContain("access_denied");
  expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(callback).not.toHaveBeenCalled();
});

it("operator session expiry gives a first-party sign-in path without exchanging a code",async()=>{
  const {callback,endpoint}=await fixture({operator:null});
  const res=await fetch(endpoint+validQuery,{headers:{accept:"text/html"}});
  expect(res.status).toBe(401);
  expect(await res.text()).toContain("Lumin sign-in expired");
  expect(callback).not.toHaveBeenCalled();
});

it("recognized scope mismatch stays denied and presents technical review, not a scope bypass",async()=>{
  const {callback,endpoint}=await fixture({
    callback:async()=>{throw new PlatformDenied("FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED");},
  });
  const warn=vi.spyOn(logger,"warn").mockImplementation(()=>{});
  const encoded=encodedCookie({clientId:"fixture-client",nonce});
  const res=await fetch(endpoint+validQuery,{
    headers:{accept:"text/html",cookie:cookieHeader(encoded)},
  });
  expect(res.status).toBe(503);
  expect(await res.text()).toContain("Meta permissions require administrator review");
  expect(callback).toHaveBeenCalledOnce();
  expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-client");
});

it("no Accept HTML preserves the current generic JSON contract on callback service failures",async()=>{
  const {endpoint}=await fixture({callback:async()=>{throw new Error("synthetic-private-secret");}});
  const encoded=encodedCookie({clientId:"fixture-client",nonce});
  const res=await fetch(endpoint+validQuery,{headers:{cookie:cookieHeader(encoded)}});
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({status:"HOLD",reason:"OAUTH_CALLBACK_UNAVAILABLE"});
});
