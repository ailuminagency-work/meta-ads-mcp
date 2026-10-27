export const DEFAULT_TRUST_PROXY_HOPS = 1;
export const MAX_TRUST_PROXY_HOPS = 10;

/**
 * How many reverse proxies sit between the internet and this process. Express
 * takes the client address from X-Forwarded-For that many entries from the
 * right: too low and every client shares the proxy's address, too high and a
 * client can choose its own address by sending the header. The operator knows
 * the topology, so a value that is not a plain count stops the server.
 */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_TRUST_PROXY_HOPS;
  const hops = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(hops) || hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error(`TRUST_PROXY_HOPS must be a whole number of proxy hops from 0 to ${MAX_TRUST_PROXY_HOPS}`);
  }
  return hops;
}
