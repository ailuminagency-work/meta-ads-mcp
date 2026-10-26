import {describe,expect,it} from "vitest";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {assetKey} from "../../src/platform/assets.js";
import {prepareClientAssetReassociation} from "../../src/platform/client-asset-reassociation.js";
import type {AssetGrant,Client,Connection,Member,MetaAsset,Tenant} from "../../src/platform/models.js";

const tenantId = "tenant", operatorId = "10228464085301890", oldClientId = "internal", targetClientId = "amazing-decks-seattle", accountId = "1383983957242175", ownerBusinessId = "114286761376026", appId = "1516397820295451", connectionId = "connection", grantId = "grant";
const capabilities = ["legacy.ads_get_ad_accounts","legacy.ads_get_account_info","legacy.ads_get_campaigns","legacy.ads_get_ad_sets","legacy.ads_get_ads","legacy.ads_get_insights"];

async function fixture(){
  const repo = new InMemoryPlatformRepository(), now = Date.now(), tenant:Tenant = {id:tenantId,status:"ACTIVE",policyRevision:1,registryRevision:1,migrationState:"READY"};
  const member:Member = {operatorId,tenantId,roles:["connection_admin","reader"],allowedClientIds:[oldClientId,targetClientId],revision:4,disabledAt:null};
  const oldClient:Client = {id:oldClientId,tenantId,status:"ACTIVE",revision:1,verifiedBusinessIds:[]};
  const targetClient:Client = {id:targetClientId,tenantId,status:"ACTIVE",revision:1,verifiedBusinessIds:[ownerBusinessId]};
  const asset:MetaAsset = {key:"",id:accountId,type:"AD_ACCOUNT",tenantId,clientId:oldClientId,provider:"META_MARKETING",appId,parents:[],verifiedAt:now-1000,revokedAt:null,revision:3,ownerBusinessId}; asset.key=assetKey(asset.provider,asset.appId,asset);
  const connection:Connection = {id:connectionId,tenantId,operatorId,subjectId:operatorId,metaAppUserId:operatorId,provider:"META_MARKETING",authStrategy:"facebook_business",credentialId:"credential",appId,tokenType:"user",scopes:["public_profile","ads_read"],assetKeys:[asset.key],verifiedAt:now-1000,expiresAt:now+3600000,revokedAt:null,revision:3,eligibility:[{requirement:"marketing_read_access:v26.0",source:"https://developers.facebook.com/docs/marketing-api/",checkedAt:now-1000,expiresAt:now+3599000,verified:true}]};
  const grant:AssetGrant = {id:grantId,tenantId,clientId:oldClientId,assetKey:asset.key,connectionId,capabilities,actions:["READ"],tasks:[],verifiedAt:now-1000,expiresAt:now+3599000,revokedAt:null,revision:4};
  await repo.put("tenants",tenantId,tenantId,tenant); await repo.put("operatorIndex","_index",operatorId,{operatorId,tenantId}); await repo.put("members",tenantId,operatorId,member); await repo.put("clients",tenantId,oldClientId,oldClient); await repo.put("clients",tenantId,targetClientId,targetClient); await repo.put("assets",tenantId,asset.key,asset); await repo.put("connections",tenantId,connectionId,connection); await repo.put("grants",tenantId,grantId,grant);
  return {repo,asset,connection,grant,member,oldClient,targetClient,tenant,now};
}

describe("validator-backed client asset reassociation",()=>{
  it("rejects the legacy proof-only control path",async()=>{const f=await fixture();expect(()=>prepareClientAssetReassociation({tenant:f.tenant,member:f.member,oldClient:f.oldClient,asset:f.asset,connection:f.connection,grant:f.grant,targetClientId,targetClient:f.targetClient,providerEvidence:{accountId,ownerBusinessId,appId,provider:"META_MARKETING",checkedAt:f.now,expiresAt:f.now+240000,source:"https://developers.facebook.com/docs/marketing-api/"},auditId:"reassoc-audit",planHash:"a".repeat(64)})).toThrow("CLIENT_ASSET_REASSOCIATION_EXACT_SCOPE_REQUIRED");});
  it("does not mutate source records when trusted discovery proof is absent",async()=>{const f=await fixture();expect(await f.repo.get("assets",tenantId,f.asset.key)).toMatchObject({clientId:oldClientId});expect(await f.repo.get("grants",tenantId,grantId)).toMatchObject({clientId:oldClientId,actions:["READ"]});});
});
