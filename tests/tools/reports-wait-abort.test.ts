import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runWithRequestSignal } from "../../src/auth/token-store.js";
import { metaApiClient } from "../../src/meta/client.js";
import { registerReportTools } from "../../src/tools/reports.js";
import { RequestAbortedError } from "../../src/utils/abortable.js";
import { cleanupTestToken, createMockMcpServer, setupTestToken } from "../setup.js";

const REPORT = "123456789012345";
const server = createMockMcpServer();
registerReportTools(server as never);
const tool = server._registeredTools.find((t: { name: string }) => t.name === "ads_run_report_and_wait")!;
const args = (overrides: Record<string, unknown> = {}) => ({
  object_id: "act_1", level: "campaign", date_preset: "last_7d", use_unified_attribution_setting: true,
  max_wait_seconds: 600, poll_interval_seconds: 10, result_limit: 100, ...overrides,
});

let create: ReturnType<typeof vi.spyOn>;
let poll: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  setupTestToken();
  vi.useFakeTimers();
  create = vi.spyOn(metaApiClient, "postForm").mockResolvedValue({ report_run_id: REPORT } as never);
  poll = vi.spyOn(metaApiClient, "get").mockResolvedValue({ id: REPORT, async_status: "Job Running", async_percent_completion: 10 } as never);
});
afterEach(() => {
  cleanupTestToken();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ads_run_report_and_wait", () => {
  it("stops polling the moment its caller is gone, and leaves no timer behind", async () => {
    const controller = new AbortController();
    const call = (tool.handler as (...a: unknown[]) => Promise<unknown>)(args(), { signal: controller.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);

    controller.abort();
    expect(await call).toBeInstanceOf(RequestAbortedError);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes the signal from the request context when the handler is not handed one", async () => {
    const controller = new AbortController();
    const call = runWithRequestSignal(controller.signal, () => (tool.handler as (...a: unknown[]) => Promise<unknown>)(args()).catch((e: unknown) => e));
    await vi.advanceTimersByTimeAsync(10_000);
    controller.abort();
    expect(await call).toBeInstanceOf(RequestAbortedError);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("does not even create the report for a caller that is already gone", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect((tool.handler as (...a: unknown[]) => Promise<unknown>)(args(), { signal: controller.signal })).rejects.toBeInstanceOf(RequestAbortedError);
    expect(create).not.toHaveBeenCalled();
  });

  it("never waits longer than 900 s, whatever was asked for", async () => {
    const call = (tool.handler as (...a: unknown[]) => Promise<{ content: Array<{ text: string }> }>)(args({ max_wait_seconds: 3600 }), {});
    await vi.advanceTimersByTimeAsync(1_000_000);
    const result = await call;
    expect(result.content[0].text).toMatch(/Timed out after 900s/);
    // polls start at 10 s and grow by half up to 60 s: far fewer than one per second, and none after the cap
    const pollsAtCap = poll.mock.calls.length;
    expect(pollsAtCap).toBeGreaterThan(5);
    expect(pollsAtCap).toBeLessThan(40);
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(poll).toHaveBeenCalledTimes(pollsAtCap);
  });

  it("advertises and enforces the 900 s cap in its input schema", () => {
    const shape = tool.schema as Record<string, z.ZodType>;
    expect(shape.max_wait_seconds.safeParse(900).success).toBe(true);
    expect(shape.max_wait_seconds.safeParse(901).success).toBe(false);
    expect(shape.max_wait_seconds.safeParse(3600).success).toBe(false);
    expect(tool.description).toContain("Max wait: 900s");
  });

  it("still returns the rows when the report completes", async () => {
    poll.mockResolvedValueOnce({ id: REPORT, async_status: "Job Completed", async_percent_completion: 100 } as never);
    poll.mockResolvedValueOnce({ data: [{ spend: "1" }] } as never);
    const call = (tool.handler as (...a: unknown[]) => Promise<{ content: Array<{ text: string }> }>)(args(), { signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await call;
    expect(result.content[0].text).toContain("completed: 1 row(s)");
  });
});
