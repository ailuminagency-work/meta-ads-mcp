import {attachmentRoot} from "./attachment-source.js";
import {PlatformDenied,type MetaAsset,type AssetGrant,type Provider} from "./models.js";
import type {ControlCommit,PlatformRepository} from "./repository.js";
import {resolveAuthorizedAssets} from "./assets.js";
import {selectConnection} from "./connections.js";
import {canonicalJson} from "./policy.js";
import {applyProductTaskRequirements} from "./product-task-requirements.js";
import {attachmentContracts} from "./attachment-policy.js";
import type {AttachmentBinding} from "./attachment-source.js";

export async function attachmentAuthorization(repo:PlatformRepository,binding:AttachmentBinding,now=Date.now()):Promise<{expected:ControlCommit["expected"];root:MetaAsset;grants:AssetGrant[]}> {
 const principal=await repo.resolvePrincipal(binding.operatorId),[tenant,member,client]=await Promise.all([repo.get("tenants",binding.tenantId,binding.tenantId),repo.get("members",binding.tenantId,binding.operatorId),repo.get("clients",binding.tenantId,binding.clientId)]);
 if(!principal||principal.tenantId!==binding.tenantId||principal.operatorId!==binding.operatorId||!tenant||tenant.id!==binding.tenantId||tenant.status!=="ACTIVE"||tenant.migrationState!=="READY"||!member||member.tenantId!==binding.tenantId||member.operatorId!==binding.operatorId||member.disabledAt!==null||!member.roles.some(r=>["admin","connection_admin"].includes(r))||!member.allowedClientIds.includes(binding.clientId)||!client||client.tenantId!==binding.tenantId||client.id!==binding.clientId||client.status!=="ACTIVE")throw new PlatformDenied("ATTACHMENT_ADMIN_REQUIRED");
 const contracts=attachmentContracts(binding.purpose),ctx={principal,clientId:binding.clientId,provider:binding.provider as Provider,tool:"internal_publishing_video_enrollment",requestId:"signed-video"},assets=await resolveAuthorizedAssets(repo,ctx,[{type:attachmentRoot(binding.provider),id:binding.accountId}],now,300000),root=assets.find(a=>a.type===attachmentRoot(binding.provider)&&a.id===binding.accountId);
 if(!root||assets.some(a=>a.appId!==binding.appId))throw new PlatformDenied("ATTACHMENT_OWNER_ROOT_REQUIRED");
 let connection;
 for(const contract of contracts){const plan=applyProductTaskRequirements({parameters:{},assets:assets.map(a=>({type:a.type,id:a.id})),classes:["READ"],capability:contract.id,requiredScopes:contract.requiredScopes,tokenTypes:contract.tokenTypes},contract,assets);const selected=await selectConnection(repo,ctx,plan,assets,now,binding.connectionId);if(connection&&connection.id!==selected.id)throw new PlatformDenied("ATTACHMENT_SINGLE_CONNECTION_REQUIRED");connection=selected;}
 if(!connection||connection.appId!==binding.appId||connection.expiresAt===null||connection.verifiedAt<=0||connection.verifiedAt>now||now-connection.verifiedAt>300000)throw new PlatformDenied("ATTACHMENT_CURRENT_CONNECTION_REQUIRED");
 const grants=(await repo.list("grants",binding.tenantId)).filter(g=>g.connectionId===connection!.id&&g.tenantId===binding.tenantId&&g.clientId===binding.clientId&&assets.some(a=>a.key===g.assetKey)&&g.revokedAt===null&&g.expiresAt>now&&g.verifiedAt>0&&g.verifiedAt<=now&&now-g.verifiedAt<=300000&&g.actions.includes("READ")&&g.actions.includes("WRITE_MESSAGING")&&contracts.every(c=>g.capabilities.includes(c.id)));
 for(const asset of assets)if(!grants.some(g=>g.assetKey===asset.key&&g.actions.includes("READ")&&g.actions.includes("WRITE_MESSAGING")&&contracts.every(c=>g.capabilities.includes(c.id))))throw new PlatformDenied("ATTACHMENT_OWNER_GRANTS_REQUIRED");
 return {root,grants,expected:[{collection:"tenants",id:tenant.id,canonical:canonicalJson(tenant)},{collection:"members",id:member.operatorId,canonical:canonicalJson(member)},{collection:"clients",id:client.id,canonical:canonicalJson(client)},{collection:"connections",id:connection.id,canonical:canonicalJson(connection)},...assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)}))]};
}
