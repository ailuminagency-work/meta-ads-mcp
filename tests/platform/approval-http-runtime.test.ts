import express from "express";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHttpTransport } from "../../src/transport/http.js";
import { createServer } from "../../src/server.js";
import { requestContext } from "../../src/auth/token-store.js";
import { resetOAuthProviderForTests } from "../../src/auth/oauth-provider.js";
import { resetSecretCacheForTests, setSession } from "../../src/auth/session.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { inspectApprovalRequest, requestProductApproval } from "../../src/platform/approvals.js";
import { authorizeOperation } from "../../src/platform/execution.js";
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
const mint = (payload: Record<string, unknown>, options: { secret?: string; prefix?: string } = {}) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", options.secret ?? SECRET).update((options.prefix ?? "") + body).digest("hex")}`;
};

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

describe("human approval routes in the real HTTP runtime (flags on)", () => {
  it("is not mounted when the platform flag is off", async () => {
    vi.stubEnv("LUMIN_PLATFORM_ENABLED", "false");
    await boot();
    const response = await fetch(`${base}/platform/approvals/${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}`, { headers: { cookie: await sessionCookieFor(human.operatorId) } });
    expect(response.status).toBe(404);
  });

  it("refuses to start with the flag on but without an https origin or a long enough secret", async () => {
    vi.stubEnv("SESSION_COOKIE_SECRET", "short");
    await expect(startHttpTransport(() => new McpServer({ name: "approval-http-test", version: "1" }), 0)).rejects.toThrow("VERIFIED_APPROVAL_ORIGIN_AND_SECRET_REQUIRED");
  });

  it("issues exactly one approval to an authorized browser session and that approval is usable once by the requesting actor", async () => {
    const { repo, request, humanSession } = await prepared();
    const inspected = await inspectApprovalRequest(repo, human, request.id);
    const flow = await review(request.id, humanSession);
    expect(flow.status).toBe(200);
    expect(flow.html).toContain("Review this exact action");
    const response = await post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf));
    expect(response.status).toBe(200);
    const approvals = await repo.list("approvals", tenantId);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ approverId: human.operatorId, actorId: actor.operatorId, clientId, consumedAt: null });
    const permit = await authorizeOperation(repo, ctx, inspected.plan, { writesEnabled: true, approvalId: approvals[0].id });
    expect(permit.operationId).toBeTruthy();
    await expect(authorizeOperation(repo, ctx, inspected.plan, { writesEnabled: true, approvalId: approvals[0].id })).rejects.toThrow(/APPROVAL_INVALID_OR_REPLAYED|OPERATION_ALREADY_EXISTS/);
    await expect(authorizeOperation(repo, { ...ctx, principal: human }, inspected.plan, { writesEnabled: true, approvalId: approvals[0].id })).rejects.toThrow();
  });

  it.each([
    ["no session cookie", () => ""],
    ["an unsigned session cookie", () => "mcp_session=not-a-jwt"],
  ])("rejects review and approval with %s", async (_label, cookie) => {
    const { repo, request, humanSession } = await prepared();
    const flow = await review(request.id, humanSession);
    expect((await fetch(`${base}/platform/approvals/${request.id}`, { headers: { cookie: cookie() } })).status).toBe(403);
    expect((await post(request.id, { cookie: [cookie(), flow.cookie.split("; ")[1]].filter(Boolean).join("; "), origin: ORIGIN }, form(flow.csrf))).status).toBe(403);
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
  });

  it("denies a session without the approver or admin role, including the requesting writer", async () => {
    const { repo, request, humanSession } = await prepared();
    const approverFlow = await review(request.id, humanSession);
    for (const principal of [outsider, actor]) {
      const session = await sessionCookieFor(principal.operatorId);
      expect((await review(request.id, session)).status).toBe(403);
      const borrowed = await post(request.id, { cookie: `${session}; ${approverFlow.cookie.split("; ")[1]}`, origin: ORIGIN }, form(approverFlow.csrf));
      expect(borrowed.status).toBe(403);
    }
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
  });

  it("denies an approver who is not assigned to the request's client", async () => {
    const { repo, request, humanSession } = await prepared("Synthetic reviewed action", { humanClients: ["another-client"] });
    expect((await review(request.id, humanSession)).status).toBe(403);
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
  });

  it("denies an approver whose membership was disabled after the review page loaded", async () => {
    const { repo, request, humanSession } = await prepared();
    const flow = await review(request.id, humanSession);
    const member = (await repo.get("members", tenantId, human.operatorId))!;
    await repo.put("members", tenantId, human.operatorId, { ...member, disabledAt: Date.now(), revision: member.revision + 1 });
    expect((await post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))).status).toBe(403);
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
  });

  it("denies an expired request on review and on a CSRF token issued before expiry", async () => {
    const { repo, request, humanSession } = await prepared();
    const flow = await review(request.id, humanSession);
    await repo.put("approvalRequests", tenantId, request.id, { ...request, expiresAt: Date.now() - 1 });
    expect((await post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))).status).toBe(403);
    expect((await review(request.id, humanSession)).status).toBe(403);
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
  });

  it("denies a correctly signed CSRF token whose own expiry has passed", async () => {
    const { repo, request, humanSession } = await prepared();
    const stale = mint({ id: request.id, principal: human, expires: Date.now() - 1000, nonce: "n".repeat(64) }, { prefix: "lumin-platform-approval-csrf\n" });
    const response = await post(request.id, { cookie: `${humanSession}; ${CSRF_COOKIE}=${stale}`, origin: ORIGIN }, form(stale));
    expect(response.status).toBe(403);
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
  });

  it("is one-use: a replayed submission and a freshly reviewed page both fail after the first approval", async () => {
    const { repo, request, humanSession } = await prepared();
    const flow = await review(request.id, humanSession);
    expect((await post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))).status).toBe(200);
    expect((await post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))).status).toBe(403);
    expect((await review(request.id, humanSession)).status).toBe(403);
    expect(await repo.list("approvals", tenantId)).toHaveLength(1);
  });

  it("issues at most one approval under concurrent submissions", async () => {
    const { repo, request, humanSession } = await prepared();
    const flow = await review(request.id, humanSession);
    const statuses = (await Promise.all([1, 2, 3, 4].map(() => post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))))).map(r => r.status);
    expect(statuses.filter(s => s === 200)).toHaveLength(1);
    expect(await repo.list("approvals", tenantId)).toHaveLength(1);
  });

  describe("CSRF", () => {
    it.each([
      ["missing token field", (f: { csrf: string }) => ({ body: form(null), cookieValue: f.csrf })],
      ["missing token cookie", (f: { csrf: string }) => ({ body: form(f.csrf), cookieValue: undefined })],
      ["cookie that differs from the form token", (f: { csrf: string }) => ({ body: form(f.csrf), cookieValue: f.csrf.slice(0, -2) + "00" })],
      ["missing decision", (f: { csrf: string }) => ({ body: form(f.csrf, null), cookieValue: f.csrf })],
      ["a decision other than approve", (f: { csrf: string }) => ({ body: form(f.csrf, "deny"), cookieValue: f.csrf })],
    ])("rejects %s", async (_label, build) => {
      const { repo, request, humanSession } = await prepared();
      const flow = await review(request.id, humanSession);
      const { body, cookieValue } = build(flow);
      const cookie = cookieValue === undefined ? humanSession : `${humanSession}; ${CSRF_COOKIE}=${cookieValue}`;
      expect((await post(request.id, { cookie, origin: ORIGIN }, body)).status).toBe(403);
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    });

    it("rejects forged tokens: wrong secret, no domain separation, another request, another principal, tampered payload", async () => {
      const { repo, request, humanSession } = await prepared();
      const good = { id: request.id, principal: human, expires: Date.now() + 120000, nonce: "n".repeat(64) };
      const forged = [
        mint(good, { secret: "another-secret-of-sufficient-length-0000", prefix: "lumin-platform-approval-csrf\n" }),
        mint(good),
        mint({ ...good, id: "f".repeat(8) + "-ffff-ffff-ffff-" + "f".repeat(12) }, { prefix: "lumin-platform-approval-csrf\n" }),
        mint({ ...good, principal: outsider }, { prefix: "lumin-platform-approval-csrf\n" }),
        mint(good, { prefix: "lumin-platform-approval-csrf\n" }).replace(/^[^.]+/, Buffer.from(JSON.stringify({ ...good, expires: Date.now() + 86400000 })).toString("base64url")),
      ];
      for (const token of forged) {
        const response = await post(request.id, { cookie: `${humanSession}; ${CSRF_COOKIE}=${token}`, origin: ORIGIN }, form(token));
        expect(response.status).toBe(403);
      }
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    });

    it("accepts only the router's own domain-separated token", async () => {
      const { repo, request, humanSession } = await prepared();
      const genuine = mint({ id: request.id, principal: human, expires: Date.now() + 120000, nonce: "n".repeat(64) }, { prefix: "lumin-platform-approval-csrf\n" });
      expect((await post(request.id, { cookie: `${humanSession}; ${CSRF_COOKIE}=${genuine}`, origin: ORIGIN }, form(genuine))).status).toBe(200);
      expect(await repo.list("approvals", tenantId)).toHaveLength(1);
    });
  });

  describe("Origin", () => {
    it.each([
      ["a foreign origin", "https://evil.example.net"],
      ["the same host over http", "http://approvals.example.com"],
      ["a sibling subdomain", "https://x.approvals.example.com"],
      ["the opaque null origin", "null"],
      ["a missing origin", undefined],
    ])("rejects a submission with %s even with a valid session and token", async (_label, origin) => {
      const { repo, request, humanSession } = await prepared();
      const flow = await review(request.id, humanSession);
      const headers: Record<string, string> = { cookie: flow.cookie };
      if (origin !== undefined) headers.origin = origin;
      expect((await post(request.id, headers, form(flow.csrf))).status).toBe(403);
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    });

    it("does not accept a Referer in place of Origin", async () => {
      const { repo, request, humanSession } = await prepared();
      const flow = await review(request.id, humanSession);
      expect((await post(request.id, { cookie: flow.cookie, referer: `${ORIGIN}/platform/approvals/${request.id}` }, form(flow.csrf))).status).toBe(403);
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    });

    it("does not enable CORS for the approval routes", async () => {
      const { request, humanSession } = await prepared();
      const preflight = await fetch(`${base}/platform/approvals/${request.id}`, { method: "OPTIONS", headers: { origin: "https://evil.example.net", "access-control-request-method": "POST" } });
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      const flow = await fetch(`${base}/platform/approvals/${request.id}`, { headers: { cookie: humanSession, origin: "https://evil.example.net" } });
      expect(flow.headers.get("access-control-allow-origin")).toBeNull();
      expect(flow.headers.get("cache-control")).toBe("no-store");
      expect(flow.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(flow.headers.get("x-frame-options")).toBe("DENY");
    });
  });

  it.each([["LUMIN_PLATFORM_WRITES_ENABLED"], ["AGENCY_WRITES_ENABLED"]])("neither shows nor issues approvals while %s is off", async flag => {
    const repo = await seed();
    const request = await requestProductApproval(repo, ctx, contract, "123", { message: "Synthetic reviewed action" });
    await boot();
    const session = await sessionCookieFor(human.operatorId);
    const flow = await review(request.id, session);
    expect(flow.status).toBe(200);
    vi.stubEnv(flag, "false");
    const refused = await fetch(`${base}/platform/approvals/${request.id}`, { headers: { cookie: session } });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("writes are disabled");
    expect((await post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))).status).toBe(403);
    expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    vi.stubEnv(flag, "true");
    expect((await post(request.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))).status).toBe(200);
  });

  describe("who may approve", () => {
    it("rejects malformed request identifiers without touching the repository", async () => {
      const { repo, humanSession } = await prepared();
      const get = vi.spyOn(repo, "get");
      for (const id of ["not-a-uuid", "..%2f..%2fetc", "A".repeat(36), "a".repeat(37)]) expect((await fetch(`${base}/platform/approvals/${id}`, { headers: { cookie: humanSession } })).status).toBe(403);
      expect(get.mock.calls.filter(([collection]) => collection === "approvalRequests")).toHaveLength(0);
    });

    it("by default lets a member holding both the writer and approver roles approve their own browser review", async () => {
      const { repo, request } = await prepared();
      const member = (await repo.get("members", tenantId, actor.operatorId))!;
      await repo.put("members", tenantId, actor.operatorId, { ...member, roles: ["writer", "approver"], revision: member.revision + 1 });
      const refreshed = await requestProductApproval(repo, ctx, contract, "123", { message: "Second synthetic reviewed action" });
      const flow = await review(refreshed.id, await sessionCookieFor(actor.operatorId));
      expect(flow.status).toBe(200);
      expect((await post(refreshed.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))).status).toBe(200);
      expect(request.id).not.toBe(refreshed.id);
    });

    it("with LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER=true refuses the requester even when they hold the approver role", async () => {
      vi.stubEnv("LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER", "true");
      const { repo, request, humanSession } = await prepared();
      const member = (await repo.get("members", tenantId, actor.operatorId))!;
      await repo.put("members", tenantId, actor.operatorId, { ...member, roles: ["writer", "approver", "admin"], revision: member.revision + 1 });
      const refreshed = await requestProductApproval(repo, ctx, contract, "123", { message: "Second synthetic reviewed action" });
      const actorSession = await sessionCookieFor(actor.operatorId);
      expect((await review(refreshed.id, actorSession)).status).toBe(403);
      const borrowed = await review(request.id, humanSession);
      expect((await post(refreshed.id, { cookie: `${actorSession}; ${borrowed.cookie.split("; ")[1]}`, origin: ORIGIN }, form(borrowed.csrf))).status).toBe(403);
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
      const other = await review(refreshed.id, humanSession);
      expect(other.status).toBe(200);
      expect((await post(refreshed.id, { cookie: other.cookie, origin: ORIGIN }, form(other.csrf))).status).toBe(200);
      expect(await repo.list("approvals", tenantId)).toHaveLength(1);
    });
  });

  describe("separation of duties is on by default for an agency deployment that can write", () => {
    async function requesterWhoAlsoApproves() {
      const { repo, request, humanSession } = await prepared();
      const member = (await repo.get("members", tenantId, actor.operatorId))!;
      await repo.put("members", tenantId, actor.operatorId, { ...member, roles: ["writer", "approver"], revision: member.revision + 1 });
      const own = await requestProductApproval(repo, ctx, contract, "123", { message: "Own synthetic reviewed action" });
      return { repo, request, humanSession, own, actorSession: await sessionCookieFor(actor.operatorId) };
    }

    it("refuses the requester's own review and approval in DEPLOYMENT_MODE=agency with writes enabled, and still lets a different approver in", async () => {
      vi.stubEnv("DEPLOYMENT_MODE", "agency");
      const { repo, own, actorSession, humanSession } = await requesterWhoAlsoApproves();
      expect((await review(own.id, actorSession)).status).toBe(403);
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
      const other = await review(own.id, humanSession);
      expect(other.status).toBe(200);
      expect((await post(own.id, { cookie: other.cookie, origin: ORIGIN }, form(other.csrf))).status).toBe(200);
    });

    it("lets the requester approve in an agency deployment only after an explicit opt-out of false, in any case", async () => {
      vi.stubEnv("DEPLOYMENT_MODE", "agency");
      vi.stubEnv("LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER", "False");
      const { own, actorSession } = await requesterWhoAlsoApproves();
      const flow = await review(own.id, actorSession);
      expect(flow.status).toBe(200);
      expect((await post(own.id, { cookie: flow.cookie, origin: ORIGIN }, form(flow.csrf))).status).toBe(200);
    });

    it.each(["TRUE", "yes", "1", "", "on", " false", "false ", "nope"])("treats %j as on and never as an opt-out, even where the default is off", async value => {
      vi.stubEnv("LUMIN_APPROVAL_REQUIRE_DISTINCT_APPROVER", value);
      const { repo, own, actorSession } = await requesterWhoAlsoApproves();
      expect((await review(own.id, actorSession)).status).toBe(403);
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    });
  });

  describe("the model cannot approve its own request", () => {
    it("is not served to an MCP credential: API key, bearer and forged session all fail", async () => {
      const mcpCredential = "synthetic-mcp-" + "credential-fixture";
      vi.stubEnv("MCP_API_KEY", mcpCredential);
      const { repo, request, humanSession } = await prepared();
      const flow = await review(request.id, humanSession);
      const mcpHeaders = { "x-api-key": mcpCredential, authorization: `Bearer ${mcpCredential}` };
      expect((await fetch(`${base}/platform/approvals/${request.id}`, { headers: mcpHeaders })).status).toBe(403);
      expect((await post(request.id, { ...mcpHeaders, cookie: flow.cookie.split("; ")[1], origin: ORIGIN }, form(flow.csrf))).status).toBe(403);
      const forgedSession = `${(await sessionCookieFor(human.operatorId)).split("=")[0]}=${mint({ fb: human.operatorId, aud: "mcp-session", jti: "x" })}`;
      expect((await post(request.id, { cookie: `${forgedSession}; ${flow.cookie.split("; ")[1]}`, origin: ORIGIN }, form(flow.csrf))).status).toBe(403);
      expect(await repo.list("approvals", tenantId)).toHaveLength(0);
    });

    it("exposes no MCP tool that issues or accepts approval decisions, and a request id is not an approval", async () => {
      vi.stubEnv("META_APP_ID", "300");
      const repo = await seed({ humanRoles: ["approver", "writer"] });
      await repo.put("members", tenantId, actor.operatorId, { operatorId: actor.operatorId, tenantId, roles: ["writer", "approver", "admin"], allowedClientIds: [clientId], disabledAt: null, revision: 2 });
      const server = createServer(), client = new Client({ name: "approval-self-test", version: "1" }), [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a); await client.connect(b);
      try {
        const call = (name: string, args: Record<string, unknown>) => requestContext.run({ fbUserId: actor.operatorId }, () => client.callTool({ name, arguments: args }));
        const text = (r: Awaited<ReturnType<typeof call>>) => (r.content as Array<{ text: string }>)[0].text;
        const tools = (await client.listTools()).tools;
        expect(tools.filter(t => /approv|decision|csrf/.test(t.name) && t.name !== "meta_prepare_action" && t.name !== "meta_get_action_status")).toEqual([]);
        expect(tools.filter(t => Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).some(k => ["decision", "csrf", "approver_id"].includes(k)))).toEqual([]);
        const prepared = await call("meta_prepare_action", { client_id: clientId, tool: contract.tool, asset_id: "123", input: { message: "Synthetic reviewed action" } });
        const body = JSON.parse(text(prepared)) as { status: string; request_id: string; review_path: string };
        expect(body).toMatchObject({ status: "HUMAN_REVIEW_REQUIRED" });
        expect(body.review_path).toBe(`/platform/approvals/${body.request_id}`);
        const status = JSON.parse(text(await call("meta_get_action_status", { client_id: clientId, request_id: body.request_id }))) as Record<string, unknown>;
        expect(status).toMatchObject({ status: "HUMAN_REVIEW_REQUIRED" });
        expect(status.approval_id).toBeNull();
        for (const forged of [body.request_id, randomUUIDLike(), "x".repeat(40)]) {
          const attempt = await call(contract.tool, { client_id: clientId, asset_id: "123", input: { message: "Synthetic reviewed action" }, approval_id: forged });
          expect(attempt.isError).toBe(true);
        }
        expect(await repo.list("approvals", tenantId)).toHaveLength(0);
        expect(await repo.list("operations", tenantId)).toHaveLength(0);
      } finally { await client.close(); await server.close(); }
    });
  });
});

function randomUUIDLike() { return "00000000-0000-4000-8000-000000000000"; }
