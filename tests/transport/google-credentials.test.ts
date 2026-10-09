import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { materializeGoogleCredentials } from "../../src/transport/google-credentials.js";

it("materializes credential configuration outside the repository and removes it", () => {
  const raw = JSON.stringify({ type: "external_account", audience: "test-fixture" });
  const env: NodeJS.ProcessEnv = { GOOGLE_CREDENTIALS_JSON: raw };
  const cleanup = materializeGoogleCredentials(env);
  const file = env.GOOGLE_APPLICATION_CREDENTIALS!;
  try {
    expect(readFileSync(file, "utf8")).toBe(raw);
    expect(env.GOOGLE_CREDENTIALS_JSON).toBeUndefined();
  } finally { cleanup(); }
  expect(existsSync(file)).toBe(false);
});

it("rejects malformed credential configuration without echoing the input", () => {
  expect(() => materializeGoogleCredentials({ GOOGLE_CREDENTIALS_JSON: "invalid-secret-value" })).toThrow(/^GOOGLE_CREDENTIALS_JSON must be valid credential JSON$/);
  expect(() => materializeGoogleCredentials({ GOOGLE_CREDENTIALS_JSON: "null" })).toThrow(/type/);
});
