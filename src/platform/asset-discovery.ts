import {assertAccountOwnershipEvidence} from "./ownership-evidence.js";
import {z} from "zod";
import {PlatformDenied,type MetaAsset,type OperationContext,type OperationPlan,type AssetType,type AssetRef} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {authorizeOperation,assertExecutionPermit,finishOperation,getExecutionScope,revalidateExecutionPermit,runWithExecutionPermit,withConnectionCredential} from "./execution.js";
import {assertLegacyMarketingReadEligibility} from "./legacy-egress.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
import {canonicalJson} from "./policy.js";
import {createHash} from "node:crypto";
import {resolveMetaApiVersion} from "../meta/api-version.js";
import {expandVerifiedPermissionDependencies} from "./products/permission-dependencies.js";
const CONTRACTS=Object.freeze({AD:{edge:"ads",capability:"legacy.ads_get_ads",fields:"id,account_id,campaign_id,adset_id,creative{id},name",idField:"id"},CAMPAIGN:{edge:"campaigns",capability:"legacy.ads_get_campaigns",fields:"id,account_id,name",idField:"id"},AUDIENCE:{edge:"customaudiences",capability:"legacy.ads_get_custom_audiences",fields:"id,account_id,name",idField:"id"},AD_IMAGE:{edge:"adimages",capability:"legacy.ads_get_ad_images",fields:"id,account_id,hash,name",idField:"hash"},AD_VIDEO:{edge:"advideos",capability:"legacy.ads_get_ad_videos",fields:"id,title",idField:"id"},LEAD_FORM:{edge:"leadgen_forms",capability:"legacy.ads_get_lead_forms",fields:"id,name,status",idField:"id"}} as const);
export type DiscoverableAdAsset=keyof typeof CONTRACTS;
export interface DiscoveredAdAsset {type:AssetType;id:string;name?:string;parents:AssetRef[]}
export interface AdDiscoveryProof {parentSnapshots?:Array<{collection:"assets"|"grants";id:string;canonical:string}>;pageKey?:string;pageId?:string;kind:DiscoverableAdAsset;rootKey:string;rootId:string;connectionId:string;appId:string;checkedAt:number;rows:DiscoveredAdAsset[];rowsHash:string;source:string}
/** Discovery proves a bounded parent edge. It does not install assets or grants;
 * encrypted, one-time human-reviewed enrollment is a separate control action. */
