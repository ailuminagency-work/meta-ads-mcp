import type { Firestore } from "@google-cloud/firestore";
import { createHmac } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMetaWebhookRouter, validSignature } from "../../src/platform/events/router.js";
import { normalizeWebhook } from "../../src/platform/events/normalize.js";
import { InMemoryAtomicDatabase, TransactionalEventStore, firestoreEventDatabase } from "../../src/platform/events/store.js";
import { EventWorker } from "../../src/platform/events/worker.js";
import { EncryptedPayloadVault } from "../../src/platform/events/payload-vault.js";
import type { EventProduct, WebhookSubscription } from "../../src/platform/events/types.js";

const subscription: WebhookSubscription = { id: "sub-test", appId: "app-test", enabled: true, products: ["leads", "pages", "instagram", "messenger", "whatsapp"], secretReference: "secret-ref", verifyTokenReference: "verify-ref" };
const scope = { tenantId: "tenant-test", clientId: "client-test", assetId: "100", product: "leads" as EventProduct };
const raw = Buffer.from(JSON.stringify({ object: "page", entry: [{ id: "100", time: 1, changes: [{ field: "leadgen", value: { leadgen_id: "200", form_id: "300", private_field: "never persisted" } }] }] }));
const mapAsset = async (_subscription: WebhookSubscription, product: EventProduct, assetId: string) => ["100", "400"].includes(assetId) ? { ...scope, product, assetId } : null;
let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });

async function normalized() { return (await normalizeWebhook(raw, subscription, mapAsset, 1000, 86400_000))[0]; }

