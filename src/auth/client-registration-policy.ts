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

// A host that lets third parties publish their own callback path (a Custom GPT
// action on chatgpt.com, for one) cannot be trusted as a whole, so the default
// hosts are pinned to the one callback path their MCP connector uses. Other
// hosts are the operator's decision through OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS.
const PINNED_REDIRECT_PATHS: Readonly<Record<string, string>> = {
  "claude.ai": "/api/mcp/auth_callback",
  "claude.com": "/api/mcp/auth_callback",
};
// ChatGPT's MCP connector callbacks (OpenAI's Apps SDK authentication guide): a fixed path, or the per-app
// /connector/oauth/<callback id>. A Custom GPT Action callback (/aip/g-<id>/oauth/callback) is neither, so
// opting into these two shapes does not trust the whole host the way OAUTH_EXTRA_ALLOWED_REDIRECT_HOSTS does.
const CHATGPT_HOST = "chatgpt.com";
const CHATGPT_FIXED_PATH = "/connector_platform_oauth_redirect";
const CHATGPT_APP_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;
const ALLOWED_CUSTOM_SCHEMES: readonly string[] = ["cursor", "vscode", "vscode-insiders"];
// The application a custom-scheme redirect is delivered to is its host
// ("cursor://<host>/..."). Any application registered for the scheme on the
// operator's machine can claim a host, so only these are accepted by default.
// UNVERIFIED against the real clients: they are the hosts this project's tests
// assumed. Add others with OAUTH_EXTRA_ALLOWED_APP_HOSTS.
const DEFAULT_APP_HOSTS: Readonly<Record<string, readonly string[]>> = {
  cursor: ["anysphere.cursor-retrieval", "anysphere.cursor-mcp"],
  vscode: ["vscode.github-authentication"],
  "vscode-insiders": ["vscode.github-authentication"],
};
const APP_HOST_PATTERN = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const LOOPBACK_HOSTNAMES: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2048;
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const FORBIDDEN_CHARACTERS = /[\s\x00-\x1f\x7f\\*#]/;

export const MAX_CLIENT_NAME_LENGTH = 100;

/** The name is shown on the consent page and logged, and anyone can register one: keep it short. */
export function boundedClientName(name: string | undefined): string | undefined {
  if (typeof name !== "string") return name;
  const characters = Array.from(name);
  return characters.length > MAX_CLIENT_NAME_LENGTH ? characters.slice(0, MAX_CLIENT_NAME_LENGTH).join("") : name;
}

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

let cachedExtraUrisSource: string | undefined;
let cachedExtraUris: string[] = [];

function extraRedirectUris(env: NodeJS.ProcessEnv): string[] {
  const source = env.OAUTH_EXTRA_ALLOWED_REDIRECT_URIS ?? "";
  if (source === cachedExtraUrisSource) return cachedExtraUris;
  const uris: string[] = [];
  for (const entry of source.split(",")) {
    const uri = entry.trim();
    if (!uri) continue;
    if (!uri.startsWith("https://")) {
      logger.warn(
        { entryLength: uri.length },
        "Ignoring OAUTH_EXTRA_ALLOWED_REDIRECT_URIS entry: only exact https URIs are accepted",
      );
      continue;
    }
    uris.push(uri);
  }
  cachedExtraUrisSource = source;
  cachedExtraUris = uris;
  return uris;
}

function chatGptConnectorRedirectsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.OAUTH_ENABLE_CHATGPT_CONNECTOR_REDIRECTS?.trim() === "true";
}

let cachedExtraAppHostsSource: string | undefined;
let cachedExtraAppHosts: string[] = [];

function extraAppHosts(env: NodeJS.ProcessEnv): string[] {
  const source = env.OAUTH_EXTRA_ALLOWED_APP_HOSTS ?? "";
  if (source === cachedExtraAppHostsSource) return cachedExtraAppHosts;
  const hosts: string[] = [];
  for (const entry of source.split(",")) {
    const host = entry.trim().toLowerCase();
    if (!host) continue;
    if (!APP_HOST_PATTERN.test(host)) {
      logger.warn(
        { entryLength: host.length },
        "Ignoring OAUTH_EXTRA_ALLOWED_APP_HOSTS entry: only plain application host names are accepted",
      );
      continue;
    }
    hosts.push(host);
  }
  cachedExtraAppHostsSource = source;
  cachedExtraAppHosts = hosts;
  return hosts;
}

export function allowedAppHosts(scheme: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!ALLOWED_CUSTOM_SCHEMES.includes(scheme)) return [];
  return [...(DEFAULT_APP_HOSTS[scheme] ?? []), ...extraAppHosts(env)];
}

export function allowedRedirectHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...Object.keys(PINNED_REDIRECT_PATHS), ...extraRedirectHosts(env)];
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
    const pinnedPath = PINNED_REDIRECT_PATHS[url.hostname];
    if (pinnedPath !== undefined) {
      if (uri.slice(uri.indexOf("://") + 3 + authority.length) !== pinnedPath) {
        return { ok: false, reason: `must be exactly the ${pinnedPath} callback on this host` };
      }
      return { ok: true };
    }
    if (extraRedirectUris(env).includes(uri) || extraRedirectHosts(env).includes(url.hostname)) {
      return { ok: true };
    }
    if (url.hostname === CHATGPT_HOST && chatGptConnectorRedirectsEnabled(env)) {
      const path = uri.slice(uri.indexOf("://") + 3 + authority.length);
      if (path === CHATGPT_FIXED_PATH || CHATGPT_APP_PATH.test(path)) return { ok: true };
      return {
        ok: false,
        reason: "must be a ChatGPT connector callback (/connector_platform_oauth_redirect or /connector/oauth/<id>)",
      };
    }
    return { ok: false, reason: "host is not an allowed redirect host" };
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
  if (!uri.toLowerCase().startsWith(`${scheme}://`) || !url.hostname || authority === null) {
    return { ok: false, reason: "custom scheme redirects must name an application host" };
  }
  if (authority.includes(":")) return { ok: false, reason: "must not use an explicit port" };
  if (!allowedAppHosts(scheme, env).includes(authority)) {
    return { ok: false, reason: "application host is not allowed for this scheme" };
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
