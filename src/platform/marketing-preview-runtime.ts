import type express from 'express';
import {getSession} from '../auth/session.js';
import {getPlatformRepository} from './runtime.js';
import type {PlatformRepository} from './repository.js';
import {PlatformDenied,type PlatformPrincipal} from './models.js';
import {createMarketingPreviewRouter} from './marketing-preview-router.js';
import {assertPrivateReadResponseCurrent} from './execution.js';
export function environmentMarketingPreviewRouter(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>;fetcher?:typeof fetch}={}):express.Router|null{
 const env=options.env??process.env;for(const name of ['LUMIN_MARKETING_PREVIEWS_ENABLED','LUMIN_PLATFORM_ENABLED'])if(env[name]!==undefined&&!['true','false'].includes(env[name]!))throw new PlatformDenied('PRIVATE_PREVIEW_FLAG_INVALID');if(env.LUMIN_MARKETING_PREVIEWS_ENABLED!=='true')return null;if(env.LUMIN_PLATFORM_ENABLED!=='true')throw new PlatformDenied('PRIVATE_PREVIEW_PLATFORM_REQUIRED');
 let url:URL;try{url=new URL(origin);}catch{throw new PlatformDenied('PRIVATE_PREVIEW_HTTPS_CONFIGURATION_REQUIRED');}if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password||url.port||!/^\d{1,100}$/.test(env.META_APP_ID??'')||(env.SESSION_COOKIE_SECRET??'').length<32||!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY??''))throw new PlatformDenied('PRIVATE_PREVIEW_HTTPS_CONFIGURATION_REQUIRED');
 const repo=options.repository??getPlatformRepository();if(!repo.assertPrivateReadResponseCurrent)throw new PlatformDenied('PRIVATE_PREVIEW_ATOMIC_ADAPTER_REQUIRED');return createMarketingPreviewRouter({repo,fetcher:options.fetcher,assertReadResponseCurrent:assertPrivateReadResponseCurrent,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})});
}
