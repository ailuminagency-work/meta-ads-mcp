import type express from "express";
import { createApprovalRouter } from "./approval-router.js";
import { getPlatformRepository, platformEnabled, platformWritesEnabled } from "./runtime.js";

export interface ApprovalRoutesInput { origin: string; resolveOperatorId(req: express.Request): Promise<string | null> }
/** Human approval review and issuance exist only while the platform flag is on, and refuse while platform writes are off. */
export function mountApprovalRoutes(app: express.Express, input: ApprovalRoutesInput): boolean {
  if (!platformEnabled()) return false;
  const repo = getPlatformRepository();
  app.use("/platform/approvals", createApprovalRouter({
    repo,
    origin: input.origin,
    csrfSecret: process.env.SESSION_COOKIE_SECRET ?? "",
    writesEnabled: platformWritesEnabled,
    resolveSession: async req => {
      const operatorId = await input.resolveOperatorId(req);
      return operatorId ? repo.resolvePrincipal(operatorId) : null;
    },
  }));
  return true;
}
