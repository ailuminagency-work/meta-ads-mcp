import { createHash, randomBytes } from "node:crypto";
import type { Connection, PlatformPrincipal, Provider } from "./models.js";
import { PlatformDenied } from "./models.js";
import { canonicalJson } from "./policy.js";

export interface ConnectionProfile {
  id:string;provider:Provider;appId:string;strategy:"facebook_business"|"instagram_login"|"threads_login";
  scopes:string[];tokenTypes:Connection["tokenType"][];redirectUri:string;
  authorizeUrl:string;verified:boolean;configurationId?:string;
}
export interface ConnectionChallenge {
  id:string;principal:PlatformPrincipal;clientId:string;profileId:string;profileHash:string;
  redirectUri:string;nonceHash:string;expiresAt:number;consumedAt:number|null;
}
export interface ConnectionChallengeStore {
  create(challenge:ConnectionChallenge):Promise<void>;
  consume(id:string,nonceHash:string,expected:Omit<ConnectionChallenge,"id"|"nonceHash"|"expiresAt"|"consumedAt">,now:number):Promise<ConnectionChallenge|null>;
}
const digest=(v:string)=>createHash("sha256").update(v).digest("hex");
const officialHosts={facebook_business:"www.facebook.com",instagram_login:"www.instagram.com",threads_login:"threads.com"} as const;
export function validateConnectionProfile(profile:ConnectionProfile):void{
  if(!profile.verified || !profile.id || !profile.appId || !profile.scopes.length || !profile.tokenTypes.length || new Set(profile.scopes).size!==profile.scopes.length)throw new PlatformDenied("VERIFIED_INCREMENTAL_CONNECTION_PROFILE_REQUIRED");
  const redirect=new URL(profile.redirectUri),authorize=new URL(profile.authorizeUrl);
  if(redirect.protocol!=="https:" || redirect.username || redirect.password || redirect.search || redirect.hash || authorize.protocol!=="https:" || authorize.hostname!==officialHosts[profile.strategy] || authorize.username || authorize.password || authorize.search || authorize.hash || (authorize.port && authorize.port!=="443") || (redirect.port && redirect.port!=="443"))throw new PlatformDenied("VERIFIED_PROVIDER_HTTPS_ENDPOINT_REQUIRED");
  if(profile.strategy==="threads_login" && authorize.pathname!=="/oauth/authorize")throw new PlatformDenied("VERIFIED_PROVIDER_OAUTH_PATH_REQUIRED");
  if(profile.strategy==="facebook_business" && !/^\/v\d+\.\d+\/dialog\/oauth$/.test(authorize.pathname))throw new PlatformDenied("VERIFIED_PROVIDER_OAUTH_PATH_REQUIRED");
  if(profile.provider==="META_THREADS" && (profile.strategy!=="threads_login" || profile.tokenTypes.some(t=>t!=="threads")))throw new PlatformDenied("SEPARATE_THREADS_PROFILE_REQUIRED");
  if(profile.provider==="META_INSTAGRAM_LOGIN" && (profile.strategy!=="instagram_login" || profile.tokenTypes.some(t=>t!=="instagram")))throw new PlatformDenied("SEPARATE_INSTAGRAM_PROFILE_REQUIRED");
  if(!["META_THREADS","META_INSTAGRAM_LOGIN"].includes(profile.provider) && profile.strategy!=="facebook_business")throw new PlatformDenied("FACEBOOK_BUSINESS_PROFILE_REQUIRED");
}
export async function createConnectionChallenge(store:ConnectionChallengeStore,profile:ConnectionProfile,principal:PlatformPrincipal,clientId:string,now=Date.now()):Promise<{state:string;browserNonce:string}>{
  validateConnectionProfile(profile);
  const state=randomBytes(32).toString("hex"),browserNonce=randomBytes(32).toString("hex");
  await store.create({id:digest(state),principal:{...principal},clientId,profileId:profile.id,profileHash:digest(canonicalJson(profile)),redirectUri:profile.redirectUri,nonceHash:digest(browserNonce),expiresAt:now+600000,consumedAt:null});
  return {state,browserNonce};
}
export async function consumeConnectionChallenge(store:ConnectionChallengeStore,profile:ConnectionProfile,principal:PlatformPrincipal,clientId:string,state:string,browserNonce:string,now=Date.now()):Promise<void>{
  validateConnectionProfile(profile);
  if(!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browserNonce))throw new PlatformDenied("INVALID_CONNECTION_CHALLENGE");
  const challenge=await store.consume(digest(state),digest(browserNonce),{principal,clientId,profileId:profile.id,profileHash:digest(canonicalJson(profile)),redirectUri:profile.redirectUri},now);
  if(!challenge)throw new PlatformDenied("CONNECTION_CHALLENGE_EXPIRED_REPLAYED_OR_MISMATCHED");
}

// Transport adapters must exchange codes and independently inspect the actual
// token subject, app, type, grants and assets before creating a Connection.
// This module deliberately exposes no token-upload MCP tool or generic OAuth URL.
