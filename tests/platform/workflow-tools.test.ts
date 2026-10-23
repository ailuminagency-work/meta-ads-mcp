import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {requestProductApproval,inspectApprovalRequest,issueHumanApproval} from "../../src/platform/approvals.js";
import {PRODUCT_CONTRACTS} from "../../src/platform/products/contracts.js";
import {preparePublicationSteps,preparedActionMetadata,clientRegistryOverview} from "../../src/platform/workflow-tools.js";
import {authorizeOperation,finishOperation} from "../../src/platform/execution.js";
import type {OperationContext,Connection,MetaAsset,AssetGrant} from "../../src/platform/models.js";
const contract=PRODUCT_CONTRACTS.find(c=>c.tool==="pages_create_feed")!;
const ctx:OperationContext={principal:{tenantId:"tenant",operatorId:"100"},clientId:"client",tool:contract.tool,provider:contract.provider,requestId:"request"};
const human={tenantId:"tenant",operatorId:"200"};
beforeEach(()=>{vi.stubEnv("META_APP_ID","300");vi.stubEnv("TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,3).toString("hex"));});
afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
  const repo=new InMemoryPlatformRepository(),now=Date.now();
  await repo.put("operatorIndex","_index","100",ctx.principal);await repo.put("operatorIndex","_index","200",human);
  await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",policyRevision:1,registryRevision:1,migrationState:"READY"});
  await repo.put("members","tenant","100",{operatorId:"100",tenantId:"tenant",roles:["writer"],allowedClientIds:["client"],disabledAt:null,revision:1});
  await repo.put("members","tenant","200",{operatorId:"200",tenantId:"tenant",roles:["approver"],allowedClientIds:["client"],disabledAt:null,revision:1});
  await repo.put("clients","tenant","client",{id:"client",tenantId:"tenant",status:"ACTIVE",revision:1,verifiedBusinessIds:[]});
  const asset:MetaAsset={key:"page",id:"123",type:"PAGE",tenantId:"tenant",clientId:"client",provider:contract.provider,appId:"300",parents:[],verifiedAt:now,revokedAt:null,revision:1};
  const connection:Connection={subjectId:asset.id,id:"connection",tenantId:"tenant",operatorId:"100",provider:contract.provider,appId:"300",credentialId:"credential",authStrategy:"fixture",tokenType:"page",scopes:contract.requiredScopes,assetKeys:["page"],expiresAt:now+3600000,revokedAt:null,verifiedAt:now,revision:1,eligibility:contract.manualRequirements.map(requirement=>({requirement,source:"https://developers.facebook.com/docs/fixture",checkedAt:now,expiresAt:now+3600000,verified:true}))};
  const grant:AssetGrant={id:"grant",tenantId:"tenant",clientId:"client",assetKey:"page",connectionId:"connection",capabilities:[contract.id],actions:contract.operationClasses,tasks:contract.requiredTasks??[],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1};
  await repo.put("assets","tenant","page",asset);await repo.put("connections","tenant","connection",connection);await repo.put("grants","tenant","grant",grant);
 await establishManualEligibilityFixture(repo,"tenant","client","connection");
  return {repo,connection,grant,asset};
}
describe("publication preparation and recovery",()=>{
 it("prepares encrypted human reviews with zero provider writes",async()=>{const {repo}=await fixture();const result=await preparePublicationSteps(repo,ctx,[{tool:contract.tool,asset_id:"123",input:{message:"Private draft"}}]);expect(result.status).toBe("HUMAN_REVIEW_REQUIRED");expect(result.provider_writes).toBe(0);expect(await repo.list("operations","tenant")).toEqual([]);expect(JSON.stringify(await repo.list("approvalRequests","tenant"))).not.toContain("Private draft");});
 it("rejects foreign client without preparing",async()=>{const {repo}=await fixture();await expect(preparePublicationSteps(repo,{...ctx,clientId:"foreign"},[{tool:contract.tool,asset_id:"123",input:{message:"draft"}}])).rejects.toThrow();expect(await repo.list("approvalRequests","tenant")).toEqual([]);});
 it("recovers a prepared reference after a later storage failure",async()=>{const {repo}=await fixture();const commit=repo.commitControlPlane.bind(repo);let count=0;repo.commitControlPlane=async change=>{if(++count===2)throw new Error("storage unavailable");return commit(change);};
 const asset=(await repo.get("assets","tenant","page"))!,connection=(await repo.get("connections","tenant","connection"))!,grant=(await repo.get("grants","tenant","grant"))!;
 await repo.put("assets","tenant","page2",{...asset,key:"page2",id:"124"});await repo.put("connections","tenant","connection2",{...connection,id:"connection2",subjectId:"124",assetKeys:["page2"]});await repo.put("grants","tenant","grant2",{...grant,id:"grant2",assetKey:"page2",connectionId:"connection2"});
 const result=await preparePublicationSteps(repo,ctx,[{tool:contract.tool,asset_id:"123",input:{message:"draft"}},{tool:contract.tool,asset_id:"124",input:{message:"second draft"}}]);expect(result.status).toBe("PARTIAL_PREPARATION");expect(result.steps[0].request_id).toBeTruthy();expect(result.provider_writes).toBe(0);expect(await repo.list("operations","tenant")).toEqual([]);
 });
 it("reports consumed uncertain operations rather than stale approval",async()=>{const {repo}=await fixture(),request=await requestProductApproval(repo,ctx,contract,"123",{message:"draft"}),inspected=await inspectApprovalRequest(repo,human,request.id),approvalId=await issueHumanApproval(repo,human,request.id),permit=await authorizeOperation(repo,ctx,inspected.plan,{writesEnabled:true,approvalId});await finishOperation(permit,"UNKNOWN");const current=(await repo.get("approvalRequests","tenant",request.id))!;expect((await preparedActionMetadata(repo,ctx,current)).status).toBe("UNKNOWN");await expect(preparedActionMetadata(repo,{...ctx,clientId:"foreign"},current)).rejects.toThrow("ACTION_REQUEST_ACCESS_REQUIRED");});
 it("returns evidence inventory without credentials or live audit claims",async()=>{const {repo}=await fixture();const result=await clientRegistryOverview(repo,ctx);expect(result.observation).toBe("REGISTERED_EVIDENCE_ONLY");expect(JSON.stringify(result)).not.toContain("credentialId");expect(result.connections[0].actual_granted_scopes).toEqual(contract.requiredScopes);});
});
