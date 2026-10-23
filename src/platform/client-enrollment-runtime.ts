import {getSession} from '../auth/session.js';
import {getPlatformRepository,platformEnabled} from './runtime.js';
import {PlatformDenied} from './models.js';
import {createClientEnrollmentRouter} from './client-enrollment-router.js';
export function environmentClientEnrollmentRouter(origin:string){const flag=process.env.LUMIN_CLIENT_ENROLLMENT_ENABLED;if(flag!==undefined&&!['true','false'].includes(flag))throw new PlatformDenied('INVALID_CLIENT_ENROLLMENT_FLAG');if(flag!=='true'||!platformEnabled())return null;const repo=getPlatformRepository();return createClientEnrollmentRouter({origin,repo,csrfSecret:process.env.SESSION_COOKIE_SECRET??'',appIds:{meta:process.env.META_APP_ID,threads:process.env.THREADS_APP_ID,instagram:process.env.INSTAGRAM_APP_ID},resolveSession:async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;}});}
