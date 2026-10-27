import express from "express";

const PRE_AUTH_JSON_LIMIT = "100kb";
const MCP_JSON_LIMIT = "10mb";

/**
 * Express parses a body before any later middleware runs, so a cap applied
 * globally is paid by unauthenticated callers. Everything except /mcp keeps a
 * small cap; /mcp gets its larger one from `mcpJsonParser`, after auth.
 */
export function preAuthJsonParser(): express.RequestHandler {
  const parse = express.json({ limit: PRE_AUTH_JSON_LIMIT });
  return (req, res, next) => {
    if (req.path === "/mcp") {
      next();
      return;
    }
    parse(req, res, next);
  };
}

export function mcpJsonParser(): express.RequestHandler {
  return express.json({ limit: MCP_JSON_LIMIT });
}
