import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { PlatformOAuthService } from "../../src/platform/oauth.js";
import { platformConnectionRouters } from "../../src/platform/connection-runtime.js";

vi.mock("../../src/auth/session.js", () => ({ getSession: async () => ({ fbUserId: "100" }) }));
vi.mock("../../src/store/firestore.js", () => ({ getFirestore: () => ({ collection: () => ({}) }) }));
afterEach(() => { configurePlatformRepository(undefined); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function fixture() {
  const origin = "https://staging.example.com";
  const repo = new InMemoryPlatformRepository();
  await repo.put("operatorIndex", "_index", "100", { operatorId: "100", tenantId: "tenant" });
  await repo.put("members", "tenant", "100", { operatorId: "100", tenantId: "tenant", roles: ["connection_admin"], allowedClientIds: ["client"], revision: 1, disabledAt: null });
  await repo.put("clients", "tenant", "client", { id: "client", tenantId: "tenant", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  configurePlatformRepository(repo);
  const profile = { id: "meta-readonly", provider: "META_MARKETING", appId: "300", strategy: "facebook_business", scopes: ["public_profile", "ads_read"], tokenTypes: ["user"], redirectUri: `${origin}/platform/oauth/meta-readonly/callback`, authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth", verified: true, secretReference: "META_APP_SECRET", capabilities: ["legacy.ads_get_campaigns"], actions: ["READ"], requiredTasks: [] };
  for (const [key, value] of Object.entries({ LUMIN_PLATFORM_ENABLED: "true", LUMIN_PLATFORM_OAUTH_ENABLED: "true", META_APP_ID: "300", META_APP_SECRET: "synthetic-secret", LUMIN_PLATFORM_OAUTH_PROFILES_JSON: JSON.stringify([profile]) })) vi.stubEnv(key, value);
  const routers = platformConnectionRouters(origin)!;
  const app = express();
  app.use((_req, res, next) => { res.setHeader("Referrer-Policy", "no-referrer"); next(); });
  app.use("/platform/connections", routers.connections);
  app.use("/platform/oauth", routers.oauth);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, base, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

describe("client connection form origin policy", () => {
  it("preserves same-origin form POST identity without disclosing referrers to Meta", async () => {
    const f = await fixture();
    try {
      const response = await fetch(`${f.base}/platform/connections/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('/platform/oauth/meta-readonly/start');
      expect(response.headers.get("referrer-policy")).toBe("same-origin");
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally { await f.close(); }
  });
  it.each([undefined, "null", "https://foreign.example.com"])("rejects untrusted POST Origin %s before creating a challenge", async origin => {
    const start = vi.spyOn(PlatformOAuthService.prototype, "start");
    const f = await fixture();
    try {
      const response = await fetch(`${f.base}/platform/oauth/meta-readonly/start`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(origin === undefined ? {} : { Origin: origin }) }, body: "client_id=client", redirect: "manual" });
      expect(response.status).toBe(403);
      expect(start).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
});
