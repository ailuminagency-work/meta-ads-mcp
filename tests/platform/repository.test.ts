import {createHash} from "node:crypto";
import { beforeEach,afterEach,describe, expect, it, vi } from "vitest";
import type { Firestore } from "@google-cloud/firestore";
import { FirestorePlatformRepository, InMemoryPlatformRepository, type Preparation } from "../../src/platform/repository.js";
import { canonicalJson } from "../../src/platform/policy.js";
import {OwnershipEvidenceService} from "../../src/platform/ownership-service.js";
import {privacySubjectHash,PRIVACY_PROVENANCE_COLLECTION} from "../../src/platform/meta-privacy-provenance.js";

beforeEach(()=>vi.stubEnv("META_APP_ID","300"));
afterEach(()=>vi.unstubAllEnvs());
function fakeFirestore(beforeGet?: () => void) {
  const data = new Map<string, unknown>();
  const calls: string[] = [];
  function snap(path: string) { return {exists:data.has(path),data:()=>structuredClone(data.get(path))}; }
  function collection(path: string) {
    return {doc:(id:string)=>doc(`${path}/${id}`),limit:()=>({path,query:true,get:async()=>{const docs=[...data.entries()].filter(([p])=>p.startsWith(`${path}/`)&&!p.slice(path.length+1).includes("/")).map(([,v])=>({data:()=>structuredClone(v)}));return {size:docs.length,docs};}})};
  }
  function doc(path:string) {
    return {path,collection:(name:string)=>collection(`${path}/${name}`),get:async()=>snap(path),set:async(value:unknown)=>{data.set(path,structuredClone(value));},create:async(value:unknown)=>{if(data.has(path))throw new Error("already exists");data.set(path,structuredClone(value));}};
  }
  const db = {collection,runTransaction:async(fn:(tx:unknown)=>Promise<void>)=>{
    const writes:(()=>void)[]=[];
    const tx = {get:async(ref:ReturnType<typeof doc>)=>{calls.push("get");if(writes.length)throw new Error("read after write");beforeGet?.();if((ref as unknown as {query?:boolean}).query){const docs=[...data.entries()].filter(([p])=>p.startsWith(`${ref.path}/`)&&!p.slice(ref.path.length+1).includes("/")).map(([,v])=>({data:()=>structuredClone(v)}));return {size:docs.length,docs};}return snap(ref.path);},create:(ref:ReturnType<typeof doc>,value:unknown)=>{calls.push("create");writes.push(()=>{if(data.has(ref.path))throw new Error("already exists");data.set(ref.path,structuredClone(value));});},set:(ref:ReturnType<typeof doc>,value:unknown)=>{calls.push("set");writes.push(()=>data.set(ref.path,structuredClone(value)));},update:(ref:ReturnType<typeof doc>,value:Record<string,unknown>)=>{calls.push("update");writes.push(()=>data.set(ref.path,{...(data.get(ref.path) as object),...value}));}};
    await fn(tx); writes.forEach(w=>w());
  }};
  return {db:db as unknown as Firestore,data,calls};
}
function preparation():Preparation {return {operation:{id:"op",tenantId:"tenant",clientId:"client",actorId:"actor",tool:"write",planHash:"hash",state:"PREPARED",approvalId:null,createdAt:1,updatedAt:1},audit:{id:"op:prepared",tenantId:"tenant",clientId:"client",actorId:"actor",tool:"write",operationId:"op",event:"PREPARED",timestamp:1,assetKeys:[],planHash:"hash",approvalId:null},expectedRevisionHash:"revision",now:Date.now(),expectedRecords:[]};}
describe("Firestore repository contract with fake database",()=>{
  it("persists human ownership attestation TTL without leaking storage metadata into its authorization record",async()=>{
    const fake=fakeFirestore(),repo=new FirestorePlatformRepository(fake.db),now=Date.now();
    await repo.put("operatorIndex","_index","100",{operatorId:"100",tenantId:"tenant"});
    await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",migrationState:"READY",registryRevision:1,policyRevision:1});
    await repo.put("members","tenant","100",{tenantId:"tenant",operatorId:"100",roles:["admin"],allowedClientIds:["client"],disabledAt:null,revision:1});
    await repo.put("clients","tenant","client",{tenantId:"tenant",id:"client",status:"ACTIVE",revision:1,verifiedBusinessIds:["900"]});
    await repo.put("assets","tenant","account",{key:"account",id:"101",type:"AD_ACCOUNT",provider:"META_MARKETING",appId:"300",tenantId:"tenant",clientId:"client",parents:[],verifiedAt:now,revokedAt:null,revision:1});
    const result=await new OwnershipEvidenceService(repo).attest({operatorId:"100",tenantId:"tenant"},"client",{accountKey:"account",businessId:"900",documentReferenceHash:"a".repeat(64),expiresAt:now+86400000});
    const persisted=[...fake.data.values()].find(v=>(v as {source?:string}).source==="CLIENT_OWNER_ATTESTATION") as Record<string,unknown>;
    expect(persisted.expireTime).toBeInstanceOf(Date);
    const loaded=await repo.get("ownerBillingAttestations","tenant",result.attestationId);expect(loaded).not.toHaveProperty("expireTime");expect(()=>canonicalJson(loaded)).not.toThrow();
    expect((await repo.get("assets","tenant","account"))?.ownerBillingAttestationId).toBe(result.attestationId);
    const provenance=[...fake.data.entries()].filter(([path])=>path.startsWith(`${PRIVACY_PROVENANCE_COLLECTION}/`)).map(([,record])=>record as Record<string,unknown>);
    expect(provenance.find(r=>r.targetCollection==="ownerBillingAttestations")).toMatchObject({subjectHash:privacySubjectHash("300","100")});
    expect(provenance.every(r=>r.operatorId===undefined&&r.appUserId===undefined)).toBe(true);
    fake.data.set(`platform_meta_privacy_subject_locks/${privacySubjectHash("300","100")}`,{state:"ERASURE_PENDING"});
    await expect(new OwnershipEvidenceService(repo).attest({operatorId:"100",tenantId:"tenant"},"client",{accountKey:"account",businessId:"900",documentReferenceHash:"a".repeat(64),expiresAt:now+86400000})).rejects.toThrow();
    expect(await repo.list("ownerBillingAttestations","tenant")).toHaveLength(1);
    const prepared=preparation();prepared.expectedRecords=[{collection:"ownerBillingAttestations",id:result.attestationId,canonical:canonicalJson(loaded)}];
    await expect(repo.prepareOperation(prepared)).resolves.toBeUndefined();
  });
  it("rejects operation privacy metadata that differs from the selected authenticated connection",async()=>{
    const fake=fakeFirestore(),repo=new FirestorePlatformRepository(fake.db),p=preparation(),connection={id:"selected",tenantId:"tenant",operatorId:"actor",provider:"META_THREADS" as const,appId:"400",subjectId:"901",metaAppUserId:"901",tokenType:"threads" as const,credentialId:"credential",authStrategy:"synthetic",assetKeys:[],scopes:["threads_basic"],expiresAt:Date.now()+60000,revokedAt:null,verifiedAt:Date.now(),revision:1};
    await repo.put("connections","tenant",connection.id,connection);p.expectedRecords=[{collection:"connections",id:connection.id,canonical:canonicalJson(connection)}];p.operation.appId="400";p.operation.metaAppUserId="999";
    await expect(repo.prepareOperation(p)).rejects.toThrow("OPERATION_PRIVACY_IDENTITY_BINDING_REQUIRED");expect(await repo.list("operations","tenant")).toHaveLength(0);
  });
  it("blocks Firestore enrollment atomically when a global app-user revocation lock exists",async()=>{
    const fake=fakeFirestore(),repo=new FirestorePlatformRepository(fake.db),now=Date.now();
    const tenant={id:"tenant",status:"ACTIVE" as const,migrationState:"READY" as const,registryRevision:1,policyRevision:1},member={tenantId:"tenant",operatorId:"actor",roles:["connection_admin"],allowedClientIds:["client"],disabledAt:null,revision:1},client={tenantId:"tenant",id:"client",status:"ACTIVE" as const,revision:1,verifiedBusinessIds:[]};
    const asset={key:"page",id:"123",type:"PAGE" as const,provider:"META_FACEBOOK_PAGES" as const,appId:"456",tenantId:"tenant",clientId:"client",parents:[],verifiedAt:now,revokedAt:null,revision:1};
    for(const [collection,id,value] of [["tenants","tenant",tenant],["members","actor",member],["clients","client",client],["assets","page",asset]] as const)await repo.put(collection,"tenant",id,value as never);
    const connection={id:"connection",tenantId:"tenant",operatorId:"actor",provider:"META_FACEBOOK_PAGES" as const,appId:"456",subjectId:"123",credentialId:"credential",authStrategy:"fixture",tokenType:"page" as const,scopes:["pages_read_engagement"],assetKeys:["page"],expiresAt:now+3600000,revokedAt:null,verifiedAt:now,revision:1};
    const lock=createHash("sha256").update(JSON.stringify(["meta-app-user","456","actor"])).digest("hex");fake.data.set("platform_lifecycle_locks/"+lock,{state:"UNKNOWN",expiresAt:now-1});
    const before=fake.data.size;
    await expect(repo.commitControlPlane({tenantId:"tenant",expected:[{collection:"tenants",id:"tenant",canonical:canonicalJson(tenant)},{collection:"members",id:"actor",canonical:canonicalJson(member)},{collection:"clients",id:"client",canonical:canonicalJson(client)},{collection:"assets",id:"page",canonical:canonicalJson(asset)}],writes:[{collection:"connections",id:"connection",value:connection,createOnly:true}],audit:{id:"enrollment",tenantId:"tenant",clientId:"client",actorId:"actor",event:"CONNECTION_ENROLLED",timestamp:now,subjectId:"connection",planHash:"hash"}})).rejects.toThrow("APP_USER_LIFECYCLE_ENROLLMENT_LOCKED");
    expect(fake.data.size).toBe(before);expect(fake.calls.filter(c=>c==="create"||c==="set")).toEqual([]);
  });
  it("roundtrips approval TTL metadata without leaking Date values into canonical CAS", async () => {
    const fake = fakeFirestore(), repo = new FirestorePlatformRepository(fake.db), now = Date.now();
    const tenant = { id: "tenant", status: "ACTIVE" as const, policyRevision: 1, registryRevision: 1, migrationState: "READY" as const };
    const member = { operatorId: "actor", tenantId: "tenant", roles: ["writer"], allowedClientIds: ["client"], revision: 1, disabledAt: null };
    const client = { id: "client", tenantId: "tenant", status: "ACTIVE" as const, revision: 1, verifiedBusinessIds: [] };
    await repo.put("tenants", "tenant", "tenant", tenant); await repo.put("members", "tenant", "actor", member); await repo.put("clients", "tenant", "client", client);
    await repo.put('operatorIndex','_index','actor',{operatorId:'actor',tenantId:'tenant'});
    const expected = [{ collection: "tenants" as const, id: "tenant", canonical: canonicalJson(tenant) }, { collection: "members" as const, id: "actor", canonical: canonicalJson(member) }, { collection: "clients" as const, id: "client", canonical: canonicalJson(client) }];
    const request = { id: "request", tenantId: "tenant", clientId: "client", actorId: "actor", tool: "pages_create_feed", provider: "META_FACEBOOK_PAGES" as const, planHash: "hash", revisionHash: "revision", expiresAt: now + 60000, approvedAt: null, approvalId: null, encryptedPlan: { ciphertext: "fixture", iv: "fixture", tag: "fixture" } };
    await repo.commitControlPlane({ tenantId: "tenant", expected, writes: [{ collection: "approvalRequests", id: request.id, value: request, createOnly: true }], audit: { id: "audit-created", tenantId: "tenant", clientId: "client", actorId: "actor", event: "APPROVAL_REQUESTED", timestamp: now, subjectId: request.id, planHash: "hash" } });
    const raw = [...fake.data.entries()].find(([path]) => path.includes("/approvalRequests/"))![1] as Record<string, unknown>;
    expect(raw.expireTime).toEqual(new Date(request.expiresAt));
    const read = (await repo.get("approvalRequests", "tenant", request.id))!;
    expect(read).toEqual(request); expect(await repo.list("approvalRequests", "tenant")).toEqual([request]);
    expect(() => canonicalJson(read)).not.toThrow();
    await repo.commitControlPlane({ tenantId: "tenant", expected: [...expected, { collection: "approvalRequests", id: request.id, canonical: canonicalJson(read) }], writes: [{ collection: "approvalRequests", id: request.id, value: { ...request, approvedAt: now, approvalId: "approval" }, createOnly: false }], audit: { id: "audit-approved", tenantId: "tenant", clientId: "client", actorId: "actor", event: "APPROVAL_ISSUED", timestamp: now, subjectId: request.id, planHash: "hash" } });
    expect((await repo.get("approvalRequests", "tenant", request.id))?.approvalId).toBe("approval");
  });
  it("rechecks approval expiry after delayed transactional reads before any writes", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const fake = fakeFirestore(() => { now = 2000; }), repo = new FirestorePlatformRepository(fake.db);
      // These absent context markers isolate delayed expiry; current global identity
      // ownership remains explicit so the earlier index guard cannot mask it.
      for(const operatorId of ['actor','missing'])await repo.put('operatorIndex','_index',operatorId,{operatorId,tenantId:'tenant'});
      const request = { id: "request", tenantId: "tenant", clientId: "client", actorId: "actor", tool: "pages_create_feed", provider: "META_FACEBOOK_PAGES" as const, planHash: "hash", revisionHash: "revision", expiresAt: 1500, approvedAt: 1000, approvalId: "approval", encryptedPlan: { ciphertext: "fixture", iv: "fixture", tag: "fixture" } };
      await expect(repo.commitControlPlane({ tenantId: "tenant", expected: ["tenants", "members", "clients"].map(collection => ({ collection: collection as "tenants" | "members" | "clients", id: "missing", canonical: "null" })), writes: [{ collection: "approvalRequests", id: request.id, value: request, createOnly: true }], audit: { id: "audit", tenantId: "tenant", clientId: "client", actorId: "actor", event: "APPROVAL_ISSUED", timestamp: 1000, subjectId: request.id, planHash: "hash" } })).rejects.toThrow("EXPIRED_AT_COMMIT");
      expect(fake.calls).not.toContain("create"); expect(fake.calls).not.toContain("set");
    } finally { vi.restoreAllMocks(); }
  });
  it("uses dedicated hashed server-owned operator index and validates membership",async()=>{const fake=fakeFirestore();const repo=new FirestorePlatformRepository(fake.db);await repo.put("operatorIndex","_index","actor",{operatorId:"actor",tenantId:"tenant"});expect(await repo.resolvePrincipal("actor")).toBeNull();await repo.put("members","tenant","actor",{operatorId:"actor",tenantId:"tenant",roles:["reader"],allowedClientIds:["client"],revision:1,disabledAt:null});expect(await repo.resolvePrincipal("actor")).toEqual({operatorId:"actor",tenantId:"tenant"});expect([...fake.data.keys()].some(k=>k.startsWith("platform_operator_index/")&&!k.includes("actor"))).toBe(true);});
  it("durably claims operation and audit together and rejects duplicate",async()=>{const fake=fakeFirestore();const repo=new FirestorePlatformRepository(fake.db);await repo.prepareOperation(preparation());expect((await repo.get("operations","tenant","op"))?.state).toBe("PREPARED");expect(await repo.list("audit","tenant")).toHaveLength(1);await expect(repo.prepareOperation(preparation())).rejects.toThrow("ALREADY_EXISTS");});
  it("checks authorization snapshot before any writes",async()=>{const fake=fakeFirestore();const repo=new FirestorePlatformRepository(fake.db);const tenant={id:"tenant",status:"ACTIVE" as const,policyRevision:1,registryRevision:1,migrationState:"READY" as const};await repo.put("tenants","tenant","tenant",tenant);await expect(repo.prepareOperation({...preparation(),expectedRecords:[{collection:"tenants",id:"tenant",canonical:canonicalJson({...tenant,policyRevision:2})}]})).rejects.toThrow("AUTHORIZATION_CHANGED");expect(await repo.list("audit","tenant")).toHaveLength(0);expect(fake.calls).not.toContain("create");});
  it("consumes approval and records operation in same read-before-write transaction",async()=>{const fake=fakeFirestore();const repo=new FirestorePlatformRepository(fake.db);const p=preparation();p.approvalId="approval";p.operation.approvalId="approval";p.audit.approvalId="approval";await repo.put("approvals","tenant","approval",{id:"approval",tenantId:"tenant",clientId:"client",actorId:"actor",approverId:"human",approverRevision:1,planHash:"hash",revisionHash:"revision",expiresAt:Date.now()+10000,consumedAt:null,operationId:null});await repo.put("members","tenant","human",{operatorId:"human",tenantId:"tenant",roles:["approver"],allowedClientIds:["client"],revision:1,disabledAt:null});await repo.prepareOperation(p);expect((await repo.get("approvals","tenant","approval"))?.operationId).toBe("op");expect(fake.calls.slice(0,3)).toEqual(["get","get","get"]);});
  it.each(["actor","client","plan","expiry","revision"])("rejects mismatched approval %s without audit",async variant=>{const fake=fakeFirestore();const repo=new FirestorePlatformRepository(fake.db);const p=preparation();p.approvalId="approval";p.operation.approvalId="approval";p.audit.approvalId="approval";const a={id:"approval",tenantId:"tenant",clientId:"client",actorId:"actor",approverId:"human",approverRevision:1,planHash:"hash",revisionHash:"revision",expiresAt:Date.now()+10000,consumedAt:null,operationId:null};if(variant==="actor")a.actorId="other";if(variant==="client")a.clientId="other";if(variant==="plan")a.planHash="other";if(variant==="expiry")a.expiresAt=1;if(variant==="revision")a.revisionHash="other";await repo.put("approvals","tenant","approval",a);await expect(repo.prepareOperation(p)).rejects.toThrow("APPROVAL_INVALID");expect(await repo.list("audit","tenant")).toHaveLength(0);});
  it.each(["missing","reader","disabled","wrong-client","revision"])("requires active scoped approver membership %s",async variant=>{const fake=fakeFirestore();const repo=new FirestorePlatformRepository(fake.db);const p=preparation();p.approvalId="approval";p.operation.approvalId="approval";p.audit.approvalId="approval";await repo.put("approvals","tenant","approval",{id:"approval",tenantId:"tenant",clientId:"client",actorId:"actor",approverId:"human",approverRevision:1,planHash:"hash",revisionHash:"revision",expiresAt:Date.now()+10000,consumedAt:null,operationId:null});if(variant!=="missing")await repo.put("members","tenant","human",{operatorId:"human",tenantId:"tenant",roles:variant==="reader"?["reader"]:["approver"],allowedClientIds:variant==="wrong-client"?["other"]:["client"],revision:variant==="revision"?2:1,disabledAt:variant==="disabled"?1:null});await expect(repo.prepareOperation(p)).rejects.toThrow("APPROVER_MEMBERSHIP_REQUIRED");expect(await repo.list("operations","tenant")).toHaveLength(0);expect(await repo.list("audit","tenant")).toHaveLength(0);expect((await repo.get("approvals","tenant","approval"))?.consumedAt).toBeNull();});
  it("atomically writes terminal audit and state and is idempotent for same outcome",async()=>{const fake=fakeFirestore();const repo=new FirestorePlatformRepository(fake.db);const p=preparation();await repo.prepareOperation(p);const audit={...p.audit,id:"op:result",event:"UNKNOWN" as const,timestamp:Date.now()};await repo.finishOperation({tenantId:"tenant",operationId:"op",result:"UNKNOWN",audit});await repo.finishOperation({tenantId:"tenant",operationId:"op",result:"UNKNOWN",audit:{...audit,timestamp:audit.timestamp+100}});expect((await repo.get("operations","tenant","op"))?.state).toBe("UNKNOWN");expect(await repo.list("audit","tenant")).toHaveLength(2);await expect(repo.finishOperation({tenantId:"tenant",operationId:"op",result:"FAILED",audit:{...audit,event:"FAILED"}})).rejects.toThrow("ALREADY_FINISHED");});
});



