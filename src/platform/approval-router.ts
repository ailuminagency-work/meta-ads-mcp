import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import type { PlatformRepository } from "./repository.js";
import type { OperationPlan, PlatformPrincipal } from "./models.js";
import { inspectApprovalRequest, issueHumanApproval } from "./approvals.js";

export interface ApprovalRouterDependencies {repo:PlatformRepository;origin:string;csrfSecret:string;resolveSession(req:express.Request):Promise<PlatformPrincipal|null>;writesEnabled?():boolean}
const cookie="__Host-lumin_platform_approval";
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const csrfDomain="lumin-platform-approval-csrf\n";
function sign(payload:string,secret:string):string{return createHmac("sha256",secret).update(csrfDomain+payload).digest("hex");}
function equal(a:string,b:string):boolean{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length && timingSafeEqual(left,right);}
/** A typed update always sends status=PAUSED with its other fields, so approving a budget or name change on a live campaign, ad set or ad pauses it. Creates are PAUSED by definition and need no note. */
export function updateSendsPausedNote(plan:OperationPlan):string{
  const step=(plan.parameters as {legacy_write_step?:{body?:{status?:unknown}}}).legacy_write_step;
  return !plan.createOrCopy&&step?.body?.status==="PAUSED"?"<p><strong>This change also sets the status to PAUSED.</strong> If the campaign, ad set or ad is live now, approving this will pause it. Nothing on this page turns it back on.</p>":"";
}
export function createApprovalRouter(deps:ApprovalRouterDependencies):express.Router{
  const origin=new URL(deps.origin);
  if(origin.protocol!=="https:" || origin.origin!==deps.origin || deps.csrfSecret.length<32)throw new Error("VERIFIED_APPROVAL_ORIGIN_AND_SECRET_REQUIRED");
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("Content-Security-Policy","default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","no-referrer");next();});
  router.use((_req,res,next)=>{if(deps.writesEnabled&&!deps.writesEnabled()){res.status(403).type("text").send("Approval unavailable: platform writes are disabled by deployment policy.");return;}next();});
  router.get("/:id",async(req,res)=>{
    try{
      const principal=await deps.resolveSession(req),id=String(req.params.id);
      if(!principal || !/^[a-f0-9-]{36}$/.test(id)){res.sendStatus(403);return;}
      const view=await inspectApprovalRequest(deps.repo,principal,id),expires=Math.min(view.request.expiresAt,Date.now()+300000);
      const payload=Buffer.from(JSON.stringify({id,principal,expires,nonce:randomBytes(32).toString("hex")})).toString("base64url"),csrf=payload+"."+sign(payload,deps.csrfSecret);
      res.cookie(cookie,csrf,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:expires-Date.now()});
      res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Review Lumin action</title><h1>Review this exact action</h1><p>Approving permits one attempt before expiry. Current deployment write policy still applies. Review the client, assets and complete content below.</p>${updateSendsPausedNote(view.plan)}<pre>${escape(JSON.stringify({client:view.ctx.clientId,actor:view.ctx.principal.operatorId,tool:view.ctx.tool,classes:view.plan.classes,assets:view.snapshot.assets.map(a=>({id:a.id,type:a.type,provider:a.provider,parents:a.parents})),input:view.plan.parameters,plan_hash:view.request.planHash},null,2))}</pre><form method="post" action="${escape(id)}"><input type="hidden" name="csrf" value="${escape(csrf)}"><button type="submit" name="decision" value="approve">Approve this exact action</button></form></html>`);
    }catch{res.status(403).type("text").send("Approval unavailable: expired, unauthorized, changed or unverified.");}
  });
  router.post("/:id",express.urlencoded({extended:false,limit:"4kb"}),async(req,res)=>{
    try{
      const principal=await deps.resolveSession(req),id=String(req.params.id),csrf=req.body?.csrf,stored=req.cookies?.[cookie];
      if(!principal || req.get("origin")!==deps.origin || req.body?.decision!=="approve" || typeof csrf!=="string" || typeof stored!=="string" || !equal(csrf,stored)){res.sendStatus(403);return;}
      const [payload,signature,...extra]=csrf.split(".");
      if(extra.length || !payload || !signature || !equal(signature,sign(payload,deps.csrfSecret))){res.sendStatus(403);return;}
      const decoded=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as {id?:unknown;principal?:PlatformPrincipal;expires?:unknown};
      if(decoded.id!==id || decoded.principal?.operatorId!==principal.operatorId || decoded.principal?.tenantId!==principal.tenantId || typeof decoded.expires!=="number" || !Number.isFinite(decoded.expires) || decoded.expires<=Date.now()){res.sendStatus(403);return;}
      const approvalId=await issueHumanApproval(deps.repo,principal,id);
      res.clearCookie(cookie,{httpOnly:true,secure:true,sameSite:"lax",path:"/"});
      res.type("text").send(`Approved one exact action. Approval reference: ${approvalId}. Return to Codex to continue. No action was executed by this page.`);
    }catch{res.status(403).type("text").send("Approval was not issued. Request expired, changed or already approved.");}
  });
  return router;
}
