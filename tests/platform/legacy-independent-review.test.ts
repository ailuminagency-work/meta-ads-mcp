import { logger } from "../../src/utils/logger.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeOperation, runWithExecutionPermit } from "../../src/platform/execution.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { requestContext } from "../../src/auth/token-store.js";
import { MetaApiClient } from "../../src/meta/client.js";
import { encryptCredential } from "../../src/platform/connections.js";
import type { Connection, OperationPlan } from "../../src/platform/models.js";
import { buildStrictLegacyWritePlan } from "../../src/platform/legacy-write.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
const ctx={principal:{tenantId:"tenant",operatorId:"operator"},clientId:"client",provider:"META_MARKETING" as const,tool:"ads_get_account_info",requestId:"independent"};
const source="https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi";
async function fixture(eligibility=true,eligibilityExpiresIn=3600000){
  const repo=new InMemoryPlatformRepository(),now=Date.now();
  await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",policyRevision:1,registryRevision:1,migrationState:"READY"});
  await repo.put("members","tenant","operator",{operatorId:"operator",tenantId:"tenant",roles:["reader"],allowedClientIds:["client"],revision:1,disabledAt:null});
await repo.put("operatorIndex","_index","operator",{operatorId:"operator",tenantId:"tenant"});
  await repo.put("clients","tenant","client",{id:"client",tenantId:"tenant",status:"ACTIVE",revision:1,verifiedBusinessIds:[]});
  const asset={id:"101",key:"account",type:"AD_ACCOUNT" as const,tenantId:"tenant",clientId:"client",provider:"META_MARKETING" as const,appId:"app",parents:[],verifiedAt:now,revokedAt:null,revision:1};await repo.put("assets","tenant",asset.key,asset);
  const connection:Connection={id:"narrow",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",appId:"app",authStrategy:"facebook_business",credentialId:"credential",tokenType:"user",scopes:["ads_read"],assetKeys:[asset.key],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1,eligibility:eligibility?[{requirement:"marketing_read_access:v26.0",verified:true,source,checkedAt:now,expiresAt:now+eligibilityExpiresIn}]:[]};
  await repo.put("connections","tenant",connection.id,connection);await repo.put("credentials","tenant","credential",encryptCredential({id:"credential",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",appId:"app",keyVersion:"primary"},"synthetic-selected"));
  await repo.put("grants","tenant","grant",{id:"grant",tenantId:"tenant",clientId:"client",assetKey:asset.key,connectionId:connection.id,capabilities:["legacy.ads_get_account_info"],actions:["READ"],tasks:[],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1});
  configurePlatformRepository(repo);
  const step={path:"/act_101",root:{type:"AD_ACCOUNT",id:"act_101"},query:{fields:"id,name"},projection:["id","name"],list:false,entityType:"AD_ACCOUNT"};
  const plan:OperationPlan={parameters:{legacy_read_steps:[step]},assets:[{type:"AD_ACCOUNT",id:"101"}],classes:["READ"],capability:"legacy.ads_get_account_info",requiredScopes:["ads_read"],tokenTypes:["user"]};
  const permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:false});
  const client=new MetaApiClient({apiVersion:"v26.0",maxRetries:0});
  return {repo,connection,permit,read:()=>runWithExecutionPermit(permit,()=>client.get("/act_101",{fields:"id,name"}))};
}
beforeEach(()=>{vi.stubEnv("LUMIN_PLATFORM_ENABLED","true");vi.stubEnv("META_API_VERSION","v26.0");vi.stubEnv("TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,7).toString("hex"));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();configurePlatformRepository(undefined);});
describe("independent legacy boundary review",()=>{
  it("binds bearer to selected encrypted credential despite nested request token override",async()=>{
    const {read}=await fixture();const fetcher=vi.fn(async(_url,init)=>{expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-selected");return new Response(JSON.stringify({id:"101",name:"fixture"}));});vi.stubGlobal("fetch",fetcher);
    await requestContext.run({accessToken:"synthetic-broader",fbUserId:"operator"},read);expect(fetcher).toHaveBeenCalledOnce();
  });
  it("cannot fall back to process token for a strict read",async()=>{
    const {read}=await fixture();vi.stubEnv("META_ACCESS_TOKEN","synthetic-env-broader");const fetcher=vi.fn(async(_url,init)=>{expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-selected");return new Response(JSON.stringify({id:"101"}));});vi.stubGlobal("fetch",fetcher);await read();expect(fetcher).toHaveBeenCalledOnce();
  });
  it("requires current marketing eligibility at low-level egress",async()=>{
    const {read}=await fixture(false);const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:"101"})));vi.stubGlobal("fetch",fetcher);
    await expect(requestContext.run({accessToken:"synthetic-selected"},read)).rejects.toThrow("UNVERIFIED_MARKETING_READ");expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{status:"ACTIVE"},{status:"PAUSED",targeting:{custom_audiences:[{id:"999"}]}},{status:"PAUSED",creative:{creative_id:"999"}},{status:"PAUSED",lifetime_budget:2000}])("rejects activation and indirect write structures %j",extra=>{
    expect(()=>buildStrictLegacyWritePlan("ads_create_campaign",{account_id:"101",name:"fixture",objective:"OUTCOME_TRAFFIC",...extra})).toThrow();
  });
});

describe("independent delayed read boundary",()=>{
  it("rechecks eligibility after asynchronous credential reads before fetch",async()=>{
    let clock=Date.now();vi.spyOn(Date,"now").mockImplementation(()=>clock);
    const {repo,read}=await fixture(true,100);const get=repo.get.bind(repo);
    repo.get=async(...args)=>{const value=await get(...args);if(args[0]==="credentials")clock+=200;return value;};
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await expect(read()).rejects.toThrow("UNVERIFIED_MARKETING_READ");expect(fetcher).not.toHaveBeenCalled();
  });
  it("holds credential replacement between bucket selection and final egress",async()=>{
    const {repo,read}=await fixture();const get=repo.get.bind(repo);let credentialsRead=0;
    repo.get=async(...args)=>{if(args[0]==="credentials"&&++credentialsRead===2)await repo.put("credentials","tenant","credential",encryptCredential({id:"credential",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",appId:"app",keyVersion:"primary"},"synthetic-replaced"));return get(...args);};
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await expect(read()).rejects.toThrow("AUTHORIZATION_CHANGED");expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("independent legacy content and provider privacy",()=>{
  it.each(["EAA"+"X".repeat(25),"sk-proj-"+"Z".repeat(25),"access_token=synthetic-private-value","-----BEGIN PRIVATE KEY-----"])("rejects credential-shaped names before human review or egress",name=>{ // synthetic fixture: marker only, no private key material
    expect(()=>buildStrictLegacyWritePlan("ads_create_campaign",{account_id:"101",name,objective:"OUTCOME_TRAFFIC"})).toThrow("CREDENTIAL_SHAPED_CONTENT_REJECTED");
  });
  it("rejects nonnumeric provider error codes before logging or interpolation",async()=>{
    const {read}=await fixture();const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{code:"synthetic-secret",message:"synthetic-secret"}}),{status:400}));vi.stubGlobal("fetch",fetcher);
    await expect(read()).rejects.toThrow("LEGACY_PROVIDER_ERROR_SCHEMA_INVALID");expect(fetcher).toHaveBeenCalledOnce();
  });
});

it("does not log raw provider warning or access-tier header content in strict mode",async()=>{
  const {read}=await fixture();const warning=vi.spyOn(logger,"warn").mockImplementation(()=>undefined),info=vi.spyOn(logger,"info").mockImplementation(()=>undefined);
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({id:"101"}),{headers:{"x-ad-api-version-warning":"synthetic-private-header-value","x-ad-account-usage":JSON.stringify({acc_id_util_pct:10,ads_api_access_tier:"synthetic-private-tier-value"})}})));
  await read();expect(JSON.stringify([...warning.mock.calls,...info.mock.calls])).not.toContain("synthetic-private");
});
