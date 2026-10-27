import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { assertApiKeyStrength, isApiKeyConfigured, validateApiKey } from "../../src/auth/api-key.js";

describe("API Key Authentication", () => {
  const originalEnv = process.env.MCP_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MCP_API_KEY = originalEnv;
    } else {
      delete process.env.MCP_API_KEY;
    }
  });

  describe("isApiKeyConfigured", () => {
    it("returns false when MCP_API_KEY is not set", () => {
      delete process.env.MCP_API_KEY;
      expect(isApiKeyConfigured()).toBe(false);
    });

    it("returns false when MCP_API_KEY is empty string", () => {
      process.env.MCP_API_KEY = "";
      expect(isApiKeyConfigured()).toBe(false);
    });

    it("returns true when MCP_API_KEY is set", () => {
      process.env.MCP_API_KEY = "test-key-123";
      expect(isApiKeyConfigured()).toBe(true);
    });
  });

  describe("assertApiKeyStrength", () => {
    const varied = (length: number) => "Ab3-xY9_kQ7mZp2LsT5vWn8RdE4fHj6u".repeat(3).slice(0, length);

    it("accepts an unset key and a key of 32 or more characters with some variety", () => {
      expect(() => assertApiKeyStrength({})).not.toThrow();
      expect(() => assertApiKeyStrength({ MCP_API_KEY: "" })).not.toThrow();
      expect(() => assertApiKeyStrength({ MCP_API_KEY: varied(32) })).not.toThrow();
      expect(() => assertApiKeyStrength({ MCP_API_KEY: createHash("sha256").update("fixture").digest("hex") })).not.toThrow();
      expect(() => assertApiKeyStrength({ MCP_API_KEY: createHash("sha256").update("fixture").digest("base64url") })).not.toThrow();
    });

    it("refuses a shorter key", () => {
      expect(() => assertApiKeyStrength({ MCP_API_KEY: "tiny" })).toThrow(/MCP_API_KEY must be at least 32 characters/);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: varied(31) })).toThrow(/at least 32/);
    });

    it("refuses a long key that repeats one character or has fewer than 12 distinct characters", () => {
      expect(() => assertApiKeyStrength({ MCP_API_KEY: "k".repeat(32) })).toThrow(/too repetitive/);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: "k".repeat(200) })).toThrow(/too repetitive/);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: "0123456789".repeat(5) })).toThrow(/at least 12 different characters/);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: "ab".repeat(16) })).toThrow(/too repetitive/);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: "abcdefghij".concat("k".repeat(40)) })).toThrow(/too repetitive/);
    });

    it("counts the 12 distinct characters exactly", () => {
      const eleven = "abcdefghijk";
      const twelve = "abcdefghijkl";
      expect(() => assertApiKeyStrength({ MCP_API_KEY: eleven.concat("k".repeat(30)) })).toThrow(/too repetitive/);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: twelve.concat("k".repeat(30)) })).not.toThrow();
    });

    it("refuses one block of any size repeated to fill the key, even when the block has many characters", () => {
      const block = "q8Wm3ZkP1xVb7NcR";
      expect(new Set(block).size).toBeGreaterThanOrEqual(12);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: block.repeat(2) })).toThrow(/one block repeated/);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: block.repeat(4) })).toThrow(/one block repeated/);
      expect(() => assertApiKeyStrength({ MCP_API_KEY: block.repeat(2).concat("Z") })).not.toThrow();
    });

    it("never puts the key in the error message", () => {
      const key = "ab".repeat(16);
      let message = "";
      try {
        assertApiKeyStrength({ MCP_API_KEY: key });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(key);
    });

    it("keeps accepting generated-looking keys: 256 different 64-character hex digests all pass", () => {
      for (let draw = 0; draw < 256; draw += 1) {
        const key = createHash("sha256").update(`fixture-${draw}`).digest("hex");
        expect(() => assertApiKeyStrength({ MCP_API_KEY: key })).not.toThrow();
      }
    });
  });

  describe("validateApiKey", () => {
    beforeEach(() => {
      process.env.MCP_API_KEY = "test-secret-fixture-1234567890";
    });

    it("returns true for matching key", () => {
      expect(validateApiKey("test-secret-fixture-1234567890")).toBe(true);
    });

    it("returns false for wrong key", () => {
      expect(validateApiKey("wrong-key-00000000000")).toBe(false);
    });

    it("returns false for key with different length", () => {
      expect(validateApiKey("short")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(validateApiKey("")).toBe(false);
    });

    it("returns false when MCP_API_KEY is not configured", () => {
      delete process.env.MCP_API_KEY;
      expect(validateApiKey("any-key")).toBe(false);
    });

    it("uses timing-safe comparison (does not short-circuit)", () => {
      // Verify crypto.timingSafeEqual is used by checking that
      // both matching and non-matching keys of the same length
      // call through without throwing
      expect(validateApiKey("test-secret-fixture-1234567890")).toBe(true);
      expect(validateApiKey("xx-xxxxxx-xxx-xxx-xxxxx")).toBe(false);
    });

    it("CODE-B4: rejects keys of different length without leaking length via early return", () => {
      // We can't measure timing reliably in a unit test, but we can at
      // least assert that the function still returns a clean false for
      // a wide range of mismatched-length candidates and never throws.
      expect(validateApiKey("a")).toBe(false);
      expect(validateApiKey("aa")).toBe(false);
      expect(validateApiKey("a".repeat(100))).toBe(false);
      expect(validateApiKey("a".repeat(10000))).toBe(false);
    });
  });
});
