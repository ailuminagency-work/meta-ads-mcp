import {approvedJpegRootType,approvedJpegTool,approvedJpegActions,approvedJpegTools} from "./media-purpose.js";
import {applyProductTaskRequirements} from "./product-task-requirements.js";
import {PlatformDenied,type AssetGrant,type Connection,type MetaAsset,type Member} from "./models.js";
import type {ControlCommit,Collection,Records} from "./repository.js";
import {canonicalJson} from "./policy.js";
import {assetKey} from "./assets.js";
import {assertApprovedJpegAsset} from "./product-media.js";
import {decryptMediaPlan,type MediaProposal} from "./media-enrollment-types.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import {credentialSubjectMatches} from "./connections.js";
const deny=():never=>{throw new PlatformDenied("MEDIA_ENROLLMENT_INVALID");};
export function validateMediaControl(input:ControlCommit):void{
 const writes=input.writes.filter(w=>w.collection==="mediaProposals");
 if(!["MEDIA_PREPARED","MEDIA_ENROLLED"].includes(input.audit.event)){if(writes.length)deny();return;}
 if(writes.length!==1)deny();const w=writes[0],p=w.value as MediaProposal,now=Date.now();
 if(p.id!==w.id||p.id!==input.audit.subjectId||p.tenantId!==input.tenantId||p.clientId!==input.audit.clientId||p.planHash!==input.audit.planHash||!Number.isSafeInteger(p.checkedAt)||p.checkedAt<=0||p.checkedAt>now||now-p.checkedAt>300000||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||p.expiresAt>p.checkedAt+300000)deny();
 const plan=decryptMediaPlan(p),get=<K extends Collection>(collection:K,id:string):Records[K]=>{const e=input.expected.find(r=>r.collection===collection&&r.id===id);if(!e)deny();return JSON.parse(e!.canonical) as Records[K];};
 for(const e of plan.expected)if(!input.expected.some(r=>canonicalJson(r)===canonicalJson(e)))deny();
 const tenant=get("tenants",p.tenantId),client=get("clients",p.clientId),actor=get("members",p.actorId),root=get("assets",p.rootKey),connection=get("connections",p.connectionId),tool=approvedJpegTool(p.provider,plan.evidence.purpose);
 const admin=(m:Member)=>m.tenantId===p.tenantId&&m.disabledAt===null&&m.allowedClientIds.includes(p.clientId)&&m.roles.some(r=>["admin","connection_admin"].includes(r));
 if(tenant.id!==p.tenantId||tenant.status!=="ACTIVE"||tenant.migrationState!=="READY"||client.id!==p.clientId||client.status!=="ACTIVE"||client.tenantId!==p.tenantId||actor.operatorId!==p.actorId||!admin(actor)||root.key!==p.rootKey||root.type!==(approvedJpegRootType(p.provider,plan.evidence.purpose))||root.tenantId!==p.tenantId||root.clientId!==p.clientId||root.appId!==p.appId||root.provider!==p.provider||root.revokedAt!==null||root.verifiedAt<=0||root.verifiedAt>now||now-root.verifiedAt>300000||connection.id!==p.connectionId||connection.operatorId!==p.actorId||connection.tenantId!==p.tenantId||connection.appId!==p.appId||connection.provider!==p.provider||connection.revokedAt!==null||connection.expiresAt===null||connection.expiresAt<=now||connection.verifiedAt<=0||connection.verifiedAt>now||now-connection.verifiedAt>300000||!connection.assetKeys.includes(root.key))deny();
 const grants=plan.expected.filter(e=>e.collection==="grants").map(e=>JSON.parse(e.canonical) as AssetGrant),roots=grants.filter(g=>g.assetKey===root.key);
 if(!roots.length||grants.some(g=>g.tenantId!==p.tenantId||g.clientId!==p.clientId||g.connectionId!==p.connectionId||g.revokedAt!==null||g.expiresAt<=now||g.verifiedAt<=0||g.verifiedAt>now||now-g.verifiedAt>300000))deny();
 const contract=PRODUCT_CONTRACTS.find(c=>c.tool===tool&&c.provider===p.provider&&c.verified);if(!contract||!contract.tokenTypes.includes(connection.tokenType)||contract.requiredScopes.some(s=>!connection.scopes.includes(s)))deny();
 const assets=plan.expected.filter(e=>e.collection==="assets").map(e=>JSON.parse(e.canonical) as MetaAsset);
 if(!credentialSubjectMatches(connection,assets))deny();
 const taskPlan=applyProductTaskRequirements({parameters:{},assets:[],classes:["READ"],capability:contract!.id,requiredScopes:contract!.requiredScopes,tokenTypes:contract!.tokenTypes},contract!,assets);
 for(const a of assets){if(a.provider!==p.provider||a.appId!==p.appId||a.clientId!==p.clientId||a.tenantId!==p.tenantId||a.revokedAt!==null||a.verifiedAt<=0||a.verifiedAt>now||now-a.verifiedAt>300000||!connection.assetKeys.includes(a.key)||a.parents.some(parent=>assets.filter(v=>v.type===parent.type&&v.id===parent.id).length!==1)||!grants.some(g=>g.assetKey===a.key&&g.capabilities.includes(tool.replaceAll("_","."))&&g.actions.includes("READ")&&[...(taskPlan.requiredTasks??[]),...(taskPlan.requiredAssetTasks??[]).filter(r=>r.asset.type===a.type&&r.asset.id===a.id).flatMap(r=>r.tasks)].every(t=>g.tasks.includes(t))))deny();}
 const asset:MetaAsset={id:`jpeg_${p.id}`,key:"",type:"MEDIA",tenantId:p.tenantId,clientId:p.clientId,provider:p.provider,appId:p.appId,parents:[{type:approvedJpegRootType(p.provider,plan.evidence.purpose),id:root.id}],mediaEvidence:plan.evidence,verifiedAt:p.checkedAt,revokedAt:null,revision:1};asset.key=assetKey(asset.provider,asset.appId,asset);
 assertApprovedJpegAsset(root,asset,plan.url,plan.evidence.aiGenerated,now,plan.evidence.purpose);
 if(input.audit.event==="MEDIA_PREPARED"){if(input.writes.length!==1||!w.createOnly||p.consumedAt!==null||p.approvedBy!==null||input.audit.actorId!==p.actorId)deny();return;}
 const old=get("mediaProposals",p.id),approver=get("members",input.audit.actorId);
 if(old.consumedAt!==null||old.approvedBy!==null||!admin(approver)||approver.operatorId!==input.audit.actorId||p.approvedBy!==approver.operatorId||!Number.isSafeInteger(p.consumedAt)||p.consumedAt!<p.checkedAt||p.consumedAt!>now||w.createOnly||canonicalJson(p)!==canonicalJson({...old,consumedAt:p.consumedAt,approvedBy:approver.operatorId}))deny();
 const aw=input.writes.filter(r=>r.collection==="assets"),gw=input.writes.filter(r=>r.collection==="grants"),cw=input.writes.filter(r=>r.collection==="connections");
 if(input.writes.length!==4||aw.length!==1||gw.length!==1||cw.length!==1||!aw[0].createOnly||aw[0].id!==asset.key||canonicalJson(aw[0].value)!==canonicalJson(asset)||connection.assetKeys.includes(asset.key))deny();
 const grant=gw[0].value as AssetGrant,expectedGrant:AssetGrant={id:`${p.id}:${asset.key}`,tenantId:p.tenantId,clientId:p.clientId,assetKey:asset.key,connectionId:connection.id,capabilities:roots[0].capabilities.filter(c=>roots.every(g=>g.capabilities.includes(c))&&PRODUCT_CONTRACTS.some(contract=>contract.provider===p.provider&&approvedJpegTools(p.provider,plan.evidence.purpose).includes(contract.tool)&&contract.id===c)),actions:approvedJpegActions(p.provider,plan.evidence.purpose).filter(action=>roots.every(g=>g.actions.includes(action))),tasks:roots[0].tasks.filter(t=>roots.every(g=>g.tasks.includes(t))),verifiedAt:Math.min(...roots.map(g=>g.verifiedAt)),expiresAt:Math.min(p.expiresAt,...roots.map(g=>g.expiresAt)),revokedAt:null,revision:1};
 if(!gw[0].createOnly||gw[0].id!==grant.id||canonicalJson(grant)!==canonicalJson(expectedGrant)||roots.some(g=>!g.capabilities.includes(tool.replaceAll("_","."))||grant.actions.some(a=>!g.actions.includes(a)))||cw[0].id!==connection.id||cw[0].createOnly||canonicalJson(cw[0].value as Connection)!==canonicalJson({...connection,assetKeys:[...connection.assetKeys,asset.key],revision:connection.revision+1}))deny();
}
