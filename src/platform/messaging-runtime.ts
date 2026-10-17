import {configureWhatsAppSendPolicy} from "./whatsapp-send-policy.js";
import { getFirestore } from "../store/firestore.js";
import { configureMessagingPolicyVerifier } from "./clients.js";
import { FirestoreMessagingPolicyStore, MessagingPolicyService } from "./messaging-policy.js";
import { getPlatformRepository, platformEnabled } from "./runtime.js";
import { configureMessagingIngress } from "./events/runtime.js";
import { trustedMessagingInboundRecorder } from "./events/messaging-inbound.js";
import { PlatformDenied } from "./models.js";

export function initializeMessagingPolicyRuntime():void{
  const flag=process.env.LUMIN_PLATFORM_MESSAGING_POLICY_ENABLED;
  if(flag!==undefined && flag!=="true" && flag!=="false")throw new PlatformDenied("INVALID_MESSAGING_POLICY_FLAG");
  configureMessagingPolicyVerifier(undefined);configureMessagingIngress(undefined);configureWhatsAppSendPolicy(undefined);
  if(flag!=="true" || !platformEnabled())return;
  const key=process.env.MESSAGING_RECIPIENT_HMAC_KEY;
  if(!key || !/^[a-fA-F0-9]{64}$/.test(key))throw new PlatformDenied("MESSAGING_RECIPIENT_HMAC_KEY_REQUIRED");
  const service=new MessagingPolicyService(new FirestoreMessagingPolicyStore(getFirestore()),Buffer.from(key,"hex"));
  configureMessagingPolicyVerifier((scope,input)=>service.verifyExecution(scope,input));
  configureWhatsAppSendPolicy({verify:(scope,input)=>service.verifyExecution(scope,input),recordTemplate:async(scope,recipient,evidence)=>{const c=scope.snapshot.connection;await service.recordTrustedTemplate(service.scope({tenantId:scope.context.principal.tenantId,clientId:scope.context.clientId,provider:"META_WHATSAPP",appId:c.appId,assetId:scope.plan.assets[0].id},recipient),evidence);}});
  configureMessagingIngress(trustedMessagingInboundRecorder(getPlatformRepository(),service));
}
