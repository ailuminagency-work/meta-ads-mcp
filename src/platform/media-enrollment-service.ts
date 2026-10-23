import {approvedJpegRootType,approvedJpegTool,approvedJpegActions,approvedJpegTools} from "./media-purpose.js";
import {applyProductTaskRequirements} from "./product-task-requirements.js";
import {createHash,randomUUID} from "node:crypto";
import {PlatformDenied,type AssetGrant,type MetaAsset,type PlatformPrincipal,type Provider} from "./models.js";
import type {ControlCommit,PlatformRepository} from "./repository.js";
import {assetKey,resolveAuthorizedAssets} from "./assets.js";
import {selectConnection} from "./connections.js";
import {canonicalJson} from "./policy.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {prepareApprovedJpegMedia,type TrustedJpegSource} from "./product-media.js";
import {decryptMediaPlan,encryptMediaPlan,type MediaProposal} from "./media-enrollment-types.js";

export interface MediaIngressBinding {id:string;tenantId:string;clientId:string;operatorId:string;accountId:string;connectionId:string;appId:string;purpose?:import("./media-purpose.js").ApprovedJpegPurpose;provider:"META_THREADS"|"META_MARKETING"|"META_MESSENGER"|"META_INSTAGRAM_LOGIN"|"META_INSTAGRAM_FACEBOOK_LOGIN"|"META_FACEBOOK_PAGES"|"META_WHATSAPP"}
export async function mediaAuthorization(repo:PlatformRepository,binding:MediaIngressBinding,now:number):Promise<ControlCommit["expected"]>{
 const principal=await repo.resolvePrincipal(binding.operatorId),tenantId=binding.tenantId;
 if(!principal||principal.operatorId!==binding.operatorId||principal.tenantId!==tenantId)throw new PlatformDenied("MEDIA_PRINCIPAL_REQUIRED");
 const [tenant,member,client]=await Promise.all([repo.get("tenants",tenantId,tenantId),repo.get("members",tenantId,binding.operatorId),repo.get("clients",tenantId,binding.clientId)]);
 if(!tenant||tenant.status!=="ACTIVE"||tenant.migrationState!=="READY"||!member||member.tenantId!==tenantId||member.disabledAt!==null||!member.roles.some(r=>["admin","connection_admin"].includes(r))||!member.allowedClientIds.includes(binding.clientId)||!client||client.status!=="ACTIVE"||client.tenantId!==tenantId)throw new PlatformDenied("MEDIA_ADMIN_REQUIRED");
 const tool=approvedJpegTool(binding.provider,binding.purpose),contract=PRODUCT_CONTRACTS.find(c=>c.tool===tool&&c.verified)!;
 const ctx={principal,clientId:binding.clientId,provider:binding.provider as Provider,tool:"internal_media_enrollment",requestId:"signed-media"};
 const assets=await resolveAuthorizedAssets(repo,ctx,[{type:approvedJpegRootType(binding.provider,binding.purpose),id:binding.accountId}],now,300000);
 const plan=applyProductTaskRequirements({parameters:{},assets:assets.map(a=>({type:a.type,id:a.id})),classes:["READ"],capability:contract.id,requiredScopes:contract.requiredScopes,tokenTypes:contract.tokenTypes},contract,assets);
 const connection=await selectConnection(repo,ctx,plan,assets,now,binding.connectionId);
 if(connection.appId!==binding.appId||connection.expiresAt===null||connection.verifiedAt>now||now-connection.verifiedAt>300000||assets.some(a=>a.appId!==binding.appId))throw new PlatformDenied("MEDIA_CONNECTION_REQUIRED");
 const grants=(await repo.list("grants",tenantId)).filter(g=>g.connectionId===connection.id&&g.tenantId===tenantId&&g.clientId===binding.clientId&&assets.some(a=>a.key===g.assetKey)&&g.revokedAt===null&&g.expiresAt>now&&g.verifiedAt>0&&g.verifiedAt<=now&&now-g.verifiedAt<=300000);
 if(assets.some(a=>!grants.some(g=>g.assetKey===a.key&&g.actions.includes("READ")&&g.capabilities.includes(contract.id))))throw new PlatformDenied("MEDIA_FRESH_PARENT_GRANTS_REQUIRED");
 return [{collection:"tenants",id:tenant.id,canonical:canonicalJson(tenant)},{collection:"members",id:member.operatorId,canonical:canonicalJson(member)},{collection:"clients",id:client.id,canonical:canonicalJson(client)},{collection:"connections",id:connection.id,canonical:canonicalJson(connection)},...assets.map(a=>({collection:"assets" as const,id:a.key,canonical:canonicalJson(a)})),...grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)}))];
}
export class MediaEnrollmentService {
 constructor(private readonly repo:PlatformRepository){}
 async stage(binding:MediaIngressBinding,delivery:string,source:TrustedJpegSource){
  const now=Date.now(),expected=await mediaAuthorization(this.repo,binding,now),scope={tenantId:binding.tenantId,clientId:binding.clientId,provider:binding.provider,appId:binding.appId,purpose:binding.purpose};
  const prepared=await prepareApprovedJpegMedia(scope,source.sourceReference,{resolve:async()=>source},now);
  const root=expected.filter(e=>e.collection==="assets").map(e=>JSON.parse(e.canonical) as MetaAsset).find(a=>a.type===(approvedJpegRootType(binding.provider,binding.purpose))&&a.id===binding.accountId)!;
  const id=createHash("sha256").update(canonicalJson([binding,delivery])).digest("hex"),identity={id,tenantId:binding.tenantId,clientId:binding.clientId,actorId:binding.operatorId,connectionId:binding.connectionId,rootKey:root.key,appId:binding.appId,provider:binding.provider,checkedAt:prepared.evidence.checkedAt,expiresAt:prepared.evidence.expiresAt,consumedAt:null,approvedBy:null};
  const proposal:MediaProposal={...identity,...encryptMediaPlan(identity,{version:1,url:prepared.url,evidence:prepared.evidence,expected})};
  await this.repo.commitControlPlane({tenantId:binding.tenantId,expected,writes:[{collection:"mediaProposals",id,value:proposal,createOnly:true}],audit:{id:randomUUID(),tenantId:binding.tenantId,clientId:binding.clientId,actorId:binding.operatorId,event:"MEDIA_PREPARED",timestamp:Date.now(),subjectId:id,planHash:proposal.planHash}});
  return {proposalId:id,expiresAt:proposal.expiresAt,planHash:proposal.planHash,status:"AWAITING_HUMAN_REVIEW" as const};
 }
 async review(principal:PlatformPrincipal,id:string){
  const p=await this.repo.get("mediaProposals",principal.tenantId,id);if(!p||p.consumedAt!==null||p.expiresAt<=Date.now())throw new PlatformDenied("MEDIA_REVIEW_UNAVAILABLE");
  const plan=decryptMediaPlan(p),root=JSON.parse(plan.expected.find(e=>e.collection==="assets"&&e.id===p.rootKey)!.canonical) as MetaAsset;
  await mediaAuthorization(this.repo,{id:"review",tenantId:p.tenantId,clientId:p.clientId,operatorId:principal.operatorId,accountId:root.id,connectionId:p.connectionId,appId:p.appId,provider:p.provider,purpose:plan.evidence.purpose},Date.now());
  for(const e of plan.expected)if(canonicalJson(await this.repo.get(e.collection,p.tenantId,e.id))!==e.canonical)throw new PlatformDenied("MEDIA_AUTHORIZATION_CHANGED");
  return {proposal:p,plan,accountId:root.id};
 }
 async enroll(principal:PlatformPrincipal,id:string,planHash:string){
  const {proposal:p,plan,accountId}=await this.review(principal,id);if(p.planHash!==planHash)throw new PlatformDenied("MEDIA_REVIEW_HASH_REQUIRED");
  const connection=(await this.repo.get("connections",p.tenantId,p.connectionId))!,approver=(await this.repo.get("members",p.tenantId,principal.operatorId))!,now=Date.now();
  const grants=plan.expected.filter(e=>e.collection==="grants").map(e=>JSON.parse(e.canonical) as AssetGrant),rootGrants=grants.filter(g=>g.assetKey===p.rootKey),tool=approvedJpegTool(p.provider,plan.evidence.purpose);
  if(!rootGrants.length)throw new PlatformDenied("MEDIA_ROOT_GRANT_REQUIRED");
  const asset:MetaAsset={id:`jpeg_${p.id}`,key:"",type:"MEDIA",tenantId:p.tenantId,clientId:p.clientId,provider:p.provider,appId:p.appId,parents:[{type:approvedJpegRootType(p.provider,plan.evidence.purpose),id:accountId}],mediaEvidence:plan.evidence,verifiedAt:p.checkedAt,revokedAt:null,revision:1};asset.key=assetKey(asset.provider,asset.appId,asset);
  const grant:AssetGrant={id:`${p.id}:${asset.key}`,tenantId:p.tenantId,clientId:p.clientId,assetKey:asset.key,connectionId:p.connectionId,capabilities:rootGrants[0].capabilities.filter(c=>rootGrants.every(g=>g.capabilities.includes(c))&&PRODUCT_CONTRACTS.some(contract=>contract.provider===p.provider&&approvedJpegTools(p.provider,plan.evidence.purpose).includes(contract.tool)&&contract.id===c)),actions:approvedJpegActions(p.provider,plan.evidence.purpose).filter(action=>rootGrants.every(g=>g.actions.includes(action))),tasks:rootGrants[0].tasks.filter(t=>rootGrants.every(g=>g.tasks.includes(t))),verifiedAt:Math.min(...rootGrants.map(g=>g.verifiedAt)),expiresAt:Math.min(p.expiresAt,...rootGrants.map(g=>g.expiresAt)),revokedAt:null,revision:1};
  if(rootGrants.some(g=>grant.actions.some(a=>!g.actions.includes(a))||!g.capabilities.includes(tool.replaceAll("_","."))))throw new PlatformDenied("MEDIA_GRANT_CANNOT_ESCALATE");
  await this.repo.commitControlPlane({tenantId:p.tenantId,expected:[...plan.expected,{collection:"mediaProposals",id:p.id,canonical:canonicalJson(p)},{collection:"members",id:approver.operatorId,canonical:canonicalJson(approver)}],writes:[{collection:"mediaProposals",id:p.id,value:{...p,consumedAt:now,approvedBy:principal.operatorId},createOnly:false},{collection:"assets",id:asset.key,value:asset,createOnly:true},{collection:"grants",id:grant.id,value:grant,createOnly:true},{collection:"connections",id:connection.id,value:{...connection,assetKeys:[...connection.assetKeys,asset.key],revision:connection.revision+1},createOnly:false}],audit:{id:randomUUID(),tenantId:p.tenantId,clientId:p.clientId,actorId:principal.operatorId,event:"MEDIA_ENROLLED",timestamp:now,subjectId:p.id,planHash:p.planHash}});
  return {assetId:asset.id,assetKey:asset.key,imageUrl:plan.url,status:"ENROLLED" as const};
 }
}
