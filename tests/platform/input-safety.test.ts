import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertNoCredentialShapedString } from "../../src/platform/input-safety.js";

const reject = (value: unknown) => expect(() => assertNoCredentialShapedString(value)).toThrow("CREDENTIAL_SHAPED_CONTENT_REJECTED");
const accept = (value: unknown) => expect(() => assertNoCredentialShapedString(value)).not.toThrow();

describe("credential-shaped content screening", () => {
  it("rejects Meta, OpenAI and PEM shaped secrets and keyword assignments", () => {
    reject("EAAB" + "x9Z".repeat(10));
    reject("token is EAAB" + "x9Z".repeat(10));
    reject("EAA" + "a".repeat(40));
    reject("sk-proj-" + "a1B2".repeat(8));
    reject("-----BEGIN " + "PRIVATE KEY-----");
    reject("-----BEGIN " + "RSA PRIVATE KEY-----");
    const keyword = ["Access", "Token"].join("_");
    const value = "abcdefgh".concat("12345");
    reject(`${keyword} = ${value}`);
    reject("authorization=abcdefghij");
  });

  it("accepts a lower-case hex digest that contains the letters eaa", () => {
    accept("a".repeat(10) + "eaa" + "0123456789abcdef0123456789abcdef0123456789abcdef");
    accept("eaa" + "0123456789abcdef0123456789abcdef");
  });

  it("accepts ordinary content and non-strings", () => {
    accept("Spring sale, 20% off");
    accept(undefined);
    accept(42);
  });

  it("no longer rejects random lower-case hex digests (was 1% of them)", () => {
    let rejected = 0;
    for (let i = 0; i < 20000; i += 1) {
      try {
        assertNoCredentialShapedString(crypto.randomBytes(32).toString("hex"));
      } catch {
        rejected += 1;
      }
    }
    expect(rejected).toBe(0);
  });
});
