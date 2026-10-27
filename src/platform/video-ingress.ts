import express from "express";
import {z} from "zod";
import {createHmac,createHash,timingSafeEqual} from "node:crypto";
import {PlatformDenied} from "./models.js";
import {canonicalJson} from "./policy.js";
import {productMediaDigest} from "./product-media.js";
import {validatePublicVideoUrl} from "./page-video.js";
import {VideoEnrollmentService} from "./video-enrollment-service.js";
import {createIngressGate,ingressPreauthSignature} from "./ingress-preauth.js";
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const videoProfileSchema=z.object({id:identifier,tenantId:identifier,clientId:identifier,operatorId:identifier,connectionId:identifier,accountId:z.string().regex(/^\d{1,32}$/),appId:z.string().regex(/^\d{1,100}$/),provider:z.literal("META_FACEBOOK_PAGES"),purpose:z.literal("facebook_video_publishing"),secretReference:z.string().regex(/^LUMIN_VIDEO_INGRESS_KEY_[A-Z0-9_]{1,64}$/),allowedHost:z.string().min(3).max(253),enabled:z.boolean()}).strict();
export type VideoIngressProfile=z.infer<typeof videoProfileSchema>;
const bodySchema=z.object({mp4_base64:z.string().min(172).max(22369624).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),url:z.string().max(2048),ai_generated:z.literal(false),immutable:z.literal(true),rights:z.object({granted:z.literal(true),purpose:z.literal("facebook_video_publishing"),checked_at:z.number().int().positive(),expires_at:z.number().int().positive()}).strict()}).strict();
export const videoIngressBinding=(profile:VideoIngressProfile):string=>createHash("sha256").update(canonicalJson(profile)).digest("hex");
export function videoIngressSignature(raw:Buffer,p:VideoIngressProfile,timestamp:string,delivery:string,key:string):string{return "sha256="+createHmac("sha256",Buffer.from(key,"hex")).update(`${p.id}\n${videoIngressBinding(p)}\n${timestamp}\n${delivery}\n`).update(raw).digest("hex");}
export const videoIngressPreauthSignature=(p:VideoIngressProfile,timestamp:string,delivery:string,contentLength:number,key:string):string=>ingressPreauthSignature("video",p.id,videoIngressBinding(p),timestamp,delivery,contentLength,key);
export function createVideoIngressRouter(deps:{profiles:readonly VideoIngressProfile[];service:VideoEnrollmentService;secret(reference:string):Promise<string>}):express.Router {
 const profiles=new Map<string,VideoIngressProfile>();for(const raw of deps.profiles){const p=videoProfileSchema.parse(structuredClone(raw)),u=new URL(validatePublicVideoUrl(`https://${p.allowedHost}/x`));if(u.hostname!==p.allowedHost||u.port||u.pathname!=="/x"||profiles.has(p.id)||[...profiles.values()].some(v=>v.secretReference===p.secretReference))throw new PlatformDenied("VIDEO_INGRESS_PROFILE_INVALID");profiles.set(p.id,p);}
 const router=express.Router();const ingressGate=createIngressGate({domain:"video",profiles,binding:videoIngressBinding,secret:deps.secret,maxBodyBytes:24*1024*1024,maxActive:1,unknownProfileStatus:403});router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");next();});
 router.post("/:profileId",ingressGate,async(req,res)=>{try{
  const p=profiles.get(String(req.params.profileId))!;if(!Buffer.isBuffer(req.body)){res.sendStatus(415);return;}// Body receipt is complete; bounded decoders own the processing deadline.
  req.setTimeout(0);const timestamp=req.get("x-lumin-timestamp")!,delivery=req.get("x-lumin-delivery")!,signature=req.get("x-lumin-signature")!,key=await deps.secret(p.secretReference);if(!/^[a-f0-9]{64}$/i.test(key))throw new PlatformDenied("VIDEO_INGRESS_KEY_REQUIRED");if(!timingSafeEqual(Buffer.from(signature),Buffer.from(videoIngressSignature(req.body,p,timestamp,delivery,key)))){res.sendStatus(401);return;}
  const body=bodySchema.parse(JSON.parse(req.body.toString("utf8"))),url=validatePublicVideoUrl(body.url);if(new URL(url).hostname!==p.allowedHost)throw new PlatformDenied("VIDEO_APPROVED_CDN_HOST_REQUIRED");const bytes=Buffer.from(body.mp4_base64,"base64");if(bytes.toString("base64")!==body.mp4_base64)throw new PlatformDenied("VIDEO_CANONICAL_BYTES_REQUIRED");const digest=productMediaDigest(bytes);
  const result=await deps.service.stage(p,delivery,{bytes,url,sourceReference:digest,immutable:true,aiGenerated:false,rights:{tenantId:p.tenantId,clientId:p.clientId,provider:p.provider,appId:p.appId,purpose:p.purpose,contentDigest:digest,granted:true,checkedAt:body.rights.checked_at,expiresAt:body.rights.expires_at,source:"approved_video_adapter"}});res.status(202).json({...result,providerDispatch:false});
 }catch(error){res.sendStatus(error instanceof SyntaxError||error instanceof z.ZodError?400:error instanceof PlatformDenied?403:503);}});
 router.use((error:{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.sendStatus(error.status===413?413:400));return router;
}
