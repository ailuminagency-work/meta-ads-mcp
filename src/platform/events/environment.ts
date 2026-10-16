import {createHash} from "node:crypto";
import type {Firestore} from "@google-cloud/firestore";
import {z} from "zod";
import {getFirestore} from "../../store/firestore.js";
import {resolveAuthorizedAssets} from "../assets.js";
import {PlatformDenied,type AssetType,type Provider} from "../models.js";
import {FirestorePlatformRepository,type PlatformRepository} from "../repository.js";
import {configurePlatformWebhooks,hasPlatformWebhookConfiguration} from "./runtime.js";
import {firestoreEventDatabase,TransactionalEventStore} from "./store.js";
import type {WebhookDependencies} from "./router.js";
import type {EventProduct,WebhookSubscription} from "./types.js";

type Environment=Record<string,string|undefined>;
const identifier=z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const subscriptionsSchema=z.array(z.object({id:identifier,appId:z.string().regex(/^\d{1,100}$/),enabled:z.boolean(),products:z.array(z.enum(["leads","pages","instagram","messenger","whatsapp"])).min(1).max(5),secretReference:z.enum(["META_APP_SECRET","INSTAGRAM_APP_SECRET"]),verifyTokenReference:z.enum(["META_WEBHOOK_VERIFY_TOKEN","INSTAGRAM_WEBHOOK_VERIFY_TOKEN"])}).strict()).min(1).max(20);
const indexSchema=z.object({tenantId:identifier,clientId:identifier,assetKey:identifier,appId:z.string().regex(/^\d{1,100}$/),product:z.enum(["leads","pages","instagram","messenger","whatsapp"]),assetId:identifier,provider:z.enum(["META_MARKETING","META_FACEBOOK_PAGES","META_INSTAGRAM_FACEBOOK_LOGIN","META_INSTAGRAM_LOGIN","META_MESSENGER","META_WHATSAPP"]),verifiedAt:z.number().finite().positive(),expiresAt:z.number().finite().positive(),revokedAt:z.null()}).strict();
const allowed:Record<EventProduct,Array<{provider:Provider;type:AssetType}>>={
  leads:[{provider:"META_MARKETING",type:"PAGE"}],pages:[{provider:"META_FACEBOOK_PAGES",type:"PAGE"}],messenger:[{provider:"META_MESSENGER",type:"PAGE"}],
  instagram:[{provider:"META_INSTAGRAM_LOGIN",type:"INSTAGRAM_ACCOUNT"},{provider:"META_INSTAGRAM_FACEBOOK_LOGIN",type:"INSTAGRAM_ACCOUNT"}],
  whatsapp:[{provider:"META_WHATSAPP",type:"WHATSAPP_PHONE"},{provider:"META_WHATSAPP",type:"MESSAGING_ACCOUNT"}],
};
/** Approved bootstrap may compute this ID in a dry run. This helper never writes an index. */
export function webhookAssetIndexKey(appId:string,product:EventProduct,assetId:string):string{return createHash("sha256").update(JSON.stringify([appId,product,assetId])).digest("hex");}
function configuredSubscriptions(env:Environment):WebhookSubscription[]{
  let raw:unknown;try{raw=JSON.parse(env.META_WEBHOOK_SUBSCRIPTIONS_JSON??"");}catch{throw new PlatformDenied("WEBHOOK_SUBSCRIPTIONS_CONFIGURATION_INVALID");}
  const parsed=subscriptionsSchema.safeParse(raw);if(!parsed.success)throw new PlatformDenied("WEBHOOK_SUBSCRIPTIONS_CONFIGURATION_INVALID");
  const seen=new Set<string>();
  for(const sub of parsed.data){
    if(seen.has(sub.id)||new Set(sub.products).size!==sub.products.length)throw new PlatformDenied("WEBHOOK_SUBSCRIPTIONS_CONFIGURATION_INVALID");seen.add(sub.id);
    const configuredAppId=env[sub.secretReference==="META_APP_SECRET"?"META_APP_ID":"INSTAGRAM_APP_ID"];
    if(!configuredAppId || !/^\d{1,100}$/.test(configuredAppId) || sub.appId!==configuredAppId)throw new PlatformDenied("WEBHOOK_CONFIGURED_APP_BINDING_REQUIRED");
    if(sub.secretReference==="INSTAGRAM_APP_SECRET" && sub.products.some(p=>p!=="instagram") || sub.secretReference==="INSTAGRAM_APP_SECRET" && sub.verifyTokenReference!=="INSTAGRAM_WEBHOOK_VERIFY_TOKEN" || sub.secretReference==="META_APP_SECRET" && sub.verifyTokenReference!=="META_WEBHOOK_VERIFY_TOKEN")throw new PlatformDenied("WEBHOOK_SECRET_PRODUCT_BINDING_INVALID");
    if(sub.enabled && (!env[sub.secretReference]?.trim() || !env[sub.verifyTokenReference]?.trim()))throw new PlatformDenied("WEBHOOK_REFERENCED_SECRET_REQUIRED");
  }
  return parsed.data;
}
export function createEnvironmentWebhookDependencies(env:Environment,db:Firestore,repo:PlatformRepository,clock:()=>number=Date.now):WebhookDependencies {
  const parsed=configuredSubscriptions(env);
  const subscriptions=new Map<string,WebhookSubscription>(parsed.map(sub=>[sub.id,structuredClone(sub)]));
  const refs=new Set(parsed.flatMap(sub=>[sub.secretReference,sub.verifyTokenReference]));
  return {
    subscriptions:{get:async id=>{const sub=subscriptions.get(id);return sub?structuredClone(sub):null;}},
    secrets:{get:async reference=>{if(!refs.has(reference))throw new PlatformDenied("WEBHOOK_SECRET_REFERENCE_DENIED");const value=env[reference];if(!value?.trim())throw new PlatformDenied("WEBHOOK_REFERENCED_SECRET_REQUIRED");return value;}},
    now:clock,retentionMs:7*86400000,store:new TransactionalEventStore(firestoreEventDatabase(db)),
    mapAsset:async(subscription,product,assetId)=>{
      const configured=subscriptions.get(subscription.id);
      if(!configured?.enabled || JSON.stringify(configured)!==JSON.stringify(subscription) || !configured.products.includes(product))throw new PlatformDenied("WEBHOOK_SUBSCRIPTION_BINDING_REQUIRED");
      const snap=await db.collection("platform_webhook_asset_index").doc(webhookAssetIndexKey(subscription.appId,product,assetId)).get();
      if(!snap.exists)return null;
      const result=indexSchema.safeParse(snap.data());if(!result.success)throw new PlatformDenied("WEBHOOK_ASSET_INDEX_INVALID");
      const index=result.data,now=clock();
      if(!Number.isFinite(now) || index.appId!==subscription.appId || index.product!==product || index.assetId!==assetId || index.verifiedAt>now || now-index.verifiedAt>=60*60_000 || index.expiresAt<=now || product==="instagram" && index.provider!==(configured.secretReference==="INSTAGRAM_APP_SECRET"?"META_INSTAGRAM_LOGIN":"META_INSTAGRAM_FACEBOOK_LOGIN"))throw new PlatformDenied("WEBHOOK_ASSET_INDEX_STALE_OR_FOREIGN");
      const [tenant,client,asset]=await Promise.all([repo.get("tenants",index.tenantId,index.tenantId),repo.get("clients",index.tenantId,index.clientId),repo.get("assets",index.tenantId,index.assetKey)]);
      if(!tenant || tenant.id!==index.tenantId || tenant.status!=="ACTIVE" || tenant.migrationState!=="READY" || !client || client.id!==index.clientId || client.tenantId!==index.tenantId || client.status!=="ACTIVE" || !asset || asset.key!==index.assetKey || asset.id!==assetId || asset.tenantId!==index.tenantId || asset.clientId!==index.clientId || asset.appId!==index.appId || asset.provider!==index.provider || !allowed[product].some(pair=>pair.provider===asset.provider && pair.type===asset.type))throw new PlatformDenied("WEBHOOK_REGISTERED_CLIENT_ASSET_REQUIRED");
      await resolveAuthorizedAssets(repo,{principal:{tenantId:index.tenantId,operatorId:"server_webhook_index"},clientId:index.clientId,provider:index.provider,tool:"internal_indexed_webhook",requestId:subscription.id},[{type:asset.type,id:assetId}],now);
      return {tenantId:index.tenantId,clientId:index.clientId,product,assetId};
    },
  };
}
export function initializeEnvironmentWebhooks(options:{env?:Environment;firestore?:Firestore;repository?:PlatformRepository;clock?:()=>number}={}):boolean {
  const env=options.env??process.env;
  for(const name of ["LUMIN_PLATFORM_ENABLED","LUMIN_PLATFORM_WEBHOOKS_ENABLED"])if(env[name]!==undefined && !["true","false"].includes(env[name]!))throw new PlatformDenied("INVALID_WEBHOOK_FEATURE_FLAG");
  if(env.LUMIN_PLATFORM_ENABLED!=="true" || env.LUMIN_PLATFORM_WEBHOOKS_ENABLED!=="true")return false;
  if(env.META_WEBHOOK_SUBSCRIPTIONS_JSON===undefined){if(hasPlatformWebhookConfiguration())return false;throw new PlatformDenied("WEBHOOK_SUBSCRIPTIONS_CONFIGURATION_REQUIRED");}
  configuredSubscriptions(env); // Reject malformed configuration before any credential/runtime initialization.
  const db=options.firestore??getFirestore();
  configurePlatformWebhooks(createEnvironmentWebhookDependencies(env,db,options.repository??new FirestorePlatformRepository(db),options.clock));return true;
}
