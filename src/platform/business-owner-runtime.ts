import {getSession} from '../auth/session.js';
import {PlatformDenied} from './models.js';
import {getPlatformRepository,platformEnabled} from './runtime.js';
import {BusinessOwnerBindingService} from './business-owner-service.js';
import {createBusinessOwnerRouter} from './business-owner-router.js';
export function environmentBusinessOwnerRouter(origin:string){const flag=process.env.LUMIN_BUSINESS_OWNER_BINDINGS_ENABLED;if(flag!==undefined&&!['true','false'].includes(flag))throw new PlatformDenied('INVALID_BUSINESS_OWNER_BINDINGS_FLAG');if(flag!=='true'||!platformEnabled())return null;if(!/^\d{1,32}$/.test(process.env.META_APP_ID??'')||(process.env.SESSION_COOKIE_SECRET??'').length<32)throw new PlatformDenied('BUSINESS_OWNER_APP_SESSION_RUNTIME_REQUIRED');const repo=getPlatformRepository();return createBusinessOwnerRouter({origin,csrfSecret:process.env.SESSION_COOKIE_SECRET!,service:new BusinessOwnerBindingService(repo,process.env.META_APP_ID!),resolveSession:async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;}});}
