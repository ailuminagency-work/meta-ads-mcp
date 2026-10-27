import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiClient } from "../../src/meta/client.js";
import { tokenManager } from "../../src/auth/token-manager.js";
import { cleanupTestToken, mockFetchResponse, setupTestToken } from "../setup.js";

const gapMs = 1000 / ((300 + 40 * 50) / 3600);

describe("MetaApiClient write pacing per ad account", () => {
  let client: MetaApiClient;

  beforeEach(() => {
    setupTestToken();
    tokenManager.resetForTests();
    client = new MetaApiClient({ apiVersion: "v26.0", timeout: 5000, maxRetries: 0 });
  });

  afterEach(() => {
    cleanupTestToken();
    tokenManager.resetForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pacerKeys = () =>
    client
      .getUsageSnapshot()
      .writePacer.map((bucket) => bucket.key.split(":")[1])
      .sort();

  it("charges updates to /{campaign_id} to the account that listed the campaign", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          mockFetchResponse({ data: [{ id: "9001" }, { id: "9002" }, { id: "9003" }] }),
        )
        .mockResolvedValue(mockFetchResponse({ success: true })),
    );

    await client.get("/act_123/campaigns", { fields: "id" });
    for (const id of ["9001", "9002", "9003"]) await client.postForm(`/${id}`, { status: "PAUSED" });

    expect(pacerKeys()).toEqual(["act_123"]);
  });

  it("learns the account of a campaign it just created", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(mockFetchResponse({ id: "7777" }))
        .mockResolvedValue(mockFetchResponse({ success: true })),
    );

    await client.postForm("/act_55/campaigns", { name: "synthetic" });
    await client.postForm("/7777", { status: "PAUSED" });

    expect(pacerKeys()).toEqual(["act_55"]);
  });

  it("learns from an account_id field on a single-object read", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(mockFetchResponse({ id: "4242", account_id: "808" }))
        .mockResolvedValue(mockFetchResponse({ success: true })),
    );

    await client.get("/4242", { fields: "account_id" });
    await client.postForm("/4242", { name: "synthetic" });

    expect(pacerKeys()).toEqual(["act_808"]);
  });

  it("falls back to one per-token bucket for objects it has never seen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ success: true })));

    for (const id of ["31", "32", "33", "34"]) await client.postForm(`/${id}`, { name: "synthetic" });

    expect(pacerKeys()).toEqual(["_token"]);
  });

  it("paces a bulk update of 25 learned campaigns at the account rate", async () => {
    vi.useFakeTimers();
    const ids = Array.from({ length: 25 }, (_, i) => String(5000 + i));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse({ data: ids.map((id) => ({ id })) }))
      .mockResolvedValue(mockFetchResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await client.get("/act_900/campaigns");
    fetchMock.mockClear();

    let done = 0;
    for (const id of ids) void client.postForm(`/${id}`, { status: "PAUSED" }).then(() => done++);

    await vi.advanceTimersByTimeAsync(2 * gapMs);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12);
    expect(done).toBeLessThanOrEqual(12);

    await vi.advanceTimersByTimeAsync(20 * gapMs);
    expect(done).toBe(25);
    expect(pacerKeys()).toEqual(["act_900"]);
  });

  it("keeps different accounts independent when objects are learned from different listings", async () => {
    vi.useFakeTimers();
    const a = Array.from({ length: 20 }, (_, i) => String(100 + i));
    const b = ["800", "801"];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse({ data: a.map((id) => ({ id })) }))
      .mockResolvedValueOnce(mockFetchResponse({ data: b.map((id) => ({ id })) }))
      .mockResolvedValue(mockFetchResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    await client.get("/act_1/ads");
    await client.get("/act_2/ads");

    for (const id of a) void client.postForm(`/${id}`, { status: "PAUSED" });
    let otherDone = 0;
    for (const id of b) void client.postForm(`/${id}`, { status: "PAUSED" }).then(() => otherDone++);

    await vi.advanceTimersByTimeAsync(5);
    expect(otherDone).toBe(2);
  });
});
