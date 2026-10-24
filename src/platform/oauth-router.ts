import {logOAuthFailure} from "./oauth-diagnostics.js";
import express from "express";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { PlatformOAuthService } from "./oauth.js";
import { verifyOAuthStartProof } from "./oauth-start-proof.js";
import { logger } from "../utils/logger.js";
import {randomBytes} from "node:crypto";
import {OAuthAssetSelectionRequired} from "./oauth.js";
import {PlatformDenied} from "./models.js";

export interface PlatformOAuthRouterDependencies {
  service: PlatformOAuthService;
  publicOrigin: string;
  getSessionOperator(req: express.Request): Promise<string | null>;
  getNextSteps?(operatorId:string,clientId:string,result:{connectionId:string;provider:string}):Promise<Array<{label:string;path:string}>>;
}
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
const cookieName = (state: string): string => `__Host-lumin-connect-${state}`;
const selectionCookieName = (proposalId: string): string => `__Host-lumin-select-${proposalId}`;
const cookieSchema = z.object({ clientId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), nonce: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

function isSameOriginBrowserPost(req: express.Request, publicOrigin: string): boolean {
  const fetchSite = req.get("sec-fetch-site");
  const fetchMode = req.get("sec-fetch-mode");
  const fetchDest = req.get("sec-fetch-dest");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const suppliedOrigin = req.get("origin");
  if (suppliedOrigin) return suppliedOrigin === publicOrigin;
  return fetchSite === "same-origin" && fetchMode === "navigate" && fetchDest === "document";
}

export function createPlatformOAuthRouter(deps: PlatformOAuthRouterDependencies): express.Router {
  const origin = new URL(deps.publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== deps.publicOrigin) throw new Error("OAuth publicOrigin must be an HTTPS origin");
  const router = express.Router();
  router.use(cookieParser(), express.json({ limit: "16kb" }),express.urlencoded({extended:false,limit:"4kb"}));
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
  router.post("/:profileId/start", async (req, res) => {
    try {
      const operator = await deps.getSessionOperator(req);
      if (!operator) { res.sendStatus(401); return; }
      const body = z.object({ client_id: cookieSchema.shape.clientId, start_proof: z.string().max(512).optional() }).strict().safeParse(req.body);
      if (!body.success || !/^[A-Za-z0-9_-]{1,128}$/.test(req.params.profileId)) { res.sendStatus(400); return; }
      const suppliedOrigin = req.get("origin");
      const fetchSite = req.get("sec-fetch-site");
      const proofValid = body.data.start_proof !== undefined && verifyOAuthStartProof(process.env.OAUTH_SECRET ?? "", body.data.start_proof, operator, req.params.profileId);
      const denial = suppliedOrigin && suppliedOrigin !== deps.publicOrigin ? "ORIGIN_MISMATCH" :
        fetchSite === "cross-site" ? "CROSS_SITE_REQUEST" :
        body.data.start_proof !== undefined && !proofValid ? "INVALID_START_PROOF" :
        !proofValid && !isSameOriginBrowserPost(req, deps.publicOrigin) ? "BROWSER_ORIGIN_UNVERIFIED" : null;
      if (denial) { logger.warn({ reason: denial }, "Platform OAuth start rejected"); res.sendStatus(403); return; }
      const started = await deps.service.start(operator, body.data.client_id, req.params.profileId);
      res.cookie(cookieName(started.state), Buffer.from(JSON.stringify({ clientId: body.data.client_id, nonce: started.browserNonce })).toString("base64url"), { ...cookieOptions, maxAge: 600000 });
      res.redirect(303, started.authorizeUrl);
    } catch { res.status(503).json({ status: "HOLD", reason: "OAUTH_START_UNAVAILABLE" }); }
  });
  router.post("/:profileId/select", async (req,res)=>{
    try {
      const operator=await deps.getSessionOperator(req);if(!operator){res.sendStatus(401);return;}
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.profileId)) {res.sendStatus(400);return;}
      const body=z.object({proposal_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),asset_id:z.string().regex(/^\d{1,100}$/),csrf:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(req.body);
      if(!body.success||!isSameOriginBrowserPost(req,deps.publicOrigin)){res.sendStatus(403);return;}
      const cookie=req.cookies?.[selectionCookieName(body.data.proposal_id)];if(typeof cookie!=="string"||cookie!==body.data.csrf){res.sendStatus(403);return;}
      res.clearCookie(selectionCookieName(body.data.proposal_id),cookieOptions);
      const result=await deps.service.enrollDiscoveredAsset(operator,body.data.proposal_id,body.data.asset_id);
      if(req.get("accept")?.includes("text/html")){res.setHeader("Content-Security-Policy","default-src 'none'; base-uri 'none'; frame-ancestors 'none'");res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client product connected</title><h1>Client product connected</h1><p>The selected Meta advertising account was securely connected. No ads or messages were sent.</p><p><a href="/platform/connections/">Return to client connections</a></p></html>`);return;}
      res.json({status:"CONNECTED",...result});
    }catch(error){logOAuthFailure("callback",error);res.status(503).json({status:"HOLD",reason:error instanceof PlatformDenied?error.reason:"OAUTH_ASSET_SELECTION_UNAVAILABLE"});}
  });
  router.get("/:profileId/callback", async (req, res) => {
    try {
      const operator = await deps.getSessionOperator(req);
      if (!operator) { res.sendStatus(401); return; }
      const query = z.object({ state: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().min(1).max(4096) }).strict().safeParse(req.query);
      if (!query.success || !/^[A-Za-z0-9_-]{1,128}$/.test(req.params.profileId)) { res.sendStatus(400); return; }
      const state = query.data.state;
      res.clearCookie(cookieName(state), cookieOptions);
      const rawCookie: unknown = req.cookies?.[cookieName(state)];
      if (typeof rawCookie !== "string" || rawCookie.length > 1024) { res.sendStatus(403); return; }
      const cookie = cookieSchema.safeParse(JSON.parse(Buffer.from(rawCookie, "base64url").toString("utf8")));
      if (!cookie.success) { res.sendStatus(403); return; }
      const result = await deps.service.callback({ operatorId: operator, clientId: cookie.data.clientId, profileId: req.params.profileId, state, browserNonce: cookie.data.nonce, code: query.data.code });
      let nextSteps:Array<{label:string;path:string}>=[];
      try{nextSteps=z.array(z.object({label:z.string().min(1).max(120),path:z.string().regex(/^\/platform\/[A-Za-z0-9_/-]{1,500}$/)}).strict()).max(20).parse(await deps.getNextSteps?.(operator,cookie.data.clientId,result)??[]);}catch{nextSteps=[];}
      if(req.get("accept")?.includes("text/html")){const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));res.setHeader("Content-Security-Policy","default-src 'none'; base-uri 'none'; frame-ancestors 'none'");res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client product connected</title><h1>Client product connected</h1><p>Meta access was checked for ${escape(cookie.data.clientId)}. ${result.assetCount} selected assets were connected. This does not verify client ownership or billing, and no ads or messages were sent.</p>${nextSteps.length?'<h2>Next review</h2><ul>'+nextSteps.map(step=>'<li><a href="'+escape(step.path)+'">'+escape(step.label)+'</a></li>').join('')+'</ul>':''}<p><a href="/platform/connections/">Return to client connections</a></p></html>`);return;}
      res.json({ status: "CONNECTED", ...result,...(nextSteps.length?{next_steps:nextSteps}:{}) });
    } catch(error) {
      if(error instanceof OAuthAssetSelectionRequired){
        const csrf=randomBytes(32).toString("hex");res.cookie(selectionCookieName(error.proposalId),csrf,{...cookieOptions,maxAge:600000});
        const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
        if(req.get("accept")?.includes("text/html")){res.setHeader("Content-Security-Policy","default-src 'none'; base-uri 'none'; frame-ancestors 'none'");res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Select Meta account</title><h1>Select a Meta advertising account</h1><p>Meta authorized these accounts for the signed-in Lumin operator. Choose the account for this client.</p><form method="post" action="/${escape(req.params.profileId)}/select"><input type="hidden" name="proposal_id" value="${escape(error.proposalId)}"><input type="hidden" name="csrf" value="${csrf}"><label>Advertising account <select name="asset_id" required>${error.assets.map(asset=>`<option value="${escape(asset.id)}">${escape(asset.id)}</option>`).join("")}</select></label><button type="submit">Connect selected account</button></form></html>`);return;}
        res.status(409).json({status:"AWAITING_ASSET_SELECTION",proposal_id:error.proposalId,assets:error.assets});return;
      }
      logOAuthFailure("callback",error);res.status(503).json({ status: "HOLD", reason: "OAUTH_CALLBACK_UNAVAILABLE" });
    }
  });
  router.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ status: "HOLD", reason: "INVALID_OAUTH_REQUEST" }); });
  return router;
}

