import type express from "express";
import {z} from "zod";
import {getSession} from "../auth/session.js";
import {PlatformDenied,type PlatformPrincipal} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {getPlatformRepository} from "./runtime.js";
import {publishingVideoEnabled} from "./publishing-video-flags.js";
import {publishingVideoContracts} from "./publishing-video-policy.js";
import {publishingVideoProfileSchema,createPublishingVideoIngressRouter} from "./publishing-video-ingress.js";
import {PublishingVideoEnrollmentService} from "./publishing-video-enrollment.js";
import {createVideoEnrollmentRouter} from "./video-enrollment-router.js";
export function environmentPublishingVideoRouters(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>}={}):{ingress:express.Router;review:express.Router}|null{
 const env=options.env??process.env;if(!publishingVideoEnabled(env))return null;let profiles:z.infer<typeof publishingVideoProfileSchema>[];try{const raw=env.LUMIN_PUBLISHING_VIDEO_PROFILES_JSON;if(!raw||raw.length>32000)throw new Error();profiles=z.array(publishingVideoProfileSchema).min(1).max(32).parse(JSON.parse(raw));}catch{throw new PlatformDenied("PUBLISHING_VIDEO_CONFIGURATION_REQUIRED");}
 if((env.SESSION_COOKIE_SECRET??"").length<32||!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("PUBLISHING_VIDEO_SESSION_ENCRYPTION_REQUIRED");
 for(const p of profiles){const app=p.provider==="META_INSTAGRAM_LOGIN"?env.INSTAGRAM_APP_ID:p.provider==="META_THREADS"?env.THREADS_APP_ID:env.META_APP_ID;if(p.appId!==app||!/^[a-f0-9]{64}$/i.test(env[p.secretReference]??""))throw new PlatformDenied("PUBLISHING_VIDEO_APP_KEY_BINDING_REQUIRED");publishingVideoContracts(p.provider,p.draftTools);}
 const repo=options.repository??getPlatformRepository(),service=new PublishingVideoEnrollmentService(repo);return {ingress:createPublishingVideoIngressRouter({profiles,service,secret:async ref=>profiles.some(p=>p.secretReference===ref)?env[ref]??"":""}),review:createVideoEnrollmentRouter({origin,csrfSecret:env.SESSION_COOKIE_SECRET!,service,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})})};
}
