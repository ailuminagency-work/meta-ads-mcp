import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { getAccessToken, hashToken } from "../auth/token-store.js";
import { logger } from "../utils/logger.js";
import { RateLimiter, type RequestContext } from "./rate-limiter.js";
import { CircuitBreaker, type CircuitContext } from "./circuit-breaker.js";
import { WritePacer } from "./write-pacer.js";
import {
  classifyMetaError,
  isMetaApiError,
  type MetaErrorClassification,
} from "./errors.js";
import type { MetaApiResponse } from "./types/common.js";
import { collectAllPages } from "./paginator.js";
import { assertMetaApiVersion, resolveMetaApiVersion } from "./api-version.js";
import { platformEnabled } from "../platform/runtime.js";
import { assertLegacyReadEgress, projectLegacyReadResponse } from "../platform/legacy-egress.js";
import { PlatformDenied } from "../platform/models.js";
import { BodyTooLargeError, readBodyWithLimit } from "../utils/bounded-body.js";
import { assertExecutionPermit, withConnectionCredential } from "../platform/execution.js";

const DEFAULT_BASE_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;
const USAGE_LOG_INTERVAL_MS = 60_000;
const VERSION_WARNING_LOG_INTERVAL_MS = 60 * 60_000;

export interface MetaApiClientConfig {
  apiVersion?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

interface RequestScope {
  accountId?: string;
}

/**
 * Typed client for the Meta Graph API.
 *
 * Compliance guarantees (see src/meta/errors.ts and rate-limiter.ts for
 * references to Meta's docs):
 *  - Bucketed rate-limiting per (token, ad-account, use-case type) — one hot
 *    account does not slow down the rest of the agency.
 *  - Circuit breaker halts requests to a bucket on abuse signals
 *    (subcode 1996), temporary user/business blocks, or repeated throttle.
 *  - Platform/BUC rate-limit errors (4, 17, 32, 613, 80000-80014) are NEVER
 *    retried inside the same request — Meta's docs explicitly warn that
 *    continuing to call after a throttle extends `estimated_time_to_regain_access`.
 *  - Write operations (POST/DELETE) are paced by a preventive token bucket
 *    sized to the Ads Management hourly quota.
 *  - Every response's rate-limit headers update per-bucket state for future
 *    self-throttling decisions.
 */
export class MetaApiClient {
  readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly rateLimiter = new RateLimiter();
  private readonly circuitBreaker = new CircuitBreaker();
  private readonly writePacer = new WritePacer();
  private lastUsageLogAt = 0;
  private lastVersionWarningAt = 0;

  constructor(config?: MetaApiClientConfig) {
    this.apiVersion = assertMetaApiVersion(config?.apiVersion ?? resolveMetaApiVersion());
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config?.maxRetries ?? MAX_RETRIES;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.execute<T>("GET", url, path);
  }

