import { describe, expect, it } from "vitest";
import { validateAgencyEnvironment, validatePlatformConfiguration } from "../../src/transport/deployment-config.js";

const agencyEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  DEPLOYMENT_MODE: "agency",
  META_APP_ID: "300",
  META_APP_SECRET: "s".repeat(32),
  SERVER_URL: "https://mcp.example.test",
  FIRESTORE_PROJECT_ID: "proj",
  GOOGLE_APPLICATION_CREDENTIALS: "/x.json",
  SESSION_COOKIE_SECRET: "c".repeat(48),
  OAUTH_SECRET: "o".repeat(48),
  TOKEN_ENCRYPTION_KEY: "e".repeat(64),
  AUTH_ALLOWED_FB_USER_IDS: "900000000000001",
  ...extra,
});

const ceilings = (clients: Record<string, unknown>, version: unknown = 1) => JSON.stringify({ version, clients });
const validCeiling = { currency: "USD", max_daily_budget: "500.00", max_lifetime_budget: "5000.00" };

describe("LUMIN_PLATFORM_ENABLED is a strict boolean at startup (G2R-09)", () => {
  it.each(["TRUE", "True", "1", "yes", "on", " true", "true ", "enabled"])(
    "refuses %j instead of starting a server whose every createServer() then throws",
    (value) => {
      expect(() => validateAgencyEnvironment(agencyEnv({ LUMIN_PLATFORM_ENABLED: value }))).toThrow(
        /LUMIN_PLATFORM_ENABLED must be an explicit boolean \(true or false\)/,
      );
    },
  );

  it("refuses the same spelling when writes are also on, naming the spelling problem first", () => {
    expect(() => validateAgencyEnvironment(agencyEnv({ AGENCY_WRITES_ENABLED: "true", LUMIN_PLATFORM_ENABLED: "TRUE" }))).toThrow(
      /must be an explicit boolean/,
    );
  });

  it.each(["true", "false", ""])("accepts %j", (value) => {
    expect(() => validateAgencyEnvironment(agencyEnv({ LUMIN_PLATFORM_ENABLED: value }))).not.toThrow();
  });

  it("accepts an unset value", () => {
    expect(() => validateAgencyEnvironment(agencyEnv())).not.toThrow();
  });
});

describe("LUMIN_MARKETING_BUDGET_CEILINGS is parsed once at startup when the platform is on (G2R-09)", () => {
  const platform = (extra: Record<string, string>) => agencyEnv({ LUMIN_PLATFORM_ENABLED: "true", ...extra });

  it("accepts a valid document, several clients, and a missing or empty one", async () => {
    await expect(validatePlatformConfiguration(platform({ LUMIN_MARKETING_BUDGET_CEILINGS: ceilings({ client_1: validCeiling, "client-2": { currency: "JPY", max_daily_budget: "50000", max_lifetime_budget: "500000" } }) }))).resolves.toBeUndefined();
    await expect(validatePlatformConfiguration(platform({}))).resolves.toBeUndefined();
    await expect(validatePlatformConfiguration(platform({ LUMIN_MARKETING_BUDGET_CEILINGS: "  " }))).resolves.toBeUndefined();
  });

  it.each([
    ["not JSON", "{ nope"],
    ["an unknown version", ceilings({ client_1: validCeiling }, 2)],
    ["an unknown key in an entry", ceilings({ client_1: { ...validCeiling, extra: "1" } })],
    ["a wildcard client", ceilings({ "*": validCeiling })],
    ["an unsupported currency", ceilings({ client_1: { ...validCeiling, currency: "XTS" } })],
    ["a zero ceiling", ceilings({ client_1: { ...validCeiling, max_daily_budget: "0" } })],
    ["a missing lifetime ceiling", ceilings({ client_1: { currency: "USD", max_daily_budget: "500.00" } })],
    ["a fraction the currency cannot hold", ceilings({ client_1: { currency: "JPY", max_daily_budget: "500.50", max_lifetime_budget: "5000" } })],
    ["an array", "[]"],
  ])("refuses %s at startup, before the first budget write would find it", async (_label, document) => {
    await expect(validatePlatformConfiguration(platform({ LUMIN_MARKETING_BUDGET_CEILINGS: document }))).rejects.toThrow(
      /LUMIN_MARKETING_BUDGET_CEILINGS is not a valid budget ceiling document/,
    );
  });

  it("does not echo the document", async () => {
    const marker = "synthetic-ceiling-marker-4471";
    const error = await validatePlatformConfiguration(platform({ LUMIN_MARKETING_BUDGET_CEILINGS: `{"${marker}":` })).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain(marker);
  });

  it("leaves the document alone while the platform is off", async () => {
    await expect(validatePlatformConfiguration(agencyEnv({ LUMIN_PLATFORM_ENABLED: "false", LUMIN_MARKETING_BUDGET_CEILINGS: "{ nope" }))).resolves.toBeUndefined();
    await expect(validatePlatformConfiguration(agencyEnv({ LUMIN_MARKETING_BUDGET_CEILINGS: "{ nope" }))).resolves.toBeUndefined();
  });
});
