import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FirestoreMetaTokenRepo,
  InMemoryMetaTokenRepo,
  InvalidTokenNameError,
  isValidTokenName,
  type MetaTokenRepo,
  type SaveTokenInput,
} from "../../src/store/meta-token-repo.js";
import { FakeCollection, FakeFirestore } from "../fixtures/crypto/fake-firestore.js";
import { ENVS, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({ getFirestore: () => holder.db, isFirestoreEnabled: () => true }));

const ATTACKER = "synthetic-attacker-user";
const VICTIM = "synthetic-victim-user";
const input = (name: string, fbUserId = ATTACKER, overrides: Partial<SaveTokenInput> = {}): SaveTokenInput => ({
  fbUserId,
  name,
  accessToken: `synthetic-token-${fbUserId}`,
  kind: "system_user",
  expiresAt: null,
  metaUserId: "1",
  metaUserName: "Synthetic",
  ...overrides,
});

const HOSTILE = [
  `../../${VICTIM}/meta_tokens/personal`,
  "a/b",
  "a/b/c/d",
  "..",
  ".",
  "a.b",
  "my token",
  " personal",
  "personal ",
  "personal\n",
  "per\u0000sonal",
  "per‮sonal",
  "a:b",
  "a%2Fb",
  "x".repeat(65),
  "",
  "__x__",
  "personal/../x",
];
const HOSTILE_OK_PATTERN = new Set(["__x__"]);

let db: FakeFirestore;
beforeEach(() => {
  db = new FakeFirestore();
  holder.db = db;
  useKeyEnv(ENVS.k1Only);
});
afterEach(() => {
  restoreKeyEnv();
  vi.restoreAllMocks();
});

describe("token name format", () => {
  it.each(["personal", "client_acme", "client-beta", "A1", "byads", "no-bm", "x".repeat(64), "_", "-", "0"])("accepts %s", (name) => {
    expect(isValidTokenName(name)).toBe(true);
  });

  it.each(HOSTILE.filter((name) => !HOSTILE_OK_PATTERN.has(name)))("rejects %j", (name) => {
    expect(isValidTokenName(name)).toBe(false);
  });

  it.each([undefined, null, 5, {}, [], ["personal"], Symbol.iterator])("rejects the non-string %s", (value) => {
    expect(isValidTokenName(value)).toBe(false);
  });
});

describe.each([
  ["firestore", () => new FirestoreMetaTokenRepo()],
  ["in-memory", () => new InMemoryMetaTokenRepo()],
] as const)("%s repository refuses hostile token names before touching storage", (label, make) => {
  const cases = HOSTILE.filter((name) => !HOSTILE_OK_PATTERN.has(name));

  it.each(cases)("saveToken %j", async (name) => {
    const repo = make();
    await expect(repo.saveToken(input(name))).rejects.toBeInstanceOf(InvalidTokenNameError);
    await expect(repo.saveToken(input(name, ATTACKER, { setAsDefault: true }))).rejects.toBeInstanceOf(InvalidTokenNameError);
    expect(db.writeLog).toEqual([]);
    expect(db.docs.size).toBe(0);
  });

  it.each(cases)("setDefaultToken %j", async (name) => {
    const repo = make();
    await expect(repo.setDefaultToken(ATTACKER, name)).rejects.toBeInstanceOf(InvalidTokenNameError);
    expect(db.writeLog).toEqual([]);
  });

  it.each(cases)("deleteToken %j", async (name) => {
    const repo = make();
    await expect(repo.deleteToken(ATTACKER, name)).rejects.toBeInstanceOf(InvalidTokenNameError);
    expect(db.writeLog).toEqual([]);
  });

  it.each(cases)("getDecryptedToken %j", async (name) => {
    const repo = make();
    await expect(repo.getDecryptedToken(ATTACKER, name)).rejects.toBeInstanceOf(InvalidTokenNameError);
  });

  it("the error names no input", async () => {
    const repo = make();
    const error = await repo.deleteToken(ATTACKER, `../../${VICTIM}/x`).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(VICTIM);
    expect((error as Error).message).toBe("Invalid token name: use 1-64 characters from a-z, A-Z, 0-9, _ and -.");
  });

  it("still saves, selects, reads and deletes ordinary names", async () => {
    const repo = make();
    for (const name of ["personal", "client_acme", "client-beta"]) await repo.saveToken(input(name));
    expect(await repo.setDefaultToken(ATTACKER, "client-beta")).toBe(true);
    expect(await repo.getDecryptedToken(ATTACKER, "client_acme")).toBe(`synthetic-token-${ATTACKER}`);
    expect(await repo.getDecryptedToken(ATTACKER)).toBe(`synthetic-token-${ATTACKER}`);
    expect(await repo.deleteToken(ATTACKER, "client_acme")).toBe(true);
    expect(await repo.deleteToken(ATTACKER, "client_acme")).toBe(false);
    expect((await repo.listTokens(ATTACKER)).map((t) => t.name).sort()).toEqual(["client-beta", "personal"]);
    void label;
  });
});

describe("a backend that resolves .. segments cannot be steered into another user's tokens", () => {
  async function seedVictim(repo: MetaTokenRepo): Promise<void> {
    await repo.saveToken(input("personal", VICTIM, { accessToken: "synthetic-victim-secret", setAsDefault: true }));
    await repo.saveToken(input("second", VICTIM));
  }
  const victimDocs = () => [...db.docs.keys()].filter((path) => path.startsWith(`users/${VICTIM}/meta_tokens/`)).sort();

  beforeEach(() => {
    const original = FakeCollection.prototype.doc;
    vi.spyOn(FakeCollection.prototype, "doc").mockImplementation(function (this: FakeCollection, id: string) {
      const ref = original.call(this, id);
      const normalized = ref.path.split("/").reduce<string[]>((parts, part) => {
        if (part === "..") parts.pop();
        else parts.push(part);
        return parts;
      }, []).join("/");
      return Object.defineProperty(ref, "path", { value: normalized });
    });
  });

  it("deleteToken cannot delete the victim's record through a traversal name", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await seedVictim(repo);
    await expect(repo.deleteToken(ATTACKER, `../../${VICTIM}/meta_tokens/personal`)).rejects.toBeInstanceOf(InvalidTokenNameError);
    expect(victimDocs()).toEqual([`users/${VICTIM}/meta_tokens/personal`, `users/${VICTIM}/meta_tokens/second`]);
  });

  it("setDefaultToken cannot flip the victim's default through a traversal name", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await seedVictim(repo);
    await expect(repo.setDefaultToken(ATTACKER, `../../${VICTIM}/meta_tokens/second`)).rejects.toBeInstanceOf(InvalidTokenNameError);
    expect(await repo.getDefaultTokenName(VICTIM)).toBe("personal");
  });

  it("saveToken cannot overwrite the victim's record through a traversal name", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await seedVictim(repo);
    await expect(repo.saveToken(input(`../../${VICTIM}/meta_tokens/personal`, ATTACKER, { setAsDefault: true }))).rejects.toBeInstanceOf(InvalidTokenNameError);
    expect(await repo.getDecryptedToken(VICTIM)).toBe("synthetic-victim-secret");
  });
});
