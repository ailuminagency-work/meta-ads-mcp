/** The caller has gone (client drop, watchdog) or cancelled, so the work has no one to answer. */
export class RequestAbortedError extends Error {
  constructor() {
    super("The request was cancelled before it finished.");
    this.name = "RequestAbortedError";
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RequestAbortedError();
}

/** A sleep that ends at once, with RequestAbortedError, when the signal aborts, and leaves no timer or listener behind. */
export function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(new RequestAbortedError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RequestAbortedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// There is deliberately no "stop waiting but leave the work running" helper here. Racing a wait against the
// signal abandons it: the queue place, the timer and everything they reference (a whole per-request server)
// live on until the wait ends by itself. A wait must take the signal and leave on its own, as abortableSleep,
// WritePacer.acquire and RateLimiter.waitIfNeeded do.
