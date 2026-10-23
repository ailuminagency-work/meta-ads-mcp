import type express from "express";
import {z} from "zod";
import {getSession} from "../auth/session.js";
import {getPlatformRepository} from "./runtime.js";
import type {PlatformRepository} from "./repository.js";
import {PlatformDenied,type PlatformPrincipal} from "./models.js";
import {pageVideoEnabled} from "./video-flags.js";
import {videoProfileSchema,createVideoIngressRouter} from "./video-ingress.js";
import {VideoEnrollmentService} from "./video-enrollment-service.js";
import {createVideoEnrollmentRouter} from "./video-enrollment-router.js";
export function environmentVideoRouters(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>}={}):{ingress:express.Router;review:express.Router}|null{
 const env=options.env??process.env,flag=env.LUMIN_VIDEO_INGRESS_ENABLED;if(flag!==undefined&&!["true","false"].includes(flag))throw new PlatformDenied("INVALID_VIDEO_INGRESS_FLAG");if(flag!=="true"||!pageVideoEnabled(env))return null;let profiles:z.infer<typeof videoProfileSchema>[];try{const raw=env.LUMIN_VIDEO_INGRESS_PROFILES_JSON;if(!raw||raw.length>32000)throw new Error();profiles=z.array(videoProfileSchema).min(1).max(32).parse(JSON.parse(raw));}catch{throw new PlatformDenied("VIDEO_INGRESS_CONFIGURATION_REQUIRED");}
 if((env.SESSION_COOKIE_SECRET??"").length<32||!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("VIDEO_SESSION_AND_ENCRYPTION_REQUIRED");for(const p of profiles)if(p.appId!==env.META_APP_ID||!/^[a-f0-9]{64}$/i.test(env[p.secretReference]??""))throw new PlatformDenied("VIDEO_INGRESS_APP_AND_KEY_BINDING_REQUIRED");const repo=options.repository??getPlatformRepository(),service=new VideoEnrollmentService(repo);return {ingress:createVideoIngressRouter({profiles,service,secret:async ref=>profiles.some(p=>p.secretReference===ref)?env[ref]??"":""}),review:createVideoEnrollmentRouter({origin,csrfSecret:env.SESSION_COOKIE_SECRET!,service,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})})};
}
