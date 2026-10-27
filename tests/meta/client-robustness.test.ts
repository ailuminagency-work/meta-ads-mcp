import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { MetaApiClient, isTransportRetrySafe } from "../../src/meta/client.js";
import { tokenManager } from "../../src/auth/token-manager.js";
import { cleanupTestToken, mockFetchResponse, setupTestToken } from "../setup.js";

const encoder = new TextEncoder();

interface DripOptions {
  signal: AbortSignal | null | undefined;
  intervalMs: number;
  honourAbort: boolean;
  stop: { value: boolean };
}

function slowDrip({ signal, intervalMs, honourAbort, stop }: DripOptions): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (honourAbort) {
        signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      }
    },
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (stop.value) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(sent++ === 0 ? '{"data":[' : "1,"));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

function endless(chunkBytes: number, counter: { pulled: number }, headers: Record<string, string> = {}): Response {
  const chunk = encoder.encode("x".repeat(chunkBytes));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      counter.pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return new Response(body, { status: 200, headers });
}

describe("MetaApiClient response bounding and timeouts", () => {
  let stop: { value: boolean };

  beforeEach(() => {
    setupTestToken();
    tokenManager.resetForTests();
    stop = { value: false };
  });

  afterEach(() => {
    stop.value = true;
    cleanupTestToken();
    tokenManager.resetForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const client = (overrides: ConstructorParameters<typeof MetaApiClient>[0] = {}) =>
    new MetaApiClient({ apiVersion: "v26.0", timeout: 200, maxRetries: 0, ...overrides });

  describe("timeout covers the body read", () => {
    it(
      "times out a response whose headers arrive but whose body drips forever",
      async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
          slowDrip({ signal: init?.signal, intervalMs: 50, honourAbort: true, stop }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const started = Date.now();

        await expect(client().get("/act_1/campaigns")).rejects.toThrow("Request timeout after 200ms");

        expect(Date.now() - started).toBeLessThan(2_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
      5_000,
    );

    it(
      "still times out when the fetch implementation does not propagate the abort to the body",
      async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(async (_url: string, init?: RequestInit) =>
            slowDrip({ signal: init?.signal, intervalMs: 50, honourAbort: false, stop }),
          ),
        );

        await expect(client().get("/act_1/campaigns")).rejects.toThrow("Request timeout after 200ms");
      },
      5_000,
    );

    it(
      "keeps timing out a slow body as a retryable timeout for reads",
      async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
          slowDrip({ signal: init?.signal, intervalMs: 50, honourAbort: true, stop }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(client({ maxRetries: 1 }).get("/act_1/campaigns")).rejects.toThrow(
          "Request timeout after 200ms",
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
      },
      10_000,
    );

    it(
      "never retries a creating POST whose body stalls",
      async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
          slowDrip({ signal: init?.signal, intervalMs: 50, honourAbort: true, stop }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(
          client({ maxRetries: 3 }).postForm("/act_1/campaigns", { name: "synthetic" }),
        ).rejects.toThrow("Request timeout after 200ms");
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
      5_000,
    );

    it("times out when the response headers never arrive", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
          }),
        ),
      );
      await expect(client().get("/me")).rejects.toThrow("Request timeout after 200ms");
    });
  });

  describe("response size bound", () => {
    it("rejects a declared oversized body without reading it and does not retry", async () => {
      const counter = { pulled: 0 };
      const fetchMock = vi.fn(async () =>
        endless(1024, counter, { "content-length": String(50 * 1024 * 1024) }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(client({ maxRetries: 3, maxResponseBytes: 4096 }).get("/act_1/insights")).rejects.toThrow(
        "META_PROVIDER_RESPONSE_TOO_LARGE",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(counter.pulled).toBeLessThan(64 * 1024);
    });

    it("stops reading a streamed oversized body shortly after the limit", async () => {
      const counter = { pulled: 0 };
      vi.stubGlobal("fetch", vi.fn(async () => endless(1024, counter)));

      await expect(client({ maxResponseBytes: 8192 }).get("/act_1/insights")).rejects.toThrow(
        "META_PROVIDER_RESPONSE_TOO_LARGE",
      );
      expect(counter.pulled).toBeLessThan(8192 + 64 * 1024);
    });

    it("applies a 10 MiB default bound", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response("{}", { status: 200, headers: { "content-length": String(11 * 1024 * 1024) } }),
        ),
      );
      await expect(client().get("/me")).rejects.toThrow("META_PROVIDER_RESPONSE_TOO_LARGE");
    });

    it("accepts a body exactly at the limit", async () => {
      const exact = JSON.stringify({ data: [], pad: "p".repeat(100) });
      vi.stubGlobal("fetch", vi.fn(async () => new Response(exact, { status: 200 })));
      await expect(
        client({ maxResponseBytes: Buffer.byteLength(exact) }).get("/me"),
      ).resolves.toMatchObject({ data: [] });
    });

    it("measures bytes, not UTF-16 units", async () => {
      const multibyte = JSON.stringify({ name: "é".repeat(200) });
      vi.stubGlobal("fetch", vi.fn(async () => new Response(multibyte, { status: 200 })));
      await expect(client({ maxResponseBytes: multibyte.length }).get("/me")).rejects.toThrow(
        "META_PROVIDER_RESPONSE_TOO_LARGE",
      );
    });

    it("does not echo any of the oversized body in the error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("synthetic-secret-".repeat(1000), { status: 200 })),
      );
      const error = await client({ maxResponseBytes: 100 }).get("/me").catch((e: unknown) => e);
      expect(String((error as Error).message)).not.toContain("synthetic-secret");
    });
  });

  describe("error classification is preserved", () => {
    it("still maps a Graph error body to a classified MCP error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => mockFetchResponse({ error: { message: "x", type: "OAuthException", code: 190 } })),
      );
      await expect(client().get("/me")).rejects.toBeInstanceOf(McpError);
    });

    it("still reports a non-JSON 200 as a transport failure", async () => {
      const fetchMock = vi.fn(async () => new Response("<html>gateway</html>", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(client().get("/me")).rejects.toThrow("META_PROVIDER_TRANSPORT_FAILED");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("still reports a non-Graph HTTP failure without echoing its body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response('{"detail":"synthetic-secret"}', { status: 404 })),
      );
      const error = await client().get("/me").catch((e: unknown) => e);
      expect(String((error as Error).message)).toBe("Meta provider HTTP 404");
    });

    it("reports a body that dies mid-stream as a transport failure, not a timeout or size error", async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"data":['));
          controller.error(new TypeError("terminated"));
        },
      });
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
      await expect(client().get("/me")).rejects.toThrow("META_PROVIDER_TRANSPORT_FAILED");
    });
  });
});

