import { promises as dns } from "node:dns";
import { isIP } from "node:net";

const ALLOWED_PROTOCOLS = new Set(["https:"]);
const DEFAULT_ALLOWED_PORTS: readonly number[] = [443];

/** [network address, prefix length, label]. */
const BLOCKED_V4: ReadonlyArray<readonly [number, number, string]> = [
  [v4n(0, 0, 0, 0), 8, "current-network 0.0.0.0/8"],
  [v4n(10, 0, 0, 0), 8, "RFC1918 10.0.0.0/8"],
  [v4n(100, 64, 0, 0), 10, "CGNAT 100.64.0.0/10"],
  [v4n(127, 0, 0, 0), 8, "loopback 127.0.0.0/8"],
  [v4n(169, 254, 0, 0), 16, "link-local / GCP metadata 169.254.0.0/16"],
  [v4n(172, 16, 0, 0), 12, "RFC1918 172.16.0.0/12"],
  [v4n(192, 0, 0, 0), 24, "IETF protocol assignments 192.0.0.0/24"],
  [v4n(192, 88, 99, 0), 24, "6to4 relay anycast 192.88.99.0/24"],
  [v4n(192, 168, 0, 0), 16, "RFC1918 192.168.0.0/16"],
  [v4n(198, 18, 0, 0), 15, "benchmarking 198.18.0.0/15"],
  [v4n(224, 0, 0, 0), 4, "multicast 224.0.0.0/4"],
  [v4n(240, 0, 0, 0), 4, "reserved 240.0.0.0/4"],
];

function v4n(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** Strict dotted quad, which is what URL parsing and the resolver both produce. */
function parseDottedQuad(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

/**
 * inet_aton forms the URL parser folds to a dotted quad but that a caller
 * holding a raw string can still hand over: 2130706433, 0x7f000001,
 * 017700000001, 127.1, 0x7f.0.0.1.
 */
function parseLegacyIPv4(host: string): number | null {
  if (host === "" || host.length > 64) return null;
  const parts = host.split(".");
  if (parts.length > 4 || parts.some((part) => part === "")) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = Number.parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part, 8);
    else if (/^(0|[1-9]\d*)$/.test(part)) value = Number.parseInt(part, 10);
    else return null;
    if (!Number.isFinite(value)) return null;
    numbers.push(value);
  }
  const last = numbers[numbers.length - 1];
  const leading = numbers.slice(0, -1);
  if (leading.some((n) => n > 255)) return null;
  if (last >= 256 ** (5 - numbers.length)) return null;
  let value = last;
  leading.forEach((n, index) => {
    value += n * 256 ** (3 - index);
  });
  return value >>> 0;
}

function v4Reason(value: number): string | null {
  for (const [network, prefix, label] of BLOCKED_V4) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if (((value & mask) >>> 0) === network) return label;
  }
  return null;
}

function parseIPv6(raw: string): bigint | null {
  let text = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (isIP(text) !== 6) return null;
  let tail = 0n;
  let tailGroups = 0;
  const dotted = text.lastIndexOf(".");
  if (dotted >= 0) {
    const split = text.lastIndexOf(":", dotted);
    const quad = parseDottedQuad(text.slice(split + 1));
    if (quad === null) return null;
    tail = BigInt(quad);
    tailGroups = 2;
    text = text.slice(0, split + 1) + "0:0";
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !rest) return null;
  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  if (tailGroups) value = (value & ~0xffffffffn) | tail;
  return value;
}

function v6Reason(value: bigint): string | null {
  if (value === 0n) return "IPv6 loopback/unspecified";
  if (value === 1n) return "IPv6 loopback/unspecified";
  const top = (bits: number) => value >> BigInt(128 - bits);
  if (top(96) === 0xffffn) {
    const inner = v4Reason(Number(value & 0xffffffffn));
    return inner ? `IPv4-mapped → ${inner}` : null;
  }
  if (top(96) === 0n) return "IPv4-compatible ::/96 (deprecated)";
  if (top(96) === 0x0064ff9b0000000000000000n) return "NAT64 64:ff9b::/96";
  if (top(48) === 0x0064ff9b0001n) return "local-use NAT64 64:ff9b:1::/48";
  if (top(64) === 0x0100n << 48n) return "IPv6 discard-only 100::/64";
  if (top(32) === 0x20010db8n) return "IPv6 documentation 2001:db8::/32";
  if (top(23) === 0x2001n << 7n) return "IETF protocol assignments 2001::/23 (Teredo and others)";
  if (top(16) === 0x2002n) {
    const inner = v4Reason(Number((value >> 80n) & 0xffffffffn));
    return inner ? `6to4 → ${inner}` : null;
  }
  if (top(7) === 0x7en) return "IPv6 unique-local fc00::/7";
  if (top(10) === 0x3fan) return "IPv6 link-local fe80::/10";
  if (top(10) === 0x3fbn) return "IPv6 site-local fec0::/10 (deprecated)";
  if (top(8) === 0xffn) return "IPv6 multicast ff00::/8";
  return null;
}

