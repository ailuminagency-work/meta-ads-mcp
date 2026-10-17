import {PlatformDenied} from './models.js';
import {prepareCrmSignal,revalidatePreparedCrmSignal,assertPreparedCrmSignal,type PreparedCrmSignal,type CrmSignalScope,type CrmFunnelPack,type TrustedCrmSourceResolver} from './crm-signals.js';
import type {CrmStageJournal} from './crm-stage-journal.js';
/** The implementation must enforce the current registered Pixel execution permit,
 * exact app credential inspection and privacy/owner checks before provider egress. */
export interface CrmGuardedTransport{
 assertCurrent(scope:CrmSignalScope,prepared:PreparedCrmSignal):Promise<void>;
 send(scope:CrmSignalScope,prepared:PreparedCrmSignal):Promise<{events_received:1}>;
}
export class CrmSignalDispatcher{
 constructor(private readonly source:TrustedCrmSourceResolver,private readonly journal:CrmStageJournal,private readonly transport:CrmGuardedTransport,private readonly key:Buffer,private readonly clock:()=>number=Date.now){}
 async dispatch(scope:CrmSignalScope,pack:CrmFunnelPack,references:{source_reference:string;consent_reference:string}){
  const prepared=await prepareCrmSignal(scope,pack,references,this.source,this.key,this.clock());await this.transport.assertCurrent(scope,prepared);await revalidatePreparedCrmSignal(prepared,scope);const claim=await this.journal.claim(prepared,scope,this.clock());if(!claim.created)return {checkpoint:prepared.stageId,state:claim.state,provider_accepted_count:claim.state==='ACCEPTED'?1:null,delivery_verified:false,optimization_verified:false,retry_permitted:false};
  try{await this.transport.assertCurrent(scope,prepared);await revalidatePreparedCrmSignal(prepared,scope);assertPreparedCrmSignal(prepared,scope,this.clock());if(await this.journal.isRevoked(prepared.scopeHash,prepared.leadHash))throw new PlatformDenied('CRM_CUSTOMER_CONSENT_REVOKED');const receipt=await this.transport.send(scope,prepared);if(!receipt||Object.keys(receipt).length!==1||receipt.events_received!==1)throw new PlatformDenied('CRM_EXACT_PROVIDER_ACCEPTED_COUNT_REQUIRED');await this.transport.assertCurrent(scope,prepared);await revalidatePreparedCrmSignal(prepared,scope);await this.journal.finish(prepared,scope,'ACCEPTED',this.clock());return {checkpoint:prepared.stageId,state:'ACCEPTED' as const,provider_accepted_count:1,delivery_verified:false,optimization_verified:false,retry_permitted:false};}
  catch{try{await this.journal.finish(prepared,scope,'UNKNOWN',this.clock());}catch{/* Retain ATTEMPTED if evidence expired or cleanup raced; neither state permits resend. */}throw new PlatformDenied('CRM_STAGE_UNKNOWN_RECONCILIATION_REQUIRED');}
 }
}
