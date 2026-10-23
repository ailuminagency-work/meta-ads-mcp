import {z} from "zod";
import {PlatformDenied} from "./models.js";
import type {ProductContract} from "./products/contracts.js";
export const THREADS_DISCOVERY_TOOLS=Object.freeze(["threads_keyword_search","threads_get_mentions"]);
export const THREADS_DISCOVERY_QUERY=Object.freeze({fields:"id,media_type,timestamp",maximumRows:100,authority:"PUBLIC_DISCOVERY_NO_GRANT"});
export const THREADS_DISCOVERY_CONTRACTS:ProductContract[]=THREADS_DISCOVERY_TOOLS.map(tool=>({id:tool.replaceAll("_","."),tool,provider:"META_THREADS",product:"threads",title:tool==="threads_keyword_search"?"Search public Threads metadata":"Read public mentions of this Threads account",method:"GET",path:tool==="threads_keyword_search"?"/keyword_search":"/{asset_id}/mentions",assetType:"THREADS_ACCOUNT",operationClasses:["READ"],requiredScopes:["threads_basic",tool==="threads_keyword_search"?"threads_keyword_search":"threads_manage_mentions"],tokenTypes:["threads"],allowedInputKeys:tool==="threads_keyword_search"?["q","search_type","limit"]:["limit"],responseFields:["data.id","data.media_type","data.timestamp"],verified:true,documentation:[`https://developers.facebook.com/documentation/threads/${tool==="threads_keyword_search"?"keyword-search":"threads-mentions"}`],manualRequirements:[
 "The registered Threads account must be the exact current token subject, with current product permission consent and independent external-user App Review evidence.",
 tool==="threads_keyword_search"?"Public search requires independently verified threads_keyword_search approval. Before approval Meta restricts search to the authenticated user's posts; this public-search tool does not claim that restricted result is competitor research.":"Public mentions require independently verified Advanced Access for threads_manage_mentions. Without it only app tester mentions are returned; private users' media is excluded.",
 "Only public media ID, type and timestamp are returned. No text, usernames, links, private content, ownership enrollment, publishing authority or inferred grants are created by discovery.",
 "One bounded page per call; no automatic pagination or provider retry. Empty output is not proof of no mentions or public posts. Meta may exclude sensitive keywords. Search consumes the provider-enforced shared user quota of2200 queries per rolling24hours across apps, including repeated keywords; local rate cache cannot establish remaining global quota."
]}));
export function validateThreadsDiscoveryInput(tool:string,input:Record<string,unknown>):void{
 const common={limit:z.number().int().min(1).max(100).optional()},schema=tool==="threads_keyword_search"?z.object({...common,q:z.string().min(1).max(100).refine(v=>v.trim()===v&&!/[\x00-\x1f\x7f]/.test(v)&&Buffer.byteLength(v,"utf8")<=200),search_type:z.enum(["TOP","RECENT"]).optional()}).strict():tool==="threads_get_mentions"?z.object(common).strict():null;
 if(!schema?.safeParse(input).success)throw new PlatformDenied("THREADS_DISCOVERY_INPUT_INVALID");
}
export function normalizeThreadsDiscovery(value:unknown,limit:number):unknown{
 const row=z.object({id:z.string().regex(/^\d{1,100}$/),media_type:z.enum(["TEXT_POST","TEXT","IMAGE","VIDEO","CAROUSEL_ALBUM"]),timestamp:z.string().max(64).refine(v=>Number.isFinite(Date.parse(v)))}),parsed=z.object({data:z.array(row).max(limit),paging:z.object({next:z.unknown().optional()}).optional()}).safeParse(value);
 if(!parsed.success||new Set(parsed.data.data.map(r=>r.id)).size!==parsed.data.data.length)throw new PlatformDenied("THREADS_DISCOVERY_RESPONSE_INVALID");
 return {data:parsed.data.data,has_more:Boolean(parsed.data.paging?.next),completeness:"CURRENT_PAGE_ONLY",authority:THREADS_DISCOVERY_QUERY.authority,no_data:parsed.data.data.length===0};
}