describe("Firestore atomic created-asset completion",()=>{
  async function createdFixture(beforeGet?:()=>void){
    const fake=fakeFirestore(beforeGet),repo=new FirestorePlatformRepository(fake.db),p=preparation(),now=Date.now();await repo.prepareOperation(p);
    const parent={key:"parent",id:"101",type:"AD_ACCOUNT" as const,tenantId:"tenant",clientId:"client",provider:"META_MARKETING" as const,appId:"3001",parents:[],verifiedAt:now,revokedAt:null,revision:1};
    const connection={id:"connection",tenantId:"tenant",operatorId:"actor",provider:"META_MARKETING" as const,authStrategy:"facebook_business",credentialId:"credential",appId:"3001",tokenType:"user" as const,scopes:["ads_management"],assetKeys:["parent"],expiresAt:now+60000,revokedAt:null,verifiedAt:now,revision:1};
    const parentGrant={id:"parent-grant",tenantId:"tenant",clientId:"client",assetKey:"parent",connectionId:"connection",capabilities:["ads.read"],actions:["READ" as const,"WRITE_AD_CONFIGURATION" as const],tasks:[],verifiedAt:now,expiresAt:now+60000,revokedAt:null,revision:1};
    const rows=[{collection:"tenants" as const,id:"tenant",value:{id:"tenant",status:"ACTIVE" as const,policyRevision:1,registryRevision:1,migrationState:"READY" as const}},{collection:"members" as const,id:"actor",value:{operatorId:"actor",tenantId:"tenant",roles:["admin"],allowedClientIds:["client"],revision:1,disabledAt:null}},{collection:"clients" as const,id:"client",value:{id:"client",tenantId:"tenant",status:"ACTIVE" as const,revision:1,verifiedBusinessIds:[]}},{collection:"assets" as const,id:"parent",value:parent},{collection:"connections" as const,id:"connection",value:connection},{collection:"grants" as const,id:"parent-grant",value:parentGrant}];
    for(const row of rows)await repo.put(row.collection,"tenant",row.id,row.value);
    const {assetKey}=await import("../../src/platform/assets.js");
    const asset={...parent,key:assetKey(parent.provider,parent.appId,{id:"303",type:"CAMPAIGN"}),id:"303",type:"CAMPAIGN" as const,parents:[{type:"AD_ACCOUNT" as const,id:"101"}],createdFromOperationId:"op"};
    const input:import("../../src/platform/repository.js").Completion={tenantId:"tenant",operationId:"op",result:"SUCCEEDED",audit:{...p.audit,id:"op:result",event:"SUCCEEDED",timestamp:now,createdAssetKey:asset.key,afterSummary:[{field:"newresource_id",value:"303"}]},created:{asset,grant:{...parentGrant,id:"child-grant",assetKey:asset.key},connectionBefore:connection,connectionAfter:{...connection,revision:2,assetKeys:["parent",asset.key]},expectedRecords:rows.map(r=>({collection:r.collection,id:r.id,canonical:canonicalJson(r.value)})),authorizationExpiresAt:now+30000}};
    return {repo,fake,input,parent,connection};
  }
  it("commits all five outcomes atomically and preserves exact idempotency",async()=>{
    const {repo,input}=await createdFixture();await repo.finishOperation(input);await repo.finishOperation({...input,audit:{...input.audit,timestamp:Date.now()+1}});
    expect((await repo.get("operations","tenant","op"))?.state).toBe("SUCCEEDED");expect((await repo.list("assets","tenant")).filter(a=>a.createdFromOperationId==="op")).toHaveLength(1);expect((await repo.get("connections","tenant","connection"))?.revision).toBe(2);expect(await repo.get("grants","tenant","child-grant")).not.toBeNull();
    await expect(repo.finishOperation({...input,created:undefined,audit:{...input.audit,createdAssetKey:undefined}})).rejects.toThrow();
  });
  it.each(["cas","duplicate","expanded-grant","expiry"])("rejects %s without any partial transaction writes",async variant=>{
    const {repo,fake,input,parent,connection}=await createdFixture();
    if(variant==="cas")await repo.put("connections","tenant","connection",{...connection,revision:2});
    if(variant==="duplicate")await repo.put("assets","tenant","foreign",{...parent,key:"foreign",id:"303",clientId:"foreign"});
    if(variant==="expanded-grant")input.created!.grant.capabilities.push("foreign.admin");
    if(variant==="expiry")input.created!.authorizationExpiresAt=1;
    const creates=fake.calls.filter(c=>c==="create").length;
    await expect(repo.finishOperation(input)).rejects.toThrow("CREATED_ASSET");
    expect(fake.calls.filter(c=>c==="create")).toHaveLength(creates);expect((await repo.get("operations","tenant","op"))?.state).toBe("PREPARED");expect(await repo.get("grants","tenant","child-grant")).toBeNull();
  });
});

