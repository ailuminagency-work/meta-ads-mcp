import type express from "express";
import {z} from "zod";
import {getSession} from "../auth/session.js";
import {PlatformDenied,type PlatformPrincipal} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {getPlatformRepository} from "./runtime.js";
import {attachmentEnabled} from "./attachment-policy.js";
import {attachmentContracts} from "./attachment-policy.js";
import {attachmentProfileSchema,createAttachmentIngressRouter} from "./attachment-ingress.js";
import {AttachmentEnrollmentService} from "./attachment-enrollment.js";
import {createAttachmentEnrollmentRouter} from "./attachment-review-router.js";
export function environmentAttachmentRouters(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>}={}):{ingress:express.Router;review:express.Router}|null{
 const env=options.env??process.env;if(!attachmentEnabled(env))return null;let profiles:z.infer<typeof attachmentProfileSchema>[];try{const raw=env.LUMIN_ATTACHMENT_PROFILES_JSON;if(!raw||raw.length>32000)throw new Error();profiles=z.array(attachmentProfileSchema).min(1).max(32).parse(JSON.parse(raw));}catch{throw new PlatformDenied("ATTACHMENT_CONFIGURATION_REQUIRED");}
 if((env.SESSION_COOKIE_SECRET??"").length<32||!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("ATTACHMENT_SESSION_ENCRYPTION_REQUIRED");
 for(const p of profiles){const app=env.META_APP_ID;if(p.appId!==app||!/^[a-f0-9]{64}$/i.test(env[p.secretReference]??""))throw new PlatformDenied("ATTACHMENT_APP_KEY_BINDING_REQUIRED");attachmentContracts(p.purpose);}
 const repo=options.repository??getPlatformRepository(),service=new AttachmentEnrollmentService(repo);return {ingress:createAttachmentIngressRouter({profiles,service,secret:async ref=>profiles.some(p=>p.secretReference===ref)?env[ref]??"":""}),review:createAttachmentEnrollmentRouter({origin,csrfSecret:env.SESSION_COOKIE_SECRET!,service,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})})};
}
