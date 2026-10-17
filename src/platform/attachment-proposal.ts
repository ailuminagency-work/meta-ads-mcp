import {createHash} from "node:crypto";
import {encryptToken,decryptToken} from "../auth/crypto.js";
import {canonicalJson} from "./policy.js";
import {PlatformDenied} from "./models.js";
import type {AttachmentPlan,AttachmentProposal} from "./attachment-source.js";
type Identity=Omit<AttachmentProposal,"planHash"|"encryptedPlan">;
function identity(p:Identity){const{id,tenantId,clientId,actorId,connectionId,rootKey,appId,provider,checkedAt,expiresAt}=p;return {id,tenantId,clientId,actorId,connectionId,rootKey,appId,provider,checkedAt,expiresAt,purpose:p.purpose};}
function aad(p:Identity):string{return canonicalJson({envelopePurpose:"lumin-attachment-enrollment",version:1,...identity(p)});}
const hash=(p:Identity,plan:AttachmentPlan)=>createHash("sha256").update(canonicalJson({identity:identity(p),plan})).digest("hex");
function key(){if(!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("ATTACHMENT_ENCRYPTION_KEY_REQUIRED");}
export function encryptAttachmentPlan(p:Identity,plan:AttachmentPlan):Pick<AttachmentProposal,"planHash"|"encryptedPlan">{key();const text=canonicalJson(plan);if(text.length>131072)throw new PlatformDenied("ATTACHMENT_PLAN_TOO_LARGE");return {planHash:hash(p,plan),encryptedPlan:encryptToken(text,aad(p))};}
export function decryptAttachmentPlan(p:AttachmentProposal):AttachmentPlan{key();try{const plan=JSON.parse(decryptToken(p.encryptedPlan,aad(p))) as AttachmentPlan;if(plan.version!==1||!Array.isArray(plan.expected)||plan.expected.length>100||hash(p,plan)!==p.planHash)throw new Error();return plan;}catch{throw new PlatformDenied("ATTACHMENT_PLAN_BINDING_INVALID");}}