describe("atomic ordered carousel child claims",()=>{
 for(const backend of ["memory","firestore"] as const)for(const mode of ["success","changed-child","duplicate","wrong-kind","missing"] as const)it(backend+":"+mode,async()=>{
 const repo=backend==="memory"?new InMemoryPlatformRepository():new FirestorePlatformRepository(fakeFirestore().db),p=preparation();p.operation.tool="instagram_create_carousel_container";p.audit.tool=p.operation.tool;
 const children=["11","12"].map(id=>({key:id,id,type:"MEDIA" as const,provider:"META_INSTAGRAM_FACEBOOK_LOGIN" as const,appId:"300",tenantId:"tenant",clientId:"client",parents:[],verifiedAt:p.now,revokedAt:null,revision:1,productKind:"instagram_carousel_item" as const}));
 for(const child of children)await repo.put("assets","tenant",child.key,child);
 const connection={id:"selected",tenantId:"tenant",operatorId:"actor",provider:"META_INSTAGRAM_FACEBOOK_LOGIN" as const,appId:"300",subjectId:"901",metaAppUserId:"901",tokenType:"user" as const,credentialId:"credential",authStrategy:"synthetic",assetKeys:[],scopes:[],expiresAt:p.now+60000,revokedAt:null,verifiedAt:p.now,revision:1};await repo.put("connections","tenant",connection.id,connection);p.operation.appId="300";p.operation.metaAppUserId="901";
 p.expectedRecords=children.map(child=>({collection:"assets" as const,id:child.key,canonical:canonicalJson(child)}));
 p.expectedRecords.push({collection:"connections",id:connection.id,canonical:canonicalJson(connection)});
 p.publicationClaims=children.map(before=>({before,after:{...before,revision:2,publicationClaim:{operationId:p.operation.id,claimedAt:p.now}}}));
 if(mode==="changed-child")await repo.put("assets","tenant","12",{...children[1],revision:2});
 if(mode==="duplicate")p.publicationClaims[1]=p.publicationClaims[0];
 if(mode==="wrong-kind")p.publicationClaims[1].before={...p.publicationClaims[1].before,productKind:"instagram_container"};
 if(mode==="missing")delete p.publicationClaims;
 if(mode==="success"){await repo.prepareOperation(p);for(const child of children)expect((await repo.get("assets","tenant",child.key))?.publicationClaim?.operationId).toBe("op");await expect(repo.prepareOperation(p)).rejects.toThrow();}
 else{await expect(repo.prepareOperation(p)).rejects.toThrow();expect((await repo.get("assets","tenant","11"))?.publicationClaim).toBeUndefined();expect(await repo.list("operations","tenant")).toHaveLength(0);}
 });
});
describe("permanent AD deletion claim preparation",()=>{it.each(["memory","firestore"] as const)("atomically consumes approval and reserves exact claim in %s",async kind=>{const repo=kind==="memory"?new InMemoryPlatformRepository():new FirestorePlatformRepository(fakeFirestore().db),p=preparation(),now=Date.now(),member={operatorId:"actor",tenantId:"tenant",roles:["admin"],allowedClientIds:["client"],disabledAt:null,revision:1},asset={key:"ad",id:"401",type:"AD" as const,provider:"META_MARKETING" as const,appId:"300",tenantId:"tenant",clientId:"client",parents:[],verifiedAt:now,revokedAt:null,revision:1};await repo.put("members","tenant","actor",member);await repo.put("assets","tenant","ad",asset);await repo.put("approvals","tenant","approval",{id:"approval",tenantId:"tenant",clientId:"client",actorId:"actor",approverId:"actor",approverRevision:1,planHash:"hash",revisionHash:"revision",expiresAt:now+60000,consumedAt:null});p.operation.tool=p.audit.tool="marketing_delete_paused_ad";const connection={id:"connection",tenantId:"tenant",operatorId:"actor",provider:"META_MARKETING" as const,appId:"300",metaAppUserId:"100",subjectId:"100",credentialId:"credential",tokenType:"user" as const,authStrategy:"synthetic",scopes:["ads_management"],assetKeys:["ad"],verifiedAt:now,expiresAt:now+60000,revokedAt:null,revision:1};await repo.put("connections","tenant","connection",connection);p.operation.appId="300";p.operation.metaAppUserId="100";p.operation.approvalId=p.audit.approvalId=p.approvalId="approval";p.now=now;p.expectedRecords=[{collection:"connections",id:"connection",canonical:canonicalJson(connection)},{collection:"members",id:"actor",canonical:canonicalJson(member)},{collection:"assets",id:"ad",canonical:canonicalJson(asset)}];p.deletionClaim={before:asset,after:{...asset,revision:2,deletionClaim:{operationId:p.operation.id,claimedAt:now}}};await repo.prepareOperation(p);expect((await repo.get("assets","tenant","ad"))?.deletionClaim?.operationId).toBe("op");expect((await repo.get("approvals","tenant","approval"))?.consumedAt).toBe(now);await expect(repo.prepareOperation({...p,operation:{...p.operation,id:"second"},audit:{...p.audit,id:"second:prepared",operationId:"second"}})).rejects.toThrow();});});
import {enrollClient,clientEnrollmentHash} from '../../src/platform/client-enrollment.js';
it.each(['success','rebound-index'])('actual Firestore client enrollment checks the global operator-index atomically: %s',async mode=>{const fake=fakeFirestore(),repo=new FirestorePlatformRepository(fake.db),principal={tenantId:'tenant',operatorId:'100'};await repo.put('operatorIndex','_index','100',principal);await repo.put('tenants','tenant','tenant',{id:'tenant',status:'ACTIVE',migrationState:'READY',registryRevision:1,policyRevision:1});await repo.put('members','tenant','100',{...principal,roles:['admin'],allowedClientIds:['old-client'],revision:1,disabledAt:null});const hash=clientEnrollmentHash(await repo.get('members','tenant','100')),original=repo.commitControlPlane.bind(repo);if(mode==='rebound-index')repo.commitControlPlane=async input=>{await repo.put('operatorIndex','_index','100',{operatorId:'100',tenantId:'foreign'});return original(input);};const invoke=()=>enrollClient(repo,principal,{clientId:'new-client',documentReferenceHash:'a'.repeat(64),roots:[{provider:'META_MARKETING',appId:'300',type:'AD_ACCOUNT',id:'123',parents:[]}]},hash);if(mode==='success'){expect(await invoke()).toMatchObject({grants_created:0,provider_calls:0});expect(await repo.get('clients','tenant','new-client')).not.toBeNull();expect((await repo.list('grants','tenant'))).toEqual([]);}else{await expect(invoke()).rejects.toThrow('CLIENT_ENROLLMENT_OPERATOR_INDEX_CHANGED');expect(await repo.get('clients','tenant','new-client')).toBeNull();expect((await repo.get('members','tenant','100'))?.allowedClientIds).toEqual(['old-client']);}});

