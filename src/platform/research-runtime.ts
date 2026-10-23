import {initializeOfficialApifyAdapter} from "./apify-official-environment.js";
import {initializeApifyResearchAdapter} from "./apify-research-adapter.js";
import {initializeGeminiResearchAdapter} from "./gemini-environment.js";
import {ResearchFinancialService} from './research-financial.js';
import type express from 'express';
import {getSession} from '../auth/session.js';
import {PlatformDenied} from './models.js';
import {getPlatformRepository,platformEnabled} from './runtime.js';
import {ResearchAdapterRegistry} from './research-adapters.js';
import {ResearchJobService} from './research-jobs.js';
import {createResearchReviewRouter} from './research-review-router.js';
import type {PlatformRepository} from './repository.js';
const registry=new ResearchAdapterRegistry();
export function getResearchAdapterRegistry(){return registry;}
let injected:ResearchJobService|undefined;
export function configureResearchJobService(service:ResearchJobService|undefined){injected=service;}
export function paidResearchEnabled(env:NodeJS.ProcessEnv=process.env){const flag=env.LUMIN_PAID_RESEARCH_ENABLED;if(flag!==undefined&&!['true','false'].includes(flag))throw new PlatformDenied('INVALID_PAID_RESEARCH_FLAG');return env.LUMIN_PLATFORM_ENABLED==='true'&&flag==='true';}
export function getResearchJobService():ResearchJobService{if(injected)return injected;initializeGeminiResearchAdapter(registry);initializeApifyResearchAdapter(registry);initializeOfficialApifyAdapter(registry);if(!platformEnabled()||!/^\d{1,32}$/.test(process.env.META_APP_ID??''))throw new PlatformDenied('RESEARCH_AUTH_APP_RUNTIME_REQUIRED');return new ResearchJobService(getPlatformRepository(),registry,process.env.META_APP_ID!,()=>paidResearchEnabled());}
export function environmentResearchReviewRouter(origin:string,options:{env?:NodeJS.ProcessEnv;repository?:PlatformRepository;service?:ResearchJobService;resolveSession?:(req:express.Request)=>Promise<import('./models.js').PlatformPrincipal|null>}={}):express.Router|null{const env=options.env??process.env;if(!paidResearchEnabled(env))return null;if(!/^\d{1,32}$/.test(env.META_APP_ID??'')||(env.SESSION_COOKIE_SECRET??'').length<32||!/^[a-fA-F0-9]{64}$/.test(env.TOKEN_ENCRYPTION_KEY??''))throw new PlatformDenied('RESEARCH_REVIEW_SESSION_APP_ENCRYPTION_REQUIRED');initializeGeminiResearchAdapter(registry,env);initializeApifyResearchAdapter(registry,env);initializeOfficialApifyAdapter(registry,env);const repo=options.repository??getPlatformRepository(),service=options.service??new ResearchJobService(repo,registry,env.META_APP_ID!,()=>paidResearchEnabled(env));return createResearchReviewRouter({origin,csrfSecret:env.SESSION_COOKIE_SECRET!,service,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})});}

export function getResearchFinancialService():ResearchFinancialService{if(!platformEnabled()||!/^\d{1,32}$/.test(process.env.META_APP_ID??''))throw new PlatformDenied('RESEARCH_AUTH_APP_RUNTIME_REQUIRED');return new ResearchFinancialService(getPlatformRepository(),registry,process.env.META_APP_ID!);}
