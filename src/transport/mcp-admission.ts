import type express from "express";
import { hashPii } from "../auth/token-store.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_MCP_MAX_IN_FLIGHT = 16;
export const DEFAULT_MCP_RATE_LIMIT_PER_MINUTE = 120;
const MAX_IN_FLIGHT_CEILING = 1_000;
const RATE_LIMIT_CEILING = 100_000;
const RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_SUBJECTS = 10_000;
const LOG_INTERVAL_MS = 1_000;

export interface McpAdmissionConfig {
  maxInFlight: number;
  perSubjectPerWindow: number;
  windowMs: number;
  maxTrackedSubjects: number;
}

export interface McpAdmissionStats {
  inFlight: number;
  admitted: number;
  rejectedInFlight: number;
  rejectedRate: number;
  rejectedCapacity: number;
  trackedSubjects: number;
}

export type McpAdmission = express.RequestHandler & { stats(): McpAdmissionStats };

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, ceiling: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9]\d{0,8}$/.test(raw) || Number(raw) > ceiling) {
    throw new Error(`${name} must be a positive integer no greater than ${ceiling}`);
  }
  return Number(raw);
}

/** A set but unusable value stops startup: the limits are never silently dropped. */
export function readMcpAdmissionConfig(env: NodeJS.ProcessEnv = process.env): McpAdmissionConfig {
  return {
    maxInFlight: positiveInteger(env, "MCP_MAX_IN_FLIGHT", DEFAULT_MCP_MAX_IN_FLIGHT, MAX_IN_FLIGHT_CEILING),
    perSubjectPerWindow: positiveInteger(env, "MCP_RATE_LIMIT_PER_MINUTE", DEFAULT_MCP_RATE_LIMIT_PER_MINUTE, RATE_LIMIT_CEILING),
    windowMs: RATE_WINDOW_MS,
    maxTrackedSubjects: MAX_TRACKED_SUBJECTS,
  };
}

function subjectOf(req: express.Request): string {
  const auth = (req as express.Request & { auth?: { clientId?: unknown; extra?: Record<string, unknown> } }).auth;
  const fbUserId = auth?.extra?.fbUserId;
  if (typeof fbUserId === "string" && fbUserId) return `user:${fbUserId}`;
  if (typeof auth?.clientId === "string" && auth.clientId) return `client:${auth.clientId}`;
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey) return `key:${apiKey}`;
  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization) return `authorization:${authorization}`;
  return "unattributed";
}

/**
 * Admission control for POST /mcp, placed after authentication and before the
 * body is read. Every request builds a fresh server with the full tool
 * registry and can hold a worker on Meta, Gemini or ffmpeg for minutes, so an
 * authenticated caller could otherwise saturate the only replica. Two limits,
 * both refused with 429 and a Retry-After:
 *  - a per-instance cap on requests in flight (released when the response
 *    finishes or the connection closes, so an abort frees the slot);
 *  - a per-authenticated-subject sliding window.
 * Requests that cannot be attributed share one bucket and a full tracking
 * table refuses new subjects: the limits fail closed.
 */
export function createMcpAdmission(config: McpAdmissionConfig = readMcpAdmissionConfig(), clock: () => number = Date.now): McpAdmission {
  const windows = new Map<string, number[]>();
  const counters = { inFlight: 0, admitted: 0, rejectedInFlight: 0, rejectedRate: 0, rejectedCapacity: 0 };
  const lastLogged = { in_flight: -Infinity, rate: -Infinity, capacity: -Infinity };
  const suppressed = { in_flight: 0, rate: 0, capacity: 0 };

  function prune(now: number): void {
    for (const [key, stamps] of windows) {
      while (stamps.length > 0 && stamps[0] <= now - config.windowMs) stamps.shift();
      if (stamps.length === 0) windows.delete(key);
    }
  }

  function reject(res: express.Response, reason: keyof typeof lastLogged, retryAfterSeconds: number, subject: string, now: number): void {
    if (reason === "in_flight") counters.rejectedInFlight += 1;
    else if (reason === "rate") counters.rejectedRate += 1;
    else counters.rejectedCapacity += 1;
    if (now - lastLogged[reason] >= LOG_INTERVAL_MS) {
      logger.warn(
        {
          event: "mcp_admission_rejected",
          reason,
          subject: hashPii(subject),
          inFlight: counters.inFlight,
          maxInFlight: config.maxInFlight,
          rejectedTotal: counters.rejectedInFlight + counters.rejectedRate + counters.rejectedCapacity,
          suppressedSinceLastLog: suppressed[reason],
        },
        "Rejected /mcp request: admission limit reached",
      );
      lastLogged[reason] = now;
      suppressed[reason] = 0;
    } else {
      suppressed[reason] += 1;
    }
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
    res.status(429).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Too many requests; retry after the interval in the Retry-After header" },
      id: null,
    });
  }

  const middleware: express.RequestHandler = (req, res, next) => {
    const now = clock();
    const subject = subjectOf(req);

    if (counters.inFlight >= config.maxInFlight) {
      reject(res, "in_flight", 1, subject, now);
      return;
    }

    const key = hashPii(subject) ?? "unattributed";
    let stamps = windows.get(key);
    if (stamps) {
      while (stamps.length > 0 && stamps[0] <= now - config.windowMs) stamps.shift();
    }
    if (!stamps) {
      if (windows.size >= config.maxTrackedSubjects) prune(now);
      if (windows.size >= config.maxTrackedSubjects) {
        reject(res, "capacity", config.windowMs / 1000, subject, now);
        return;
      }
      stamps = [];
      windows.set(key, stamps);
    }
    if (stamps.length >= config.perSubjectPerWindow) {
      reject(res, "rate", (stamps[0] + config.windowMs - now) / 1000, subject, now);
      return;
    }
    stamps.push(now);

    counters.inFlight += 1;
    counters.admitted += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      counters.inFlight -= 1;
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };

  return Object.assign(middleware, {
    stats: (): McpAdmissionStats => ({ ...counters, trackedSubjects: windows.size }),
  });
}
