import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestContext } from "../../src/auth/token-store.js";
import { metaApiClient } from "../../src/meta/client.js";
import {
  registerReportTools,
  reportPollThrottleSizeForTests,
  resetReportPollThrottleForTests,
} from "../../src/tools/reports.js";
import { cleanupTestToken, createMockMcpServer, setupTestToken } from "../setup.js";

const REPORT = "123456789012345";
const running = { id: REPORT, async_status: "Job Running", async_percent_completion: 40 };

const server = createMockMcpServer();
registerReportTools(server as never);
const tool = server._registeredTools.find((t: { name: string }) => t.name === "ads_get_report_status")!;

function pollAs(fbUserId: string, reportRunId = REPORT) {
  return requestContext.run({ accessToken: `synthetic-token-${fbUserId}`, fbUserId }, () => tool.handler({ report_run_id: reportRunId }) as Promise<{ content: Array<{ text: string }> }>);
}

describe("ads_get_report_status poll throttle", () => {
  beforeEach(() => {
    setupTestToken();
    resetReportPollThrottleForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanupTestToken();
  });

  it("is not tripped by another tenant asking about the same report id and being refused by Meta", async () => {
    const get = vi.spyOn(metaApiClient, "get");
    get.mockRejectedValueOnce(new Error("(#100) object does not exist or no permission"));
    await expect(pollAs("B")).rejects.toThrow();

    get.mockResolvedValueOnce(running as never);
    const result = await pollAs("A");
    expect(result.content[0].text).toContain("Job Running");
  });

  it("does not make tenants share a poll interval even when both are allowed to read the report", async () => {
    vi.spyOn(metaApiClient, "get").mockResolvedValue(running as never);
    await pollAs("A");
    const other = await pollAs("B");
    expect(other.content[0].text).toContain("Job Running");
  });

  it("still enforces the minimum interval for the same tenant and report, and releases it after 5 s", async () => {
    const get = vi.spyOn(metaApiClient, "get").mockResolvedValue(running as never);
    await pollAs("A");
    await expect(pollAs("A")).rejects.toThrow(/Polling too fast for report 123456789012345\. Wait 5s/);
    expect(get).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-27T12:00:04Z"));
    await expect(pollAs("A")).rejects.toThrow(/Wait 1s/);
    vi.setSystemTime(new Date("2026-10-27T12:00:05Z"));
    await expect(pollAs("A")).resolves.toBeDefined();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not count a poll Meta refused, so the same tenant can retry at once", async () => {
    const get = vi.spyOn(metaApiClient, "get");
    get.mockRejectedValueOnce(new Error("(#100) object does not exist or no permission"));
    await expect(pollAs("A")).rejects.toThrow();
    expect(reportPollThrottleSizeForTests()).toBe(0);
    get.mockResolvedValueOnce(running as never);
    await expect(pollAs("A")).resolves.toBeDefined();
  });

  it("refuses a second poll of the same report by the same tenant while the first is still in flight", async () => {
    let release!: () => void;
    const get = vi.spyOn(metaApiClient, "get").mockImplementation(() => new Promise((resolve) => { release = () => resolve(running as never); }));
    const first = pollAs("A");
    await expect(pollAs("A")).rejects.toThrow(/Polling too fast/);
    expect(get).toHaveBeenCalledTimes(1);
    release();
    await first;
    const other = pollAs("B");
    expect(get).toHaveBeenCalledTimes(2);
    release();
    await other;
  });

  it("forgets entries once they can no longer throttle anything, and never holds more than a fixed number", async () => {
    vi.spyOn(metaApiClient, "get").mockResolvedValue(running as never);
    for (let i = 0; i < 40; i++) await pollAs("A", String(900000000000000 + i));
    expect(reportPollThrottleSizeForTests()).toBe(40);
    vi.setSystemTime(new Date("2026-10-27T12:00:06Z"));
    await pollAs("A", "999999999999999");
    expect(reportPollThrottleSizeForTests()).toBe(1);

    for (let i = 0; i < 6000; i++) await pollAs("A", String(100000000000000 + i));
    expect(reportPollThrottleSizeForTests()).toBeLessThanOrEqual(5000);
  });
});
