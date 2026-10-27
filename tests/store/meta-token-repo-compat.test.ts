import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTokenKeyMigration } from "../../src/auth/token-key-migration.js";
import type { EncryptionKeyring } from "../../src/auth/keyring.js";
import { FirestoreApifyTokenRepo } from "../../src/store/apify-token-repo.js";
import { FirestoreGeminiKeyRepo } from "../../src/store/gemini-key-repo.js";
import { FirestoreMetaTokenRepo as LineRepo } from "../../src/store/meta-token-repo.js";
import { FirestoreMetaTokenRepo as MainRepo } from "../fixtures/crypto/main-251249e/store/meta-token-repo.js";
import { FirestoreMetaTokenRepo as StagingRepo } from "../fixtures/crypto/staging-1f08563/store/meta-token-repo.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";
import {
  ENVS,
  impls,
  K1,
  K2,
  MAIN_GCM_AUTH_ERROR,
  restoreKeyEnv,
  useKeyEnv,
  type KeyEnv,
} from "../fixtures/crypto/compat-harness.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
const oauth = vi.hoisted(() => ({ exchange: vi.fn(), config: vi.fn() }));

vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => holder.db,
  isFirestoreEnabled: () => true,
}));
vi.mock("../../src/auth/meta-oauth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/meta-oauth.js")>()),
  exchangeForLongLivedToken: oauth.exchange,
  loadMetaOAuthConfig: oauth.config,
}));

interface Repo {
  saveToken(input: Parameters<LineRepo["saveToken"]>[0]): Promise<void>;
  getDecryptedToken(fbUserId: string, name?: string, serverUrl?: URL): Promise<string>;
}

const FB = "synthetic-user-1";
const FAR_FUTURE = () => Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;
let db: FakeFirestore;

function repos(): Record<"main" | "staging" | "line", Repo> {
  return { main: new MainRepo(), staging: new StagingRepo(), line: new LineRepo() };
}

async function save(who: "main" | "staging" | "line", env: KeyEnv, name: string, token: string, expiresAt = FAR_FUTURE()): Promise<void> {
  useKeyEnv(env);
  await repos()[who].saveToken({
    fbUserId: FB, name, accessToken: token, kind: "user", expiresAt,
    metaUserId: FB, metaUserName: "Synthetic", setAsDefault: true,
  });
}

async function read(who: "main" | "staging" | "line", env: KeyEnv, name?: string): Promise<string> {
  useKeyEnv(env);
  return repos()[who].getDecryptedToken(FB, name);
}

const docPath = (name: string) => `users/${FB}/meta_tokens/${name}`;

const keyring = (activeKeyId: string): EncryptionKeyring => ({ activeKeyId, keys: new Map([["primary", K1], ["next", K2]]) });

beforeEach(() => {
  db = new FakeFirestore();
  holder.db = db;
  oauth.exchange.mockReset();
  oauth.config.mockReset();
  oauth.config.mockReturnValue(null);
});
afterEach(() => restoreKeyEnv());

