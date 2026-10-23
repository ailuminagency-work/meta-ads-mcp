import express from "express";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { PlatformOAuthService } from "./oauth.js";

export interface PlatformOAuthRouterDependencies {
  service: PlatformOAuthService;
  publicOrigin: string;
  getSessionOperator(req: express.Request): Promise<string | null>;
  getNextSteps?(operatorId:string,clientId:string,result:{connectionId:string;provider:string}):Promise<Array<{label:string;path:string}>>;
}
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
const cookieName = (state: string): string => `__Host-lumin-connect-${state}`;
const cookieSchema = z.object({ clientId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), nonce: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

function sameOriginRequest(req: express.Request, expectedOrigin: string): boolean {
  const origin = req.get("origin");
  if (origin) return origin === expectedOrigin;
  const referer = req.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
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
      if (!operator) {
        res.redirect(302, `/auth/meta?return=${encodeURIComponent("/platform/connections/")}`);
        return;
      }
      if (!sameOriginRequest(req, deps.publicOrigin)) {
        res.status(403).json({ status: "HOLD", reason: "OAUTH_ORIGIN_MISMATCH" });
        return;
      }
      const body = z.object({ client_id: cookieSchema.shape.clientId }).strict().safeParse(req.body);
      if (!body.success || !/^[A-Za-z0-9_-]{1,128}$/.test(req.params.profileId)) { res.sendStatus(400); return; }
      const started = await deps.service.start(operator, body.data.client_id, req.params.profileId);
      res.cookie(cookieName(started.state), Buffer.from(JSON.stringify({ clientId: body.data.client_id, nonce: started.browserNonce })).toString("base64url"), { ...cookieOptions, maxAge: 600000 });
      res.redirect(303, started.authorizeUrl);
    } catch { res.status(503).json({ status: "HOLD", reason: "OAUTH_START_UNAVAILABLE" }); }
  });
  router.get("/:profileId/callback", async (req, res) => {
    try {
      const operator = await deps.getSessionOperator(req);
      if (!operator) {
        res.status(401).type("html").send("<p>Session expired. Return to the client connections page and reconnect.</p>");
        return;
      }
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
    } catch { res.status(503).json({ status: "HOLD", reason: "OAUTH_CALLBACK_UNAVAILABLE" }); }
  });
  router.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ status: "HOLD", reason: "INVALID_OAUTH_REQUEST" }); });
  return router;
}
