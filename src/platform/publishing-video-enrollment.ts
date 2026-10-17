import {createHash,randomUUID} from "node:crypto";
import {PlatformDenied,type PlatformPrincipal,type MetaAsset,type AssetGrant} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {canonicalJson} from "./policy.js";
import {assetKey} from "./assets.js";
import {publishingVideoAuthorization,type PublishingVideoBinding} from "./publishing-video-authorization.js";
import {publishingVideoEnabled} from "./publishing-video-flags.js";
import {preparePublishingMp4Source,type PublishingMp4Source} from "./publishing-video-source.js";
import {publishingVideoWriteAction,publishingVideoRoot} from "./video-purpose.js";
import {publishingVideoSourceContracts} from "./publishing-video-policy.js";
import {encryptVideoPlan,decryptVideoPlan} from "./video-proposal.js";
import type {VideoProposal} from "./video-types.js";

export class PublishingVideoEnrollmentService{
 constructor(private readonly repo:PlatformRepository){}
 async stage(binding:PublishingVideoBinding,delivery:string,source:PublishingMp4Source){
  if(!publishingVideoEnabled())throw new PlatformDenied("PUBLISHING_VIDEO_DISABLED_BY_DEPLOYMENT");if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(delivery))throw new PlatformDenied("VIDEO_DELIVERY_REQUIRED");
  const auth=await publishingVideoAuthorization(this.repo,binding),prepared=await preparePublishingMp4Source(binding,source),evidence=prepared.evidence;
  evidence.expiresAt=Math.min(evidence.expiresAt,...auth.expected.filter(e=>e.collection==="grants"||e.collection==="connections").map(e=>(JSON.parse(e.canonical) as {expiresAt:number}).expiresAt));
  const id=createHash("sha256").update(canonicalJson([binding,delivery])).digest("hex"),identity={id,tenantId:binding.tenantId,clientId:binding.clientId,actorId:binding.operatorId,connectionId:binding.connectionId,rootKey:auth.root.key,appId:binding.appId,provider:binding.provider,draftTools:[...binding.draftTools],checkedAt:evidence.checkedAt,expiresAt:evidence.expiresAt,consumedAt:null,approvedBy:null},proposal:VideoProposal={...identity,...encryptVideoPlan(identity,{version:1,url:prepared.url,evidence,expected:auth.expected})};
  await this.repo.commitControlPlane({tenantId:binding.tenantId,expected:auth.expected,writes:[{collection:"videoProposals",id,value:proposal,createOnly:true}],audit:{id:randomUUID(),tenantId:binding.tenantId,clientId:binding.clientId,actorId:binding.operatorId,event:"VIDEO_PREPARED",timestamp:Date.now(),subjectId:id,planHash:proposal.planHash}});return {proposalId:id,expiresAt:proposal.expiresAt,planHash:proposal.planHash,status:"AWAITING_HUMAN_REVIEW" as const};
 }
 async review(principal:PlatformPrincipal,id:string){
  const proposal=await this.repo.get("videoProposals",principal.tenantId,id);if(!proposal||proposal.provider==="META_FACEBOOK_PAGES"||!proposal.draftTools||proposal.tenantId!==principal.tenantId||proposal.consumedAt!==null||proposal.expiresAt<=Date.now())throw new PlatformDenied("PUBLISHING_VIDEO_REVIEW_UNAVAILABLE");
  const plan=decryptVideoPlan(proposal),root=JSON.parse(plan.expected.find(e=>e.collection==="assets"&&e.id===proposal.rootKey)!.canonical) as MetaAsset;
  await publishingVideoAuthorization(this.repo,{id:"review",tenantId:proposal.tenantId,clientId:proposal.clientId,operatorId:proposal.actorId,connectionId:proposal.connectionId,accountId:root.id,appId:proposal.appId,provider:proposal.provider,draftTools:proposal.draftTools});
  const resolved=await this.repo.resolvePrincipal(principal.operatorId),member=await this.repo.get("members",principal.tenantId,principal.operatorId);if(!resolved||canonicalJson(resolved)!==canonicalJson(principal)||!member||member.disabledAt!==null||!member.allowedClientIds.includes(proposal.clientId)||!member.roles.some(r=>["admin","connection_admin"].includes(r)))throw new PlatformDenied("PUBLISHING_VIDEO_HUMAN_REVIEW_REQUIRED");
  for(const e of plan.expected)if(canonicalJson(await this.repo.get(e.collection,proposal.tenantId,e.id))!==e.canonical)throw new PlatformDenied("PUBLISHING_VIDEO_AUTHORIZATION_CHANGED");return {proposal,plan,accountId:root.id};
 }
 async enroll(principal:PlatformPrincipal,id:string,planHash:string){
  if(!publishingVideoEnabled())throw new PlatformDenied("PUBLISHING_VIDEO_DISABLED_BY_DEPLOYMENT");const {proposal:p,plan,accountId}=await this.review(principal,id);if(p.planHash!==planHash)throw new PlatformDenied("VIDEO_REVIEW_HASH_REQUIRED");
  const connection=(await this.repo.get("connections",p.tenantId,p.connectionId))!,approver=(await this.repo.get("members",p.tenantId,principal.operatorId))!,grants=plan.expected.filter(e=>e.collection==="grants").map(e=>JSON.parse(e.canonical) as AssetGrant),contracts=publishingVideoSourceContracts(p.provider,p.draftTools!),now=Date.now();
  const asset:MetaAsset={id:`mp4_${p.id}`,key:"",type:"MEDIA",tenantId:p.tenantId,clientId:p.clientId,provider:p.provider,appId:p.appId,parents:[{type:publishingVideoRoot(p.provider),id:accountId}],videoEvidence:plan.evidence,verifiedAt:p.checkedAt,revokedAt:null,revision:1};asset.key=assetKey(asset.provider,asset.appId,asset);
  const grant:AssetGrant={id:`${p.id}:${asset.key}`,tenantId:p.tenantId,clientId:p.clientId,assetKey:asset.key,connectionId:p.connectionId,capabilities:contracts.map(c=>c.id),actions:["READ",publishingVideoWriteAction(p.provider)],tasks:[],verifiedAt:Math.min(...grants.map(g=>g.verifiedAt)),expiresAt:Math.min(p.expiresAt,...grants.map(g=>g.expiresAt)),revokedAt:null,revision:1};
  await this.repo.commitControlPlane({tenantId:p.tenantId,expected:[...plan.expected,{collection:"videoProposals",id:p.id,canonical:canonicalJson(p)},...(!plan.expected.some(e=>e.collection==="members"&&e.id===approver.operatorId)?[{collection:"members" as const,id:approver.operatorId,canonical:canonicalJson(approver)}]:[])],writes:[{collection:"videoProposals",id:p.id,value:{...p,consumedAt:now,approvedBy:principal.operatorId},createOnly:false},{collection:"assets",id:asset.key,value:asset,createOnly:true},{collection:"grants",id:grant.id,value:grant,createOnly:true},{collection:"connections",id:connection.id,value:{...connection,assetKeys:[...connection.assetKeys,asset.key],revision:connection.revision+1},createOnly:false}],audit:{id:randomUUID(),tenantId:p.tenantId,clientId:p.clientId,actorId:principal.operatorId,event:"VIDEO_ENROLLED",timestamp:now,subjectId:p.id,planHash:p.planHash}});return {assetId:asset.id,assetKey:asset.key,videoUrl:plan.url,status:"ENROLLED" as const};
 }
}
