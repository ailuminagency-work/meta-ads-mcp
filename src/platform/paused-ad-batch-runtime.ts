import type express from "express";
import {getSession} from "../auth/session.js";
import {getPlatformRepository} from "./runtime.js";
import type {PlatformRepository} from "./repository.js";
import type {PlatformPrincipal} from "./models.js";
import {PlatformDenied} from "./models.js";
import {PausedAdBatchService,pausedAdBatchEnabled} from "./paused-ad-batch-service.js";
import {createPausedAdBatchRouter} from "./paused-ad-batch-router.js";
export function environmentPausedAdBatchRouter(origin:string,options:{repository?:PlatformRepository;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>}={}):express.Router|null{if(!pausedAdBatchEnabled())return null;if((process.env.SESSION_COOKIE_SECRET??"").length<32)throw new PlatformDenied("BATCH_SESSION_SECRET_REQUIRED");const repo=options.repository??getPlatformRepository();return createPausedAdBatchRouter({origin,csrfSecret:process.env.SESSION_COOKIE_SECRET!,service:new PausedAdBatchService(repo),resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})});}
