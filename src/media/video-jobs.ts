import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../utils/logger.js";

export const VIDEO_TMP_PREFIX = "meta-ads-video-";

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_QUEUED = 8;
// One tenant may wait for at most this many places, so a burst from one account cannot take the whole queue.
const DEFAULT_MAX_QUEUED_PER_TENANT = 2;
// Tenants remembered for fair dequeue; the oldest are forgotten first.
const MAX_REMEMBERED_TENANTS = 1024;
const DEFAULT_QUEUE_WAIT_MS = 20_000;
// Cloud Run caps a request at 300 s; leave headroom to serialise the response.
const DEFAULT_BUDGET_MS = 240_000;
const DEFAULT_PER_TENANT_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

export class VideoJobBusyError extends Error {
  constructor(message = "The server is busy processing other videos; retry in a few seconds.") {
    super(message);
    this.name = "VideoJobBusyError";
  }
}

export class VideoJobTenantQueueFullError extends VideoJobBusyError {
  constructor(limit: number) {
    super(`This user already has ${limit} videos waiting for a free slot; retry when one has finished.`);
    this.name = "VideoJobTenantQueueFullError";
  }
}

export class VideoJobRateLimitError extends Error {
  constructor(limit: number) {
    super(`Video processing limit reached (${limit} jobs per hour for this user); try again later.`);
    this.name = "VideoJobRateLimitError";
  }
}

export interface VideoJobRequest {
  tenantId: string;
  signal?: AbortSignal;
}

export interface VideoJobContext {
  /** Private scratch directory, removed when the job settles. */
  dir: string;
  /** Aborts on caller disconnect or when the time budget runs out. */
  signal: AbortSignal;
  deadline: number;
  remainingMs(): number;
  outOfTime(): boolean;
}

export interface VideoJobRunnerConfig {
  maxConcurrent?: number;
  maxQueued?: number;
  maxQueuedPerTenant?: number;
  queueWaitMs?: number;
  budgetMs?: number;
  perTenantPerHour?: number;
  tmpRoot?: string;
  now?: () => number;
}

export interface VideoJobRunner {
  run<T>(request: VideoJobRequest, job: (ctx: VideoJobContext) => Promise<T>): Promise<T>;
  stats(): { running: number; queued: number; tracked_tenants: number };
}

export class VideoJobAbortedError extends Error {
  constructor() {
    super("Video job aborted by the caller");
    this.name = "VideoJobAbortedError";
  }
}

interface Waiter {
  tenantId: string;
  resolve: () => void;
  reject: (err: Error) => void;
  cancel: () => void;
}