describe.each([["release-line", "line"], ["staging@1f08563", "staging"]] as const)("%s writer/reader against main@251249e at the stored-document level", (_label, who) => {
  it("reads a main-written document (no keyVersion) under every keyring that contains the old key", async () => {
    await save("main", ENVS.k1Only, "personal", "synthetic-main-token");
    for (const env of [ENVS.k1Only, ENVS.k1PlusNext, ENVS.jsonActiveNext, ENVS.jsonActivePrimary]) {
      expect(await read(who, env, "personal")).toBe("synthetic-main-token");
    }
    expect(db.writeLog.filter((entry) => entry.mode !== "set")).toEqual([]);
    expect(db.writeLog).toHaveLength(1);
  });

  it("is read by main when the writer stayed on the unrotated key", async () => {
    await save(who, ENVS.k1Only, "personal", "synthetic-line-token");
    expect((await db.read(docPath("personal")))!.keyVersion).toBe("primary");
    expect(await read("main", ENVS.k1Only, "personal")).toBe("synthetic-line-token");
  });

  it("INCIDENT REPRODUCTION: a document written under the NEXT key fails on main with the production error text, and one re-login repairs it", async () => {
    await save(who, ENVS.k1PlusNext, "personal", "synthetic-token-under-next");
    const stored = db.read(docPath("personal"))!;
    expect(stored.keyVersion).toBe("next");
    expect((stored.encryptedToken as { keyVersion?: string }).keyVersion).toBe("next");

    await expect(read("main", ENVS.k1Only, "personal")).rejects.toThrow(MAIN_GCM_AUTH_ERROR);
    await expect(read("main", ENVS.k1Only)).rejects.toThrow(MAIN_GCM_AUTH_ERROR);

    await save("main", ENVS.k1Only, "personal", "synthetic-token-after-relogin");
    expect(await read("main", ENVS.k1Only)).toBe("synthetic-token-after-relogin");
    expect(await read(who, ENVS.k1PlusNext)).toBe("synthetic-token-after-relogin");
    expect(db.read(docPath("personal"))!.keyVersion).toBeUndefined();
  });

  it("rollback to main with the NEXT key supplied as TOKEN_ENCRYPTION_KEY reads the next-key document", async () => {
    await save(who, ENVS.k1PlusNext, "personal", "synthetic-token-under-next");
    expect(await read("main", ENVS.k2Only, "personal")).toBe("synthetic-token-under-next");
    await save("main", ENVS.k2Only, "other", "synthetic-main-written-under-k2");
    expect(await read(who, ENVS.k1PlusNext, "other")).toBe("synthetic-main-written-under-k2");
  });

  it("a mixed corpus cannot be read by main under either single key, and the reverse migration (active=primary) repairs it without re-login", async () => {
    await save(who, ENVS.k1Only, "old-primary", "synthetic-token-a");
    await save(who, ENVS.k1PlusNext, "new-next", "synthetic-token-b");

    await expect(read("main", ENVS.k1Only, "new-next")).rejects.toThrow(MAIN_GCM_AUTH_ERROR);
    await expect(read("main", ENVS.k2Only, "old-primary")).rejects.toThrow(MAIN_GCM_AUTH_ERROR);

    const report = await runTokenKeyMigration({
      db: db as never, keyring: keyring("primary"), dryRun: false, operationId: "reverse-to-primary",
    });
    expect(report).toMatchObject({ failed: 0, rotated: 1, alreadyCurrent: 1 });

    expect(await read("main", ENVS.k1Only, "old-primary")).toBe("synthetic-token-a");
    expect(await read("main", ENVS.k1Only, "new-next")).toBe("synthetic-token-b");
    expect(await read(who, ENVS.k1PlusNext, "new-next")).toBe("synthetic-token-b");
    expect(db.read(docPath("new-next"))!.keyMigration).toMatchObject({ operationId: "reverse-to-primary", fromKeyVersion: "next" });
  });

  it("a failed forward migration leaves the corpus readable by the keyring-aware line and detectably unreadable by main", async () => {
    await save("main", ENVS.k1Only, "good", "synthetic-token-good");
    db.seed(docPath("bad"), { encryptedToken: { ciphertext: "bad", iv: "bad", tag: "bad" }, kind: "user" });
    const report = await runTokenKeyMigration({
      db: db as never, keyring: keyring("next"), dryRun: false, operationId: "forward-partial", maxFailures: 1,
    });
    expect(report.failed).toBeGreaterThan(0);
    expect(db.read("_lumin_migrations/token_encryption/operations/forward-partial")!.status).toBe("failed");
    expect(db.read(docPath("good"))!.keyVersion).toBe("next");
    expect(db.read(docPath("bad"))!.keyVersion).toBeUndefined();
    await expect(read("main", ENVS.k1Only, "good")).rejects.toThrow(MAIN_GCM_AUTH_ERROR);
    expect(await read(who, ENVS.k1PlusNext, "good")).toBe("synthetic-token-good");
  });

  it("a token refresh performed by main on a line-written document keeps it migratable and readable by the line", async () => {
    const soon = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
    await save(who, ENVS.k1Only, "personal", "synthetic-before-refresh", soon);
    oauth.config.mockReturnValue({ appId: "synthetic-app", appSecret: "synthetic-secret" });
    oauth.exchange.mockResolvedValue({ accessToken: "synthetic-after-refresh", expiresAt: FAR_FUTURE() });
    useKeyEnv(ENVS.k1Only);
    expect(await new MainRepo().getDecryptedToken(FB, "personal", new URL("https://example.invalid"))).toBe("synthetic-after-refresh");

    const stored = db.read(docPath("personal"))!;
    expect((stored.encryptedToken as { keyVersion?: string }).keyVersion).toBeUndefined();
    expect(stored.keyVersion).toBe("primary");
    expect(await read(who, ENVS.k1PlusNext, "personal")).toBe("synthetic-after-refresh");

    const dry = await runTokenKeyMigration({ db: db as never, keyring: keyring("next"), dryRun: true });
    expect(dry).toMatchObject({ failed: 0, candidates: 1 });
  });
});

