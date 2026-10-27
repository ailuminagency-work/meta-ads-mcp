import type express from "express";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_CORS_ALLOWED_ORIGINS: readonly string[] = ["https://claude.ai", "https://claude.com"];

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

/**
 * The SDK's OAuth router is mounted by prefix and its inner route also answers
 * "/authorize//". The login, consent and CSRF handlers in front of it match
 * the exact path only, so every other shape of the path is refused here rather
 * than allowed to reach the code-issuing handler around them.
 */
export const authorizeExactPathOnly: express.RequestHandler = (req, res, next) => {
  if (req.path === "/") {
    next();
    return;
  }
  res.sendStatus(404);
};

/** Without a Meta login there is no operator who could approve a grant, so these endpoints do not exist. */
export const oauthEndpointsUnavailable: express.RequestHandler = (_req, res) => {
  res.status(404).json({
    error: "oauth_unavailable",
    error_description: "This deployment authenticates /mcp with an API key; it does not issue OAuth tokens.",
  });
};

/** Stands in for the provider where no OAuth token can be legitimate. */
export const rejectEveryToken: OAuthTokenVerifier = {
  async verifyAccessToken() {
    throw new InvalidTokenError("This deployment does not accept OAuth access tokens");
  },
};
