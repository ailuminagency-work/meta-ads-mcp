import type {Firestore} from "@google-cloud/firestore";
import {z} from "zod";
import {PlatformDenied,type Connection,type MetaAsset,type AssetGrant,type Tenant,type Client,type Member} from "./models.js";
import {lifecycleAppUserLockKey,type LifecycleCommand} from "./lifecycle.js";
import {operationalHash} from "./operational-store.js";
import {webhookAssetIndexKey} from "./events/environment.js";
import type {EventProduct} from "./events/types.js";

const identifier=z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const bindingSchema=z.object({tenantId:identifier,clientId:identifier,assetKey:identifier,appId:z.string().regex(/^\d{1,100}$/),product:z.enum(["leads","pages","instagram","messenger","whatsapp"]),assetId:identifier,provider:z.enum(["META_MARKETING","META_FACEBOOK_PAGES","META_INSTAGRAM_FACEBOOK_LOGIN","META_INSTAGRAM_LOGIN","META_MESSENGER","META_WHATSAPP"])}).strict();
export type WebhookIndexRefreshBinding=z.infer<typeof bindingSchema>;
export const webhookIndexRefreshBindingSchema=bindingSchema;
const indexSchema=bindingSchema.extend({verifiedAt:z.number().finite().positive(),expiresAt:z.number().finite().positive(),revokedAt:z.null()});
const products:Record<EventProduct,string[]>={leads:["META_MARKETING:PAGE"],pages:["META_FACEBOOK_PAGES:PAGE"],instagram:["META_INSTAGRAM_LOGIN:INSTAGRAM_ACCOUNT","META_INSTAGRAM_FACEBOOK_LOGIN:INSTAGRAM_ACCOUNT"],messenger:["META_MESSENGER:PAGE"],whatsapp:["META_WHATSAPP:WHATSAPP_PHONE","META_WHATSAPP:MESSAGING_ACCOUNT"]};
/** Deployment-owned exact mappings only. A public request cannot supply or expand these bindings. */
export function createFirestoreWebhookIndexRefresher(db:Firestore,bindings:ReadonlyArray<WebhookIndexRefreshBinding>,clock:()=>number=Date.now):{refresh(commandId:string):Promise<number>}{
  const selected=z.array(bindingSchema).max(100).parse(structuredClone(bindings));
  if(new Set(selected.map(b=>webhookAssetIndexKey(b.appId,b.product,b.assetId))).size!==selected.length)throw new PlatformDenied("WEBHOOK_REFRESH_AMBIGUOUS_BINDING");
  const platform=(collection:string,tenant:string,id:string)=>db.collection("platform_v1").doc(operationalHash(JSON.stringify(["tenants",tenant,tenant]))).collection(collection).doc(operationalHash(JSON.stringify([collection,tenant,id])));
  return {refresh:async(commandId:string)=>{
    if(!/^[a-f0-9]{64}$/.test(commandId))throw new PlatformDenied("WEBHOOK_REFRESH_COMMAND_REQUIRED");
    return db.runTransaction(async tx=>{
      const now=clock();if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("WEBHOOK_REFRESH_CLOCK_INVALID");
      const commandSnap=await tx.get(db.collection("platform_lifecycle_commands").doc(commandId)),c=commandSnap.data() as LifecycleCommand|undefined;
      if(!c||c.id!==commandId||c.action!=="REFRESH_GRANTS"||c.state!=="SUCCEEDED"||!Number.isSafeInteger(c.updatedAt)||c.updatedAt>now||now-c.updatedAt>=300000||c.retentionExpiresAt<=now)throw new PlatformDenied("WEBHOOK_REFRESH_VERIFIED_GRANTS_REQUIRED");
      const read=async<T>(collection:string,id:string):Promise<T|undefined>=>(await tx.get(platform(collection,c.tenantId,id))).data() as T|undefined;
      const tenant=await read<Tenant>("tenants",c.tenantId),client=await read<Client>("clients",c.clientId),actor=await read<Member>("members",c.actorId),connection=await read<Connection>("connections",c.connectionId);
      if(!tenant||tenant.status!=="ACTIVE"||tenant.migrationState!=="READY"||!client||client.tenantId!==c.tenantId||client.status!=="ACTIVE"||!actor||actor.tenantId!==c.tenantId||actor.disabledAt!==null||!actor.allowedClientIds.includes(c.clientId)||!actor.roles.some(r=>["admin","connection_admin"].includes(r))||!connection||connection.tenantId!==c.tenantId||connection.operatorId!==c.actorId||connection.revokedAt!==null||connection.verifiedAt!==c.updatedAt||connection.expiresAt===null||connection.expiresAt<=now)throw new PlatformDenied("WEBHOOK_REFRESH_CURRENT_AUTHORIZATION_REQUIRED");
      const candidates=selected.filter(b=>b.tenantId===c.tenantId&&b.clientId===c.clientId&&b.appId===connection.appId&&b.provider===connection.provider&&connection.assetKeys.includes(b.assetKey));
      if((await tx.get(db.collection("platform_lifecycle_locks").doc(lifecycleAppUserLockKey(connection.appId,connection.operatorId)))).exists)throw new PlatformDenied("GLOBAL_APP_USER_LIFECYCLE_LOCK_HOLD");
      if(!candidates.length)return 0;
      const grantsSnap=await tx.get(db.collection("platform_v1").doc(operationalHash(JSON.stringify(["tenants",c.tenantId,c.tenantId]))).collection("grants").limit(1001));
      if(grantsSnap.size>1000)throw new PlatformDenied("WEBHOOK_REFRESH_GRANT_LIMIT_HOLD");
      const grants=grantsSnap.docs.map(d=>d.data() as AssetGrant),writes:Array<{ref:ReturnType<Firestore["doc"]>;value:unknown}>=[];
      for(const b of candidates){
        const asset=await read<MetaAsset>("assets",b.assetKey),ref=db.collection("platform_webhook_asset_index").doc(webhookAssetIndexKey(b.appId,b.product,b.assetId)),raw=(await tx.get(ref)).data();
        if(!raw)throw new PlatformDenied("WEBHOOK_REFRESH_EXISTING_INDEX_REQUIRED");
        const parsed=indexSchema.safeParse(raw);if(!parsed.success)throw new PlatformDenied("WEBHOOK_REFRESH_INDEX_INVALID");const index=parsed.data;
        if(Object.entries(b).some(([k,v])=>index[k as keyof typeof index]!==v)||index.verifiedAt>now||!asset||asset.key!==b.assetKey||asset.tenantId!==b.tenantId||asset.clientId!==b.clientId||asset.appId!==b.appId||asset.provider!==b.provider||asset.id!==b.assetId||asset.revokedAt!==null||asset.verifiedAt!==c.updatedAt||!products[b.product].includes(`${asset.provider}:${asset.type}`))throw new PlatformDenied("WEBHOOK_REFRESH_MAPPING_OR_PROOF_CHANGED");
        const authorized=grants.filter(g=>g.connectionId===connection.id&&g.tenantId===c.tenantId&&g.clientId===c.clientId&&g.assetKey===asset.key&&g.revokedAt===null&&g.verifiedAt===c.updatedAt&&g.expiresAt>now&&g.actions.includes("READ"));
        if(!authorized.length)throw new PlatformDenied("WEBHOOK_REFRESH_CURRENT_GRANT_REQUIRED");
        const expiresAt=Math.min(c.updatedAt+3600000,connection.expiresAt,...authorized.map(g=>g.expiresAt));
        if(expiresAt<=now)throw new PlatformDenied("WEBHOOK_REFRESH_PROOF_EXPIRED");
        writes.push({ref,value:{...index,verifiedAt:c.updatedAt,expiresAt}});
      }
      // All index, grant and authorization reads precede atomic writes. No missing mapping is created.
      for(const w of writes)tx.set(w.ref,w.value as Record<string,unknown>);
      const auditId=operationalHash(JSON.stringify(["webhook-index-refresh",commandId]));
      const auditRef=db.collection("platform_operational_audit").doc(auditId);
      // Idempotent metadata receipt; the exact command fixes proof time and affected configured mappings.
      tx.set(auditRef,{id:auditId,scopeHash:operationalHash(JSON.stringify([c.tenantId,c.clientId])),recordId:c.id,event:"WEBHOOK_INDEX_LEASE_REFRESHED",timestamp:c.updatedAt,expiresAt:c.updatedAt+90*86400000,expireTime:new Date(c.updatedAt+90*86400000)});
      return writes.length;
    });
  }};
}
