import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type https from "node:https";
import type { LookupFunction } from "node:net";
import {
  parseSafePublicUrl,
  resolveSafePublicUrl,
  UnsafeUrlError,
  type AssertSafeUrlOptions,
  type ResolvedSafePublicUrl,
} from "./url-guard.js";

export type HttpsRequestFn = typeof https.request;

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Pins the socket to the address that passed the SSRF check, so a hostname
 * that re-resolves to a private address between validation and connect
 * (DNS rebinding) cannot redirect the request.
 */
export function buildPinnedLookup(resolved: ResolvedSafePublicUrl): LookupFunction {
  const primary = resolved.addresses[0];
  if (!primary) {
    throw new UnsafeUrlError(`Hostname ${resolved.url.hostname} did not resolve to any address`);
  }

  type LookupOneCallback = (err: Error | null, address: string, family: number) => void;
  type LookupAllCallback = (
    err: Error | null,
    addresses: Array<{ address: string; family: 4 | 6 }>,
  ) => void;

  return ((hostname: string, options: unknown, callback?: unknown) => {
    const cb = typeof options === "function" ? options : callback;
    if (!cb) return;
    const wantsAll =
      typeof options === "object" && options !== null && "all" in options && options.all === true;
    if (normalizeHostname(hostname) !== normalizeHostname(resolved.url.hostname)) {
      (cb as LookupOneCallback)(new Error(`Unexpected lookup hostname ${hostname}`), "", 0);
      return;
    }
    if (wantsAll) {
      (cb as LookupAllCallback)(null, resolved.addresses);
      return;
    }
    (cb as LookupOneCallback)(null, primary.address, primary.family);
  }) as LookupFunction;
}

export function isRedirect(statusCode: number | undefined): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

/** Media type only (no parameters), lowercased; null when the header is absent. */
export function parseContentType(headers: IncomingHttpHeaders): string | null {
  const raw = headers["content-type"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return value.split(";")[0].trim().toLowerCase();
}

export function parseContentLength(headers: IncomingHttpHeaders): number | null {
  const raw = headers["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function redirectTarget(res: IncomingMessage, base: URL): URL {
  const location = res.headers.location;
  if (!location) {
    throw new UnsafeUrlError(`Redirect from ${base.hostname} did not include Location`);
  }
  try {
    return new URL(Array.isArray(location) ? location[0] : location, base);
  } catch {
    throw new UnsafeUrlError("Redirect Location is malformed");
  }
}

export type RedirectOrResult<T> = T | { redirectUrl: URL };

/**
 * Host allowlist. An entry with a leading dot (".fbcdn.net") matches that
 * domain and any subdomain of it, and nothing that merely ends in the same
 * letters ("evilfbcdn.net"). An entry without one ("cdn.example.com") is an
 * exact host and never a suffix. Applied to the first hop and to every
 * redirect so a permitted host cannot bounce the request elsewhere.
 */
export function assertAllowedHost(url: URL, suffixes: string[], what = "media"): void {
  const host = url.hostname.toLowerCase();
  const allowed = suffixes.some((entry) => {
    const allowedHost = entry.toLowerCase();
    if (allowedHost === "" || allowedHost === ".") return false;
    return allowedHost.startsWith(".")
      ? host.endsWith(allowedHost) || host === allowedHost.slice(1)
      : host === allowedHost;
  });
  if (!allowed) {
    throw new UnsafeUrlError("Host " + JSON.stringify(host) + " is not an allowed " + what + " host");
  }
}

/** Why a signal fired: the deadline's own error when it was one, otherwise a plain abort. */
export function abortError(signal: AbortSignal | undefined, what: string): UnsafeUrlError {
  const reason: unknown = signal?.reason;
  return reason instanceof UnsafeUrlError ? reason : new UnsafeUrlError(`${what} download aborted`);
}

/**
 * DNS lookups have no cancellation hook, so the wait itself is made abortable.
 * The operation is started lazily: with an already-aborted signal it never
 * runs, and once it has started its eventual settlement is always observed so
 * a late failure cannot surface as an unhandled rejection.
 */
function abortable<T>(start: () => Promise<T>, signal: AbortSignal | undefined, what: string): Promise<T> {
  if (!signal) return start();
  if (signal.aborted) return Promise.reject(abortError(signal, what));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal, what));
    signal.addEventListener("abort", onAbort, { once: true });
    start().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function isRedirectResult<T extends object>(
  result: RedirectOrResult<T>,
): result is { redirectUrl: URL } {
  return "redirectUrl" in result;
}

export interface FollowSafeRedirectsOptions extends AssertSafeUrlOptions {
  maxRedirects: number;
  signal?: AbortSignal;
  /**
   * Wall-clock budget for the whole operation: every DNS lookup, connection,
   * redirect and body byte. The per-request idle timeout cannot provide this,
   * because a peer that sends one byte at a time restarts it forever.
   */
  deadlineMs?: number;
  /** Extra per-hop policy (e.g. a host allowlist); throw to reject the hop. Runs before any DNS lookup for the hop. */
  validateHop?: (url: URL) => void;
  what?: string;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Runs `perform` against a URL that passed the SSRF check, re-validating every
 * redirect hop through the same guard before following it. For every hop the
 * order is: URL shape and address-literal checks, then the host policy, and
 * only then a DNS lookup, so a host the policy refuses is never resolved.
 */
export async function followSafeRedirects<T extends object>(
  rawUrl: string,
  options: FollowSafeRedirectsOptions,
  perform: (resolved: ResolvedSafePublicUrl, signal: AbortSignal | undefined) => Promise<RedirectOrResult<T>>,
): Promise<T> {
  const what = options.what ?? "resource";
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  let timer: NodeJS.Timeout | undefined;
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  if (options.deadlineMs !== undefined) {
    const ms = options.deadlineMs;
    timer = setTimeout(() => {
      controller.abort(new UnsafeUrlError(`${capitalized(what)} download timed out after ${ms}ms`));
    }, ms);
    timer.unref?.();
  }
  const signal = controller.signal;

  const resolveHop = async (candidate: string | URL): Promise<ResolvedSafePublicUrl> => {
    const url = parseSafePublicUrl(candidate, { allowedPorts: options.allowedPorts });
    options.validateHop?.(url);
    return abortable(
      () => resolveSafePublicUrl(url, { resolve: options.resolve, allowedPorts: options.allowedPorts }),
      signal,
      capitalized(what),
    );
  };

  try {
    let resolved = await resolveHop(rawUrl);
    for (let redirects = 0; redirects <= options.maxRedirects; redirects++) {
      const result = await perform(resolved, signal);
      if (!isRedirectResult(result)) {
        return result;
      }
      if (redirects === options.maxRedirects) {
        throw new UnsafeUrlError(`Too many redirects while downloading ${what} (max ${options.maxRedirects})`);
      }
      resolved = await resolveHop(result.redirectUrl);
    }
    throw new UnsafeUrlError(`Too many redirects while downloading ${what} (max ${options.maxRedirects})`);
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
