import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { z } from "zod";
import { PlatformDenied } from "./models.js";
import { canonicalJson } from "./policy.js";
import { firstPartySignalDigest, prepareFirstPartySignal, type PreparedSignal, type SignalEvidence } from "./signals.js";

export interface FirstPartySignalScope {tenantId:string;clientId:string;datasetId:string}
export interface TrustedFirstPartySourceResolver {
  /** Internal first-party adapter, never model supplied raw events or PII. */
  resolve(scope:FirstPartySignalScope,sourceReference:string,consentReference:string):Promise<{raw:unknown;evidence:SignalEvidence}|null>;
}
export type SignalDispatchState="CLAIMED"|"ATTEMPTED"|"ACCEPTED"|"UNKNOWN"|"REJECTED";
export interface SignalDispatchCheckpoint {id:string;scopeHash:string;payloadDigest:string;sourceHash:string;consentHash:string;state:SignalDispatchState;createdAt:number;updatedAt:number}
export interface SignalDispatchStore {
  claim(record:SignalDispatchCheckpoint):Promise<{created:boolean;state:SignalDispatchState}>;
  transition(id:string,scopeHash:string,from:SignalDispatchState,to:SignalDispatchState,now:number):Promise<void>;
  get(id:string,scopeHash:string):Promise<SignalDispatchCheckpoint|null>;
}
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const scoped=(scope:FirstPartySignalScope)=>hash(JSON.stringify([scope.tenantId,scope.clientId,scope.datasetId]));
const RETENTION_MS=90*86400000;
function expiry(record:SignalDispatchCheckpoint):number{const expiresAt=record.createdAt+RETENTION_MS;if(!Number.isSafeInteger(record.createdAt)||record.createdAt<=0||expiresAt>8640000000000000||!Number.isSafeInteger(record.updatedAt)||record.updatedAt<record.createdAt||record.updatedAt>=expiresAt)throw new PlatformDenied("SIGNAL_CHECKPOINT_RETENTION_INVALID_HOLD");return expiresAt;}
function retained(record:SignalDispatchCheckpoint,now=Date.now()):void{if(!Number.isFinite(now)||expiry(record)<=now)throw new PlatformDenied("SIGNAL_CHECKPOINT_EXPIRED_RECONCILIATION_HOLD");}
function checkpoint(data:Record<string,unknown>):SignalDispatchCheckpoint{const {expireTime:ignored,...record}=data;void ignored;return record as unknown as SignalDispatchCheckpoint;}
const inputSchema=z.object({source_reference:z.string().min(1).max(200),consent_reference:z.string().min(1).max(200)}).strict();
function validate(record:SignalDispatchCheckpoint):void {
  retained(record);
  if([record.id,record.scopeHash,record.payloadDigest,record.sourceHash,record.consentHash].some(v=>!/^[a-f0-9]{64}$/.test(v)) || record.state!=="CLAIMED" || !Number.isFinite(record.createdAt) || record.createdAt<=0 || record.updatedAt!==record.createdAt)throw new PlatformDenied("SIGNAL_CHECKPOINT_INVALID");
}
function existingState(record:SignalDispatchCheckpoint,existing:SignalDispatchCheckpoint):SignalDispatchState {
  retained(existing,Math.max(Date.now(),record.createdAt));
  if(existing.scopeHash!==record.scopeHash || existing.payloadDigest!==record.payloadDigest || existing.sourceHash!==record.sourceHash || existing.consentHash!==record.consentHash)throw new PlatformDenied("SIGNAL_DEDUPLICATION_CONFLICT");
  return existing.state;
}
function checkTransition(record:SignalDispatchCheckpoint|null,scopeHash:string,from:SignalDispatchState,to:SignalDispatchState,now:number):void {
  if(record)retained(record,Math.max(Date.now(),now));
  if(!record || record.scopeHash!==scopeHash || record.state!==from || !Number.isFinite(now) || now<record.updatedAt || !((from==="CLAIMED" && to==="ATTEMPTED") || (from==="ATTEMPTED" && ["ACCEPTED","UNKNOWN","REJECTED"].includes(to))))throw new PlatformDenied("SIGNAL_CHECKPOINT_TRANSITION_DENIED");
}
export class InMemorySignalDispatchStore implements SignalDispatchStore {
  private readonly records=new Map<string,SignalDispatchCheckpoint>();readonly audit:Array<{id:string;scopeHash:string;state:SignalDispatchState;timestamp:number;expireTime:Date}>=[];
  async get(id:string,scopeHash:string):Promise<SignalDispatchCheckpoint|null>{const r=this.records.get(id);if(r?.scopeHash!==scopeHash)return null;retained(r);return structuredClone(r);}
  async claim(record:SignalDispatchCheckpoint):Promise<{created:boolean;state:SignalDispatchState}>{validate(record);const existing=this.records.get(record.id);if(existing)return {created:false,state:existingState(record,existing)};this.records.set(record.id,structuredClone(record));this.audit.push({id:record.id,scopeHash:record.scopeHash,state:"CLAIMED",timestamp:record.createdAt,expireTime:new Date(expiry(record))});return {created:true,state:"CLAIMED"};}
  async transition(id:string,scopeHash:string,from:SignalDispatchState,to:SignalDispatchState,now:number):Promise<void>{const r=this.records.get(id)??null;checkTransition(r,scopeHash,from,to,now);this.records.set(id,{...r!,state:to,updatedAt:now});this.audit.push({id,scopeHash,state:to,timestamp:now,expireTime:new Date(expiry(r!))});}
}
export class FirestoreSignalDispatchStore implements SignalDispatchStore {
  constructor(private readonly db:Firestore){}
  async get(id:string,scopeHash:string):Promise<SignalDispatchCheckpoint|null>{const snap=await this.db.collection("platform_signal_dispatch").doc(id).get();const r=snap.exists?checkpoint(snap.data()!):null;if(r?.scopeHash!==scopeHash)return null;retained(r);return r;}
  async claim(record:SignalDispatchCheckpoint):Promise<{created:boolean;state:SignalDispatchState}>{validate(record);return this.db.runTransaction(async tx=>{const ref=this.db.collection("platform_signal_dispatch").doc(record.id),snap=await tx.get(ref);retained(record);if(snap.exists)return {created:false,state:existingState(record,checkpoint(snap.data()!))};tx.create(ref,{...record,expireTime:new Date(expiry(record))});tx.create(this.db.collection("platform_signal_dispatch_audit").doc(`${record.id}-CLAIMED`),{id:record.id,scopeHash:record.scopeHash,state:"CLAIMED",timestamp:record.createdAt,expireTime:new Date(expiry(record))});return {created:true,state:"CLAIMED"};});}
  async transition(id:string,scopeHash:string,from:SignalDispatchState,to:SignalDispatchState,now:number):Promise<void>{await this.db.runTransaction(async tx=>{const ref=this.db.collection("platform_signal_dispatch").doc(id),snap=await tx.get(ref),r=snap.exists?checkpoint(snap.data()!):null;checkTransition(r,scopeHash,from,to,now);tx.set(ref,{...r!,state:to,updatedAt:now,expireTime:new Date(expiry(r!))});tx.create(this.db.collection("platform_signal_dispatch_audit").doc(`${id}-${to}`),{id,scopeHash,state:to,timestamp:now,expireTime:new Date(expiry(r!))});});}
}
export interface GuardedSignalTransport {
  /** Implementation must revalidate an execution permit and exact client dataset/Pixel mapping before egress. No retries. */
  send(scope:FirstPartySignalScope,event:Record<string,unknown>,prepared:PreparedSignal):Promise<{eventsReceived:number}>;
}
export class FirstPartySignalDispatcher {
  constructor(private readonly source:TrustedFirstPartySourceResolver,private readonly store:SignalDispatchStore,private readonly transport:GuardedSignalTransport,private readonly clock:()=>number=Date.now){}
  async dispatch(scope:FirstPartySignalScope,rawInput:unknown):Promise<{state:SignalDispatchState;checkpoint:string;duplicate:boolean}> {
    const parsed=inputSchema.safeParse(rawInput);if(!parsed.success)throw new PlatformDenied("SIGNAL_REFERENCES_ONLY");
    if(!scope.tenantId || !scope.clientId || !/^[0-9]+$/.test(scope.datasetId))throw new PlatformDenied("SIGNAL_SCOPE_REQUIRED");
    const input=parsed.data,resolved=await this.source.resolve(scope,input.source_reference,input.consent_reference);
    if(!resolved)throw new PlatformDenied("TRUSTED_FIRST_PARTY_SOURCE_REQUIRED");
    const prepared=await prepareFirstPartySignal(resolved.raw,scope,{resolve:async(source,consent)=>{
      if(source!==input.source_reference || consent!==input.consent_reference)return null;
      const fresh=await this.source.resolve(scope,source,consent);
      if(!fresh || firstPartySignalDigest(fresh.raw)!==fresh.evidence.payloadDigest)return null;
      return fresh.evidence;
    }},this.clock());
    if(prepared.sourceReference!==input.source_reference || prepared.consentReference!==input.consent_reference)throw new PlatformDenied("SIGNAL_SOURCE_REFERENCE_MISMATCH");
    const createdAt=this.clock();
    const record:SignalDispatchCheckpoint={id:prepared.deduplicationKey,scopeHash:scoped(scope),payloadDigest:hash(canonicalJson(prepared.event)),sourceHash:hash(input.source_reference),consentHash:hash(input.consent_reference),state:"CLAIMED",createdAt,updatedAt:createdAt};
    const claimed=await this.store.claim(record);
    // A previously CLAIMED record is also terminal for automatic execution: it may belong to a crashed worker.
    if(!claimed.created)return {state:claimed.state,checkpoint:record.id,duplicate:true};
    // Atomically winning this transition is the only right to make the single transport attempt.
    await this.store.transition(record.id,record.scopeHash,"CLAIMED","ATTEMPTED",this.clock());
    let result:{eventsReceived:number};
    try {result=await this.transport.send(scope,prepared.event,prepared);}catch {
      try{await this.store.transition(record.id,record.scopeHash,"ATTEMPTED","UNKNOWN",this.clock());}catch{throw new PlatformDenied("SIGNAL_DURABLE_COMPLETION_PENDING");}
      return {state:"UNKNOWN",checkpoint:record.id,duplicate:false};
    }
    const state:SignalDispatchState=Number.isInteger(result?.eventsReceived) && result.eventsReceived===1?"ACCEPTED":"UNKNOWN";
    try{await this.store.transition(record.id,record.scopeHash,"ATTEMPTED",state,this.clock());}catch{throw new PlatformDenied("SIGNAL_DURABLE_COMPLETION_PENDING");}
    return {state,checkpoint:record.id,duplicate:false};
  }
}