  /**
   * Read the lead forms for one Page with the Page Access Token issued for
   * that exact Page. Meta rejects this edge when the user token is sent
   * directly (error 190 / "must be called with a Page Access Token").
   *
   * The token is resolved and used only in memory. It is never returned,
   * logged, or placed in a response. The strict platform path has its own
   * page-token proof and must not be bypassed by this legacy helper.
   */
  async getPageLeadForms<T>(
    pageId: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    if (platformEnabled()) {
      throw new PlatformDenied("PAGE_TOKEN_CERTIFICATION_REQUIRED");
    }
    if (!/^\d{1,32}$/.test(pageId)) {
      throw new PlatformDenied("PAGE_TOKEN_PAGE_ID_INVALID");
    }

    const userToken = getAccessToken();
    const accounts = await this.getWithBearerToken<{
      data?: Array<{ id?: string; access_token?: string; tasks?: string[] }>;
    }>(
      "/me/accounts",
      { fields: "id,access_token,tasks", limit: 100 },
      userToken,
    );
    const matches = (accounts.data ?? []).filter((row) => row.id === pageId);
    if (
      matches.length !== 1 ||
      typeof matches[0].access_token !== "string" ||
      !matches[0].access_token ||
      !Array.isArray(matches[0].tasks) ||
      new Set(matches[0].tasks).size !== matches[0].tasks.length
    ) {
      throw new PlatformDenied("META_PAGE_ACCESS_TOKEN_UNAVAILABLE");
    }

    const pageToken = matches[0].access_token;
    const identity = await this.getWithBearerToken<{ id?: string }>(
      `/${pageId}`,
      { fields: "id" },
      pageToken,
    );
    if (identity.id !== pageId) {
      throw new PlatformDenied("META_PAGE_TOKEN_IDENTITY_MISMATCH");
    }

    return this.getWithBearerToken<T>(
      `/${pageId}/leadgen_forms`,
      params,
      pageToken,
    );
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = this.buildUrl(path);
    return this.execute<T>("POST", url, path, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async postForm<T>(
    path: string,
    params: Record<string, string | number | boolean>,
    scope?: RequestScope,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const formBody = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      formBody.set(key, String(value));
    }
    return this.execute<T>("POST", url, path, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    }, false, scope);
  }

  async postMultipart<T>(
    path: string,
    formData: FormData,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const token = platformEnabled()
      ? await withConnectionCredential(assertExecutionPermit({provider:"META_MARKETING"}),async selected=>selected)
      : getAccessToken();
    formData.set("access_token", token);
    return this.execute<T>("POST", url, path, { body: formData }, true);
  }

  async delete<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.execute<T>("DELETE", url, path);
  }

