import express from "express";
import type {Server} from "node:http";
import {afterEach,expect,it,vi} from "vitest";
import {PlatformDenied} from "../../src/platform/models.js";
import {logger} from "../../src/utils/logger.js";
import {logOAuthFailure,oauthFailureCategory} from "../../src/platform/oauth-diagnostics.js";
import {createPlatformOAuthRouter} from "../../src/platform/oauth-router.js";
import type {PlatformOAuthService} from "../../src/platform/oauth.js";
let server:Server|undefined;
afterEach(async()=>{vi.restoreAllMocks();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;});
it("logs only allowlisted internal classifications, never arbitrary errors or properties",()=>{
 const warn=vi.spyOn(logger,"warn").mockImplementation(()=>{}),secret="synthetic-private-credential",known=new PlatformDenied("FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED");
 Object.assign(known,{message:secret,stack:secret,cause:{token:secret}});
 logOAuthFailure("provider_exchange",known);expect(warn).toHaveBeenLastCalledWith({event:"platform_oauth_failure",stage:"provider_exchange",reason:"FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED"},"Platform OAuth failed");
 for(const error of [new Error(secret),new PlatformDenied(secret),{reason:"FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED",token:secret},new Error("FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED")])logOAuthFailure("callback",error);
 expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);expect(warn.mock.calls.slice(1).every(call=>(call[0] as {reason:string}).reason==="UNEXPECTED_INTERNAL_FAILURE")).toBe(true);
 const getter=new PlatformDenied("CLIENT_CONNECTION_ADMIN_REQUIRED");Object.defineProperty(getter,"reason",{get(){throw new Error(secret);}});expect(oauthFailureCategory(getter)).toBe("UNEXPECTED_INTERNAL_FAILURE");
});
it.each([new PlatformDenied("CLIENT_CONNECTION_ADMIN_REQUIRED"),new Error("synthetic-private-code-token-url")])("callback keeps public HOLD generic and logs only a safe classification",async failure=>{
 const warn=vi.spyOn(logger,"warn").mockImplementation(()=>{}),app=express(),state="a".repeat(64),nonce="b".repeat(64);
 app.use("/oauth",createPlatformOAuthRouter({publicOrigin:"https://fixture.invalid",getSessionOperator:async()=>"synthetic-private-operator",service:{callback:async()=>{throw failure;}} as unknown as PlatformOAuthService}));
 server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server!.once("listening",resolve));const address=server.address();if(!address||typeof address==="string")throw new Error();
 const cookie=Buffer.from(JSON.stringify({clientId:"client",nonce})).toString("base64url"),response=await fetch(`http://127.0.0.1:${address.port}/oauth/profile/callback?state=${state}&code=synthetic-private-code`,{headers:{cookie:`__Host-lumin-connect-${state}=${cookie}`}});
 expect(response.status).toBe(503);expect(await response.json()).toEqual({status:"HOLD",reason:"OAUTH_CALLBACK_UNAVAILABLE"});expect(warn).toHaveBeenCalledOnce();expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-private");expect(JSON.stringify(warn.mock.calls)).not.toContain(state);
});

it.each(["FACEBOOK_GRAPH_PERMISSION_DENIED","FACEBOOK_GRAPH_TOKEN_INVALID"])("retains safe provider classification %s",reason=>{
 const warn=vi.spyOn(logger,"warn").mockImplementation(()=>{});logOAuthFailure("provider_exchange",new PlatformDenied(reason));expect(warn).toHaveBeenCalledWith({event:"platform_oauth_failure",stage:"provider_exchange",reason},"Platform OAuth failed");
});
