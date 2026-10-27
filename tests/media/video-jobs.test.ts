import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createVideoJobRunner,
  VideoJobBusyError,
  VideoJobRateLimitError,
  VideoJobTenantQueueFullError,
  type VideoJobContext,
} from "../../src/media/video-jobs.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createVideoJobRunner", () => {
  it("creates a private temp dir for the job and removes it afterwards, even on failure", async () => {
    const runner = createVideoJobRunner({ maxConcurrent: 1 });
    let seen: string | undefined;

    await runner.run({ tenantId: "t1" }, async (ctx) => {
      seen = ctx.dir;
      await fs.writeFile(path.join(ctx.dir, "scratch.bin"), "x");
      expect(path.basename(ctx.dir)).toMatch(/^meta-ads-video-/);
    });
    await expect(fs.stat(seen as string)).rejects.toThrow();

    let failed: string | undefined;
    await expect(
      runner.run({ tenantId: "t1" }, async (ctx) => {
        failed = ctx.dir;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(fs.stat(failed as string)).rejects.toThrow();
  });

  it("limits concurrent jobs per instance and queues the rest", async () => {
    const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 4, queueWaitMs: 5_000 });
    const gate = deferred<void>();
    const order: string[] = [];

    const first = runner.run({ tenantId: "t1" }, async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
    });
    const second = runner.run({ tenantId: "t1" }, async () => {
      order.push("second-start");
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["first-start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("rejects with VideoJobBusyError when the queue is full", async () => {
    const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 1, queueWaitMs: 5_000 });
    const gate = deferred<void>();
    const running = runner.run({ tenantId: "t1" }, async () => gate.promise);
    const queued = runner.run({ tenantId: "t1" }, async () => undefined);

    await expect(runner.run({ tenantId: "t1" }, async () => undefined)).rejects.toBeInstanceOf(VideoJobBusyError);

    gate.resolve();
    await Promise.all([running, queued]);
  });

  it("rejects with VideoJobBusyError after waiting queueWaitMs without a slot", async () => {
    const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 2, queueWaitMs: 30 });
    const gate = deferred<void>();
    const running = runner.run({ tenantId: "t1" }, async () => gate.promise);

    await expect(runner.run({ tenantId: "t1" }, async () => undefined)).rejects.toBeInstanceOf(VideoJobBusyError);

    gate.resolve();
    await running;
  });

  it("enforces a per-tenant sliding-window rate limit", async () => {
    let now = 1_000_000;
    const runner = createVideoJobRunner({ maxConcurrent: 2, perTenantPerHour: 2, now: () => now });

    await runner.run({ tenantId: "a" }, async () => undefined);
    await runner.run({ tenantId: "a" }, async () => undefined);
    await expect(runner.run({ tenantId: "a" }, async () => undefined)).rejects.toBeInstanceOf(VideoJobRateLimitError);
    // Other tenants are unaffected.
    await runner.run({ tenantId: "b" }, async () => undefined);

    now += 61 * 60 * 1000;
    await runner.run({ tenantId: "a" }, async () => undefined);
  });

  it("exposes a deadline and remaining budget to the job", async () => {
    let now = 5_000;
    const runner = createVideoJobRunner({ maxConcurrent: 1, budgetMs: 1_000, now: () => now });

    await runner.run({ tenantId: "t1" }, async (ctx: VideoJobContext) => {
      expect(ctx.deadline).toBe(6_000);
      expect(ctx.remainingMs()).toBe(1_000);
      now += 400;
      expect(ctx.remainingMs()).toBe(600);
      expect(ctx.outOfTime()).toBe(false);
      now += 700;
      expect(ctx.outOfTime()).toBe(true);
    });
  });

  it("propagates the caller's abort signal and aborts on deadline", async () => {
    const controller = new AbortController();
    const runner = createVideoJobRunner({ maxConcurrent: 1, budgetMs: 60_000 });

    await runner.run({ tenantId: "t1", signal: controller.signal }, async (ctx) => {
      expect(ctx.signal.aborted).toBe(false);
      controller.abort();
      expect(ctx.signal.aborted).toBe(true);
    });
  });

  it("drops a queued job from the queue as soon as its caller aborts", async () => {
    const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 2, queueWaitMs: 5_000 });
    const gate = deferred<void>();
    const running = runner.run({ tenantId: "t1" }, async () => gate.promise);
    const controller = new AbortController();
    const queued = runner.run({ tenantId: "t1", signal: controller.signal }, async () => "should not run");

    await new Promise((r) => setTimeout(r, 5));
    expect(runner.stats().queued).toBe(1);
    controller.abort();
    await expect(queued).rejects.toThrow(/abort/i);
    expect(runner.stats().queued).toBe(0);

    gate.resolve();
    await running;
  });

  it("does not run a job whose signal is already aborted", async () => {
    const runner = createVideoJobRunner({ maxConcurrent: 1 });
    const controller = new AbortController();
    controller.abort();
    const job = vi.fn(async () => undefined);
    await expect(runner.run({ tenantId: "t1", signal: controller.signal }, job)).rejects.toThrow(/abort/i);
    expect(job).not.toHaveBeenCalled();
    expect(runner.stats()).toMatchObject({ running: 0, queued: 0 });
  });

  it("releases the slot only after the scratch directory is gone", async () => {
    const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 1, queueWaitMs: 5_000 });
    let firstDir = "";
    let secondSawFirstDir: boolean | undefined;
    const first = runner.run({ tenantId: "t1" }, async (ctx) => {
      firstDir = ctx.dir;
      await fs.writeFile(path.join(ctx.dir, "big.bin"), Buffer.alloc(1024));
    });
    const second = runner.run({ tenantId: "t1" }, async () => {
      secondSawFirstDir = await fs.stat(firstDir).then(() => true, () => false);
    });
    await Promise.all([first, second]);
    expect(secondSawFirstDir).toBe(false);
  });

  it("forgets tenants whose rate window has fully expired", async () => {
    let now = 1_000_000;
    const runner = createVideoJobRunner({ maxConcurrent: 2, perTenantPerHour: 5, now: () => now });
    for (let i = 0; i < 50; i++) {
      await runner.run({ tenantId: `tenant-${i}` }, async () => undefined);
    }
    expect(runner.stats().tracked_tenants).toBe(50);
    now += 2 * 60 * 60 * 1000;
    await runner.run({ tenantId: "fresh" }, async () => undefined);
    expect(runner.stats().tracked_tenants).toBe(1);
  });

  it("reports the number of running and queued jobs", async () => {
    const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 2, queueWaitMs: 5_000 });
    const gate = deferred<void>();
    const a = runner.run({ tenantId: "t1" }, async () => gate.promise);
    const b = runner.run({ tenantId: "t1" }, async () => undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(runner.stats()).toMatchObject({ running: 1, queued: 1 });
    gate.resolve();
    await Promise.all([a, b]);
    expect(runner.stats()).toMatchObject({ running: 0, queued: 0 });
  });

  describe("hourly allowance", () => {
    it("is not spent by calls turned away because the queue is full", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 0, perTenantPerHour: 2 });
      const gate = deferred<void>();
      const holder = runner.run({ tenantId: "other" }, async () => gate.promise);

      for (let i = 0; i < 5; i++) {
        await expect(runner.run({ tenantId: "a" }, async () => undefined)).rejects.toBeInstanceOf(VideoJobBusyError);
      }
      gate.resolve();
      await holder;

      await runner.run({ tenantId: "a" }, async () => undefined);
      await runner.run({ tenantId: "a" }, async () => undefined);
      await expect(runner.run({ tenantId: "a" }, async () => undefined)).rejects.toBeInstanceOf(VideoJobRateLimitError);
    });

    it("is not spent by a call that waited out the queue and gave up", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 4, queueWaitMs: 20, perTenantPerHour: 1 });
      const gate = deferred<void>();
      const holder = runner.run({ tenantId: "other" }, async () => gate.promise);

      await expect(runner.run({ tenantId: "a" }, async () => undefined)).rejects.toBeInstanceOf(VideoJobBusyError);
      gate.resolve();
      await holder;

      await expect(runner.run({ tenantId: "a" }, async () => "ran")).resolves.toBe("ran");
    });

    it("is not spent by a queued call its caller abandoned", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 4, queueWaitMs: 5_000, perTenantPerHour: 1 });
      const gate = deferred<void>();
      const holder = runner.run({ tenantId: "other" }, async () => gate.promise);
      const controller = new AbortController();
      const abandoned = runner.run({ tenantId: "a", signal: controller.signal }, async () => "never");
      await new Promise((r) => setTimeout(r, 5));
      controller.abort();
      await expect(abandoned).rejects.toThrow(/abort/i);
      gate.resolve();
      await holder;

      await expect(runner.run({ tenantId: "a" }, async () => "ran")).resolves.toBe("ran");
    });

    it("is not spent by a call already aborted when it arrives", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, perTenantPerHour: 1 });
      const controller = new AbortController();
      controller.abort();
      await expect(runner.run({ tenantId: "a", signal: controller.signal }, async () => "never")).rejects.toThrow(/abort/i);
      await expect(runner.run({ tenantId: "a" }, async () => "ran")).resolves.toBe("ran");
    });

    it("is spent by a job that started, whether it succeeds or fails", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 2, perTenantPerHour: 2 });
      await expect(runner.run({ tenantId: "a" }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
      await runner.run({ tenantId: "a" }, async () => undefined);
      await expect(runner.run({ tenantId: "a" }, async () => undefined)).rejects.toBeInstanceOf(VideoJobRateLimitError);
    });

    it("cannot be overrun by callers that pass the first check together", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 3, maxQueued: 3, perTenantPerHour: 1 });
      const gate = deferred<void>();
      const first = runner.run({ tenantId: "a" }, async () => gate.promise);
      const second = runner.run({ tenantId: "a" }, async () => "should not run");
      const third = runner.run({ tenantId: "a" }, async () => "should not run");

      await Promise.all([
        expect(second).rejects.toBeInstanceOf(VideoJobRateLimitError),
        expect(third).rejects.toBeInstanceOf(VideoJobRateLimitError),
      ]);
      gate.resolve();
      await first;
      expect(runner.stats()).toMatchObject({ running: 0, queued: 0 });
    });
  });

  describe("queue places per tenant", () => {
    const settle = () => new Promise((r) => setTimeout(r, 20));
    const until = async (condition: () => boolean) => {
      const limit = Date.now() + 5_000;
      while (!condition()) {
        if (Date.now() > limit) throw new Error("condition not reached");
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    it("does not let one tenant hold the slot and the whole queue; another tenant still gets a place", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 8, queueWaitMs: 5_000, perTenantPerHour: 30 });
      const gate = deferred<void>();
      const order: string[] = [];
      const noisy = Array.from({ length: 9 }, (_, i) =>
        runner.run({ tenantId: "noisy" }, async () => { order.push(`noisy-${i}`); await gate.promise; }),
      );
      const outcomes = noisy.map((p) => p.then(() => "ok", (e: Error) => e));
      await settle();

      expect(runner.stats()).toMatchObject({ running: 1, queued: 2 });
      const quiet = runner.run({ tenantId: "quiet" }, async () => { order.push("quiet"); return "quiet done"; });
      await settle();
      expect(runner.stats()).toMatchObject({ running: 1, queued: 3 });

      gate.resolve();
      await expect(quiet).resolves.toBe("quiet done");
      const results = await Promise.all(outcomes);
      const refused = results.filter((r) => r instanceof VideoJobTenantQueueFullError);
      expect(refused).toHaveLength(6);
      expect(refused[0]).toBeInstanceOf(VideoJobBusyError);
      expect((refused[0] as Error).message).toMatch(/already has 2 videos waiting/);
      expect(results.filter((r) => r === "ok")).toHaveLength(3);
      expect(order).toEqual(["noisy-0", "quiet", "noisy-1", "noisy-2"]);
    });

    it("serves waiting tenants round-robin, the one that ran longest ago first, not in arrival order", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 8, queueWaitMs: 5_000 });
      const gates = new Map<string, ReturnType<typeof deferred<void>>>();
      const order: string[] = [];
      const job = (name: string) => async () => {
        order.push(name);
        gates.set(name, deferred<void>());
        await gates.get(name)!.promise;
      };
      const runs = [runner.run({ tenantId: "a" }, job("a1"))];
      await until(() => order.length === 1);
      runs.push(runner.run({ tenantId: "a" }, job("a2")));
      runs.push(runner.run({ tenantId: "a" }, job("a3")));
      await until(() => runner.stats().queued === 2);
      runs.push(runner.run({ tenantId: "b" }, job("b1")));
      runs.push(runner.run({ tenantId: "b" }, job("b2")));
      runs.push(runner.run({ tenantId: "c" }, job("c1")));
      await until(() => runner.stats().queued === 5);

      const expected = ["a1", "b1", "c1", "a2", "b2", "a3"];
      for (const [index, name] of expected.entries()) {
        await until(() => gates.has(name));
        gates.get(name)!.resolve();
        await until(() => order.length === Math.min(index + 2, expected.length));
      }
      await Promise.all(runs);
      expect(order).toEqual(["a1", "b1", "c1", "a2", "b2", "a3"]);
    });

    it("keeps oldest-first within a tenant and does not serve a caller that has gone", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 8, queueWaitMs: 5_000 });
      const gate = deferred<void>();
      const order: string[] = [];
      const holder = runner.run({ tenantId: "a" }, async () => { order.push("a1"); await gate.promise; });
      const controller = new AbortController();
      const gone = runner.run({ tenantId: "b", signal: controller.signal }, async () => { order.push("b-gone"); });
      const goneOutcome = gone.catch((e: Error) => e);
      const b2 = runner.run({ tenantId: "b" }, async () => { order.push("b2"); });
      const a2 = runner.run({ tenantId: "a" }, async () => { order.push("a2"); });
      await settle();
      controller.abort();
      await goneOutcome;
      gate.resolve();
      await Promise.all([holder, b2, a2]);
      expect(order).toEqual(["a1", "b2", "a2"]);
    });

    it("lets a tenant that is waiting run while another keeps resubmitting into the slot (starvation)", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 8, maxQueuedPerTenant: 2, queueWaitMs: 100, perTenantPerHour: 1000 });
      let stop = false;
      const pump = async () => {
        while (!stop) {
          await runner.run({ tenantId: "noisy" }, async () => new Promise((r) => setTimeout(r, 400))).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 2));
        }
      };
      const pumps = [pump(), pump(), pump()];
      await new Promise((r) => setTimeout(r, 50));
      const outcomes: string[] = [];
      const until = Date.now() + 1800;
      while (Date.now() < until) {
        outcomes.push(await runner.run({ tenantId: "quiet" }, async () => "ran").then(() => "ran", (e: Error) => e.name));
      }
      stop = true;
      await Promise.allSettled(pumps);
      expect(outcomes.filter((o) => o === "ran").length, outcomes.join(",")).toBeGreaterThan(0);
    });

    it("counts only waiting places: a running job is not one, and a place frees as soon as its job starts", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 8, queueWaitMs: 5_000 });
      const first = deferred<void>();
      const second = deferred<void>();
      const a1 = runner.run({ tenantId: "a" }, async () => first.promise);
      const a2 = runner.run({ tenantId: "a" }, async () => second.promise);
      const a3 = runner.run({ tenantId: "a" }, async () => "a3");
      await settle();
      expect(runner.stats()).toMatchObject({ running: 1, queued: 2 });
      await expect(runner.run({ tenantId: "a" }, async () => "a4")).rejects.toBeInstanceOf(VideoJobTenantQueueFullError);

      first.resolve();
      await a1;
      await settle();
      expect(runner.stats()).toMatchObject({ running: 1, queued: 1 });
      const a4 = runner.run({ tenantId: "a" }, async () => "a4");
      await settle();
      expect(runner.stats()).toMatchObject({ running: 1, queued: 2 });
      second.resolve();
      await expect(Promise.all([a2, a3, a4])).resolves.toEqual([undefined, "a3", "a4"]);
    });

    it("frees a place when a queued caller gives up or times out", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 8, queueWaitMs: 50 });
      const gate = deferred<void>();
      const holder = runner.run({ tenantId: "b" }, async () => gate.promise);
      const controller = new AbortController();
      const abandoned = runner.run({ tenantId: "a", signal: controller.signal }, async () => "never");
      const timedOut = runner.run({ tenantId: "a" }, async () => "never");
      const abandonedOutcome = abandoned.catch((e: Error) => e);
      const timedOutOutcome = timedOut.catch((e: Error) => e);
      await settle();
      await expect(runner.run({ tenantId: "a" }, async () => "never")).rejects.toBeInstanceOf(VideoJobTenantQueueFullError);
      controller.abort();
      await abandonedOutcome;
      expect(runner.stats().queued).toBe(1);
      expect(await timedOutOutcome).toBeInstanceOf(VideoJobBusyError);
      expect(runner.stats().queued).toBe(0);
      const again = runner.run({ tenantId: "a" }, async () => "a again");
      await settle();
      expect(runner.stats().queued).toBe(1);
      gate.resolve();
      await holder;
      await expect(again).resolves.toBe("a again");
    });

    it("spends no allowance on a call turned away because its tenant's places are taken", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 8, queueWaitMs: 5_000, perTenantPerHour: 4 });
      const gate = deferred<void>();
      const jobs = Array.from({ length: 4 }, () => runner.run({ tenantId: "a" }, async () => gate.promise).catch((e: Error) => e));
      await settle();
      gate.resolve();
      const results = await Promise.all(jobs);
      expect(results.filter((r) => r instanceof VideoJobTenantQueueFullError)).toHaveLength(1);
      await expect(runner.run({ tenantId: "a" }, async () => "fourth start")).resolves.toBe("fourth start");
      await expect(runner.run({ tenantId: "a" }, async () => "over")).rejects.toBeInstanceOf(VideoJobRateLimitError);
    });

    it("takes the bound from configuration", async () => {
      const runner = createVideoJobRunner({ maxConcurrent: 1, maxQueued: 8, maxQueuedPerTenant: 1, queueWaitMs: 5_000 });
      const gate = deferred<void>();
      const holder = runner.run({ tenantId: "a" }, async () => gate.promise);
      const queued = runner.run({ tenantId: "a" }, async () => "queued");
      await settle();
      await expect(runner.run({ tenantId: "a" }, async () => "no")).rejects.toThrow(/already has 1 videos waiting/);
      gate.resolve();
      await holder;
      await expect(queued).resolves.toBe("queued");
    });
  });
});
