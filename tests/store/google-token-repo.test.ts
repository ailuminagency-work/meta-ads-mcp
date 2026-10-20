import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCacheForTests } from "../../src/auth/crypto.js";
import { InMemoryGoogleTokenRepo } from "../../src/store/google-token-repo.js";

const grant = {
  userId: "tenant-a",
  tokens: { accessToken: "access-secret", refreshToken: "refresh-secret", expiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["https://www.googleapis.com/auth/adwords"] },
  googleSubject: "google-sub",
  email: "a@example.com",
  customerIds: ["1234567890"],
};

describe("InMemoryGoogleTokenRepo", () => {
  beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(64); resetKeyCacheForTests(); });
  afterEach(() => { delete process.env.TOKEN_ENCRYPTION_KEY; resetKeyCacheForTests(); });

  it("stores an encrypted grant and returns only non-secret metadata", async () => {
    const repo = new InMemoryGoogleTokenRepo();
    await repo.saveGrant(grant);
    const raw = await repo.getGrant("tenant-a");
    expect(JSON.stringify(raw)).not.toContain("refresh-secret");
    expect(await repo.getSummary("tenant-a")).toMatchObject({ connected: true, googleSubject: "google-sub", customerIds: ["1234567890"] });
  });

  it("enforces granted scopes and refreshes only when expired", async () => {
    const repo = new InMemoryGoogleTokenRepo();
    await repo.saveGrant(grant);
    await expect(repo.getAccessToken("tenant-a", "https://www.googleapis.com/auth/analytics.readonly", async () => { throw new Error("should not refresh"); })).rejects.toThrow(/scope/);
    expect(await repo.getAccessToken("tenant-a", "https://www.googleapis.com/auth/adwords", async () => { throw new Error("should not refresh"); })).toBe("access-secret");
    await repo.saveGrant({ ...grant, tokens: { ...grant.tokens, expiresAt: Math.floor(Date.now() / 1000) - 1, refreshToken: null } });
    await expect(repo.getAccessToken("tenant-a", "https://www.googleapis.com/auth/adwords", async () => ({ accessToken: "rotated", refreshToken: null, expiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: grant.tokens.scopes }))).resolves.toBe("rotated");
  });

  it("does not allow a reconnect without a refresh token for a new tenant", async () => {
    const repo = new InMemoryGoogleTokenRepo();
    await expect(repo.saveGrant({ ...grant, tokens: { ...grant.tokens, refreshToken: null } })).rejects.toThrow(/refresh token/);
  });
});
