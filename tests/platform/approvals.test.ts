import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {requestProductApproval,inspectApprovalRequest,issueHumanApproval} from "../../src/platform/approvals.js";
import {PRODUCT_CONTRACTS} from "../../src/platform/products/contracts.js";
import {authorizeOperation} from "../../src/platform/execution.js";
import type {OperationContext,Connection,MetaAsset,AssetGrant} from "../../src/platform/models.js";
const contract=PRODUCT_CONTRACTS.find(c=>c.tool==="pages_create_feed")!;
const ctx:OperationContext={principal:{tenantId:"tenant",operatorId:"actor"},clientId:"client",tool:contract.tool,provider:contract.provider,requestId:"request"};
const human={tenantId:"tenant",operatorId:"human"};
beforeEach(()=>vi.stubEnv("TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,3).toString("hex")));
afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
  const repo=new InMemoryPlatformRepository(),now=Date.now();
  await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",policyRevision:1,registryRevision:1,migrationState:"READY"});
  await repo.put("members","tenant","actor",{operatorId:"actor",tenantId:"tenant",roles:["writer"],allowedClientIds:["client"],disabledAt:null,revision:1});
  await repo.put("members","tenant","human",{operatorId:"human",tenantId:"tenant",roles:["approver"],allowedClientIds:["client"],disabledAt:null,revision:1});
  await repo.put("clients","tenant","client",{id:"client",tenantId:"tenant",status:"ACTIVE",revision:1,verifiedBusinessIds:[]});
  const asset:MetaAsset={key:"page",id:"123",type:"PAGE",tenantId:"tenant",clientId:"client",provider:contract.provider,appId:"app",parents:[],verifiedAt:now,revokedAt:null,revision:1};
  const connection:Connection={id:"connection",tenantId:"tenant",operatorId:"actor",provider:contract.provider,appId:"app",credentialId:"credential",authStrategy:"fixture",tokenType:"page",scopes:contract.requiredScopes,assetKeys:["page"],expiresAt:now+3600000,revokedAt:null,verifiedAt:now,revision:1,eligibility:contract.manualRequirements.map(requirement=>({requirement,source:"https://developers.facebook.com/docs/fixture",checkedAt:now,expiresAt:now+3600000,verified:true}))};
  const grant:AssetGrant={id:"grant",tenantId:"tenant",clientId:"client",assetKey:"page",connectionId:"connection",capabilities:[contract.id],actions:contract.operationClasses,tasks:contract.requiredTasks??[],verifiedAt:now,expiresAt:now+3600000,revokedAt:null,revision:1};
  await repo.put("assets","tenant","page",asset);await repo.put("connections","tenant","connection",connection);await repo.put("grants","tenant","grant",grant);
  return {repo,connection,grant,asset};
}
describe("human approval plan preparation and issuance",()=>{
  it("encrypts complete content at rest and issues an executable one-use approval",async()=>{const {repo}=await fixture();const request=await requestProductApproval(repo,ctx,contract,"123",{message:"Private reviewed message"});expect(JSON.stringify(await repo.list("approvalRequests","tenant"))).not.toContain("Private reviewed");expect(await repo.list("operations","tenant")).toHaveLength(0);const inspected=await inspectApprovalRequest(repo,human,request.id);expect(inspected.plan.parameters.input).toEqual({message:"Private reviewed message"});const approval=await issueHumanApproval(repo,human,request.id);const permit=await authorizeOperation(repo,ctx,inspected.plan,{writesEnabled:true,approvalId:approval});expect(permit.planHash).toBe(request.planHash);await expect(authorizeOperation(repo,ctx,inspected.plan,{writesEnabled:true,approvalId:approval})).rejects.toThrow("REPLAYED");expect(await repo.list("controlAudit","tenant")).toHaveLength(2);});
  it("issues at most one approval under concurrent clicks",async()=>{const {repo}=await fixture(),request=await requestProductApproval(repo,ctx,contract,"123",{message:"Reviewed"});const outcomes=await Promise.allSettled([issueHumanApproval(repo,human,request.id),issueHumanApproval(repo,human,request.id)]);expect(outcomes.filter(o=>o.status==="fulfilled")).toHaveLength(1);expect(await repo.list("approvals","tenant")).toHaveLength(1);});
  it("denies foreign client and non-approver without decrypting plan",async()=>{const {repo}=await fixture(),request=await requestProductApproval(repo,ctx,contract,"123",{message:"Reviewed"});await expect(inspectApprovalRequest(repo,ctx.principal,request.id)).rejects.toThrow("HUMAN_APPROVER");await repo.put("members","tenant","human",{operatorId:"human",tenantId:"tenant",roles:["approver"],allowedClientIds:["other"],revision:1,disabledAt:null});await expect(issueHumanApproval(repo,human,request.id)).rejects.toThrow("HUMAN_APPROVER");expect(await repo.list("approvals","tenant")).toHaveLength(0);});
  it("rejects changed grants and altered encrypted binding",async()=>{const {repo,grant}=await fixture(),request=await requestProductApproval(repo,ctx,contract,"123",{message:"Reviewed"});await repo.put("grants","tenant","grant",{...grant,revision:2});await expect(issueHumanApproval(repo,human,request.id)).rejects.toThrow("AUTHORIZATION_CHANGED");await repo.put("grants","tenant","grant",grant);await repo.put("approvalRequests","tenant",request.id,{...request,clientId:"other"});await expect(issueHumanApproval(repo,human,request.id)).rejects.toThrow();});
  it("invalid input and storage failure never issue approval",async()=>{const {repo}=await fixture();await expect(requestProductApproval(repo,ctx,contract,"123",{message:{raw:"bad"}})).rejects.toThrow();repo.commitControlPlane=async()=>{throw new Error("storage unavailable");};await expect(requestProductApproval(repo,ctx,contract,"123",{message:"Reviewed"})).rejects.toThrow("storage unavailable");expect(await repo.list("approvals","tenant")).toHaveLength(0);});
});
