import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPii } from "../../src/auth/token-store.js";
import { resetKeyCacheForTests } from "../../src/auth/crypto.js";
import { getCloneBundleStore, resetCloneBundleStoreForTests, STALE_IN_PROGRESS_MS } from "../../src/store/clone-bundle-store.js";
import { FirestoreMetaTokenRepo, InMemoryMetaTokenRepo } from "../../src/store/meta-token-repo.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
const holder = vi.hoisted(() => ({ db: undefined as unknown }));
const oauth = vi.hoisted(() => ({ exchange: vi.fn(), config: vi.fn() }));

vi.mock("../../src/utils/logger.js", () => ({ logger: log }));
vi.mock("../../src/store/firestore.js", () => ({ getFirestore: () => holder.db, isFirestoreEnabled: () => true }));
vi.mock("../../src/auth/meta-oauth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/meta-oauth.js")>()),
  exchangeForLongLivedToken: oauth.exchange,
  loadMetaOAuthConfig: oauth.config,
}));

const RAW_ID = "synthetic-fb-user-98765";
const RAW_EMAIL = "synthetic.person@example.invalid";
const soon = () => Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;
const input = (overrides: Record<string, unknown> = {}) => ({
  fbUserId: RAW_ID, name: "personal", accessToken: "synthetic-token", kind: "user" as const,
  expiresAt: soon(), metaUserId: RAW_ID, metaUserName: "Synthetic", ...overrides,
});
const everything = (): string => JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls, log.debug.mock.calls]);

beforeEach(() => {
  holder.db = new FakeFirestore();
  for (const fn of [log.info, log.warn, log.error, log.debug, oauth.exchange, oauth.config]) fn.mockReset();
  process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
  resetKeyCacheForTests();
});
afterEach(() => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  resetKeyCacheForTests();
  resetCloneBundleStoreForTests();
});

describe.each([["in-memory", () => new InMemoryMetaTokenRepo()], ["firestore", () => new FirestoreMetaTokenRepo()]] as const)("%s Meta token repository log and error hygiene", (_name, make) => {
  it("logs only the hashed Facebook user id when refresh is not configured", async () => {
    const repo = make();
    await repo.saveToken(input());
    oauth.config.mockReturnValue(null);
    await repo.getDecryptedToken(RAW_ID, "personal", new URL("https://example.invalid"));
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatchObject({ fbUserId: hashPii(RAW_ID) });
    expect(everything()).not.toContain(RAW_ID);
  });

  it("logs only the hashed id on refresh success and on both refresh failure branches", async () => {
    const repo = make();
    oauth.config.mockReturnValue({ appId: "synthetic-app", appSecret: "synthetic-secret" });

    await repo.saveToken(input());
    oauth.exchange.mockResolvedValueOnce({ accessToken: "synthetic-refreshed", expiresAt: soon() + 86400 * 50 });
    await repo.getDecryptedToken(RAW_ID, "personal", new URL("https://example.invalid"));

    await repo.saveToken(input({ name: "second" }));
    oauth.exchange.mockRejectedValueOnce(new Error("provider unavailable"));
    await repo.getDecryptedToken(RAW_ID, "second", new URL("https://example.invalid"));

    await repo.saveToken(input({ name: "expired", expiresAt: Math.floor(Date.now() / 1000) - 10 }));
    oauth.exchange.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(repo.getDecryptedToken(RAW_ID, "expired", new URL("https://example.invalid"))).rejects.toThrow(/expired and refresh failed/);

    expect(log.info).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(2);
    for (const call of [...log.info.mock.calls, ...log.warn.mock.calls]) {
      expect(call[0]).toMatchObject({ fbUserId: hashPii(RAW_ID) });
    }
    expect(everything()).not.toContain(RAW_ID);
  });

  it("keeps the diagnostic phrases but never the raw id in the lookup errors that callers log", async () => {
    const repo = make();
    const none = await repo.getDecryptedToken(RAW_ID).catch((error: Error) => error);
    expect((none as Error).message).toMatch(/No Meta token registered/);
    expect((none as Error).message).not.toContain(RAW_ID);
    expect((none as Error).message).toContain(hashPii(RAW_ID)!);
    const missing = await repo.getDecryptedToken(RAW_ID, "absent").catch((error: Error) => error);
    expect((missing as Error).message).toMatch(/not found for user/);
    expect((missing as Error).message).not.toContain(RAW_ID);
  });
});

describe("clone bundle store log hygiene", () => {
  it("logs a hashed idempotency key when it reclaims a stale lock", async () => {
    vi.stubEnv("FIRESTORE_PROJECT_ID", "synthetic-project");
    const store = getCloneBundleStore();
    const key = `idem-${RAW_EMAIL}:act_1:2:name`;
    await store.claim(key, "sig");
    const db = holder.db as FakeFirestore;
    const path = `clone_bundle_operations/${encodeURIComponent(key)}`;
    db.seed(path, { ...db.read(path)!, startedAt: Date.now() - STALE_IN_PROGRESS_MS - 1000 });
    expect((await store.claim(key, "sig")).status).toBe("claimed");
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatchObject({ cacheKey: hashPii(key) });
    expect(everything()).not.toContain(RAW_EMAIL);
    vi.unstubAllEnvs();
  });
});
