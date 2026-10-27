import { afterEach, describe, expect, it, vi } from "vitest";
import { abortableSleep, raceAbort, RequestAbortedError, throwIfAborted } from "../../src/utils/abortable.js";

afterEach(() => vi.useRealTimers());

describe("abortable helpers", () => {
  it("throwIfAborted passes without a signal or an idle one, and throws on an aborted one", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(RequestAbortedError);
  });

  it("abortableSleep sleeps the full time when nobody aborts, and leaves no listener behind", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let done = false;
    const sleeping = abortableSleep(1000, controller.signal).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(done).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("abortableSleep ends at once when aborted, and clears its timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sleeping = abortableSleep(60_000, controller.signal);
    const outcome = sleeping.catch((e: unknown) => e);
    controller.abort();
    expect(await outcome).toBeInstanceOf(RequestAbortedError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("abortableSleep refuses to start on an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(10, controller.signal)).rejects.toBeInstanceOf(RequestAbortedError);
  });

  it("raceAbort returns the value, the rejection, or stops waiting on abort", async () => {
    await expect(raceAbort(Promise.resolve(5), undefined)).resolves.toBe(5);
    await expect(raceAbort(Promise.resolve(5), new AbortController().signal)).resolves.toBe(5);
    await expect(raceAbort(Promise.reject(new Error("boom")), new AbortController().signal)).rejects.toThrow("boom");
    const controller = new AbortController();
    const never = new Promise<number>(() => undefined);
    const raced = raceAbort(never, controller.signal);
    controller.abort();
    await expect(raced).rejects.toBeInstanceOf(RequestAbortedError);
    const late = new AbortController();
    late.abort();
    await expect(raceAbort(Promise.reject(new Error("unhandled?")), late.signal)).rejects.toBeInstanceOf(RequestAbortedError);
  });
});