describe("explicit operation connection amid owner-evidence connections",()=>{it.each(["memory","firestore"] as const)("binds operation privacy to only selected connection in %s",async kind=>{for(const mode of ["selected","missing","foreign"]){const repo=kind==="memory"?new InMemoryPlatformRepository():new FirestorePlatformRepository(fakeFirestore().db),p=preparation(),now=Date.now(),selected={id:"target",tenantId:"tenant",operatorId:"actor",provider:"META_MARKETING" as const,appId:"300",metaAppUserId:"100",subjectId:"100",credentialId:"target-credential",tokenType:"user" as const,authStrategy:"synthetic",scopes:["ads_management"],assetKeys:[],verifiedAt:now,expiresAt:now+60000,revokedAt:null,revision:1},source={...selected,id:"business-proof",provider:"META_BUSINESS" as const,appId:"900",metaAppUserId:"200",subjectId:"200",credentialId:"business-credential"};for(const c of [selected,source]){await repo.put("connections","tenant",c.id,c);p.expectedRecords.push({collection:"connections",id:c.id,canonical:canonicalJson(c)});}p.operation.appId="300";p.operation.metaAppUserId="100";if(mode!=="missing")p.selectedConnectionId=mode==="selected"?selected.id:source.id;if(mode==="selected"){await repo.prepareOperation(p);expect((await repo.get("operations","tenant","op"))?.metaAppUserId).toBe("100");}else{await expect(repo.prepareOperation(p)).rejects.toThrow("OPERATION_PRIVACY_IDENTITY_BINDING_REQUIRED");expect(await repo.list("operations","tenant")).toHaveLength(0);}}});});

it.each(['memory','firestore'] as const)('rejects corrupted approval deadlines without consuming the approval or creating audit in %s',async kind=>{for(const expiresAt of [NaN,Infinity,-1,0]){const repo=kind==='memory'?new InMemoryPlatformRepository():new FirestorePlatformRepository(fakeFirestore().db),p=preparation();p.approvalId=p.operation.approvalId=p.audit.approvalId='approval';await repo.put('members','tenant','human',{operatorId:'human',tenantId:'tenant',roles:['approver'],allowedClientIds:['client'],revision:1,disabledAt:null});await repo.put('approvals','tenant','approval',{id:'approval',tenantId:'tenant',clientId:'client',actorId:'actor',approverId:'human',approverRevision:1,planHash:'hash',revisionHash:'revision',expiresAt,consumedAt:null,operationId:null});await expect(repo.prepareOperation(p)).rejects.toThrow('APPROVAL_INVALID_OR_REPLAYED');expect(await repo.list('operations','tenant')).toHaveLength(0);expect(await repo.list('audit','tenant')).toHaveLength(0);expect((await repo.get('approvals','tenant','approval'))?.consumedAt).toBeNull();}});
