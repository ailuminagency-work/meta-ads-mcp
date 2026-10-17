import type express from 'express';
import {getSession} from '../auth/session.js';
import {PlatformDenied,type PlatformPrincipal} from './models.js';
import {getPlatformRepository} from './runtime.js';
import type {PlatformRepository} from './repository.js';
import {configuredOAuthProfiles} from './connection-runtime.js';
import {isSignalDatasetOAuthProfile} from './dataset-oauth.js';
import {SignalAssetDiscoveryService} from './signal-discovery-service.js';
import {createSignalDiscoveryRouter} from './signal-discovery-router.js';
export function configuredSignalDiscoveryService(){return new SignalAssetDiscoveryService(getPlatformRepository());}
export function environmentSignalDiscoveryRouter(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;fetcher?:typeof fetch;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>}={}){const env=options.env??process.env,flag=env.LUMIN_SIGNAL_ASSET_DISCOVERY_ENABLED;if(flag!==undefined&&flag!=='true'&&flag!=='false')throw new PlatformDenied('SIGNAL_DISCOVERY_FLAG_INVALID');if(flag!=='true'||env.LUMIN_PLATFORM_ENABLED!=='true')return null;if(!/^[1-9]\d{0,31}$/.test(env.META_APP_ID??'')||!/^([a-f0-9]{64})$/i.test(env.TOKEN_ENCRYPTION_KEY??'')||(env.SESSION_COOKIE_SECRET??'').length<32||!configuredOAuthProfiles(origin,env).profiles.some(isSignalDatasetOAuthProfile))throw new PlatformDenied('SIGNAL_DISCOVERY_CONFIGURED_PROFILE_SESSION_REQUIRED');const repo=options.repository??getPlatformRepository();return createSignalDiscoveryRouter({origin,csrfSecret:env.SESSION_COOKIE_SECRET!,service:new SignalAssetDiscoveryService(repo,{fetcher:options.fetcher}),resolveSession:options.resolveSession??(async req=>{const s=await getSession(req);return s?repo.resolvePrincipal(s.fbUserId):null;})});}
