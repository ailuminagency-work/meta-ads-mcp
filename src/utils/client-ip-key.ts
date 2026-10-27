import { isIPv4, isIPv6 } from "node:net";

function ipv4ToHextets(address: string): [number, number] {
  const [a, b, c, d] = address.split(".").map(Number);
  return [(a << 8) | b, (c << 8) | d];
}

function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);

  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIPv4(tail)) return null;
    const [high, low] = ipv4ToHextets(tail);
    text = `${text.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const values = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
    return values.some(Number.isNaN) ? null : values;
  };
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !rest) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

/**
 * Bucket key for per-client rate limits. An IPv6 subscriber normally receives a
 * whole /64, so keying on the full address would hand one client 2^64 buckets;
 * those addresses share one key here. IPv4-mapped IPv6 addresses collapse onto
 * the IPv4 address they carry.
 */
export function clientIpKey(address: string | null | undefined): string {
  const text = (address ?? "").trim();
  if (!text) return "unknown";
  if (isIPv4(text)) return text;
  if (!isIPv6(text.split("%")[0])) return text.toLowerCase();

  const groups = expandIpv6(text);
  if (!groups) return text.toLowerCase();
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16).padStart(4, "0"))
    .join(":")}::/64`;
}
