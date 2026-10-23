import { describe, expect, it } from "vitest";
import type { Firestore } from "@google-cloud/firestore";
import { FirestoreMessagingPolicyStore, InMemoryMessagingPolicyStore, MessagingPolicyService, type MessagingExecution, type TrustedInboundEvidence, type TrustedOptInEvidence, type TrustedTemplateEvidence } from "../../src/platform/messaging-policy.js";
import type { AssetGrant, MetaAsset, Provider } from "../../src/platform/models.js";

const now=1_800_000_000_000,key=Buffer.alloc(32,7),recipient="+12065550123";
const inbound:TrustedInboundEvidence={eventId:"a".repeat(64),occurredAt:now-1000,receivedAt:now-500,verified:true,source:"meta_signed_webhook"};
const optIn:TrustedOptInEvidence={eventId:"b".repeat(64),occurredAt:now-1000,receivedAt:now-500,expiresAt:now+60_000,verified:true,source:"verified_client_consent",purpose:"utility",granted:true};
const template:TrustedTemplateEvidence={eventId:"c".repeat(64),occurredAt:now-1000,receivedAt:now-500,expiresAt:now+60_000,name:"appointment_reminder",language:"en_US",accountId:"2",status:"APPROVED",category:"UTILITY",verified:true,source:"meta_authenticated_template_refresh"};
function fixture(provider:Provider="META_WHATSAPP") {
  const store=new InMemoryMessagingPolicyStore(),service=new MessagingPolicyService(store,key,()=>now);
  const base:MetaAsset={key:"waac",id:"1",type:"WHATSAPP_ACCOUNT",tenantId:"t",clientId:"c",provider,appId:"app",parents:[],verifiedAt:now-1000,revokedAt:null,revision:1};
  const waac={...base},account:MetaAsset={...base,key:"account",id:"2",type:"MESSAGING_ACCOUNT",parents:[{type:"WHATSAPP_ACCOUNT",id:"1"}]};
  const asset:MetaAsset={...base,key:"phone",id:"3",type:provider==="META_WHATSAPP"?"WHATSAPP_PHONE":"PAGE",parents:provider==="META_WHATSAPP"?[{type:"WHATSAPP_ACCOUNT",id:"1"},{type:"MESSAGING_ACCOUNT",id:"2"}]:[]};
  const assets=provider==="META_WHATSAPP"?[waac,account,asset]:[asset];
  const grants:AssetGrant[]=assets.map(a=>({id:`g-${a.key}`,tenantId:"t",clientId:"c",assetKey:a.key,connectionId:"connection",capabilities:["send"],actions:["WRITE_MESSAGING"],tasks:[],verifiedAt:now-1000,expiresAt:now+60_000,revokedAt:null,revision:1}));
  const execution:MessagingExecution={context:{principal:{tenantId:"t",operatorId:"o"},clientId:"c",provider,tool:"send",requestId:"r"},plan:{parameters:{},assets:[{type:asset.type,id:asset.id}],classes:["WRITE_MESSAGING"],capability:"send",requiredScopes:[],tokenTypes:[]},snapshot:{tenant:{id:"t",status:"ACTIVE",migrationState:"READY",registryRevision:1,policyRevision:1},client:{id:"c",tenantId:"t",status:"ACTIVE",revision:1,verifiedBusinessIds:[]},member:{operatorId:"o",tenantId:"t",roles:["writer"],allowedClientIds:["c"],revision:1,disabledAt:null},assets,grants,connection:{id:"connection",tenantId:"t",operatorId:"o",provider,appId:"app",credentialId:"credential",authStrategy:"embedded",tokenType:"business_integration_system_user",scopes:[],assetKeys:assets.map(a=>a.key),expiresAt:now+60_000,revokedAt:null,verifiedAt:now-1000,revision:1}}};
  const scope=service.scope({tenantId:"t",clientId:"c",provider,appId:"app",assetId:"3"},recipient);
  return {store,service,execution,scope};
}
describe("trusted messaging policy",()=>{
  it("requires exactly32bytes of recipient HMAC key",()=>{expect(()=>new MessagingPolicyService(new InMemoryMessagingPolicyStore(),Buffer.alloc(31))).toThrow("HMAC_KEY");});
  it("stores no raw recipient or message payload and scopes HMAC to all boundaries",async()=>{
    const f=fixture();await f.service.recordTrustedInbound(f.scope,{...inbound,body:"must not persist"} as TrustedInboundEvidence);
    expect(JSON.stringify(await f.store.get(f.scope))).not.toContain("must not persist");expect(JSON.stringify(f.store.audit)).not.toContain(recipient);
    for(const change of [{tenantId:"other"},{clientId:"other"},{provider:"META_MESSENGER" as const},{appId:"other"},{assetId:"other"}])expect(f.service.scope({...f.scope,...change},recipient).recipientHmac).not.toEqual(f.scope.recipientHmac);
  });
  it.each([{occurredAt:now+1},{receivedAt:now+1},{occurredAt:now-24*60*60_000},{verified:false},{source:"caller_assertion"},{eventId:"raw-event"}])("rejects invalid inbound evidence %j",async change=>{
    const f=fixture();await expect(f.service.recordTrustedInbound(f.scope,{...inbound,...change} as TrustedInboundEvidence)).rejects.toThrow();expect(f.store.audit).toHaveLength(0);
  });
  it("deduplicates a replayed event without resetting its window or duplicating audit",async()=>{
    const f=fixture();expect(await f.service.recordTrustedInbound(f.scope,inbound)).toBe("RECORDED");expect(await f.service.recordTrustedInbound(f.scope,{...inbound,occurredAt:now-50,receivedAt:now-10})).toBe("DUPLICATE");
    expect((await f.store.get(f.scope))?.inbound?.occurredAt).toBe(inbound.occurredAt);expect(f.store.audit).toHaveLength(1);
  });
  it("does not let out of order events shorten or restart the latest window",async()=>{
    const f=fixture();await f.service.recordTrustedInbound(f.scope,inbound);await f.service.recordTrustedInbound(f.scope,{...inbound,eventId:"d".repeat(64),occurredAt:now-2000,receivedAt:now-100});expect((await f.store.get(f.scope))?.inbound?.occurredAt).toBe(inbound.occurredAt);
  });
  it("allows Messenger response only with trusted inbound evidence",async()=>{
    const f=fixture("META_MESSENGER");await f.service.recordTrustedInbound(f.scope,inbound);expect(await f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).toEqual({validUntil:now-1000+24*3600000});
    await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"template",template:{name:template.name,language:template.language}})).rejects.toThrow("RESPONSE_ONLY");
  });
  it("requires separate WhatsApp opt-in and selects the client Messaging account",async()=>{
    const f=fixture();await f.service.recordTrustedInbound(f.scope,inbound);await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).rejects.toThrow("OPT_IN");
    await f.service.recordTrustedOptIn(f.scope,optIn);expect(await f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).toEqual({messagingAccountId:"2",validUntil:now+60000});
  });
  it("allows outside-window utility templates only with exact approved fresh evidence",async()=>{
    const f=fixture();await f.service.recordTrustedOptIn(f.scope,optIn);await f.service.recordTrustedTemplate(f.scope,template);
    expect(await f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"template",template:{name:template.name,language:template.language}})).toEqual({messagingAccountId:"2",validUntil:now+60000});
    await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).rejects.toThrow("WINDOW");
    for(const selected of [{name:"other",language:template.language},{name:template.name,language:"es"}])await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"template",template:selected})).rejects.toThrow("APPROVED_TEMPLATE");
  });
  it("honors newer opt-out and does not allow an older opt-in to resurrect consent",async()=>{
    const f=fixture();await f.service.recordTrustedInbound(f.scope,inbound);await f.service.recordTrustedOptIn(f.scope,optIn);
    await f.service.recordTrustedOptIn(f.scope,{...optIn,eventId:"d".repeat(64),occurredAt:now-100,receivedAt:now-50,granted:false});
    await f.service.recordTrustedOptIn(f.scope,{...optIn,eventId:"e".repeat(64)});
    await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).rejects.toThrow("OPT_IN");
  });
  it("makes revocation and nonapproved template status dominate equal-time evidence",async()=>{
    const f=fixture();await f.service.recordTrustedInbound(f.scope,inbound);await f.service.recordTrustedOptIn(f.scope,{...optIn,granted:false});await f.service.recordTrustedOptIn(f.scope,{...optIn,eventId:"d".repeat(64),granted:true});
    await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).rejects.toThrow("OPT_IN");
    await f.service.recordTrustedTemplate(f.scope,{...template,status:"DISABLED"});await f.service.recordTrustedTemplate(f.scope,{...template,eventId:"e".repeat(64),status:"APPROVED"});expect((await f.store.get(f.scope))?.templates[0].status).toBe("DISABLED");
  });
  it("bounds retention to90days and strips expired state while rejecting old source replay",async()=>{
    let clock=now;const store=new InMemoryMessagingPolicyStore(()=>clock),service=new MessagingPolicyService(store,key,()=>clock),scope=fixture().scope;
    await expect(service.recordTrustedOptIn(scope,{...optIn,expiresAt:now+91*24*60*60_000})).rejects.toThrow("OPT_IN");
    await expect(service.recordTrustedTemplate(scope,{...template,expiresAt:now+91*24*60*60_000})).rejects.toThrow("TEMPLATE");
    await service.recordTrustedInbound(scope,inbound);await service.recordTrustedOptIn(scope,optIn);expect(await store.get(scope)).not.toHaveProperty("expireTime");
    clock=now+91*24*60*60_000;expect(await store.get(scope)).toBeNull();expect(store.audit).toHaveLength(0);await expect(service.recordTrustedInbound(scope,inbound)).rejects.toThrow("EVIDENCE");
  });
  it.each(["PENDING","PAUSED","REJECTED","DISABLED"] as const)("never sends a %s template",async status=>{
    const f=fixture();await f.service.recordTrustedOptIn(f.scope,optIn);await f.service.recordTrustedTemplate(f.scope,{...template,status});await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"template",template:{name:template.name,language:template.language}})).rejects.toThrow("APPROVED_TEMPLATE");
  });
  it("revokes previous approval on a newer disabled refresh",async()=>{
    const f=fixture();await f.service.recordTrustedOptIn(f.scope,optIn);await f.service.recordTrustedTemplate(f.scope,template);await f.service.recordTrustedTemplate(f.scope,{...template,eventId:"d".repeat(64),occurredAt:now-100,status:"DISABLED",receivedAt:now-50});await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"template",template})).rejects.toThrow("APPROVED_TEMPLATE");
  });
  it.each(["cross-client","missing-grant","multiple-billing"])("rejects %s account authorization",async mode=>{
    const f=fixture();await f.service.recordTrustedOptIn(f.scope,optIn);await f.service.recordTrustedInbound(f.scope,inbound);
    if(mode==="cross-client")f.execution.snapshot.assets[1].clientId="other";
    if(mode==="missing-grant")f.execution.snapshot.grants=f.execution.snapshot.grants.filter(g=>g.assetKey!=="waac");
    if(mode==="multiple-billing")f.execution.snapshot.assets[2].parents.push({type:"MESSAGING_ACCOUNT",id:"4"});
    await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).rejects.toThrow(/BILLING_ACCOUNT/);
  });
  it("refuses another recipient and another provider context",async()=>{
    const f=fixture();await f.service.recordTrustedOptIn(f.scope,optIn);await f.service.recordTrustedInbound(f.scope,inbound);await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient:"+12065550999",mode:"text"})).rejects.toThrow("POLICY_EVIDENCE");
    f.execution.context.provider="META_MESSENGER";await expect(f.service.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).rejects.toThrow("SCOPE_REQUIRED");
  });
  it("fails closed after evidence expiry rather than using receipt time to prolong window",async()=>{
    const f=fixture();await f.service.recordTrustedInbound(f.scope,inbound);await f.service.recordTrustedOptIn(f.scope,optIn);
    const later=new MessagingPolicyService(f.store,key,()=>now+24*60*60_000);
    f.execution.snapshot.connection.verifiedAt=now+24*60*60_000-1;f.execution.snapshot.connection.expiresAt=now+25*60*60_000;
    f.execution.snapshot.assets.forEach(a=>a.verifiedAt=now+24*60*60_000-1);f.execution.snapshot.grants.forEach(g=>{g.verifiedAt=now+24*60*60_000-1;g.expiresAt=now+25*60*60_000;});
    await expect(later.verifyExecution(f.execution,{assetId:"3",recipient,mode:"text"})).rejects.toThrow("OPT_IN");
  });
});

