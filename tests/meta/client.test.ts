import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaApiClient } from "../../src/meta/client.js";
import { setupTestToken, cleanupTestToken, mockFetchResponse } from "../setup.js";
import { tokenManager } from "../../src/auth/token-manager.js";
import { logger } from "../../src/utils/logger.js";

describe("MetaApiClient", () => {
  let client: MetaApiClient;

  beforeEach(() => {
    setupTestToken();
    tokenManager.resetForTests();
    client = new MetaApiClient({
      apiVersion: "v26.0",
      baseUrl: "https://graph.facebook.com",
      timeout: 5000,
      maxRetries: 0,
    });
  });

  afterEach(() => {
    cleanupTestToken();
    tokenManager.resetForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("constructor", () => {
    it("sends requests to Graph API v26.0 when no version is configured", async () => {
      vi.stubEnv("META_API_VERSION", undefined);
      const defaultClient = new MetaApiClient({ maxRetries: 0 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ data: [] })));

      await defaultClient.get("/me/adaccounts");

      const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
      expect(url.pathname).toBe("/v26.0/me/adaccounts");
    });

    it("refuses a configured API version that is not a plain version", () => {
      expect(() => new MetaApiClient({ apiVersion: "v26.0/../v22.0" })).toThrow(/v26\.0/);
    });

    it("sends requests to the version in META_API_VERSION when it is set", async () => {
      vi.stubEnv("META_API_VERSION", "v25.0");
      const envClient = new MetaApiClient({ maxRetries: 0 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ data: [] })));

      await envClient.get("/me/adaccounts");

      const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
      expect(url.pathname).toBe("/v25.0/me/adaccounts");
    });

    it("respects custom API version", async () => {
      const customClient = new MetaApiClient({
        apiVersion: "v21.0",
        maxRetries: 0,
      });

      const mockResponse = mockFetchResponse({ data: [] });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await customClient.get("/me/adaccounts");
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain("v21.0");
    });
  });

  // Once a Marketing API version is retired, Meta keeps serving the endpoints
  // that did not change, says so in this header, and rejects the ones that
  // did. The warning therefore confirms the version pin is already overdue.
  describe("deprecated version warnings", () => {
    const autoUpgraded = () => mockFetchResponse({ data: [] }, {
      headers: {
        "X-Ad-Api-Version-Warning": "The call has been auto-upgraded to v27.0 as v26.0 has been deprecated",
      },
    });

    it("logs the configured version without repeating provider-controlled warning text", async () => {
      const warn = vi.spyOn(logger, "warn");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(autoUpgraded()));

      await client.get("/act_123456789012345/insights");

      const versionWarning = warn.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === "meta_api_version_auto_upgraded",
      );
      expect(versionWarning?.[0]).toEqual({
        event: "meta_api_version_auto_upgraded",
        apiVersion: "v26.0",
      });
      expect(versionWarning?.[1]).toContain("API version warning");
      expect(versionWarning?.[1]).not.toContain("auto-upgraded to v27.0");
      expect(versionWarning?.[1]).not.toContain("123456789012345");
    });

    it("does not repeat the warning on every call", async () => {
      const warn = vi.spyOn(logger, "warn");
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => autoUpgraded()));

      await client.get("/act_123/insights");
      await client.get("/act_123/campaigns");

      const versionWarnings = warn.mock.calls.filter(
        ([payload]) => (payload as { event?: string }).event === "meta_api_version_auto_upgraded",
      );
      expect(versionWarnings).toHaveLength(1);
    });

    it("stays quiet when Meta served the requested version", async () => {
      const warn = vi.spyOn(logger, "warn");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ data: [] })));

      await client.get("/act_123/insights");

      const versionWarnings = warn.mock.calls.filter(
        ([payload]) => (payload as { event?: string }).event === "meta_api_version_auto_upgraded",
      );
      expect(versionWarnings).toHaveLength(0);
    });
  });

  it("does not log an unrecognized provider access tier from usage headers", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ data: [] }, {
      headers: { "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 1, ads_api_access_tier: "access_token=SECRET123" }) },
    })));
    await client.get("/act_123/campaigns");
    expect(JSON.stringify(info.mock.calls)).not.toContain("SECRET123");
  });

  describe("get", () => {
    it("makes GET request with correct URL", async () => {
      const mockResponse = mockFetchResponse({ id: "123", name: "Test" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      const result = await client.get<{ id: string; name: string }>("/123", {
        fields: "id,name",
      });

      expect(result).toEqual({ id: "123", name: "Test" });
      const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
      expect(url.pathname).toBe("/v26.0/123");
      expect(url.searchParams.get("fields")).toBe("id,name");
      expect(url.searchParams.get("access_token")).toBe("test-access-token");
    });

    it("omits undefined params", async () => {
      const mockResponse = mockFetchResponse({ data: [] });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await client.get("/me/adaccounts", {
        fields: "id",
        limit: undefined,
      });

      const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
      expect(url.searchParams.has("limit")).toBe(false);
    });
  });

  describe("post", () => {
    it("makes POST request with JSON body", async () => {
      const mockResponse = mockFetchResponse({ id: "new_123" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      const result = await client.post<{ id: string }>("/act_123/campaigns", {
        name: "Test Campaign",
        objective: "OUTCOME_TRAFFIC",
      });

      expect(result).toEqual({ id: "new_123" });
      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[1]?.method).toBe("POST");
      expect(call[1]?.headers).toEqual(
        expect.objectContaining({ "Content-Type": "application/json" }),
      );
    });
  });

  describe("postForm", () => {
    it("makes POST request with form-encoded body", async () => {
      const mockResponse = mockFetchResponse({ success: true });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await client.postForm("/123", { status: "PAUSED" });

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[1]?.method).toBe("POST");
      expect(call[1]?.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      );
      expect(call[1]?.body).toContain("status=PAUSED");
    });
  });

  describe("delete", () => {
    it("makes DELETE request", async () => {
      const mockResponse = mockFetchResponse({ success: true });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await client.delete("/123");

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[1]?.method).toBe("DELETE");
    });
  });

  describe("error handling", () => {
    it.each([
      { code: 100, subcode: undefined, level: "warn", category: "invalid_params" },
      { code: 613, subcode: 1996, level: "fatal", category: "abuse_signal" },
    ] as const)("keeps a token quoted by Meta out of $category logs and MCP errors", async ({ code, subcode, level, category }) => {
      const log = vi.spyOn(logger, level).mockImplementation(() => undefined);
      const providerText = "Bad https://graph.facebook.com/v26.0/me?access_token=SECRET123";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({
        error: {
          message: providerText,
          error_user_title: providerText,
          error_user_msg: providerText,
          type: "OAuthException",
          code,
          ...(subcode === undefined ? {} : { error_subcode: subcode }),
        },
      }, { status: 400 })));

      let thrown: Error | undefined;
      try { await client.get("/me"); } catch (error) { thrown = error as Error; }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown?.message).not.toContain("SECRET123");
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET123");
      expect((log.mock.calls.at(-1)?.[0] as { category?: string }).category).toBe(category);
    });

    it("rejects malformed Graph codes and does not log a token-bearing caller path", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockFetchResponse({
        error: { message: "bad", type: "OAuthException", code: "access_token=SECRET123" },
      }, { status: 400 })).mockResolvedValueOnce(mockFetchResponse({
        error: { message: "bad", type: "OAuthException", code: 100, error_subcode: "access_token=SECRET123" },
      }, { status: 400 })).mockResolvedValueOnce(mockFetchResponse({
        error: { message: "bad", type: "OAuthException", code: 100 },
      }, { status: 400 })));
      for (let i = 0; i < 2; i++) {
        await expect(client.get("/me?access_token=SECRET123")).rejects.toThrow("META_PROVIDER_ERROR_SCHEMA_INVALID");
      }
      await expect(client.get("/me?access_token=SECRET123")).rejects.toThrow("Invalid parameter");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET123");
    });

    it("throws McpError on Meta API auth errors", async () => {
      const mockResponse = mockFetchResponse({
        error: {
          message: "Invalid OAuth 2.0 Access Token",
          type: "OAuthException",
          code: 190,
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await expect(client.get("/me")).rejects.toThrow(
        /Invalid or expired access token/,
      );
    });

    it("throws McpError on invalid parameter errors", async () => {
      const mockResponse = mockFetchResponse({
        error: {
          message: "Invalid parameter",
          type: "GraphMethodException",
          code: 100,
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await expect(client.get("/me")).rejects.toThrow(/Invalid parameter/);
    });

    it("throws on HTTP 400 errors", async () => {
      const mockResponse = mockFetchResponse(
        { error: "Bad request" },
        { status: 400 },
      );
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await expect(client.get("/me")).rejects.toThrow("META_PROVIDER_ERROR_SCHEMA_INVALID");
    });

    it("does not echo non-Graph response bodies or transport errors", async () => {
      const providerText = "Bad https://graph.facebook.com/me?access_token=SECRET123";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockFetchResponse({ detail: providerText }, { status: 502 }))
        .mockRejectedValueOnce(new Error(providerText)));
      const first = (await client.get("/me").catch((error: Error) => error)) as Error;
      const second = (await client.get("/me").catch((error: Error) => error)) as Error;
      expect(first.message).toContain("Meta provider HTTP 502");
      expect(second.message).toContain("META_PROVIDER_TRANSPORT_FAILED");
      expect(first.message + second.message).not.toContain("SECRET123");
    });

    it.each(["access_token=SECRET123", null])("rejects malformed success-body error envelopes", async (embeddedError) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ error: embeddedError })));
      const result = (await client.get("/me").catch((error: Error) => error)) as Error;
      expect(result.message).toContain("META_PROVIDER_ERROR_SCHEMA_INVALID");
      expect(result.message).not.toContain("SECRET123");
    });

    it("throws on missing access token", async () => {
      cleanupTestToken();
      const mockResponse = mockFetchResponse({ data: [] });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await expect(client.get("/me")).rejects.toThrow(
        /No Meta access token available/,
      );
    });
  });

  describe("retry behavior", () => {
    it("retries on server errors when retries are configured", async () => {
      const retryClient = new MetaApiClient({
        maxRetries: 1,
        timeout: 5000,
      });

      const serverErrorResponse = mockFetchResponse(
        {
          error: {
            message: "Server error",
            type: "API_ERROR",
            code: 1,
          },
        },
      );
      const successResponse = mockFetchResponse({ data: [] });

      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(serverErrorResponse)
          .mockResolvedValueOnce(successResponse),
      );

      const result = await retryClient.get("/me");
      expect(result).toEqual({ data: [] });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on rate-limit errors (per Meta's 'stop calling' rule)", async () => {
      const retryClient = new MetaApiClient({
        maxRetries: 3,
        timeout: 5000,
      });

      const rateLimitResponse = mockFetchResponse({
        error: {
          message: "Rate limit hit",
          type: "OAuthException",
          code: 4,
        },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rateLimitResponse));

      await expect(retryClient.get("/me")).rejects.toThrow();
      // Must be called exactly once — no backoff-and-retry inside the same request.
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it("opens a circuit immediately on abuse signal (subcode 1996)", async () => {
      const retryClient = new MetaApiClient({
        maxRetries: 0,
        timeout: 5000,
      });

      const abuseResponse = mockFetchResponse({
        error: {
          message: "Inconsistent request volume detected",
          type: "OAuthException",
          code: 613,
          error_subcode: 1996,
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(abuseResponse));

      await expect(retryClient.get("/act_123/insights")).rejects.toThrow();
      // Subsequent call should short-circuit without hitting fetch.
      await expect(retryClient.get("/act_123/insights")).rejects.toThrow(
        /Circuit open/,
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it("does not open a circuit across different ad accounts on a per-account throttle", async () => {
      const retryClient = new MetaApiClient({
        maxRetries: 0,
        timeout: 5000,
      });

      const bucResponse = mockFetchResponse({
        error: {
          message: "Ads Management throttled",
          type: "OAuthException",
          code: 80004,
        },
      });
      const okResponse = mockFetchResponse({ data: [] });

      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(bucResponse)
          .mockResolvedValueOnce(okResponse),
      );

      await expect(retryClient.get("/act_111/campaigns")).rejects.toThrow();
      // Different account — circuit for act_111 must not block act_222.
      const result = await retryClient.get("/act_222/campaigns");
      expect(result).toEqual({ data: [] });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry POST to account-scoped collection paths on 5xx (idempotency safety)", async () => {
      const retryClient = new MetaApiClient({
        maxRetries: 3,
        timeout: 5000,
      });

      const serverErrorResponse = mockFetchResponse(
        {
          error: {
            message: "Server error",
            type: "API_ERROR",
            code: 1,
          },
        },
      );

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(serverErrorResponse));

      await expect(retryClient.postForm("/act_123/adsets", { name: "x" })).rejects.toThrow();
      // POST to /act_*/adsets is a CREATE — must not retry, even on retryable
      // errors, because Meta has no native idempotency and a successful create
      // followed by a response-side failure would mint a duplicate on retry.
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry POST to a /copies edge on 5xx (duplicate-mint safety)", async () => {
      const retryClient = new MetaApiClient({
        maxRetries: 3,
        timeout: 5000,
      });

      const serverErrorResponse = mockFetchResponse(
        {
          error: {
            message: "Server error",
            type: "API_ERROR",
            code: 1,
          },
        },
      );

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(serverErrorResponse));

      // POST /<ad_id>/copies duplicates an ad — a non-act_ path that still
      // CREATES a resource. A retry after a server-side success would mint a
      // duplicate ad, so it must not be retried.
      await expect(
        retryClient.postForm("/1234567890/copies", { adset_id: "999" }),
      ).rejects.toThrow();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it.each([
      "/111/message_templates",
      "/111/flows",
      "/333/message_qrdls",
      "/333/request_code",
    ])("does NOT retry POST to WhatsApp creating edge %s on 5xx", async (path) => {
      const retryClient = new MetaApiClient({
        maxRetries: 3,
        timeout: 5000,
      });

      const serverErrorResponse = mockFetchResponse({
        error: { message: "Server error", type: "API_ERROR", code: 1 },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(serverErrorResponse));

      // WhatsApp creating edges live on plain-numeric WABA/phone paths. A retry
      // after a server-side success would mint a duplicate flow/QR/template or a
      // second real SMS, so they must not be transport-retried.
      await expect(retryClient.post(path, { name: "x" })).rejects.toThrow();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it("uses caller-provided account scope for /copies write pacing", async () => {
      const scopedClient = new MetaApiClient({
        maxRetries: 0,
        timeout: 5000,
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ copied_ad_id: "999" })));

      await scopedClient.postForm(
        "/1234567890/copies",
        { adset_id: "999" },
        { accountId: "act_123" },
      );

      const keys = scopedClient.getUsageSnapshot().writePacer.map((bucket) => bucket.key);
      expect(keys.some((key) => key.endsWith(":act_123"))).toBe(true);
      expect(keys.some((key) => key.endsWith(":1234567890"))).toBe(false);
    });

    it("still retries POST to non-account-scoped paths (updates are idempotent)", async () => {
      const retryClient = new MetaApiClient({
        maxRetries: 1,
        timeout: 5000,
      });

      const serverErrorResponse = mockFetchResponse(
        {
          error: {
            message: "Server error",
            type: "API_ERROR",
            code: 1,
          },
        },
      );
      const successResponse = mockFetchResponse({ success: true });

      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(serverErrorResponse)
          .mockResolvedValueOnce(successResponse),
      );

      // POST /<adset_id> is an UPDATE — idempotent, safe to retry.
      const result = await retryClient.postForm("/1234567890", { name: "x" });
      expect(result).toEqual({ success: true });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });

    it("does not retry auth errors", async () => {
      const retryClient = new MetaApiClient({
        maxRetries: 2,
        timeout: 5000,
      });

      const authErrorResponse = mockFetchResponse({
        error: {
          message: "Invalid token",
          type: "OAuthException",
          code: 190,
        },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authErrorResponse));

      await expect(retryClient.get("/me")).rejects.toThrow();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPaginated", () => {
    it("returns empty array when data is missing", async () => {
      const mockResponse = mockFetchResponse({});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      const result = await client.getPaginated("/act_123/campaigns");
      expect(result).toEqual([]);
    });

    it("returns data from single page", async () => {
      const mockResponse = mockFetchResponse({
        data: [{ id: "1" }, { id: "2" }],
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      const result = await client.getPaginated<{ id: string }>(
        "/act_123/campaigns",
      );
      expect(result).toEqual([{ id: "1" }, { id: "2" }]);
    });
  });

  // Meta documents the proof as HMAC-SHA256 of the access token, keyed with the
  // app secret, hex encoded. All values below are synthetic.
  describe("appsecret_proof", () => {
    const APP_SECRET = "synthetic-app-secret-not-real";
    const TOKEN = "synthetic-access-token-not-real";
    const proofOf = (token: string, secret = APP_SECRET) => createHmac("sha256", secret).update(token).digest("hex");

    const sentUrl = (call = 0) => new URL(String(vi.mocked(fetch).mock.calls[call][0]));
    const sentBody = (call = 0) => vi.mocked(fetch).mock.calls[call][1]?.body;

    beforeEach(() => {
      setupTestToken(TOKEN);
      vi.stubEnv("META_APP_SECRET", APP_SECRET);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({ data: [] })));
    });

    it("matches the published HMAC-SHA256 test vector", async () => {
      setupTestToken("The quick brown fox jumps over the lazy dog");
      vi.stubEnv("META_APP_SECRET", "key");
      await client.get("/me/adaccounts");
      expect(sentUrl().searchParams.get("appsecret_proof")).toBe(
        "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
      );
    });

    it("is sent on GET with the token it was computed from", async () => {
      await client.get("/me/adaccounts", { fields: "id" });
      const url = sentUrl();
      expect(url.searchParams.get("access_token")).toBe(TOKEN);
      expect(url.searchParams.get("appsecret_proof")).toBe(proofOf(TOKEN));
      expect(url.searchParams.get("fields")).toBe("id");
    });

    it.each([
      ["post", (c: MetaApiClient) => c.post("/123", { name: "x" })],
      ["postForm", (c: MetaApiClient) => c.postForm("/123", { name: "x" })],
      ["delete", (c: MetaApiClient) => c.delete("/123")],
    ])("is sent on %s", async (_name, call) => {
      await call(client);
      expect(sentUrl().searchParams.get("appsecret_proof")).toBe(proofOf(TOKEN));
      expect(sentUrl().searchParams.get("access_token")).toBe(TOKEN);
    });

    it("is sent on every page of a paginated read", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(mockFetchResponse({ data: [{ id: "1" }], paging: { cursors: { after: "c1" }, next: "n" } }))
          .mockResolvedValueOnce(mockFetchResponse({ data: [{ id: "2" }] })),
      );
      await client.getPaginated("/act_1/campaigns");
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      for (const call of [0, 1]) expect(sentUrl(call).searchParams.get("appsecret_proof")).toBe(proofOf(TOKEN));
      expect(sentUrl(1).searchParams.get("after")).toBe("c1");
    });

    it("rides in the form body of a multipart upload, next to the token, and not in the url", async () => {
      const form = new FormData();
      form.set("name", "clip");
      await client.postMultipart("/act_1/advideos", form);

      const body = sentBody() as FormData;
      expect(body.get("access_token")).toBe(TOKEN);
      expect(body.get("appsecret_proof")).toBe(proofOf(TOKEN));
      expect(sentUrl().search).toBe("");
    });

    it("is recomputed for the token each call uses", async () => {
      await client.get("/me");
      setupTestToken("another-synthetic-token-not-real");
      tokenManager.resetForTests();
      await client.get("/me");
      expect(sentUrl(0).searchParams.get("appsecret_proof")).toBe(proofOf(TOKEN));
      expect(sentUrl(1).searchParams.get("appsecret_proof")).toBe(proofOf("another-synthetic-token-not-real"));
      expect(sentUrl(0).searchParams.get("appsecret_proof")).not.toBe(sentUrl(1).searchParams.get("appsecret_proof"));
    });

    it("stays on a retry", async () => {
      const retrying = new MetaApiClient({ apiVersion: "v26.0", baseUrl: "https://graph.facebook.com", maxRetries: 1 });
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(mockFetchResponse({ error: { message: "x", type: "OAuthException", code: 2 } }, { status: 500 }))
          .mockResolvedValueOnce(mockFetchResponse({ data: [] })),
      );
      vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0 as never; }) as never);
      await retrying.get("/me");
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      for (const call of [0, 1]) expect(sentUrl(call).searchParams.get("appsecret_proof")).toBe(proofOf(TOKEN));
    });

    it("is not sent when no app secret is configured", async () => {
      vi.stubEnv("META_APP_SECRET", "");
      await client.get("/me");
      expect(sentUrl().searchParams.has("appsecret_proof")).toBe(false);
      expect(sentUrl().searchParams.get("access_token")).toBe(TOKEN);

      const form = new FormData();
      await client.postMultipart("/act_1/advideos", form);
      expect((sentBody(1) as FormData).has("appsecret_proof")).toBe(false);
    });

    it("can be switched off for tokens that belong to another app", async () => {
      vi.stubEnv("META_APPSECRET_PROOF", "off");
      await client.get("/me");
      expect(sentUrl().searchParams.has("appsecret_proof")).toBe(false);
    });

    it("prefers a secret handed to the client over the environment", async () => {
      const configured = new MetaApiClient({ apiVersion: "v26.0", maxRetries: 0, appSecret: "configured-secret-not-real" });
      await configured.get("/me");
      expect(sentUrl().searchParams.get("appsecret_proof")).toBe(proofOf(TOKEN, "configured-secret-not-real"));
    });

    describe("never reaches an error or a log line", () => {
      const levels = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

      function captureLogs() {
        const calls: unknown[][] = [];
        for (const level of levels) {
          vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { calls.push(args); }) as never);
        }
        return calls;
      }

      function expectNoSecretsIn(text: string) {
        expect(text).not.toContain(APP_SECRET);
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain(proofOf(TOKEN));
      }

      it("when Meta answers with an error that quotes the request", async () => {
        const logs = captureLogs();
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(
            mockFetchResponse(
              { error: { message: `bad call /me?access_token=${TOKEN}&appsecret_proof=${proofOf(TOKEN)} secret ${APP_SECRET}`, type: "OAuthException", code: 190 } },
              { status: 400 },
            ),
          ),
        );
        const error = await client.get("/me").catch((e: unknown) => e as Error);
        expect(error).toBeInstanceOf(Error);
        expectNoSecretsIn(String((error as Error).message) + JSON.stringify(error));
        expectNoSecretsIn(JSON.stringify(logs));
      });

      it("when the transport fails and the underlying error names the url", async () => {
        const logs = captureLogs();
        vi.stubGlobal(
          "fetch",
          vi.fn().mockRejectedValue(
            Object.assign(new TypeError("fetch failed"), {
              cause: new Error(`connect ECONNRESET https://graph.facebook.com/v26.0/me?access_token=${TOKEN}&appsecret_proof=${proofOf(TOKEN)}`),
            }),
          ),
        );
        const error = await client.get("/me").catch((e: unknown) => e as Error);
        expect(error).toBeInstanceOf(Error);
        expectNoSecretsIn(String((error as Error).message) + String((error as Error).stack ?? "") + JSON.stringify(error));
        expectNoSecretsIn(JSON.stringify(logs, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack, cause: String((v as { cause?: unknown }).cause) } : v)));
      });

      it("when the request times out, and when the body is not JSON", async () => {
        const logs = captureLogs();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error(`aborted ${TOKEN}`), { name: "AbortError" })));
        const timeout = await client.get("/me").catch((e: unknown) => e as Error);
        expectNoSecretsIn(String((timeout as Error).message));

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError(`Unexpected token in ${TOKEN}`); } } as unknown as Response));
        const malformed = await client.get("/me").catch((e: unknown) => e as Error);
        expectNoSecretsIn(String((malformed as Error).message));
        expectNoSecretsIn(JSON.stringify(logs, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v)));
      });

      it("on the multipart path too", async () => {
        const logs = captureLogs();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`multipart failed ${TOKEN} ${proofOf(TOKEN)}`)));
        const error = await client.postMultipart("/act_1/advideos", new FormData()).catch((e: unknown) => e as Error);
        expect(error).toBeInstanceOf(Error);
        expectNoSecretsIn(String((error as Error).message));
        expectNoSecretsIn(JSON.stringify(logs, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v)));
      });
    });
  });
});
