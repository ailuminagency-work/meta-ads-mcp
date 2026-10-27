import { createHmac } from "node:crypto";
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
import { assertExecutionPermit, getExecutionScope, persistProviderReadEligibility, recordProviderReadProof, withConnectionCredential } from "../platform/execution.js";

const DEFAULT_BASE_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;
const USAGE_LOG_INTERVAL_MS = 60_000;
const VERSION_WARNING_LOG_INTERVAL_MS = 60 * 60_000;

class ProviderHttpError extends Error {}

export interface MetaApiClientConfig {
  apiVersion?: string;
  baseUrl?: string;
  /** App secret for appsecret_proof; defaults to META_APP_SECRET, read per request. */
  appSecret?: string;
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
  private readonly appSecret: string | undefined;
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
    this.appSecret = config?.appSecret?.trim() || undefined;
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
    const proof = this.appSecretProof(token);
    if (proof) formData.set("appsecret_proof", proof);
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
  ): Promise<T> {
    await assertLegacyReadEgress(method,path,url);
    const token = platformEnabled()
      ? await withConnectionCredential(assertExecutionPermit({provider:"META_MARKETING"}),async selected=>selected)
      : getAccessToken();
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

    // The proof travels wherever the token does not: in the url for every call
    // but the multipart one, whose body already carries it. Only the url that is
    // fetched gets it; the egress checks above and below read the plain one.
    const proof = skipTokenParam ? undefined : this.appSecretProof(token);
    const reqUrl = this.appendCredentials(url, platformEnabled() || skipTokenParam ? undefined : token, proof);

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

        if (typeof body === "object" && body !== null && Object.hasOwn(body, "error") && !isMetaApiError(body)) {
          if (platformEnabled()) throw new PlatformDenied("LEGACY_PROVIDER_ERROR_SCHEMA_INVALID");
          throw new ProviderHttpError("META_PROVIDER_ERROR_SCHEMA_INVALID");
        }
        if (isMetaApiError(body)) {
          if(platformEnabled()) {
            if(!body.error || !Number.isSafeInteger(body.error.code))throw new PlatformDenied("LEGACY_PROVIDER_ERROR_SCHEMA_INVALID");
            body.error.message="Strict provider request failed; inspect safe code and request identifiers.";
            delete body.error.error_user_title;delete body.error.error_user_msg;
            if(typeof body.error.fbtrace_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.error.fbtrace_id) || /^EAA[A-Za-z0-9]{20,}$/.test(body.error.fbtrace_id))delete body.error.fbtrace_id;
            if(typeof body.error.error_subcode !== "number" || !Number.isFinite(body.error.error_subcode))delete body.error.error_subcode;
          }
          const classification = classifyMetaError(body.error);
          this.logMetaError(body.error, classification, context);

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
          // Non-Graph error bodies are just as untrusted as Graph error text.
          lastError = new ProviderHttpError(`Meta provider HTTP ${response.status}`);
          if (response.status >= 500 && canRetryTransport && attempt < this.maxRetries) {
            await this.backoff(attempt);
            continue;
          }
          throw lastError;
        }

        const projected=projectLegacyReadResponse(path,url,body) as T;
        const requestUrl=new URL(url);
        const scope=platformEnabled()?getExecutionScope():undefined;
        if(scope?.plan.parameters.provider_read_bootstrap===true && path.match(/^\/act_\d{1,32}$/) && requestUrl.searchParams.get("fields")?.split(",").some(field=>field==="business"||field.startsWith("business{"))===true){
          const accountId=path.slice(5),checkedAt=Date.now(),bodyRecord=body as Record<string,unknown>,actualId=typeof bodyRecord.id==="string"?bodyRecord.id.replace(/^act_/ ,""):"",actualAccountId=typeof bodyRecord.account_id==="string"?bodyRecord.account_id.replace(/^act_/ ,""):"",business=bodyRecord.business as Record<string,unknown>|undefined,providerBusinessId=typeof business?.id==="string"?business.id:undefined;
          if(actualId!==accountId||(actualAccountId!==""&&actualAccountId!==accountId))throw new PlatformDenied("PROVIDER_READ_PROOF_ACCOUNT_MISMATCH");
          recordProviderReadProof(accountId,checkedAt,providerBusinessId);
          await persistProviderReadEligibility(accountId,checkedAt);
        }
        return projected;
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
        if (error instanceof McpError || error instanceof ProviderHttpError) {
          throw error;
        }

        lastError = new Error(platformEnabled() ? "STRICT_PROVIDER_TRANSPORT_FAILED" : "META_PROVIDER_TRANSPORT_FAILED");
        if (canRetryTransport && attempt < this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw lastError;
      }
    }

    logger.error({ err: lastError }, "All retries exhausted");
    throw lastError ?? new Error("Request failed after retries");
  }

  private appendCredentials(url: string, token: string | undefined, proof: string | undefined): string {
    if (token === undefined && proof === undefined) return url;
    const u = new URL(url);
    if (token !== undefined) u.searchParams.set("access_token", token);
    if (proof !== undefined) u.searchParams.set("appsecret_proof", proof);
    return u.toString();
  }

  /**
   * HMAC-SHA256 of the access token keyed with the app secret, hex encoded
   * (https://developers.facebook.com/docs/graph-api/guides/secure-requests).
   * Neither the secret nor the proof is ever logged or put in an error.
   * META_APPSECRET_PROOF=off disables it for a deployment whose tokens come
   * from an app other than the one META_APP_SECRET belongs to, where Meta
   * would reject every call as carrying an invalid proof.
   */
  private appSecretProof(token: string): string | undefined {
    return metaAppSecretProof(token, this.appSecret);
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
    error: { code: number; error_subcode?: number },
    classification: MetaErrorClassification,
    context: RequestContext,
  ): void {
    const payload = {
      event: "meta_error",
      meta_error_code: error.code,
      meta_subcode: error.error_subcode,
      category: classification.category,
      throttled: classification.throttled,
      retryAfterMs: classification.retryAfterMs,
      tokenHash: context.tokenHash,
      accountId: context.accountId,
    };
    if (classification.critical) {
      logger.fatal(payload, classification.mcpError.message);
    } else if (
      classification.category === "invalid_params" ||
      classification.category === "duplicate"
    ) {
      // 4xx user-side — count as user_errors signal (Insights formula subtracts
      // 0.001 × user_errors from hourly quota).
      logger.warn({ ...payload, event: "meta_user_error" }, classification.mcpError.message);
    } else {
      logger.error(payload, classification.mcpError.message);
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
      "Meta reported an API version warning; review the configured supported version.",
    );
  }

  private maybeLogUsage(): void {
    const now = Date.now();
    if (now - this.lastUsageLogAt < USAGE_LOG_INTERVAL_MS) return;
    this.lastUsageLogAt = now;
    const snapshot = this.rateLimiter.snapshot();
    if (snapshot.length === 0) return;
    const rawTier = snapshot.find((b) => b.adsApiAccessTier)?.adsApiAccessTier;
    const tier = ["development_access", "standard_access", "advanced_access"].includes(rawTier ?? "") ? rawTier : undefined;
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

export function metaAppSecretProof(token: string, appSecret?: string): string | undefined {
  if (process.env.META_APPSECRET_PROOF?.trim().toLowerCase() === "off") return undefined;
  const secret = appSecret ?? (process.env.META_APP_SECRET?.trim() || undefined);
  if (!secret) return undefined;
  return createHmac("sha256", secret).update(token).digest("hex");
}

/**
 * Singleton client instance used by all tools.
 */
export const metaApiClient = new MetaApiClient();

