import type http from "node:http";

export interface ServerTimeouts {
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
  checkIntervalMs: number;
}

export const SERVER_TIMEOUTS: ServerTimeouts = {
  // Nothing this server accepts is slow: /mcp bodies are capped at 1 MB and the ingress uploads have their own
  // 10 s deadline. Node's defaults (300 s for the whole request, 60 s for the headers) let one client hold a
  // connection and an admission slot for five minutes with a body that never finishes.
  requestTimeoutMs: 30_000,
  headersTimeoutMs: 15_000,
  // Longer than the idle timeout of a typical proxy (60 s), so the proxy closes an idle connection first and
  // never reuses one this server has just dropped. The Railway edge value is not published here: UNVERIFIED.
  keepAliveTimeoutMs: 65_000,
  // Node checks the two timeouts above only on this interval (30 s by default), which would make a 30 s limit
  // fire anywhere between 30 and 60 s.
  checkIntervalMs: 5_000,
};

/** Call right after `listen()`: the checking interval is read when the `listening` event fires. */
export function applyServerTimeouts(server: http.Server, overrides: Partial<ServerTimeouts> = {}): void {
  const timeouts = { ...SERVER_TIMEOUTS, ...overrides };
  server.requestTimeout = timeouts.requestTimeoutMs;
  server.headersTimeout = timeouts.headersTimeoutMs;
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;
  server.timeout = 0;
  // Not in the Node typings, but read from the server object when it starts listening.
  (server as http.Server & { connectionsCheckingInterval: number }).connectionsCheckingInterval = timeouts.checkIntervalMs;
}
