import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import express from "express";
import {z} from "zod";
import {PlatformDenied} from "./models.js";
import {resolveAuthorizedAssets} from "./assets.js";
import type {PlatformRepository} from "./repository.js";
import {TrustedFirstPartySourceStore,createFirestoreFirstPartySourceResolver} from "./first-party-source-store.js";
import {firstPartySignalDigest,type FirstPartySignalInput,type SignalEvidence} from "./signals.js";
import {getFirestore} from "../store/firestore.js";
import {getPlatformRepository,platformEnabled} from "./runtime.js";

const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const reference=z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
const profileSchema=z.object({id:identifier,adapterId:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),tenantId:identifier,clientId:identifier,operatorId:identifier,pixelId:z.string().regex(/^\d{1,100}$/),appId:z.string().regex(/^\d{1,100}$/),secretReference:z.string().regex(/^LUMIN_FIRST_PARTY_INGRESS_KEY_[A-Z0-9_]{1,64}$/),enabled:z.boolean()}).strict();
export type SourceIngressProfile=z.infer<typeof profileSchema>;
const ingestionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("INGEST"),event:z.unknown(),consent:z.object({reference,authorized:z.literal(true),expiresAt:z.number().int().positive(),purpose:z.literal("META_CONVERSIONS"),recordedAt:z.number().int().positive()}).strict()}).strict(),
  z.object({action:z.literal("REVOKE"),sourceReference:reference,consentReference:reference}).strict(),
]);
export interface SourceIngressDependencies {profiles:readonly SourceIngressProfile[];repository:PlatformRepository;secret:(reference:string)=>Promise<string>;store:(profile:SourceIngressProfile)=>TrustedFirstPartySourceStore;now?:()=>number}
export function sourceIngressBinding(p:SourceIngressProfile):string{return createHash("sha256").update(JSON.stringify([p.id,p.tenantId,p.clientId,p.operatorId,p.pixelId,p.appId,p.adapterId])).digest("hex");}
export function sourceIngressSignature(raw:Buffer,profileId:string,timestamp:string,delivery:string,key:string,binding:string):string {
  return "sha256="+createHmac("sha256",Buffer.from(key,"hex")).update(`${profileId}\n${binding}\n${timestamp}\n${delivery}\n`).update(raw).digest("hex");
}
async function authorizeProfile(deps:SourceIngressDependencies,profile:SourceIngressProfile,now:number):Promise<void>{
  const principal=await deps.repository.resolvePrincipal(profile.operatorId);
  if(!principal||principal.tenantId!==profile.tenantId||principal.operatorId!==profile.operatorId)throw new PlatformDenied("SOURCE_INGRESS_PRINCIPAL_REQUIRED");
  const [tenant,member,client]=await Promise.all([deps.repository.get("tenants",profile.tenantId,profile.tenantId),deps.repository.get("members",profile.tenantId,profile.operatorId),deps.repository.get("clients",profile.tenantId,profile.clientId)]);
  if(!tenant||tenant.id!==profile.tenantId||tenant.status!=="ACTIVE"||tenant.migrationState!=="READY"||!member||member.operatorId!==profile.operatorId||member.disabledAt!==null||member.tenantId!==profile.tenantId||!member.roles.some(r=>r==="admin"||r==="writer")||!member.allowedClientIds.includes(profile.clientId)||!client||client.id!==profile.clientId||client.status!=="ACTIVE"||client.tenantId!==profile.tenantId)throw new PlatformDenied("SOURCE_INGRESS_CLIENT_ACCESS_REQUIRED");
  const assets=await resolveAuthorizedAssets(deps.repository,{principal,clientId:profile.clientId,provider:"META_MARKETING",tool:"internal_first_party_ingest",requestId:"signed-source"},[{type:"PIXEL",id:profile.pixelId}],now);
  if(assets.some(a=>a.appId!==profile.appId))throw new PlatformDenied("SOURCE_INGRESS_APP_BINDING_REQUIRED");
}
export function createSourceIngressRouter(deps:SourceIngressDependencies):express.Router {
  const profiles=new Map<string,SourceIngressProfile>();
  for(const raw of deps.profiles){const p=profileSchema.parse(structuredClone(raw));if(profiles.has(p.id)||[...profiles.values()].some(v=>v.secretReference===p.secretReference))throw new PlatformDenied("SOURCE_INGRESS_DUPLICATE_PROFILE");profiles.set(p.id,p);}
  const router=express.Router(),clock=deps.now??Date.now;
  router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");next();});
  router.post("/:profileId",express.raw({type:"application/json",limit:"64kb",inflate:false}),async(req,res)=>{
    try{
      const profile=profiles.get(req.params.profileId);if(!profile){res.sendStatus(404);return;}
      if(!Buffer.isBuffer(req.body)){res.sendStatus(415);return;}
      const timestamp=req.get("x-lumin-timestamp"),delivery=req.get("x-lumin-delivery"),signature=req.get("x-lumin-signature"),now=clock();
      if(!timestamp||!/^\d{13}$/.test(timestamp)||!Number.isSafeInteger(now)||Math.abs(now-Number(timestamp))>300000||!delivery||! /^[A-Za-z0-9_.:-]{1,128}$/.test(delivery)||!signature||!/^sha256=[a-f0-9]{64}$/.test(signature)){res.sendStatus(401);return;}
      const key=await deps.secret(profile.secretReference);if(!/^[a-f0-9]{64}$/i.test(key))throw new PlatformDenied("SOURCE_INGRESS_KEY_REQUIRED");
      const expected=sourceIngressSignature(req.body,profile.id,timestamp,delivery,key,sourceIngressBinding(profile));
      if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature))){res.sendStatus(401);return;}
      const parsed=ingestionSchema.safeParse(JSON.parse(req.body.toString("utf8")));if(!parsed.success){res.sendStatus(400);return;}
      if(parsed.data.action==="INGEST"){if(!profile.enabled)throw new PlatformDenied("SOURCE_INGRESS_DISABLED");await authorizeProfile(deps,profile,now);}
      const store=deps.store(profile),scope={tenantId:profile.tenantId,clientId:profile.clientId,datasetId:profile.pixelId};
      if(parsed.data.action==="REVOKE"){
        const revoked=await store.revokeVerified(profile.adapterId,scope,parsed.data.sourceReference,parsed.data.consentReference);res.status(200).json({status:revoked?"REVOKED":"UNCHANGED"});return;
      }
      const {event,consent}=parsed.data,payloadDigest=firstPartySignalDigest(event),raw=event as FirstPartySignalInput;
      if(consent.reference!==raw.consent_reference||consent.recordedAt>now||consent.recordedAt>raw.event_time*1000+60000||consent.expiresAt<=now||consent.expiresAt>now+7*86400000)throw new PlatformDenied("SOURCE_INGRESS_CONSENT_RECORD_REQUIRED");
      const evidence:SignalEvidence={...scope,payloadDigest,sourceReference:raw.source_reference,consentReference:consent.reference,eventId:raw.event_id,eventName:raw.event_name,eventTime:raw.event_time,authorized:true,expiresAt:consent.expiresAt};
      await store.ingestVerified(profile.adapterId,scope,event,evidence);
      res.status(202).json({status:"STORED",providerDispatch:false});
    }catch(error){res.sendStatus(error instanceof SyntaxError?400:error instanceof PlatformDenied?403:503);}
  });
  router.use((error:{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.sendStatus(error.status===413?413:error.status===415?415:400);});
  return router;
}
export function environmentSourceIngressRouter():express.Router|null{
  const flag=process.env.LUMIN_FIRST_PARTY_INGRESS_ENABLED;
  if(flag!==undefined&&!['true','false'].includes(flag))throw new PlatformDenied("INVALID_SOURCE_INGRESS_FLAG");
  if(flag!=="true"||!platformEnabled())return null;
  let profiles:SourceIngressProfile[];
  try{const text=process.env.LUMIN_FIRST_PARTY_INGRESS_PROFILES_JSON;if(!text||text.length>32000)throw new Error();profiles=z.array(profileSchema).min(1).max(32).parse(JSON.parse(text));}catch{throw new PlatformDenied("SOURCE_INGRESS_CONFIGURATION_REQUIRED");}
  if(profiles.some(p=>!/^[a-f0-9]{64}$/i.test(process.env[p.secretReference]??"")))throw new PlatformDenied("SOURCE_INGRESS_KEY_REQUIRED");
  if(profiles.some(p=>p.appId!==process.env.META_APP_ID||p.adapterId!==process.env.LUMIN_FIRST_PARTY_ADAPTER_ID))throw new PlatformDenied("SOURCE_INGRESS_DEPLOYMENT_BINDING_REQUIRED");
  const repository=getPlatformRepository(),db=getFirestore(),stores=new Map<string,TrustedFirstPartySourceStore>();
  return createSourceIngressRouter({profiles,repository,secret:async ref=>profiles.some(p=>p.secretReference===ref)?process.env[ref]??"":"",store:p=>{let store=stores.get(p.adapterId);if(!store){store=createFirestoreFirstPartySourceResolver(db,{approvedIngestionAdapterId:p.adapterId});stores.set(p.adapterId,store);}return store;}});
}
