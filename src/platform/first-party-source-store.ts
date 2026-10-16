import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { z } from "zod";
import { encryptToken, decryptToken, type EncryptedPayload } from "../auth/crypto.js";
import { PlatformDenied } from "./models.js";
import { canonicalJson } from "./policy.js";
import { firstPartySignalDigest, prepareFirstPartySignal, type SignalEvidence } from "./signals.js";
import type { FirstPartySignalScope, TrustedFirstPartySourceResolver } from "./signals-dispatch.js";

const DAY=86400000,MAX_PAYLOAD=65536;
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const scopeSchema=z.object({tenantId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),clientId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),datasetId:z.string().regex(/^[0-9]{1,100}$/)}).strict();
const reference=z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
const evidenceSchema=z.object({tenantId:z.string(),clientId:z.string(),datasetId:z.string(),payloadDigest:z.string().regex(/^[a-f0-9]{64}$/),sourceReference:reference,consentReference:reference,eventId:z.string(),eventTime:z.number().int().positive(),eventName:z.string(),authorized:z.boolean(),expiresAt:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
export interface FirstPartySourceRecord {id:string;version:1;scopeHash:string;sourceHash:string;consentHash:string;adapterHash:string;payloadDigest:string;authorized:boolean;expiresAt:number;createdAt:number;updatedAt:number;encrypted:EncryptedPayload}
export interface FirstPartySourceAudit {id:string;recordId:string;scopeHash:string;sourceHash:string;consentHash:string;adapterHash:string;payloadDigest:string;event:"INGESTED"|"REVOKED";timestamp:number;expiresAt:number}
export interface FirstPartySourceTransaction {get(id:string):Promise<FirstPartySourceRecord|null>;create(record:FirstPartySourceRecord):void;set(record:FirstPartySourceRecord):void;audit(audit:FirstPartySourceAudit):void}
export interface FirstPartySourceStorage {get(id:string):Promise<FirstPartySourceRecord|null>;transaction<T>(run:(tx:FirstPartySourceTransaction)=>Promise<T>):Promise<T>}
function binding(scope:FirstPartySignalScope,source:string,consent:string){scopeSchema.parse(scope);reference.parse(source);reference.parse(consent);const scopeHash=hash(canonicalJson(scope)),sourceHash=hash(source),consentHash=hash(consent);return {id:hash(canonicalJson([1,scopeHash,sourceHash,consentHash])),scopeHash,sourceHash,consentHash,aad:canonicalJson(["lumin-first-party-source",1,scope.tenantId,scope.clientId,scope.datasetId,sourceHash,consentHash])};}
function boundedEnvelope(record:FirstPartySourceRecord):void {if(!record.encrypted || typeof record.encrypted.ciphertext!=="string" || record.encrypted.ciphertext.length>Math.ceil(MAX_PAYLOAD/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(record.encrypted.ciphertext) || !/^[A-Za-z0-9+/]{16}$/.test(record.encrypted.iv) || !/^[A-Za-z0-9+/]{22}==$/.test(record.encrypted.tag))throw new PlatformDenied("TRUSTED_SOURCE_ENVELOPE_INVALID_HOLD");}
/** Only a trusted private integration may invoke ingestion/revocation. This class
 * exposes no transport route or MCP tool and never manufactures source consent. */
export class TrustedFirstPartySourceStore implements TrustedFirstPartySourceResolver {
  private readonly adapterHash:string;
  constructor(private readonly storage:FirstPartySourceStorage,options:{approvedIngestionAdapterId:string;now?:()=>number}){if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(options.approvedIngestionAdapterId??""))throw new PlatformDenied("TRUSTED_SOURCE_INGESTION_ADAPTER_REQUIRED_HOLD");this.adapterHash=hash(options.approvedIngestionAdapterId);this.clock=options.now??Date.now;}
  private readonly clock:()=>number;
  private now():number{const now=this.clock();if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("INVALID_TRUSTED_SOURCE_CLOCK");return now;}
  private adapter(id:string):void{if(hash(id)!==this.adapterHash)throw new PlatformDenied("APPROVED_TRUSTED_INGESTION_ADAPTER_REQUIRED");}
  private decode(record:FirstPartySourceRecord,scope:FirstPartySignalScope,source:string,consent:string):{raw:unknown;evidence:SignalEvidence}{
    const b=binding(scope,source,consent);boundedEnvelope(record);
    if(record.version!==1 || record.id!==b.id || record.scopeHash!==b.scopeHash || record.sourceHash!==b.sourceHash || record.consentHash!==b.consentHash || record.adapterHash!==this.adapterHash || !Number.isSafeInteger(record.expiresAt) || !Number.isSafeInteger(record.createdAt) || record.createdAt<=0 || record.createdAt>this.now() || !Number.isSafeInteger(record.updatedAt) || record.updatedAt<record.createdAt || record.updatedAt>this.now() || record.expiresAt<=record.createdAt || record.expiresAt>record.createdAt+7*DAY)throw new PlatformDenied("TRUSTED_SOURCE_BINDING_INVALID_HOLD");
    const plaintext=decryptToken(record.encrypted,b.aad);if(Buffer.byteLength(plaintext)>MAX_PAYLOAD)throw new PlatformDenied("TRUSTED_SOURCE_ENVELOPE_INVALID_HOLD");
    const decoded=z.object({raw:z.unknown(),evidence:evidenceSchema}).strict().parse(JSON.parse(plaintext));
    if(decoded.evidence.authorized!==record.authorized || decoded.evidence.expiresAt!==record.expiresAt || decoded.evidence.payloadDigest!==record.payloadDigest || firstPartySignalDigest(decoded.raw)!==record.payloadDigest || canonicalJson({tenantId:decoded.evidence.tenantId,clientId:decoded.evidence.clientId,datasetId:decoded.evidence.datasetId})!==canonicalJson(scope) || decoded.evidence.sourceReference!==source || decoded.evidence.consentReference!==consent)throw new PlatformDenied("TRUSTED_SOURCE_BINDING_INVALID_HOLD");
    return decoded;
  }
  async ingestVerified(adapterId:string,scopeInput:FirstPartySignalScope,rawInput:unknown,evidenceInput:SignalEvidence):Promise<string>{
    this.adapter(adapterId);const scope=scopeSchema.parse(structuredClone(scopeInput)),raw=structuredClone(rawInput),evidence=evidenceSchema.parse(structuredClone(evidenceInput)),now=this.now();
    if(evidence.authorized!==true || evidence.expiresAt<=now || evidence.expiresAt>now+7*DAY)throw new PlatformDenied("TRUSTED_SOURCE_RETENTION_OR_CONSENT_INVALID");
    await prepareFirstPartySignal(raw,scope,{resolve:async()=>evidence},now);
    const b=binding(scope,evidence.sourceReference,evidence.consentReference),plaintext=canonicalJson({raw,evidence});if(Buffer.byteLength(plaintext)>MAX_PAYLOAD)throw new PlatformDenied("TRUSTED_SOURCE_PAYLOAD_TOO_LARGE");
    const record:FirstPartySourceRecord={...{id:b.id,scopeHash:b.scopeHash,sourceHash:b.sourceHash,consentHash:b.consentHash},version:1,adapterHash:this.adapterHash,payloadDigest:evidence.payloadDigest,authorized:true,expiresAt:evidence.expiresAt,createdAt:now,updatedAt:now,encrypted:encryptToken(plaintext,b.aad)};
    try{return await this.storage.transaction(async tx=>{const existing=await tx.get(b.id);if(evidence.expiresAt<=this.now())throw new PlatformDenied("TRUSTED_SOURCE_EXPIRED_AT_COMMIT");if(existing){const decoded=this.decode(existing,scope,evidence.sourceReference,evidence.consentReference);if(!existing.authorized || existing.expiresAt<=this.now() || canonicalJson(decoded)!==plaintext)throw new PlatformDenied("TRUSTED_SOURCE_CONFLICT_OR_REVOKED");return b.id;}tx.create(record);tx.audit(this.audit(record,"INGESTED",now));return b.id;});}catch(error){if(error instanceof PlatformDenied)throw error;throw new PlatformDenied("TRUSTED_SOURCE_STORAGE_UNAVAILABLE_HOLD");}
  }
  private audit(record:FirstPartySourceRecord,event:FirstPartySourceAudit["event"],now:number):FirstPartySourceAudit{return {id:hash(randomUUID()),recordId:record.id,scopeHash:record.scopeHash,sourceHash:record.sourceHash,consentHash:record.consentHash,adapterHash:record.adapterHash,payloadDigest:record.payloadDigest,event,timestamp:now,expiresAt:now+90*DAY};}
  async resolve(scopeInput:FirstPartySignalScope,source:string,consent:string):Promise<{raw:unknown;evidence:SignalEvidence}|null>{
    const scope=scopeSchema.parse(structuredClone(scopeInput)),b=binding(scope,source,consent);
    try{const record=await this.storage.get(b.id);if(!record || !record.authorized || record.expiresAt<=this.now())return null;const decoded=this.decode(record,scope,source,consent);await prepareFirstPartySignal(decoded.raw,scope,{resolve:async()=>decoded.evidence},this.now());if(record.expiresAt<=this.now())return null;return structuredClone(decoded);}catch(error){if(error instanceof PlatformDenied)throw error;throw new PlatformDenied("TRUSTED_SOURCE_STORAGE_OR_INTEGRITY_HOLD");}
  }
  async revokeVerified(adapterId:string,scopeInput:FirstPartySignalScope,source:string,consent:string):Promise<boolean>{
    this.adapter(adapterId);const scope=scopeSchema.parse(structuredClone(scopeInput)),b=binding(scope,source,consent);
    try{return await this.storage.transaction(async tx=>{const record=await tx.get(b.id);if(!record)return false;const decoded=this.decode(record,scope,source,consent);if(!record.authorized)return false;const now=this.now(),evidence={...decoded.evidence,authorized:false},updated={...record,authorized:false,updatedAt:now,encrypted:encryptToken(canonicalJson({raw:decoded.raw,evidence}),b.aad)};tx.set(updated);tx.audit(this.audit(updated,"REVOKED",now));return true;});}catch(error){if(error instanceof PlatformDenied)throw error;throw new PlatformDenied("TRUSTED_SOURCE_STORAGE_UNAVAILABLE_HOLD");}
  }
}
export class InMemoryFirstPartySourceStorage implements FirstPartySourceStorage {
  readonly records=new Map<string,FirstPartySourceRecord>();readonly audits:FirstPartySourceAudit[]=[];
  private tail:Promise<unknown>=Promise.resolve();
  async get(id:string):Promise<FirstPartySourceRecord|null>{return structuredClone(this.records.get(id)??null);}
  async transaction<T>(run:(tx:FirstPartySourceTransaction)=>Promise<T>):Promise<T>{const work=this.tail.then(async()=>{const writes=new Map<string,FirstPartySourceRecord>(),audits:FirstPartySourceAudit[]=[];const result=await run({get:async id=>structuredClone(writes.get(id)??this.records.get(id)??null),create:r=>{if(this.records.has(r.id)||writes.has(r.id))throw new Error("conflict");writes.set(r.id,structuredClone(r));},set:r=>{writes.set(r.id,structuredClone(r));},audit:a=>{audits.push(structuredClone(a));}});for(const [id,r]of writes)this.records.set(id,r);this.audits.push(...audits);return result;});this.tail=work.catch(()=>undefined);return work;}
}
export class FirestoreFirstPartySourceStorage implements FirstPartySourceStorage {
  constructor(private readonly db:Firestore){}
  private ref(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw new PlatformDenied("TRUSTED_SOURCE_RECORD_ID_INVALID");return this.db.collection("platform_first_party_sources").doc(id);}
  private row(data:Record<string,unknown>):FirstPartySourceRecord{const {expireTime:ignored,...row}=data;void ignored;return row as unknown as FirstPartySourceRecord;}
  async get(id:string):Promise<FirstPartySourceRecord|null>{const snap=await this.ref(id).get();return snap.exists?this.row(snap.data()!):null;}
  async transaction<T>(run:(tx:FirstPartySourceTransaction)=>Promise<T>):Promise<T>{return this.db.runTransaction(async tx=>run({get:async id=>{const snap=await tx.get(this.ref(id));return snap.exists?this.row(snap.data()!):null;},create:r=>{tx.create(this.ref(r.id),{...r,expireTime:new Date(r.expiresAt)});},set:r=>{tx.set(this.ref(r.id),{...r,expireTime:new Date(r.expiresAt)});},audit:a=>{tx.create(this.db.collection("platform_first_party_source_audit").doc(a.id),{...a,expireTime:new Date(a.expiresAt)});}}));}
}
export function createFirestoreFirstPartySourceResolver(db:Firestore,options:{approvedIngestionAdapterId:string;now?:()=>number}):TrustedFirstPartySourceStore{return new TrustedFirstPartySourceStore(new FirestoreFirstPartySourceStorage(db),options);}
