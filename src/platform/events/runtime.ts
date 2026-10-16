import { createMetaWebhookRouter, type WebhookDependencies } from "./router.js";
import type { Router } from "express";
import { platformEnabled } from "../runtime.js";
import { PlatformDenied } from "../models.js";

let dependencies:WebhookDependencies|undefined;
export function hasPlatformWebhookConfiguration():boolean{return dependencies!==undefined;}
let messagingIngress:WebhookDependencies["onVerifiedEvents"];
export function configureMessagingIngress(value:typeof messagingIngress):void{messagingIngress=value;}
export function configurePlatformWebhooks(value:WebhookDependencies|undefined):void{dependencies=value;}
export function platformWebhookRouter():Router|null{
  const flag=process.env.LUMIN_PLATFORM_WEBHOOKS_ENABLED;
  if(flag!==undefined && flag!=="false" && flag!=="true")throw new PlatformDenied("INVALID_WEBHOOK_FEATURE_FLAG");
  if(flag!=="true" || !platformEnabled())return null;
  if(!dependencies)throw new PlatformDenied("TRUSTED_WEBHOOK_RUNTIME_CONFIGURATION_REQUIRED");
  const configured=dependencies;
  return createMetaWebhookRouter({...configured,onVerifiedEvents:async(...args)=>{if(configured.onVerifiedEvents)await configured.onVerifiedEvents(...args);if(messagingIngress)await messagingIngress(...args);}});
}
