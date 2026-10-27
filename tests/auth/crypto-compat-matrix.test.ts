import { afterEach, describe, expect, it } from "vitest";
import {
  classify,
  ENVS,
  impls,
  restoreKeyEnv,
  useKeyEnv,
  type CryptoImpl,
  type Envelope,
  type KeyEnv,
  type Outcome,
} from "../fixtures/crypto/compat-harness.js";

const PLAINTEXT = "synthetic-token-compat-matrix";
const AAD = "mcp_token:synthetic-user:personal";

interface Writer { id: string; impl: CryptoImpl; env: KeyEnv; aad: string | undefined; keyVersion: string | undefined }
interface Reader { id: string; impl: CryptoImpl; env: KeyEnv }

const writers: Writer[] = [
  { id: "main/aad", impl: impls.main, env: ENVS.k1Only, aad: AAD, keyVersion: undefined },
  { id: "main/legacy-no-aad", impl: impls.main, env: ENVS.k1Only, aad: undefined, keyVersion: undefined },
  { id: "line/primary", impl: impls.line, env: ENVS.k1Only, aad: AAD, keyVersion: "primary" },
  { id: "line/next", impl: impls.line, env: ENVS.k1PlusNext, aad: AAD, keyVersion: "next" },
  { id: "line/custom-id", impl: impls.line, env: ENVS.k1PlusNextCustomId, aad: AAD, keyVersion: "k2026" },
  { id: "line/json-next", impl: impls.line, env: ENVS.jsonActiveNext, aad: AAD, keyVersion: "next" },
  { id: "staging/primary", impl: impls.staging, env: ENVS.k1Only, aad: AAD, keyVersion: "primary" },
  { id: "staging/next", impl: impls.staging, env: ENVS.k1PlusNext, aad: AAD, keyVersion: "next" },
];

const readers: Reader[] = [
  { id: "main@K1", impl: impls.main, env: ENVS.k1Only },
  { id: "main@K2", impl: impls.main, env: ENVS.k2Only },
  { id: "line@K1", impl: impls.line, env: ENVS.k1Only },
  { id: "line@K1+NEXT", impl: impls.line, env: ENVS.k1PlusNext },
  { id: "line@JSON", impl: impls.line, env: ENVS.jsonActiveNext },
  { id: "line@K2-as-primary", impl: impls.line, env: ENVS.k2Only },
  { id: "line@K1+NEXT(k2026)", impl: impls.line, env: ENVS.k1PlusNextCustomId },
  { id: "staging@K1", impl: impls.staging, env: ENVS.k1Only },
  { id: "staging@K1+NEXT", impl: impls.staging, env: ENVS.k1PlusNext },
];

const OK: Outcome = "OK";
const MAIN_FAIL: Outcome = "MAIN_GCM_AUTH";
const LINE_FAIL: Outcome = "LINE_AUTH";
const unavailable = (id: string): Outcome => `KEY_VERSION_UNAVAILABLE:${id}`;

/**
 * Hand-written expectations, not derived from the implementations, so the table
 * itself is the specification of which direction fails and with which error.
 */
