import {createHmac} from "node:crypto";
import express from "express";
import {createMetaWebhookRouter,type VerifiedWebhookBatch} from "../../src/platform/events/router.js";
import type {AssetMapper} from "../../src/platform/events/normalize.js";
import {TransactionalEventStore,InMemoryAtomicDatabase} from "../../src/platform/events/store.js";
import type {NormalizedEvent,WebhookSubscription} from "../../src/platform/events/types.js";
/** Obtain an actual opaque proof through local signed HTTP ingress; never fabricate signature evidence. */
export async function signedIngressFixture(raw:Buffer,subscription:WebhookSubscription,mapAsset:AssetMapper,now=Date.now()):Promise<{events:NormalizedEvent[];proof:VerifiedWebhookBatch}>{
  let capture:{events:NormalizedEvent[];proof:VerifiedWebhookBatch}|undefined;
  const app=express();app.use("/meta",createMetaWebhookRouter({subscriptions:{get:async()=>subscription},secrets:{get:async()=>"synthetic-local-secret"},mapAsset,store:new TransactionalEventStore(new InMemoryAtomicDatabase()),now:()=>now,onVerifiedEvents:async(_raw,events,_subscription,proof)=>{capture={events,proof};}}));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  try{const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/meta/${subscription.id}`,{method:"POST",headers:{"content-type":"application/json","x-hub-signature-256":"sha256="+createHmac("sha256","synthetic-local-secret").update(raw).digest("hex")},body:raw});if(response.status!==200 || !capture)throw new Error("signed fixture ingress failed");return capture;}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
