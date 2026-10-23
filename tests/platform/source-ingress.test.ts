import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import express from "express";
import type {Server} from "node:http";
import {createSourceIngressRouter,sourceIngressSignature,sourceIngressBinding,environmentSourceIngressRouter,type SourceIngressProfile} from "../../src/platform/source-ingress.js";
import {InMemoryPlatformRepository} from "../../src/platform/repository.js";
import {InMemoryFirstPartySourceStorage,TrustedFirstPartySourceStore} from "../../src/platform/first-party-source-store.js";

const key="ab".repeat(32),profile:SourceIngressProfile={id:"crm-client-a",adapterId:"crm-v1",tenantId:"tenant",clientId:"client-a",operatorId:"operator",pixelId:"101",appId:"202",secretReference:"LUMIN_FIRST_PARTY_INGRESS_KEY_CLIENT_A",enabled:true};
let server:Server|undefined;
beforeEach(()=>{vi.stubEnv("TOKEN_ENCRYPTION_KEY","12".repeat(32));});
afterEach(async()=>{await new Promise<void>(r=>server?server.close(()=>r()):r());server=undefined;vi.unstubAllEnvs();});
async function fixture(){
  const now=Date.now(),repo=new InMemoryPlatformRepository(),storage=new InMemoryFirstPartySourceStorage(),store=new TrustedFirstPartySourceStore(storage,{approvedIngestionAdapterId:profile.adapterId});
  await repo.put("tenants","tenant","tenant",{id:"tenant",status:"ACTIVE",migrationState:"READY",registryRevision:1,policyRevision:1});
  await repo.put("operatorIndex","_index","operator",{tenantId:"tenant",operatorId:"operator"});
  await repo.put("members","tenant","operator",{tenantId:"tenant",operatorId:"operator",roles:["writer"],allowedClientIds:["client-a"],revision:1,disabledAt:null});
  await repo.put("clients","tenant","client-a",{tenantId:"tenant",id:"client-a",status:"ACTIVE",revision:1,verifiedBusinessIds:[]});
  await repo.put("assets","tenant","pixel",{key:"pixel",tenantId:"tenant",clientId:"client-a",type:"PIXEL",id:"101",provider:"META_MARKETING",appId:"202",parents:[],verifiedAt:now-1000,revokedAt:null,revision:1});
  const app=express();app.use("/sources",createSourceIngressRouter({profiles:[profile],repository:repo,secret:async()=>key,store:()=>store}));
  server=await new Promise<Server>(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const address=server.address() as {port:number},url=`http://127.0.0.1:${address.port}/sources/${profile.id}`;
  const body={action:"INGEST",event:{source_reference:"source-1",consent_reference:"consent-1",event_name:"Lead",event_id:"event-1",event_time:Math.floor(now/1000),action_source:"website",event_source_url:"https://example.invalid/lead",user_data:{em:"private@example.invalid"}},consent:{reference:"consent-1",authorized:true,expiresAt:now+60000,purpose:"META_CONVERSIONS",recordedAt:now-1000}};
  async function send(input:unknown=body,options:{key?:string;timestamp?:string;delivery?:string;profileId?:string;signature?:string}={}){const raw=Buffer.from(JSON.stringify(input)),timestamp=options.timestamp??String(Date.now()),delivery=options.delivery??"delivery-1";return fetch(url,{method:"POST",headers:{"content-type":"application/json","x-lumin-timestamp":timestamp,"x-lumin-delivery":delivery,"x-lumin-signature":options.signature??sourceIngressSignature(raw,options.profileId??profile.id,timestamp,delivery,options.key??key,sourceIngressBinding(profile))},body:raw});}
  return {repo,storage,store,body,send,scope:{tenantId:"tenant",clientId:"client-a",datasetId:"101"}};
}
describe("signed private first-party ingress",()=>{
  it("stores authenticated source encrypted, idempotently, without dispatch or response PII",async()=>{
    const f=await fixture();const first=await f.send();expect(first.status).toBe(202);expect(await first.json()).toEqual({status:"STORED",providerDispatch:false});expect((await f.send()).status).toBe(202);expect(f.storage.records.size).toBe(1);expect(f.storage.audits).toHaveLength(1);expect(JSON.stringify([...f.storage.records.values()])).not.toContain("private@example.invalid");expect((await f.store.resolve(f.scope,"source-1","consent-1"))?.evidence.authorized).toBe(true);
  });
  it.each(["bad-key","expired","future","different-profile","malformed"])("rejects signature/replay boundary %s before storage",async mode=>{
    const f=await fixture(),options=mode==="bad-key"?{key:"cd".repeat(32)}:mode==="expired"?{timestamp:String(Date.now()-300001)}:mode==="future"?{timestamp:String(Date.now()+600001)}:mode==="different-profile"?{profileId:"crm-client-b"}:{signature:"bad"};expect((await f.send(f.body,options)).status).toBe(401);expect(f.storage.records.size).toBe(0);
  });
  it.each(["foreign-client","wrong-app","revoked-asset","disabled-operator","disabled-tenant"])("rejects current registry authorization %s",async mode=>{
    const f=await fixture();if(mode==="disabled-operator"){const m=(await f.repo.get("members","tenant","operator"))!;await f.repo.put("members","tenant","operator",{...m,disabledAt:Date.now()});}else if(mode==="disabled-tenant"){const t=(await f.repo.get("tenants","tenant","tenant"))!;await f.repo.put("tenants","tenant","tenant",{...t,status:"DISABLED"});}else{const a=(await f.repo.get("assets","tenant","pixel"))!;await f.repo.put("assets","tenant","pixel",{...a,...(mode==="foreign-client"?{clientId:"client-b"}:mode==="wrong-app"?{appId:"303"}:{revokedAt:Date.now()})});}expect((await f.send()).status).toBe(403);expect(f.storage.records.size).toBe(0);
  });
  it.each(["withdrawn","wrong-reference","wrong-purpose","future-consent","long-retention"])("rejects insufficient recorded consent %s",async mode=>{
    const f=await fixture(),body=structuredClone(f.body);if(mode==="withdrawn")body.consent.authorized=false;if(mode==="wrong-reference")body.consent.reference="other";if(mode==="wrong-purpose")body.consent.purpose="OTHER";if(mode==="future-consent")body.consent.recordedAt=Date.now()+60000;if(mode==="long-retention")body.consent.expiresAt=Date.now()+8*86400000;expect([400,403]).toContain((await f.send(body)).status);expect(f.storage.records.size).toBe(0);
  });
  it("atomically revokes and prevents old signed event from reauthorizing",async()=>{
    const f=await fixture();expect((await f.send()).status).toBe(202);expect((await f.send({action:"REVOKE",sourceReference:"source-1",consentReference:"consent-1"})).status).toBe(200);expect(await f.store.resolve(f.scope,"source-1","consent-1")).toBeNull();expect((await f.send()).status).toBe(403);expect(f.storage.audits.map(a=>a.event)).toEqual(["INGESTED","REVOKED"]);
  });
  it("honors consent revocation arriving before ingestion",async()=>{
    const f=await fixture();expect((await f.send({action:"REVOKE",sourceReference:"source-1",consentReference:"consent-1"})).status).toBe(200);expect((await f.send()).status).toBe(403);expect(f.storage.records.size).toBe(0);
  });
  it("binds the signature to immutable tenant client asset app configuration",async()=>{
    const f=await fixture(),raw=Buffer.from(JSON.stringify(f.body)),timestamp=String(Date.now()),delivery="delivery-1";
    const signature=sourceIngressSignature(raw,profile.id,timestamp,delivery,key,sourceIngressBinding({...profile,clientId:"other-client"}));
    expect((await f.send(f.body,{timestamp,delivery,signature})).status).toBe(401);expect(f.storage.records.size).toBe(0);
  });
  it("permits signed consent reduction after operator access is disabled",async()=>{
    const f=await fixture();expect((await f.send()).status).toBe(202);const member=(await f.repo.get("members","tenant","operator"))!;await f.repo.put("members","tenant","operator",{...member,disabledAt:Date.now()});
    expect((await f.send({action:"REVOKE",sourceReference:"source-1",consentReference:"consent-1"})).status).toBe(200);expect(await f.store.resolve(f.scope,"source-1","consent-1")).toBeNull();
  });
  it("does not initialize disabled runtime and rejects malformed configuration before storage",()=>{
    vi.stubEnv("LUMIN_PLATFORM_ENABLED","true");vi.stubEnv("LUMIN_FIRST_PARTY_INGRESS_ENABLED","false");expect(environmentSourceIngressRouter()).toBeNull();vi.stubEnv("LUMIN_FIRST_PARTY_INGRESS_ENABLED","true");vi.stubEnv("LUMIN_FIRST_PARTY_INGRESS_PROFILES_JSON","{}");expect(()=>environmentSourceIngressRouter()).toThrow("SOURCE_INGRESS_CONFIGURATION_REQUIRED");
  });
});
