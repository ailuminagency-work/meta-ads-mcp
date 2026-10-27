import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetKeyCacheForTests } from "../../src/auth/crypto.js";
import { createFirestoreDouble, type FirestoreDouble } from "./firestore-double.js";

const selected = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({
  getFirestore: () => selected.db,
  isFirestoreEnabled: () => true,
}));

import {
  FirestoreMetaTokenRepo,
  InMemoryMetaTokenRepo,
  type MetaTokenRepo,
  type SaveTokenInput,
} from "../../src/store/meta-token-repo.js";

const OPERATOR = "100000000000001";
const TOKEN_PATH = (name: string) => `users/${OPERATOR}/meta_tokens/${name}`;

function save(overrides: Partial<SaveTokenInput> = {}): SaveTokenInput {
  return {
    fbUserId: OPERATOR,
    name: "personal",
    accessToken: "synthetic-login-token-1",
    kind: "user",
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
    metaUserId: OPERATOR,
    metaUserName: "Synthetic Operator",
    ...overrides,
  };
}

/** Mirrors what the Meta callback does: the first login makes the token default, later ones keep the existing default. */
async function login(repo: MetaTokenRepo, accessToken: string): Promise<void> {
  await repo.saveToken(
    save({ accessToken, setAsDefault: !(await repo.getDefaultTokenName(OPERATOR)) }),
  );
}

let double: FirestoreDouble;

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "cd".repeat(32));
  vi.stubEnv("META_APP_ID", "100000000000099");
  vi.stubEnv("META_APP_SECRET", "synthetic-app-secret-value");
  resetKeyCacheForTests();
  double = createFirestoreDouble();
  selected.db = double.db;
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetKeyCacheForTests();
});

describe("FirestoreMetaTokenRepo default token across logins", () => {
  it("keeps the default token after a second login", async () => {
    const repo = new FirestoreMetaTokenRepo();

    await login(repo, "synthetic-login-token-1");
    expect(await repo.getDefaultTokenName(OPERATOR)).toBe("personal");
    expect(double.data.get(TOKEN_PATH("personal"))?.isDefault).toBe(true);

    await login(repo, "synthetic-login-token-2");

    expect(await repo.getDefaultTokenName(OPERATOR)).toBe("personal");
    expect(double.data.get(TOKEN_PATH("personal"))?.isDefault).toBe(true);
    expect((await repo.listTokens(OPERATOR)).filter((t) => t.isDefault)).toHaveLength(1);
  });

  it("serves the refreshed token from the default slot after the second login", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await login(repo, "synthetic-login-token-1");
    await login(repo, "synthetic-login-token-2");

    await expect(repo.getDecryptedToken(OPERATOR)).resolves.toBe("synthetic-login-token-2");
  });

  it("keeps working through any number of further logins", async () => {
    const repo = new FirestoreMetaTokenRepo();
    for (let attempt = 1; attempt <= 4; attempt++) await login(repo, `synthetic-login-token-${attempt}`);
    expect(await repo.getDefaultTokenName(OPERATOR)).toBe("personal");
    await expect(repo.getDecryptedToken(OPERATOR)).resolves.toBe("synthetic-login-token-4");
  });

  it("does not take the default away from a system user token the operator chose", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await login(repo, "synthetic-login-token-1");
    await repo.saveToken(
      save({
        name: "agency_system",
        kind: "system_user",
        expiresAt: null,
        accessToken: "synthetic-system-token",
        setAsDefault: true,
      }),
    );
    expect(await repo.getDefaultTokenName(OPERATOR)).toBe("agency_system");

    await login(repo, "synthetic-login-token-2");

    expect(await repo.getDefaultTokenName(OPERATOR)).toBe("agency_system");
    expect(double.data.get(TOKEN_PATH("personal"))?.isDefault).toBe(false);
    expect(double.data.get(TOKEN_PATH("agency_system"))?.isDefault).toBe(true);
  });

  it("moves the default when the caller asks for it and leaves exactly one default", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await login(repo, "synthetic-login-token-1");
    await repo.saveToken(save({ name: "second", accessToken: "synthetic-second-token", setAsDefault: true }));

    expect(await repo.getDefaultTokenName(OPERATOR)).toBe("second");
    expect((await repo.listTokens(OPERATOR)).filter((t) => t.isDefault).map((t) => t.name)).toEqual(["second"]);
  });

  it("promotes a remaining token when the default is deleted", async () => {
    const repo = new FirestoreMetaTokenRepo();
    await login(repo, "synthetic-login-token-1");
    await repo.saveToken(save({ name: "other", accessToken: "synthetic-other-token" }));

    expect(await repo.deleteToken(OPERATOR, "personal")).toBe(true);
    expect(await repo.getDefaultTokenName(OPERATOR)).toBe("other");
  });

  it("behaves the same without the privacy-lock transaction when META_APP_ID is unset", async () => {
    vi.stubEnv("META_APP_ID", "");
    const repo = new FirestoreMetaTokenRepo();
    await login(repo, "synthetic-login-token-1");
    await login(repo, "synthetic-login-token-2");
    expect(await repo.getDefaultTokenName(OPERATOR)).toBe("personal");
  });

  it("agrees with the in-memory repo over a mixed sequence of logins and selections", async () => {
    const firestore = new FirestoreMetaTokenRepo();
    const memory = new InMemoryMetaTokenRepo();
    for (const repo of [firestore, memory]) {
      await login(repo, "synthetic-login-token-1");
      await repo.saveToken(save({ name: "second", accessToken: "synthetic-second-token" }));
      await repo.setDefaultToken(OPERATOR, "second");
      await login(repo, "synthetic-login-token-2");
    }
    const summarize = async (repo: MetaTokenRepo) =>
      (await repo.listTokens(OPERATOR)).map((t) => [t.name, t.isDefault]).sort();
    expect(await summarize(firestore)).toEqual(await summarize(memory));
    expect(await firestore.getDefaultTokenName(OPERATOR)).toBe("second");
  });
});
