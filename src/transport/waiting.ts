import express from "express";
import type { Server } from "node:http";

export function createWaitingApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
  app.get("/health", (_req, res) => res.json({ status: "ok", state: "awaiting_credentials", metaConnected: false }));
  app.use((_req, res) => res.status(503).json({ status: "unavailable", state: "awaiting_credentials" }));
  return app;
}

export function startWaitingTransport(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createWaitingApp().listen(port, "0.0.0.0", () => resolve(server));
    server.once("error", reject);
    const shutdown = (): void => { server.close(() => process.exit(0)); };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });
}
