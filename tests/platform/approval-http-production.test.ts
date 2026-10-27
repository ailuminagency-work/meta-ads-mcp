import express from "express";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OperationContext } from "../../src/platform/models.js";

const ORIGIN = "https://approvals.example.com";
const SECRET = "synthetic-session-and-csrf-secret-0123456789";
const tenantId = "tenant-fixture", clientId = "client-fixture";
const actor = { tenantId, operatorId: "actor-fixture" }, human = { tenantId, operatorId: "human-fixture" };

type Modules = {
  start: typeof import("../../src/transport/http.js")["startHttpTransport"];
  setSession: typeof import("../../src/auth/session.js")["setSession"];
  repo: import("../../src/platform/repository.js").InMemoryPlatformRepository;
  request: { id: string };
};
let httpServer: Server | undefined;
let base = "";
let m: Modules;

beforeAll(async () => {
  for (const [key, value] of Object.entries({
    NODE_ENV: "production", DEPLOYMENT_MODE: "upstream", SERVER_URL: ORIGIN, SESSION_COOKIE_SECRET: SECRET, TOKEN_ENCRYPTION_KEY: "d".repeat(64),
    LUMIN_PLATFORM_ENABLED: "true", LUMIN_PLATFORM_WRITES_ENABLED: "true", AGENCY_WRITES_ENABLED: "true",
    META_APP_ID: "", META_APP_SECRET: "", MCP_API_KEY: "", META_ACCESS_TOKEN: "", META_TOKENS: "", LUMIN_META_PRIVACY_ENABLED: "false",
    OAUTH_SECRET: randomBytes(32).toString("hex"), AUTH_ALLOWED_FB_USER_IDS: human.operatorId,
  })) vi.stubEnv(key, value);
  vi.resetModules();
  const { InMemoryPlatformRepository } = await import("../../src/platform/repository.js");
  const { configurePlatformRepository } = await import("../../src/platform/runtime.js");
  const { requestProductApproval } = await import("../../src/platform/approvals.js");
  const { PRODUCT_CONTRACTS } = await import("../../src/platform/products/contracts.js");
  const { establishManualEligibilityFixture } = await import("./manual-eligibility-fixture.js");
  const contract = PRODUCT_CONTRACTS.find(c => c.tool === "pages_create_feed")!;
  const repo = new InMemoryPlatformRepository(), now = Date.now();
  for (const principal of [actor, human]) await repo.put("operatorIndex", "_index", principal.operatorId, principal);
  await repo.put("tenants", tenantId, tenantId, { id: tenantId, status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
  await repo.put("clients", tenantId, clientId, { id: clientId, tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  await repo.put("members", tenantId, actor.operatorId, { operatorId: actor.operatorId, tenantId, roles: ["writer"], allowedClientIds: [clientId], disabledAt: null, revision: 1 });
  await repo.put("members", tenantId, human.operatorId, { operatorId: human.operatorId, tenantId, roles: ["approver"], allowedClientIds: [clientId], disabledAt: null, revision: 1 });
  await repo.put("assets", tenantId, "page-fixture", { key: "page-fixture", id: "123", type: "PAGE", tenantId, clientId, provider: contract.provider, appId: "300", parents: [], verifiedAt: now, revokedAt: null, revision: 1 });
  await repo.put("connections", tenantId, "connection-fixture", { id: "connection-fixture", tenantId, operatorId: actor.operatorId, provider: contract.provider, authStrategy: "fixture", credentialId: "credential-fixture", appId: "300", tokenType: "page", subjectId: "123", scopes: [...contract.requiredScopes], assetKeys: ["page-fixture"], expiresAt: now + 3600000, revokedAt: null, verifiedAt: now, revision: 1, eligibility: [] });
  await repo.put("grants", tenantId, "grant-fixture", { id: "grant-fixture", tenantId, clientId, assetKey: "page-fixture", connectionId: "connection-fixture", capabilities: [contract.id], actions: [...contract.operationClasses], tasks: contract.requiredTasks ?? [], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1 });
  await establishManualEligibilityFixture(repo, tenantId, clientId, "connection-fixture");
  configurePlatformRepository(repo);
  const ctx: OperationContext = { principal: actor, clientId, tool: contract.tool, provider: contract.provider, requestId: "request-fixture" };
  const request = await requestProductApproval(repo, ctx, contract, "123", { message: "Synthetic reviewed action" });
  const { startHttpTransport } = await import("../../src/transport/http.js");
  const { setSession } = await import("../../src/auth/session.js");
  vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Express) {
    httpServer = createNodeServer(this);
    httpServer.listen(0, "127.0.0.1");
    return httpServer;
  } as typeof express.application.listen);
  await startHttpTransport(() => new McpServer({ name: "approval-production-test", version: "1" }), 0);
  if (!httpServer!.listening) await new Promise<void>(resolve => httpServer!.once("listening", resolve));
  base = `http://127.0.0.1:${(httpServer!.address() as AddressInfo).port}`;
  m = { start: startHttpTransport, setSession, repo, request };
});
afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (httpServer) await new Promise<void>(resolve => httpServer!.close(() => resolve()));
});

async function humanSession(): Promise<string> {
  let cookie = "";
  await m.setSession({ cookie: (name: string, value: string, options: { secure?: boolean; httpOnly?: boolean; sameSite?: string }) => { expect(options).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" }); cookie = `${name}=${value}`; } } as unknown as express.Response, { fbUserId: human.operatorId, email: null, name: null });
  return cookie;
}

describe("approval routes behind the production transport guard", () => {
  it("uses the __Host- session cookie and refuses plain-http requests before any approval logic", async () => {
    const session = await humanSession();
    expect(session.startsWith("__Host-mcp_session=")).toBe(true);
    const plain = await fetch(`${base}/platform/approvals/${m.request.id}`, { headers: { cookie: session }, redirect: "manual" });
    expect(plain.status).toBe(301);
    expect(plain.headers.get("location")).toBe(`${ORIGIN}/platform/approvals/${m.request.id}`);
    expect(await m.repo.list("approvals", tenantId)).toHaveLength(0);
  });

  it("completes the browser approval over the proxied https hop and sets hardened headers and cookies", async () => {
    const session = await humanSession();
    const view = await fetch(`${base}/platform/approvals/${m.request.id}`, { headers: { cookie: session, "x-forwarded-proto": "https" } });
    expect(view.status).toBe(200);
    expect(view.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(view.headers.get("cache-control")).toBe("no-store");
    const setCookie = view.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^__Host-lumin_platform_approval=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);
    const csrf = /name="csrf" value="([^"]+)"/.exec(await view.text())![1];
    const headers = { cookie: `${session}; ${setCookie.split(";")[0]}`, origin: ORIGIN, "x-forwarded-proto": "https", "content-type": "application/x-www-form-urlencoded" };
    expect((await fetch(`${base}/platform/approvals/${m.request.id}`, { method: "POST", headers: { ...headers, origin: "https://evil.example.net" }, body: new URLSearchParams({ csrf, decision: "approve" }) })).status).toBe(403);
    expect((await fetch(`${base}/platform/approvals/${m.request.id}`, { method: "POST", headers, body: new URLSearchParams({ csrf, decision: "approve" }) })).status).toBe(200);
    expect(await m.repo.list("approvals", tenantId)).toHaveLength(1);
  });
});
