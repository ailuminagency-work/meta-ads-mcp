import type express from "express";
import { hashPii } from "../auth/token-store.js";
import { logger } from "../utils/logger.js";
import { HeapPressureGuard, readHeapPressurePercent, type HeapSampler } from "./heap-pressure.js";

export const DEFAULT_MCP_MAX_IN_FLIGHT = 16;
export const DEFAULT_MCP_RATE_LIMIT_PER_MINUTE = 120;
export const DEFAULT_MCP_MAX_IN_FLIGHT_PER_SUBJECT = 4;
// Outside agency mode the longest tool call a client can ask for is ads_run_report_and_wait (max_wait_seconds up
// to 3600); video and Gemini calls run 180 to 240 s by default. The default sits just above that, so no tool is
// cut short there.
export const DEFAULT_MCP_REQUEST_TIMEOUT_SECONDS = 3_700;
// Agency mode has no tool that legitimately runs longer than about 260 s (a video job: 20 s queue plus a 240 s
// budget; Meta calls give up after about 130 s; the strict report observer after 30 s). A tighter default bounds
// what a hung or hostile call can hold: 4 slots x 600 s instead of 4 x 3700 s per credential.
export const DEFAULT_MCP_REQUEST_TIMEOUT_SECONDS_AGENCY = 600;
const MAX_IN_FLIGHT_CEILING = 1_000;
const RATE_LIMIT_CEILING = 100_000;
const REQUEST_TIMEOUT_FLOOR_SECONDS = 30;
const REQUEST_TIMEOUT_CEILING_SECONDS = 7_200;
const RESPONSE_STALL_MS = 60_000;
const STALL_CHECK_MS = 5_000;
const RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_SUBJECTS = 10_000;
const LOG_INTERVAL_MS = 1_000;
const HEAP_LOG_INTERVAL_MS = 30_000;
const HEAP_RETRY_AFTER_SECONDS = 5;

export interface McpAdmissionConfig {
  maxInFlight: number;
  perSubjectPerWindow: number;
  windowMs: number;
  maxTrackedSubjects: number;
  perSubjectInFlight?: number;
  requestTimeoutMs?: number;
  responseStallMs?: number;
  stallCheckMs?: number;
  /** Share of the heap limit above which new calls are refused; 0 or absent turns the guard off. */
  heapPressurePercent?: number;
  heapSampler?: HeapSampler;
  heapSampleIntervalMs?: number;
}

export interface McpAdmissionStats {
  inFlight: number;
  admitted: number;
  rejectedInFlight: number;
  rejectedSubjectInFlight: number;
  rejectedRate: number;
  rejectedCapacity: number;
  rejectedHeapPressure: number;
  heapPressureEngaged: boolean;
  timedOut: number;
  stalled: number;
  trackedSubjects: number;
}

export type McpAdmission = express.RequestHandler & { stats(): McpAdmissionStats };

function boundedInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, floor: number, ceiling: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9]\d{0,8}$/.test(raw) || Number(raw) < floor || Number(raw) > ceiling) {
    throw new Error(
      floor === 1 ? `${name} must be a positive integer no greater than ${ceiling}` : `${name} must be an integer from ${floor} to ${ceiling}`,
    );
  }
  return Number(raw);
}

