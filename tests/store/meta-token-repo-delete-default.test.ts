import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FirestoreMetaTokenRepo,
  InMemoryMetaTokenRepo,
  type MetaTokenRepo,
  type SaveTokenInput,
} from "../../src/store/meta-token-repo.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";
import { ENVS, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({ getFirestore: () => holder.db, isFirestoreEnabled: () => true }));

const USER = "synthetic-delete-user";
const input = (name: string, overrides: Partial<SaveTokenInput> = {}): SaveTokenInput => ({
  fbUserId: USER,
  name,
  accessToken: `synthetic-token-${name}`,
  kind: "system_user",
  expiresAt: null,
  metaUserId: "1",
  metaUserName: "Synthetic",
  ...overrides,
});

let db: FakeFirestore;
beforeEach(() => {
  db = new FakeFirestore();
  holder.db = db;
  useKeyEnv(ENVS.k1Only);
});
afterEach(() => restoreKeyEnv());

const flags = async (repo: MetaTokenRepo) => Object.fromEntries((await repo.listTokens(USER)).map((t) => [t.name, t.isDefault]));

describe.each([
  ["firestore", () => new FirestoreMetaTokenRepo()],
  ["in-memory", () => new InMemoryMetaTokenRepo()],
] as const)("deleting the default token (%s)", (_label, make) => {
  async function seed(repo: MetaTokenRepo, names: string[], defaultName: string): Promise<void> {
    for (const name of names) await repo.saveToken(input(name, { setAsDefault: name === defaultName }));
  }

  it("does not promote an arbitrary survivor when three tokens existed: the set is left defaultless", async () => {
    const repo = make();
    await seed(repo, ["client_acme", "client_zeta", "client_beta"], "client_acme");
    expect(await repo.getDefaultTokenName(USER)).toBe("client_acme");
    expect(await repo.deleteToken(USER, "client_acme")).toBe(true);
    expect(await repo.getDefaultTokenName(USER)).toBeNull();
    expect(await flags(repo)).toEqual({ client_zeta: false, client_beta: false });
    await expect(repo.getDecryptedToken(USER)).rejects.toThrow(/No Meta token registered/);
    expect(await repo.getDecryptedToken(USER, "client_beta")).toBe("synthetic-token-client_beta");
  });

  it("does not promote with four tokens either, whichever is first by name or insertion", async () => {
    const repo = make();
    await seed(repo, ["m", "a", "z", "b"], "m");
    await repo.deleteToken(USER, "m");
    expect(await repo.getDefaultTokenName(USER)).toBeNull();
    expect(Object.values(await flags(repo)).every((flag) => flag === false)).toBe(true);
  });

  it("leaves the single survivor as the read-time default when two tokens existed, without writing it", async () => {
    const repo = make();
    await seed(repo, ["main", "other"], "main");
    expect(await repo.deleteToken(USER, "main")).toBe(true);
    expect(await repo.getDefaultTokenName(USER)).toBe("other");
    expect(await repo.getDecryptedToken(USER)).toBe("synthetic-token-other");
    if (_label === "firestore") expect(db.read(`users/${USER}/meta_tokens/other`)!.isDefault).toBe(false);
  });

  it("writes nothing but the deletion itself (Firestore)", async () => {
    if (_label !== "firestore") return;
    const repo = make();
    await seed(repo, ["a", "b", "c"], "a");
    db.writeLog.length = 0;
    await repo.deleteToken(USER, "a");
    expect(db.writeLog).toEqual([{ path: `users/${USER}/meta_tokens/a`, mode: "delete" }]);
  });

  it("keeps the default when a non-default token is deleted", async () => {
    const repo = make();
    await seed(repo, ["a", "b", "c"], "b");
    expect(await repo.deleteToken(USER, "c")).toBe(true);
    expect(await repo.getDefaultTokenName(USER)).toBe("b");
    expect(await flags(repo)).toEqual({ a: false, b: true });
  });

  it("deleting the only token leaves no default and a later login becomes the default", async () => {
    const repo = make();
    await seed(repo, ["only"], "only");
    await repo.deleteToken(USER, "only");
    expect(await repo.getDefaultTokenName(USER)).toBeNull();
    await repo.saveToken(input("personal"));
    expect(await repo.getDefaultTokenName(USER)).toBe("personal");
  });

  it("an explicit choice after the default was deleted is honoured", async () => {
    const repo = make();
    await seed(repo, ["a", "b", "c"], "a");
    await repo.deleteToken(USER, "a");
    expect(await repo.setDefaultToken(USER, "c")).toBe(true);
    expect(await repo.getDefaultTokenName(USER)).toBe("c");
    expect(await repo.getDecryptedToken(USER)).toBe("synthetic-token-c");
  });

  it("reports a missing token as not found", async () => {
    const repo = make();
    expect(await repo.deleteToken(USER, "missing")).toBe(false);
  });
});
