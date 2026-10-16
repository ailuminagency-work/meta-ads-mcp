import { describe, expect, it, vi } from "vitest";
import { createThreadsOAuthAdapter } from "../../src/platform/oauth-threads.js";
import { createInstagramOAuthAdapter } from "../../src/platform/oauth-instagram.js";
import type { TrustedOAuthProfile } from "../../src/platform/oauth.js";
const now = 1800000000000;
const profile: TrustedOAuthProfile = { id: "threads-fixture", provider: "META_THREADS", appId: "3001", strategy: "threads_login", scopes: ["threads_basic"], tokenTypes: ["threads"], redirectUri: "https://fixture.invalid/platform/oauth/threads-fixture/callback", authorizeUrl: "https://threads.com/oauth/authorize", verified: true, secretReference: "fixture", capabilities: ["threads.get.profile"], actions: ["READ"], requiredTasks: [] };
function fixture(change: Record<string, unknown> = {}, shortChange: Record<string, unknown> = {}, meChange: Record<string, unknown> = {}) {
  const bodies = [{ access_token: "synthetic-short", token_type: "bearer", user_id: "2001", ...shortChange }, { access_token: "synthetic-long", token_type: "bearer", expires_in: 3600 }, { data: { type: "USER", is_valid: true, user_id: "2001", expires_at: now / 1000 + 3000, data_access_expires_at: now / 1000 + 2000, scopes: ["threads_basic"], ...change } }, { id: "2001", ...meChange }];
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { requests.push({ url: new URL(String(url)), init }); return new Response(JSON.stringify(bodies.shift()), { status: 200 }); }) as unknown as typeof fetch;
  const adapter = createThreadsOAuthAdapter({ fetch: fetcher, now: () => now });
  const run = (assets = [{ type: "THREADS_ACCOUNT" as const, id: "2001" }]) => adapter.exchangeAndInspect({ code: "synthetic-code", profile, appSecret: "synthetic-secret", requestedAssets: assets });
  return { run, requests, fetcher };
}
describe("provider OAuth inspection", () => {
  it.each([{actions:["WRITE_CONTENT"]},{scopes:["threads_basic","threads_content_publish"]},{capabilities:["threads.create.container"]},{tokenTypes:["threads","user"]},{requiredTasks:["MANAGE"]}])("pure Threads profile validation rejects unsupported consent before network %j",change=>{const fetcher=vi.fn(),adapter=createThreadsOAuthAdapter({fetch:fetcher});expect(()=>adapter.validateProfile({...profile,...change} as TrustedOAuthProfile)).toThrow();expect(fetcher).not.toHaveBeenCalled();});
  it("inspects same-app Threads token and proves only its registered subject", async () => {
    const { run, requests } = fixture();
    expect(await run()).toMatchObject({ subjectId: "2001", appId: "3001", tokenType: "threads", expiresAt: now + 2000000, assets: [{ type: "THREADS_ACCOUNT", id: "2001", tasks: [] }] });
    expect(requests.map(r => r.url.origin + r.url.pathname)).toEqual(["https://graph.threads.com/oauth/access_token", "https://graph.threads.com/access_token", "https://graph.threads.com/v1.0/debug_token", "https://graph.threads.com/v1.0/me"]);
    expect(requests[0].init?.method).toBe("POST");
    expect(String(requests[0].init?.body)).toContain("grant_type=authorization_code");
    expect(requests[2].url.searchParams.get("access_token")).toBe("TH|3001|synthetic-secret");
    expect(requests[3].url.searchParams.get("fields")).toBe("id");
    expect(requests.every(r => r.init?.redirect === "error" && r.init.signal)).toBe(true);
  });
  it.each([{ is_valid: false }, { type: "APP" }, { user_id: "2002" }, { expires_at: now / 1000 }, { data_access_expires_at: 0 }, { scopes: ["threads_basic", "threads_content_publish"] }, { scopes: ["threads_basic", "threads_basic"] }])("rejects invalid inspection %j", async change => { await expect(fixture(change).run()).rejects.toThrow("THREADS_OAUTH_INSPECTION_FAILED_HOLD"); });
  it("rejects foreign registered assets", async () => { await expect(fixture().run([{ type: "THREADS_ACCOUNT", id: "2002" }])).rejects.toThrow("HOLD"); });
  it("rejects unsafe numeric exchange IDs rather than rounding identity", async () => { await expect(fixture({}, { user_id: Number.MAX_SAFE_INTEGER + 1 }).run()).rejects.toThrow("HOLD"); });
  it("rejects inconsistent profile lookup", async () => { await expect(fixture({}, {}, { id: "2002" }).run()).rejects.toThrow("HOLD"); });
  it("never echoes provider errors containing secrets", async () => {
    const adapter = createThreadsOAuthAdapter({ fetch: async () => { throw new Error("synthetic-secret synthetic-code"); } });
    await expect(adapter.exchangeAndInspect({ code: "synthetic-code", profile, appSecret: "synthetic-secret", requestedAssets: [{ type: "THREADS_ACCOUNT", id: "2001" }] })).rejects.toThrow(/^THREADS_OAUTH_INSPECTION_FAILED_HOLD$/);
  });
  it("rejects oversized streamed provider data", async () => {
    const adapter = createThreadsOAuthAdapter({ fetch: async () => new Response("x".repeat(65537)) });
    await expect(adapter.exchangeAndInspect({ code: "synthetic-code", profile, appSecret: "synthetic-secret", requestedAssets: [{ type: "THREADS_ACCOUNT", id: "2001" }] })).rejects.toThrow("HOLD");
  });
  it("holds Instagram before any credential exchange", async () => {
    const adapter = createInstagramOAuthAdapter(); expect(adapter.verified).toBe(false);
    await expect(adapter.exchangeAndInspect({ code: "synthetic", profile, appSecret: "synthetic", requestedAssets: [] })).rejects.toThrow("PRODUCT_OAUTH_ADAPTER_UNVERIFIED_HOLD");
  });
});
