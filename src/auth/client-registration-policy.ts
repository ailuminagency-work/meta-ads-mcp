import { isIP } from "node:net";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Dynamic client registration is open to the internet, so the redirect URIs it
 * accepts are the only thing standing between an attacker-registered client and
 * an operator's authorization code. A code is delivered to the redirect URI, so
 * every accepted URI must land on software the operator already trusts: a known
 * client host, the operator's own machine, or a known desktop-app scheme.
 */
export class InvalidRedirectUriError extends OAuthError {
  static errorCode = "invalid_redirect_uri";
}

const DEFAULT_REDIRECT_HOSTS: readonly string[] = ["claude.ai", "chatgpt.com"];
const ALLOWED_CUSTOM_SCHEMES: readonly string[] = ["cursor", "vscode", "vscode-insiders"];
const LOOPBACK_HOSTNAMES: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2048;
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const FORBIDDEN_CHARACTERS = /[\s\x00-\x1f\x7f\\*#]/;

export type RedirectUriVerdict = { ok: true } | { ok: false; reason: string };

let cachedExtraHostsSource: string | undefined;
let cachedExtraHosts: string[] = [];

function extraRedirectHosts(env: NodeJS.ProcessEnv): string[] {
  const source = env.OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS ?? "";
  if (source === cachedExtraHostsSource) return cachedExtraHosts;
  const hosts: string[] = [];
  for (const entry of source.split(",")) {
    const host = entry.trim().toLowerCase();
    if (!host) continue;
    if (!HOSTNAME_PATTERN.test(host) || isIP(host)) {
      logger.warn(
        { entryLength: host.length },
        "Ignoring OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS entry: only exact DNS host names are accepted",
      );
      continue;
    }
    hosts.push(host);
  }
  cachedExtraHostsSource = source;
  cachedExtraHosts = hosts;
  return hosts;
}

export function allowedRedirectHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...DEFAULT_REDIRECT_HOSTS, ...extraRedirectHosts(env)];
}

function rawAuthority(uri: string): string | null {
  const start = uri.indexOf("://");
  if (start < 0) return null;
  const rest = uri.slice(start + 3);
  const end = rest.search(/[/?#]/);
  return end < 0 ? rest : rest.slice(0, end);
}

function rawHost(authority: string): string {
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    return close < 0 ? authority : authority.slice(0, close + 1);
  }
  const colon = authority.indexOf(":");
  return colon < 0 ? authority : authority.slice(0, colon);
}

export function checkRedirectUri(
  uri: unknown,
  env: NodeJS.ProcessEnv = process.env,
): RedirectUriVerdict {
  if (typeof uri !== "string" || uri.length === 0) {
    return { ok: false, reason: "must be a non-empty string" };
  }
  if (uri.length > MAX_REDIRECT_URI_LENGTH) {
    return { ok: false, reason: "is too long" };
  }
  if (FORBIDDEN_CHARACTERS.test(uri)) {
    return { ok: false, reason: "contains a fragment, wildcard, backslash, whitespace or control character" };
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { ok: false, reason: "is not a valid absolute URI" };
  }
  const authority = rawAuthority(uri);
  if (url.username || url.password || (authority !== null && authority.includes("@"))) {
    return { ok: false, reason: "must not contain user information" };
  }

  if (url.protocol === "https:") {
    if (authority === null) return { ok: false, reason: "must have an authority" };
    if (url.port !== "") return { ok: false, reason: "must not use an explicit port" };
    if (rawHost(authority).toLowerCase() !== url.hostname) {
      return { ok: false, reason: "host is not written in canonical form" };
    }
    if (!allowedRedirectHosts(env).includes(url.hostname)) {
      return { ok: false, reason: "host is not an allowed redirect host" };
    }
    return { ok: true };
  }

  if (url.protocol === "http:") {
    if (authority === null) return { ok: false, reason: "must have an authority" };
    if (
      !LOOPBACK_HOSTNAMES.includes(url.hostname) ||
      !LOOPBACK_HOSTNAMES.includes(rawHost(authority).toLowerCase())
    ) {
      return { ok: false, reason: "must use https unless it targets the loopback interface" };
    }
    return { ok: true };
  }

  const scheme = url.protocol.slice(0, -1);
  if (!ALLOWED_CUSTOM_SCHEMES.includes(scheme)) {
    return { ok: false, reason: "scheme is not allowed" };
  }
  if (!uri.toLowerCase().startsWith(`${scheme}://`) || !url.hostname) {
    return { ok: false, reason: "custom scheme redirects must name an application host" };
  }
  return { ok: true };
}

export function checkRedirectUris(
  uris: unknown,
  env: NodeJS.ProcessEnv = process.env,
): RedirectUriVerdict {
  if (!Array.isArray(uris) || uris.length === 0) {
    return { ok: false, reason: "redirect_uris must list at least one URI" };
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, reason: `redirect_uris may list at most ${MAX_REDIRECT_URIS} URIs` };
  }
  for (const [index, uri] of uris.entries()) {
    const verdict = checkRedirectUri(uri, env);
    if (!verdict.ok) return { ok: false, reason: `redirect_uris[${index}] ${verdict.reason}` };
  }
  return { ok: true };
}

export function assertRegistrableRedirectUris(
  uris: unknown,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const verdict = checkRedirectUris(uris, env);
  if (!verdict.ok) throw new InvalidRedirectUriError(verdict.reason);
}
