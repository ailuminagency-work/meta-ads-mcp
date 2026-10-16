import { describe, expect, it } from "vitest";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import type { AssetGrant, AuthorizationSnapshot, Connection, MetaAsset, OperationContext, OperationPlan } from "../../src/platform/models.js";
import { authorizeOperation, assertExecutionPermit, claimMutationStep, finishCreatedAsset, finishOperation, getExecutionScope, revalidateExecutionPermit, runWithExecutionPermit, withConnectionCredential } from "../../src/platform/execution.js";
import { encryptCredential, decryptCredential, selectConnection } from "../../src/platform/connections.js";
import { canonicalPlanHash, classifyPlan, normalizeSafeDiff, revisionHash } from "../../src/platform/policy.js";
import { resolveAuthorizedAssets } from "../../src/platform/assets.js";

const ctx: OperationContext = {principal:{operatorId:"operator",tenantId:"tenant"},clientId:"client-a",tool:"ads_get_campaign",provider:"META_MARKETING",requestId:"request"};
const now = Date.now();
const account: MetaAsset = {key:"account",id:"101",type:"AD_ACCOUNT",tenantId:"tenant",clientId:"client-a",provider:"META_MARKETING",appId:"app",parents:[],verifiedAt:now-1000,revokedAt:null,revision:1};
const ad: MetaAsset = {...account,key:"ad",id:"202",type:"AD",parents:[{type:"AD_ACCOUNT",id:"101"}]};
const connection: Connection = {id:"narrow",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",authStrategy:"business_login",credentialId:"credential",appId:"app",tokenType:"user",scopes:["ads_read"],assetKeys:["account","ad"],expiresAt:now+3600000,revokedAt:null,verifiedAt:now-1000,revision:1};
const plan: OperationPlan = {parameters:{ad_id:"202"},assets:[{type:"AD",id:"202"}],classes:["READ"],capability:"ads.read",requiredScopes:["ads_read"],tokenTypes:["user"]};
async function fixture() {
  const repo = new InMemoryPlatformRepository();
  await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",policyRevision:1,registryRevision:1,migrationState:"READY"});
  await repo.put("members","tenant","operator",{operatorId:"operator",tenantId:"tenant",roles:["admin"],allowedClientIds:["client-a"],revision:1,disabledAt:null});
  await repo.put("members","tenant","human",{operatorId:"human",tenantId:"tenant",roles:["approver"],allowedClientIds:["client-a"],revision:1,disabledAt:null});
  await repo.put("clients","tenant","client-a",{id:"client-a",tenantId:"tenant",status:"ACTIVE",revision:1,verifiedBusinessIds:[]});
  await repo.put("operatorIndex","_index","operator",ctx.principal);
  for(const a of [account,ad]) await repo.put("assets","tenant",a.key,a);
  await repo.put("connections","tenant","narrow",connection);
  for(const a of [account,ad]) { const g: AssetGrant = {id:a.key,tenantId:"tenant",clientId:"client-a",assetKey:a.key,connectionId:"narrow",capabilities:["ads.read"],actions:["READ","WRITE_AD_CONFIGURATION","WRITE_BUDGET"],tasks:[],verifiedAt:now-1000,expiresAt:now+3600000,revokedAt:null,revision:1}; await repo.put("grants","tenant",g.id,g); }
  return repo;
}
describe("strict platform authorization foundation",()=>{
  it("resolves trusted index and refuses missing identity",async()=>{const repo=await fixture(); expect(await repo.resolvePrincipal("operator")).toEqual(ctx.principal); expect(await repo.resolvePrincipal("unknown")).toBeNull();});
  it("resolves every ancestor and denies cross-client parent",async()=>{const repo=await fixture();expect((await resolveAuthorizedAssets(repo,ctx,plan.assets)).map(a=>a.key)).toEqual(["account","ad"]);await repo.put("assets","tenant","account",{...account,clientId:"client-b"});await expect(resolveAuthorizedAssets(repo,ctx,plan.assets)).rejects.toThrow("ASSET_ACCESS_REQUIRED");});
  it("denies unregistered IDs and cycles",async()=>{const repo=await fixture();await expect(resolveAuthorizedAssets(repo,ctx,[{type:"AD",id:"999"}])).rejects.toThrow("UNREGISTERED");await repo.put("assets","tenant","account",{...account,parents:[{type:"AD",id:"202"}]});await expect(resolveAuthorizedAssets(repo,ctx,plan.assets)).rejects.toThrow("CYCLE");});
  it("rejects explicit unavailable connection without broader fallback",async()=>{const repo=await fixture();await repo.put("connections","tenant","broad",{...connection,id:"broad",scopes:["ads_read","ads_management"]});expect((await selectConnection(repo,ctx,plan,[account,ad])).id).toBe("narrow");await repo.put("connections","tenant","narrow",{...connection,revokedAt:now});await expect(selectConnection(repo,ctx,plan,[account,ad],Date.now(),"narrow")).rejects.toThrow("SELECTED_CONNECTION_UNAVAILABLE");});
  it("guards opaque permit and isolates async contexts",async()=>{const repo=await fixture();const permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:false});expect(()=>assertExecutionPermit({provider:"META_MARKETING"})).toThrow("PERMIT_REQUIRED");await runWithExecutionPermit(permit,async()=>{expect(assertExecutionPermit({provider:"META_MARKETING",assetKeys:["ad"]})).toBe(permit);expect(()=>assertExecutionPermit({provider:"META_THREADS"})).toThrow("MISMATCH");const scope=getExecutionScope();scope.context.clientId="client-b";expect(getExecutionScope().context.clientId).toBe("client-a");await Promise.resolve();expect(getExecutionScope().context.clientId).toBe("client-a");});});
  it("revocation invalidates existing permits",async()=>{const repo=await fixture();const permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:false});await repo.put("assets","tenant","ad",{...ad,revokedAt:now});await expect(revalidateExecutionPermit(permit)).rejects.toThrow("AUTHORIZATION_CHANGED");});
  it("binds ciphertext to tenant provider operator and app without fallback",()=>{const c=encryptCredential({id:"credential",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",appId:"app",keyVersion:"primary"},"synthetic-test-value");expect(decryptCredential(c)).toBe("synthetic-test-value");expect(()=>decryptCredential({...c,tenantId:"other"})).toThrow();expect(()=>decryptCredential({...c,provider:"META_THREADS"})).toThrow();});
  it("only makes credential available inside internal callback",async()=>{const repo=await fixture();await repo.put("credentials","tenant","credential",encryptCredential({id:"credential",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",appId:"app",keyVersion:"primary"},"synthetic-test-value"));const permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:false});expect(await withConnectionCredential(permit,async token=>token.length)).toBe(20);});
  it.each([{status:"ACTIVE"},{nested:{target_status:"ACTIVE"}},{updates:JSON.stringify({status:"ACTIVE"})},{children:[{status:"ACTIVE"}]}])("blocks active create/copy in nested shape %j",parameters=>{expect(()=>classifyPlan({...plan,parameters,createOrCopy:true})).toThrow("CREATE_MUST_REMAIN_PAUSED");});
  it("unions generic budget activation and billing risks",()=>{expect(classifyPlan({...plan,parameters:{updates:{status:"ACTIVE",daily_budget:1000,payment_method_id:"fake"}}})).toEqual(expect.arrayContaining(["READ","ACTIVATE_SPEND","WRITE_BUDGET","BILLING"]));});
  it("disabled writes and missing approval produce no operation",async()=>{const repo=await fixture();await expect(authorizeOperation(repo,ctx,{...plan,classes:["WRITE_AD_CONFIGURATION"]},{writesEnabled:false})).rejects.toThrow("DISABLED_BY_LUMIN_POLICY");await expect(authorizeOperation(repo,ctx,{...plan,parameters:{daily_budget:100},classes:["WRITE_AD_CONFIGURATION"]},{writesEnabled:true})).rejects.toThrow("HUMAN_APPROVAL_REQUIRED");expect(await repo.list("operations","tenant")).toHaveLength(0);});
  it("consumes approval once atomically and writes audit before permit",async()=>{const repo=await fixture();const budgetPlan:OperationPlan={...plan,parameters:{daily_budget:100},classes:["WRITE_AD_CONFIGURATION","WRITE_BUDGET"]};budgetPlan.classes=classifyPlan(budgetPlan);const snapshot:AuthorizationSnapshot={tenant:(await repo.get("tenants","tenant","tenant"))!,member:(await repo.get("members","tenant","operator"))!,client:(await repo.get("clients","tenant","client-a"))!,assets:[account,ad],connection,grants:await repo.list("grants","tenant")};await repo.put("approvals","tenant","approval",{id:"approval",tenantId:"tenant",clientId:"client-a",actorId:"operator",approverId:"human",approverRevision:1,planHash:canonicalPlanHash(ctx,budgetPlan),revisionHash:revisionHash(snapshot),expiresAt:Date.now()+100000,consumedAt:null,operationId:null});const results=await Promise.allSettled([authorizeOperation(repo,ctx,budgetPlan,{writesEnabled:true,approvalId:"approval"}),authorizeOperation(repo,ctx,budgetPlan,{writesEnabled:true,approvalId:"approval"})]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(await repo.list("audit","tenant")).toHaveLength(1);const success=results.find(r=>r.status==="fulfilled");if(success?.status!=="fulfilled")throw new Error("missing permit");await finishOperation(success.value,"UNKNOWN");expect((await repo.get("operations","tenant",success.value.operationId))?.state).toBe("UNKNOWN");});
  it("database preparation failure prevents permit and credential use",async()=>{const repo=await fixture();repo.prepareOperation=async()=>{throw new Error("storage unavailable");};await expect(approvedPermit(repo,{...plan,classes:["WRITE_AD_CONFIGURATION"]})).rejects.toThrow("storage unavailable");});
  it("denies forged tenant and client selection before credential access",async()=>{const repo=await fixture();await expect(authorizeOperation(repo,{...ctx,clientId:"client-b"},plan,{writesEnabled:false})).rejects.toThrow("MEMBERSHIP_REQUIRED");await expect(authorizeOperation(repo,{...ctx,principal:{...ctx.principal,tenantId:"foreign"}},plan,{writesEnabled:false})).rejects.toThrow("MEMBERSHIP_REQUIRED");});
  it("denies stale task grants expired credentials and absent permissions",async()=>{const repo=await fixture();await expect(authorizeOperation(repo,ctx,{...plan,requiredTasks:["MANAGE"]},{writesEnabled:false})).rejects.toThrow("PERMISSION_OR_CONNECTION_REQUIRED");await expect(authorizeOperation(repo,ctx,{...plan,requiredScopes:["ads_management"]},{writesEnabled:false})).rejects.toThrow("PERMISSION_OR_CONNECTION_REQUIRED");await repo.put("connections","tenant","narrow",{...connection,expiresAt:now-1});await expect(authorizeOperation(repo,ctx,plan,{writesEnabled:false})).rejects.toThrow("PERMISSION_OR_CONNECTION_REQUIRED");});
  it("rejects unmapped leaf objects and foreign app parent",async()=>{const repo=await fixture();await repo.put("assets","tenant","ad",{...ad,parents:[]});await expect(resolveAuthorizedAssets(repo,ctx,plan.assets)).rejects.toThrow("PARENT_REQUIRED");await repo.put("assets","tenant","ad",ad);await repo.put("assets","tenant","account",{...account,appId:"foreign-app"});await expect(resolveAuthorizedAssets(repo,ctx,plan.assets)).rejects.toThrow("PARENT_APP_MISMATCH");});
  it("binds approval hash to actor client and exact parameters",()=>{expect(canonicalPlanHash(ctx,plan)).not.toBe(canonicalPlanHash({...ctx,clientId:"client-b"},plan));expect(canonicalPlanHash(ctx,plan)).not.toBe(canonicalPlanHash({...ctx,principal:{...ctx.principal,operatorId:"other"}},plan));expect(canonicalPlanHash(ctx,plan)).not.toBe(canonicalPlanHash(ctx,{...plan,parameters:{ad_id:"203"}}));});
  it("rejects unknown credential key version and rebound app",()=>{const c=encryptCredential({id:"credential",tenantId:"tenant",operatorId:"operator",provider:"META_MARKETING",appId:"app",keyVersion:"primary"},"synthetic-test-value");expect(()=>decryptCredential({...c,keyVersion:"missing-key"})).toThrow("VERSION_UNSUPPORTED");expect(()=>decryptCredential({...c,appId:"foreign-app"})).toThrow();});
  it("denies registry failure instead of passing through",async()=>{const repo=await fixture();repo.list=async()=>{throw new Error("registry unavailable");};await expect(authorizeOperation(repo,ctx,plan,{writesEnabled:false})).rejects.toThrow("registry unavailable");});
  it("requires fresh grant evidence for writes and reads",async()=>{const repo=await fixture();await repo.put("connections","tenant","narrow",{...connection,verifiedAt:now-6*60_000});await expect(authorizeOperation(repo,ctx,{...plan,classes:["WRITE_AD_CONFIGURATION"]},{writesEnabled:true})).rejects.toThrow("PERMISSION_OR_CONNECTION_REQUIRED");await repo.put("connections","tenant","narrow",{...connection,verifiedAt:now-61*60_000});await expect(authorizeOperation(repo,ctx,plan,{writesEnabled:false})).rejects.toThrow("PERMISSION_OR_CONNECTION_REQUIRED");});
  it("audit records are append-only",async()=>{const repo=await fixture();const record={id:"audit",tenantId:"tenant",clientId:"client-a",actorId:"operator",tool:"tool",operationId:"op",event:"PREPARED" as const,timestamp:now,assetKeys:[],planHash:"hash",approvalId:null};await repo.put("audit","tenant","audit",record);await expect(repo.put("audit","tenant","audit",{...record,event:"FAILED"})).rejects.toThrow("APPEND_ONLY");});
  it.each([{}, {status:"INHERITED_FROM_SOURCE"}, {status:"PAUSED",options:{status_option:"INHERITED_FROM_SOURCE"}}, {status:"PAUSED",copies:[{status:"ACTIVE"}]}])("requires explicit PAUSED for every ad create/copy plan %j",parameters=>{expect(()=>classifyPlan({...plan,parameters,classes:["WRITE_AD_CONFIGURATION"],createOrCopy:true})).toThrow("CREATE_MUST_REMAIN_PAUSED");});
  it("allows typed paused creation only",()=>{expect(classifyPlan({...plan,parameters:{status:"PAUSED"},classes:["WRITE_AD_CONFIGURATION"],createOrCopy:true})).toEqual(["WRITE_AD_CONFIGURATION"]);});
  it("allows exactly one mutating egress attempt per permit",async()=>{const repo=await fixture();const permit=await approvedPermit(repo,{...plan,classes:["WRITE_AD_CONFIGURATION"]});claimMutationStep(permit);expect(()=>claimMutationStep(permit)).toThrow("ALREADY_CLAIMED");const read=await authorizeOperation(repo,ctx,plan,{writesEnabled:false});expect(()=>claimMutationStep(read)).toThrow("NOT_AUTHORIZED");});
  it("retries durable UNKNOWN finalization after storage failure without extra egress",async()=>{const repo=await fixture();const permit=await approvedPermit(repo,{...plan,classes:["WRITE_AD_CONFIGURATION"]});claimMutationStep(permit);const finish=repo.finishOperation.bind(repo);repo.finishOperation=async()=>{throw new Error("completion storage unavailable");};await expect(finishOperation(permit,"UNKNOWN")).rejects.toThrow("storage unavailable");expect((await repo.get("operations","tenant",permit.operationId))?.state).toBe("PREPARED");expect(await repo.list("audit","tenant")).toHaveLength(1);expect(()=>claimMutationStep(permit)).toThrow("ALREADY_CLAIMED");repo.finishOperation=finish;await finishOperation(permit,"UNKNOWN");await finishOperation(permit,"UNKNOWN");expect((await repo.get("operations","tenant",permit.operationId))?.state).toBe("UNKNOWN");expect(await repo.list("audit","tenant")).toHaveLength(2);await expect(finishOperation(permit,"FAILED")).rejects.toThrow("ALREADY_FINISHED");});
  it("records safe requested changes and explicit unknown before evidence",async()=>{const repo=await fixture();const parameters={status:"PAUSED",message:"private customer content",customer:{email:"private@example.invalid"},access_token:"synthetic-private-value",source_ad_id:"202"};const permit=await approvedPermit(repo,{...plan,parameters,classes:["WRITE_AD_CONFIGURATION"]});const audit=await repo.get("audit","tenant",`${permit.operationId}:prepared`);expect(audit?.beforeEvidence).toBe("UNKNOWN");expect(audit?.requestedChange).toEqual([{field:"status",value:"PAUSED"},{field:"source_ad_id",value:"202"}]);expect(JSON.stringify(audit)).not.toContain("private");expect(normalizeSafeDiff({updates:JSON.stringify({daily_budget:100,status:"PAUSED",name:"private name"})})).toEqual([{field:"daily_budget",value:100},{field:"status",value:"PAUSED"}]);});
  it("requires fresh asset and parent evidence using stricter write horizon",async()=>{const repo=await fixture();await repo.put("assets","tenant","account",{...account,verifiedAt:now-6*60_000});await expect(authorizeOperation(repo,ctx,{...plan,classes:["WRITE_AD_CONFIGURATION"]},{writesEnabled:true})).rejects.toThrow("ASSET_ACCESS_REQUIRED");expect(await authorizeOperation(repo,ctx,plan,{writesEnabled:false})).toBeDefined();await repo.put("assets","tenant","account",{...account,verifiedAt:now-61*60_000});await expect(authorizeOperation(repo,ctx,plan,{writesEnabled:false})).rejects.toThrow("ASSET_ACCESS_REQUIRED");});
  it.each([{roles:[]},{roles:["unknown-role"]}])("rejects READ without recognized membership role %j",async({roles})=>{const repo=await fixture();const member=(await repo.get("members","tenant","operator"))!;await repo.put("members","tenant","operator",{...member,roles});await expect(authorizeOperation(repo,ctx,plan,{writesEnabled:false})).rejects.toThrow("READ_ROLE_REQUIRED");});
});


describe("atomic created asset completion",()=>{
  const creation:OperationPlan={...plan,assets:[{type:"AD_ACCOUNT",id:"101"}],parameters:{status:"PAUSED"},classes:["WRITE_AD_CONFIGURATION"],createOrCopy:true};
  async function creationFixture(){const repo=await fixture();const permit=await approvedPermit(repo,creation);return {repo,permit};}
  it("requires claimed mutation before registration",async()=>{const {permit}=await creationFixture();await expect(finishCreatedAsset(permit,{id:"303",type:"CAMPAIGN",parent:creation.assets[0]})).rejects.toThrow("CLAIMED_CREATION");});
  it("atomically registers child, inherited narrow grant, revised connection and terminal audit",async()=>{
    const {repo,permit}=await creationFixture();claimMutationStep(permit);
    expect(await finishCreatedAsset(permit,{id:"303",type:"CAMPAIGN",parent:creation.assets[0]})).toBe(true);
    const asset=(await repo.list("assets","tenant")).find(a=>a.id==="303")!;
    expect(asset.createdFromOperationId).toBe(permit.operationId);expect(asset.parents).toEqual(creation.assets);
    const grant=(await repo.list("grants","tenant")).find(g=>g.assetKey===asset.key)!;
    expect(grant.capabilities).toEqual(["ads.read"]);expect(grant.actions).toEqual(["READ","WRITE_AD_CONFIGURATION","WRITE_BUDGET"]);
    expect((await repo.get("connections","tenant","narrow"))?.revision).toBe(2);
    expect((await repo.get("operations","tenant",permit.operationId))?.state).toBe("SUCCEEDED");
    expect((await repo.get("audit","tenant",`${permit.operationId}:result`))?.afterSummary).toEqual([{field:"newresource_id",value:"303"}]);
    expect(await finishCreatedAsset(permit,{id:"303",type:"CAMPAIGN",parent:creation.assets[0]})).toBe(true);
    await expect(finishCreatedAsset(permit,{id:"304",type:"CAMPAIGN",parent:creation.assets[0]})).rejects.toThrow("ALREADY_FINISHED");
    const read=await authorizeOperation(repo,ctx,{...plan,assets:[{id:"303",type:"CAMPAIGN"}]},{writesEnabled:false});expect(read.assetKeys).toContain(asset.key);
  });
  it.each(["authorization","duplicate","parent","expiry"])("records PARTIAL without any registration for %s",async variant=>{
    const {repo,permit}=await creationFixture();claimMutationStep(permit);
    if(variant==="authorization")await repo.put("connections","tenant","narrow",{...connection,revision:2});
    if(variant==="duplicate")await repo.put("assets","tenant","other",{...ad,key:"other",id:"303",clientId:"client-b"});
    if(variant==="expiry"){const grant=(await repo.get("grants","tenant","account"))!;await repo.put("grants","tenant","account",{...grant,expiresAt:1});}
    const parent=variant==="parent"?{type:"PAGE" as const,id:"101"}:creation.assets[0];
    expect(await finishCreatedAsset(permit,{id:"303",type:"CAMPAIGN",parent})).toBe(false);
    expect((await repo.get("operations","tenant",permit.operationId))?.state).toBe("PARTIAL");
    expect((await repo.list("assets","tenant")).filter(a=>a.createdFromOperationId===permit.operationId)).toHaveLength(0);
  });
  it("holds uncertain successful commit and safely reconciles the exact same result",async()=>{
    const {repo,permit}=await creationFixture();claimMutationStep(permit);const finish=repo.finishOperation.bind(repo);
    repo.finishOperation=async input=>{await finish(input);throw new Error("connection lost after commit");};
    await expect(finishCreatedAsset(permit,{id:"303",type:"CAMPAIGN",parent:creation.assets[0]})).rejects.toThrow("RECONCILIATION_HOLD");
    expect(()=>claimMutationStep(permit)).toThrow("ALREADY_CLAIMED");repo.finishOperation=finish;
    expect(await finishCreatedAsset(permit,{id:"303",type:"CAMPAIGN",parent:creation.assets[0]})).toBe(true);
    expect((await repo.list("assets","tenant")).filter(a=>a.id==="303")).toHaveLength(1);
  });
  it("concurrent distinct creations on one stale connection permit only one registry commit",async()=>{
    const repo=await fixture();const a=await approvedPermit(repo,creation);const b=await approvedPermit(repo,creation);claimMutationStep(a);claimMutationStep(b);
    const results=await Promise.all([finishCreatedAsset(a,{id:"303",type:"CAMPAIGN",parent:creation.assets[0]}),finishCreatedAsset(b,{id:"304",type:"CAMPAIGN",parent:creation.assets[0]})]);
    expect(results.sort()).toEqual([false,true]);
  });
});

async function approvedPermit(repo:InMemoryPlatformRepository,rawPlan:OperationPlan){
  const normalized={...rawPlan,classes:classifyPlan(rawPlan)};
  const assets=await resolveAuthorizedAssets(repo,ctx,normalized.assets,Date.now(),300000);
  const c=await selectConnection(repo,ctx,normalized,assets,Date.now());
  const snapshot:AuthorizationSnapshot={tenant:(await repo.get("tenants","tenant","tenant"))!,member:(await repo.get("members","tenant","operator"))!,client:(await repo.get("clients","tenant","client-a"))!,connection:c,assets,grants:(await repo.list("grants","tenant")).filter(g=>assets.some(a=>a.key===g.assetKey)&&g.connectionId===c.id)};
  const approvalId=crypto.randomUUID();
  await repo.put("approvals","tenant",approvalId,{id:approvalId,tenantId:"tenant",clientId:"client-a",actorId:"operator",approverId:"human",approverRevision:1,planHash:canonicalPlanHash(ctx,normalized),revisionHash:revisionHash(snapshot),expiresAt:Date.now()+60000,consumedAt:null,operationId:null});
  return authorizeOperation(repo,ctx,normalized,{writesEnabled:true,approvalId});
}

describe("created-asset dependent reference closure",()=>{
  it("retains canonical account and creative refs on a newly registered ad",async()=>{
    const repo=await fixture();
    const campaign:MetaAsset={...account,key:"campaign",id:"301",type:"CAMPAIGN",parents:[{type:"AD_ACCOUNT",id:"101"}]};
    const adset:MetaAsset={...campaign,key:"adset",id:"302",type:"AD_SET",parents:[{type:"CAMPAIGN",id:"301"}]};
    const creative:MetaAsset={...account,key:"creative",id:"303",type:"CREATIVE",parents:[{type:"AD_ACCOUNT",id:"101"}]};
    const originalGrant=(await repo.get("grants","tenant","account"))!;
    for(const asset of [campaign,adset,creative]){await repo.put("assets","tenant",asset.key,asset);await repo.put("grants","tenant",asset.key,{...originalGrant,id:asset.key,assetKey:asset.key});}
    await repo.put("connections","tenant","narrow",{...connection,assetKeys:[...connection.assetKeys,"campaign","adset","creative"]});
    const creation:OperationPlan={...plan,assets:[{type:"AD_ACCOUNT",id:"act_101"},{type:"AD_SET",id:"302"},{type:"CREATIVE",id:"303"}],parameters:{status:"PAUSED"},classes:["WRITE_AD_CONFIGURATION"],createOrCopy:true};
    const permit=await approvedPermit(repo,creation);claimMutationStep(permit);
    expect(await finishCreatedAsset(permit,{id:"304",type:"AD",parent:{type:"AD_SET",id:"302"}})).toBe(true);
    const asset=(await repo.list("assets","tenant")).find(a=>a.id==="304")!;
    expect(asset.parents).toEqual([{type:"AD_SET",id:"302"},{type:"AD_ACCOUNT",id:"101"},{type:"CREATIVE",id:"303"}]);
    await repo.put("assets","tenant","creative",{...creative,revokedAt:Date.now()});
    await expect(resolveAuthorizedAssets(repo,ctx,[{type:"AD",id:"304"}])).rejects.toThrow("ASSET_ACCESS_REQUIRED");
  });
});
