import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const lifetimeMs = 5 * 60 * 1000;
const operatorPattern = /^[A-Za-z0-9_-]{1,128}$/;
const profilePattern = /^[A-Za-z0-9_-]{1,128}$/;

function signature(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update("lumin-platform-oauth-start-v1\n").update(payload).digest();
}

export function createOAuthStartProof(secret: string, operatorId: string, profileId: string, now = Date.now()): string {
  if (secret.length < 32 || !operatorPattern.test(operatorId) || !profilePattern.test(profileId)) throw new Error("OAUTH_START_PROOF_CONFIGURATION_REQUIRED");
  const payload = Buffer.from(JSON.stringify({ operatorId, profileId, expiresAt: now + lifetimeMs, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${signature(secret, payload).toString("base64url")}`;
}

export function verifyOAuthStartProof(secret: string, proof: unknown, operatorId: string, profileId: string, now = Date.now()): boolean {
  if (secret.length < 32 || typeof proof !== "string" || proof.length > 512 || !operatorPattern.test(operatorId) || !profilePattern.test(profileId)) return false;
  const parts = proof.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return false;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(secret, parts[0]);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    const value: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const parsed = value as Record<string, unknown>;
    return Object.keys(parsed).length === 4 && parsed.operatorId === operatorId && parsed.profileId === profileId &&
      typeof parsed.nonce === "string" && /^[a-f0-9]{32}$/.test(parsed.nonce) &&
      typeof parsed.expiresAt === "number" && Number.isSafeInteger(parsed.expiresAt) && parsed.expiresAt > now && parsed.expiresAt <= now + lifetimeMs;
  } catch { return false; }
}
