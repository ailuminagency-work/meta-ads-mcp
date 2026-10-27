import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FirestoreMetaTokenRepo,
  InMemoryMetaTokenRepo,
  legacyNoAadDecryptAllowed,
  logLegacyNoAadPolicyAtStartup,
  resetLegacyNoAadLogForTests,
  type MetaTokenRepo,
} from "../../src/store/meta-token-repo.js";
import { logger } from "../../src/utils/logger.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";
import { ENVS, impls, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", () => ({ getFirestore: () => holder.db, isFirestoreEnabled: () => true }));

const A = "100000000000001";
const B = "100000000000002";
const FLAG = "TOKEN_DECRYPT_ALLOW_LEGACY_NO_AAD";
const metadata = (isDefault = true) => ({ kind: "system_user", expiresAt: null, scopes: [], metaUserId: "1", metaUserName: "n", businessId: null, businessName: null, isDefault, createdAt: 1, updatedAt: 1 });

let db: FakeFirestore;
beforeEach(() => {
  db = new FakeFirestore();
  holder.db = db;
  useKeyEnv(ENVS.k1Only);
  vi.stubEnv(FLAG, undefined as unknown as string);
  delete process.env[FLAG];
  resetLegacyNoAadLogForTests();
});
afterEach(() => {
  restoreKeyEnv();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Plants records as an attacker with datastore write access would, bypassing the repository. */
interface Plant {
  repo: MetaTokenRepo;
  boundOwn(): Promise<void>;
  legacyOf(user: string, name: string, token: string): void;
  moveLegacyOfBIntoA(): void;
}

function firestorePlant(): Plant {
  const repo = new FirestoreMetaTokenRepo();
  const path = (user: string, name: string) => `users/${user}/meta_tokens/${name}`;
  return {
    repo,
    async boundOwn() { await repo.saveToken({ fbUserId: A, name: "personal", accessToken: "SYNTH-TOKEN-OF-A", kind: "system_user", expiresAt: null, metaUserId: A, metaUserName: "a" }); },
    legacyOf(user, name, token) { db.seed(path(user, name), { encryptedToken: impls.main.encrypt(token), ...metadata() }); },
    moveLegacyOfBIntoA() { db.seed(path(A, "personal"), { ...db.read(path(B, "client_beta"))! }); },
  };
}

function memoryPlant(): Plant {
  const repo = new InMemoryMetaTokenRepo();
  const bucket = (user: string) => (repo as unknown as { tokens: Map<string, Map<string, unknown>> }).tokens.get(user) ?? ((repo as unknown as { tokens: Map<string, Map<string, unknown>> }).tokens.set(user, new Map()), (repo as unknown as { tokens: Map<string, Map<string, unknown>> }).tokens.get(user)!);
  return {
    repo,
    async boundOwn() { await repo.saveToken({ fbUserId: A, name: "personal", accessToken: "SYNTH-TOKEN-OF-A", kind: "system_user", expiresAt: null, metaUserId: A, metaUserName: "a" }); },
    legacyOf(user, name, token) { bucket(user).set(name, { encryptedToken: impls.main.encrypt(token), keyVersion: undefined, ...metadata() }); },
    moveLegacyOfBIntoA() { bucket(A).set("personal", bucket(B).get("client_beta")); },
  };
}

describe("the explicit legacy no-AAD policy", () => {
  it.each([
    [undefined, true], ["", true], ["true", true], [" TRUE ", true], ["false", false], ["False", false], [" false ", false],
  ])("%j -> allowed=%s", (value, expected) => {
    expect(legacyNoAadDecryptAllowed(value === undefined ? {} : { [FLAG]: value })).toBe(expected);
  });

  it.each(["0", "no", "off", "1", "yes", "tru", "falsee"])("treats the unrecognised value %j as a configuration error, never as on", (value) => {
    expect(() => legacyNoAadDecryptAllowed({ [FLAG]: value })).toThrow(/must be "true" or "false"/);
  });

  it("defaults to allowed so records written by older code keep working", () => {
    expect(legacyNoAadDecryptAllowed({})).toBe(true);
  });
});

describe("startup warning", () => {
  it("logs exactly one count-free warning while the fallback is on, however often it is called", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    logLegacyNoAadPolicyAtStartup({});
    logLegacyNoAadPolicyAtStartup({ [FLAG]: "true" });
    logLegacyNoAadPolicyAtStartup({});
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toContain(FLAG);
    expect(message).toContain("false");
    expect(JSON.stringify(fields)).not.toMatch(/count|records|\d{3,}/i);
    expect(message).not.toMatch(/\b\d+\b/);
  });

  it("logs nothing when the fallback is switched off", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    logLegacyNoAadPolicyAtStartup({ [FLAG]: "false" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails fast on a malformed value", () => {
    expect(() => logLegacyNoAadPolicyAtStartup({ [FLAG]: "maybe" })).toThrow(/must be "true" or "false"/);
  });
});

describe.each([["firestore", firestorePlant], ["in-memory", memoryPlant]] as const)("moving a legacy ciphertext between users (%s)", (_label, make) => {
  async function scenario() {
    const plant = make();
    await plant.boundOwn();
    plant.legacyOf(B, "client_beta", "SYNTH-LEGACY-SYSTEM-TOKEN-OF-B");
    plant.moveLegacyOfBIntoA();
    return plant;
  }

  it("with the fallback refused, user A is NOT served user B's legacy token", async () => {
    vi.stubEnv(FLAG, "false");
    const { repo } = await scenario();
    await expect(repo.getDecryptedToken(A)).rejects.toThrow();
    await expect(repo.getDecryptedToken(A, "personal")).rejects.toThrow();
  });

  it("with the default (allowed), the documented legacy behaviour is unchanged", async () => {
    const { repo } = await scenario();
    expect(await repo.getDecryptedToken(A)).toBe("SYNTH-LEGACY-SYSTEM-TOKEN-OF-B");
  });

  it("with the fallback refused, a legitimately legacy record of its own owner is refused too, until it is migrated", async () => {
    vi.stubEnv(FLAG, "false");
    const plant = make();
    plant.legacyOf(A, "personal", "SYNTH-OWN-LEGACY");
    await expect(plant.repo.getDecryptedToken(A, "personal")).rejects.toThrow();
    vi.stubEnv(FLAG, "true");
    expect(await plant.repo.getDecryptedToken(A, "personal")).toBe("SYNTH-OWN-LEGACY");
  });

  it("identity-bound records are unaffected by the setting in both positions", async () => {
    const plant = make();
    await plant.boundOwn();
    for (const value of ["true", "false"]) {
      vi.stubEnv(FLAG, value);
      expect(await plant.repo.getDecryptedToken(A)).toBe("SYNTH-TOKEN-OF-A");
    }
  });

  it("an identity-bound record moved to another user stays refused in both positions", async () => {
    const plant = make();
    await plant.boundOwn();
    await plant.repo.saveToken({ fbUserId: B, name: "personal", accessToken: "SYNTH-TOKEN-OF-B", kind: "system_user", expiresAt: null, metaUserId: B, metaUserName: "b" });
    if (_label === "firestore") db.seed(`users/${A}/meta_tokens/personal`, { ...db.read(`users/${B}/meta_tokens/personal`)! });
    else {
      const tokens = (plant.repo as unknown as { tokens: Map<string, Map<string, unknown>> }).tokens;
      tokens.get(A)!.set("personal", tokens.get(B)!.get("personal"));
    }
    for (const value of ["true", "false"]) {
      vi.stubEnv(FLAG, value);
      await expect(plant.repo.getDecryptedToken(A)).rejects.toThrow();
    }
  });

  it("an unrecognised setting fails closed on a legacy record", async () => {
    vi.stubEnv(FLAG, "maybe");
    const { repo } = await scenario();
    await expect(repo.getDecryptedToken(A)).rejects.toThrow(/must be "true" or "false"/);
  });
});
