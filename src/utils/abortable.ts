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

/** Waits for a promise that cannot itself be cancelled, but stops waiting for it when the signal aborts. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(new RequestAbortedError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => undefined);
      reject(new RequestAbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
