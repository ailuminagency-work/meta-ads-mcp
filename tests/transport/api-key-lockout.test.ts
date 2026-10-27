import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeyLockout } from "../../src/transport/api-key-lockout.js";
import { startAuthServer, type AuthServer } from "./auth-flow-harness.js";

const KEY = "synthetic-mcp-api-key-".concat("a1b2".repeat(8));
const META_TOKEN = "synthetic-meta-token-".concat("x9".repeat(8));
const PING = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
const API_ENV = { META_APP_ID: "", META_APP_SECRET: "", MCP_API_KEY: KEY, META_ACCESS_TOKEN: "", AUTH_ALLOWED_FB_USER_IDS: "" };

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function reply(origin: string, headers: Record<string, string>): Promise<{ status: number; headers: Headers; body: string }> {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: PING,
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

async function status(origin: string, headers: Record<string, string>): Promise<number> {
  return (await reply(origin, headers)).status;
}

const at = (address: string) => ({ "x-forwarded-for": address });
const wrongKey = (index: number, address: string) => ({ ...at(address), "x-api-key": `wrong-key-${index}` });
const validHeader = (address: string) => ({ ...at(address), "x-api-key": KEY, "x-meta-token": META_TOKEN });
const validBearer = (address: string) => ({ ...at(address), authorization: `Bearer ${KEY}`, "x-meta-token": META_TOKEN });

async function lock(origin: string, address: string): Promise<void> {
  for (let index = 0; index < 25; index += 1) await status(origin, wrongKey(index, address));
  expect(await status(origin, wrongKey(99, address))).toBe(429);
}

describe("API-key lockout is not a guessing oracle (G1D-01)", () => {
  it("locks out wrong keys after 20 failures from one address", async () => {
    server = await startAuthServer(API_ENV);
    const seen: number[] = [];
    for (let index = 0; index < 25; index += 1) seen.push(await status(server.origin, wrongKey(index, "203.0.113.20")));
    expect(seen.filter((code) => code === 401)).toHaveLength(20);
    expect(seen.filter((code) => code === 429)).toHaveLength(5);
  });

  it("refuses the valid key as well, in either header, from a locked address that never presented it", async () => {
    server = await startAuthServer(API_ENV);
    await lock(server.origin, "203.0.113.21");

    expect(await status(server.origin, validHeader("203.0.113.21"))).toBe(429);
    expect(await status(server.origin, validBearer("203.0.113.21"))).toBe(429);
    expect(await status(server.origin, { ...at("203.0.113.21"), "x-api-key": "", authorization: `Bearer ${KEY}` })).toBe(429);
    expect(await status(server.origin, wrongKey(100, "203.0.113.21"))).toBe(429);

    expect(await status(server.origin, validHeader("203.0.113.22"))).toBe(200);
  });

  it("gives the valid key and a wrong key the same answer from a locked address", async () => {
    server = await startAuthServer(API_ENV);
    await lock(server.origin, "203.0.113.23");

    const wrong = await reply(server.origin, wrongKey(101, "203.0.113.23"));
    const right = await reply(server.origin, validHeader("203.0.113.23"));
    const rightBearer = await reply(server.origin, validBearer("203.0.113.23"));
    const wrongBearer = await reply(server.origin, { ...at("203.0.113.23"), authorization: "Bearer not-the-key" });

    for (const other of [right, rightBearer, wrongBearer]) {
      expect(other.status).toBe(wrong.status);
      expect(other.body).toBe(wrong.body);
      expect(other.headers.get("retry-after")).toBe(wrong.headers.get("retry-after"));
      expect(other.headers.get("content-type")).toBe(wrong.headers.get("content-type"));
      expect(other.headers.get("www-authenticate")).toBe(wrong.headers.get("www-authenticate"));
    }
  });

  it("recovers nothing by guessing from a locked address: the right guess is refused like every other", async () => {
    const prefix = "synthetic-mcp-api-key-prefix-0123456789-";
    const secret = "Q";
    server = await startAuthServer({ ...API_ENV, MCP_API_KEY: prefix + secret });
    const address = "203.0.113.24";
    await lock(server.origin, address);

    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const histogram: Record<number, number> = {};
    let found: string | undefined;
    for (let offset = 0; offset < alphabet.length; offset += 16) {
      const batch = [...alphabet.slice(offset, offset + 16)];
      const statuses = await Promise.all(
        batch.map((candidate, index) =>
          status(server!.origin, index % 2 === 0 ? { ...at(address), "x-api-key": prefix + candidate } : { ...at(address), authorization: `Bearer ${prefix}${candidate}` }),
        ),
      );
      statuses.forEach((code, index) => {
        histogram[code] = (histogram[code] ?? 0) + 1;
        if (code !== 429) found = batch[index];
      });
    }

    expect(found).toBeUndefined();
    expect(histogram).toEqual({ 429: alphabet.length });
  });

  it("keeps serving an address that presented the valid key before it was locked, in either header, and keeps refusing its wrong keys", async () => {
    server = await startAuthServer(API_ENV);
    const address = "203.0.113.25";
    expect(await status(server.origin, validHeader(address))).toBe(200);
    await lock(server.origin, address);

    expect(await status(server.origin, validHeader(address))).toBe(200);
    expect(await status(server.origin, validBearer(address))).toBe(200);
    expect(await status(server.origin, wrongKey(102, address))).toBe(429);
    expect(await status(server.origin, { ...at(address), authorization: "Bearer not-the-key" })).toBe(429);
  });

  it("does not count valid requests as failures or reset the failure count of a known-good address", async () => {
    server = await startAuthServer(API_ENV);
    const address = "203.0.113.26";
    expect(await status(server.origin, validHeader(address))).toBe(200);
    await lock(server.origin, address);
    for (let index = 0; index < 30; index += 1) expect(await status(server.origin, validHeader(address))).toBe(200);
    expect(await status(server.origin, wrongKey(103, address))).toBe(429);
  });

  it("treats each address on its own: a known-good neighbour does not unlock an address that never presented the key", async () => {
    server = await startAuthServer(API_ENV);
    expect(await status(server.origin, validHeader("203.0.113.27"))).toBe(200);
    await lock(server.origin, "203.0.113.27");
    await lock(server.origin, "203.0.113.28");

    expect(await status(server.origin, validHeader("203.0.113.27"))).toBe(200);
    expect(await status(server.origin, validHeader("203.0.113.28"))).toBe(429);
  });

  it("still answers a request with no credential at all from a locked address with the sign-in challenge", async () => {
    server = await startAuthServer(API_ENV);
    await lock(server.origin, "203.0.113.29");
    const none = await reply(server.origin, at("203.0.113.29"));
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer /);
  });

  it("does not let valid-key traffic use up the allowance of a client that later mistypes", async () => {
    server = await startAuthServer(API_ENV);
    for (let index = 0; index < 100; index += 1) expect(await status(server.origin, validHeader("203.0.113.30"))).toBe(200);
    const seen: number[] = [];
    for (let index = 0; index < 20; index += 1) seen.push(await status(server.origin, wrongKey(index, "203.0.113.30")));
    expect(seen.every((code) => code === 401)).toBe(true);
  });
});

