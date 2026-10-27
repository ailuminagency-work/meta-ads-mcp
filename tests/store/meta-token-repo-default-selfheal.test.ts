import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FirestoreMetaTokenRepo,
  InMemoryMetaTokenRepo,
  type MetaTokenRepo,
  type SaveTokenInput,
} from "../../src/store/meta-token-repo.js";
import { FirestoreMetaTokenRepo as MainRepo } from "../fixtures/crypto/main-251249e/store/meta-token-repo.js";
import { FirestoreMetaTokenRepo as StagingRepo } from "../fixtures/crypto/staging-1f08563/store/meta-token-repo.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";
import { ENVS, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => holder.db,
  isFirestoreEnabled: () => true,
}));

const FB = "synthetic-default-user";
const FAR_FUTURE = () => Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;
const docPath = (name: string) => `users/${FB}/meta_tokens/${name}`;
const input = (name: string, overrides: Partial<SaveTokenInput> = {}): SaveTokenInput => ({
  fbUserId: FB,
  name,
  accessToken: `synthetic-token-${name}`,
  kind: "user",
  expiresAt: FAR_FUTURE(),
  metaUserId: FB,
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

/** Leaves the set exactly as main@251249e and staging@1f08563 do: re-saving the default under its own name clears the flag. */
async function leaveDefaultless(writer: "main" | "staging", names: string[]): Promise<void> {
  const repo = writer === "main" ? new MainRepo() : new StagingRepo();
  for (const name of names) await repo.saveToken(input(name));
  await repo.saveToken(input(names[0], { setAsDefault: false }));
}

const flags = () => Object.fromEntries([...db.docs.keys()].filter((p) => p.includes("/meta_tokens/")).map((p) => [p.split("/").at(-1)!, db.read(p)!.isDefault]));

describe.each([["main@251249e", "main"], ["staging@1f08563", "staging"]] as const)("Firestore: a set left defaultless by %s", (_label, writer) => {
  it("is reproduced by the old writer: a single token with isDefault false", async () => {
    await leaveDefaultless(writer, ["personal"]);
    expect(flags()).toEqual({ personal: false });
  });

  it("resolves the only token as the default at read time, and the resolver agrees with getDefaultTokenName", async () => {
    await leaveDefaultless(writer, ["personal"]);
    const repo = new FirestoreMetaTokenRepo();
    expect(await repo.getDefaultTokenName(FB)).toBe("personal");
    expect(await repo.getDecryptedToken(FB)).toBe("synthetic-token-personal");
    expect((await repo.listTokens(FB)).map((t) => [t.name, t.isDefault])).toEqual([["personal", true]]);
  });

  it("performs no write while resolving: the stored document keeps isDefault false", async () => {
    await leaveDefaultless(writer, ["personal"]);
    const before = structuredClone([...db.docs.entries()]);
    const writes = db.writeLog.length;
    const repo = new FirestoreMetaTokenRepo();
    await repo.getDefaultTokenName(FB);
    await repo.getDecryptedToken(FB);
    await repo.listTokens(FB);
    expect(db.writeLog.length).toBe(writes);
    expect([...db.docs.entries()]).toEqual(before);
    expect(flags()).toEqual({ personal: false });
  });

  it("keeps today's no-default behaviour for two or more tokens and none flagged", async () => {
    await leaveDefaultless(writer, ["a", "b"]);
    expect(flags()).toEqual({ a: false, b: false });
    const repo = new FirestoreMetaTokenRepo();
    expect(await repo.getDefaultTokenName(FB)).toBeNull();
    await expect(repo.getDecryptedToken(FB)).rejects.toThrow(/No Meta token registered/);
    expect((await repo.listTokens(FB)).map((t) => t.isDefault)).toEqual([false, false]);
    expect(await repo.getDecryptedToken(FB, "b")).toBe("synthetic-token-b");
  });

  it("keeps the no-default behaviour for three tokens as well", async () => {
    await leaveDefaultless(writer, ["a", "b", "c"]);
    const repo = new FirestoreMetaTokenRepo();
    expect(await repo.getDefaultTokenName(FB)).toBeNull();
    await expect(repo.getDecryptedToken(FB)).rejects.toThrow(/No Meta token registered/);
  });

  it("keeps the no-default behaviour when the user has no token at all", async () => {
    const repo = new FirestoreMetaTokenRepo();
    expect(await repo.getDefaultTokenName(FB)).toBeNull();
    await expect(repo.getDecryptedToken(FB)).rejects.toThrow(/No Meta token registered/);
  });

  it("deleting one token of a defaultless pair leaves the survivor as the read-time default", async () => {
    await leaveDefaultless(writer, ["a", "b"]);
    const repo = new FirestoreMetaTokenRepo();
    expect(await repo.deleteToken(FB, "a")).toBe(true);
    expect(await repo.getDefaultTokenName(FB)).toBe("b");
    expect(await repo.getDecryptedToken(FB)).toBe("synthetic-token-b");
  });

  it("the next login heals the stored flag with a normal write, whatever the sole token was called", async () => {
    await leaveDefaultless(writer, ["other"]);
    const repo = new FirestoreMetaTokenRepo();
    await repo.saveToken(input("personal", { setAsDefault: !(await repo.getDefaultTokenName(FB)) }));
    expect(Object.values(flags()).filter(Boolean)).toHaveLength(1);
    expect(await repo.getDefaultTokenName(FB)).toBe("personal");

    db.docs.clear();
    await leaveDefaultless(writer, ["personal"]);
    await repo.saveToken(input("personal", { setAsDefault: !(await repo.getDefaultTokenName(FB)) }));
    expect(flags()).toEqual({ personal: true });
  });
});

describe("Firestore: flagged defaults are untouched by the read-time rule", () => {
  it("a flagged default wins, including when it is the only token", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await repo.saveToken(input("only"));
    expect(flags()).toEqual({ only: true });
    expect(await repo.getDefaultTokenName(FB)).toBe("only");

    await repo.saveToken(input("second"));
    await repo.setDefaultToken(FB, "second");
    expect(await repo.getDefaultTokenName(FB)).toBe("second");
    expect(await repo.getDecryptedToken(FB)).toBe("synthetic-token-second");
  });

  it("the resolver always names the same token as getDefaultTokenName", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await repo.saveToken(input("a"));
    await repo.saveToken(input("b"));
    for (const target of ["a", "b"]) {
      await repo.setDefaultToken(FB, target);
      expect(await repo.getDefaultTokenName(FB)).toBe(target);
      expect(await repo.getDecryptedToken(FB)).toBe(`synthetic-token-${target}`);
    }
  });

  it("another user's single token is never borrowed", async () => {
    await leaveDefaultless("main", ["personal"]);
    const repo = new FirestoreMetaTokenRepo();
    expect(await repo.getDefaultTokenName("synthetic-other-user")).toBeNull();
  });
});

