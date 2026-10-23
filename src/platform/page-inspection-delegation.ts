import {encryptToken,decryptToken,type EncryptedPayload} from "../auth/crypto.js";
import {canonicalJson} from "./policy.js";
import {PlatformDenied} from "./models.js";
import type {ControlCommit} from "./repository.js";
export interface PageInspectionDelegation {
 id:string;purpose:"PAGE_TASK_INSPECTION";tenantId:string;clientId:string;operatorId:string;appId:string;
 provider:"META_MARKETING"|"META_FACEBOOK_PAGES"|"META_MESSENGER"|"META_INSTAGRAM_FACEBOOK_LOGIN";profileId:string;profileHash:string;connectionId:string;pageIds:string[];
 userSubjectId:string;scopes:string[];checkedAt:number;expiresAt:number;revokedAt:number|null;
 envelopeVersion:1;keyVersion:"primary";payload:EncryptedPayload;
}
export type PageInspectionBinding=Pick<PageInspectionDelegation,"tenantId"|"clientId"|"operatorId"|"appId"|"connectionId">&{pageId:string};
export function pageInspectionDelegationMetadata(record:PageInspectionDelegation):Omit<PageInspectionDelegation,"payload"> {const{payload:ignored,...metadata}=record;void ignored;return metadata;}
function identity(record:PageInspectionDelegation):string {return canonicalJson(pageInspectionDelegationMetadata(record));}
function valid(record:PageInspectionDelegation,now:number):void {
 if(record.purpose!=="PAGE_TASK_INSPECTION"||!["META_MARKETING","META_FACEBOOK_PAGES","META_MESSENGER","META_INSTAGRAM_FACEBOOK_LOGIN"].includes(record.provider)||record.envelopeVersion!==1||record.keyVersion!=="primary"||record.revokedAt!==null||record.userSubjectId!==record.operatorId||!/^\d{1,100}$/.test(record.userSubjectId)||!record.id||!record.tenantId||!record.clientId||!record.connectionId||!record.profileId||!/^[a-f0-9]{64}$/.test(record.profileHash)||!/^\d{1,100}$/.test(record.appId)||record.pageIds.length!==1||!/^\d{1,100}$/.test(record.pageIds[0])||!Array.isArray(record.scopes)||record.scopes.length<1||record.scopes.length>100||record.scopes.some(scope=>typeof scope!=="string"||!/^[a-z][a-z0-9_]{0,100}$/.test(scope))||new Set(record.scopes).size!==record.scopes.length||!record.scopes.includes("pages_show_list")||!Number.isSafeInteger(record.checkedAt)||record.checkedAt<=0||record.checkedAt>now||!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=now)throw new PlatformDenied("PAGE_INSPECTION_DELEGATION_INVALID_OR_EXPIRED");
}
export function encryptPageInspectionDelegation(metadata:Omit<PageInspectionDelegation,"payload">,token:string,now=Date.now()):PageInspectionDelegation {
 const record={...structuredClone(metadata),payload:{ciphertext:"",iv:"",tag:""}};valid(record,now);if(!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??"")||!token||token.length>16384||/[\s\x00-\x1f\x7f]/.test(token))throw new PlatformDenied("PAGE_INSPECTION_ENCRYPTION_REQUIRED");record.payload=encryptToken(token,identity(record));return record;
}
/** Internal fixed inspector only. This record is not an ordinary selectable Credential. */
export function decryptPageInspectionDelegation(record:PageInspectionDelegation,binding:PageInspectionBinding,now=Date.now()):string {
 valid(record,now);if(record.tenantId!==binding.tenantId||record.clientId!==binding.clientId||record.operatorId!==binding.operatorId||record.appId!==binding.appId||record.connectionId!==binding.connectionId||record.pageIds[0]!==binding.pageId||!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("PAGE_INSPECTION_DELEGATION_BINDING_INVALID");try{return decryptToken(record.payload,identity(record));}catch{throw new PlatformDenied("PAGE_INSPECTION_DELEGATION_BINDING_INVALID");}
}
export function validatePageInspectionEnrollment(input:ControlCommit):void {
 const records=input.writes.filter(w=>w.collection==="pageInspectionDelegations"),connections=input.writes.filter(w=>w.collection==="connections");
 if(input.audit.event!=="CONNECTION_ENROLLED"){if(records.length)throw new PlatformDenied("PAGE_INSPECTION_ENROLLMENT_REQUIRED");return;}
 for(const write of records){const record=write.value as PageInspectionDelegation,connection=connections.find(w=>w.id===record.connectionId)?.value as import("./models.js").Connection|undefined,clientText=input.expected.find(e=>e.collection==="clients"&&e.id===record.clientId)?.canonical,client=clientText?JSON.parse(clientText):null;
  valid(record,Date.now());if(!write.createOnly||write.id!==record.id||!connection||connection.pageInspectionDelegationId!==record.id||connection.provider!==record.provider||connection.tokenType!=="page"||connection.tenantId!==record.tenantId||connection.operatorId!==record.operatorId||connection.appId!==record.appId||connection.subjectId!==record.pageIds[0]||connection.metaAppUserId!==undefined&&connection.metaAppUserId!==record.userSubjectId||record.tenantId!==input.tenantId||record.clientId!==input.audit.clientId||record.operatorId!==input.audit.actorId||record.checkedAt<Date.now()-300000||connection.expiresAt===null||record.expiresAt>connection.expiresAt||!client||client.tenantId!==record.tenantId||client.status!=="ACTIVE")throw new PlatformDenied("PAGE_INSPECTION_ENROLLMENT_BINDING_INVALID");
  const page=input.expected.filter(e=>e.collection==="assets").map(e=>JSON.parse(e.canonical)).find(a=>a.type==="PAGE"&&a.id===record.pageIds[0]);if(!page||page.tenantId!==record.tenantId||page.clientId!==record.clientId||page.appId!==record.appId||page.provider!==record.provider||!connection.assetKeys.includes(page.key))throw new PlatformDenied("PAGE_INSPECTION_REGISTERED_PAGE_REQUIRED");
  decryptPageInspectionDelegation(record,{tenantId:record.tenantId,clientId:record.clientId,operatorId:record.operatorId,appId:record.appId,connectionId:record.connectionId,pageId:record.pageIds[0]});
 }
 for(const write of connections){const connection=write.value as import("./models.js").Connection;if(connection.pageInspectionDelegationId&&!records.some(r=>r.id===connection.pageInspectionDelegationId))throw new PlatformDenied("PAGE_INSPECTION_ATOMIC_ENROLLMENT_REQUIRED");}
}
