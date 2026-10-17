import {PlatformDenied,type MetaAsset,type OperationPlan,type Connection} from "./models.js";
import {canonicalJson} from "./policy.js";
import type {Preparation} from "./repository.js";
export function repointIntent(plan:OperationPlan):{adId:string;oldCreativeId:string;newCreativeId:string}|undefined{
 if(plan.parameters.expected_original_creative_id===undefined)return;
 const step=plan.parameters.legacy_write_step as {path?:unknown;body?:Record<string,unknown>}|undefined,old=plan.parameters.expected_original_creative_id,creative=step?.body?.creative as {creative_id?:unknown}|undefined;
 if(plan.capability!=="legacy.ads_update_ad"||typeof step?.path!=="string"||!/^\/[0-9]{1,32}$/.test(step.path)||typeof old!=="string"||!/^\d{1,32}$/.test(old)||!creative||typeof creative.creative_id!=="string"||!/^\d{1,32}$/.test(creative.creative_id)||creative.creative_id===old||canonicalJson(step.body)!==canonicalJson({status:"PAUSED",creative:{creative_id:creative.creative_id}}))throw new PlatformDenied("CREATIVE_REPOINT_EXACT_PLAN_REQUIRED");
 return {adId:step.path.slice(1),oldCreativeId:old,newCreativeId:creative.creative_id};
}
export function buildRepointClaim(plan:OperationPlan,assets:MetaAsset[],operationId:string,now:number):Preparation["creativeRepointClaim"]{
 const intent=repointIntent(plan);if(!intent)return;
 if(!Number.isSafeInteger(now)||now<=0||!/^[A-Za-z0-9_-]{1,128}$/.test(operationId))throw new PlatformDenied("CREATIVE_REPOINT_CLAIM_CLOCK_INVALID");
 const before=assets.find(a=>a.type==="AD"&&a.id===intent.adId);
 if(!before||before.creativeRepointClaim||before.deletionClaim||before.parents.filter(p=>p.type==="CREATIVE").length!==1||!before.parents.some(p=>p.type==="CREATIVE"&&p.id===intent.oldCreativeId)||!assets.some(a=>a.type==="CREATIVE"&&a.id===intent.newCreativeId))throw new PlatformDenied("CREATIVE_REPOINT_ALREADY_CLAIMED_OR_CHANGED");
 return {before,after:{...before,revision:before.revision+1,creativeRepointClaim:{operationId,claimedAt:now,oldCreativeId:intent.oldCreativeId,newCreativeId:intent.newCreativeId}}};
}
export function validateRepointClaim(input:Preparation):void{
 const claim=input.creativeRepointClaim;if(!claim)return;
 const {before,after}=claim,c=after.creativeRepointClaim,op=input.operation;
 if(!Number.isSafeInteger(input.now)||input.now<=0||!/^[A-Za-z0-9_-]{1,128}$/.test(op.id))throw new PlatformDenied("CREATIVE_REPOINT_CLAIM_CLOCK_INVALID");
 if(op.tool!=="ads_update_ad"||op.appId!==before.appId||before.provider!=="META_MARKETING"||before.type!=="AD"||before.tenantId!==op.tenantId||before.clientId!==op.clientId||before.revokedAt!==null||before.creativeRepointClaim||before.deletionClaim||!c||c.operationId!==op.id||c.claimedAt!==input.now||!/^\d{1,32}$/.test(c.oldCreativeId)||!/^\d{1,32}$/.test(c.newCreativeId)||c.oldCreativeId===c.newCreativeId||before.parents.filter(p=>p.type==="CREATIVE").length!==1||!before.parents.some(p=>p.type==="CREATIVE"&&p.id===c.oldCreativeId)||canonicalJson(after)!==canonicalJson({...before,revision:before.revision+1,creativeRepointClaim:c})||!input.expectedRecords.some(r=>r.collection==="assets"&&r.id===before.key&&r.canonical===canonicalJson(before))||!input.expectedRecords.some(r=>{if(r.collection!=="assets")return false;const a=JSON.parse(r.canonical) as MetaAsset;return a.type==="CREATIVE"&&a.id===c.newCreativeId&&a.tenantId===before.tenantId&&a.clientId===before.clientId&&a.appId===before.appId&&a.provider===before.provider&&a.revokedAt===null;}))throw new PlatformDenied("CREATIVE_REPOINT_CLAIM_INVALID");
}
export function repointDependencies(expected:Preparation["expectedRecords"]):{connections:Connection[];operators:string[];authAppId:string}{
 const authAppId=process.env.META_APP_ID;if(!authAppId||!/^\d{1,100}$/.test(authAppId))throw new PlatformDenied("REPOINT_AUTH_APP_REQUIRED");
 return {connections:expected.filter(r=>r.collection==="connections").map(r=>JSON.parse(r.canonical) as Connection),operators:[...new Set(expected.filter(r=>r.collection==="members").map(r=>r.id))],authAppId};
}