describe("ApiKeyLockout", () => {
  const MINUTE = 60_000;

  function clocked(options: ConstructorParameters<typeof ApiKeyLockout>[0] = {}) {
    let now = 1_000_000;
    const lockout = new ApiKeyLockout({ ...options, now: () => now });
    return { lockout, advance: (ms: number) => (now += ms) };
  }

  it("locks an address after the failure limit and releases it when the window ends", () => {
    const { lockout, advance } = clocked({ maxFailures: 3, windowMs: 15 * MINUTE });
    for (let index = 0; index < 2; index += 1) lockout.recordFailure("a");
    expect(lockout.isLocked("a")).toBe(false);
    lockout.recordFailure("a");
    expect(lockout.isLocked("a")).toBe(true);
    expect(lockout.isLocked("b")).toBe(false);
    advance(15 * MINUTE + 1);
    expect(lockout.isLocked("a")).toBe(false);
  });

  it("knows an address only after a success, only for the window, and a later success extends it", () => {
    const { lockout, advance } = clocked({ knownGoodTtlMs: 15 * MINUTE });
    expect(lockout.isKnownGood("a")).toBe(false);
    lockout.recordSuccess("a");
    expect(lockout.isKnownGood("a")).toBe(true);
    expect(lockout.isKnownGood("b")).toBe(false);

    advance(10 * MINUTE);
    lockout.recordSuccess("a");
    advance(10 * MINUTE);
    expect(lockout.isKnownGood("a")).toBe(true);

    advance(5 * MINUTE + 1);
    expect(lockout.isKnownGood("a")).toBe(false);
    expect(lockout.knownGoodSize).toBe(0);
  });

  it("does not make an address known by failing, and failures do not clear a success", () => {
    const { lockout } = clocked({ maxFailures: 2 });
    lockout.recordFailure("a");
    lockout.recordFailure("a");
    expect(lockout.isLocked("a")).toBe(true);
    expect(lockout.isKnownGood("a")).toBe(false);

    lockout.recordSuccess("b");
    lockout.recordFailure("b");
    lockout.recordFailure("b");
    expect(lockout.isLocked("b")).toBe(true);
    expect(lockout.isKnownGood("b")).toBe(true);
  });

  it("keeps the known-good table bounded: expired entries go first, then the oldest", () => {
    const { lockout, advance } = clocked({ maxKnownGood: 3, knownGoodTtlMs: 10 * MINUTE });
    lockout.recordSuccess("a");
    advance(1);
    lockout.recordSuccess("b");
    advance(1);
    lockout.recordSuccess("c");
    advance(1);
    lockout.recordSuccess("d");
    expect(lockout.knownGoodSize).toBe(3);
    expect(lockout.isKnownGood("a")).toBe(false);
    expect(["b", "c", "d"].map((address) => lockout.isKnownGood(address))).toEqual([true, true, true]);

    advance(10 * MINUTE);
    lockout.recordSuccess("e");
    expect(lockout.knownGoodSize).toBe(1);
    expect(lockout.isKnownGood("e")).toBe(true);
  });

  it("never grows past its bound however many addresses present the key", () => {
    const { lockout } = clocked({ maxKnownGood: 50 });
    for (let index = 0; index < 5_000; index += 1) lockout.recordSuccess(`203.0.${index >> 8}.${index & 255}`);
    expect(lockout.knownGoodSize).toBe(50);
  });
});