describe("durable event semantics", () => {
  it("rechecks delivery authorization and never calls adapter after revocation", async () => {
    const store = new TransactionalEventStore(new InMemoryAtomicDatabase(),()=>1000), event = await normalized();
    await store.enqueue([event]);
    let calls = 0;
    const worker = new EventWorker(store, { id: "crm", deliver: async () => { calls++; } }, async () => false, () => 1000);
    expect(await worker.deliver(scope, event.id)).toBe("dead_letter");
    expect(calls).toBe(0);
  });
  it("deduplicates concurrent deliveries and grants exactly one live lease", async () => {
    const store = new TransactionalEventStore(new InMemoryAtomicDatabase(),()=>1000), event = await normalized();
    const inserted = await Promise.all([store.enqueue([event]), store.enqueue([event])]);
    expect(inserted.reduce((sum, item) => sum + item.inserted, 0)).toBe(1);
    expect(await store.due(scope, 1000, 10)).toEqual([event.id]);
    expect(await store.due({ ...scope, clientId: "foreign" }, 1000, 10)).toEqual([]);
    const claims = await Promise.all([store.claim(scope, event.id, 1000, 60_000), store.claim(scope, event.id, 1000, 60_000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.claim({ ...scope, clientId: "foreign" }, event.id, 1000, 60_000)).toBeNull();
    expect(JSON.stringify(event)).not.toContain("private_field");
    expect(JSON.stringify(event)).not.toContain("never persisted");
  });
  it("fences stale leases and expires replay", async () => {
    const store = new TransactionalEventStore(new InMemoryAtomicDatabase(),()=>1000), event = await normalized();
    await store.enqueue([event]);
    const first = (await store.claim(scope, event.id, 1000, 1000))!;
    const second = (await store.claim(scope, event.id, 2001, 1000))!;
    expect(await store.finish(scope, event.id, first.leaseToken, 2002, "delivered")).toBe(false);
    expect(await store.finish(scope, event.id, second.leaseToken, 2002, "dead_letter")).toBe(true);
    expect(await store.replay(scope, event.id, event.expiresAt)).toBe(false);
  });
  it("retries bounded failures, dead-letters, replays and checkpoints only success", async () => {
    const store = new TransactionalEventStore(new InMemoryAtomicDatabase(),()=>1000), event = await normalized();
    await store.enqueue([event]);
    let now = 1000, fail = true;
    const worker = new EventWorker(store, { id: "crm", deliver: async (_event, context) => { expect(context.idempotencyKey).toBe(`crm:${event.id}`); if (fail) throw new Error("private downstream detail"); } }, async () => true, () => now);
    for (let i = 0; i < 5; i++) {
      expect(await worker.deliver(scope, event.id)).toBe(i === 4 ? "dead_letter" : "retry");
      now += 60_000;
    }
    expect(await store.checkpoint(scope, "crm")).toBeNull();
    expect(await store.replay({ ...scope, tenantId: "foreign" }, event.id, now)).toBe(false);
    expect(await store.replay(scope, event.id, now)).toBe(true);
    fail = false;
    expect(await worker.deliver(scope, event.id)).toBe("delivered");
    expect(await store.checkpoint(scope, "crm")).toBe(event.id);
    expect(await store.checkpoint({ ...scope, clientId: "foreign" }, "crm")).toBeNull();
  });
});

describe("signature, schema and trusted mapping", () => {
  it("checks exact raw bytes and strict signature format", () => {
    const secret = "synthetic-webhook-fixture";
    const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    expect(validSignature(raw, signature, secret)).toBe(true);
    expect(validSignature(Buffer.concat([raw, Buffer.from(" ")]), signature, secret)).toBe(false);
    expect(validSignature(raw, signature + "0", secret)).toBe(false);
    expect(validSignature(raw, undefined, secret)).toBe(false);
  });
  it("rejects Threads, malformed signed leads and foreign assets", async () => {
    await expect(normalizeWebhook(Buffer.from('{"object":"threads","entry":[]}'), subscription, mapAsset, 1, 1000)).rejects.toThrow();
    await expect(normalizeWebhook(raw, subscription, async () => ({ ...scope, assetId: "other" }), 1, 1000)).rejects.toThrow("unmapped_asset");
    await expect(normalizeWebhook(Buffer.from(raw.toString().replace('"leadgen_id":"200"', '"leadgen_id":{}')), subscription, mapAsset, 1, 1000)).rejects.toThrow("invalid_lead_schema");
  });
  it.each([
    { object: "page", entry: [{ id: "100", changes: [{ field: "feed", value: { item: "post", verb: "add", text: "private" } }] }] },
    { object: "instagram", entry: [{ id: "100", changes: [{ field: "comments", value: { id: "555", text: "private" } }] }] },
    { object: "page", entry: [{ id: "100", messaging: [{ recipient: { id: "100" }, message: { mid: "mid.1", text: "private" } }] }] },
    { object: "whatsapp_business_account", entry: [{ id: "100", changes: [{ field: "messages", value: { metadata: { phone_number_id: "400" }, statuses: [{ id: "wamid.1", status: "read", recipient_id: "private" }] } }] }] },
  ])("normalizes product metadata without content", async payload => {
    const events = await normalizeWebhook(Buffer.from(JSON.stringify(payload)), subscription, mapAsset, 1, 1000);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("private");
  });
});

it("acknowledges only durable storage and verifies GET challenges", async () => {
  let fail = false;
  const store = new TransactionalEventStore(new InMemoryAtomicDatabase(),()=>1000);
  const app = express();
  app.use("/webhooks/meta", createMetaWebhookRouter({ subscriptions: { get: async () => subscription }, secrets: { get: async ref => ref === "secret-ref" ? "synthetic-webhook-fixture" : "fixture-verify" }, mapAsset, store: { ...store, enqueue: async events => { if (fail) throw new Error("storage unavailable"); return store.enqueue(events); }, due: store.due.bind(store), claim: store.claim.bind(store), finish: store.finish.bind(store), replay: store.replay.bind(store), checkpoint: store.checkpoint.bind(store) } }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/webhooks/meta/sub-test`;
  expect((await fetch(base + "?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123")).status).toBe(403);
  expect(await (await fetch(base + "?hub.mode=subscribe&hub.verify_token=fixture-verify&hub.challenge=123")).text()).toBe("123");
  const headers = { "content-type": "application/json", "x-hub-signature-256": "sha256=" + createHmac("sha256", "synthetic-webhook-fixture").update(raw).digest("hex") };
  expect((await fetch(base, { method: "POST", headers, body: raw })).status).toBe(200);
  fail = true;
  expect((await fetch(base, { method: "POST", headers, body: raw })).status).toBe(503);
  expect((await fetch(base, { method: "POST", headers, body: Buffer.alloc(300_000) })).status).toBe(413);
});

it("optional payload vault stores authenticated ciphertext only", async () => {
  let stored: unknown;
  const vault = new EncryptedPayloadVault({ put: async (_ref, record) => { stored = record; } }, Buffer.alloc(32, 1), "fixture-v1");
  const pointer = await vault.put(Buffer.from("private-body"), "a".repeat(64), 1000);
  expect(pointer.expiresAt).toBe(1000);
  expect(JSON.stringify(stored)).not.toContain("private-body");
});

it("expires durable event checkpoints without silently extending or deleting their retention",async()=>{
  let clock=1000;const store=new TransactionalEventStore(new InMemoryAtomicDatabase(),()=>clock),event=await normalized();await store.enqueue([event]);const claim=await store.claim(scope,event.id,1000,60000);expect(await store.finish(scope,event.id,claim!.leaseToken,1001,"delivered",1001,"ttl-fixture")).toBe(true);expect(await store.checkpoint(scope,"ttl-fixture")).toBe(event.id);clock=1001+90*86400000;await expect(store.checkpoint(scope,"ttl-fixture")).rejects.toThrow("expired_reconciliation_hold");
});

it("Firestore applies checkpoint90-day TTL separately from shorter event metadata retention",async()=>{
  const rows=new Map<string,unknown>(),collection={doc:(id:string)=>({id})},db={collection:()=>collection,runTransaction:async(run:(tx:unknown)=>Promise<unknown>)=>{const writes:Array<()=>void>=[];const result=await run({get:async(ref:{id:string})=>({exists:rows.has(ref.id),data:()=>structuredClone(rows.get(ref.id))}),set:(ref:{id:string},value:unknown)=>writes.push(()=>rows.set(ref.id,structuredClone(value)))});writes.forEach(write=>write());return result;}} as unknown as Firestore;
  const store=new TransactionalEventStore(firestoreEventDatabase(db),()=>1000),event=await normalized();await store.enqueue([event]);const claim=await store.claim(scope,event.id,1000,60000);await store.finish(scope,event.id,claim!.leaseToken,1001,"delivered",1001,"ttl-fixture");const checkpoint=[...rows.entries()].find(([key])=>key.startsWith("checkpoint_"))![1] as {expireTime:Date};const record=[...rows.entries()].find(([key])=>key.startsWith("event_"))![1] as {expireTime:Date};expect(checkpoint.expireTime).toEqual(new Date(1001+90*86400000));expect(record.expireTime).toEqual(new Date(event.expiresAt));
});