describe("InMemoryMetaTokenRepo: the same rule", () => {
  let repo: InMemoryMetaTokenRepo;

  function clearFlags(): void {
    const bucket = (repo as unknown as { tokens: Map<string, Map<string, { isDefault: boolean }>> }).tokens.get(FB)!;
    for (const [name, doc] of bucket) bucket.set(name, { ...doc, isDefault: false });
  }
  const stored = () => structuredClone([...(repo as unknown as { tokens: Map<string, Map<string, unknown>> }).tokens.get(FB)!.entries()]);

  beforeEach(() => { repo = new InMemoryMetaTokenRepo(); });

  it("resolves the only token at read time without changing what is stored", async () => {
    await repo.saveToken(input("personal"));
    clearFlags();
    const before = stored();
    expect(await repo.getDefaultTokenName(FB)).toBe("personal");
    expect(await repo.getDecryptedToken(FB)).toBe("synthetic-token-personal");
    expect((await repo.listTokens(FB)).map((t) => [t.name, t.isDefault])).toEqual([["personal", true]]);
    expect(stored()).toEqual(before);
  });

  it("stays unresolved for two or more tokens and none flagged", async () => {
    await repo.saveToken(input("a"));
    await repo.saveToken(input("b"));
    clearFlags();
    expect(await repo.getDefaultTokenName(FB)).toBeNull();
    await expect(repo.getDecryptedToken(FB)).rejects.toThrow(/No Meta token registered/);
    expect((await repo.listTokens(FB)).map((t) => t.isDefault)).toEqual([false, false]);
  });

  it("stays unresolved with no token at all", async () => {
    expect(await repo.getDefaultTokenName(FB)).toBeNull();
    await expect(repo.getDecryptedToken(FB)).rejects.toThrow(/No Meta token registered/);
  });

  it("the next login heals the stored flag, whatever the sole token was called", async () => {
    await repo.saveToken(input("other"));
    clearFlags();
    await repo.saveToken(input("personal", { setAsDefault: !(await repo.getDefaultTokenName(FB)) }));
    const listed = await repo.listTokens(FB);
    expect(listed.filter((t) => t.isDefault).map((t) => t.name)).toEqual(["personal"]);
    expect(await repo.getDefaultTokenName(FB)).toBe("personal");
  });

  it("getDefaultTokenName, listTokens and the resolver agree in both repositories", async () => {
    const repos: Array<[string, () => Promise<MetaTokenRepo>]> = [
      ["in-memory", async () => { const r = new InMemoryMetaTokenRepo(); await r.saveToken(input("x")); return r; }],
      ["firestore", async () => { const r = new FirestoreMetaTokenRepo(); await r.saveToken(input("x")); return r; }],
    ];
    for (const [, make] of repos) {
      const r = await make();
      const name = await r.getDefaultTokenName(FB);
      expect(name).toBe("x");
      expect((await r.listTokens(FB)).filter((t) => t.isDefault).map((t) => t.name)).toEqual([name]);
      expect(await r.getDecryptedToken(FB)).toBe(`synthetic-token-${name}`);
    }
  });
});
