import {appPurchaseEnabled} from "./app-purchase-eligibility.js";
import {z} from "zod";
import type {TrustedOAuthProfile,InspectedOAuthToken} from "./oauth.js";
import {PlatformDenied,type MetaAsset,type AssetRef} from "./models.js";
import {appPromotionBindingSchema,verifyAppPromotionAssignment} from "./app-promotion-contract.js";
import {APP_PROMOTION_ALLOWED_CAPABILITIES} from "./app-promotion-types.js";
import {expandVerifiedPermissionDependencies} from "./products/permission-dependencies.js";
import {canonicalJson} from "./policy.js";
export function isAppPromotionOAuthProfile(p:TrustedOAuthProfile):boolean{return p.capabilities.includes("marketing.app_promotion.inspect");}
export function validateAppPromotionOAuthProfile(p:TrustedOAuthProfile):void{
 const b=appPromotionBindingSchema.parse(p.appPromotionBinding),required=expandVerifiedPermissionDependencies(["public_profile","ads_read","ads_management"]);
 if(b.optimizationMode==="PURCHASE"&&!appPurchaseEnabled())throw new PlatformDenied("APP_PURCHASE_DISABLED_BY_DEPLOYMENT");
 if(process.env.LUMIN_MARKETING_APP_PROMOTION_ENABLED!=="true"||p.provider!=="META_MARKETING"||p.tokenTypes.length!==1||p.tokenTypes[0]!=="user"||p.marketingControlMode!==undefined||p.studyRootIds!==undefined||p.invoiceRootIds!==undefined||p.derivedTokenScopes!==undefined||!isAppPromotionOAuthProfile(p)||canonicalJson(p.requiredTasks)!==canonicalJson(["ADVERTISE"])||new Set(p.capabilities).size!==p.capabilities.length||p.capabilities.some(c=>!APP_PROMOTION_ALLOWED_CAPABILITIES.includes(c))||!["READ","WRITE_AD_CONFIGURATION"].every(a=>p.actions.includes(a as typeof p.actions[number]))||p.actions.some(a=>!["READ","WRITE_AD_CONFIGURATION","WRITE_BUDGET"].includes(a))||canonicalJson([...p.scopes].sort())!==canonicalJson([...required].sort())||b.applicationId===p.appId)throw new PlatformDenied("APP_PROMOTION_EXACT_OAUTH_PROFILE_REQUIRED");
}
export function appPromotionOAuthRoots(p:TrustedOAuthProfile,registered:MetaAsset[],now:number):MetaAsset[]{
 validateAppPromotionOAuthProfile(p);const b=p.appPromotionBinding!,wanted:AssetRef[]=[{type:"AD_ACCOUNT",id:b.accountId},{type:"PAGE",id:b.pageId}],rows=wanted.map(ref=>registered.filter(a=>a.type===ref.type&&a.id.replace(/^act_/,"")===ref.id));if(!Number.isSafeInteger(now)||now<=0||rows.some(matches=>matches.length!==1))throw new PlatformDenied("APP_PROMOTION_REGISTERED_OAUTH_ROOTS_REQUIRED");const assets=rows.map(r=>r[0]);if(assets.some(a=>a.tenantId!==b.tenantId||a.clientId!==b.clientId||a.provider!=="META_MARKETING"||a.appId!==p.appId||a.parents.length||a.revokedAt!==null||a.verifiedAt<=0||a.verifiedAt>now||now-a.verifiedAt>3600000))throw new PlatformDenied("APP_PROMOTION_REGISTERED_OAUTH_ROOTS_REQUIRED");return assets;
}
export async function proveAppPromotionOAuth(p:TrustedOAuthProfile,read:(path:string,query:Record<string,string>)=>Promise<unknown>):Promise<InspectedOAuthToken["assets"]>{
 const b=p.appPromotionBinding!,account=z.object({id:z.string(),account_id:z.string(),user_tasks:z.array(z.string()).max(10)}).parse(await read("/act_"+b.accountId,{fields:"id,account_id,user_tasks"}));if(account.id!=="act_"+b.accountId||account.account_id!==b.accountId||!account.user_tasks.some(t=>["ADVERTISE","MANAGE"].includes(t)))throw new PlatformDenied("APP_PROMOTION_ACTUAL_ACCOUNT_TASK_REQUIRED");
 verifyAppPromotionAssignment(b,await read("/act_"+b.accountId+"/advertisable_applications",{fields:"id",app_id:b.applicationId,limit:"1"}),await read("/"+b.applicationId,{fields:"id,object_store_urls,supported_platforms"}));
 const page=z.object({id:z.string()}).parse(await read("/"+b.pageId,{fields:"id"}));if(page.id!==b.pageId)throw new PlatformDenied("APP_PROMOTION_ACTUAL_PAGE_REQUIRED");const body=z.object({data:z.array(z.object({id:z.string(),tasks:z.array(z.string()).max(100)})).max(100),paging:z.object({next:z.string().min(1).max(8192).optional()}).optional()}).parse(await read("/me/accounts",{fields:"id,tasks",limit:"100"})),selected=body.data.filter(row=>row.id===b.pageId);if(body.paging?.next||new Set(body.data.map(row=>row.id)).size!==body.data.length||selected.length!==1||!selected[0].tasks.includes("ADVERTISE"))throw new PlatformDenied("APP_PROMOTION_ACTUAL_PAGE_TASK_REQUIRED");return [{type:"AD_ACCOUNT",id:b.accountId,tasks:[]},{type:"PAGE",id:b.pageId,tasks:[...selected[0].tasks]}];
}