const EXPECTED: Record<string, Record<string, Outcome>> = {
  "main/aad": {
    "main@K1": OK, "main@K2": MAIN_FAIL, "line@K1": OK, "line@K1+NEXT": OK, "line@JSON": OK,
    "line@K2-as-primary": LINE_FAIL, "line@K1+NEXT(k2026)": OK, "staging@K1": OK, "staging@K1+NEXT": OK,
  },
  "main/legacy-no-aad": {
    "main@K1": OK, "main@K2": MAIN_FAIL, "line@K1": OK, "line@K1+NEXT": OK, "line@JSON": OK,
    "line@K2-as-primary": LINE_FAIL, "line@K1+NEXT(k2026)": OK, "staging@K1": OK, "staging@K1+NEXT": OK,
  },
  "line/primary": {
    "main@K1": OK, "main@K2": MAIN_FAIL, "line@K1": OK, "line@K1+NEXT": OK, "line@JSON": OK,
    "line@K2-as-primary": LINE_FAIL, "line@K1+NEXT(k2026)": OK, "staging@K1": OK, "staging@K1+NEXT": OK,
  },
  "line/next": {
    "main@K1": MAIN_FAIL, "main@K2": OK, "line@K1": unavailable("next"), "line@K1+NEXT": OK, "line@JSON": OK,
    "line@K2-as-primary": unavailable("next"), "line@K1+NEXT(k2026)": unavailable("next"), "staging@K1": unavailable("next"), "staging@K1+NEXT": OK,
  },
  "line/custom-id": {
    "main@K1": MAIN_FAIL, "main@K2": OK, "line@K1": unavailable("k2026"), "line@K1+NEXT": unavailable("k2026"), "line@JSON": unavailable("k2026"),
    "line@K2-as-primary": unavailable("k2026"), "line@K1+NEXT(k2026)": OK, "staging@K1": unavailable("k2026"), "staging@K1+NEXT": unavailable("k2026"),
  },
  "line/json-next": {
    "main@K1": MAIN_FAIL, "main@K2": OK, "line@K1": unavailable("next"), "line@K1+NEXT": OK, "line@JSON": OK,
    "line@K2-as-primary": unavailable("next"), "line@K1+NEXT(k2026)": unavailable("next"), "staging@K1": unavailable("next"), "staging@K1+NEXT": OK,
  },
  "staging/primary": {
    "main@K1": OK, "main@K2": MAIN_FAIL, "line@K1": OK, "line@K1+NEXT": OK, "line@JSON": OK,
    "line@K2-as-primary": LINE_FAIL, "line@K1+NEXT(k2026)": OK, "staging@K1": OK, "staging@K1+NEXT": OK,
  },
  "staging/next": {
    "main@K1": MAIN_FAIL, "main@K2": OK, "line@K1": unavailable("next"), "line@K1+NEXT": OK, "line@JSON": OK,
    "line@K2-as-primary": unavailable("next"), "line@K1+NEXT(k2026)": unavailable("next"), "staging@K1": unavailable("next"), "staging@K1+NEXT": OK,
  },
};

function produce(writer: Writer): Envelope {
  useKeyEnv(writer.env);
  return JSON.parse(JSON.stringify(writer.impl.encrypt(PLAINTEXT, writer.aad))) as Envelope;
}

describe("encryption envelope compatibility matrix (main@251249e, staging@1f08563, release line)", () => {
  afterEach(() => restoreKeyEnv());

  it("covers every writer and reader pair", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(writers.map((w) => w.id).sort());
    for (const writer of writers) expect(Object.keys(EXPECTED[writer.id]).sort()).toEqual(readers.map((r) => r.id).sort());
  });

  for (const writer of writers) {
    describe(`writer ${writer.id}`, () => {
      it("stamps the key version only when the writer is keyring-aware", () => {
        expect(produce(writer).keyVersion).toBe(writer.keyVersion);
      });

      for (const reader of readers) {
        const expected = EXPECTED[writer.id][reader.id];
        it(`${reader.id} -> ${expected}`, () => {
          const envelope = produce(writer);
          useKeyEnv(reader.env);
          expect(classify(() => reader.impl.decrypt(envelope, writer.aad), PLAINTEXT)).toBe(expected);
        });
      }
    });
  }

  it("the only failing direction for an unrotated deployment is a wrong key, never the envelope shape", () => {
    for (const writer of writers.filter((w) => w.keyVersion === "primary" || w.keyVersion === undefined)) {
      const envelope = produce(writer);
      useKeyEnv(ENVS.k1Only);
      expect(impls.main.decrypt(envelope, writer.aad)).toBe(PLAINTEXT);
    }
  });

  it("an extra keyVersion member is ignored by the main@251249e decryptor", () => {
    useKeyEnv(ENVS.k1Only);
    const envelope = impls.main.encrypt(PLAINTEXT, AAD);
    expect(impls.main.decrypt({ ...envelope, keyVersion: "next" }, AAD)).toBe(PLAINTEXT);
    expect(impls.main.decrypt({ ...envelope, keyVersion: "anything-else", unexpected: "field" } as Envelope, AAD)).toBe(PLAINTEXT);
  });

  it("the keyring-aware decryptor never falls back to another key when a version is declared", () => {
    useKeyEnv(ENVS.k1PlusNext);
    const envelope = impls.line.encrypt(PLAINTEXT, AAD);
    expect(envelope.keyVersion).toBe("next");
    const lyingPrimary = { ...envelope, keyVersion: "primary" };
    expect(classify(() => impls.line.decrypt(lyingPrimary, AAD), PLAINTEXT)).toBe(LINE_FAIL);
  });
});
