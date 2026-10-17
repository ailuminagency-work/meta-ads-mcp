import type express from "express";
import {z} from "zod";
import {PlatformDenied,type PlatformPrincipal} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {getPlatformRepository,platformEnabled} from "./runtime.js";
import {getSession} from "../auth/session.js";
import {createMediaIngressRouter,mediaProfileSchema} from "./media-ingress.js";
import {MediaEnrollmentService} from "./media-enrollment-service.js";
import {createMediaEnrollmentRouter} from "./media-enrollment-router.js";
export function environmentMediaRouters(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>}={}):{ingress:express.Router;review:express.Router}|null{
 const env=options.env??process.env,flag=env.LUMIN_MEDIA_INGRESS_ENABLED;if(flag!==undefined&&!['true','false'].includes(flag))throw new PlatformDenied("INVALID_MEDIA_INGRESS_FLAG");if(flag!=="true"||!platformEnabled())return null;
 let profiles:z.infer<typeof mediaProfileSchema>[];try{const raw=env.LUMIN_MEDIA_INGRESS_PROFILES_JSON;if(!raw||raw.length>32000)throw new Error();profiles=z.array(mediaProfileSchema).min(1).max(32).parse(JSON.parse(raw));}catch{throw new PlatformDenied("MEDIA_INGRESS_CONFIGURATION_REQUIRED");}
 if((env.SESSION_COOKIE_SECRET??"").length<32||!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("MEDIA_SESSION_AND_ENCRYPTION_CONFIGURATION_REQUIRED");
 for(const p of profiles)if(p.appId!==(p.provider==="META_INSTAGRAM_LOGIN"?env.INSTAGRAM_APP_ID:p.provider==="META_THREADS"?env.THREADS_APP_ID:env.META_APP_ID)||!/^[a-f0-9]{64}$/i.test(env[p.secretReference]??""))throw new PlatformDenied("MEDIA_INGRESS_APP_AND_KEY_BINDING_REQUIRED");
 const repo=options.repository??getPlatformRepository(),service=new MediaEnrollmentService(repo);
 return {ingress:createMediaIngressRouter({profiles,service,secret:async ref=>profiles.some(p=>p.secretReference===ref)?env[ref]??"":""}),review:createMediaEnrollmentRouter({origin,csrfSecret:env.SESSION_COOKIE_SECRET!,service,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})})};
}
