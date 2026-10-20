import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { materializeGoogleCredentials } from "../../src/transport/google-credentials.js";

it("materializes credential configuration outside the repository and removes it", () => {
  const raw = JSON.stringify({ type: "service_account", project_id: "test-project", client_email: "runtime@test-project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----" });
  const env: NodeJS.ProcessEnv = { GOOGLE_CREDENTIALS_JSON: raw, LUMIN_EXPECTED_FIRESTORE_PROJECT_ID: "test-project", LUMIN_EXPECTED_GOOGLE_SERVICE_ACCOUNT: "runtime@test-project.iam.gserviceaccount.com" };
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

it("rejects external-account and wrong identity configurations", () => {
  expect(() => materializeGoogleCredentials({ GOOGLE_CREDENTIALS_JSON: JSON.stringify({ type: "external_account" }) })).toThrow(/service_account type/);
  expect(() => materializeGoogleCredentials({ GOOGLE_CREDENTIALS_JSON: JSON.stringify({ type: "service_account", project_id: "other", client_email: "runtime@test-project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----" }), LUMIN_EXPECTED_FIRESTORE_PROJECT_ID: "test-project" })).toThrow(/project is not approved/);
});

it("rejects URL and executable credential suppliers", () => {
  expect(() => materializeGoogleCredentials({ GOOGLE_APPLICATION_CREDENTIALS: "https://example.invalid/credentials" })).toThrow(/local credential file/);
  expect(() => materializeGoogleCredentials({ GOOGLE_APPLICATION_CREDENTIALS: "C:\\secrets\\provider.exe" })).toThrow(/local credential file/);
});
