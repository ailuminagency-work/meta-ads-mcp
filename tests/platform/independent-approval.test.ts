import cookieParser from "cookie-parser";
import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { requestProductApproval, issueHumanApproval } from "../../src/platform/approvals.js";
import { createApprovalRouter } from "../../src/platform/approval-router.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import type { OperationContext } from "../../src/platform/models.js";

const contract = PRODUCT_CONTRACTS.find(c => c.tool === "pages_create_feed")!;
const ctx: OperationContext = { principal: { tenantId: "tenant-fixture", operatorId: "actor-fixture" }, clientId: "client-fixture", tool: contract.tool, provider: contract.provider, requestId: "request-fixture" };
const human = { tenantId: "tenant-fixture", operatorId: "human-fixture" };
let server: Server | undefined;
beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("hex")));
afterEach(async () => { vi.unstubAllEnvs(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });

async function fixture() {
  const repo = new InMemoryPlatformRepository(), now = Date.now(), tenantId = ctx.principal.tenantId;
  await repo.put("tenants", tenantId, tenantId, { id: tenantId, status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
  await repo.put("clients", tenantId, ctx.clientId, { id: ctx.clientId, tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  for (const [operatorId, roles] of [[ctx.principal.operatorId, ["writer"]], [human.operatorId, ["approver"]]] as const) await repo.put("members", tenantId, operatorId, { operatorId, tenantId, roles: [...roles], allowedClientIds: [ctx.clientId], disabledAt: null, revision: 1 });
  await repo.put("assets", tenantId, "page-fixture", { key: "page-fixture", id: "123", type: "PAGE", tenantId, clientId: ctx.clientId, provider: contract.provider, appId: "app-fixture", parents: [], verifiedAt: now, revokedAt: null, revision: 1 });
  await repo.put("connections", tenantId, "connection-fixture", { id: "connection-fixture", tenantId, operatorId: ctx.principal.operatorId, provider: contract.provider, authStrategy: "fixture", credentialId: "credential-fixture", appId: "app-fixture", tokenType: "page", scopes: [...contract.requiredScopes], assetKeys: ["page-fixture"], expiresAt: now + 3600000, revokedAt: null, verifiedAt: now, revision: 1, eligibility: contract.manualRequirements.map(requirement => ({ requirement, source: "https://developers.facebook.com/docs/fixture", checkedAt: now, expiresAt: now + 3600000, verified: true })) });
  await repo.put("grants", tenantId, "grant-fixture", { id: "grant-fixture", tenantId, clientId: ctx.clientId, assetKey: "page-fixture", connectionId: "connection-fixture", capabilities: [contract.id], actions: [...contract.operationClasses], tasks: contract.requiredTasks ?? [], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1 });
  return repo;
}

describe("independent human approval adversarial tests", () => {
  it("rejects approver privilege revocation between inspection and issuance even without a revision bump", async () => {
    const repo = await fixture(), request = await requestProductApproval(repo, ctx, contract, "123", { message: "Synthetic reviewed action" });
    const get = repo.get.bind(repo);
    let humanReads = 0;
    repo.get = async (collection, tenantId, id) => {
      if (collection === "members" && id === human.operatorId && ++humanReads === 2) {
        const member = (await get("members", tenantId, id))!;
        await repo.put("members", tenantId, id, { ...member, roles: [] });
      }
      return get(collection, tenantId, id);
    };
    await expect(issueHumanApproval(repo, human, request.id)).rejects.toThrow();
    expect(await repo.list("approvals", human.tenantId)).toHaveLength(0);
  });
  it("keeps encrypted-plan identity and cross-tenant request lookup bound", async () => {
    const repo = await fixture(), request = await requestProductApproval(repo, ctx, contract, "123", { message: "Synthetic reviewed action" });
    await expect(issueHumanApproval(repo, { ...human, tenantId: "foreign-tenant" }, request.id)).rejects.toThrow();
    await repo.put("approvalRequests", human.tenantId, request.id, { ...request, actorId: human.operatorId });
    await expect(issueHumanApproval(repo, human, request.id)).rejects.toThrow();
    expect(await repo.list("approvals", human.tenantId)).toHaveLength(0);
  });
  it("requires same-origin signed CSRF and displays escaped exact content before one-time issuance", async () => {
    const repo = await fixture(), request = await requestProductApproval(repo, ctx, contract, "123", { message: "<img src=x onerror=alert(1)>" });
    const app = express();
    app.use(cookieParser());
    app.use("/platform/approvals", createApprovalRouter({ repo, origin: "https://fixture.invalid", csrfSecret: "synthetic-csrf-fixture-32-characters-long", resolveSession: async () => human }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/platform/approvals/${request.id}`;
    const view = await fetch(base), html = await view.text(), cookie = view.headers.get("set-cookie")!.split(";")[0];
    expect(html).toContain("&lt;img"); expect(html).not.toContain("<img src=x");
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
    const headers = { "content-type": "application/x-www-form-urlencoded", cookie, origin: "https://foreign.invalid" };
    const body = new URLSearchParams({ decision: "approve", csrf });
    expect((await fetch(base, { method: "POST", headers, body })).status).toBe(403);
    expect(await repo.list("approvals", human.tenantId)).toHaveLength(0);
    expect((await fetch(base, { method: "POST", headers: { ...headers, origin: "https://fixture.invalid" }, body })).status).toBe(200);
    expect((await fetch(base, { method: "POST", headers: { ...headers, origin: "https://fixture.invalid" }, body })).status).toBe(403);
    expect(await repo.list("approvals", human.tenantId)).toHaveLength(1);
  });
});
