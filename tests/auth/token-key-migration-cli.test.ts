import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("token key migration CLI diagnostics", () => {
  it("does not print credential-loader error details", () => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "src/auth/token-key-migration-cli.ts", "--verify",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        TOKEN_ENCRYPTION_KEYRING_JSON: "invalid-json",
      },
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("TOKEN_KEY_MIGRATION_FAILED");
    expect(result.stdout).toBe("");
  });
});
