import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import { z } from "zod";
import { readBodyWithLimit } from "../utils/bounded-body.js";
import { PlatformDenied } from "./models.js";
import { validateConnectionProfile } from "./connection-profiles.js";
import type { TrustedOAuthProfile, VerifiedProviderAdapter } from "./oauth.js";

const id = z.string().regex(/^[0-9]{1,100}$/);
const token = z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/);
const seconds = z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER / 1000));
const shortSchema = z.object({ access_token: token, token_type: z.literal("bearer"), user_id: z.union([id, z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)]) });
const longSchema = z.object({ access_token: token, token_type: z.literal("bearer"), expires_in: seconds });
const debugSchema = z.object({ data: z.object({ is_valid: z.literal(true), type: z.literal("USER"), user_id: id, expires_at: seconds, data_access_expires_at: seconds, scopes: z.array(z.string().regex(/^threads_[a-z_]+$/)).min(1).max(100) }) });

/** Contract verified against Meta's Threads access-token, debug-token and profile
 * documentation. This is implementation evidence, not live provider acceptance.
 * Debug viewing with TH|app_id|app_secret is restricted by Meta to the same app:
 * https://developers.facebook.com/documentation/threads/troubleshooting/debug-access-token
 */
export function createThreadsOAuthAdapter(options: { fetch?: typeof fetch; now?: () => number } = {}): VerifiedProviderAdapter {
  const validateProfile=(profile:TrustedOAuthProfile):void=>{
    validateConnectionProfile(profile);
    if(profile.derivedTokenScopes!==undefined)throw new PlatformDenied("THREADS_DERIVED_SCOPE_PROFILE_DENIED");
    if(profile.provider!=="META_THREADS"||profile.strategy!=="threads_login"||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="threads"||profile.requiredTasks.length||!profile.capabilities.length||new Set(profile.capabilities).size!==profile.capabilities.length||!id.safeParse(profile.appId).success)throw new PlatformDenied("THREADS_OAUTH_PROFILE_UNVERIFIED_HOLD");
    const contracts=profile.capabilities.map(capability=>PRODUCT_CONTRACTS.find(c=>c.id===capability&&c.provider==="META_THREADS"&&c.verified&&c.tokenTypes.length===1&&c.tokenTypes[0]==="threads"));
    if(contracts.some(c=>!c||c.requiredTasks?.length||c.requiredTaskAssetType||c.operationClasses.some(action=>!["READ","WRITE_CONTENT","DELETE"].includes(action))))throw new PlatformDenied("THREADS_OAUTH_PROFILE_UNVERIFIED_HOLD");
    const scopes=new Set(["threads_basic",...contracts.flatMap(c=>c!.requiredScopes)]),actions=new Set(["READ",...contracts.flatMap(c=>c!.operationClasses)]);
    if(new Set(profile.actions).size!==profile.actions.length||profile.scopes.length!==scopes.size||profile.scopes.some(scope=>!scopes.has(scope))||profile.actions.length!==actions.size||profile.actions.some(action=>!actions.has(action)))throw new PlatformDenied("THREADS_OAUTH_PROFILE_UNVERIFIED_HOLD");
  };
  const request = async (url: URL, init?: RequestInit): Promise<unknown> => {
    try {
      const response = await (options.fetch ?? fetch)(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      return JSON.parse(await readBodyWithLimit(response, 65536)) as unknown;
    } catch { throw new PlatformDenied("THREADS_OAUTH_PROVIDER_RESPONSE_INVALID"); }
  };
  return { provider: "META_THREADS", verified: true, validateProfile, async exchangeAndInspect({ code, profile, appSecret, requestedAssets }) {
    try {
      validateProfile(profile);
      if (profile.provider !== "META_THREADS" || profile.strategy !== "threads_login" || profile.requiredTasks.length || !profile.scopes.includes("threads_basic") || profile.scopes.some(scope => !/^threads_[a-z_]+$/.test(scope)) || !/^[0-9]{1,100}$/.test(profile.appId) || !appSecret || /[|\s\x00-\x1f\x7f]/.test(appSecret) || !code || code.length > 4096 || /[\s\x00-\x1f\x7f]/.test(code) || !requestedAssets.length || requestedAssets.some(asset => asset.type !== "THREADS_ACCOUNT" || !id.safeParse(asset.id).success)) throw new Error();
      const started = (options.now ?? Date.now)();
      if (!Number.isSafeInteger(started) || started <= 0) throw new Error();
      const short = shortSchema.parse(await request(new URL("https://graph.threads.com/oauth/access_token"), { method: "POST", body: new URLSearchParams({ client_id: profile.appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: profile.redirectUri, code }) }));
      const longUrl = new URL("https://graph.threads.com/access_token");
      longUrl.search = new URLSearchParams({ grant_type: "th_exchange_token", client_secret: appSecret, access_token: short.access_token }).toString();
      const long = longSchema.parse(await request(longUrl));
      const debugUrl = new URL("https://graph.threads.com/v1.0/debug_token");
      debugUrl.search = new URLSearchParams({ access_token: `TH|${profile.appId}|${appSecret}`, input_token: long.access_token }).toString();
      const { data } = debugSchema.parse(await request(debugUrl));
      const meUrl = new URL("https://graph.threads.com/v1.0/me");
      meUrl.search = new URLSearchParams({ fields: "id", access_token: long.access_token }).toString();
      const me = z.object({ id }).parse(await request(meUrl));
      const now = (options.now ?? Date.now)();
      const expiresAt = Math.min(started + long.expires_in * 1000, data.expires_at * 1000, data.data_access_expires_at * 1000);
      if (!Number.isSafeInteger(now) || now < started || !Number.isSafeInteger(expiresAt) || expiresAt <= now || short.user_id !== data.user_id || me.id !== data.user_id || new Set(data.scopes).size !== data.scopes.length || data.scopes.length !== profile.scopes.length || profile.scopes.some(scope => !data.scopes.includes(scope)) || requestedAssets.some(asset => asset.id !== me.id)) throw new Error();
      return { accessToken: long.access_token, provider: "META_THREADS", appId: profile.appId, subjectId: me.id, tokenType: "threads", grantedScopes: data.scopes, expiresAt, assets: requestedAssets.map(asset => ({ ...asset, tasks: [] })) };
    } catch { throw new PlatformDenied("THREADS_OAUTH_INSPECTION_FAILED_HOLD"); }
  } };
}
