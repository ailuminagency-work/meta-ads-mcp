import {describe,it,expect} from "vitest";
import {LocalEventInbox,InMemoryInboxStorage} from "../../src/platform/inbox.js";
import type {NormalizedEvent} from "../../src/platform/events/types.js";
const now=1800000000000,secret="synthetic-independent-inbox-cursor-secret";
const event:NormalizedEvent={id:"a".repeat(64),tenantId:"tenant",clientId:"client",product:"messenger",assetId:"123",subscriptionId:"subscription",appId:"456",kind:"message_received",occurredAt:now-1000,receivedAt:now,expiresAt:now+86400000,provenance:{provider:"meta",object:"page",field:"messages",payloadDigest:"b".repeat(64)},references:{messageId:"mid.test"}};
describe("independent inbox trust-boundary regressions",()=>{
  it("does not spread an adapter's unexpected private fields into a public result",async()=>{const inbox=new LocalEventInbox({put:async()=>{},list:async()=>[{id:"c".repeat(64),tenantId:"tenant",clientId:"client",product:"messenger",assetId:"123",eventId:event.id,kind:event.kind,occurredAt:event.occurredAt,receivedAt:now,expiresAt:now+86400000,references:{messageId:"mid.test"},sourceDigest:event.provenance.payloadDigest,privateCustomerText:"synthetic private adapter data"}]},secret,()=>now);let serialized="";try{serialized=JSON.stringify(await inbox.list({tenantId:"tenant",clientId:"client"},{since:now-10000,until:now+1000,limit:10}));}catch{serialized="rejected";}expect(serialized).not.toContain("privateCustomerText");expect(serialized).not.toContain("synthetic private adapter data");});
  it("rejects an invalid clock before persisting metadata",async()=>{const store=new InMemoryInboxStorage(),inbox=new LocalEventInbox(store,secret,()=>Number.NaN);await expect(inbox.deliver(event,{idempotencyKey:`${inbox.id}:${event.id}`})).rejects.toThrow();expect(store.rows.size).toBe(0);});
});