  async getPaginated<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    maxItems = 1000,
  ): Promise<T[]> {
    const firstPage = await this.get<MetaApiResponse<T>>(path, params);
    if (!firstPage.data) return [];
    return collectAllPages<T>(
      firstPage,
      async (after) =>
        this.get<MetaApiResponse<T>>(path, { ...params, after }),
      maxItems,
    );
  }

  /**
   * Public snapshot for the `ads_rate_status` tool.
   */
  getUsageSnapshot() {
    return {
      usage: this.rateLimiter.snapshot(),
      circuits: this.circuitBreaker.snapshot(),
      writePacer: this.writePacer.snapshot(),
    };
  }

  resetForTests(): void {
    this.rateLimiter.reset();
    this.circuitBreaker.reset();
    this.writePacer.reset();
    this.lastUsageLogAt = 0;
    this.lastVersionWarningAt = 0;
  }

  // ─── Internal ────────────────────────────────────────────────

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const base = `${this.baseUrl}/${this.apiVersion}${path.startsWith("/") ? path : `/${path}`}`;
    const url = new URL(base);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async execute<T>(
    method: string,
    url: string,
    path: string,
    options?: RequestInit,
    skipTokenParam = false,
    scope?: RequestScope,
    tokenOverride?: string,
  ): Promise<T> {
    await assertLegacyReadEgress(method,path,url);
    if (platformEnabled() && tokenOverride !== undefined) {
      throw new PlatformDenied("STRICT_PAGE_TOKEN_OVERRIDE_DENIED");
    }
    const token = tokenOverride ?? (platformEnabled()
      ? await withConnectionCredential(assertExecutionPermit({provider:"META_MARKETING"}),async selected=>selected)
      : getAccessToken());
    const tokenHash = hashToken(token);
    const accountId = scope?.accountId ?? extractAccountId(path);
    const context: RequestContext = { tokenHash, accountId };
    const circuitContext: CircuitContext = {
      tokenHash,
      accountId,
      type: guessBucType(method, path),
    };

    // Circuit breaker is the hard stop: if open, never call Meta.
    this.circuitBreaker.assertClosed(circuitContext);

    // Preventive write pacing for POST / DELETE on account-scoped paths.
    const isWrite =
      (method === "POST" || method === "DELETE") &&
      accountId !== undefined;
    if (isWrite) {
      await this.writePacer.acquire(tokenHash, accountId);
    }

    // Reactive self-throttle based on last-known usage headers.
    await this.rateLimiter.waitIfNeeded(context);

    const reqUrl = platformEnabled() || skipTokenParam ? url : this.appendToken(url, token);

    // POST to /act_<id>/<collection> creates new resources without native
    // idempotency on Meta's side — retrying a timeout/5xx/network error can
    // mint duplicates (e.g. two ad sets for one user intent). The /<id>/copies
    // edge (ad/ad set/campaign duplication) creates a resource on a non-act_
    // path, so it must be classed as creating too — otherwise a retried copy
    // mints a duplicate ad. The WhatsApp creating edges live on plain-numeric
    // WABA/phone paths: /message_templates, /flows, /message_qrdls create
    // resources, and /request_code sends a real SMS/voice call — all mint
    // duplicates on retry. Other POSTs (updates on /<id>) and DELETEs are
    // idempotent at the API level.
    const isCreatingRequest =
      method === "POST" &&
      (/^\/?act_[A-Za-z0-9]+\//.test(path) ||
        /\/copies$/.test(path) ||
        /\/(message_templates|flows|message_qrdls|request_code)$/.test(path));
    const canRetryTransport = !isCreatingRequest;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await assertLegacyReadEgress(method,path,url);
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.timeout,
        );

        const performFetch = async (selectedToken:string):Promise<Response> => {
          if(platformEnabled()) {

            if(selectedToken!==token)throw new PlatformDenied("STRICT_CONNECTION_CREDENTIAL_CHANGED");
            await assertLegacyReadEgress(method,path,url);
          }
          return fetch(reqUrl, {
          method,
          ...options,
          ...(platformEnabled() ? {redirect:"error" as const,headers:{...Object.fromEntries(new Headers(options?.headers).entries()),Authorization:`Bearer ${selectedToken}`}} : {}),
          signal: controller.signal,
          });
        };
        let response:Response;
        try { response=platformEnabled()
          ? await withConnectionCredential(assertExecutionPermit({provider:"META_MARKETING"}),performFetch)
          : await performFetch(token);
        } catch(error){clearTimeout(timeoutId);throw error;}

        if(!platformEnabled()) clearTimeout(timeoutId);

        // Update rate-limiter + pacer from response headers — regardless of
        // whether the response was OK. Throttle signals travel on error
        // responses too.
        this.rateLimiter.updateFromHeaders(response.headers, context);
        this.maybeUpdatePacerTierFromHeaders(response.headers, tokenHash, accountId);
        this.maybeLogUsage();
        this.maybeLogVersionWarning(response.headers);

        let body:unknown;
        try { body=platformEnabled()?JSON.parse(await readBodyWithLimit(response,2_000_000)):await response.json(); }
        finally { clearTimeout(timeoutId); }

        if (isMetaApiError(body)) {
          if(platformEnabled()) {
            if(!body.error || !Number.isSafeInteger(body.error.code))throw new PlatformDenied("LEGACY_PROVIDER_ERROR_SCHEMA_INVALID");
            body.error.message="Strict provider request failed; inspect safe code and request identifiers.";
            delete body.error.error_user_title;delete body.error.error_user_msg;
            if(typeof body.error.fbtrace_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.error.fbtrace_id) || /^EAA[A-Za-z0-9]{20,}$/.test(body.error.fbtrace_id))delete body.error.fbtrace_id;
            if(typeof body.error.error_subcode !== "number" || !Number.isFinite(body.error.error_subcode))delete body.error.error_subcode;
          }
          const classification = classifyMetaError(body.error);
          this.logMetaError(body.error, classification, context, path);

          if (classification.throttled) {
            // Seed the rate-limiter with the retry-after hint so sibling
            // requests back off even before the next header arrives.
            if (classification.retryAfterMs) {
              this.rateLimiter.markRetryAfter(
                context,
                circuitContext.type ?? "unknown",
                classification.retryAfterMs,
              );
            }
            this.circuitBreaker.trip(circuitContext, classification);
            // Meta's doc: "If you reach the limit, stop making API calls."
            throw classification.mcpError;
          }

          if (classification.retryable && canRetryTransport && attempt < this.maxRetries) {
            lastError = classification.mcpError;
            await this.backoff(attempt);
            continue;
          }

          throw classification.mcpError;
        }

        if (!response.ok) {
          lastError = new Error(
            platformEnabled()?`Strict provider HTTP ${response.status}`:`HTTP ${response.status}: ${JSON.stringify(body)}`,
          );
          if (response.status >= 500 && canRetryTransport && attempt < this.maxRetries) {
            await this.backoff(attempt);
            continue;
          }
          throw lastError;
        }

        return projectLegacyReadResponse(path,url,body) as T;
      } catch (error) {
        if(error instanceof PlatformDenied)throw error;
        if(platformEnabled()&&(error instanceof BodyTooLargeError||error instanceof SyntaxError))throw new PlatformDenied("LEGACY_PROVIDER_RESPONSE_INVALID_OR_TOO_LARGE");
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(`Request timeout after ${this.timeout}ms`);
          if (canRetryTransport && attempt < this.maxRetries) {
            await this.backoff(attempt);
            continue;
          }
          throw lastError;
        }

        // Already-classified errors bubble up unchanged.
        if (error instanceof Error && "code" in error && (!platformEnabled() || error instanceof McpError)) {
          throw error;
        }

        lastError = platformEnabled() ? new Error("STRICT_PROVIDER_TRANSPORT_FAILED") : error instanceof Error ? error : new Error(String(error));
        if (canRetryTransport && attempt < this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw lastError;
      }
    }

    logger.error({ error: lastError, path }, "All retries exhausted");
    throw lastError ?? new Error("Request failed after retries");
  }

  private async getWithBearerToken<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> | undefined,
    token: string,
  ): Promise<T> {
    if (!token || /[\s\x00-\x1f\x7f]/.test(token)) {
      throw new PlatformDenied("META_PAGE_TOKEN_INVALID");
    }
    const url = this.buildUrl(path, params);
    return this.execute<T>("GET", url, path, undefined, false, undefined, token);
  }

  private appendToken(url: string, token: string): string {
    const u = new URL(url);
    u.searchParams.set("access_token", token);
    return u.toString();
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
    const jitter = delay * (Math.random() * 0.4 - 0.2); // ±20%
    await new Promise((resolve) => setTimeout(resolve, delay + jitter));
  }

  private maybeUpdatePacerTierFromHeaders(
    headers: Headers,
    tokenHash: string,
    accountId: string | undefined,
  ): void {
    if (!accountId) return;
    const throttle = headers.get("x-fb-ads-insights-throttle");
    if (throttle) {
      try {
        const parsed = JSON.parse(throttle) as { ads_api_access_tier?: string };
        if (parsed.ads_api_access_tier) {
          this.writePacer.updateTier(tokenHash, accountId, parsed.ads_api_access_tier);
        }
      } catch {
        /* ignore */
      }
    }
    const acc = headers.get("x-ad-account-usage");
    if (acc) {
      try {
        const parsed = JSON.parse(acc) as { ads_api_access_tier?: string };
        if (parsed.ads_api_access_tier) {
          this.writePacer.updateTier(tokenHash, accountId, parsed.ads_api_access_tier);
        }
      } catch {
        /* ignore */
      }
    }
  }

  private logMetaError(
    error: { code: number; error_subcode?: number; message: string; fbtrace_id?: string },
    classification: MetaErrorClassification,
    context: RequestContext,
    path: string,
  ): void {
    const payload = {
      event: "meta_error",
      path,
      meta_error_code: error.code,
      meta_subcode: error.error_subcode,
      fbtrace_id: error.fbtrace_id,
      category: classification.category,
      throttled: classification.throttled,
      retryAfterMs: classification.retryAfterMs,
      tokenHash: context.tokenHash,
      accountId: context.accountId,
    };
    if (classification.critical) {
      logger.fatal(payload, error.message);
    } else if (
      classification.category === "invalid_params" ||
      classification.category === "duplicate"
    ) {
      // 4xx user-side — count as user_errors signal (Insights formula subtracts
      // 0.001 × user_errors from hourly quota).
      logger.warn({ ...payload, event: "meta_user_error" }, error.message);
    } else {
      logger.error(payload, error.message);
    }
  }

  // Meta answers calls on a retired Marketing API version by upgrading the
  // endpoints that did not change and rejecting the ones that did. The header
  // only arrives once the version is gone, so it means the pin is already
  // overdue rather than about to be.
  private maybeLogVersionWarning(headers: Headers): void {
    const warning = headers.get("x-ad-api-version-warning");
    if (!warning) return;
    const now = Date.now();
    if (now - this.lastVersionWarningAt < VERSION_WARNING_LOG_INTERVAL_MS) return;
    this.lastVersionWarningAt = now;
    logger.warn(
      { event: "meta_api_version_auto_upgraded", apiVersion: this.apiVersion },
      platformEnabled()
        ? "Meta reported an API version warning; review the configured supported version."
        : `Meta auto-upgraded a call because ${this.apiVersion} is deprecated: bump DEFAULT_META_API_VERSION in src/meta/api-version.ts. Meta said: ${warning}`,
    );
  }

  private maybeLogUsage(): void {
    const now = Date.now();
    if (now - this.lastUsageLogAt < USAGE_LOG_INTERVAL_MS) return;
    this.lastUsageLogAt = now;
    const snapshot = this.rateLimiter.snapshot();
    if (snapshot.length === 0) return;
    const rawTier = snapshot.find((b) => b.adsApiAccessTier)?.adsApiAccessTier;
    const tier = platformEnabled() && !["development_access","standard_access","advanced_access"].includes(rawTier ?? "") ? undefined : rawTier;
    logger.info(
      {
        event: "meta_rate_usage",
        buckets: snapshot.length,
        maxCallPct: snapshot.reduce((m, b) => Math.max(m, b.callCount), 0),
        adsApiAccessTier: tier,
      },
      "Meta API usage snapshot",
    );
    if (tier === "development_access") {
      logger.warn(
        { event: "meta_access_tier" },
        "Running on development_access tier — apply for Advanced Access to raise the Ads Management / Insights quota",
      );
    }
  }
}

/**
 * Extract the first id-like segment after the API version. For account-scoped
 * paths like `/act_123/insights` or `/act_123/campaigns`, returns `act_123`.
 * For `/<object_id>/insights` etc., returns `<object_id>`.
 */
function extractAccountId(path: string): string | undefined {
  const stripped = path.startsWith("/") ? path.slice(1) : path;
  const [first] = stripped.split("/");
  if (!first) return undefined;
  if (/^act_\d+$/i.test(first)) return first;
  if (/^\d+$/.test(first)) return first;
  return undefined;
}

/**
 * Best-effort hint for which BUC pool a request counts against. Used to scope
 * circuit-breaker state — a throttle on Insights should not freeze Audience
 * writes for the same account.
 */
function guessBucType(method: string, path: string): string {
  if (/\/insights(\?|$|\/)/.test(path) || /\/insights$/.test(path)) {
    return "ads_insights";
  }
  if (/\/customaudiences(\?|$|\/)/.test(path) || path.includes("/customaudiences")) {
    return "custom_audience";
  }
  if (method === "POST" || method === "DELETE") {
    return "ads_management";
  }
  return "ads_management";
}

/**
 * Singleton client instance used by all tools.
 */
export const metaApiClient = new MetaApiClient();
