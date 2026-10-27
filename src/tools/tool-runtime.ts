import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAccessTokenHash, getCurrentFbUserId, hashPii, runWithRequestSignal } from "../auth/token-store.js";
import { logger } from "../utils/logger.js";

/**
 * One wrapper around every tool handler registered on a server, so that no tool
 * has to remember two things the transport cannot do for it:
 *
 *  1. The MCP request's abort signal (extra.signal, aborted when the client
 *     drops, cancels or the watchdog fires) is made available to everything the
 *     handler awaits (getRequestSignal): the Meta client, the paginator and the
 *     wait loops stop when it fires instead of running on for nobody.
 *  2. A gauge of handlers that are actually running, per subject. It counts from
 *     entry until the handler really returns, not until the socket closes, so a
 *     handler that ignores the signal still cannot be started more than the cap
 *     allows. A new call above the cap is refused.
 */
export const DEFAULT_MAX_RUNNING_PER_SUBJECT = 8;
const RUNNING_CEILING = 1_000;
const MAX_TRACKED_SUBJECTS = 10_000;
// The longest request the transport allows is a little over an hour; a count that has outlived that is a handler that never returns.
const RUNNING_LEASE_MS = 2 * 60 * 60 * 1000;
const REFUSAL_LOG_INTERVAL_MS = 1_000;

export interface ToolRuntimeConfig {
  maxRunningPerSubject: number;
}

/** A set but unusable value is an error, never silently replaced by the default. */
export function readToolRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ToolRuntimeConfig {
  const name = "MCP_MAX_RUNNING_PER_SUBJECT";
  const raw = env[name]?.trim();
  if (!raw) return { maxRunningPerSubject: DEFAULT_MAX_RUNNING_PER_SUBJECT };
  if (!/^[1-9]\d{0,8}$/.test(raw) || Number(raw) > RUNNING_CEILING) {
    throw new Error(`${name} must be a positive integer no greater than ${RUNNING_CEILING}`);
  }
  return { maxRunningPerSubject: Number(raw) };
}

const running = new Map<string, number>();
let lastRefusalLogAt = 0;

export function runningToolCallsForTests(): { total: number; subjects: number } {
  let total = 0;
  for (const count of running.values()) total += count;
  return { total, subjects: running.size };
}

export function resetToolRuntimeForTests(): void {
  running.clear();
  lastRefusalLogAt = 0;
}

function subjectKey(): string {
  const user = getCurrentFbUserId();
  if (user) return `user:${user}`;
  try {
    return `token:${getAccessTokenHash()}`;
  } catch {
    return "local";
  }
}

function refuse(subject: string, current: number): never {
  const now = Date.now();
  if (now - lastRefusalLogAt >= REFUSAL_LOG_INTERVAL_MS) {
    lastRefusalLogAt = now;
    logger.warn({ event: "tool_call_refused_running_cap", subject: hashPii(subject), running: current }, "Too many concurrent tool calls for one subject");
  }
  throw new McpError(
    ErrorCode.InvalidRequest,
    `Too many concurrent tool calls: ${current} earlier call(s) from this user are still running. Wait for them to finish, then retry.`,
  );
}

function acquire(subject: string, max: number): () => void {
  const current = running.get(subject) ?? 0;
  if (current >= max) refuse(subject, current);
  if (current === 0 && running.size >= MAX_TRACKED_SUBJECTS) refuse(subject, current);
  running.set(subject, current + 1);

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    clearTimeout(lease);
    const left = (running.get(subject) ?? 1) - 1;
    if (left <= 0) running.delete(subject);
    else running.set(subject, left);
  };
  const lease = setTimeout(() => {
    logger.warn({ event: "tool_call_lease_expired", subject: hashPii(subject) }, "A tool call outlived the longest request; its place is freed");
    release();
  }, RUNNING_LEASE_MS);
  lease.unref();
  return release;
}

const installed = new WeakSet<McpServer>();

export function installToolRuntime(server: McpServer): void {
  if (installed.has(server)) return;
  installed.add(server);
  const original = server.registerTool;
  server.registerTool = ((name: string, config: unknown, callback: unknown) => {
    if (typeof callback !== "function") return Reflect.apply(original, server, [name, config, callback]);
    const wrapped = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const extra = args[args.length - 1] as { signal?: unknown } | undefined;
      const signal = extra && typeof extra === "object" && extra.signal instanceof AbortSignal ? extra.signal : undefined;
      const release = acquire(subjectKey(), readToolRuntimeConfig().maxRunningPerSubject);
      try {
        return await runWithRequestSignal(signal, () => Reflect.apply(callback, this, args));
      } finally {
        release();
      }
    };
    return Reflect.apply(original, server, [name, config, wrapped]);
  }) as McpServer["registerTool"];
}