/** Why an IP literal (any IPv4 spelling, or IPv6) is not a public destination; null when it is. */
export function unsafeIpReason(ip: string): string | null {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  if (bare.includes(":")) {
    if (bare.includes("%")) return "IPv6 zone-scoped address";
    const value = parseIPv6(bare);
    return value === null ? null : v6Reason(value);
  }
  const strict = parseDottedQuad(bare);
  const value = strict ?? parseLegacyIPv4(bare);
  return value === null ? null : v4Reason(value);
}

const INTERNAL_NAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
];

function internalNameReason(hostname: string): string | null {
  const name = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (name === "localhost") return "localhost";
  if (!name.includes(".")) return "single-label host name";
  for (const suffix of INTERNAL_NAME_SUFFIXES) {
    if (name.endsWith(suffix)) return `internal name ${suffix}`;
  }
  return null;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export interface AssertSafeUrlOptions {
  /**
   * Inject a DNS resolver. Defaults to node:dns/promises lookup.
   * Tests can stub this to avoid real network calls.
   */
  resolve?: (hostname: string) => Promise<Array<{ address: string }>>;
  /** Destination ports that may be contacted; 443 only unless a caller widens it. */
  allowedPorts?: readonly number[];
}

export interface ResolvedSafePublicUrl {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

/**
 * Everything that can be decided from the URL text alone, before any DNS query
 * is made: parse, scheme, userinfo, port, internal names and IP literals. A
 * hostname that fails here is never resolved, so it cannot be used to make this
 * server issue a lookup against a name server the caller controls.
 */
export function parseSafePublicUrl(raw: string | URL, options: AssertSafeUrlOptions = {}): URL {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw.toString()) : new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL is malformed");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(`URL protocol "${url.protocol}" is not allowed; only https:`);
  }
  if (!url.hostname) {
    throw new UnsafeUrlError("URL is missing a hostname");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URL must not carry credentials");
  }
  const allowedPorts = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  const port = url.port === "" ? 443 : Number(url.port);
  if (!allowedPorts.includes(port)) {
    throw new UnsafeUrlError("URL port is not allowed");
  }

  const bareHost = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  if (isIP(bareHost) !== 0) {
    const reason = unsafeIpReason(bareHost);
    if (reason) throw new UnsafeUrlError(`URL points at private IP (${reason})`);
    return url;
  }
  const internal = internalNameReason(url.hostname.toLowerCase());
  if (internal) throw new UnsafeUrlError(`URL points at an internal host name (${internal})`);
  return url;
}

/**
 * Throws UnsafeUrlError if the URL is not a safe public destination for an
 * outbound fetch. Used by tools that accept user-supplied URLs (image/video
 * upload) to prevent SSRF against the GCP metadata service, container
 * loopback, RFC1918, link-local and other internal addresses.
 *
 * Validation:
 *   1. Parses as a URL; the parser folds decimal, octal and hex IPv4 spellings
 *      to a dotted quad, so those forms are classified as the address they are.
 *   2. Protocol must be https:, no userinfo, port 443 unless widened.
 *   3. If the host is a literal IP, it must not be in any non-public range.
 *   4. Otherwise, resolves the hostname (A + AAAA) and rejects if any
 *      resolved address falls in a non-public range. (Catches host names that
 *      point at internal addresses; the caller pins the connection to the
 *      addresses returned here so a second resolution cannot differ.)
 */
export async function assertSafePublicUrl(
  raw: string,
  options: AssertSafeUrlOptions = {},
): Promise<URL> {
  return (await resolveSafePublicUrl(raw, options)).url;
}

export async function resolveSafePublicUrl(
  raw: string | URL,
  options: AssertSafeUrlOptions = {},
): Promise<ResolvedSafePublicUrl> {
  const url = parseSafePublicUrl(raw, options);

  const bareHost = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const literalIpVersion = isIP(bareHost);
  if (literalIpVersion === 4 || literalIpVersion === 6) {
    return { url, addresses: [{ address: bareHost, family: literalIpVersion }] };
  }

  const resolver =
    options.resolve ??
    (async (hostname: string) => {
      const records = await dns.lookup(hostname, { all: true, verbatim: true });
      return records;
    });
  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolver(url.hostname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UnsafeUrlError(`Cannot resolve hostname ${url.hostname}: ${msg}`);
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Hostname ${url.hostname} did not resolve to any address`);
  }
  for (const { address } of addresses) {
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
      throw new UnsafeUrlError(
        `Hostname ${url.hostname} resolved to non-IP address ${address}`,
      );
    }
    const reason = unsafeIpReason(address);
    if (reason) {
      throw new UnsafeUrlError(
        `Hostname ${url.hostname} resolves to private IP ${address} (${reason})`,
      );
    }
  }
  return {
    url,
    addresses: addresses.map(({ address }) => ({
      address,
      family: isIP(address) as 4 | 6,
    })),
  };
}
