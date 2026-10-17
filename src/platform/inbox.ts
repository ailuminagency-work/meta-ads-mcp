import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import type {Firestore} from "@google-cloud/firestore";
import {z} from "zod";
import type {EventAdapter,NormalizedEvent,EventProduct} from "./events/types.js";
import {PlatformDenied} from "./models.js";
import {canonicalJson} from "./policy.js";
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const identifier=z.string().regex(/^[A-Za-z0-9_:.=$-]{1,200}$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
const product=z.enum(["leads","pages","instagram","messenger","whatsapp"]);
const rowSchema=z.object({id:digest,tenantId:identifier,clientId:identifier,product,assetId:identifier,eventId:digest,kind:z.string().min(1).max(100),occurredAt:z.number().int().nonnegative(),receivedAt:z.number().int().positive(),expiresAt:z.number().int().positive(),references:z.object({leadId:identifier.optional(),formId:identifier.optional(),adId:identifier.optional(),campaignId:identifier.optional(),adsetId:identifier.optional(),messageId:identifier.optional()}).strict(),sourceDigest:digest}).strict();
export type InboxRow=z.infer<typeof rowSchema>;
export interface InboxScope {tenantId:string;clientId:string}
export interface InboxFilter {product?:EventProduct;assetId?:string;since:number;until:number;limit:number}
interface Position {receivedAt:number;id:string}
export interface InboxStorage {put(row:InboxRow):Promise<void>;list(scope:InboxScope,filter:InboxFilter,after?:Position):Promise<InboxRow[]>}
export class FirestoreInboxStorage implements InboxStorage{
  constructor(private readonly db:Firestore){}
  async put(row:InboxRow):Promise<void>{const ref=this.db.collection("platform_event_inbox").doc(row.id);await this.db.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists){const {expireTime:ignored,...record}=old.data()!;void ignored;if(canonicalJson(record)!==canonicalJson(row))throw new PlatformDenied("INBOX_IDEMPOTENCY_CONFLICT");return;}tx.create(ref,{...row,expireTime:new Date(row.expiresAt)});});}
  async list(scope:InboxScope,filter:InboxFilter,after?:Position):Promise<InboxRow[]>{let query=this.db.collection("platform_event_inbox").where("tenantId","==",scope.tenantId).where("clientId","==",scope.clientId).where("receivedAt",">=",filter.since).where("receivedAt","<=",filter.until);if(filter.product)query=query.where("product","==",filter.product);if(filter.assetId)query=query.where("assetId","==",filter.assetId);query=query.orderBy("receivedAt").orderBy("id");if(after)query=query.startAfter(after.receivedAt,after.id);const rows=await query.limit(filter.limit+1).get();return rows.docs.map(d=>{const {expireTime:ignored,...record}=d.data();void ignored;return rowSchema.parse(record);});}
}
export class InMemoryInboxStorage implements InboxStorage{
  readonly rows=new Map<string,InboxRow>();
  async put(row:InboxRow):Promise<void>{const old=this.rows.get(row.id);if(old&&canonicalJson(old)!==canonicalJson(row))throw new PlatformDenied("INBOX_IDEMPOTENCY_CONFLICT");this.rows.set(row.id,structuredClone(row));}
  async list(scope:InboxScope,filter:InboxFilter,after?:Position):Promise<InboxRow[]>{return [...this.rows.values()].filter(r=>r.tenantId===scope.tenantId&&r.clientId===scope.clientId&&r.receivedAt>=filter.since&&r.receivedAt<=filter.until&&(!filter.product||r.product===filter.product)&&(!filter.assetId||r.assetId===filter.assetId)&&(!after||r.receivedAt>after.receivedAt||r.receivedAt===after.receivedAt&&r.id>after.id)).sort((a,b)=>a.receivedAt-b.receivedAt||a.id.localeCompare(b.id)).slice(0,filter.limit+1).map(r=>structuredClone(r));}
}
export class LocalEventInbox implements EventAdapter{
  readonly id="local_event_inbox_v1";
  constructor(private readonly storage:InboxStorage,private readonly cursorSecret:string,private readonly clock:()=>number=Date.now){if(cursorSecret.length<32)throw new PlatformDenied("INBOX_CURSOR_SECRET_REQUIRED");}
  private now():number{const now=this.clock();if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("INBOX_CLOCK_INVALID");return now;}
  async deliver(event:NormalizedEvent,context:{idempotencyKey:string}):Promise<void>{
    const now=this.now();if(context.idempotencyKey!==`${this.id}:${event.id}`||event.provenance.provider!=="meta"||event.expiresAt<=now||event.receivedAt>now+60000||event.expiresAt>event.receivedAt+30*86400000)throw new PlatformDenied("VERIFIED_INBOX_EVENT_REQUIRED");
    const row:InboxRow=rowSchema.parse({id:hash(JSON.stringify([event.tenantId,event.clientId,event.product,event.assetId,event.id])),tenantId:event.tenantId,clientId:event.clientId,product:event.product,assetId:event.assetId,eventId:event.id,kind:event.kind,occurredAt:event.occurredAt,receivedAt:event.receivedAt,expiresAt:Math.min(event.expiresAt,event.receivedAt+7*86400000),references:event.references,sourceDigest:event.provenance.payloadDigest});
    await this.storage.put(row);
  }
  private signature(payload:string):string{return createHmac("sha256",this.cursorSecret).update("lumin-inbox-cursor-v1\n"+payload).digest("hex");}
  async list(scope:InboxScope,filter:InboxFilter,cursor?:string):Promise<{events:Array<Omit<InboxRow,"tenantId"|"clientId"|"sourceDigest"|"id">>;next_cursor:string|null;meaning:string}>{
    const now=this.now();if(!identifier.safeParse(scope.tenantId).success||!identifier.safeParse(scope.clientId).success||!Number.isSafeInteger(filter.since)||!Number.isSafeInteger(filter.until)||filter.since<now-7*86400000||filter.until>now+60000||filter.since>filter.until||!Number.isInteger(filter.limit)||filter.limit<1||filter.limit>100||filter.product&&!product.safeParse(filter.product).success||filter.assetId&&!identifier.safeParse(filter.assetId).success)throw new PlatformDenied("INBOX_QUERY_INVALID");
    const binding=hash(canonicalJson({scope,filter}));let after:Position|undefined;
    if(cursor){
      if(cursor.length>2048)throw new PlatformDenied("INBOX_CURSOR_INVALID");const[payload,signature,...extra]=cursor.split(".");if(extra.length||!signature||! /^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(this.signature(payload))))throw new PlatformDenied("INBOX_CURSOR_INVALID");
      try{const proof=z.object({binding:digest,expiresAt:z.number().int(),position:z.object({receivedAt:z.number().int(),id:digest}).strict()}).strict().parse(JSON.parse(Buffer.from(payload,"base64url").toString("utf8")));if(proof.binding!==binding||proof.expiresAt<=now)throw new Error();after=proof.position;}catch{throw new PlatformDenied("INBOX_CURSOR_INVALID");}
    }
    const rows=(await this.storage.list(scope,filter,after)).map(r=>{const parsed=rowSchema.safeParse(r);if(!parsed.success)throw new PlatformDenied("INBOX_STORAGE_SCHEMA_INVALID");return parsed.data;});
    if(rows.length>filter.limit+1||rows.some(r=>r.tenantId!==scope.tenantId||r.clientId!==scope.clientId||filter.product&&r.product!==filter.product||filter.assetId&&r.assetId!==filter.assetId||r.receivedAt<filter.since||r.receivedAt>filter.until))throw new PlatformDenied("INBOX_STORAGE_SCOPE_MISMATCH");
    const selected=rows.slice(0,filter.limit),last=selected.at(-1);let next_cursor:string|null=null;
    if(rows.length>filter.limit&&last){const payload=Buffer.from(JSON.stringify({binding,expiresAt:now+900000,position:{receivedAt:last.receivedAt,id:last.id}})).toString("base64url");next_cursor=payload+"."+this.signature(payload);}
    return {events:selected.filter(r=>r.expiresAt>now).map(({tenantId:ignoredTenant,clientId:ignoredClient,sourceDigest:ignoredDigest,id:ignoredId,...r})=>{void ignoredTenant;void ignoredClient;void ignoredDigest;void ignoredId;return r;}),next_cursor,meaning:"Verified webhook metadata delivered to this local inbox. Receipt does not establish lead qualification, message reply, CRM delivery or business outcome."};
  }
}
