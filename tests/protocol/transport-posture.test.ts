import { afterEach, describe, expect, it } from "vitest";
import { MCP_RESOURCE, SERVER_URL, bootServer, completeOAuthFlow, mcpPost, type Harness } from "./harness.js";

let booted: Harness | undefined;

afterEach(async () => {
  if (booted) {
    expect(booted.upstream.blocked).toEqual([]);
    await booted.close();
    booted = undefined;
  }
});

describe("CORS allowlist configured for claude.ai and chatgpt.com", () => {
  it("echoes exactly the configured origins and nothing else", async () => {
    booted = await bootServer({ corsOrigins: "https://claude.ai, https://chatgpt.com" });
    for (const [origin, allowed] of [
      ["https://claude.ai", true],
      ["https://chatgpt.com", true],
      ["https://www.chatgpt.com", false],
      ["https://claude.ai.attacker.example", false],
    ] as const) {
      const response = await fetch(booted.origin + "/mcp", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
      });
      expect(response.status, origin).toBe(204);
      expect(response.headers.get("access-control-allow-origin"), origin).toBe(allowed ? origin : null);
    }
  });
});

describe("transport posture in production mode", () => {
  it("redirects plain-HTTP requests to the https origin, exempts /health and sends HSTS over https", async () => {
    booted = await bootServer({
      env: {
        NODE_ENV: "production",
        DEPLOYMENT_MODE: "upstream",
        META_APP_ID: undefined,
        META_APP_SECRET: undefined,
        LUMIN_PLATFORM_ENABLED: "false",
        LUMIN_META_PRIVACY_ENABLED: "false",
      },
    });
    const plain = await fetch(booted.origin + "/mcp", { method: "POST", redirect: "manual" });
    expect(plain.status).toBe(301);
    expect(plain.headers.get("location")).toBe(`${SERVER_URL}/mcp`);

    expect((await fetch(booted.origin + "/health", { redirect: "manual" })).status).toBe(200);

    const secure = await fetch(booted.origin + "/.well-known/oauth-protected-resource/mcp", { headers: { "x-forwarded-proto": "https" } });
    expect(secure.status).toBe(200);
    expect(secure.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(await secure.json()).toMatchObject({ resource: MCP_RESOURCE });
  });
});

describe("control: the X-Meta-Token refusal is specific to agency mode", () => {
  it("honours the header override when DEPLOYMENT_MODE is upstream, so the agency 403 is a real guard", async () => {
    booted = await bootServer({ env: { DEPLOYMENT_MODE: "upstream" } });
    const flow = await completeOAuthFlow(booted.origin);
    booted.upstream.reset();
    const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ads_get_ad_accounts", arguments: {} } };
    const reply = await mcpPost(booted.origin, flow.tokens.access_token, call, { "x-meta-token": "synthetic-override-token" });
    expect(reply.status).toBe(200);
    expect(booted.upstream.graphCalls()).toHaveLength(1);
    expect(booted.upstream.graphCalls()[0].url.searchParams.get("access_token")).toBe("synthetic-override-token");
  });
});
