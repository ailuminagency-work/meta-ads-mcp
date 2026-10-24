import type express from 'express';
import {getSession} from '../auth/meta-oauth.js';
import {PlatformDenied} from './models.js';
import {getPlatformRepository,platformEnabled} from './runtime.js';
import {createClientManagementRouter} from './client-management-router.js';

/** Disabled by default. Enable only after owner review on the staging environment. */
export function environmentClientManagementRouter(origin:string):express.Router|null{
  const flag=process.env.LUMIN_CLIENT_MANAGEMENT_ENABLED;
  if(flag!==undefined&&flag!=='true'&&flag!=='false')throw new PlatformDenied('INVALID_CLIENT_MANAGEMENT_FLAG');
  if(flag!=='true'||!platformEnabled())return null;
  const repo=getPlatformRepository();
  return createClientManagementRouter({
    origin,csrfSecret:process.env.SESSION_COOKIE_SECRET??'',repo,
    resolveSession:async req=>{
      const session=await getSession(req);
      return session?repo.resolvePrincipal(session.fbUserId):null;
    }
  });
}
