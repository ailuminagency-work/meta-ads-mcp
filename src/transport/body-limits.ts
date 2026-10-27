import express from "express";

const PRE_AUTH_JSON_LIMIT = "100kb";
// No tool takes inline media (the base64 fields exist only on the signed ingress
// routes), and the largest legitimate request is a bulk object with a few
// thousand ids, so 1 MB leaves a wide margin while keeping a hostile body small.
const MCP_JSON_LIMIT = "1mb";

export const MCP_MAX_JSON_DEPTH = 64;
export const MCP_MAX_JSON_CONTAINERS = 20_000;

class JsonComplexityError extends Error {
  readonly status: number;
  readonly type: string;

  constructor(status: number, type: string) {
    super("Request body is too complex");
    this.status = status;
    this.type = type;
  }
}

/**
 * JSON.parse allocates in proportion to the number of containers, not the
 * number of bytes: 10 MB of `[[[...` or `{},{},...` costs about 300 MiB and
 * seconds of event-loop time. A single pass over the raw bytes, which are
 * only counted and never allocated, refuses those shapes before the parse.
 * Quotes and escapes are tracked so a bracket inside a string does not count.
 */
export function assertJsonComplexity(
  body: Buffer,
  encoding: string | null | undefined,
  maxDepth: number = MCP_MAX_JSON_DEPTH,
  maxContainers: number = MCP_MAX_JSON_CONTAINERS,
): void {
  if (encoding && !/^utf-?8$/i.test(encoding)) throw new JsonComplexityError(415, "charset.unsupported");
  let depth = 0;
  let containers = 0;
  let inString = false;
  for (let index = 0; index < body.length; index += 1) {
    const byte = body[index];
    if (inString) {
      if (byte === 0x5c) index += 1;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) {
      inString = true;
    } else if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
      containers += 1;
      if (depth > maxDepth || containers > maxContainers) throw new JsonComplexityError(400, "entity.complexity.exceeded");
    } else if ((byte === 0x7d || byte === 0x5d) && depth > 0) {
      depth -= 1;
    }
  }
}

function boundedJson(limit: string): express.RequestHandler {
  return express.json({
    limit,
    verify: (_req, _res, body, encoding) => assertJsonComplexity(body, encoding),
  });
}

/**
 * Express parses a body before any later middleware runs, so a cap applied
 * globally is paid by unauthenticated callers. Everything except /mcp keeps a
 * small cap; /mcp gets its larger one from `mcpJsonParser`, after auth.
 */
export function preAuthJsonParser(): express.RequestHandler {
  const parse = boundedJson(PRE_AUTH_JSON_LIMIT);
  return (req, res, next) => {
    if (req.path === "/mcp") {
      next();
      return;
    }
    parse(req, res, next);
  };
}

export function mcpJsonParser(): express.RequestHandler {
  return boundedJson(MCP_JSON_LIMIT);
}
