import type express from "express";
import {z} from "zod";
import {getSession} from "../auth/session.js";
import {getFirestore} from "../store/firestore.js";
import {PlatformDenied,type PlatformPrincipal} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import type {ConnectionChallengeStore} from "./connection-profiles.js";
import {getPlatformRepository} from "./runtime.js";
import {FirestoreConnectionChallengeStore} from "./connection-challenge-store.js";
import {whatsappSetupProfileSchema} from "./whatsapp-setup-types.js";
import {whatsappSetupEnabled,WhatsAppSetupService} from "./whatsapp-setup-service.js";
import {WhatsAppSetupProvider} from "./whatsapp-setup-provider.js";
import {createWhatsAppSetupRouter} from "./whatsapp-setup-router.js";
export function environmentWhatsAppSetupRouter(origin:string,options:{env?:Record<string,string|undefined>;repository?:PlatformRepository;challenges?:ConnectionChallengeStore;resolveSession?:(req:express.Request)=>Promise<PlatformPrincipal|null>;fetcher?:typeof fetch}={}):express.Router|null{const env=options.env??process.env;if(!whatsappSetupEnabled(env))return null;let profiles:z.infer<typeof whatsappSetupProfileSchema>[];try{const raw=env.LUMIN_WHATSAPP_SETUP_PROFILES_JSON;if(!raw||raw.length>64000)throw new Error();profiles=z.array(whatsappSetupProfileSchema).min(1).max(32).parse(JSON.parse(raw));}catch{throw new PlatformDenied("WHATSAPP_SETUP_PROFILES_REQUIRED");}const url=new URL(origin);if(url.protocol!=="https:"||url.origin!==origin||url.username||url.password||url.port||!/^[0-9]{1,32}$/.test(env.META_APP_ID??"")||!env.META_APP_SECRET||/[|\s\x00-\x1f\x7f]/.test(env.META_APP_SECRET)||!(/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY??""))||(env.SESSION_COOKIE_SECRET??"").length<32||profiles.some(p=>p.appId!==env.META_APP_ID||p.redirectUri!==origin+"/platform/whatsapp-setup/callback"))throw new PlatformDenied("WHATSAPP_SETUP_APP_ORIGIN_ENCRYPTION_REQUIRED");const repo=options.repository??getPlatformRepository(),service=new WhatsAppSetupService({repository:repo,profiles,challenges:options.challenges??new FirestoreConnectionChallengeStore(getFirestore()),appSecret:async p=>p.appId===env.META_APP_ID&&p.secretReference==="META_APP_SECRET"?env.META_APP_SECRET!:Promise.reject(new PlatformDenied("SETUP_APP_SECRET_REQUIRED")),provider:new WhatsAppSetupProvider(options.fetcher)});return createWhatsAppSetupRouter({origin,csrfSecret:env.SESSION_COOKIE_SECRET!,profiles,service,resolveSession:options.resolveSession??(async req=>{const session=await getSession(req);return session?repo.resolvePrincipal(session.fbUserId):null;})});}
