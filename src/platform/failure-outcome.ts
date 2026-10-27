import { ProductApiError } from "./clients.js";
import { mutationStepClaimed, type ExecutionPermit } from "./execution.js";

/** Graph error codes for "unknown" and "service unavailable": the request may have been processed even though an error came back. */
const AMBIGUOUS_GRAPH_CODES: readonly number[] = [1, 2];
/** Throttling and request timeouts say nothing about whether the write landed, and the platform treats a throttled write as unknown on purpose. */
const AMBIGUOUS_HTTP_STATUSES: readonly number[] = [408, 429];

/**
 * A response that proves Meta rejected the request and changed nothing: a 4xx status with a Graph error object (so a numeric
 * code), not a transient or ambiguous one. Anything else, including a 2xx carrying an error, a 5xx, a throttle or timeout
 * (408, 429) and a body that is not a Graph error, leaves open that the write happened.
 */
export function providerRejection(status: number, code: number | null, transient = false): boolean {
  return status >= 400 && status < 500 && !AMBIGUOUS_HTTP_STATUSES.includes(status) && code !== null && !transient && !AMBIGUOUS_GRAPH_CODES.includes(code);
}

/**
 * How an operation ends after a failure. FAILED releases the plan lock, so it is only for a failure that provably never
 * changed anything at Meta: the single mutation step was never begun (a read failed, validation or a local exception
 * came first), or Meta rejected the request. Once the step began, a timeout, a lost connection, a 5xx or an unreadable
 * response stays UNKNOWN and keeps the lock until it is reconciled.
 */
export function outcomeAfterFailure(permit: ExecutionPermit, error: unknown): "FAILED" | "UNKNOWN" {
  if (!mutationStepClaimed(permit)) return "FAILED";
  return error instanceof ProductApiError && providerRejection(error.status, error.code) ? "FAILED" : "UNKNOWN";
}
