import express from "express";
import {z} from "zod";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {PlatformDenied} from "./models.js";
import {canonicalJson} from "./policy.js";
import {validatePublicVideoUrl} from "./page-video.js";
import {productMediaDigest} from "./product-media.js";

import type {AttachmentEnrollmentService} from "./attachment-enrollment.js";
import {attachmentProvider} from "./attachment-source.js";
import {createIngressGate,ingressPreauthSignature} from "./ingress-preauth.js";
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const attachmentProfileSchema=z.object({id:identifier,tenantId:identifier,clientId:identifier,operatorId:identifier,connectionId:identifier,accountId:z.string().regex(/^\d{1,32}$/),appId:z.string().regex(/^\d{1,100}$/),provider:z.enum(["META_MESSENGER","META_WHATSAPP"]),purpose:z.enum(["facebook_messaging_audio","facebook_messaging_file","whatsapp_messaging_audio","whatsapp_messaging_document"]),secretReference:z.string().regex(/^LUMIN_ATTACHMENT_INGRESS_KEY_[A-Z0-9_]{1,64}$/),allowedHost:z.string().min(3).max(253),enabled:z.boolean()}).strict().superRefine((p,ctx)=>{if(attachmentProvider(p.purpose)!==p.provider)ctx.addIssue({code:"custom",message:"Exact provider-purpose required"});});
export type AttachmentProfile=z.infer<typeof attachmentProfileSchema>;
const bodySchema=z.object({attachment_base64:z.string().min(24).max(11184812).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),url:z.string().max(2048),immutable:z.literal(true),rights:z.object({granted:z.literal(true),purpose:z.enum(["facebook_messaging_audio","facebook_messaging_file","whatsapp_messaging_audio","whatsapp_messaging_document"]),checked_at:z.number().int().positive(),expires_at:z.number().int().positive()}).strict()}).strict();
export function attachmentIngressSignature(raw:Buffer,p:AttachmentProfile,timestamp:string,delivery:string,key:string):string{return "sha256="+createHmac("sha256",Buffer.from(key,"hex")).update(`messenger-attachment\n${p.id}\n${createHash("sha256").update(canonicalJson(p)).digest("hex")}\n${timestamp}\n${delivery}\n`).update(raw).digest("hex");}
const attachmentBinding=(p:AttachmentProfile):string=>createHash("sha256").update(canonicalJson(p)).digest("hex");
export const attachmentIngressPreauthSignature=(p:AttachmentProfile,timestamp:string,delivery:string,contentLength:number,key:string):string=>ingressPreauthSignature("messenger-attachment",p.id,attachmentBinding(p),timestamp,delivery,contentLength,key);
export function createAttachmentIngressRouter(deps:{profiles:readonly AttachmentProfile[];service:AttachmentEnrollmentService;secret(ref:string):Promise<string>}):express.Router{
 const profiles=new Map<string,AttachmentProfile>();for(const raw of deps.profiles){const p=attachmentProfileSchema.parse(structuredClone(raw)),url=new URL(validatePublicVideoUrl(`https://${p.allowedHost}/x`));if(url.hostname!==p.allowedHost||url.port||url.pathname!=="/x"||profiles.has(p.id)||[...profiles.values()].some(v=>v.secretReference===p.secretReference))throw new PlatformDenied("ATTACHMENT_PROFILE_INVALID");profiles.set(p.id,p);}
 const router=express.Router();const ingressGate=createIngressGate({domain:"messenger-attachment",profiles,binding:attachmentBinding,secret:deps.secret,maxBodyBytes:12*1024*1024,maxActive:1,unknownProfileStatus:403});router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");next();});
 router.post("/:profileId",ingressGate,async(req,res)=>{try{
  const p=profiles.get(String(req.params.profileId))!;if(!Buffer.isBuffer(req.body)){res.sendStatus(415);return;}// Body receipt is complete; bounded decoders own the processing deadline.
  req.setTimeout(0);const timestamp=req.get("x-lumin-timestamp")!,delivery=req.get("x-lumin-delivery")!,signature=req.get("x-lumin-signature")!,key=await deps.secret(p.secretReference);if(!/^[a-f0-9]{64}$/i.test(key))throw new PlatformDenied("ATTACHMENT_KEY_REQUIRED");if(Math.abs(Date.now()-Number(timestamp))>300000||!timingSafeEqual(Buffer.from(signature),Buffer.from(attachmentIngressSignature(req.body,p,timestamp,delivery,key)))){res.sendStatus(401);return;}
  const body=bodySchema.parse(JSON.parse(req.body.toString("utf8"))),url=validatePublicVideoUrl(body.url);if(new URL(url).hostname!==p.allowedHost||body.rights.purpose!==p.purpose)throw new PlatformDenied("ATTACHMENT_HOST_PURPOSE_REQUIRED");const bytes=Buffer.from(body.attachment_base64,"base64");if(bytes.toString("base64")!==body.attachment_base64)throw new PlatformDenied("ATTACHMENT_CANONICAL_BYTES_REQUIRED");const digest=productMediaDigest(bytes),result=await deps.service.stage(p,delivery,{bytes,url,immutable:true,sourceReference:digest,rights:{tenantId:p.tenantId,clientId:p.clientId,provider:p.provider,appId:p.appId,purpose:p.purpose,contentDigest:digest,granted:true,checkedAt:body.rights.checked_at,expiresAt:body.rights.expires_at,source:"approved_attachment_adapter"}});res.status(202).json({...result,providerDispatch:false});
 }catch(error){res.sendStatus(error instanceof z.ZodError||error instanceof SyntaxError?400:error instanceof PlatformDenied?403:503);}});
 router.use((error:{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.sendStatus(error.status===413?413:400));return router;
}