describe("creating POSTs are never retried", () => {
  beforeEach(() => {
    setupTestToken();
    tokenManager.resetForTests();
  });

  afterEach(() => {
    cleanupTestToken();
    tokenManager.resetForTests();
    vi.unstubAllGlobals();
  });

  const creatingPaths = [
    "/act_1/campaigns",
    "/act_1/ads",
    "/123/copies",
    "/111/message_templates",
    "/111/flows",
    "/333/message_qrdls",
    "/333/request_code",
    "/123/feed",
    "/123/photos",
    "/123/videos",
    "/123/media",
    "/123/media_publish",
    "/123/messages",
    "/123/comments",
    "/",
  ];

  const failures: Array<[string, () => Promise<Response>]> = [
    ["a Graph 5xx error body", async () => mockFetchResponse({ error: { message: "x", type: "API_ERROR", code: 1 } }) as unknown as Response],
    ["a 502 with an HTML body", async () => new Response("<html>bad gateway</html>", { status: 502 })],
    ["a network error", async () => { throw new TypeError("fetch failed"); }],
    ["a truncated body", async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError("terminated")); } }), { status: 200 })],
    ["a JSON parse failure", async () => new Response("{not json", { status: 200 })],
  ];

  for (const [label, failure] of failures) {
    it.each(creatingPaths)(`makes exactly one attempt to POST %s after ${label}`, async (path) => {
      const fetchMock = vi.fn(failure);
      vi.stubGlobal("fetch", fetchMock);
      const client = new MetaApiClient({ apiVersion: "v26.0", timeout: 1000, maxRetries: 3 });

      await expect(client.postForm(path, { name: "synthetic" })).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  it.each([
    ["GET", "/me", true],
    ["GET", "/act_1/campaigns", true],
    ["DELETE", "/123", true],
    ["POST", "/123", true],
    ["POST", "/act_1", true],
    ["POST", "/123?fields=id", true],
    ["POST", "/act_1/campaigns", false],
    ["POST", "/123/copies", false],
    ["POST", "/123/feed", false],
    ["POST", "/123/media_publish", false],
    ["POST", "/123/messages", false],
    ["POST", "/", false],
    ["POST", "", false],
    ["PUT", "/123", false],
    ["PATCH", "/123", false],
  ])("isTransportRetrySafe(%s %s) is %s", (method, path, expected) => {
    expect(isTransportRetrySafe(method, path)).toBe(expected);
  });
});
