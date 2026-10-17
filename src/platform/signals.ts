import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./policy.js";
import { PlatformDenied } from "./models.js";

// First-party outcome evidence is mandatory. The MCP never invents customer
// identities, consent, event times or attribution to improve match quality.
const inputSchema=z.object({
  event_name:z.enum(["Lead","CompleteRegistration","Schedule","Purchase"]),
  event_id:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  event_time:z.number().int().positive(),
  action_source:z.enum(["website","phone_call","chat","physical_store","system_generated"]),
  source_reference:z.string().min(1).max(200),
  consent_reference:z.string().min(1).max(200),
  event_source_url:z.string().url().optional(),
  user_data:z.object({em:z.string().email().optional(),ph:z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),external_id:z.string().min(1).max(200).optional()}).strict(),
  custom_data:z.object({currency:z.string().regex(/^[A-Z]{3}$/).optional(),value:z.number().finite().nonnegative().optional()}).strict().optional(),
  data_processing_options:z.array(z.literal("LDU")).max(1).optional(),
  data_processing_options_country:z.literal(1).optional(),
  data_processing_options_state:z.number().int().min(1000).max(1013).optional(),
}).strict().superRefine((value,ctx)=>{const ldu=value.data_processing_options?.length===1,location=value.data_processing_options_country!==undefined&&value.data_processing_options_state!==undefined;if(ldu&&!location||!ldu&&(value.data_processing_options_country!==undefined||value.data_processing_options_state!==undefined))ctx.addIssue({code:"custom",message:"Trusted explicit LDU location required"});});
export type FirstPartySignalInput=z.infer<typeof inputSchema>;
export interface SignalEvidence {
  tenantId:string;clientId:string;datasetId:string;payloadDigest:string;sourceReference:string;consentReference:string;
  eventId:string;eventTime:number;eventName:string;authorized:boolean;expiresAt:number;
}
export interface SignalEvidenceResolver {resolve(sourceReference:string,consentReference:string):Promise<SignalEvidence|null>}
export interface PreparedSignal {event:Record<string,unknown>;deduplicationKey:string;sourceReference:string;consentReference:string}
const preparedSignals=new WeakMap<PreparedSignal,{scope:string;event:string;source:string;consent:string;expiresAt:number;evidence:string;authorize:()=>Promise<SignalEvidence|null>}>();
export function assertPreparedSignal(prepared:PreparedSignal,scope:{tenantId:string;clientId:string;datasetId:string}):void{const proof=preparedSignals.get(prepared);if(!proof || proof.expiresAt<=Date.now() || proof.scope!==canonicalJson(scope) || proof.event!==canonicalJson(prepared.event) || proof.source!==prepared.sourceReference || proof.consent!==prepared.consentReference)throw new PlatformDenied("TRUSTED_PREPARED_SIGNAL_REQUIRED");}
export async function revalidatePreparedSignal(prepared:PreparedSignal,scope:{tenantId:string;clientId:string;datasetId:string}):Promise<void>{assertPreparedSignal(prepared,scope);const proof=preparedSignals.get(prepared)!;const evidence=await proof.authorize();if(!evidence || evidence.authorized!==true || evidence.expiresAt<=Date.now() || canonicalJson(evidence)!==proof.evidence)throw new PlatformDenied("FIRST_PARTY_CONSENT_OR_SOURCE_CHANGED");assertPreparedSignal(prepared,scope);}
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
export function firstPartySignalDigest(raw:unknown):string{const parsed=inputSchema.safeParse(raw);if(!parsed.success)throw new PlatformDenied("INVALID_FIRST_PARTY_SIGNAL");return hash(canonicalJson(parsed.data));}
export async function prepareFirstPartySignal(raw:unknown,scope:{tenantId:string;clientId:string;datasetId:string},resolver:SignalEvidenceResolver,now=Date.now()):Promise<PreparedSignal>{
  if(!Number.isFinite(now))throw new PlatformDenied("INVALID_SIGNAL_CLOCK");
  const parsed=inputSchema.safeParse(raw);
  if(!parsed.success)throw new PlatformDenied("INVALID_FIRST_PARTY_SIGNAL");
  const input=parsed.data;
  const ldu=input.data_processing_options?.length===1,hasCountry=input.data_processing_options_country!==undefined,hasState=input.data_processing_options_state!==undefined;
  if(ldu&&(!hasCountry||!hasState)||!ldu&&(hasCountry||hasState))throw new PlatformDenied("TRUSTED_EXPLICIT_LDU_LOCATION_REQUIRED");
  // A deliberately conservative local freshness policy; not a claim that every
  // Meta product shares this API limit.
  if(input.event_time*1000>now+60000 || input.event_time*1000<now-7*86400000)throw new PlatformDenied("LUMIN_SIGNAL_TIME_POLICY");
  const evidence=await resolver.resolve(input.source_reference,input.consent_reference);
  if(!evidence || evidence.authorized!==true || !Number.isFinite(evidence.expiresAt) || evidence.expiresAt<=now || evidence.tenantId!==scope.tenantId || evidence.clientId!==scope.clientId || evidence.datasetId!==scope.datasetId || evidence.payloadDigest!==firstPartySignalDigest(input) || evidence.sourceReference!==input.source_reference || evidence.consentReference!==input.consent_reference || evidence.eventId!==input.event_id || evidence.eventTime!==input.event_time || evidence.eventName!==input.event_name)throw new PlatformDenied("VERIFIED_FIRST_PARTY_CONSENT_AND_SOURCE_REQUIRED");
  if(input.action_source==="website" && !input.event_source_url)throw new PlatformDenied("WEBSITE_SOURCE_URL_REQUIRED");
  if(input.event_source_url){const url=new URL(input.event_source_url);if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash)throw new PlatformDenied("LUMIN_SOURCE_URL_PRIVACY_POLICY");}
  if(input.event_name==="Purchase" && (!input.custom_data?.currency || input.custom_data.value===undefined))throw new PlatformDenied("PURCHASE_VALUE_AND_CURRENCY_REQUIRED");
  const user:Record<string,unknown>={};
  if(input.user_data.em)user.em=[hash(input.user_data.em.trim().toLowerCase())];
  if(input.user_data.ph)user.ph=[hash(input.user_data.ph.slice(1))];
  if(input.user_data.external_id)user.external_id=[hash(input.user_data.external_id)];
  if(!Object.keys(user).length)throw new PlatformDenied("FIRST_PARTY_MATCH_DATA_REQUIRED");
  const prepared:PreparedSignal={event:{event_name:input.event_name,event_id:input.event_id,event_time:input.event_time,action_source:input.action_source,user_data:user,...(input.event_source_url?{event_source_url:input.event_source_url}:{}),...(input.custom_data?{custom_data:input.custom_data}:{}),...(input.data_processing_options!==undefined?{data_processing_options:input.data_processing_options}:{}),...(ldu?{data_processing_options_country:input.data_processing_options_country,data_processing_options_state:input.data_processing_options_state}:{})},deduplicationKey:hash(JSON.stringify([scope.tenantId,scope.clientId,scope.datasetId,input.event_name,input.event_id])),sourceReference:input.source_reference,consentReference:input.consent_reference};
  preparedSignals.set(prepared,{scope:canonicalJson(scope),event:canonicalJson(prepared.event),source:prepared.sourceReference,consent:prepared.consentReference,expiresAt:evidence.expiresAt,evidence:canonicalJson(evidence),authorize:()=>resolver.resolve(input.source_reference,input.consent_reference)});
  return prepared;
}
