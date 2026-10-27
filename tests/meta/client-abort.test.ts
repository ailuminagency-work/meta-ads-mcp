import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRequestSignal, runWithRequestSignal } from "../../src/auth/token-store.js";
import { MetaApiClient } from "../../src/meta/client.js";
import { collectAllPages } from "../../src/meta/paginator.js";
import { RequestAbortedError } from "../../src/utils/abortable.js";
import { cleanupTestToken, mockFetchResponse, setupTestToken } from "../setup.js";

/** A fetch that never answers, like a stalled Graph call, but ends the way fetch does when its signal aborts. */
function heldFetch() {
  const state = { calls: 0, open: 0 };
  const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
    state.calls += 1;
    state.open += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        state.open -= 1;
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      });
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return state;
}

let client: MetaApiClient;
beforeEach(() => {
  setupTestToken();
  client = new MetaApiClient({ apiVersion: "v26.0", baseUrl: "https://graph.facebook.com", timeout: 30_000, maxRetries: 3 });
});
afterEach(() => {
  cleanupTestToken();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MetaApiClient and the request's abort signal", () => {
  it("ends an in-flight call as soon as the signal aborts, without waiting for its timeout or retrying", async () => {
    const graph = heldFetch();
    const controller = new AbortController();
    const started = Date.now();
    const call = runWithRequestSignal(controller.signal, () => client.get("/act_1/campaigns").catch((e: unknown) => e));
    await vi.waitFor(() => expect(graph.open).toBe(1));
    controller.abort();
    expect(await call).toBeInstanceOf(RequestAbortedError);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(graph.open).toBe(0);
    expect(graph.calls).toBe(1);
  });

  it("does not start a call when the signal is already aborted", async () => {
    const graph = heldFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(runWithRequestSignal(controller.signal, () => client.get("/me"))).rejects.toBeInstanceOf(RequestAbortedError);
    await expect(runWithRequestSignal(controller.signal, () => client.postForm("/act_1/campaigns", { name: "x" }))).rejects.toBeInstanceOf(RequestAbortedError);
    await expect(runWithRequestSignal(controller.signal, () => client.postMultipart("/act_1/adimages", new FormData()))).rejects.toBeInstanceOf(RequestAbortedError);
    expect(graph.calls).toBe(0);
  });

  it("stops retrying: the backoff sleep ends on abort and no further attempt is made", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockFetchResponse({}, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const started = Date.now();
    const call = runWithRequestSignal(controller.signal, () => client.get("/act_1/campaigns").catch((e: unknown) => e));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    expect(await call).toBeInstanceOf(RequestAbortedError);
    expect(Date.now() - started).toBeLessThan(900);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("is unchanged without a signal: a 503 is still retried", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mockFetchResponse({}, { status: 503 }))
      .mockResolvedValueOnce(mockFetchResponse({ data: [{ id: "1" }] }));
    vi.stubGlobal("fetch", fetcher);
    const call = client.get<{ data: unknown[] }>("/act_1/campaigns");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(call).resolves.toEqual({ data: [{ id: "1" }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("removes its listener from the signal when the call finishes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ data: [] })));
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await runWithRequestSignal(controller.signal, () => client.get("/me"));
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
  });

  it("makes the signal visible to everything the call awaits, and to nothing outside it", async () => {
    const controller = new AbortController();
    expect(getRequestSignal()).toBeUndefined();
    await runWithRequestSignal(controller.signal, async () => {
      await Promise.resolve();
      expect(getRequestSignal()).toBe(controller.signal);
    });
    expect(getRequestSignal()).toBeUndefined();
  });
});

describe("paging and the request's abort signal", () => {
  it("stops paging when the signal aborts, instead of returning a partial list as if complete", async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async (after: string) => {
      if (after === "c2") controller.abort();
      return { data: [{ id: after }], paging: { cursors: { after: `c${Number(after.slice(1)) + 1}` }, next: "https://graph.example/next" } };
    });
    const first = { data: [{ id: "first" }], paging: { cursors: { after: "c1" }, next: "https://graph.example/next" } };
    const result = runWithRequestSignal(controller.signal, () => collectAllPages(first as never, fetchPage as never, 1000));
    await expect(result).rejects.toBeInstanceOf(RequestAbortedError);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(["c1", "c2"]);
  });

  it("pages normally without a signal", async () => {
    const fetchPage = vi.fn(async () => ({ data: [{ id: "b" }] }));
    const first = { data: [{ id: "a" }], paging: { cursors: { after: "c1" }, next: "https://graph.example/next" } };
    await expect(collectAllPages(first as never, fetchPage as never, 1000)).resolves.toEqual([{ id: "a" }, { id: "b" }]);
  });
});
