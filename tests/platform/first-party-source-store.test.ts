import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "@google-cloud/firestore";
import { TrustedFirstPartySourceStore, InMemoryFirstPartySourceStorage, FirestoreFirstPartySourceStorage } from "../../src/platform/first-party-source-store.js";
import { firstPartySignalDigest, type SignalEvidence } from "../../src/platform/signals.js";
const scope={tenantId:"tenant",clientId:"client",datasetId:"123"},adapter="approved-crm-fixture";
let now=1800000000000;
function payload(){const raw={event_name:"Lead",event_id:"event-fixture",event_time:now/1000,action_source:"website",source_reference:"private-source-fixture",consent_reference:"private-consent-fixture",event_source_url:"https://fixture.invalid/lead",user_data:{em:"private-customer@example.invalid"}};const evidence:SignalEvidence={...scope,payloadDigest:firstPartySignalDigest(raw),sourceReference:raw.source_reference,consentReference:raw.consent_reference,eventId:raw.event_id,eventTime:raw.event_time,eventName:raw.event_name,authorized:true,expiresAt:now+3600000};return {raw,evidence};}
function fixture(){const storage=new InMemoryFirstPartySourceStorage(),store=new TrustedFirstPartySourceStore(storage,{approvedIngestionAdapterId:adapter,now:()=>now});return {storage,store};}
beforeEach(()=>{now=1800000000000;vi.stubEnv("TOKEN_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("hex"));});afterEach(()=>vi.unstubAllEnvs());
describe("trusted encrypted first-party source store",()=>{
  it("requires approved ingestion adapter and refuses empty stores",async()=>{
    expect(()=>new TrustedFirstPartySourceStore(new InMemoryFirstPartySourceStorage(),{approvedIngestionAdapterId:""})).toThrow("ADAPTER_REQUIRED_HOLD");
    const {store}=fixture();expect(await store.resolve(scope,"source","consent")).toBeNull();const {raw,evidence}=payload();await expect(store.ingestVerified("foreign",scope,raw,evidence)).rejects.toThrow("APPROVED_TRUSTED");
  });
  it("encrypts complete payload/evidence and writes only bounded metadata audit",async()=>{
    const {store,storage}=fixture(),{raw,evidence}=payload();const id=await store.ingestVerified(adapter,scope,raw,evidence);
    expect(id).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify([...storage.records.values(),...storage.audits])).not.toMatch(/private-source|private-consent|private-customer/);
    expect(storage.audits).toHaveLength(1);expect(storage.audits[0].expiresAt).toBe(now+90*86400000);
    expect(await store.resolve(scope,raw.source_reference,raw.consent_reference)).toEqual({raw,evidence});
  });
  it("copies ingestion and resolved inputs across asynchronous boundaries",async()=>{
    const {store}=fixture(),{raw,evidence}=payload();const pending=store.ingestVerified(adapter,scope,raw,evidence);raw.user_data.em="mutated@example.invalid";evidence.authorized=false;await pending;
    const first=(await store.resolve(scope,raw.source_reference,raw.consent_reference))!;expect((first.raw as typeof raw).user_data.em).toBe("private-customer@example.invalid");(first.raw as typeof raw).user_data.em="another@example.invalid";
    expect(((await store.resolve(scope,raw.source_reference,raw.consent_reference))!.raw as typeof raw).user_data.em).toBe("private-customer@example.invalid");
  });
  it.each(["tenant","client","target","source","consent"])("cannot resolve foreign %s binding",async variant=>{
    const {store}=fixture(),{raw,evidence}=payload();await store.ingestVerified(adapter,scope,raw,evidence);
    const other={...scope,...(variant==="tenant"?{tenantId:"foreign"}:variant==="client"?{clientId:"foreign"}:variant==="target"?{datasetId:"999"}:{})};
    expect(await store.resolve(other,variant==="source"?"foreign":raw.source_reference,variant==="consent"?"foreign":raw.consent_reference)).toBeNull();
  });
  it.each(["digest","consent","expired","retention","event","scope"])("rejects incomplete or invalid %s evidence before storage",async variant=>{
    const {store,storage}=fixture(),{raw,evidence}=payload();if(variant==="digest")evidence.payloadDigest="0".repeat(64);if(variant==="consent")evidence.authorized=false;if(variant==="expired")evidence.expiresAt=now;if(variant==="retention")evidence.expiresAt=now+7*86400000+1;if(variant==="event")evidence.eventId="other";if(variant==="scope")evidence.clientId="foreign";
    await expect(store.ingestVerified(adapter,scope,raw,evidence)).rejects.toThrow();expect(storage.records.size).toBe(0);expect(storage.audits).toHaveLength(0);
  });
  it("concurrent identical ingestion writes one record and one audit",async()=>{
    const {store,storage}=fixture(),{raw,evidence}=payload();const ids=await Promise.all(Array.from({length:8},()=>store.ingestVerified(adapter,scope,raw,evidence)));expect(new Set(ids).size).toBe(1);expect(storage.audits).toHaveLength(1);
  });
  it("revokes encrypted evidence atomically and never silently reauthorizes",async()=>{
    const {store,storage}=fixture(),{raw,evidence}=payload();await store.ingestVerified(adapter,scope,raw,evidence);
    expect(await store.revokeVerified(adapter,scope,raw.source_reference,raw.consent_reference)).toBe(true);expect(await store.resolve(scope,raw.source_reference,raw.consent_reference)).toBeNull();expect(storage.audits.map(a=>a.event)).toEqual(["INGESTED","REVOKED"]);
    await expect(store.ingestVerified(adapter,scope,raw,evidence)).rejects.toThrow("CONFLICT_OR_REVOKED");expect(await store.revokeVerified(adapter,scope,raw.source_reference,raw.consent_reference)).toBe(false);
  });
  it("does not depend on asynchronous TTL deletion to enforce expiry",async()=>{const {store}=fixture(),{raw,evidence}=payload();await store.ingestVerified(adapter,scope,raw,evidence);now=evidence.expiresAt;expect(await store.resolve(scope,raw.source_reference,raw.consent_reference)).toBeNull();});
  it("detects encrypted PII corruption and metadata tampering",async()=>{
    const {store,storage}=fixture(),{raw,evidence}=payload();const id=await store.ingestVerified(adapter,scope,raw,evidence),record=storage.records.get(id)!;record.payloadDigest="0".repeat(64);
    await expect(store.resolve(scope,raw.source_reference,raw.consent_reference)).rejects.toThrow("BINDING_INVALID_HOLD");
  });
  it("rolls back record and audit on storage failure without printing payload",async()=>{
    const {storage}=fixture(),{raw,evidence}=payload();const store=new TrustedFirstPartySourceStore({get:async()=>{throw new Error(raw.user_data.em);},transaction:async run=>storage.transaction(async tx=>{await run(tx);throw new Error(raw.user_data.em);})},{approvedIngestionAdapterId:adapter,now:()=>now});
    await expect(store.ingestVerified(adapter,scope,raw,evidence)).rejects.toThrow(/^TRUSTED_SOURCE_STORAGE_UNAVAILABLE_HOLD$/);expect(storage.records.size).toBe(0);expect(storage.audits).toHaveLength(0);
    await expect(store.resolve(scope,raw.source_reference,raw.consent_reference)).rejects.toThrow(/^TRUSTED_SOURCE_STORAGE_OR_INTEGRITY_HOLD$/);
  });
});
function firestoreFake(){
  const data=new Map<string,Record<string,unknown>>();const ref=(collection:string,id:string)=>({path:collection+"/"+id,get:async()=>({exists:data.has(collection+"/"+id),data:()=>structuredClone(data.get(collection+"/"+id))})});
  const db={collection:(name:string)=>({doc:(id:string)=>ref(name,id)}),runTransaction:async(run:(tx:unknown)=>Promise<unknown>)=>{const writes:Array<()=>void>=[];const result=await run({get:async(r:{path:string})=>{if(writes.length)throw new Error("read-after-write");return {exists:data.has(r.path),data:()=>structuredClone(data.get(r.path))};},create:(r:{path:string},value:Record<string,unknown>)=>{if(data.has(r.path))throw new Error("exists");writes.push(()=>data.set(r.path,structuredClone(value)));},set:(r:{path:string},value:Record<string,unknown>)=>writes.push(()=>data.set(r.path,structuredClone(value)))});writes.forEach(write=>write());return result;}};return {db:db as unknown as Firestore,data};
}
it("Firestore uses hashed document IDs, encrypted rows, Date TTL and atomic metadata audit",async()=>{
  const fake=firestoreFake(),store=new TrustedFirstPartySourceStore(new FirestoreFirstPartySourceStorage(fake.db),{approvedIngestionAdapterId:adapter,now:()=>now}),{raw,evidence}=payload();await store.ingestVerified(adapter,scope,raw,evidence);
  expect(fake.data.size).toBe(2);for(const [key,row]of fake.data){expect(key.split("/")[1]).toMatch(/^[a-f0-9]{64}$/);expect(row.expireTime).toBeInstanceOf(Date);expect(JSON.stringify(row)).not.toContain(raw.user_data.em);}
  expect(await store.resolve(scope,raw.source_reference,raw.consent_reference)).toEqual({raw,evidence});await store.revokeVerified(adapter,scope,raw.source_reference,raw.consent_reference);expect(fake.data.size).toBe(3);expect(await store.resolve(scope,raw.source_reference,raw.consent_reference)).toBeNull();
});

it("rechecks expiry after delayed transaction reads before storing anything",async()=>{
  const {storage}=fixture(),{raw,evidence}=payload();evidence.expiresAt=now+10;
  const store=new TrustedFirstPartySourceStore({get:id=>storage.get(id),transaction:run=>storage.transaction(tx=>run({...tx,get:async id=>{const row=await tx.get(id);now+=11;return row;}}))},{approvedIngestionAdapterId:adapter,now:()=>now});
  await expect(store.ingestVerified(adapter,scope,raw,evidence)).rejects.toThrow("EXPIRED_AT_COMMIT");expect(storage.records.size).toBe(0);expect(storage.audits).toHaveLength(0);
});
it("rejects ciphertext transplanted across exact scoped bindings",async()=>{
  const {store,storage}=fixture(),first=payload();const firstId=await store.ingestVerified(adapter,scope,first.raw,first.evidence);
  const otherScope={...scope,clientId:"other"},other=payload();other.evidence.clientId="other";const secondId=await store.ingestVerified(adapter,otherScope,other.raw,other.evidence);
  storage.records.get(secondId)!.encrypted=storage.records.get(firstId)!.encrypted;
  await expect(store.resolve(otherScope,other.raw.source_reference,other.raw.consent_reference)).rejects.toThrow("INTEGRITY_HOLD");
});
