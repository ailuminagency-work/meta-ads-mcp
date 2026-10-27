import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mcpJsonParser, preAuthJsonParser } from "../../src/transport/body-limits.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function start(authorized: boolean): Promise<{ base: string; parsedBy: string[] }> {
  const parsedBy: string[] = [];
  const app = express();
  app.use(preAuthJsonParser());
  app.post("/other", (req, res) => {
    parsedBy.push("other");
    res.json({ bytes: JSON.stringify(req.body).length });
  });
  app.post(
    "/mcp",
    (_req, res, next) => {
      if (!authorized) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      next();
    },
    mcpJsonParser(),
    (req, res) => {
      parsedBy.push("mcp");
      res.json({ bytes: JSON.stringify(req.body).length });
    },
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, parsedBy };
}

function post(url: string, bytes: number): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pad: "x".repeat(bytes) }),
  });
}

describe("request body limits", () => {
  it("caps bodies on every route except /mcp before any auth can run", async () => {
    const { base } = await start(true);
    expect((await post(`${base}/other`, 1_000)).status).toBe(200);
    expect((await post(`${base}/other`, 300_000)).status).toBe(413);
  });

  it("does not parse an /mcp body for an unauthenticated caller", async () => {
    const { base, parsedBy } = await start(false);
    const res = await post(`${base}/mcp`, 1_500_000);
    expect(res.status).toBe(401);
    expect(parsedBy).toEqual([]);
  });

  it("still accepts a large /mcp body of several hundred kilobytes once the caller is authenticated", async () => {
    const { base, parsedBy } = await start(true);
    const res = await post(`${base}/mcp`, 900_000);
    expect(res.status).toBe(200);
    expect(parsedBy).toEqual(["mcp"]);
  });

  it("rejects an /mcp body above the authenticated cap", async () => {
    const { base } = await start(true);
    expect((await post(`${base}/mcp`, 1_200_000)).status).toBe(413);
    expect((await post(`${base}/mcp`, 11_000_000)).status).toBe(413);
  });
});
