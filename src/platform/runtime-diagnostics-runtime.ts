import express from "express";
import {getSession} from "../auth/session.js";
import {getPlatformRepository} from "./runtime.js";
import {PlatformDenied} from "./models.js";
import {inspectRuntimeCompatibility} from "./runtime-diagnostics.js";

/** Authenticated, administrator-only, read-only runtime compatibility endpoint. */
export function environmentRuntimeDiagnosticsRouter(): express.Router {
  const router = express.Router();
  router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");next();});
  router.get("/",async(req,res)=>{
    try {
      const session=await getSession(req);
      if(!session){res.sendStatus(401);return;}
      const repo=getPlatformRepository(),principal=await repo.resolvePrincipal(session.fbUserId);
      if(!principal)throw new PlatformDenied("PLATFORM_MEMBERSHIP_REQUIRED");
      res.json(await inspectRuntimeCompatibility(repo,principal));
    } catch(error) {
      const reason=error instanceof PlatformDenied?error.reason:"RUNTIME_DIAGNOSTICS_UNAVAILABLE";
      const forbidden=reason==="RUNTIME_DIAGNOSTICS_ADMIN_REQUIRED"||reason==="PLATFORM_MEMBERSHIP_REQUIRED";
      res.status(forbidden?403:503).json({status:"HOLD",reason});
    }
  });
  return router;
}
