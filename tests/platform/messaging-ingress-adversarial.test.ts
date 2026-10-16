import {createHmac} from "node:crypto";
import type {Server} from "node:http";
import express from "express";
import {describe,it,expect} from "vitest";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {InMemoryMessagingPolicyStore,MessagingPolicyService} from "../../src/platform/messaging-policy.js";
import {signedIngressFixture} from "./signed-ingress-fixture.js";
import {trustedMessagingInboundRecorder} from "../../src/platform/events/messaging-inbound.js";
import {createMetaWebhookRouter,type VerifiedWebhookBatch} from "../../src/platform/events/router.js";
import {TransactionalEventStore,InMemoryAtomicDatabase} from "../../src/platform/events/store.js";
import type {WebhookSubscription} from "../../src/platform/events/types.js";
const subscription:WebhookSubscription={id:"s",appId:"a",enabled:true,products:["messenger","whatsapp"],secretReference:"secret",verifyTokenReference:"verify"};
async function fixture(whatsapp=false){
  const now=Date.now(),repo=new InMemoryPlatformRepository(),store=new InMemoryMessagingPolicyStore(),policy=new MessagingPolicyService(store,Buffer.alloc(32,9)),provider=whatsapp?"META_WHATSAPP" as const:"META_MESSENGER" as const;
  const base={tenantId:"t",clientId:"c",provider,appId:"a",verifiedAt:now-1,revokedAt:null,revision:1};
  if(whatsapp){await repo.put("assets","t","waac",{...base,key:"waac",id:"11",type:"WHATSAPP_ACCOUNT",parents:[]});await repo.put("assets","t","account",{...base,key:"account",id:"12",type:"MESSAGING_ACCOUNT",parents:[{type:"WHATSAPP_ACCOUNT",id:"11"}]});}
  await repo.put("assets","t","leaf",{...base,key:"leaf",id:"123",type:whatsapp?"WHATSAPP_PHONE":"PAGE",parents:whatsapp?[{type:"WHATSAPP_ACCOUNT",id:"11"},{type:"MESSAGING_ACCOUNT",id:"12"}]:[]});
  const payload=whatsapp?{object:"whatsapp_business_account",entry:[{id:"12",changes:[{field:"messages",value:{metadata:{phone_number_id:"123"},messages:[{id:"mid1",from:"12065550123",timestamp:String(Math.floor((now-1000)/1000)),type:"text",text:{body:"private content"}}]}}]}]}:{object:"page",entry:[{id:"123",messaging:[{sender:{id:"456"},recipient:{id:"123"},timestamp:now-1000,message:{mid:"mid1",text:"private content"}}]}]};
  const raw=Buffer.from(JSON.stringify(payload)),mapAsset=async(_s:WebhookSubscription,product:"messenger"|"whatsapp"|"leads"|"pages"|"instagram",assetId:string)=>({tenantId:"t",clientId:"c",product,assetId}),{events,proof}=await signedIngressFixture(raw,subscription,mapAsset,now),bridge=trustedMessagingInboundRecorder(repo,policy);
  const record=(r:Buffer,e:typeof events,s:WebhookSubscription)=>bridge(r,e,s,proof);
  return {now,repo,store,policy,raw,events,record,bridge,mapAsset};
}
describe("messaging ingress adversarial boundaries",()=>{
  it.each([undefined,{kind:"signed-meta-batch"},true])("rejects freely fabricated signature proof %j",async proof=>{
    const f=await fixture();await expect(f.bridge(f.raw,f.events,subscription,proof as VerifiedWebhookBatch)).rejects.toThrow("verified_signed_batch_required");expect(f.store.audit).toHaveLength(0);
  });
  it("never invokes the private window bridge for absent, invalid or mismatched signatures",async()=>{
    const f=await fixture(),eventStore=new TransactionalEventStore(new InMemoryAtomicDatabase()),app=express();let calls=0;
    app.use("/meta",createMetaWebhookRouter({subscriptions:{get:async()=>subscription},secrets:{get:async()=>"synthetic-secret"},mapAsset:f.mapAsset,store:eventStore,onVerifiedEvents:async(...args)=>{calls++;await f.bridge(...args);}}));
    const server:Server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
    try{const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/meta/s`,valid="sha256="+createHmac("sha256","synthetic-secret").update(f.raw).digest("hex");
      for(const signature of [undefined,"sha256="+"0".repeat(64),"sha256="+createHmac("sha256","other-app-secret").update(f.raw).digest("hex")])expect((await fetch(url,{method:"POST",headers:{"content-type":"application/json",...(signature?{"x-hub-signature-256":signature}:{})},body:f.raw})).status).toBe(401);
      expect(calls).toBe(0);expect(f.store.audit).toHaveLength(0);
      expect((await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-hub-signature-256":valid},body:f.raw})).status).toBe(200);
      expect(calls).toBe(1);expect(f.store.audit).toHaveLength(1);expect(JSON.stringify(f.store.audit)).not.toContain("456");expect(JSON.stringify(f.store.audit)).not.toContain("private content");
    }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });
  it("rejects a substituted sender against normalized payload evidence",async()=>{
    const f=await fixture(),body=JSON.parse(f.raw.toString());body.entry[0].messaging[0].sender.id="999";
    await expect(f.record(Buffer.from(JSON.stringify(body)),f.events,subscription)).rejects.toThrow();expect(f.store.audit).toHaveLength(0);
  });
  it("rejects substituted source event identity",async()=>{
    const f=await fixture();await expect(f.record(f.raw,[{...f.events[0],id:"f".repeat(64)}],subscription)).rejects.toThrow();expect(f.store.audit).toHaveLength(0);
  });
  it.each(["missing-waac","foreign-client-account","foreign-app-account"])("rejects WhatsApp inbound with %s",async attack=>{
    const f=await fixture(true),phone=(await f.repo.get("assets","t","leaf"))!,account=(await f.repo.get("assets","t","account"))!;
    if(attack==="missing-waac")await f.repo.put("assets","t","leaf",{...phone,parents:phone.parents.filter(p=>p.type!=="WHATSAPP_ACCOUNT")});
    if(attack==="foreign-client-account")await f.repo.put("assets","t","account",{...account,clientId:"other"});
    if(attack==="foreign-app-account")await f.repo.put("assets","t","account",{...account,appId:"other"});
    await expect(f.record(f.raw,f.events,subscription)).rejects.toThrow();expect(f.store.audit).toHaveLength(0);
  });
  it("records a signed same-client WhatsApp inbound as pseudonymous metadata",async()=>{
    const f=await fixture(true);await f.record(f.raw,f.events,subscription);await f.record(f.raw,f.events,subscription);expect(f.store.audit).toHaveLength(1);expect(JSON.stringify(f.store.audit)).not.toContain("12065550123");expect(JSON.stringify(f.store.audit)).not.toContain("private content");
  });
  it("requires the signed WhatsApp envelope account to equal the phone's registered Messaging account parent",async()=>{
    const f=await fixture(true),account=(await f.repo.get("assets","t","account"))!;await f.repo.put("assets","t","other-account",{...account,key:"other-account",id:"99"});
    const body=JSON.parse(f.raw.toString());body.entry[0].id="99";const raw=Buffer.from(JSON.stringify(body)),{events,proof}=await signedIngressFixture(raw,subscription,f.mapAsset,f.now);
    await expect(f.bridge(raw,events,subscription,proof)).rejects.toThrow();expect(f.store.audit).toHaveLength(0);
  });
});