describe("apify and gemini collections written by main are read by the release line, and the reverse", () => {
  it("round-trips AAD-bound documents without any change to the stored layout", async () => {
    useKeyEnv(ENVS.k1Only);
    const apifyAad = `apify_token:${FB}:default`;
    const geminiAad = `gemini_key:${FB}:default`;
    db.seed(`users/${FB}/apify_tokens/default`, { encryptedToken: impls.main.encrypt("synthetic-apify", apifyAad), apifyUserId: null, apifyUsername: null, createdAt: 1, updatedAt: 1 });
    db.seed(`users/${FB}/gemini_keys/default`, { encryptedKey: impls.main.encrypt("synthetic-gemini", geminiAad), keyHash: "x", createdAt: 1, updatedAt: 1 });

    expect(await new FirestoreApifyTokenRepo(db as never).getDecryptedToken(FB)).toBe("synthetic-apify");
    expect(await new FirestoreGeminiKeyRepo(db as never).getDecryptedKey(FB)).toBe("synthetic-gemini");

    await new FirestoreApifyTokenRepo(db as never).saveToken(FB, "synthetic-apify-2", null);
    await new FirestoreGeminiKeyRepo(db as never).saveKey(FB, "synthetic-gemini-2");
    const apify = db.read(`users/${FB}/apify_tokens/default`)!.encryptedToken as never;
    const gemini = db.read(`users/${FB}/gemini_keys/default`)!.encryptedKey as never;
    expect(impls.main.decrypt(apify, apifyAad)).toBe("synthetic-apify-2");
    expect(impls.main.decrypt(gemini, geminiAad)).toBe("synthetic-gemini-2");
  });

  it("a document written under the next key by the line is unreadable by main for both collections", async () => {
    useKeyEnv(ENVS.k1PlusNext);
    await new FirestoreApifyTokenRepo(db as never).saveToken(FB, "synthetic-apify-3", null);
    await new FirestoreGeminiKeyRepo(db as never).saveKey(FB, "synthetic-gemini-3");
    useKeyEnv(ENVS.k1Only);
    expect(() => impls.main.decrypt(db.read(`users/${FB}/apify_tokens/default`)!.encryptedToken as never, `apify_token:${FB}:default`)).toThrow(MAIN_GCM_AUTH_ERROR);
    expect(() => impls.main.decrypt(db.read(`users/${FB}/gemini_keys/default`)!.encryptedKey as never, `gemini_key:${FB}:default`)).toThrow(MAIN_GCM_AUTH_ERROR);
  });
});

describe("staging@1f08563 default-token defect and what the release line can still read", () => {
  it("a document re-saved by 1f08563 loses its default flag but stays readable by name, losing no ciphertext", async () => {
    useKeyEnv(ENVS.k1Only);
    const staging = new StagingRepo();
    const input = { fbUserId: FB, name: "personal", accessToken: "synthetic-token", kind: "user" as const, expiresAt: FAR_FUTURE(), metaUserId: FB, metaUserName: "Synthetic" };
    await staging.saveToken(input);
    await staging.saveToken({ ...input, setAsDefault: false });
    expect(db.read(docPath("personal"))!.isDefault).toBe(false);
    expect(await new LineRepo().getDefaultTokenName(FB)).toBeNull();
    expect(await new LineRepo().getDecryptedToken(FB, "personal")).toBe("synthetic-token");
  });
});