export function createVideoJobRunner(config: VideoJobRunnerConfig = {}): VideoJobRunner {
  const maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const maxQueued = config.maxQueued ?? DEFAULT_MAX_QUEUED;
  const maxQueuedPerTenant = config.maxQueuedPerTenant ?? DEFAULT_MAX_QUEUED_PER_TENANT;
  const queueWaitMs = config.queueWaitMs ?? DEFAULT_QUEUE_WAIT_MS;
  const budgetMs = config.budgetMs ?? DEFAULT_BUDGET_MS;
  const perTenantPerHour = config.perTenantPerHour ?? DEFAULT_PER_TENANT_PER_HOUR;
  const tmpRoot = config.tmpRoot ?? os.tmpdir();
  const now = config.now ?? Date.now;

  let running = 0;
  const waiters: Waiter[] = [];
  const tenantWindows = new Map<string, number[]>();
  // Insertion order is service order: the first key is the tenant that ran longest ago.
  const lastServed = new Map<string, true>();

  const markServed = (tenantId: string): void => {
    lastServed.delete(tenantId);
    lastServed.set(tenantId, true);
    if (lastServed.size > MAX_REMEMBERED_TENANTS) {
      const oldest = lastServed.keys().next().value;
      if (oldest !== undefined) lastServed.delete(oldest);
    }
  };

  // Round-robin across tenants: the waiting tenant that ran longest ago goes next
  // (one that never ran, or is forgotten, before any that did), oldest waiter first
  // within a tenant, so a tenant that keeps its places full cannot stand ahead of the rest.
  const pickNextWaiter = (): Waiter | undefined => {
    if (waiters.length === 0) return undefined;
    const waiting = new Set(waiters.map((w) => w.tenantId));
    let tenant: string | undefined;
    for (const candidate of waiting) {
      if (!lastServed.has(candidate)) {
        tenant = candidate;
        break;
      }
    }
    if (tenant === undefined) {
      for (const served of lastServed.keys()) {
        if (waiting.has(served)) {
          tenant = served;
          break;
        }
      }
    }
    const index = waiters.findIndex((w) => w.tenantId === tenant);
    return waiters.splice(index >= 0 ? index : 0, 1)[0];
  };

  const removeWaiter = (waiter: Waiter) => {
    const idx = waiters.indexOf(waiter);
    if (idx >= 0) waiters.splice(idx, 1);
  };

  const acquire = (tenantId: string, signal: AbortSignal | undefined): Promise<void> => {
    if (signal?.aborted) return Promise.reject(new VideoJobAbortedError());
    if (running < maxConcurrent) {
      running += 1;
      markServed(tenantId);
      return Promise.resolve();
    }
    if (waiters.filter((w) => w.tenantId === tenantId).length >= maxQueuedPerTenant) {
      return Promise.reject(new VideoJobTenantQueueFullError(maxQueuedPerTenant));
    }
    if (waiters.length >= maxQueued) {
      return Promise.reject(new VideoJobBusyError());
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => waiter.cancel(new VideoJobBusyError()), queueWaitMs);
      const onAbort = () => waiter.cancel(new VideoJobAbortedError());
      const waiter: Waiter & { cancel: (err?: Error) => void } = {
        tenantId,
        resolve: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          running += 1;
          markServed(tenantId);
          resolve();
        },
        reject,
        // A cancelled waiter leaves the queue immediately so it cannot hold a
        // queue position (or later a slot) for a caller that is gone.
        cancel: (err: Error = new VideoJobAbortedError()) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          removeWaiter(waiter);
          reject(err);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiters.push(waiter);
    });
  };

  const release = (): void => {
    running -= 1;
    const next = pickNextWaiter();
    if (next) next.resolve();
  };

  const purgeExpiredWindows = (current: number): void => {
    for (const [tenant, stamps] of tenantWindows) {
      const recent = stamps.filter((t) => current - t < HOUR_MS);
      if (recent.length === 0) tenantWindows.delete(tenant);
      else tenantWindows.set(tenant, recent);
    }
  };

  const assertTenantRate = (tenantId: string): number[] => {
    const current = now();
    purgeExpiredWindows(current);
    const recent = tenantWindows.get(tenantId) ?? [];
    if (recent.length >= perTenantPerHour) {
      throw new VideoJobRateLimitError(perTenantPerHour);
    }
    return recent;
  };

  // The allowance is spent when a job starts, not when it asks for a slot: a
  // call turned away as busy, abandoned in the queue or aborted before it ran
  // has done no work and must not cost the tenant one.
  const spendTenantRate = (tenantId: string): void => {
    const recent = assertTenantRate(tenantId);
    recent.push(now());
    tenantWindows.set(tenantId, recent);
  };

  return {
    async run(request, job) {
      if (request.signal?.aborted) throw new VideoJobAbortedError();
      assertTenantRate(request.tenantId);
      await acquire(request.tenantId, request.signal);

      const controller = new AbortController();
      const start = now();
      const deadline = start + budgetMs;
      const onCallerAbort = () => controller.abort();
      request.signal?.addEventListener("abort", onCallerAbort, { once: true });
      const deadlineTimer = setTimeout(() => controller.abort(), budgetMs);

      let dir: string | undefined;
      try {
        if (request.signal?.aborted) throw new VideoJobAbortedError();
        dir = await fs.mkdtemp(path.join(tmpRoot, VIDEO_TMP_PREFIX));
        if (request.signal?.aborted) throw new VideoJobAbortedError();
        // Callers that passed the first check together are told apart here.
        spendTenantRate(request.tenantId);
        const ctx: VideoJobContext = {
          dir,
          signal: controller.signal,
          deadline,
          remainingMs: () => Math.max(0, deadline - now()),
          outOfTime: () => now() >= deadline,
        };
        return await job(ctx);
      } finally {
        clearTimeout(deadlineTimer);
        request.signal?.removeEventListener("abort", onCallerAbort);
        // Scratch is removed before the slot is handed on, so the next job
        // never shares tmpfs with this one's originals.
        if (dir) {
          await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch((err: unknown) => {
            logger.warn({ err, event: "video_job_cleanup_failed" }, "Could not remove video scratch directory");
          });
        }
        release();
      }
    },
    stats() {
      return { running, queued: waiters.length, tracked_tenants: tenantWindows.size };
    },
  };
}

/** Removes scratch directories left behind by a killed process (tmpfs is not wiped on stdio/local). */
export async function sweepStaleVideoDirs(options: { tmpRoot?: string; olderThanMs?: number } = {}): Promise<number> {
  const tmpRoot = options.tmpRoot ?? os.tmpdir();
  const olderThanMs = options.olderThanMs ?? HOUR_MS;
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(tmpRoot);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(VIDEO_TMP_PREFIX)) continue;
    const full = path.join(tmpRoot, entry);
    try {
      const stat = await fs.lstat(full);
      if (!stat.isDirectory() || Date.now() - stat.mtimeMs < olderThanMs) continue;
      await fs.rm(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Best effort: another process may own or have removed it.
    }
  }
  return removed;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

let defaultRunner: VideoJobRunner | undefined;

export function getVideoJobRunner(): VideoJobRunner {
  if (!defaultRunner) {
    defaultRunner = createVideoJobRunner({
      // The agency deployment runs on one vCPU / 1 GB, where two heavy jobs can exhaust memory.
      maxConcurrent: envInt(
        "VIDEO_MAX_CONCURRENT_JOBS",
        process.env.DEPLOYMENT_MODE === "agency" ? 1 : DEFAULT_MAX_CONCURRENT,
      ),
      budgetMs: envInt("VIDEO_CALL_BUDGET_MS", DEFAULT_BUDGET_MS),
      perTenantPerHour: envInt("VIDEO_JOBS_PER_TENANT_PER_HOUR", DEFAULT_PER_TENANT_PER_HOUR),
    });
  }
  return defaultRunner;
}

export function configureVideoJobRunnerForTests(runner: VideoJobRunner | undefined): void {
  defaultRunner = runner;
}
