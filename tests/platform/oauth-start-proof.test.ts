import { describe, expect, it } from "vitest";
import { createOAuthStartProof, verifyOAuthStartProof } from "../../src/platform/oauth-start-proof.js";

describe("operator-bound OAuth start form proof", () => {
  const secret = "synthetic-test-only-oauth-secret-123456789";
  it("binds an operator, profile, and five-minute window", () => {
    const now = 1_000_000;
    const proof = createOAuthStartProof(secret, "operator-one", "meta-readonly", now);
    expect(verifyOAuthStartProof(secret, proof, "operator-one", "meta-readonly", now)).toBe(true);
    expect(verifyOAuthStartProof(secret, proof, "operator-two", "meta-readonly", now)).toBe(false);
    expect(verifyOAuthStartProof(secret, proof, "operator-one", "different-profile", now)).toBe(false);
    expect(verifyOAuthStartProof(secret, proof, "operator-one", "meta-readonly", now + 300_000)).toBe(false);
    expect(verifyOAuthStartProof("different-synthetic-test-secret-123456789", proof, "operator-one", "meta-readonly", now)).toBe(false);
  });
  it("rejects modification, malformed inputs, and weak secrets", () => {
    const proof = createOAuthStartProof(secret, "operator-one", "meta-readonly");
    expect(verifyOAuthStartProof(secret, `${proof}x`, "operator-one", "meta-readonly")).toBe(false);
    expect(verifyOAuthStartProof(secret, `${proof}.extra`, "operator-one", "meta-readonly")).toBe(false);
    expect(verifyOAuthStartProof(secret, "a".repeat(513), "operator-one", "meta-readonly")).toBe(false);
    expect(verifyOAuthStartProof("short", proof, "operator-one", "meta-readonly")).toBe(false);
    expect(() => createOAuthStartProof("short", "operator-one", "meta-readonly")).toThrow("OAUTH_START_PROOF_CONFIGURATION_REQUIRED");
  });
});
