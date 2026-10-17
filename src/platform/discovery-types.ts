import {createHash} from "node:crypto";
import {encryptToken,decryptToken,type EncryptedPayload} from "../auth/crypto.js";
import {PlatformDenied} from "./models.js";
import {canonicalJson} from "./policy.js";
import type {AdDiscoveryProof,DiscoverableAdAsset} from "./asset-discovery.js";
export interface DiscoveryProposal {id:string;tenantId:string;clientId:string;actorId:string;connectionId:string;rootKey:string;kind:DiscoverableAdAsset;planHash:string;checkedAt:number;expiresAt:number;consumedAt:number|null;approvedBy:string|null;encryptedPlan:EncryptedPayload}
export interface DiscoveryPlanPayload {version:1;proof:AdDiscoveryProof;expected:Array<{collection:"tenants"|"members"|"clients"|"assets"|"connections"|"grants"|"ownerBillingAttestations"|"accountOwnershipObservations";id:string;canonical:string}>}
type ProposalIdentity=Pick<DiscoveryProposal,"id"|"tenantId"|"clientId"|"actorId"|"connectionId"|"rootKey"|"kind"|"checkedAt"|"expiresAt">;
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
function identityOf(proposal:ProposalIdentity):ProposalIdentity{const{id,tenantId,clientId,actorId,connectionId,rootKey,kind,checkedAt,expiresAt}=proposal;return {id,tenantId,clientId,actorId,connectionId,rootKey,kind,checkedAt,expiresAt};}
export function discoveryProposalAad(proposal:ProposalIdentity):string{return canonicalJson({purpose:"lumin-discovery-proposal",version:1,...identityOf(proposal)});}
export function discoveryPlanHash(proposal:ProposalIdentity,payload:DiscoveryPlanPayload):string{return hash(canonicalJson({identity:identityOf(proposal),payload}));}
function keyRequired():void{if(!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("DISCOVERY_ENCRYPTION_KEY_REQUIRED");}
export function encryptDiscoveryPlan(identity:ProposalIdentity,payload:DiscoveryPlanPayload):{planHash:string;encryptedPlan:EncryptedPayload}{keyRequired();const text=canonicalJson(payload);if(text.length>131072)throw new PlatformDenied("DISCOVERY_ENCRYPTED_PLAN_TOO_LARGE");return {planHash:discoveryPlanHash(identity,payload),encryptedPlan:encryptToken(text,discoveryProposalAad(identity))};}
export function decryptDiscoveryPlan(proposal:DiscoveryProposal):DiscoveryPlanPayload{
 keyRequired();const {id,tenantId,clientId,actorId,connectionId,rootKey,kind,checkedAt,expiresAt}=proposal,identity:ProposalIdentity={id,tenantId,clientId,actorId,connectionId,rootKey,kind,checkedAt,expiresAt};
 try{const payload=JSON.parse(decryptToken(proposal.encryptedPlan,discoveryProposalAad(identity))) as DiscoveryPlanPayload;if(payload.version!==1||!Array.isArray(payload.expected)||payload.expected.length>100||!payload.proof||payload.proof.kind!==kind||payload.proof.connectionId!==connectionId||payload.proof.rootKey!==rootKey||payload.proof.checkedAt!==checkedAt||!Array.isArray(payload.proof.rows)||payload.proof.rows.length>20||payload.proof.rowsHash!==hash(canonicalJson(payload.proof.rows))||discoveryPlanHash(identity,payload)!==proposal.planHash)throw new Error();return payload;}catch{throw new PlatformDenied("DISCOVERY_ENCRYPTED_PLAN_BINDING_INVALID");}
}
