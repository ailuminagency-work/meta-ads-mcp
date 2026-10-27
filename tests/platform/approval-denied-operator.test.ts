import express from "express";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHttpTransport } from "../../src/transport/http.js";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { resetSecretCacheForTests, setSession } from "../../src/auth/session.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { requestProductApproval } from "../../src/platform/approvals.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import type { OperationContext } from "../../src/platform/models.js";
import { establishManualEligibilityFixture } from "./manual-eligibility-fixture.js";

const ORIGIN = "https://approvals.example.com";
const SECRET = "synthetic-session-and-csrf-secret-0123456789";
const CSRF_COOKIE = "__Host-lumin_platform_approval";
const contract = PRODUCT_CONTRACTS.find(c => c.tool === "pages_create_feed")!;
const tenantId = "tenant-fixture", clientId = "client-fixture";
const actor = { tenantId, operatorId: "actor-fixture" }, human = { tenantId, operatorId: "human-fixture" }, outsider = { tenantId, operatorId: "outsider-fixture" };
const ctx: OperationContext = { principal: actor, clientId, tool: contract.tool, provider: contract.provider, requestId: "request-fixture" };

let httpServer: Server | undefined;
let base = "";

async function seed(overrides: { humanRoles?: string[]; humanClients?: string[] } = {}) {
  const repo = new InMemoryPlatformRepository(), now = Date.now();
  for (const principal of [actor, human, outsider]) await repo.put("operatorIndex", "_index", principal.operatorId, principal);
  await repo.put("tenants", tenantId, tenantId, { id: tenantId, status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
  await repo.put("clients", tenantId, clientId, { id: clientId, tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  const members: Array<[string, string[], string[]]> = [
    [actor.operatorId, ["writer"], [clientId]],
    [human.operatorId, overrides.humanRoles ?? ["approver"], overrides.humanClients ?? [clientId]],
    [outsider.operatorId, ["reader", "writer"], [clientId]],
  ];
  for (const [operatorId, roles, allowedClientIds] of members) await repo.put("members", tenantId, operatorId, { operatorId, tenantId, roles, allowedClientIds, disabledAt: null, revision: 1 });
  await repo.put("assets", tenantId, "page-fixture", { key: "page-fixture", id: "123", type: "PAGE", tenantId, clientId, provider: contract.provider, appId: "300", parents: [], verifiedAt: now, revokedAt: null, revision: 1 });
  await repo.put("connections", tenantId, "connection-fixture", { id: "connection-fixture", tenantId, operatorId: actor.operatorId, provider: contract.provider, authStrategy: "fixture", credentialId: "credential-fixture", appId: "300", tokenType: "page", subjectId: "123", scopes: [...contract.requiredScopes], assetKeys: ["page-fixture"], expiresAt: now + 3600000, revokedAt: null, verifiedAt: now, revision: 1, eligibility: [] });
  await repo.put("grants", tenantId, "grant-fixture", { id: "grant-fixture", tenantId, clientId, assetKey: "page-fixture", connectionId: "connection-fixture", capabilities: [contract.id], actions: [...contract.operationClasses], tasks: contract.requiredTasks ?? [], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1 });
  await establishManualEligibilityFixture(repo, tenantId, clientId, "connection-fixture");
  configurePlatformRepository(repo);
  return repo;
}

async function sessionCookieFor(operatorId: string): Promise<string> {
  let cookie = "";
  await setSession({ cookie: (name: string, value: string) => { cookie = `${name}=${value}`; } } as unknown as express.Response, { fbUserId: operatorId, email: null, name: null });
  return cookie;
}

async function boot() {
  vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Express) {
    httpServer = createNodeServer(this);
    httpServer.listen(0, "127.0.0.1");
    return httpServer;
  } as typeof express.application.listen);
  await startHttpTransport(() => new McpServer({ name: "approval-http-test", version: "1" }), 0);
  if (!httpServer!.listening) await new Promise<void>(resolve => httpServer!.once("listening", resolve));
  base = `http://127.0.0.1:${(httpServer!.address() as AddressInfo).port}`;
}

beforeEach(() => {
  for (const [key, value] of Object.entries({
    DEPLOYMENT_MODE: "upstream", SERVER_URL: ORIGIN, SESSION_COOKIE_SECRET: SECRET, TOKEN_ENCRYPTION_KEY: "d".repeat(64),
    LUMIN_PLATFORM_ENABLED: "true", LUMIN_PLATFORM_WRITES_ENABLED: "true", AGENCY_WRITES_ENABLED: "true",
    META_APP_ID: "", META_APP_SECRET: "", MCP_API_KEY: "", META_ACCESS_TOKEN: "", META_TOKENS: "", LUMIN_META_PRIVACY_ENABLED: "false",
    OAUTH_SECRET: randomBytes(32).toString("hex"),
  })) vi.stubEnv(key, value);
  resetOAuthProviderForTests();
  resetSecretCacheForTests();
});
afterEach(async () => {
  configurePlatformRepository(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (httpServer) await new Promise<void>(resolve => httpServer!.close(() => resolve()));
  httpServer = undefined;
});

const csrfFrom = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)![1];
const form = (csrf: string | null, decision: string | null = "approve") => { const body = new URLSearchParams(); if (csrf !== null) body.set("csrf", csrf); if (decision !== null) body.set("decision", decision); return body; };
const post = (id: string, headers: Record<string, string>, body: URLSearchParams) => fetch(`${base}/platform/approvals/${id}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });
async function review(requestId: string, sessionCookie: string) {
  const view = await fetch(`${base}/platform/approvals/${requestId}`, { headers: { cookie: sessionCookie } });
  const html = await view.text();
  if (view.status !== 200) return { status: view.status, html, csrf: "", cookie: "" };
  return { status: view.status, html, csrf: csrfFrom(html), cookie: `${sessionCookie}; ${view.headers.get("set-cookie")!.split(";")[0]}` };
}

async function prepared(message = "Synthetic reviewed action", roles?: { humanRoles?: string[]; humanClients?: string[] }) {
  const repo = await seed(roles);
  const request = await requestProductApproval(repo, ctx, contract, "123", { message });
  await boot();
  return { repo, request, humanSession: await sessionCookieFor(human.operatorId) };
}



describe("a denied or de-allowlisted operator cannot issue a human approval from a live session", () => {
  it("lets an operator who is still allowed review and approve (control)", async () => {
    const { repo, request, humanSession } = await prepared();
    vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", human.operatorId);
    const flow = await review(request.id, humanSession);
    expect(flow.status).toBe(200);
    const response = await post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf));
    expect(response.status).toBeLessThan(400);
    expect(await repo.list("approvals", tenantId)).toHaveLength(1);
  });

  for (const [label, revoke] of [
    ["is on AUTH_DENIED_FB_USER_IDS", () => vi.stubEnv("AUTH_DENIED_FB_USER_IDS", human.operatorId)],
    ["was removed from AUTH_ALLOWED_FB_USER_IDS", () => vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", "someone-else")],
  ] as const) {
    it(`refuses the review page and the approval once the operator ${label}`, async () => {
      const { repo, request, humanSession } = await prepared();
      vi.stubEnv("AUTH_ALLOWED_FB_USER_IDS", human.operatorId);
      const earlier = await review(request.id, humanSession);
      expect(earlier.status).toBe(200);

      revoke();
      const flow = await review(request.id, humanSession);
      expect(flow.status).not.toBe(200);
      const response = await post(request.id, { cookie: earlier.cookie, origin: ORIGIN }, form(earlier.csrf));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    });
  }
});
