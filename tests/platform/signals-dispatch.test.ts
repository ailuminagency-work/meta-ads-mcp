import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "@google-cloud/firestore";
import { FirstPartySignalDispatcher, FirestoreSignalDispatchStore, InMemorySignalDispatchStore, type TrustedFirstPartySourceResolver } from "../../src/platform/signals-dispatch.js";
import { firstPartySignalDigest, revalidatePreparedSignal, type FirstPartySignalInput, type SignalEvidence } from "../../src/platform/signals.js";

const now=1_800_000_000_000,scope={tenantId:"tenant",clientId:"client",datasetId:"101"},refs={source_reference:"trusted-order",consent_reference:"trusted-consent"};
function fixture(){
  const raw:FirstPartySignalInput={...refs,event_name:"Purchase",event_id:"order-1",event_time:Math.floor(now/1000),action_source:"website",event_source_url:"https://example.invalid/order",user_data:{em:"person@example.invalid",ph:"+12065550123"},custom_data:{currency:"USD",value:42}};
  const evidence:SignalEvidence={...scope,payloadDigest:firstPartySignalDigest(raw),sourceReference:refs.source_reference,consentReference:refs.consent_reference,eventId:raw.event_id,eventTime:raw.event_time,eventName:raw.event_name,authorized:true,expiresAt:now+60_000};
  const resolve=vi.fn(async()=>({raw,evidence})),source:TrustedFirstPartySourceResolver={resolve},store=new InMemorySignalDispatchStore(),send=vi.fn(async()=>({eventsReceived:1})),dispatcher=new FirstPartySignalDispatcher(source,store,{send},()=>now);
  return {raw,evidence,resolve,store,send,dispatcher};
}
describe("first-party signal dispatcher",()=>{
  it.each(["withdrawal","expiry","digest","source-substitution"])("re-reads trusted evidence at branded egress and blocks %s",async mode=>{
    const f=fixture(),egress=vi.fn();let count=0;
    f.resolve.mockImplementation(async()=>{
      count++;
      if(count===3){
        if(mode==="withdrawal")f.evidence.authorized=false;
        if(mode==="expiry")f.evidence.expiresAt=Date.now()-1;
        if(mode==="digest")f.raw.custom_data!.value=100;
        if(mode==="source-substitution"){f.raw.source_reference="foreign-source";f.evidence.sourceReference="foreign-source";f.evidence.payloadDigest=firstPartySignalDigest(f.raw);}
      }
      return {raw:f.raw,evidence:f.evidence};
    });
    const dispatcher=new FirstPartySignalDispatcher({resolve:f.resolve},f.store,{send:async(target,_event,prepared)=>{await revalidatePreparedSignal(prepared,target);egress();return {eventsReceived:1};}},()=>now);
    expect(await dispatcher.dispatch(scope,refs)).toMatchObject({state:"UNKNOWN"});expect(count).toBe(3);expect(egress).not.toHaveBeenCalled();
  });
  it("allows unchanged source evidence through real preparation-brand revalidation",async()=>{
    const f=fixture(),egress=vi.fn(),dispatcher=new FirstPartySignalDispatcher({resolve:f.resolve},f.store,{send:async(target,_event,prepared)=>{await revalidatePreparedSignal(prepared,target);egress();return {eventsReceived:1};}},()=>now);
    expect(await dispatcher.dispatch(scope,refs)).toMatchObject({state:"ACCEPTED"});expect(f.resolve).toHaveBeenCalledTimes(3);expect(egress).toHaveBeenCalledTimes(1);
  });
  it("commits Firestore checkpoints with audit atomically and preserves no-duplicate dispatch",async()=>{
    const records=new Map<string,unknown>();let fail=true;
    const db={collection:(name:string)=>({doc:(id:string)=>({id:`${name}/${id}`,get:async()=>({exists:records.has(`${name}/${id}`),data:()=>structuredClone(records.get(`${name}/${id}`))})})}),runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
      const staged=new Map<string,unknown>(),tx={get:async(ref:{id:string})=>({exists:records.has(ref.id),data:()=>structuredClone(records.get(ref.id))}),create:(ref:{id:string},value:unknown)=>{if(records.has(ref.id))throw new Error("exists");staged.set(ref.id,structuredClone(value));},set:(ref:{id:string},value:unknown)=>staged.set(ref.id,structuredClone(value))};
      const result=await work(tx);if(fail)throw new Error("atomic transaction failed");for(const [id,value]of staged)records.set(id,value);return result;
    }} as unknown as Firestore;
    const f=fixture(),store=new FirestoreSignalDispatchStore(db),dispatcher=new FirstPartySignalDispatcher({resolve:f.resolve},store,{send:f.send},()=>now);
    await expect(dispatcher.dispatch(scope,refs)).rejects.toThrow("atomic transaction failed");expect(records.size).toBe(0);expect(f.send).not.toHaveBeenCalled();
    fail=false;expect(await dispatcher.dispatch(scope,refs)).toMatchObject({state:"ACCEPTED",duplicate:false});expect(records.size).toBe(4);expect(await dispatcher.dispatch(scope,refs)).toMatchObject({state:"ACCEPTED",duplicate:true});expect(f.send).toHaveBeenCalledTimes(1);expect(JSON.stringify([...records.values()])).not.toContain(f.raw.user_data.em);
  });
  it("resolves trusted references, hashes PII and stores only durable metadata",async()=>{
    const f=fixture(),result=await f.dispatcher.dispatch(scope,refs);expect(result.state).toBe("ACCEPTED");expect(result.duplicate).toBe(false);expect(f.send).toHaveBeenCalledTimes(1);
    const sent=f.send.mock.calls[0] as unknown as [typeof scope,Record<string,unknown>];expect(JSON.stringify(sent)).not.toContain(f.raw.user_data.em);expect(JSON.stringify(sent)).not.toContain(f.raw.user_data.ph);expect(sent[1].event_id).toBe("order-1");
    expect(f.store.audit.map(a=>a.state)).toEqual(["CLAIMED","ATTEMPTED","ACCEPTED"]);expect(JSON.stringify(f.store.audit)).not.toContain("person");expect(JSON.stringify(f.store.audit)).not.toContain(refs.source_reference);
  });
  it.each([{events:[]},{user_data:{em:"injected@example.invalid"}},{test_event_code:"TEST123"},{test_mode:true},{event_id:"fake"},{dataset_id:"202"}])("rejects model-supplied signal payload or test mode %j",async injected=>{
    const f=fixture();await expect(f.dispatcher.dispatch(scope,{...refs,...injected})).rejects.toThrow("REFERENCES_ONLY");expect(f.resolve).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
  });
  it("deduplicates repeated accepted events without repeating transport",async()=>{
    const f=fixture();await f.dispatcher.dispatch(scope,refs);expect(await f.dispatcher.dispatch(scope,refs)).toMatchObject({state:"ACCEPTED",duplicate:true});expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("makes at most one transport attempt for simultaneous dispatches",async()=>{
    const f=fixture();const results=await Promise.allSettled([f.dispatcher.dispatch(scope,refs),f.dispatcher.dispatch(scope,refs)]);expect(f.send).toHaveBeenCalledTimes(1);expect(results.some(r=>r.status==="fulfilled")).toBe(true);
  });
  it("preserves UNKNOWN after a transport exception and never automatically retries",async()=>{
    const f=fixture();f.send.mockRejectedValue(new Error("provider token must not leak"));expect(await f.dispatcher.dispatch(scope,refs)).toMatchObject({state:"UNKNOWN",duplicate:false});expect(await f.dispatcher.dispatch(scope,refs)).toMatchObject({state:"UNKNOWN",duplicate:true});expect(f.send).toHaveBeenCalledTimes(1);expect(JSON.stringify(f.store.audit)).not.toContain("token");
  });
  it("does not infer acceptance from malformed or partial receipts",async()=>{
    const f=fixture();f.send.mockResolvedValue({eventsReceived:0});expect(await f.dispatcher.dispatch(scope,refs)).toMatchObject({state:"UNKNOWN"});
  });
  it.each(["client","dataset","digest","consent","authorization"])("rejects mismatched trusted %s evidence before transport",async kind=>{
    const f=fixture();if(kind==="client")f.evidence.clientId="other";if(kind==="dataset")f.evidence.datasetId="202";if(kind==="digest")f.evidence.payloadDigest="0".repeat(64);if(kind==="consent")f.evidence.consentReference="other";if(kind==="authorization")f.evidence.authorized=false;
    await expect(f.dispatcher.dispatch(scope,refs)).rejects.toThrow("CONSENT_AND_SOURCE");expect(f.send).not.toHaveBeenCalled();
  });
  it("rejects changed payload under the same event identity even with refreshed evidence",async()=>{
    const f=fixture();await f.dispatcher.dispatch(scope,refs);f.raw.custom_data!.value=99;f.evidence.payloadDigest=firstPartySignalDigest(f.raw);await expect(f.dispatcher.dispatch(scope,refs)).rejects.toThrow("DEDUPLICATION_CONFLICT");expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("stops before egress if durable attempt marking fails",async()=>{
    const f=fixture();f.store.transition=async()=>{throw new Error("storage unavailable");};await expect(f.dispatcher.dispatch(scope,refs)).rejects.toThrow("storage unavailable");expect(f.send).not.toHaveBeenCalled();expect(await f.dispatcher.dispatch(scope,refs)).toMatchObject({state:"CLAIMED",duplicate:true});
  });
  it("preserves a checkpoint when response finalization fails and suppresses retries",async()=>{
    const f=fixture(),transition=f.store.transition.bind(f.store);f.store.transition=async(...args)=>{if(args[3]==="ACCEPTED")throw new Error("storage unavailable");return transition(...args);};
    await expect(f.dispatcher.dispatch(scope,refs)).rejects.toThrow("DURABLE_COMPLETION_PENDING");expect(await f.dispatcher.dispatch(scope,refs)).toMatchObject({state:"ATTEMPTED",duplicate:true});expect(f.send).toHaveBeenCalledTimes(1);
  });
});

it("applies fixed90-day Firestore TTL without extending expiry during state transitions",async()=>{
  let clock=Date.now();vi.spyOn(Date,"now").mockImplementation(()=>clock);
  try{
    const rows=new Map<string,Record<string,unknown>>();const db={collection:(name:string)=>({doc:(id:string)=>({id:name+"/"+id,get:async()=>({exists:rows.has(name+"/"+id),data:()=>structuredClone(rows.get(name+"/"+id))})})}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{const pending:Array<()=>void>=[];const result=await fn({get:async(ref:{id:string})=>({exists:rows.has(ref.id),data:()=>structuredClone(rows.get(ref.id))}),create:(ref:{id:string},value:Record<string,unknown>)=>pending.push(()=>rows.set(ref.id,structuredClone(value))),set:(ref:{id:string},value:Record<string,unknown>)=>pending.push(()=>rows.set(ref.id,structuredClone(value)))});pending.forEach(write=>write());return result;}} as unknown as Firestore;
    const store=new FirestoreSignalDispatchStore(db),record={id:"1".repeat(64),scopeHash:"2".repeat(64),payloadDigest:"3".repeat(64),sourceHash:"4".repeat(64),consentHash:"5".repeat(64),state:"CLAIMED" as const,createdAt:clock,updatedAt:clock},expires=clock+90*86400000;
    await store.claim(record);clock+=1000;await store.transition(record.id,record.scopeHash,"CLAIMED","ATTEMPTED",clock);
    expect(rows.size).toBe(3);for(const row of rows.values())expect(row.expireTime).toEqual(new Date(expires));expect(await store.get(record.id,record.scopeHash)).not.toHaveProperty("expireTime");
    clock=expires;await expect(store.get(record.id,record.scopeHash)).rejects.toThrow("EXPIRED_RECONCILIATION_HOLD");await expect(store.claim({...record,createdAt:clock,updatedAt:clock})).rejects.toThrow("EXPIRED_RECONCILIATION_HOLD");await expect(store.transition(record.id,record.scopeHash,"ATTEMPTED","ACCEPTED",clock)).rejects.toThrow("EXPIRED_RECONCILIATION_HOLD");expect(rows.size).toBe(3);expect(rows.get("platform_signal_dispatch/"+record.id)?.state).toBe("ATTEMPTED");
  }finally{vi.restoreAllMocks();}
});
it("in-memory checkpoint expiry also HOLDs without deleting or reclaiming the deduplication key",async()=>{
  let clock=Date.now();vi.spyOn(Date,"now").mockImplementation(()=>clock);
  try{const store=new InMemorySignalDispatchStore(),record={id:"a".repeat(64),scopeHash:"b".repeat(64),payloadDigest:"c".repeat(64),sourceHash:"d".repeat(64),consentHash:"e".repeat(64),state:"CLAIMED" as const,createdAt:clock,updatedAt:clock};await store.claim(record);clock+=90*86400000;await expect(store.claim({...record,createdAt:clock,updatedAt:clock})).rejects.toThrow("EXPIRED_RECONCILIATION_HOLD");await expect(store.get(record.id,record.scopeHash)).rejects.toThrow("EXPIRED_RECONCILIATION_HOLD");expect(store.audit).toHaveLength(1);}finally{vi.restoreAllMocks();}
});
