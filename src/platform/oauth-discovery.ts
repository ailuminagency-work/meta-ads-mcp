import {createHash} from "node:crypto";
import {encryptToken,decryptToken,type EncryptedPayload} from "../auth/crypto.js";
import {canonicalJson} from "./policy.js";
import {PlatformDenied} from "./models.js";
import type {OAuthDiscoveredAsset} from "./oauth.js";
export interface OAuthDiscoveryInspection {
  accessToken:string; provider:string; appId:string; subjectId:string;
  tokenType:string; grantedScopes:string[]; expiresAt:number;
  assets:OAuthDiscoveredAsset[];
}

export interface OAuthDiscoveryProposal {
  id:string; kind:"OAUTH_ASSET_DISCOVERY"; tenantId:string; clientId:string; operatorId:string; profileId:string;
  provider:"META_MARKETING"; appId:string; subjectId:string; grantedScopes:string[];
  assets:OAuthDiscoveredAsset[]; checkedAt:number; expiresAt:number; consumedAt:number|null;
  expected:Array<{collection:"tenants"|"members"|"clients";id:string;canonical:string}>;
  encryptedInspection:EncryptedPayload; planHash:string;
}
function identity(p:Pick<OAuthDiscoveryProposal,"id"|"tenantId"|"clientId"|"operatorId"|"profileId"|"appId"|"subjectId"|"checkedAt"|"expiresAt">){return {purpose:"lumin-oauth-discovery",version:1,id:p.id,tenantId:p.tenantId,clientId:p.clientId,operatorId:p.operatorId,profileId:p.profileId,appId:p.appId,subjectId:p.subjectId,checkedAt:p.checkedAt,expiresAt:p.expiresAt};}
export function oauthDiscoveryAad(p:Pick<OAuthDiscoveryProposal,"id"|"tenantId"|"clientId"|"operatorId"|"profileId"|"appId"|"subjectId"|"checkedAt"|"expiresAt">):string{return canonicalJson(identity(p));}
export function oauthDiscoveryHash(p:OAuthDiscoveryProposal):string{return createHash("sha256").update(canonicalJson({identity:identity(p),assets:p.assets,expected:p.expected,grantedScopes:p.grantedScopes})).digest("hex");}
export function encryptOAuthDiscoveryInspection(p:OAuthDiscoveryProposal,inspection:OAuthDiscoveryInspection):EncryptedPayload {
  if(!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("OAUTH_DISCOVERY_ENCRYPTION_REQUIRED");
  const text=canonicalJson(inspection);if(text.length>131072)throw new PlatformDenied("OAUTH_DISCOVERY_INSPECTION_TOO_LARGE");
  return encryptToken(text,oauthDiscoveryAad(p));
}
export function decryptOAuthDiscoveryInspection(p:OAuthDiscoveryProposal):OAuthDiscoveryInspection {
  try {
    if(!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw Error();
    const value=JSON.parse(decryptToken(p.encryptedInspection,oauthDiscoveryAad(p))) as OAuthDiscoveryInspection;
    const normalizedAssets=value.assets.map(a=>({type:a.type,id:a.id.replace(/^act_/ ,""),tasks:[...a.tasks],...(a.name?{name:a.name}:{}),...(a.businessId?{businessId:a.businessId}:{}),...(a.businessName?{businessName:a.businessName}:{})}));
    if(value.provider!==p.provider||value.appId!==p.appId||value.subjectId!==p.subjectId||canonicalJson(value.grantedScopes)!==canonicalJson(p.grantedScopes)||canonicalJson(normalizedAssets)!==canonicalJson(p.assets))throw Error();
    return value;
  } catch { throw new PlatformDenied("OAUTH_DISCOVERY_INSPECTION_INVALID"); }
}
