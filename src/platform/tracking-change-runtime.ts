import type express from "express";
import {getSession} from "../auth/session.js";
import {getPlatformRepository} from "./runtime.js";
import type {PlatformRepository} from "./repository.js";
import type {PlatformPrincipal} from "./models.js";
import {PlatformDenied} from "./models.js";
import {TrackingChangeService,trackingChangeEnabled} from "./tracking-change-service.js";
import {createTrackingChangeRouter} from "./tracking-change-router.js";
export function environmentTrackingChangeRouter(origin:string,options:{repository?:PlatformRepository;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>}={}):express.Router|null{if(!trackingChangeEnabled())return null;if((process.env.SESSION_COOKIE_SECRET??"").length<32)throw new PlatformDenied("TRACKING_SESSION_SECRET_REQUIRED");const repo=options.repository??getPlatformRepository();return createTrackingChangeRouter({origin,csrfSecret:process.env.SESSION_COOKIE_SECRET!,service:new TrackingChangeService(repo),resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})});}
