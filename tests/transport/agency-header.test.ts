import express from "express";
import { expect, it, vi } from "vitest";
import { buildMetaTokenMiddleware } from "../../src/transport/http.js";

it("rejects caller-supplied Meta tokens over HTTP in agency mode", async () => {
  vi.stubEnv("DEPLOYMENT_MODE", "agency");
  const app = express();
  app.use(buildMetaTokenMiddleware(new URL("https://agency.example.com"), true));
  app.post("/mcp", (_req, res) => res.json({ reached: true }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST", headers: { "X-Meta-Token": "test-override" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Header token overrides are disabled in agency mode" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  }
});
