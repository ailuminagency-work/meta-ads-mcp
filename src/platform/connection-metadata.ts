import type {Connection,OperationContext} from "./models.js";
import {PlatformDenied} from "./models.js";
import type {PlatformRepository,Preparation} from "./repository.js";
import {canonicalJson} from "./policy.js";
import {connectionPrivacyAppUserId} from "./privacy-identity.js";

export interface ConnectionMetadataCheckpoint {context:OperationContext;expected:Preparation["expectedRecords"];connectionIds:string[]}
export interface ConnectionMetadataRepository extends PlatformRepository {assertConnectionMetadataCurrent(input:ConnectionMetadataCheckpoint):Promise<void>}
export function connectionMetadataLockScopes(input:ConnectionMetadataCheckpoint,authAppId=process.env.META_APP_ID){
 const connections=validateConnectionMetadataCheckpoint(input),scopes=connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}));
 if(authAppId!==undefined){if(!/^\d{1,100}$/.test(authAppId))throw new PlatformDenied("CONNECTION_METADATA_AUTH_APP_INVALID");scopes.push({appId:authAppId,operatorId:input.context.principal.operatorId,appUserId:input.context.principal.operatorId});}
 return [...new Map(scopes.map(s=>[JSON.stringify(s),s])).values()];
}
/** Used again inside the final readonly repository transaction. No credential is read. */
export function validateConnectionMetadataCheckpoint(input:ConnectionMetadataCheckpoint,now=Date.now()):Connection[]{
 if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("CONNECTION_METADATA_CLOCK_INVALID");
 const {principal,clientId}=input.context,rows=input.expected;
 if(!Array.isArray(rows)||rows.length>2100||rows.reduce((total,r)=>total+(typeof r?.canonical==="string"?r.canonical.length:0),0)>2097152||!Array.isArray(input.connectionIds)||input.connectionIds.length>1000||new Set(input.connectionIds).size!==input.connectionIds.length||rows.some(r=>!r||!["tenants","members","clients","assets","connections"].includes(r.collection)||typeof r.id!=="string"||typeof r.canonical!=="string"||r.canonical.length>131072)||new Set(rows.map(r=>r.collection+":"+r.id)).size!==rows.length)throw new PlatformDenied("CONNECTION_METADATA_SCHEMA_INVALID");
 const get=(collection:string,id:string)=>{const found=rows.filter(r=>r.collection===collection&&r.id===id);if(found.length!==1)throw new PlatformDenied("CONNECTION_METADATA_SCOPE_REQUIRED");try{const value=JSON.parse(found[0].canonical);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value;}catch{throw new PlatformDenied("CONNECTION_METADATA_SCHEMA_INVALID");}};
 const tenant=get("tenants",principal.tenantId),member=get("members",principal.operatorId),client=get("clients",clientId);
 if(!tenant||!member||!client||!Array.isArray(member.allowedClientIds)||!Array.isArray(member.roles)||tenant.id!==principal.tenantId||tenant.status!=="ACTIVE"||tenant.migrationState!=="READY"||member.operatorId!==principal.operatorId||member.tenantId!==principal.tenantId||member.disabledAt!==null||!member.allowedClientIds.includes(clientId)||!member.roles.some((r:string)=>["reader","writer","admin","approver","connection_admin"].includes(r))||client.id!==clientId||client.tenantId!==principal.tenantId||client.status!=="ACTIVE")throw new PlatformDenied("CLIENT_ACCESS_REQUIRED");
 return input.connectionIds.map(id=>{const c=get("connections",id) as Connection;
  if(!c||!Array.isArray(c.scopes)||!c.scopes.every(s=>typeof s==="string")||!Array.isArray(c.assetKeys)||!c.assetKeys.every(s=>typeof s==="string")||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||!["META_MARKETING","META_FACEBOOK_PAGES","META_INSTAGRAM_FACEBOOK_LOGIN","META_INSTAGRAM_LOGIN","META_MESSENGER","META_WHATSAPP","META_THREADS","META_BUSINESS"].includes(c.provider)||!["user","page","system_user","business_integration_system_user","instagram","threads"].includes(c.tokenType)||c.scopes.length>100||c.assetKeys.length>1000||c.id!==id||c.tenantId!==principal.tenantId||c.operatorId!==principal.operatorId||!/^\d{1,100}$/.test(c.appId)||c.revokedAt!==null||c.expiresAt!==null&&(!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now)||!Number.isSafeInteger(c.verifiedAt)||c.verifiedAt<=0||c.verifiedAt>now||!c.scopes.every(s=>/^[a-z][a-z0-9_]{0,99}$/.test(s)))throw new PlatformDenied("CONNECTION_METADATA_BINDING_INVALID");
  connectionPrivacyAppUserId(c);
  const visible=rows.some(r=>{if(r.collection!=="assets")return false;let a;try{a=JSON.parse(r.canonical);}catch{throw new PlatformDenied("CONNECTION_METADATA_SCHEMA_INVALID");}if(!a||typeof a!=="object"||Array.isArray(a))throw new PlatformDenied("CONNECTION_METADATA_SCHEMA_INVALID");return a.key===r.id&&c.assetKeys.includes(a.key)&&a.tenantId===principal.tenantId&&a.clientId===clientId&&a.appId===c.appId&&a.provider===c.provider&&a.revokedAt===null;});
  if(!visible)throw new PlatformDenied("CONNECTION_METADATA_CLIENT_BINDING_REQUIRED");return c;
 });
}
export async function listConnectionMetadata(repo:PlatformRepository,context:OperationContext){
 const checkpoint=(repo as Partial<ConnectionMetadataRepository>).assertConnectionMetadataCurrent;if(!checkpoint)throw new PlatformDenied("CONNECTION_METADATA_ATOMIC_ADAPTER_REQUIRED");
 const {principal,clientId}=context,[tenant,member,client,assets,connections]=await Promise.all([repo.get("tenants",principal.tenantId,principal.tenantId),repo.get("members",principal.tenantId,principal.operatorId),repo.get("clients",principal.tenantId,clientId),repo.list("assets",principal.tenantId),repo.list("connections",principal.tenantId)]);
 if(!tenant||!member||!client||assets.length>1000||connections.length>1000)throw new PlatformDenied("CONNECTION_METADATA_SCOPE_REQUIRED");
 const ownAssets=assets.filter(a=>a.tenantId===principal.tenantId&&a.clientId===clientId&&a.revokedAt===null),selected=connections.filter(c=>c.tenantId===principal.tenantId&&c.operatorId===principal.operatorId&&c.revokedAt===null&&(c.expiresAt===null||c.expiresAt>Date.now())&&ownAssets.some(a=>c.assetKeys.includes(a.key)&&a.appId===c.appId&&a.provider===c.provider));
 const expected:Preparation["expectedRecords"]=[{collection:"tenants",id:tenant.id,canonical:canonicalJson(tenant)},{collection:"members",id:member.operatorId,canonical:canonicalJson(member)},{collection:"clients",id:client.id,canonical:canonicalJson(client)},...ownAssets.filter(a=>selected.some(c=>c.assetKeys.includes(a.key)&&c.appId===a.appId&&c.provider===a.provider)).map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...selected.map(c=>({collection:"connections" as const,id:c.id,canonical:canonicalJson(c)}))];
 const input={context:structuredClone(context),expected,connectionIds:selected.map(c=>c.id)};validateConnectionMetadataCheckpoint(input);await checkpoint.call(repo,input);
 // No async work after final atomic authority check; repeat deadlines before projection.
 return validateConnectionMetadataCheckpoint(input).map(c=>({id:c.id,provider:c.provider,token_type:c.tokenType,granted_scopes:[...c.scopes],expires_at:c.expiresAt,verified_at:c.verifiedAt,revoked:false}));
}