export async function discoverRegisteredAdAccountAssets(repo:PlatformRepository,context:OperationContext,root:MetaAsset,kind:DiscoverableAdAsset,options:{fetcher?:typeof fetch;now?:()=>number;selectedConnectionId?:string}={}):Promise<AdDiscoveryProof>{
 if(resolveMetaApiVersion()!=="v26.0")throw new PlatformDenied("DISCOVERY_VERSION_UNVERIFIED_HOLD");
 const contract=CONTRACTS[kind];if(!contract||root.type!=="AD_ACCOUNT"||root.provider!=="META_MARKETING"||root.tenantId!==context.principal.tenantId||root.clientId!==context.clientId||!/^\d{1,32}$/.test(root.id.replace(/^act_/,"")))throw new PlatformDenied("REGISTERED_DISCOVERY_ROOT_REQUIRED");
 const plan:OperationPlan={assets:[{type:"AD_ACCOUNT",id:root.id}],classes:["READ"],parameters:{discovery_kind:kind,root_key:root.key},capability:contract.capability,requiredScopes:["ads_read"],tokenTypes:["user","system_user"]};
 let pageRoot:MetaAsset|undefined;
 if(options.selectedConnectionId){const selected=await repo.get("connections",context.principal.tenantId,options.selectedConnectionId);if(!selected||selected.operatorId!==context.principal.operatorId||selected.provider!=="META_MARKETING"||selected.appId!==root.appId||!selected.assetKeys.includes(root.key))throw new PlatformDenied("DISCOVERY_SELECTED_CONNECTION_BINDING_REQUIRED");if(selected.tokenType==="page"){const pages=(await repo.list("assets",context.principal.tenantId)).filter(a=>a.type==="PAGE"&&a.tenantId===root.tenantId&&a.clientId===root.clientId&&a.appId===root.appId&&a.provider===root.provider&&a.revokedAt===null&&a.id===selected.subjectId&&selected.assetKeys.includes(a.key));if(pages.length!==1)throw new PlatformDenied("DISCOVERY_EXACT_PAGE_ROOT_REQUIRED");pageRoot=pages[0];plan.assets.push({type:"PAGE",id:pageRoot.id});plan.tokenTypes=["page"];} }
 if(kind==="LEAD_FORM"){if(!pageRoot)throw new PlatformDenied("LEAD_FORM_PAGE_CONNECTION_REQUIRED");plan.requiredScopes=expandVerifiedPermissionDependencies(["ads_management","pages_manage_ads"]);plan.requiredAssetTasks=[{asset:{type:"PAGE",id:pageRoot.id},tasks:["ADVERTISE"]}];}
 const ctx={...context,provider:"META_MARKETING" as const,tool:"meta_discover_ad_assets"};
 const permit=await authorizeOperation(repo,ctx,plan,{writesEnabled:false,...(options.selectedConnectionId?{selectedConnectionId:options.selectedConnectionId}:{})});
 try{return await runWithExecutionPermit(permit,async()=>withConnectionCredential(permit,async token=>{
  assertExecutionPermit({tool:ctx.tool,provider:ctx.provider,mutation:false});
  if(canonicalJson(getExecutionScope().plan)!==canonicalJson(plan))throw new PlatformDenied("DISCOVERY_PLAN_BINDING_REQUIRED");
  const rows:DiscoveredAdAsset[]=[],seen=new Set<string>(),cursors=new Set<string>(),parentSnapshots=new Map<string,{collection:"assets"|"grants";id:string;canonical:string}>();let after:string|undefined;
  for(let page=0;page<5;page++){
   await revalidateExecutionPermit(permit);const scope=getExecutionScope();assertLegacyMarketingReadEligibility();
   const account=scope.snapshot.assets.find(a=>a.key===root.key);
   const now=(options.now??Date.now)();if(!account)throw new PlatformDenied("EXACT_FINANCIAL_EVIDENCE_REQUIRED");assertAccountOwnershipEvidence(scope.snapshot,account,now);
   const url=new URL(`https://graph.facebook.com/v26.0/${kind==="LEAD_FORM"?pageRoot!.id:`act_${root.id.replace(/^act_/,"")}`}/${contract.edge}`);url.search=new URLSearchParams({fields:contract.fields,limit:"20",...(after?{after}:{})}).toString();
   let raw:unknown;try{const response=await(options.fetcher??fetch)(url,{method:"GET",headers:{Authorization:`Bearer ${token}`},redirect:"error",signal:AbortSignal.timeout(15000)});if(!response.ok){await response.body?.cancel();throw new Error();}raw=JSON.parse(await readBodyWithLimit(response,131072));}catch{throw new PlatformDenied("DISCOVERY_PROVIDER_READ_FAILED");}
   const response=z.object({data:z.array(z.record(z.string(),z.unknown())).max(20),paging:z.object({next:z.unknown().optional(),cursors:z.object({after:z.string().max(2048).optional()}).optional()}).optional()}).parse(raw);
   for(const row of response.data){
    const value=row[contract.idField];if(typeof value!=="string"||!(kind==="AD_IMAGE"?/^[a-f0-9]{32}$/i:/^\d{1,32}$/).test(value)||seen.has(value)||(!["AD_VIDEO","LEAD_FORM"].includes(kind)&&String(row.account_id)!==root.id.replace(/^act_/,""))||(kind==="LEAD_FORM"&&row.status!=="ACTIVE"))throw new PlatformDenied("DISCOVERY_EDGE_IDENTITY_INVALID");seen.add(value);
    const name=row.name??row.title;if(name!==undefined&&(typeof name!=="string"||name.length>500||/[\x00-\x1f\x7f]/.test(name)))throw new PlatformDenied("DISCOVERY_PROJECTION_INVALID");
    let parents:AssetRef[]=[kind==="LEAD_FORM"?{type:"PAGE",id:pageRoot!.id}:{type:"AD_ACCOUNT",id:root.id.replace(/^act_/,"")}];
    if(kind==="AD"){
     const numeric=z.string().regex(/^\d{1,32}$/),ids=z.object({campaign_id:numeric,adset_id:numeric,creative:z.object({id:numeric}).strict()}).parse(row),parentPlan:OperationPlan={...plan,assets:[...plan.assets,{type:"AD_SET",id:ids.adset_id},{type:"CREATIVE",id:ids.creative.id}]};
     const parentPermit=await authorizeOperation(repo,ctx,parentPlan,{writesEnabled:false,selectedConnectionId:scope.snapshot.connection.id});
     await runWithExecutionPermit(parentPermit,async()=>{const authorized=getExecutionScope(),adset=authorized.snapshot.assets.find(a=>a.type==="AD_SET"&&a.id===ids.adset_id),campaign=authorized.snapshot.assets.find(a=>a.type==="CAMPAIGN"&&a.id===ids.campaign_id),creative=authorized.snapshot.assets.find(a=>a.type==="CREATIVE"&&a.id===ids.creative.id),fresh=(options.now??Date.now)();
      if(!adset||!campaign||!creative||!adset.parents.some(p=>p.type==="CAMPAIGN"&&p.id===campaign.id)||!campaign.parents.some(p=>p.type==="AD_ACCOUNT"&&p.id.replace(/^act_/,"")===root.id.replace(/^act_/,""))||!creative.parents.some(p=>p.type==="AD_ACCOUNT"&&p.id.replace(/^act_/,"")===root.id.replace(/^act_/,""))||authorized.snapshot.assets.some(a=>a.verifiedAt>fresh||fresh-a.verifiedAt>300000)||authorized.snapshot.grants.some(g=>g.verifiedAt>fresh||fresh-g.verifiedAt>300000))throw new PlatformDenied("DISCOVERY_AD_PARENT_PROVENANCE_REQUIRED");
      await revalidateExecutionPermit(parentPermit);
      for(const a of authorized.snapshot.assets)parentSnapshots.set(`assets:${a.key}`,{collection:"assets",id:a.key,canonical:canonicalJson(a)});
      for(const g of authorized.snapshot.grants)parentSnapshots.set(`grants:${g.id}`,{collection:"grants",id:g.id,canonical:canonicalJson(g)});
      await finishOperation(parentPermit,"SUCCEEDED");
     });
     parents=[{type:"AD_SET",id:ids.adset_id},{type:"CREATIVE",id:ids.creative.id}];
    }
    rows.push({type:kind,id:value,...(typeof name==="string"?{name}:{}),parents});if(rows.length>20)throw new PlatformDenied("DISCOVERY_PROPOSAL_BOUND_EXCEEDED");
   }
   if(!response.paging?.next)break;const cursor=response.paging.cursors?.after;if(!cursor||!/^[A-Za-z0-9._~+\/=\-]{1,2048}$/.test(cursor)||cursors.has(cursor)||page===4)throw new PlatformDenied("DISCOVERY_PAGINATION_BOUND_REQUIRED");cursors.add(cursor);after=cursor;
  }
  await revalidateExecutionPermit(permit);assertLegacyMarketingReadEligibility();
  const checkedAt=(options.now??Date.now)();if(!Number.isSafeInteger(checkedAt)||checkedAt<=0)throw new PlatformDenied("DISCOVERY_CLOCK_REQUIRED");
  const finalScope=getExecutionScope(),finalRoot=finalScope.snapshot.assets.find(a=>a.key===root.key);if(!finalRoot)throw new PlatformDenied("EXACT_FINANCIAL_EVIDENCE_REQUIRED");assertAccountOwnershipEvidence(finalScope.snapshot,finalRoot,checkedAt);
  const proof:AdDiscoveryProof={...(kind==="AD"?{parentSnapshots:[...parentSnapshots.values()]}:{}),...(pageRoot?{pageKey:pageRoot.key,pageId:pageRoot.id}:{}),kind,rootKey:root.key,rootId:root.id.replace(/^act_/,""),connectionId:getExecutionScope().snapshot.connection.id,appId:root.appId,checkedAt,rows,rowsHash:createHash("sha256").update(canonicalJson(rows)).digest("hex"),source:kind==="LEAD_FORM"?"https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/create":"https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py"};await finishOperation(permit,"SUCCEEDED");return proof;
 }));}catch(error){await finishOperation(permit,"FAILED");throw error;}
}
