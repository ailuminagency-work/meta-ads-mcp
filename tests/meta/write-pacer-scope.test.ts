import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountScopeCache,
  PACER_MAX_BUCKETS,
  SCOPE_CACHE_MAX_ENTRIES,
  WritePacer,
} from "../../src/meta/write-pacer.js";

const devRatePerSec = (300 + 40 * 50) / 3600;
const gapMs = 1000 / devRatePerSec;
const burst = 10;

afterEach(() => {
  vi.useRealTimers();
});

function startWriters(
  pacer: WritePacer,
  writers: number,
  scope: (index: number) => string,
): { released: number[]; order: number[] } {
  const start = Date.now();
  const released: number[] = [];
  const order: number[] = [];
  for (let index = 0; index < writers; index++) {
    void pacer.acquire("tok", scope(index)).then(() => {
      released.push(Date.now() - start);
      order.push(index);
    });
  }
  return { released, order };
}

describe("WritePacer concurrent waiters", () => {
  it("releases 50 concurrent writes to one account at the configured rate, not all at once", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    const { released, order } = startWriters(pacer, 50, () => "act_1");

    await vi.advanceTimersByTimeAsync(2 * gapMs);
    expect(released.length).toBeGreaterThanOrEqual(burst);
    expect(released.length).toBeLessThanOrEqual(burst + 2);

    await vi.advanceTimersByTimeAsync(45 * gapMs);
    expect(released).toHaveLength(50);
    expect(order).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(released.slice(0, burst).every((t) => t === 0)).toBe(true);
    const gaps = released.slice(burst + 1).map((t, i) => t - released[burst + i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(Math.floor(gapMs) - 1);
    expect(released[49]).toBeGreaterThanOrEqual(Math.floor(39 * gapMs));
  });

  it("does not let one account's backlog delay another account", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    startWriters(pacer, 40, () => "act_1");
    const other = startWriters(pacer, 1, () => "act_2");
    await vi.advanceTimersByTimeAsync(0);
    expect(other.released).toEqual([0]);
  });

  it("keeps serving queued writers when the tier is upgraded mid-wait", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    const { released } = startWriters(pacer, 13, () => "act_1");
    await vi.advanceTimersByTimeAsync(10);
    pacer.updateTier("tok", "act_1", "standard_access");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(released).toHaveLength(13);
    expect(pacer.snapshot()[0].tokens).toBeGreaterThanOrEqual(0);
  });

  it("charges unseen objects to one per-token bucket instead of one fresh bucket per object", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    const { released } = startWriters(pacer, 30, (i) => String(1000 + i));
    await vi.advanceTimersByTimeAsync(3 * gapMs);
    expect(released.length).toBeLessThanOrEqual(burst + 3);
    expect(pacer.snapshot().map((b) => b.key)).toEqual(["tok:_token"]);
  });

  it("charges objects learned under an account to that account's bucket", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer();
    pacer.learnFromResponse("tok", "act_7", "/act_7/campaigns", {
      data: Array.from({ length: 30 }, (_, i) => ({ id: String(2000 + i) })),
    });
    const { released } = startWriters(pacer, 30, (i) => String(2000 + i));
    await vi.advanceTimersByTimeAsync(3 * gapMs);
    expect(released.length).toBeLessThanOrEqual(burst + 3);
    expect(pacer.snapshot().map((b) => b.key)).toEqual(["tok:act_7"]);
  });
});

