import {z} from "zod";
import {PlatformDenied} from "./models.js";
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const value=z.object({value:count,end_time:z.string().max(64).refine(v=>Number.isFinite(Date.parse(v))).optional()}).strict();
const metric=z.object({id:z.string().max(200),name:z.string().max(32),period:z.string().max(32),values:z.array(value).min(1).max(366)}).strict();
export function normalizeThreadsInsights(tool:string,targetId:string,response:unknown):unknown{
 if(!["threads_list_insights","threads_get_post_insights"].includes(tool))return response;
 const parsed=z.object({data:z.array(metric).max(5)}).strict().safeParse(response);
 if(!/^\d{1,100}$/.test(targetId)||!parsed.success)throw new PlatformDenied("THREADS_INSIGHTS_SCHEMA_INVALID");
 const account=tool==="threads_list_insights",allowed=account?["views"]:["likes","replies","reposts","quotes","shares"],period=account?"day":"lifetime",seen=new Set<string>();
 for(const row of parsed.data.data){if(!allowed.includes(row.name)||row.period!==period||row.id!==`${targetId}/insights/${row.name}/${period}`||seen.has(row.name)||!account&&row.values.length!==1||account&&row.values.some(v=>!v.end_time))throw new PlatformDenied("THREADS_INSIGHTS_IDENTITY_INVALID");seen.add(row.name);}
 return {...parsed.data,no_data:parsed.data.data.length===0,measurement:account?"PROFILE_VIEWS_DEFAULT_YESTERDAY_THROUGH_TODAY":"POST_LIFETIME_METRICS",outcome_proof:false,...(!account?{limitations:"Nested replies' metrics are not included; shares is a metric in development. An empty result is not a verified zero."}:{limitations:"Provider-default two-day window. Profile views do not establish leads, attribution or business outcomes."})};
}
