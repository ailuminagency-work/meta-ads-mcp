import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import {loadManualEligibilityEvidence} from "../../src/platform/manual-eligibility.js";
import {afterEach,describe,expect,it,vi} from "vitest";
import {MetaGraphClient,configureMessagingPolicyVerifier,contractPlanParameters} from "../../src/platform/clients.js";
import {PRODUCT_CONTRACTS} from "../../src/platform/products/contracts.js";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {encryptCredential} from "../../src/platform/connections.js";
import {authorizeOperation,runWithExecutionPermit} from "../../src/platform/execution.js";
import {canonicalPlanHash,revisionHash} from "../../src/platform/policy.js";
import type {AssetGrant,AuthorizationSnapshot,Connection,MetaAsset,OperationContext,OperationPlan} from "../../src/platform/models.js";
const contract=PRODUCT_CONTRACTS.find(c=>c.tool==="whatsapp_platform_send_message")!,input={to:"+12065550123",text:"Synthetic authorized response"};
afterEach(()=>{configureMessagingPolicyVerifier(async()=>{throw new Error("policy runtime absent");});vi.unstubAllEnvs();});
async function fixture(){
  vi.stubEnv("META_APP_ID","300");vi.stubEnv("TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,2).toString("hex"));const now=Date.now(),repo=new InMemoryPlatformRepository();
  const ctx:OperationContext={principal:{tenantId:"t",operatorId:"100"},clientId:"c",tool:contract.tool,provider:contract.provider,requestId:"r"};
  const base={tenantId:"t",clientId:"c",provider:contract.provider,appId:"300",verifiedAt:now-1,revokedAt:null,revision:1};
  const assets:MetaAsset[]=[{...base,key:"waac",id:"1",type:"WHATSAPP_ACCOUNT",parents:[]},{...base,key:"account",id:"2",type:"MESSAGING_ACCOUNT",parents:[{type:"WHATSAPP_ACCOUNT",id:"1"}]},{...base,key:"phone",id:"3",type:"WHATSAPP_PHONE",parents:[{type:"WHATSAPP_ACCOUNT",id:"1"},{type:"MESSAGING_ACCOUNT",id:"2"}]}];
  let connection:Connection={subjectId:"800",metaAppUserId:"800",clientBusinessId:"400",whatsappAssignmentEvidence:{tenantId:"t",clientId:"c",appId:"300",whatsappAccountId:"1",messagingAccountId:"2",phoneId:"3",dualAccountAssignment:true,source:"META_BUSINESS_SUITE_OWNER_REVIEW",approvedBy:"owner",checkedAt:now-1,expiresAt:now+60000},id:"connection",tenantId:"t",operatorId:"100",provider:contract.provider,authStrategy:"fixture",credentialId:"credential",appId:"300",tokenType:"business_integration_system_user",scopes:contract.requiredScopes,assetKeys:assets.map(a=>a.key),expiresAt:now+60_000,revokedAt:null,verifiedAt:now-1,revision:1,eligibility:contract.manualRequirements.map(requirement=>({requirement,source:contract.documentation[0],checkedAt:now-1,expiresAt:now+60_000,verified:true}))};
  const tenant={id:"t",status:"ACTIVE" as const,policyRevision:1,registryRevision:1,migrationState:"READY" as const},member={operatorId:"100",tenantId:"t",roles:["admin"],allowedClientIds:["c"],revision:1,disabledAt:null},client={id:"c",tenantId:"t",status:"ACTIVE" as const,revision:1,verifiedBusinessIds:["400"]};
  const plan:OperationPlan={parameters:contractPlanParameters(contract,"3",input),assets:[{type:"WHATSAPP_PHONE",id:"3"}],classes:contract.operationClasses,capability:contract.id,requiredScopes:contract.requiredScopes,tokenTypes:contract.tokenTypes};
  const grants:AssetGrant[]=assets.map(a=>({id:`g-${a.key}`,tenantId:"t",clientId:"c",assetKey:a.key,connectionId:connection.id,capabilities:[contract.id],actions:contract.operationClasses,tasks:[],verifiedAt:now-1,expiresAt:now+60_000,revokedAt:null,revision:1}));
  await repo.put("tenants","t","t",tenant);await repo.put("members","t","100",member);
await repo.put("operatorIndex","_index","100",{operatorId:"100",tenantId:"t"});await repo.put("clients","t","c",client);for(const asset of assets)await repo.put("assets","t",asset.key,asset);for(const grant of grants)await repo.put("grants","t",grant.id,grant);await repo.put("connections","t",connection.id,connection);await repo.put("credentials","t","credential",encryptCredential({id:"credential",tenantId:"t",operatorId:"100",provider:contract.provider,appId:"300",keyVersion:"primary"},"synthetic-secret"));
  await establishManualEligibilityFixture(repo,"t","c","connection");connection=(await repo.get("connections","t","connection"))!;const manualEligibilityEvidence=await loadManualEligibilityEvidence(repo,ctx,connection,Object.keys(contract.eligibilityPolicies??{}));const snapshot:AuthorizationSnapshot={tenant,member,client,assets,connection,grants,manualEligibilityEvidence};await repo.put("approvals","t","approval",{id:"approval",tenantId:"t",clientId:"c",actorId:"100",approverId:"100",approverRevision:1,planHash:canonicalPlanHash(ctx,plan),revisionHash:revisionHash(snapshot),expiresAt:now+60_000,consumedAt:null,operationId:null});
  return authorizeOperation(repo,ctx,plan,{writesEnabled:true,approvalId:"approval"});
}
describe("independent WhatsApp final egress policy boundary",()=>{
  it.each(["withdrawal","billing-substitution"])("blocks %s after initial policy check before final network egress",async attack=>{
    const permit=await fixture();let calls=0;configureMessagingPolicyVerifier(async()=>{calls++;if(calls===1)return {messagingAccountId:"2",validUntil:Date.now()+60000};if(attack==="withdrawal")throw new Error("OPT_IN_WITHDRAWN");return {messagingAccountId:"999",validUntil:Date.now()+60000};});
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({messaging_product:"whatsapp",messages:[{id:"synthetic-message"}]})));
    await expect(runWithExecutionPermit(permit,()=>new MetaGraphClient(contract.provider,fetcher).request(contract,"3",input))).rejects.toThrow();expect(calls).toBe(2);expect(fetcher).not.toHaveBeenCalled();
  });
  it("injects verified client billing and excludes caller billing selection on a valid response",async()=>{
    const permit=await fixture(),verifier=vi.fn(async()=>({messagingAccountId:"2",validUntil:Date.now()+60000}));configureMessagingPolicyVerifier(verifier);
    const fetcher=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response(JSON.stringify({messaging_product:"whatsapp",messages:[{id:"synthetic-message"}],contacts:[{wa_id:"private"}]})));
    const result=await runWithExecutionPermit(permit,()=>new MetaGraphClient(contract.provider,fetcher).request(contract,"3",input));expect(verifier).toHaveBeenCalledTimes(2);expect(fetcher).toHaveBeenCalledTimes(1);const body=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(body.messaging_account_id).toBe("2");expect(body.text).toEqual({body:input.text,preview_url:false});expect(result).toEqual({messaging_product:"whatsapp",messages:[{id:"synthetic-message"}]});
  });
});
