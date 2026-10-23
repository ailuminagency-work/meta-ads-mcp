import {z} from "zod";
import {PlatformDenied,type OperationPlan} from "./models.js";
import {buildStrictLegacyWritePlan} from "./legacy-write.js";
import {canonicalJson} from "./policy.js";
import {createHash} from "node:crypto";
const id=z.string().regex(/^\d{1,32}$/),name=z.string().min(1).max(128),row=z.object({name,creative_id:id,page_id:id.optional(),lead_form_id:id.optional()}).strict();
const schema=z.object({account_id:z.string().regex(/^(?:act_)?\d{1,32}$/),ad_set_id:id,ads:z.array(row).min(1).max(10)}).strict();
/** Aggregate review is a proposal only. Each step needs fresh normal approval
 * after previous atomic creation changes the connection/registry revision. */
export interface PausedAdBatchProposal{version:1;mode:"SEPARATE_FRESH_HUMAN_APPROVAL_PER_STEP";accountId:string;adsetId:string;steps:Array<{index:number;tool:"ads_create_ad";input:Record<string,unknown>;plan:OperationPlan}>;digest:string}
export function buildPausedAdBatchProposal(raw:unknown):PausedAdBatchProposal{const parsed=schema.safeParse(raw);if(!parsed.success)throw new PlatformDenied("TYPED_PAUSED_AD_BATCH_REQUIRED");const data=parsed.data;if(new Set(data.ads.map(a=>a.name)).size!==data.ads.length)throw new PlatformDenied("BATCH_DISTINCT_REVIEW_NAMES_REQUIRED");const steps=data.ads.map((ad,index)=>{const input={account_id:data.account_id.replace(/^act_/,""),ad_set_id:data.ad_set_id,...ad,status:"PAUSED"};return {index,tool:"ads_create_ad" as const,input,plan:buildStrictLegacyWritePlan("ads_create_ad",input)};}),base={version:1 as const,mode:"SEPARATE_FRESH_HUMAN_APPROVAL_PER_STEP" as const,accountId:data.account_id.replace(/^act_/,""),adsetId:data.ad_set_id,steps};return {...base,digest:createHash("sha256").update(canonicalJson(base)).digest("hex")};}
