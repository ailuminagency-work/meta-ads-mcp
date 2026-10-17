import {encryptToken,decryptToken} from "../auth/crypto.js";
import {PlatformDenied} from "./models.js";
import {canonicalJson} from "./policy.js";
import type {WhatsAppSetupLease} from "./whatsapp-setup-types.js";
const aad=(p:Omit<WhatsAppSetupLease,"payload">)=>{const{id,tenantId,clientId,operatorId,appId,metaAppUserId,profileId,profileHash,phoneId,clientBusinessId,whatsappAccountId,messagingAccountId,createdAt,expiresAt}=p;return canonicalJson({purpose:"WHATSAPP_SETUP_ONLY",version:1,id,tenantId,clientId,operatorId,appId,metaAppUserId,profileId,profileHash,phoneId,clientBusinessId,whatsappAccountId,messagingAccountId,createdAt,expiresAt});};
function key(){if(!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("WHATSAPP_SETUP_ENCRYPTION_REQUIRED");}
export function encryptSetupLease(p:Omit<WhatsAppSetupLease,"payload">,token:string):WhatsAppSetupLease{key();if(!token||token.length>16384||/[\s\x00-\x1f\x7f]/.test(token))throw new PlatformDenied("WHATSAPP_SETUP_TOKEN_REQUIRED");return {...p,payload:encryptToken(token,aad(p))};}
/** Private setup service only; no ordinary Credential, execution permit or MCP surface. */
export function decryptSetupLease(p:WhatsAppSetupLease,now=Date.now()):string{key();if(p.revokedAt!==null||!Number.isSafeInteger(now)||now<=0||p.createdAt>now||p.expiresAt<=now||p.expiresAt>p.createdAt+900000)throw new PlatformDenied("WHATSAPP_SETUP_LEASE_UNAVAILABLE");try{return decryptToken(p.payload,aad(p));}catch{throw new PlatformDenied("WHATSAPP_SETUP_LEASE_BINDING_INVALID");}}
