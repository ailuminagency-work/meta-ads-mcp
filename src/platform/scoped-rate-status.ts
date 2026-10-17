import {z} from "zod";
import {PlatformDenied} from "./models.js";
const number=z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Shared app/business buckets and raw cache keys never leave this projection. */
export function scopedRateStatus(snapshot:unknown,tokenHash:string,accountIds:string[]):unknown{
 const value=z.object({usage:z.array(z.unknown()).max(10000),circuits:z.array(z.unknown()).max(10000),writePacer:z.array(z.unknown()).max(10000)}).parse(snapshot);
 if(!/^[a-f0-9]{12}$/.test(tokenHash)||!accountIds.length||accountIds.length>100)throw new PlatformDenied("RATE_STATUS_AUTHORIZED_SCOPE_REQUIRED");
 const ids=new Set(accountIds.map(id=>`act_${id.replace(/^act_/,"")}`));
 const accountFor=(raw:unknown,kind:string):string|undefined=>{if(typeof raw!=="string")return;const parts=raw.split(":");if(kind==="circuit"||kind==="pacer"){if(parts[0]!==tokenHash||!(kind==="pacer"?parts.length===2:parts.length===2||parts.length===3))return;return ids.has(parts[1])?parts[1]:undefined;}if(parts[0]!==kind||parts[1]!==tokenHash)return;const position=kind==="insights"&&parts[2]==="acc"?3:["acc","reach","local_retry"].includes(kind)?2:-1;if(position<0||!ids.has(parts[position])||parts.length!==(kind==="local_retry"?4:position+1))return;return parts[position];};
 const row=(raw:unknown):Record<string,unknown>=>raw&&typeof raw==="object"&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 const usage=value.usage.flatMap(raw=>{const r=row(raw),kind=String(r.kind),account=accountFor(r.key,kind);if(!account)return [];const parsed=z.object({callCount:number,cpuTime:number,totalTime:number,estimatedTimeToRegainAccessMs:number,updatedAt:number}).parse(r);return [{kind,account_id:account,...parsed}];});
 const circuits=value.circuits.flatMap(raw=>{const r=row(raw),account=accountFor(r.key,"circuit");if(!account)return [];return [{account_id:account,...z.object({openUntil:number,reason:z.enum(["abuse_signal","retry_after_hint","repeated_throttle","temporary_block"]),tripCount:number}).parse(r)}];});
 const writePacer=value.writePacer.flatMap(raw=>{const r=row(raw),account=accountFor(r.key,"pacer");if(!account)return [];return [{account_id:account,...z.object({tokens:number,capacity:number,rateRps:number}).parse(r)}];});
 return {usage:usage.slice(0,200),circuits:circuits.slice(0,200),write_pacer:writePacer.slice(0,200),truncated:usage.length>200||circuits.length>200||writePacer.length>200,process_local_only:true,shared_global_buckets_withheld:true,provider_access_tier:"NOT_ESTABLISHED",limitations:"Only this authorized client's account-scoped observations for the selected connection are shown. Missing cache rows do not establish zero provider usage or quota availability."};
}
