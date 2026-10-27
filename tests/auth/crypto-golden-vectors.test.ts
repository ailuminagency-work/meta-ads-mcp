import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENVS, impls, restoreKeyEnv, useKeyEnv, type Envelope, type KeyEnv } from "../fixtures/crypto/compat-harness.js";

interface Vector { id: string; writer: "main" | "staging" | "line"; keyEnvironment: keyof typeof ENVS; aad: string | null; plaintext: string; envelope: Envelope }

const vectors = (JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/crypto/golden-envelopes.json"), "utf8")) as { vectors: Vector[] }).vectors;

afterEach(() => restoreKeyEnv());

describe("frozen envelopes written by main@251249e, staging@1f08563 and the release line stay readable", () => {
  it("pins the corpus", () => {
    expect(vectors.map((vector) => vector.id)).toEqual([
      "main-legacy-no-aad", "main-meta-token-aad", "main-apify-aad", "staging-primary-aad", "staging-next-aad", "line-primary-aad", "line-next-aad",
    ]);
  });

  describe.each(vectors)("$id", (vector) => {
    const readableByMain = vector.keyEnvironment === "k1Only";

    it("is decrypted by the release line under the writer's key set", () => {
      useKeyEnv(ENVS[vector.keyEnvironment] as KeyEnv);
      expect(impls.line.decrypt(vector.envelope, vector.aad ?? undefined)).toBe(vector.plaintext);
    });

    it("is decrypted by the release line under the fully configured keyring", () => {
      useKeyEnv(ENVS.jsonActiveNext);
      expect(impls.line.decrypt(vector.envelope, vector.aad ?? undefined)).toBe(vector.plaintext);
    });

    it("is decrypted by the staging implementation under the writer's key set", () => {
      useKeyEnv(ENVS[vector.keyEnvironment] as KeyEnv);
      expect(impls.staging.decrypt(vector.envelope, vector.aad ?? undefined)).toBe(vector.plaintext);
    });

    it(readableByMain ? "is decrypted by main@251249e with the unrotated key" : "is NOT readable by main@251249e with the unrotated key but is with the next key", () => {
      useKeyEnv(ENVS.k1Only);
      if (readableByMain) {
        expect(impls.main.decrypt(vector.envelope, vector.aad ?? undefined)).toBe(vector.plaintext);
        return;
      }
      expect(() => impls.main.decrypt(vector.envelope, vector.aad ?? undefined)).toThrow("Unsupported state or unable to authenticate data");
      useKeyEnv(ENVS.k2Only);
      expect(impls.main.decrypt(vector.envelope, vector.aad ?? undefined)).toBe(vector.plaintext);
    });

    it("is rejected when its AAD is dropped or changed", () => {
      useKeyEnv(ENVS.jsonActiveNext);
      if (vector.aad === null) {
        expect(() => impls.line.decrypt(vector.envelope, "mcp_token:other:personal")).toThrow("could not be authenticated");
        return;
      }
      expect(() => impls.line.decrypt(vector.envelope)).toThrow("could not be authenticated");
      expect(() => impls.line.decrypt(vector.envelope, `${vector.aad}x`)).toThrow("could not be authenticated");
    });
  });
});
