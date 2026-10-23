import {z} from "zod";
import {PlatformDenied} from "./models.js";
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const timestamp=Date.parse(value+"T00:00:00Z");return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value;});
/** Inclusive account-calendar dates, not UTC event timestamps. The provider
 * interprets these in the account's reporting time zone. Bound query work and
 * reject competing presets rather than silently choosing one. */
export function legacyInsightRange(value:unknown,preset:unknown):string|undefined{
 if(value===undefined)return undefined;
 if(preset!==undefined)throw new PlatformDenied("LEGACY_INSIGHT_RANGE_PRESET_CONFLICT");
 const range=z.object({since:day,until:day}).strict().safeParse(value);
 if(!range.success)throw new PlatformDenied("LEGACY_INSIGHT_RANGE_INVALID");
 const start=Date.parse(range.data.since+"T00:00:00Z"),end=Date.parse(range.data.until+"T00:00:00Z");
 if(start>end||end-start>365*86400000)throw new PlatformDenied("LEGACY_INSIGHT_RANGE_BOUNDED_REQUIRED");
 return JSON.stringify(range.data);
}
