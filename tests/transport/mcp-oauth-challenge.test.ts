import express from "express";
import { expect, it } from "vitest";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { oauthProvider } from "../../src/auth/oauth-provider.js";
import { getMcpProtectedResourceMetadataUrl } from "../../src/transport/http.js";

it("advertises path-specific OAuth metadata on the initial MCP 401 challenge", async () => {
  const serverUrl = new URL("https://mcp.example.com");
  const app = express();
  app.post(
    "/mcp",
    requireBearerAuth({
      verifier: oauthProvider,
      resourceMetadataUrl: getMcpProtectedResourceMetadataUrl(serverUrl),
    }),
    (_req, res) => res.json({ reached: true }),
  );

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer error="invalid_token", error_description="Missing Authorization header", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