describe("WritePacer object-to-account learning", () => {
  async function keysAfterAcquiring(pacer: WritePacer, ids: string[]): Promise<string[]> {
    for (const id of ids) await pacer.acquire("tok", id);
    return pacer.snapshot().map((b) => b.key).sort();
  }

  it("learns ids created or listed under an account, and from account_id fields", async () => {
    const pacer = new WritePacer();
    pacer.learnFromResponse("tok", "act_1", "/act_1/campaigns", { id: "111" });
    pacer.learnFromResponse("tok", "act_1", "/act_1/adsets", { data: [{ id: "222" }, { id: "333" }] });
    pacer.learnFromResponse("tok", "444", "/444", { id: "444", account_id: "9" });
    pacer.learnFromResponse("tok", "555", "/555/ads", { data: [{ id: "666", account_id: "act_3" }] });
    expect(await keysAfterAcquiring(pacer, ["111", "222", "333", "444", "666"])).toEqual([
      "tok:act_1",
      "tok:act_3",
      "tok:act_9",
    ]);
  });

  it("propagates a known parent's account to its children", async () => {
    const pacer = new WritePacer();
    pacer.learnFromResponse("tok", "act_5", "/act_5/campaigns", { data: [{ id: "10" }] });
    pacer.learnFromResponse("tok", "10", "/10/adsets", { data: [{ id: "11" }] });
    expect(await keysAfterAcquiring(pacer, ["11"])).toEqual(["tok:act_5"]);
  });

  it("learns the object a caller explicitly scoped to an account", async () => {
    const pacer = new WritePacer();
    pacer.learnFromResponse("tok", "act_8", "/1234567890/copies", { copied_ad_id: "1" });
    expect(await keysAfterAcquiring(pacer, ["1234567890"])).toEqual(["tok:act_8"]);
  });

  it("keeps what one token learned invisible to another token", async () => {
    const pacer = new WritePacer();
    pacer.learnFromResponse("tokA", "act_1", "/act_1/ads", { id: "77" });
    await pacer.acquire("tokB", "77");
    expect(pacer.snapshot().map((b) => b.key)).toEqual(["tokB:_token"]);
  });

  it.each([
    ["null body", null],
    ["string body", "id=1"],
    ["non-numeric id", { id: "act_9; DROP" }],
    ["oversize id", { id: "9".repeat(40) }],
    ["array id", { id: ["1"] }],
    ["rows without ids", { data: [{ name: "x" }, null, 3] }],
  ])("ignores a malformed response: %s", (_label, body) => {
    const pacer = new WritePacer();
    expect(() => pacer.learnFromResponse("tok", "act_1", "/act_1/campaigns", body)).not.toThrow();
    expect(pacer.learnedObjectCount).toBe(0);
  });

  it("does not learn from edges that are not ad objects", () => {
    const pacer = new WritePacer();
    pacer.learnFromResponse("tok", "act_1", "/act_1/users", { data: [{ id: "12345" }] });
    expect(pacer.learnedObjectCount).toBe(0);
  });

  it("forgets learned objects after the TTL", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer({ scopes: new AccountScopeCache(100, 1_000) });
    pacer.learnFromResponse("tok", "act_1", "/act_1/ads", { id: "5" });
    await vi.advanceTimersByTimeAsync(1_001);
    await pacer.acquire("tok", "5");
    expect(pacer.snapshot().map((b) => b.key)).toEqual(["tok:_token"]);
  });

  it("treats anything that is neither an account nor a numeric object as the per-token scope", async () => {
    const pacer = new WritePacer();
    await pacer.acquire("tok", "me");
    await pacer.acquire("tok", undefined);
    expect(pacer.snapshot().map((b) => b.key)).toEqual(["tok:_token"]);
  });
});

describe("WritePacer memory bounds", () => {
  it("evicts idle buckets after the idle TTL but keeps recently used ones", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer({ idleTtlMs: 60_000 });
    await pacer.acquire("tok", "act_1");
    await vi.advanceTimersByTimeAsync(30_000);
    await pacer.acquire("tok", "act_2");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(pacer.snapshot().map((b) => b.key)).toEqual(["tok:act_2"]);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(pacer.snapshot()).toEqual([]);
  });

  it("never evicts a bucket that still has queued writers", async () => {
    vi.useFakeTimers();
    const pacer = new WritePacer({ idleTtlMs: 1_000 });
    const { released } = startWriters(pacer, 14, () => "act_1");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pacer.snapshot().map((b) => b.key)).toEqual(["tok:act_1"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(released).toHaveLength(14);
  });

  it("stays bounded under a flood of distinct accounts and objects", async () => {
    const pacer = new WritePacer({ maxBuckets: 100, scopes: new AccountScopeCache(200, 60_000) });
    for (let index = 0; index < 3_000; index++) {
      await pacer.acquire("tok", `act_${index + 1}`);
      pacer.learnFromResponse("tok", `act_${index + 1}`, `/act_${index + 1}/ads`, {
        data: Array.from({ length: 5 }, (_, i) => ({ id: String(index * 10 + i + 1) })),
      });
    }
    expect(pacer.snapshot().length).toBeLessThanOrEqual(100);
    expect(pacer.learnedObjectCount).toBeLessThanOrEqual(200);
  });

  it("keeps the default bucket and object maps within their caps across 100 000 distinct accounts", async () => {
    const pacer = new WritePacer();
    for (let index = 0; index < 100_000; index++) {
      const account = `act_${index + 1}`;
      await pacer.acquire("tok", account);
      pacer.learnFromResponse("tok", account, `/${account}/campaigns`, { id: String(index + 1) });
    }
    expect(pacer.snapshot().length).toBeLessThanOrEqual(PACER_MAX_BUCKETS);
    expect(pacer.learnedObjectCount).toBeLessThanOrEqual(SCOPE_CACHE_MAX_ENTRIES);
  });
});
