import crypto from "node:crypto";

/**
 * Check whether API key authentication is configured.
 * Returns true when the MCP_API_KEY environment variable is set.
 */
export function isApiKeyConfigured(): boolean {
  return !!process.env.MCP_API_KEY;
}

export const MIN_API_KEY_LENGTH = 32;

/** Startup check: a short key can be guessed, so it is refused rather than used. */
export function assertApiKeyStrength(env: NodeJS.ProcessEnv = process.env): void {
  const key = env.MCP_API_KEY;
  if (key && key.length < MIN_API_KEY_LENGTH) {
    throw new Error(`MCP_API_KEY must be at least ${MIN_API_KEY_LENGTH} characters (generate one with: openssl rand -hex 32)`);
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
