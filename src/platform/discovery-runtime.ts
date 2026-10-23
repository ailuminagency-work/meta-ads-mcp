import type express from "express";
import {getSession} from "../auth/session.js";
import {getPlatformRepository,platformEnabled} from "./runtime.js";
import type {PlatformRepository} from "./repository.js";
import {PlatformDenied} from "./models.js";
import {AssetDiscoveryService} from "./discovery-service.js";
import {createDiscoveryRouter} from "./discovery-router.js";
export function discoveryEnabled(env:Record<string,string|undefined>=process.env):boolean{const flag=env.LUMIN_PLATFORM_DISCOVERY_ENABLED;if(flag!==undefined&&!['true','false'].includes(flag))throw new PlatformDenied("INVALID_DISCOVERY_FLAG");return flag==="true"&&platformEnabled();}
export function configuredAssetDiscoveryService():AssetDiscoveryService{if(!discoveryEnabled())throw new PlatformDenied("DISCOVERY_DISABLED_BY_DEPLOYMENT");return new AssetDiscoveryService(getPlatformRepository());}
export function environmentDiscoveryRouter(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;fetcher?:typeof fetch;resolveSession?:(req:express.Request)=>Promise<import('./models.js').PlatformPrincipal|null>}={}):express.Router|null{
 const env=options.env??process.env;if(!discoveryEnabled(env))return null;const secret=env.SESSION_COOKIE_SECRET??"";if(secret.length<32||!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("DISCOVERY_SESSION_AND_ENCRYPTION_CONFIGURATION_REQUIRED");
 const repo=options.repository??getPlatformRepository(),service=new AssetDiscoveryService(repo,{fetcher:options.fetcher});return createDiscoveryRouter({origin,csrfSecret:secret,service,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})});
}
