import {crmRootIdsSchema,isCrmOAuthProfile,validateCrmOAuthProfile} from "./crm-oauth.js";
import {datasetRootIdsSchema,isSignalDatasetOAuthProfile,validateSignalDatasetOAuthProfile} from "./dataset-oauth.js";
import {isAppPromotionOAuthProfile,validateAppPromotionOAuthProfile} from "./app-promotion-oauth.js";
import {appPromotionBindingSchema} from "./app-promotion-contract.js";
import {invoiceRootIdsSchema} from "./business-invoice-metadata.js";
import {studyRootIdsSchema} from "./marketing-study-proof.js";
import {connectionPrivacyAppUserId} from "./privacy-identity.js";
import {usesRegisteredMarketingAdProof} from "./marketing-control-oauth-proof.js";
import {createWhatsAppEmbeddedV4Router} from "./whatsapp-embedded-signup.js";
import {createWhatsAppOAuthAdapter,whatsappEnrollmentBindingSchema} from "./oauth-whatsapp.js";
import {createInstagramOAuthAdapter} from "./oauth-instagram.js";
import {FacebookPagesOAuthAdapter} from "./oauth-pages.js";
import express from "express";
import { z } from "zod";
import { getSession } from "../auth/session.js";
import { getFirestore } from "../store/firestore.js";
import { getPlatformRepository, platformEnabled } from "./runtime.js";
import { ImmutableOAuthProfileRegistry, PlatformOAuthService, atomicConnectionEnrollment,atomicConnectionEnrollments, unverifiedOAuthAdapter, type TrustedOAuthProfile,type VerifiedProviderAdapter } from "./oauth.js";
import { FacebookBusinessOAuthAdapter } from "./oauth-facebook.js";
import { createThreadsOAuthAdapter } from "./oauth-threads.js";
import { createPlatformOAuthRouter } from "./oauth-router.js";
import { FirestoreConnectionChallengeStore } from "./connection-challenge-store.js";
import { PlatformDenied } from "./models.js";

const profileSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),provider:z.enum(["META_MARKETING","META_BUSINESS","META_FACEBOOK_PAGES","META_MESSENGER","META_INSTAGRAM_FACEBOOK_LOGIN","META_INSTAGRAM_LOGIN","META_WHATSAPP","META_THREADS"]),appId:z.string().regex(/^\d{1,100}$/),strategy:z.enum(["facebook_business","instagram_login","threads_login"]),scopes:z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(30),derivedTokenScopes:z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(30).optional(),authorizationContext:z.enum(["DIRECT","BUSINESS_MANAGER"]).optional(),crmRootIds:crmRootIdsSchema.optional(),datasetRootIds:datasetRootIdsSchema.optional(),appPromotionBinding:appPromotionBindingSchema.optional(),studyRootIds:studyRootIdsSchema.optional(),invoiceRootIds:invoiceRootIdsSchema.optional(),marketingControlMode:z.enum(["TRAFFIC","INSTANT_FORM_LEADS"]).optional(),tokenTypes:z.array(z.enum(["user","page","system_user","business_integration_system_user","instagram","threads"])).min(1).max(3),redirectUri:z.string().url(),authorizeUrl:z.string().url(),verified:z.literal(true),configurationId:z.string().regex(/^\d+$/).optional(),secretReference:z.enum(["META_APP_SECRET","THREADS_APP_SECRET","INSTAGRAM_APP_SECRET"]),capabilities:z.array(z.string().max(128)).min(1).max(200),actions:z.array(z.enum(["READ","WRITE_NON_FINANCIAL","WRITE_CONTENT","WRITE_MESSAGING","WRITE_AD_CONFIGURATION","WRITE_BUDGET","ACTIVATE_SPEND","DELETE","BUSINESS_ADMIN","IDENTITY_OR_ACCESS","BILLING"])).min(1),requiredTasks:z.array(z.string().regex(/^[A-Z_]+$/)).max(20)}).strict();
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function assertConfiguredOAuthApp(profile:Pick<TrustedOAuthProfile,"provider"|"appId"|"secretReference">,env:Record<string,string|undefined>=process.env):void{
  const prefix=profile.provider==="META_THREADS"?"THREADS":profile.provider==="META_INSTAGRAM_LOGIN"?"INSTAGRAM":"META";
  const configured=env[`${prefix}_APP_ID`];
  if(!configured || !/^\d{1,100}$/.test(configured) || profile.appId!==configured || profile.secretReference!==`${prefix}_APP_SECRET`)throw new PlatformDenied("OAUTH_CONFIGURED_APP_BINDING_REQUIRED");
}
/** Pure validated deployment metadata snapshot shared by OAuth and fixed role inspectors. */
export function configuredOAuthProfiles(origin:string,env:Record<string,string|undefined>=process.env):{profiles:TrustedOAuthProfile[];registry:ImmutableOAuthProfileRegistry}{
 const url=new URL(origin);if(url.protocol!=="https:"||url.origin!==origin)throw new PlatformDenied("OAUTH_EXACT_HTTPS_ORIGIN_REQUIRED");
 let profiles:TrustedOAuthProfile[];try{const raw=env.LUMIN_PLATFORM_OAUTH_PROFILES_JSON;if(!raw||raw.length>64000)throw new Error();profiles=z.array(profileSchema).min(1).max(16).parse(JSON.parse(raw));}catch{throw new PlatformDenied("VERIFIED_DEPLOYMENT_OAUTH_PROFILES_REQUIRED");}
 const registry=new ImmutableOAuthProfileRegistry(profiles);
 for(const profile of profiles){if(profile.crmRootIds!==undefined||isCrmOAuthProfile(profile))validateCrmOAuthProfile(profile);if(profile.datasetRootIds!==undefined||isSignalDatasetOAuthProfile(profile))validateSignalDatasetOAuthProfile(profile);if(profile.appPromotionBinding!==undefined||isAppPromotionOAuthProfile(profile))validateAppPromotionOAuthProfile(profile);if(profile.invoiceRootIds!==undefined&&(profile.provider!=="META_MARKETING"||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="user"||!profile.capabilities.includes("marketing.list.client.invoice.metadata")))throw new PlatformDenied("INVOICE_ROOTS_PROFILE_FORBIDDEN");if(profile.studyRootIds!==undefined&&(profile.provider!=="META_MARKETING"||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="user"||!profile.capabilities.includes("marketing.create.classic_split_study")))throw new PlatformDenied("STUDY_ROOTS_PROFILE_FORBIDDEN");if(profile.marketingControlMode!==undefined&&(profile.provider!=="META_MARKETING"||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="user"||!usesRegisteredMarketingAdProof(profile)))throw new PlatformDenied("MARKETING_CONTROL_PROFILE_MODE_FORBIDDEN");assertConfiguredOAuthApp(profile,env);if(profile.redirectUri!==`${origin}/platform/oauth/${profile.id}/callback`)throw new PlatformDenied("OAUTH_CALLBACK_MUST_MATCH_THIS_SERVICE");const required=profile.provider==="META_THREADS"?"THREADS_APP_SECRET":profile.provider==="META_INSTAGRAM_LOGIN"?"INSTAGRAM_APP_SECRET":"META_APP_SECRET";if(profile.secretReference!==required||!env[required])throw new PlatformDenied("PROVIDER_SECRET_CONFIGURATION_REQUIRED");}
 return {profiles,registry};
}
export function platformConnectionRouters(origin:string):{oauth:express.Router;connections:express.Router}|null{
  const flag=process.env.LUMIN_PLATFORM_OAUTH_ENABLED;
  if(flag!==undefined && flag!=="true" && flag!=="false")throw new PlatformDenied("INVALID_PLATFORM_OAUTH_FLAG");
  if(flag!=="true" || !platformEnabled())return null;
  const {profiles,registry}=configuredOAuthProfiles(origin);
  const repo=getPlatformRepository();
  let whatsappBindings:z.infer<typeof whatsappEnrollmentBindingSchema>[]=[];
  if(profiles.some(p=>p.provider==="META_WHATSAPP")){
    try{const raw=process.env.LUMIN_WHATSAPP_ENROLLMENT_BINDINGS_JSON;if(!raw||raw.length>32000)throw new Error();whatsappBindings=z.array(whatsappEnrollmentBindingSchema).min(1).max(32).parse(JSON.parse(raw));}catch{throw new PlatformDenied("WHATSAPP_OWNER_REVIEWED_DEPLOYMENT_BINDINGS_REQUIRED");}
  }
  const whatsapp=createWhatsAppOAuthAdapter({bindings:whatsappBindings});
  const marketingUser=new FacebookBusinessOAuthAdapter("META_MARKETING"),marketingPage=new FacebookPagesOAuthAdapter("META_MARKETING");
  const marketing:VerifiedProviderAdapter={provider:"META_MARKETING",verified:true,validateProfile:profile=>(profile.tokenTypes.length===1&&profile.tokenTypes[0]==="page"?marketingPage:marketingUser).validateProfile(profile),exchangeAndInspect:input=>(input.profile.tokenTypes.length===1&&input.profile.tokenTypes[0]==="page"?marketingPage:marketingUser).exchangeAndInspect(input),exchangeAndInspectMany:async input=>input.profile.tokenTypes.length===1&&input.profile.tokenTypes[0]==="page"?marketingPage.exchangeAndInspectMany(input):[await marketingUser.exchangeAndInspect(input)]};
  const adapters={get:(provider:TrustedOAuthProfile["provider"])=>provider==="META_MARKETING"?marketing:provider==="META_BUSINESS"?new FacebookBusinessOAuthAdapter(provider):provider==="META_THREADS"?createThreadsOAuthAdapter():provider==="META_INSTAGRAM_LOGIN"?createInstagramOAuthAdapter():provider==="META_WHATSAPP"?whatsapp:provider==="META_FACEBOOK_PAGES"||provider==="META_MESSENGER"||provider==="META_INSTAGRAM_FACEBOOK_LOGIN"?new FacebookPagesOAuthAdapter(provider):unverifiedOAuthAdapter(provider)};
  for(const profile of profiles){if(profile.studyRootIds!==undefined&&(profile.provider!=="META_MARKETING"||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="user"||!profile.capabilities.includes("marketing.create.classic_split_study")))throw new PlatformDenied("STUDY_ROOTS_PROFILE_FORBIDDEN");const adapter=adapters.get(profile.provider);if(adapter.verified)adapter.validateProfile(profile);}
  const service=new PlatformOAuthService({repository:repo,challenges:new FirestoreConnectionChallengeStore(getFirestore()),profiles:registry,secrets:{get:async reference=>{if(!["META_APP_SECRET","THREADS_APP_SECRET","INSTAGRAM_APP_SECRET"].includes(reference))throw new PlatformDenied("UNKNOWN_PROVIDER_SECRET_REFERENCE");return process.env[reference]??"";}},adapters,commitVerifiedConnection:atomicConnectionEnrollment(repo),commitVerifiedConnections:atomicConnectionEnrollments(repo)});
  const oauth=express.Router();oauth.use(createWhatsAppEmbeddedV4Router({service,profiles,origin,getSessionOperator:async req=>(await getSession(req))?.fbUserId??null}));oauth.use(createPlatformOAuthRouter({service,publicOrigin:origin,getSessionOperator:async req=>(await getSession(req))?.fbUserId??null,getNextSteps:async(operatorId,clientId,result)=>{if(process.env.LUMIN_BUSINESS_OWNER_BINDINGS_ENABLED!=="true"||result.provider!=="META_BUSINESS")return [];const principal=await repo.resolvePrincipal(operatorId);if(!principal)return [];const [member,c,client]=await Promise.all([repo.get("members",principal.tenantId,operatorId),repo.get("connections",principal.tenantId,result.connectionId),repo.get("clients",principal.tenantId,clientId)]);if(!member||member.operatorId!==operatorId||member.tenantId!==principal.tenantId||member.disabledAt!==null||!member.roles.includes("admin")||!member.allowedClientIds.includes(clientId)||!client||client.id!==clientId||client.tenantId!==principal.tenantId||client.status!=="ACTIVE"||!c||c.id!==result.connectionId||c.tenantId!==principal.tenantId||c.appId!==process.env.META_APP_ID||c.operatorId!==operatorId||c.provider!=="META_BUSINESS"||c.authStrategy!=="facebook_business"||c.tokenType!=="user"||c.revokedAt!==null||c.expiresAt!==null&&c.expiresAt<=Date.now()||!repo.isAppUserLifecycleLocked||await repo.isAppUserLifecycleLocked(c.appId,c.operatorId,connectionPrivacyAppUserId(c)))return [];const assets=await Promise.all(c.assetKeys.slice(0,20).map(key=>repo.get("assets",principal.tenantId,key)));return assets.filter(a=>a&&a.type==="BUSINESS"&&a.provider===c.provider&&a.appId===c.appId&&a.clientId===clientId&&a.revokedAt===null).map(a=>({label:"Review client ownership of business "+a!.id,path:"/platform/business-owner/"+clientId+"/"+a!.id+"/"+c.id}));}}));
  const connections=express.Router();
  connections.get("/",async(req,res)=>{
    res.setHeader("Cache-Control","no-store");res.setHeader("Content-Security-Policy","default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    try{const session=await getSession(req),principal=session?await repo.resolvePrincipal(session.fbUserId):null,member=principal?await repo.get("members",principal.tenantId,principal.operatorId):null;
      if(!principal||!member||member.disabledAt!==null||!member.roles.some(r=>r==="admin"||r==="connection_admin")){res.sendStatus(403);return;}
      const clients=(await repo.list("clients",principal.tenantId)).filter(c=>c.tenantId===principal.tenantId && c.status==="ACTIVE" && member.allowedClientIds.includes(c.id));
      const options=clients.map(c=>`<option value="${escape(c.id)}">${escape(c.id.replace(/[_-]/g," "))}</option>`).join("");
      const cards=profiles.map(p=>`<section><h2>${escape(p.id.replace(/[_-]/g," "))}</h2>${p.provider==="META_MARKETING"&&p.tokenTypes.length===1&&p.tokenTypes[0]==="page"?"<p>We also retain encrypted access from this sign-in solely to recheck roles on your selected Page. It uses the same approved permissions and expires no later than this connection. Only the fixed role-checking service may use that access.</p>":""}${adapters.get(p.provider).verified?`<form method="post" action="/platform/oauth/${escape(p.id)}/${p.provider==="META_WHATSAPP"?"embedded-signup":"start"}"><label>Client <select name="client_id" required>${options}</select></label><button>Connect this product</button></form>`:"<p>Additional setup is required before this product can connect.</p>"}</section>`).join("");
      res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Lumin client connections</title><h1>Client connections</h1><p>Connect each product for the selected client. Meta will show the requested permissions before you approve. Assets and billing stay with their owner.</p>${cards}</html>`);
    }catch{res.status(503).type("text").send("Client connections are unavailable. No permissions have been changed.");}
  });
  return {oauth,connections};
}
