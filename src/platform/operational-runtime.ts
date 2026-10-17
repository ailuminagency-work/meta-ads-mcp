import {configuredOAuthProfiles} from "./connection-runtime.js";
import {createPageInspectionProfileVerifier} from "./oauth.js";
import {createHmac,timingSafeEqual} from "node:crypto";
import type express from "express";
import {z} from "zod";
import type {Firestore} from "@google-cloud/firestore";
import {getSession} from "../auth/session.js";
import {getFirestore} from "../store/firestore.js";
import {getPlatformRepository,platformEnabled} from "./runtime.js";
import type {PlatformRepository} from "./repository.js";
import {PlatformDenied} from "./models.js";
import {createFirestoreOperationalHost} from "./operational-host.js";
import {operationalHash,type OperationalStore} from "./operational-store.js";
import type {VerifiedWorkerAdapter} from "./operational-worker.js";
import {createSupervisedGrantRefreshWorkerAdapter} from "./grant-refresh-worker.js";
import {createEventConsumerWorkerAdapter} from "./operational-event-consumer.js";
import {getConfiguredWebhookDependencies,configureOperationalIngress} from "./events/runtime.js";
import {EventWorker} from "./events/worker.js";
import {LocalEventInbox,FirestoreInboxStorage} from "./inbox.js";
import {createFirestoreWebhookIndexRefresher,webhookIndexRefreshBindingSchema} from "./webhook-index-refresh.js";
import {resolveAuthorizedAssets} from "./assets.js";
import type {NormalizedEvent} from "./events/types.js";
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),product=z.enum(["leads","pages","instagram","messenger","whatsapp"]);
const scope=z.object({tenantId:identifier,clientId:identifier,assetId:z.string().regex(/^\d{1,100}$/)}).strict();
const workerSchema=z.object({id:identifier,secretReference:z.string().regex(/^LUMIN_WORKER_KEY_[A-Z0-9_]{1,64}$/),allowedScopes:z.array(scope).min(1).max(10),allowedAdapterIds:z.array(z.string().regex(/^(?:local_inbox_(?:leads|pages|instagram|messenger|whatsapp)|supervised_grant_refresh)$/)).min(1).max(6)}).strict();
export type OperationalWorkerProfile=z.infer<typeof workerSchema>;
const ingressSchema=scope.extend({operatorId:identifier,product}).strict();
let configuredInbox:LocalEventInbox|undefined;
export function configuredLocalInbox():LocalEventInbox{if(!configuredInbox)throw new PlatformDenied("LOCAL_INBOX_RUNTIME_REQUIRED_HOLD");return configuredInbox;}
export async function authorizeOperationalInboxEvent(repo:PlatformRepository,event:NormalizedEvent,operatorId:string,now=Date.now()):Promise<boolean>{
  const principal=await repo.resolvePrincipal(operatorId);if(!principal||principal.tenantId!==event.tenantId)return false;
  const [tenant,member,client,all,grants,connections]=await Promise.all([repo.get("tenants",event.tenantId,event.tenantId),repo.get("members",event.tenantId,operatorId),repo.get("clients",event.tenantId,event.clientId),repo.list("assets",event.tenantId),repo.list("grants",event.tenantId),repo.list("connections",event.tenantId)]);
  if(tenant?.status!=="ACTIVE"||tenant.migrationState!=="READY"||member?.disabledAt!==null||!member.roles.includes("admin")||!member.allowedClientIds.includes(event.clientId)||client?.status!=="ACTIVE"||client.tenantId!==event.tenantId)return false;
  const found=all.filter(a=>a.tenantId===event.tenantId&&a.clientId===event.clientId&&a.appId===event.appId&&a.id===event.assetId&&a.revokedAt===null);if(found.length!==1)return false;
  const asset=found[0],closure=await resolveAuthorizedAssets(repo,{principal,clientId:event.clientId,provider:asset.provider,tool:"internal_local_inbox_delivery",requestId:event.id},[{type:asset.type,id:asset.id}],now);
  const eligible=connections.filter(c=>c.tenantId===event.tenantId&&c.operatorId===operatorId&&c.provider===asset.provider&&c.appId===event.appId&&c.revokedAt===null&&c.expiresAt!==null&&c.expiresAt>now&&c.verifiedAt>0&&c.verifiedAt<=now&&now-c.verifiedAt<3600000&&closure.every(a=>c.assetKeys.includes(a.key)&&grants.some(g=>g.tenantId===event.tenantId&&g.clientId===event.clientId&&g.connectionId===c.id&&g.assetKey===a.key&&g.revokedAt===null&&g.expiresAt>now&&g.verifiedAt>0&&g.verifiedAt<=now&&now-g.verifiedAt<3600000&&g.actions.includes("READ"))));for(const c of eligible)if(!await repo.isAppUserLifecycleLocked?.(c.appId,c.operatorId,c.metaAppUserId))return true;return false;
}
export function operationalWorkerSignature(id:string,timestamp:string,nonce:string,key:string):string{return "sha256="+createHmac("sha256",Buffer.from(key,"hex")).update(`${id}\n${timestamp}\n${nonce}\nPOST\n/platform/operations/internal/worker/tick`).digest("hex");}
export function createOperationalWorkerResolver(profiles:readonly OperationalWorkerProfile[],secrets:(reference:string)=>Promise<string>,store:OperationalStore,clock:()=>number=Date.now){
  const selected=z.array(workerSchema).max(16).parse(structuredClone(profiles));
  if(new Set(selected.map(p=>p.id)).size!==selected.length||new Set(selected.map(p=>p.secretReference)).size!==selected.length)throw new PlatformDenied("OPERATIONAL_WORKER_PROFILE_DUPLICATE");
  return async(req:express.Request)=>{
    const id=req.get("x-lumin-worker"),timestamp=req.get("x-lumin-timestamp"),nonce=req.get("x-lumin-nonce"),signature=req.get("x-lumin-signature"),now=clock(),p=selected.find(p=>p.id===id);
    if(!p||req.method!=="POST"||req.originalUrl!=="/platform/operations/internal/worker/tick"||!Number.isSafeInteger(now)||!timestamp||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60000||!nonce||! /^[a-f0-9]{64}$/.test(nonce)||!signature||!/^sha256=[a-f0-9]{64}$/.test(signature)||req.body&&Object.keys(req.body).length)return null;
    const key=await secrets(p.secretReference);if(!/^[a-f0-9]{64}$/i.test(key))throw new PlatformDenied("OPERATIONAL_WORKER_KEY_REQUIRED");
    if(!timingSafeEqual(Buffer.from(signature),Buffer.from(operationalWorkerSignature(p.id,timestamp,nonce,key))))return null;
    const nonceId=operationalHash(JSON.stringify(["worker-nonce",p.id,nonce]));
    return store.transaction(async tx=>{if(await tx.get("worker_leases",nonceId))return null;const checked=clock();if(!Number.isSafeInteger(checked)||checked<=0||Math.abs(checked-Number(timestamp))>60000)return null;tx.create("worker_leases",nonceId,{id:nonceId,workerHash:operationalHash(p.id),createdAt:checked,expiresAt:checked+120000},checked+120000);return {id:p.id,allowedScopes:structuredClone(p.allowedScopes),allowedAdapterIds:[...p.allowedAdapterIds]};});
  };
}
export function environmentOperationalRouter(origin:string,options:{env?:Record<string,string|undefined>;db?:Firestore;repository?:PlatformRepository}={}):express.Router|null{
  const env=options.env??process.env,flag=env.LUMIN_PLATFORM_OPERATIONS_ENABLED;
  if(flag!==undefined&&!['true','false'].includes(flag))throw new PlatformDenied("INVALID_OPERATIONS_FLAG");
  if(flag!=="true"||!platformEnabled())return null;
  const parse=<T>(schema:z.ZodType<T>,name:string):T=>{try{const raw=env[name];if(!raw||raw.length>32000)throw new Error();return schema.parse(JSON.parse(raw));}catch{throw new PlatformDenied("OPERATIONAL_DEPLOYMENT_CONFIGURATION_REQUIRED");}};
  const profiles=parse(z.array(workerSchema).min(1).max(16),"LUMIN_OPERATIONAL_WORKERS_JSON"),ingress=env.LUMIN_OPERATIONAL_INGRESS_JSON?parse(z.array(ingressSchema).max(100),"LUMIN_OPERATIONAL_INGRESS_JSON"):[];
  const indexBindings=env.LUMIN_WEBHOOK_INDEX_REFRESH_BINDINGS_JSON?parse(z.array(webhookIndexRefreshBindingSchema).max(100),"LUMIN_WEBHOOK_INDEX_REFRESH_BINDINGS_JSON"):[];
  if(new Set(ingress.map(i=>JSON.stringify([i.tenantId,i.clientId,i.assetId,i.product]))).size!==ingress.length||ingress.some(i=>!profiles.some(p=>p.allowedScopes.some(s=>s.tenantId===i.tenantId&&s.clientId===i.clientId&&s.assetId===i.assetId)&&p.allowedAdapterIds.includes("local_inbox_"+i.product))))throw new PlatformDenied("OPERATIONAL_INGRESS_WORKER_BINDING_REQUIRED");
  for(const p of profiles)if(!/^[a-f0-9]{64}$/i.test(env[p.secretReference]??""))throw new PlatformDenied("OPERATIONAL_WORKER_KEY_REQUIRED");
  const secret=env.SESSION_COOKIE_SECRET??"";if(secret.length<32)throw new PlatformDenied("OPERATIONAL_SESSION_SECRET_REQUIRED");
  const repo=options.repository??getPlatformRepository(),db=options.db??getFirestore(),adapters=new Map<string,VerifiedWorkerAdapter>(),events=getConfiguredWebhookDependencies();
  if(ingress.length&&!events)throw new PlatformDenied("OPERATIONAL_WEBHOOK_RUNTIME_REQUIRED");
  const inbox=new LocalEventInbox(new FirestoreInboxStorage(db),createHmac("sha256",secret).update("lumin-operational-inbox-cursors").digest("hex"));
  if(events){
    const eventWorker=new EventWorker(events.store,inbox,async event=>{const subscription=await events.subscriptions.get(event.subscriptionId);if(!subscription?.enabled||subscription.appId!==event.appId)return false;const bound=await events.mapAsset(subscription,event.product,event.assetId),operator=ingress.find(i=>i.tenantId===event.tenantId&&i.clientId===event.clientId&&i.assetId===event.assetId&&i.product===event.product);return !!bound&&!!operator&&bound.tenantId===event.tenantId&&bound.clientId===event.clientId&&bound.assetId===event.assetId&&bound.product===event.product&&await authorizeOperationalInboxEvent(repo,event,operator.operatorId);});
    for(const p of product.options)adapters.set("local_inbox_"+p,createEventConsumerWorkerAdapter({id:"local_inbox_"+p,product:p,worker:eventWorker,verifiedIdempotentDelivery:true,hasDelivered:async(binding,eventId)=>{const key=operationalHash(JSON.stringify([binding.tenantId,binding.clientId,binding.product,binding.assetId,eventId])),row=(await db.collection("platform_event_inbox").doc(key).get()).data();if(!row)return false;if(row.tenantId!==binding.tenantId||row.clientId!==binding.clientId||row.product!==binding.product||row.assetId!==binding.assetId||row.eventId!==eventId||!Number.isFinite(row.expiresAt)||row.expiresAt<=Date.now())throw new PlatformDenied("INBOX_DELIVERY_RECEIPT_RECONCILIATION_HOLD");return true;}}));
  }
  const pageInspectionProfileVerifier=env.LUMIN_PLATFORM_OAUTH_PROFILES_JSON?createPageInspectionProfileVerifier(configuredOAuthProfiles(origin,env).registry):undefined;
  const host=createFirestoreOperationalHost({db,origin,...(env.INSTAGRAM_APP_ID?{instagramAppId:env.INSTAGRAM_APP_ID}:{}),...(pageInspectionProfileVerifier?{pageInspectionProfileVerifier}:{}),csrfSecret:secret,workerAdapters:{get:id=>adapters.get(id)??null},resolveWorker:req=>resolver(req),resolveSession:async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;},canBootstrap:async p=>{const tenant=await repo.get("tenants",p.tenantId,p.tenantId),member=await repo.get("members",p.tenantId,p.operatorId);return tenant?.status==="ACTIVE"&&tenant.migrationState==="READY"&&member?.disabledAt===null&&member.tenantId===p.tenantId&&member.roles.includes("admin");},secrets:{get:async(provider,appId)=>{const prefix=provider==="META_THREADS"?"THREADS":provider==="META_INSTAGRAM_LOGIN"?"INSTAGRAM":"META";if(env[prefix+"_APP_ID"]!==appId||!env[prefix+"_APP_SECRET"])throw new PlatformDenied("OPERATIONAL_PROVIDER_APP_SECRET_BINDING_REQUIRED");return env[prefix+"_APP_SECRET"]!;}}});
  const resolver=createOperationalWorkerResolver(profiles,async reference=>env[reference]??"",host.store);
  adapters.set("supervised_grant_refresh",createSupervisedGrantRefreshWorkerAdapter({id:"supervised_grant_refresh",store:host.store,lifecycle:host.lifecycle,webhookIndexes:createFirestoreWebhookIndexRefresher(db,indexBindings)}));
  for(const p of profiles)if(p.allowedAdapterIds.some(id=>!adapters.has(id)))throw new PlatformDenied("OPERATIONAL_WORKER_ADAPTER_UNAVAILABLE");
  configureOperationalIngress(ingress.length?async(_raw,normalized)=>{for(const event of normalized){const matches=ingress.filter(i=>i.tenantId===event.tenantId&&i.clientId===event.clientId&&i.assetId===event.assetId&&i.product===event.product);if(matches.length>1)throw new PlatformDenied("OPERATIONAL_INGRESS_AMBIGUOUS");const selected=matches[0];if(!selected)continue;const principal=await repo.resolvePrincipal(selected.operatorId);if(!principal||principal.tenantId!==selected.tenantId)throw new PlatformDenied("OPERATIONAL_INGRESS_PRINCIPAL_REQUIRED");await host.worker.schedule(principal,{tenantId:event.tenantId,clientId:event.clientId,assetId:event.assetId},"local_inbox_"+event.product,event.id);}}:undefined);
  configuredInbox=inbox;
  return host.router;
}
