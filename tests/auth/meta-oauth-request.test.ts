import {afterEach, describe, expect, it, vi} from "vitest";
import {exchangeCodeForToken, exchangeForLongLivedToken, fetchPrimaryBusiness} from "../../src/auth/meta-oauth.js";
import {logger} from "../../src/utils/logger.js";
import {MetaOAuthRequestError} from "../../src/auth/meta-oauth-request.js";

const config = {appId:"123",appSecret:"fixture-only",redirectUri:"https://example.com/auth/meta/callback",apiVersion:"v26.0"};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe("Meta authentication exchange failures",()=>{
  it("classifies invalid app credentials without retaining provider text or secrets",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({error:{message:"Error validating client secret. sensitive-provider-text",code:1}}),{status:400}));
    const error=await exchangeCodeForToken(config,"one-time-code").catch(e=>e);
    expect(error).toBeInstanceOf(MetaOAuthRequestError);
    expect(error).toMatchObject({kind:"configuration",stage:"code-exchange",providerCode:1});
    expect(String(error)).not.toMatch(/sensitive-provider-text|fixture-only|one-time-code/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{}, {access_token:null}, {access_token:123}, {access_token:""}, {access_token:"token with spaces"}, {access_token:"fixture",expires_in:-1}])("rejects malformed successful token responses %j",async body=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(exchangeCodeForToken(config,"code")).rejects.toMatchObject({kind:"invalid-response"});
  });
  it("bounds the whole exchange and refuses redirects or automatic retries",async()=>{
    vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network failure including sensitive URL"));
    await expect(exchangeCodeForToken(config,"code")).rejects.toMatchObject({kind:"unavailable"});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({redirect:"error",signal:expect.any(AbortSignal)});
  });
  it("enforces its deadline even when response-body parsing ignores abort",async()=>{
    vi.useFakeTimers();
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,status:200,json:()=>new Promise(()=>{})} as Response);
    const pending=expect(exchangeCodeForToken(config,'code')).rejects.toMatchObject({kind:'unavailable'});
    await vi.advanceTimersByTimeAsync(15_001);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("classifies provider overload separately from invalid credentials",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response('{}',{status:503}));
    await expect(exchangeForLongLivedToken(config,"fixture-token")).rejects.toMatchObject({kind:"unavailable",stage:"token-exchange"});
  });
  it("rejects non-JSON responses without leaking their content",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response('private proxy failure',{status:502}));
    await expect(exchangeCodeForToken(config,"code")).rejects.toThrow('Meta authentication failed (code-exchange: unavailable)');
  });
  it("accepts valid tokens and uses provider lifetime",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({access_token:"fixture-token",expires_in:3600})));
    const before=Math.floor(Date.now()/1000);
    expect(await exchangeForLongLivedToken(config,"short-token")).toEqual({accessToken:"fixture-token",expiresAt:before+3600});
  });
  it.each(['provider','network'])("keeps optional business lookup %s failures secret-safe",async mode=>{
    const warn=vi.spyOn(logger,'warn').mockImplementation(()=>{});
    const network=vi.spyOn(globalThis,'fetch');
    if(mode==='provider')network.mockResolvedValue(new Response(JSON.stringify({error:{message:'synthetic-sensitive-marker',code:200}}),{status:400}));
    else network.mockRejectedValue(new Error('synthetic-sensitive-marker'));
    expect(await fetchPrimaryBusiness('fixture-token')).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-sensitive-marker');
    expect(warn.mock.calls[0][0]).toMatchObject({stage:'business-lookup',kind:mode==='provider'?'provider':'unavailable'});
  });
});