/** A set but unusable value stops startup: the limits are never silently dropped. */
export function readMcpAdmissionConfig(env: NodeJS.ProcessEnv = process.env): McpAdmissionConfig {
  return {
    maxInFlight: boundedInteger(env, "MCP_MAX_IN_FLIGHT", DEFAULT_MCP_MAX_IN_FLIGHT, 1, MAX_IN_FLIGHT_CEILING),
    perSubjectInFlight: boundedInteger(env, "MCP_MAX_IN_FLIGHT_PER_SUBJECT", DEFAULT_MCP_MAX_IN_FLIGHT_PER_SUBJECT, 1, MAX_IN_FLIGHT_CEILING),
    perSubjectPerWindow: boundedInteger(env, "MCP_RATE_LIMIT_PER_MINUTE", DEFAULT_MCP_RATE_LIMIT_PER_MINUTE, 1, RATE_LIMIT_CEILING),
    requestTimeoutMs:
      boundedInteger(
        env,
        "MCP_REQUEST_TIMEOUT_SECONDS",
        env.DEPLOYMENT_MODE === "agency" ? DEFAULT_MCP_REQUEST_TIMEOUT_SECONDS_AGENCY : DEFAULT_MCP_REQUEST_TIMEOUT_SECONDS,
        REQUEST_TIMEOUT_FLOOR_SECONDS,
        REQUEST_TIMEOUT_CEILING_SECONDS,
      ) * 1_000,
    responseStallMs: RESPONSE_STALL_MS,
    stallCheckMs: STALL_CHECK_MS,
    heapPressurePercent: readHeapPressurePercent(env),
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
 * authenticated caller could otherwise saturate the only replica. A heap check
 * comes first: while the process heap is close to its limit (two readings in a
 * row above MCP_HEAP_PRESSURE_PERCENT) every call is refused with 503 and
 * Retry-After: 5, because work that ignores its abort signal outlives the
 * caller and enough of it ends the process. Then the limits, all refused with
 * 429 and a Retry-After:
 *  - a per-instance cap on requests in flight;
 *  - a per-subject cap on requests in flight, so one credential cannot take
 *    every slot (the slot is taken before the body is read on purpose: reading
 *    first would let any valid token buffer bodies without bound);
 *  - a per-authenticated-subject sliding window.
 * A slot is released when the response finishes or the connection closes, so
 * an abort frees it. A watchdog ends a request still unanswered after the
 * request timeout, and a response the client has stopped reading is destroyed
 * after a minute without progress; both release the slot through `close`.
 * Requests that cannot be attributed share one bucket and a full tracking
 * table refuses new subjects: the limits fail closed.
 */
export function createMcpAdmission(config: McpAdmissionConfig = readMcpAdmissionConfig(), clock: () => number = Date.now): McpAdmission {
  const perSubjectInFlight = config.perSubjectInFlight ?? DEFAULT_MCP_MAX_IN_FLIGHT_PER_SUBJECT;
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_SECONDS * 1_000;
  const responseStallMs = config.responseStallMs ?? RESPONSE_STALL_MS;
  const stallCheckMs = config.stallCheckMs ?? STALL_CHECK_MS;
  const windows = new Map<string, number[]>();
  const subjectCounts = new Map<string, number>();
  const counters = {
    inFlight: 0,
    admitted: 0,
    rejectedInFlight: 0,
    rejectedSubjectInFlight: 0,
    rejectedRate: 0,
    rejectedCapacity: 0,
    rejectedHeapPressure: 0,
    timedOut: 0,
    stalled: 0,
  };
  const heapGuard = new HeapPressureGuard({
    percent: config.heapPressurePercent ?? 0,
    sampler: config.heapSampler,
    intervalMs: config.heapSampleIntervalMs,
  });
  const heapLog = { lastLoggedAt: -Infinity, refusedSinceLastLog: 0 };
  const lastLogged = { in_flight: -Infinity, subject_in_flight: -Infinity, rate: -Infinity, capacity: -Infinity };
  const suppressed = { in_flight: 0, subject_in_flight: 0, rate: 0, capacity: 0 };

  function prune(now: number): void {
    for (const [key, stamps] of windows) {
      while (stamps.length > 0 && stamps[0] <= now - config.windowMs) stamps.shift();
      if (stamps.length === 0) windows.delete(key);
    }
  }

  function reject(res: express.Response, reason: keyof typeof lastLogged, retryAfterSeconds: number, subject: string, now: number): void {
    if (reason === "in_flight") counters.rejectedInFlight += 1;
    else if (reason === "subject_in_flight") counters.rejectedSubjectInFlight += 1;
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
          rejectedTotal:
            counters.rejectedInFlight + counters.rejectedSubjectInFlight + counters.rejectedRate + counters.rejectedCapacity,
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

  function refuseForHeapPressure(res: express.Response, now: number): void {
    counters.rejectedHeapPressure += 1;
    heapLog.refusedSinceLastLog += 1;
    if (now - heapLog.lastLoggedAt >= HEAP_LOG_INTERVAL_MS) {
      const { usedBytes, limitBytes } = heapGuard.reading;
      logger.warn(
        {
          event: "mcp_heap_pressure_refused",
          heapUsedMb: Math.round(usedBytes / 1_048_576),
          heapLimitMb: Math.round(limitBytes / 1_048_576),
          thresholdPercent: heapGuard.thresholdPercent,
          inFlight: counters.inFlight,
          refusedSinceLastLog: heapLog.refusedSinceLastLog,
        },
        "Refused /mcp requests: the process heap is close to its limit",
      );
      heapLog.lastLoggedAt = now;
      heapLog.refusedSinceLastLog = 0;
    }
    res.setHeader("Retry-After", String(HEAP_RETRY_AFTER_SECONDS));
    res.status(503).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Server is under memory pressure; retry after the interval in the Retry-After header" },
      id: null,
    });
  }

  function watch(req: express.Request, res: express.Response, release: () => void): void {
    const socket = req.socket;
    let done = false;
    // Every path that can end a request ends up here, and only the first one counts. A pipelined request's
    // response gets its socket only when its turn comes, so if the connection dies first it never emits
    // `close`: the socket's own close and error are a release path too.
    const ended = (): void => {
      if (done) return;
      done = true;
      clearTimeout(requestTimer);
      clearInterval(stallTimer);
      socket?.off("close", ended);
      socket?.off("error", ended);
      release();
    };

    const requestTimer = setTimeout(() => {
      counters.timedOut += 1;
      logger.warn({ event: "mcp_request_timed_out", timeoutMs: requestTimeoutMs, inFlight: counters.inFlight }, "Ended a /mcp request that stayed unanswered");
      if (!res.headersSent) {
        res.setHeader("Connection", "close");
        res.status(504).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: `Request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds. Work this call started may still be running: check its status with the tool's status call (for a report, ads_get_report_status) and call again; do not repeat a create blindly.`,
          },
          id: null,
        });
        res.once("finish", () => res.destroy());
        setTimeout(() => res.destroy(), 1_000).unref();
      } else {
        res.destroy();
      }
      ended();
    }, requestTimeoutMs);
    requestTimer.unref();

    let lastLength = 0;
    let stalledSince: number | null = null;
    const stallTimer = setInterval(() => {
      // A pipelined response without a socket yet only buffers; the request timeout bounds how long it can wait.
      if (!res.socket) return;
      const length = res.writableLength;
      if (length === 0) stalledSince = null;
      else if (length < lastLength) stalledSince = Date.now();
      else if (stalledSince === null) stalledSince = Date.now();
      else if (Date.now() - stalledSince >= responseStallMs) {
        counters.stalled += 1;
        logger.warn({ event: "mcp_response_stalled", bufferedBytes: length, stallMs: responseStallMs }, "Closed a /mcp response the client stopped reading");
        res.destroy();
        ended();
        return;
      }
      lastLength = length;
    }, stallCheckMs);
    stallTimer.unref();

    res.once("finish", ended);
    res.once("close", ended);
    socket?.once("close", ended);
    socket?.once("error", ended);
  }

  const middleware: express.RequestHandler = (req, res, next) => {
    const now = clock();

    // Before the slot and before the rate window: a refused call spends neither. It runs after
    // authentication, so an unauthenticated caller never reaches it.
    if (heapGuard.isEngaged(now)) {
      refuseForHeapPressure(res, now);
      return;
    }

    const subject = subjectOf(req);

    if (counters.inFlight >= config.maxInFlight) {
      reject(res, "in_flight", 1, subject, now);
      return;
    }

    const key = hashPii(subject) ?? "unattributed";
    if ((subjectCounts.get(key) ?? 0) >= perSubjectInFlight) {
      reject(res, "subject_in_flight", 1, subject, now);
      return;
    }

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
    subjectCounts.set(key, (subjectCounts.get(key) ?? 0) + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      counters.inFlight -= 1;
      const remaining = (subjectCounts.get(key) ?? 1) - 1;
      if (remaining <= 0) subjectCounts.delete(key);
      else subjectCounts.set(key, remaining);
    };
    watch(req, res, release);
    next();
  };

  return Object.assign(middleware, {
    stats: (): McpAdmissionStats => ({ ...counters, heapPressureEngaged: heapGuard.active, trackedSubjects: windows.size }),
  });
}
