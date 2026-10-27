import type express from "express";
import { logger } from "../utils/logger.js";

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Browsers always send Origin on cross-origin requests, so a present Origin
 * that the operator did not allowlist is a web page this server was not built
 * to serve, whatever bearer token it holds (DNS rebinding, a hijacked page).
 * Non-browser MCP clients send no Origin and are unaffected.
 */
export function mcpOriginGuard(allowedOrigins: readonly string[]): express.RequestHandler {
  const allowed = new Set(allowedOrigins.map(normalizeOrigin));
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (req.method === "OPTIONS" || origin === undefined) {
      next();
      return;
    }
    if (typeof origin === "string" && allowed.has(normalizeOrigin(origin))) {
      next();
      return;
    }
    logger.warn({ origin: String(origin).slice(0, 200), path: req.path }, "Rejected /mcp request from a disallowed Origin");
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Origin not allowed" },
      id: null,
    });
  };
}

/** Turns body-parser failures on /mcp into JSON-RPC errors instead of Express's HTML page. */
export const mcpBodyErrorHandler: express.ErrorRequestHandler = (error, _req, res, next) => {
  const status = (error as { status?: unknown }).status;
  const type = (error as { type?: unknown }).type;
  if (typeof type !== "string" || typeof status !== "number" || status < 400 || status >= 500 || res.headersSent) {
    next(error);
    return;
  }
  const parseFailure = type === "entity.parse.failed";
  res.status(status).json({
    jsonrpc: "2.0",
    error: parseFailure ? { code: -32700, message: "Parse error" } : { code: -32600, message: "Invalid request" },
    id: null,
  });
};
