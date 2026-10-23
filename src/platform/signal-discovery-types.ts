import {createHash} from 'node:crypto';
import {encryptToken,decryptToken,type EncryptedPayload} from '../auth/crypto.js';
import {PlatformDenied,type AssetRef,type PlatformPrincipal} from './models.js';
import type {ControlCommit} from './repository.js';
import {canonicalJson} from './policy.js';
export type SignalDiscoveryKind='PIXEL'|'DATASET';
export interface SignalDiscoveredAsset{id:string;type:SignalDiscoveryKind;parents:AssetRef[];name?:string}
export interface SignalDiscoveryProposal{id:string;tenantId:string;clientId:string;actorId:string;appId:string;metaAppUserId:string;connectionId:string;accountKey:string;businessKey:string;kind:SignalDiscoveryKind;checkedAt:number;expiresAt:number;consumedAt:number|null;approvedBy:string|null;encryptedPlan:EncryptedPayload}
export interface SignalDiscoveryPlan{version:1;kind:SignalDiscoveryKind;accountId:string;businessId:string;rows:SignalDiscoveredAsset[];source:string;expected:ControlCommit['expected']}
export interface SignalDiscoveryControlProof{readonly kind:'SERVER_SIGNAL_ASSET_DISCOVERY'}
export interface SignalDiscoveryReadCheckpoint{tenantId:string;principal:PlatformPrincipal;proposalId:string;expected:ControlCommit['expected'];proof:SignalDiscoveryControlProof}
export function signalDiscoveryPlanHash(plan:SignalDiscoveryPlan){return createHash('sha256').update(canonicalJson(plan)).digest('hex');}
function aad(p:Omit<SignalDiscoveryProposal,'encryptedPlan'>){return canonicalJson({purpose:'lumin-signal-asset-discovery',version:1,id:p.id,tenantId:p.tenantId,clientId:p.clientId,actorId:p.actorId,appId:p.appId,metaAppUserId:p.metaAppUserId,connectionId:p.connectionId,accountKey:p.accountKey,businessKey:p.businessKey,kind:p.kind,checkedAt:p.checkedAt,expiresAt:p.expiresAt});}
export function encryptSignalDiscoveryPlan(identity:Omit<SignalDiscoveryProposal,'encryptedPlan'>,plan:SignalDiscoveryPlan):SignalDiscoveryProposal{const text=canonicalJson(plan);if(text.length>131072||!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??''))throw new PlatformDenied('SIGNAL_DISCOVERY_ENCRYPTION_BOUND_REQUIRED');return {...identity,encryptedPlan:encryptToken(text,aad(identity))};}
export function decryptSignalDiscoveryPlan(p:SignalDiscoveryProposal):SignalDiscoveryPlan{try{const plan=JSON.parse(decryptToken(p.encryptedPlan,aad(p))) as SignalDiscoveryPlan;if(plan.version!==1||plan.kind!==p.kind||!Array.isArray(plan.rows)||plan.rows.length<1||plan.rows.length>20||!Array.isArray(plan.expected)||plan.expected.length>100||new Set(plan.expected.map(e=>e.collection+':'+e.id)).size!==plan.expected.length)throw Error();return plan;}catch{throw new PlatformDenied('SIGNAL_DISCOVERY_ENCRYPTED_BINDING_INVALID');}}
