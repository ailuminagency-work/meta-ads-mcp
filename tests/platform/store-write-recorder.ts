import { vi } from "vitest";
import type { PlatformRepository } from "../../src/platform/repository.js";

/**
 * Records the collection of every record the in-memory store persists. Every write path of the repository ends in
 * its private `store` helper, so this sees control-plane commits, operation preparation and plain puts alike.
 */
export function recordStoreWrites(repo: PlatformRepository): string[] {
  const writes: string[] = [];
  const target = repo as unknown as { store?: (collection: string, tenantId: string, id: string, value: unknown) => void };
  if (typeof target.store !== "function") throw new Error("recordStoreWrites needs the in-memory repository");
  const original = target.store.bind(repo);
  vi.spyOn(target as never, "store" as never).mockImplementation(((collection: string, tenantId: string, id: string, value: unknown) => { writes.push(collection); return original(collection, tenantId, id, value); }) as never);
  return writes;
}

export interface FetchRecord { method: string; path: string }

/** Wraps a provider fake so every request is logged with its method and version-less path. */
export function recordFetch(inner: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): { log: FetchRecord[]; fetch: typeof fetch } {
  const log: FetchRecord[] = [];
  return {
    log,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      log.push({ method: (init?.method ?? "GET").toUpperCase(), path: new URL(String(input)).pathname.replace(/^\/v\d+\.\d+/, "") });
      return inner(input, init);
    }) as typeof fetch,
  };
}
