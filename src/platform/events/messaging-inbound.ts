import type { PlatformRepository } from "../repository.js";
import { resolveAuthorizedAssets } from "../assets.js";
import type { MessagingPolicyService } from "../messaging-policy.js";
import type { NormalizedEvent, WebhookSubscription } from "./types.js";
import { PlatformDenied, type Provider } from "../models.js";
import { assertVerifiedWebhookBatch, type VerifiedWebhookBatch } from "./router.js";

// This adapter belongs after raw-body signature verification and trusted event
// normalization. It records a recipient HMAC, never the raw contact or message.
export function trustedMessagingInboundRecorder(repo:PlatformRepository,policy:MessagingPolicyService){
  return async(raw:Buffer,events:NormalizedEvent[],subscription:WebhookSubscription,proof:VerifiedWebhookBatch):Promise<void>=>{
    assertVerifiedWebhookBatch(proof,raw,events,subscription);
    const body=JSON.parse(raw.toString("utf8")) as {entry?:Array<{id?:string;messaging?:Array<{sender?:{id?:string};recipient?:{id?:string};timestamp?:number;message?:{mid?:string;is_echo?:boolean}}>;changes?:Array<{value?:{metadata?:{phone_number_id?:string};messages?:Array<{id?:string;from?:string;timestamp?:string}>}}>} >};
    for(const event of events){
      if(event.appId!==subscription.appId || event.subscriptionId!==subscription.id)throw new PlatformDenied("INBOUND_SUBSCRIPTION_BINDING_REQUIRED");
      if(!event.references.messageId || !["messenger","whatsapp"].includes(event.product))continue;
      let recipient:string|undefined,occurredAt:number|undefined,enclosingAccountId:string|undefined;
      const provider:Provider=event.product==="messenger"?"META_MESSENGER":"META_WHATSAPP";
      for(const entry of body.entry??[]){
        if(event.product==="messenger" && entry.id===event.assetId){
          const message=entry.messaging?.find(m=>m.message?.mid===event.references.messageId && m.recipient?.id===event.assetId && m.message?.is_echo!==true);
          if(message && typeof message.sender?.id==="string" && /^\d{1,100}$/.test(message.sender.id)){recipient=message.sender.id;occurredAt=message.timestamp;}
        }
        if(event.product==="whatsapp")for(const change of entry.changes??[]){
          if(change.value?.metadata?.phone_number_id!==event.assetId)continue;
          const message=change.value.messages?.find(m=>m.id===event.references.messageId);
          if(message && typeof message.from==="string" && /^[1-9]\d{7,14}$/.test(message.from) && typeof message.timestamp==="string" && /^\d{1,12}$/.test(message.timestamp)){recipient="+"+message.from;occurredAt=Number(message.timestamp)*1000;enclosingAccountId=entry.id;}
        }
      }
      if(!recipient || typeof occurredAt!=="number" || !Number.isSafeInteger(occurredAt) || occurredAt<=0 || occurredAt>event.receivedAt || event.receivedAt-occurredAt>=86400000)continue;
      const matches=(await repo.list("assets",event.tenantId)).filter(a=>a.tenantId===event.tenantId && a.clientId===event.clientId && a.id===event.assetId && a.provider===provider && a.appId===event.appId && a.type===(provider==="META_WHATSAPP"?"WHATSAPP_PHONE":"PAGE"));
      if(matches.length!==1)throw new PlatformDenied("INBOUND_REGISTERED_CLIENT_ASSET_REQUIRED");
      // Current Meta text-webhook reference identifies entry.id as the Messaging account ID.
      if(provider==="META_WHATSAPP" && !matches[0].parents.some(p=>p.type==="MESSAGING_ACCOUNT" && p.id===enclosingAccountId))throw new PlatformDenied("INBOUND_ACCOUNT_PARENT_BINDING_REQUIRED");
      await resolveAuthorizedAssets(repo,{principal:{tenantId:event.tenantId,operatorId:"verified-webhook-ingress"},clientId:event.clientId,provider,tool:"internal_signed_inbound",requestId:event.id},[{type:matches[0].type,id:event.assetId}],event.receivedAt);
      const scope=policy.scope({tenantId:event.tenantId,clientId:event.clientId,provider,appId:event.appId,assetId:event.assetId},recipient);
      await policy.recordTrustedInbound(scope,{eventId:event.id,occurredAt,receivedAt:event.receivedAt,verified:true,source:"meta_signed_webhook"});
    }
  };
}
