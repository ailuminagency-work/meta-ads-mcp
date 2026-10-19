import {randomUUID} from "node:crypto";
import {OwnershipEvidenceService} from "../../src/platform/ownership-service.js";
import {encryptCredential} from "../../src/platform/connections.js";
import {loadOwnershipEvidence} from "../../src/platform/ownership-evidence.js";
import type {PlatformRepository} from "../../src/platform/repository.js";
import type {PlatformPrincipal,AuthorizationSnapshot} from "../../src/platform/models.js";
/** Synthetic fixture authority creates a narrow bootstrap USER read connection; actual service then attests and observes fake provider ownership. */
export async function establishFinancialFixture(repo:PlatformRepository,principal:PlatformPrincipal,clientId:string,accountKey:string):Promise<void>{
 const currentMember=await repo.get("members",principal.tenantId,principal.operatorId);if(!currentMember?.roles.some(r=>["admin","connection_admin"].includes(r))){principal={tenantId:principal.tenantId,operatorId:`${principal.operatorId}-fixture-owner-reviewer`};await repo.put("members",principal.tenantId,principal.operatorId,{tenantId:principal.tenantId,operatorId:principal.operatorId,roles:["connection_admin","reader"],allowedClientIds:[clientId],disabledAt:null,revision:1});}
 const account=await repo.get("assets",principal.tenantId,accountKey),client=await repo.get("clients",principal.tenantId,clientId);if(!account||!client)throw new Error("Fixture account/client missing");const businessId=account.ownerBusinessId??client.verifiedBusinessIds[0];if(!businessId||!client.verifiedBusinessIds.includes(businessId))throw new Error("Fixture needs explicitly client-owned business");
 // Test fixtures must model the same independently verified billing state that
 // production policy requires.  Keep this mutation scoped to the synthetic
 // account before the attestation/observation control records are created;
 // ownershipAsset intentionally preserves the flag thereafter.
 if(account.billingOwnershipVerified!==true||account.ownerBusinessId!==businessId){
  await repo.put("assets",principal.tenantId,account.key,{...account,billingOwnershipVerified:true,ownerBusinessId:businessId});
 }
 await repo.put("operatorIndex","_index",principal.operatorId,principal);
 const now=Date.now(),suffix=randomUUID(),connectionId=`ownership-bootstrap-${suffix}`,credentialId=`ownership-credential-${suffix}`,grantId=`ownership-grant-${suffix}`;
 await repo.put("credentials",principal.tenantId,credentialId,encryptCredential({id:credentialId,tenantId:principal.tenantId,operatorId:principal.operatorId,provider:"META_MARKETING",appId:account.appId,keyVersion:"primary"},`synthetic-owner-${suffix}`));
 await repo.put("connections",principal.tenantId,connectionId,{id:connectionId,tenantId:principal.tenantId,operatorId:principal.operatorId,provider:"META_MARKETING",appId:account.appId,authStrategy:"synthetic-owner-bootstrap",credentialId,tokenType:"user",scopes:["ads_read"],assetKeys:[accountKey],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1,eligibility:[{requirement:"marketing_read_access:v26.0",source:"https://developers.facebook.com/docs/permissions",verified:true,checkedAt:now,expiresAt:now+3600000}]});
 await repo.put("grants",principal.tenantId,grantId,{id:grantId,tenantId:principal.tenantId,clientId,assetKey:accountKey,connectionId,capabilities:["legacy.ads_get_account_info"],actions:["READ"],tasks:[],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1});
 const service=new OwnershipEvidenceService(repo,async()=>new Response(JSON.stringify({id:`act_${account.id.replace(/^act_/,"")}`,account_id:account.id.replace(/^act_/,""),business:{id:businessId}})));
 await service.attest(principal,clientId,{accountKey,businessId,documentReferenceHash:"a".repeat(64),expiresAt:now+86400000});
 await service.observe({principal,clientId,provider:"META_MARKETING",tool:"meta_observe_account_owner",requestId:randomUUID()},accountKey,connectionId);
 // Keep fixture bootstrap records revoked so they cannot influence selection or count as active authority.
 const bootstrap=(await repo.get("connections",principal.tenantId,connectionId))!;await repo.put("connections",principal.tenantId,connectionId,{...bootstrap,revokedAt:Date.now(),revision:2});const grant=(await repo.get("grants",principal.tenantId,grantId))!;await repo.put("grants",principal.tenantId,grantId,{...grant,revokedAt:Date.now(),revision:2});
}
export async function attachFinancialSnapshot(repo:PlatformRepository,snapshot:AuthorizationSnapshot):Promise<AuthorizationSnapshot>{return {...snapshot,assets:await Promise.all(snapshot.assets.map(async a=>(await repo.get("assets",snapshot.tenant.id,a.key))!)),financialEvidence:await loadOwnershipEvidence(repo,{principal:{tenantId:snapshot.tenant.id,operatorId:snapshot.member.operatorId},clientId:snapshot.client.id,provider:"META_MARKETING",tool:"fixture",requestId:"fixture"},await repo.list("assets",snapshot.tenant.id))};}
