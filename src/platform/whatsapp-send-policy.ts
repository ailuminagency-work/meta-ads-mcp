import {PlatformDenied} from "./models.js";
import type {MessagingExecution,MessagingRequest,TrustedTemplateEvidence} from "./messaging-policy.js";
export interface WhatsAppSendPolicy {verify(scope:MessagingExecution,input:MessagingRequest):Promise<{messagingAccountId?:string;validUntil:number}>;recordTemplate(scope:MessagingExecution,recipient:string,evidence:TrustedTemplateEvidence):Promise<void>}
let policy:WhatsAppSendPolicy|undefined;
export function configureWhatsAppSendPolicy(value:WhatsAppSendPolicy|undefined):void{policy=value;}
export function configuredWhatsAppSendPolicy():WhatsAppSendPolicy{if(!policy)throw new PlatformDenied("WHATSAPP_SEND_POLICY_RUNTIME_REQUIRED");return policy;}
