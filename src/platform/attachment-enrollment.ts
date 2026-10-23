import {attachmentRoot,attachmentIsAudio} from "./attachment-source.js";
import {createHash,randomUUID} from "node:crypto";
import {PlatformDenied,type PlatformPrincipal,type MetaAsset,type AssetGrant} from "./models.js";
import type {PlatformRepository} from "./repository.js";
import {canonicalJson} from "./policy.js";
import {assetKey} from "./assets.js";
import {attachmentAuthorization} from "./attachment-authorization.js";
import type {AttachmentBinding,TrustedAttachmentSource,AttachmentProposal} from "./attachment-source.js";
import {attachmentEnabled,attachmentContracts} from "./attachment-policy.js";
import {prepareAttachmentSource} from "./attachment-source.js";


import {encryptAttachmentPlan,decryptAttachmentPlan} from "./attachment-proposal.js";


export class AttachmentEnrollmentService{
 constructor(private readonly repo:PlatformRepository){}
 async stage(binding:AttachmentBinding,delivery:string,source:TrustedAttachmentSource){
  if(!attachmentEnabled())throw new PlatformDenied("ATTACHMENT_DISABLED_BY_DEPLOYMENT");if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(delivery))throw new PlatformDenied("ATTACHMENT_DELIVERY_REQUIRED");
  const auth=await attachmentAuthorization(this.repo,binding),prepared=await prepareAttachmentSource(binding,source),evidence=prepared.evidence;
  evidence.expiresAt=Math.min(evidence.expiresAt,...auth.expected.filter(e=>e.collection==="grants"||e.collection==="connections").map(e=>(JSON.parse(e.canonical) as {expiresAt:number}).expiresAt));
  const id=createHash("sha256").update(canonicalJson([binding,delivery])).digest("hex"),identity={id,tenantId:binding.tenantId,clientId:binding.clientId,actorId:binding.operatorId,connectionId:binding.connectionId,rootKey:auth.root.key,appId:binding.appId,provider:binding.provider,purpose:binding.purpose,checkedAt:evidence.checkedAt,expiresAt:evidence.expiresAt,consumedAt:null,approvedBy:null},proposal:AttachmentProposal={...identity,...encryptAttachmentPlan(identity,{version:1,url:prepared.url,evidence,expected:auth.expected})};
  await this.repo.commitControlPlane({tenantId:binding.tenantId,expected:auth.expected,writes:[{collection:"attachmentProposals",id,value:proposal,createOnly:true}],audit:{id:randomUUID(),tenantId:binding.tenantId,clientId:binding.clientId,actorId:binding.operatorId,event:"ATTACHMENT_PREPARED",timestamp:Date.now(),subjectId:id,planHash:proposal.planHash}});return {proposalId:id,expiresAt:proposal.expiresAt,planHash:proposal.planHash,status:"AWAITING_HUMAN_REVIEW" as const};
 }
 async review(principal:PlatformPrincipal,id:string){
  const proposal=await this.repo.get("attachmentProposals",principal.tenantId,id);if(!proposal||!["META_MESSENGER","META_WHATSAPP"].includes(proposal.provider)||proposal.tenantId!==principal.tenantId||proposal.consumedAt!==null||proposal.expiresAt<=Date.now())throw new PlatformDenied("ATTACHMENT_REVIEW_UNAVAILABLE");
  const plan=decryptAttachmentPlan(proposal),root=JSON.parse(plan.expected.find(e=>e.collection==="assets"&&e.id===proposal.rootKey)!.canonical) as MetaAsset;
  await attachmentAuthorization(this.repo,{id:"review",tenantId:proposal.tenantId,clientId:proposal.clientId,operatorId:proposal.actorId,connectionId:proposal.connectionId,accountId:root.id,appId:proposal.appId,provider:proposal.provider,purpose:proposal.purpose});
  const resolved=await this.repo.resolvePrincipal(principal.operatorId),member=await this.repo.get("members",principal.tenantId,principal.operatorId);if(!resolved||canonicalJson(resolved)!==canonicalJson(principal)||!member||member.disabledAt!==null||!member.allowedClientIds.includes(proposal.clientId)||!member.roles.some(r=>["admin","connection_admin"].includes(r)))throw new PlatformDenied("ATTACHMENT_HUMAN_REVIEW_REQUIRED");
  for(const e of plan.expected)if(canonicalJson(await this.repo.get(e.collection,proposal.tenantId,e.id))!==e.canonical)throw new PlatformDenied("ATTACHMENT_AUTHORIZATION_CHANGED");return {proposal,plan,accountId:root.id};
 }
 async enroll(principal:PlatformPrincipal,id:string,planHash:string){
  if(!attachmentEnabled())throw new PlatformDenied("ATTACHMENT_DISABLED_BY_DEPLOYMENT");const {proposal:p,plan,accountId}=await this.review(principal,id);if(p.planHash!==planHash)throw new PlatformDenied("ATTACHMENT_REVIEW_HASH_REQUIRED");
  const connection=(await this.repo.get("connections",p.tenantId,p.connectionId))!,approver=(await this.repo.get("members",p.tenantId,principal.operatorId))!,grants=plan.expected.filter(e=>e.collection==="grants").map(e=>JSON.parse(e.canonical) as AssetGrant),contracts=attachmentContracts(p.purpose),now=Date.now();
  const asset:MetaAsset={id:`${attachmentIsAudio(p.purpose)?"audio":"pdf"}_${p.id}`,key:"",type:"MEDIA",tenantId:p.tenantId,clientId:p.clientId,provider:p.provider,appId:p.appId,parents:[{type:attachmentRoot(p.provider),id:accountId}],attachmentEvidence:plan.evidence,verifiedAt:p.checkedAt,revokedAt:null,revision:1};asset.key=assetKey(asset.provider,asset.appId,asset);
  const grant:AssetGrant={id:`${p.id}:${asset.key}`,tenantId:p.tenantId,clientId:p.clientId,assetKey:asset.key,connectionId:p.connectionId,capabilities:contracts.map(c=>c.id),actions:["READ","WRITE_MESSAGING"],tasks:[],verifiedAt:Math.min(...grants.map(g=>g.verifiedAt)),expiresAt:Math.min(p.expiresAt,...grants.map(g=>g.expiresAt)),revokedAt:null,revision:1};
  await this.repo.commitControlPlane({tenantId:p.tenantId,expected:[...plan.expected,{collection:"attachmentProposals",id:p.id,canonical:canonicalJson(p)},...(!plan.expected.some(e=>e.collection==="members"&&e.id===approver.operatorId)?[{collection:"members" as const,id:approver.operatorId,canonical:canonicalJson(approver)}]:[])],writes:[{collection:"attachmentProposals",id:p.id,value:{...p,consumedAt:now,approvedBy:principal.operatorId},createOnly:false},{collection:"assets",id:asset.key,value:asset,createOnly:true},{collection:"grants",id:grant.id,value:grant,createOnly:true},{collection:"connections",id:connection.id,value:{...connection,assetKeys:[...connection.assetKeys,asset.key],revision:connection.revision+1},createOnly:false}],audit:{id:randomUUID(),tenantId:p.tenantId,clientId:p.clientId,actorId:principal.operatorId,event:"ATTACHMENT_ENROLLED",timestamp:now,subjectId:p.id,planHash:p.planHash}});return {assetId:asset.id,assetKey:asset.key,attachmentUrl:plan.url,status:"ENROLLED" as const};
 }
}
