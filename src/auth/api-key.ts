import crypto from "node:crypto";

/**
 * Check whether API key authentication is configured.
 * Returns true when the MCP_API_KEY environment variable is set.
 */
export function isApiKeyConfigured(): boolean {
  return !!process.env.MCP_API_KEY;
}

export const MIN_API_KEY_LENGTH = 32;
export const MIN_API_KEY_DISTINCT_CHARACTERS = 12;

function repeatsAShorterBlock(key: string): boolean {
  for (let size = 1; size <= key.length / 2; size += 1) {
    if (key.length % size === 0 && key.slice(0, size).repeat(key.length / size) === key) return true;
  }
  return false;
}

/**
 * Startup check: a short or patterned key can be guessed, so it is refused rather than used.
 * This is a floor, not a measure of strength; `openssl rand -hex 32` clears it with a wide margin.
 */
export function assertApiKeyStrength(env: NodeJS.ProcessEnv = process.env): void {
  const key = env.MCP_API_KEY;
  if (!key) return;
  if (key.length < MIN_API_KEY_LENGTH) {
    throw new Error(`MCP_API_KEY must be at least ${MIN_API_KEY_LENGTH} characters (generate one with: openssl rand -hex 32)`);
  }
  if (new Set(key).size < MIN_API_KEY_DISTINCT_CHARACTERS || repeatsAShorterBlock(key)) {
    throw new Error(
      `MCP_API_KEY is too repetitive: it needs at least ${MIN_API_KEY_DISTINCT_CHARACTERS} different characters and must not be one block repeated (generate one with: openssl rand -hex 32)`,
    );
  }
}

/**
 * Validate a candidate API key against the configured MCP_API_KEY.
 *
 * Constant-time over both *content* and *length* (CODE-B4): the previous
 * implementation early-returned on length mismatch, which leaks the
 * server-side key length to a remote attacker who can measure response
 * timings. We now hash both values to a fixed-width digest and compare
 * those, so the work done is identical whether the candidate matches or
 * not, regardless of input length.
 */
export function validateApiKey(candidate: string): boolean {
  const expected = process.env.MCP_API_KEY;
  if (!expected) return false;

  const candidateDigest = crypto
    .createHash("sha256")
    .update(candidate)
    .digest();
  const expectedDigest = crypto
    .createHash("sha256")
    .update(expected)
    .digest();

  return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}
