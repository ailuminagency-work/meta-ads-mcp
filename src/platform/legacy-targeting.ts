import {z} from "zod";
import {PlatformDenied,type AssetRef} from "./models.js";
const unique=<T>(items:T[])=>new Set(items).size===items.length;
const audience=z.object({id:z.string().regex(/^\d{1,32}$/)}).strict();
const targeting=z.object({
 geo_locations:z.object({countries:z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(10).refine(unique).optional(),cities:z.array(z.object({key:z.string().regex(/^\d{1,32}$/),radius:z.number().int().min(1).max(50).optional(),distance_unit:z.enum(["mile","kilometer"]).optional()}).strict()).min(1).max(20).optional()}).strict(),
 age_min:z.number().int().min(18).max(65).optional(),age_max:z.number().int().min(18).max(65).optional(),
 genders:z.array(z.union([z.literal(1),z.literal(2)])).min(1).max(2).refine(unique).optional(),
 custom_audiences:z.array(audience).min(1).max(20).optional(),excluded_custom_audiences:z.array(audience).min(1).max(20).optional(),
 interests:z.array(audience).min(1).max(20).optional(),
 device_platforms:z.array(z.enum(["mobile","desktop"])).min(1).max(2).refine(unique).optional(),
 publisher_platforms:z.array(z.enum(["facebook","instagram"])).min(1).max(2).refine(unique).optional(),
 facebook_positions:z.array(z.enum(["feed","story","facebook_reels"])).min(1).max(3).refine(unique).optional(),
 instagram_positions:z.array(z.enum(["stream","story","reels"])).min(1).max(3).refine(unique).optional(),
}).strict();
/** Explicit targeting subset; each private audience becomes an authorized asset.
 * Location/interest identifiers and opaque flexible specs need separate discovery
 * evidence and are deliberately not forwarded through this typed boundary. */
export function buildLegacyTargeting(value:unknown):{body:Record<string,unknown>;assets:AssetRef[]}{
 const parsed=targeting.safeParse(value);if(!parsed.success)throw new PlatformDenied("LEGACY_COMPLEX_TARGETING_HOLD");
 const data=parsed.data;
 if((!data.geo_locations.countries&&!data.geo_locations.cities)||(data.geo_locations.countries&&data.geo_locations.cities)||data.geo_locations.cities?.some(c=>(c.radius===undefined)!==(c.distance_unit===undefined))||data.geo_locations.cities&& !unique(data.geo_locations.cities.map(c=>c.key))||data.interests&&!unique(data.interests.map(i=>i.id)))throw new PlatformDenied("LEGACY_TARGETING_COMBINATION_INVALID");
 if((data.age_min??18)>(data.age_max??65)||(data.facebook_positions&&!data.publisher_platforms?.includes("facebook"))||(data.instagram_positions&&!data.publisher_platforms?.includes("instagram")))throw new PlatformDenied("LEGACY_TARGETING_COMBINATION_INVALID");
 const included=data.custom_audiences?.map(a=>a.id)??[],excluded=data.excluded_custom_audiences?.map(a=>a.id)??[];
 if(!unique(included)||!unique(excluded)||included.some(id=>excluded.includes(id)))throw new PlatformDenied("LEGACY_AUDIENCE_TARGETING_CONFLICT");
 const body:Record<string,unknown>={geo_locations:data.geo_locations.countries?{countries:[...data.geo_locations.countries].sort()}:{cities:[...data.geo_locations.cities!].sort((a,b)=>a.key.localeCompare(b.key))}};
 for(const[key,raw]of Object.entries(data)){if(key==="geo_locations"||raw===undefined)continue;body[key]=Array.isArray(raw)?[...raw].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):raw;}
 return {body,assets:[...included,...excluded].sort().map(id=>({type:"AUDIENCE",id}))};
}
