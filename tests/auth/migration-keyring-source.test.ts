import { describe, expect, it } from "vitest";
import { assertMigrationKeyringSource } from "../../src/auth/migration-keyring-source.js";

describe("migration key source", () => {
  it("rejects conflicting JSON and split-key configuration", () => {
    expect(() => assertMigrationKeyringSource({ TOKEN_ENCRYPTION_KEYRING_JSON: "{}", TOKEN_ENCRYPTION_KEY_NEXT: "synthetic" }))
      .toThrow("MIGRATION_KEY_SOURCE_CONFLICT");
  });
  it("accepts one configured source", () => {
    expect(() => assertMigrationKeyringSource({ TOKEN_ENCRYPTION_KEYRING_JSON: "{}" })).not.toThrow();
    expect(() => assertMigrationKeyringSource({ TOKEN_ENCRYPTION_KEY: "synthetic" })).not.toThrow();
  });
});
