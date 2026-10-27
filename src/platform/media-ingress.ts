import {approvedJpegPurpose} from "./media-purpose.js";
import {canonicalJson} from "./policy.js";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import express from "express";
import {z} from "zod";
import {PlatformDenied} from "./models.js";
import {MediaEnrollmentService,type MediaIngressBinding} from "./media-enrollment-service.js";
import {productMediaDigest,validatePublicJpegUrl} from "./product-media.js";
import {createIngressGate,ingressPreauthSignature} from "./ingress-preauth.js";
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const mediaProfileSchema=z.object({id:identifier,tenantId:identifier,clientId:identifier,operatorId:identifier,connectionId:identifier,accountId:z.string().regex(/^\d{1,100}$/),appId:z.string().regex(/^\d{1,100}$/),purpose:z.enum(["instagram_content_publishing","facebook_content_publishing","whatsapp_messaging","facebook_messaging","instagram_messaging","meta_ad_image_upload","threads_content_publishing","instagram_story_publishing"]).optional(),provider:z.enum(["META_THREADS","META_MARKETING","META_MESSENGER","META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN","META_FACEBOOK_PAGES","META_WHATSAPP"]),secretReference:z.string().regex(/^LUMIN_MEDIA_INGRESS_KEY_[A-Z0-9_]{1,64}$/),allowedHost:z.string().min(3).max(253),enabled:z.boolean()}).strict();
export type MediaIngressProfile=z.infer<typeof mediaProfileSchema>;
const bodySchema=z.object({jpeg_base64:z.string().min(16).max(11184812).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),url:z.string().max(2048),ai_generated:z.boolean(),immutable:z.literal(true),rights:z.object({granted:z.literal(true),purpose:z.enum(["instagram_content_publishing","facebook_content_publishing","whatsapp_messaging","facebook_messaging","instagram_messaging","meta_ad_image_upload","threads_content_publishing","instagram_story_publishing"]),checked_at:z.number().int().positive(),expires_at:z.number().int().positive()}).strict()}).strict();
export function mediaIngressBinding(profile:MediaIngressProfile):string{return createHash("sha256").update(canonicalJson(profile)).digest("hex");}
export function mediaIngressSignature(raw:Buffer,profile:MediaIngressProfile,timestamp:string,delivery:string,key:string):string{return "sha256="+createHmac("sha256",Buffer.from(key,"hex")).update(`${profile.id}\n${mediaIngressBinding(profile)}\n${timestamp}\n${delivery}\n`).update(raw).digest("hex");}
export const mediaIngressPreauthSignature=(profile:MediaIngressProfile,timestamp:string,delivery:string,contentLength:number,key:string):string=>ingressPreauthSignature("media",profile.id,mediaIngressBinding(profile),timestamp,delivery,contentLength,key);
export function createMediaIngressRouter(deps:{profiles:readonly MediaIngressProfile[];service:MediaEnrollmentService;secret:(reference:string)=>Promise<string>}):express.Router{
 const profiles=new Map<string,MediaIngressProfile>();for(const raw of deps.profiles){const p=mediaProfileSchema.parse(structuredClone(raw)),u=new URL(validatePublicJpegUrl(`https://${p.allowedHost}/x`));if(u.hostname!==p.allowedHost||u.port||u.pathname!=="/x"||profiles.has(p.id)||[...profiles.values()].some(v=>v.secretReference===p.secretReference))throw new PlatformDenied("MEDIA_INGRESS_PROFILE_INVALID");if(["META_MARKETING","META_FACEBOOK_PAGES","META_WHATSAPP","META_MESSENGER"].includes(p.provider)&&!p.purpose || p.purpose!==undefined&&p.purpose!==approvedJpegPurpose(p.provider,p.purpose))throw new PlatformDenied("MEDIA_INGRESS_PURPOSE_REQUIRED");profiles.set(p.id,p);}
 const router=express.Router();const ingressGate=createIngressGate({domain:"media",profiles,binding:mediaIngressBinding,secret:deps.secret,maxBodyBytes:12*1024*1024,maxActive:4,unknownProfileStatus:404});router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");next();});
 router.post("/:profileId",ingressGate,async(req,res)=>{try{
  const p=profiles.get(String(req.params.profileId));if(!p){res.sendStatus(404);return;}if(!p.enabled){res.sendStatus(403);return;}if(!Buffer.isBuffer(req.body)){res.sendStatus(415);return;}
  const timestamp=req.get("x-lumin-timestamp"),delivery=req.get("x-lumin-delivery"),signature=req.get("x-lumin-signature"),now=Date.now();
  if(!timestamp||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300000||!delivery||!/^[A-Za-z0-9_.:-]{1,128}$/.test(delivery)||!signature||!/^sha256=[a-f0-9]{64}$/.test(signature)){res.sendStatus(401);return;}
  const key=await deps.secret(p.secretReference);if(!/^[a-f0-9]{64}$/i.test(key))throw new PlatformDenied("MEDIA_INGRESS_KEY_REQUIRED");if(!timingSafeEqual(Buffer.from(signature),Buffer.from(mediaIngressSignature(req.body,p,timestamp,delivery,key)))){res.sendStatus(401);return;}
  const body=bodySchema.parse(JSON.parse(req.body.toString("utf8"))),url=validatePublicJpegUrl(body.url);if(new URL(url).hostname!==p.allowedHost)throw new PlatformDenied("MEDIA_CDN_HOST_REQUIRED");
  if(body.rights.purpose!==approvedJpegPurpose(p.provider,p.purpose))throw new PlatformDenied("MEDIA_INGRESS_PURPOSE_REQUIRED");
  const bytes=Buffer.from(body.jpeg_base64,"base64");if(bytes.toString("base64")!==body.jpeg_base64)throw new PlatformDenied("MEDIA_CANONICAL_BYTES_REQUIRED");
  const binding:MediaIngressBinding={id:p.id,tenantId:p.tenantId,clientId:p.clientId,operatorId:p.operatorId,connectionId:p.connectionId,accountId:p.accountId,appId:p.appId,provider:p.provider,...(p.purpose?{purpose:p.purpose}:{})},scope={tenantId:p.tenantId,clientId:p.clientId,provider:p.provider,appId:p.appId},digest=productMediaDigest(bytes);
  const result=await deps.service.stage(binding,delivery,{bytes,url,sourceReference:digest,immutable:true,aiGenerated:body.ai_generated,rights:{...scope,granted:true,purpose:body.rights.purpose,contentDigest:digest,checkedAt:body.rights.checked_at,expiresAt:body.rights.expires_at,source:"approved_media_adapter"}});
  res.status(202).json({...result,providerDispatch:false});
 }catch(error){res.sendStatus(error instanceof SyntaxError||error instanceof z.ZodError?400:error instanceof PlatformDenied?403:503);}});
 router.use((error:{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.sendStatus(error.status===413?413:400));return router;
}
