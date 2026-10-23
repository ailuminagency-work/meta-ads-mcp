import type express from "express";
import {getSession} from "../auth/session.js";
import {createOwnershipRouter} from "./ownership-router.js";
import {discoveryEnabled} from "./discovery-runtime.js";
import {getPlatformRepository} from "./runtime.js";
import {PlatformDenied,type PlatformPrincipal} from "./models.js";
import type {PlatformRepository} from "./repository.js";
export function environmentOwnershipRouter(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>}={}):express.Router|null{
 const env=options.env??process.env;if(!discoveryEnabled(env))return null;const secret=env.SESSION_COOKIE_SECRET??"";if(!/^\d{1,100}$/.test(env.META_APP_ID??"")||secret.length<32||!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("OWNERSHIP_SESSION_AND_ENCRYPTION_CONFIGURATION_REQUIRED");
 const repo=options.repository??getPlatformRepository();return createOwnershipRouter({origin,csrfSecret:secret,repo,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})});
}
