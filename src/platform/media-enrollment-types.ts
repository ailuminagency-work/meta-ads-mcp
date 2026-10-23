import {createHash} from "node:crypto";
import {encryptToken,decryptToken,type EncryptedPayload} from "../auth/crypto.js";
import {PlatformDenied,type MetaAsset} from "./models.js";
import {canonicalJson} from "./policy.js";
import type {ControlCommit} from "./repository.js";
export interface MediaProposal {id:string;tenantId:string;clientId:string;actorId:string;connectionId:string;rootKey:string;appId:string;provider:"META_THREADS"|"META_MARKETING"|"META_MESSENGER"|"META_INSTAGRAM_LOGIN"|"META_INSTAGRAM_FACEBOOK_LOGIN"|"META_FACEBOOK_PAGES"|"META_WHATSAPP";checkedAt:number;expiresAt:number;consumedAt:number|null;approvedBy:string|null;planHash:string;encryptedPlan:EncryptedPayload}
export interface MediaPlan {version:1;url:string;evidence:NonNullable<MetaAsset["mediaEvidence"]>;expected:ControlCommit["expected"]}
const identity=(p:Omit<MediaProposal,"planHash"|"encryptedPlan">)=>{const {id,tenantId,clientId,actorId,connectionId,rootKey,appId,provider,checkedAt,expiresAt}=p;return {id,tenantId,clientId,actorId,connectionId,rootKey,appId,provider,checkedAt,expiresAt};};
function aad(p:Omit<MediaProposal,"planHash"|"encryptedPlan">):string{return canonicalJson({purpose:"lumin-media-enrollment",version:1,...identity(p)});}
function hash(p:Omit<MediaProposal,"planHash"|"encryptedPlan">,plan:MediaPlan):string{return createHash("sha256").update(canonicalJson({identity:identity(p),plan})).digest("hex");}
function requireKey():void{if(!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("MEDIA_ENCRYPTION_KEY_REQUIRED");}
export function encryptMediaPlan(p:Omit<MediaProposal,"planHash"|"encryptedPlan">,plan:MediaPlan):Pick<MediaProposal,"planHash"|"encryptedPlan">{requireKey();const text=canonicalJson(plan);if(text.length>131072)throw new PlatformDenied("MEDIA_PLAN_TOO_LARGE");return {planHash:hash(p,plan),encryptedPlan:encryptToken(text,aad(p))};}
export function decryptMediaPlan(p:MediaProposal):MediaPlan{requireKey();try{const plan=JSON.parse(decryptToken(p.encryptedPlan,aad(p))) as MediaPlan;if(plan.version!==1||!Array.isArray(plan.expected)||plan.expected.length>100||hash(p,plan)!==p.planHash)throw new Error();return plan;}catch{throw new PlatformDenied("MEDIA_PLAN_BINDING_INVALID");}}
