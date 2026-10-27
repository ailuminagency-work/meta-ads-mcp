import v8 from "node:v8";

export const DEFAULT_MCP_HEAP_PRESSURE_PERCENT = 80;
export const MIN_MCP_HEAP_PRESSURE_PERCENT = 50;
export const MAX_MCP_HEAP_PRESSURE_PERCENT = 95;
export const HEAP_SAMPLE_INTERVAL_MS = 250;
// A high reading older than this is not "consecutive" with a new one: a peak long ago, then a quiet
// stretch, then another peak must not engage the guard.
export const HEAP_SAMPLE_STALE_MS = 2_000;

export interface HeapReading {
  usedBytes: number;
  limitBytes: number;
}

export type HeapSampler = () => HeapReading;

/** The V8 heap of this process. `used_heap_size` still counts garbage that has not been collected yet. */
export const processHeapSampler: HeapSampler = () => {
  const statistics = v8.getHeapStatistics();
  return { usedBytes: statistics.used_heap_size, limitBytes: statistics.heap_size_limit };
};

/**
 * MCP_HEAP_PRESSURE_PERCENT: unset or empty gives the default, `0` or `off` (any case) turns the check
 * off, anything else must be a whole number from 50 to 95. A set but unusable value stops startup.
 */
export function readHeapPressurePercent(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MCP_HEAP_PRESSURE_PERCENT?.trim();
  if (!raw) return DEFAULT_MCP_HEAP_PRESSURE_PERCENT;
  if (raw === "0" || raw.toLowerCase() === "off") return 0;
  if (!/^[1-9]\d{0,2}$/.test(raw) || Number(raw) < MIN_MCP_HEAP_PRESSURE_PERCENT || Number(raw) > MAX_MCP_HEAP_PRESSURE_PERCENT) {
    throw new Error(
      `MCP_HEAP_PRESSURE_PERCENT must be an integer from ${MIN_MCP_HEAP_PRESSURE_PERCENT} to ${MAX_MCP_HEAP_PRESSURE_PERCENT}, or 0 or off to turn the check off`,
    );
  }
  return Number(raw);
}

export interface HeapPressureOptions {
  /** 0 turns the guard off. */
  percent: number;
  sampler?: HeapSampler;
  intervalMs?: number;
  staleMs?: number;
}

/**
 * Process-level brake for work nobody can cancel. Handlers that ignore the abort signal keep their
 * memory after the caller is gone, and enough credentials can pile them up past the heap limit, which
 * ends the process for everyone. While the heap is above the threshold, new calls are refused.
 *
 * The reading is taken lazily, at most once per interval, and cached in between, so the check is a
 * comparison. The guard engages only after two consecutive readings above the threshold at least one
 * interval apart, and releases at the first reading below it: one high reading can be uncollected
 * garbage, two in a row mean the heap did not come down between them.
 */
export class HeapPressureGuard {
  private readonly percent: number;
  private readonly sampler: HeapSampler;
  private readonly intervalMs: number;
  private readonly staleMs: number;
  private lastSampleAt = Number.NEGATIVE_INFINITY;
  private consecutiveHigh = 0;
  private engaged = false;
  private lastReading: HeapReading = { usedBytes: 0, limitBytes: 0 };

  constructor(options: HeapPressureOptions) {
    this.percent = options.percent;
    this.sampler = options.sampler ?? processHeapSampler;
    this.intervalMs = options.intervalMs ?? HEAP_SAMPLE_INTERVAL_MS;
    this.staleMs = options.staleMs ?? HEAP_SAMPLE_STALE_MS;
  }

  get enabled(): boolean {
    return this.percent > 0;
  }

  get thresholdPercent(): number {
    return this.percent;
  }

  /** The state after the latest reading; asking does not take one. */
  get active(): boolean {
    return this.engaged;
  }

  get reading(): HeapReading {
    return this.lastReading;
  }

  isEngaged(now: number): boolean {
    if (this.percent <= 0) return false;
    const elapsed = now - this.lastSampleAt;
    if (elapsed >= this.intervalMs || elapsed < 0) this.sample(now);
    return this.engaged;
  }

  private sample(now: number): void {
    const reading = this.sampler();
    const over = reading.limitBytes > 0 && (reading.usedBytes / reading.limitBytes) * 100 > this.percent;
    const sinceLast = now - this.lastSampleAt;
    const previousIsFresh = sinceLast >= 0 && sinceLast <= this.staleMs;
    this.consecutiveHigh = over ? (previousIsFresh ? this.consecutiveHigh + 1 : 1) : 0;
    this.engaged = this.consecutiveHigh >= 2;
    this.lastSampleAt = now;
    this.lastReading = reading;
  }
}