describe("Firestore messaging transaction adapter",()=>{
  it("atomically commits event, state and audit and treats duplicate events as read-only",async()=>{
    const records=new Map<string,unknown>();let writes=0;let fail=false;
    const db={collection:(name:string)=>({doc:(id:string)=>({id:`${name}/${id}`,get:async()=>({exists:records.has(`${name}/${id}`),data:()=>structuredClone(records.get(`${name}/${id}`))})})}),runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
      const staged=new Map<string,unknown>();const tx={get:async(ref:{id:string})=>({exists:records.has(ref.id),data:()=>structuredClone(records.get(ref.id))}),create:(ref:{id:string},v:unknown)=>{if(records.has(ref.id))throw new Error("exists");staged.set(ref.id,structuredClone(v));},set:(ref:{id:string},v:unknown)=>staged.set(ref.id,structuredClone(v))};
      const result=await work(tx);if(fail)throw new Error("transaction failed");for(const [id,v]of staged){records.set(id,v);writes++;}return result;
    }} as unknown as Firestore;
    const store=new FirestoreMessagingPolicyStore(db),service=new MessagingPolicyService(store,key,()=>now),scope=fixture().scope;
    fail=true;await expect(service.recordTrustedInbound(scope,inbound)).rejects.toThrow("transaction failed");expect(records.size).toBe(0);
    fail=false;expect(await service.recordTrustedInbound(scope,inbound)).toBe("RECORDED");expect(writes).toBe(3);expect(await service.recordTrustedInbound(scope,inbound)).toBe("DUPLICATE");expect(writes).toBe(3);
    expect((await store.get(scope))?.inbound?.occurredAt).toBe(inbound.occurredAt);expect(await store.get(scope)).not.toHaveProperty("expireTime");expect(JSON.stringify([...records.values()])).not.toContain(recipient);
    for(const value of records.values())expect((value as {expireTime:Date}).expireTime).toBeInstanceOf(Date);
  });
});
