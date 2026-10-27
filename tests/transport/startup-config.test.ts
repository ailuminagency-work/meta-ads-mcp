import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OBSERVED_WRITE_FLAGS,
  STRICT_WRITE_FLAGS,
  describeDeployment,
  validateAgencyEnvironment,
  validateVideoConcurrency,
} from "../../src/transport/deployment-config.js";

const validAgency: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  META_APP_ID: "123",
  META_APP_SECRET: "synthetic-app-secret",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("hex"),
  SESSION_COOKIE_SECRET: "synthetic-session-".repeat(4),
  OAUTH_SECRET: "synthetic-signing-".repeat(4),
  AUTH_ALLOWED_FB_USER_IDS: "123",
  FIRESTORE_PROJECT_ID: "synthetic-project",
  GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/synthetic.json",
  SERVER_URL: "https://agency.example.com",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("write-flag inventory", () => {
  const corpus = sourceFiles(path.resolve(__dirname, "../../src"))
    .filter((file) => !file.endsWith(path.join("transport", "deployment-config.ts")))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  it.each([...STRICT_WRITE_FLAGS, ...OBSERVED_WRITE_FLAGS])(
    "%s is a flag the platform actually reads",
    (name) => {
      expect(corpus).toContain(name);
    },
  );

  it("keeps the strict set limited to provider-mutating flags and lists the global switches separately", () => {
    expect(STRICT_WRITE_FLAGS).toContain("LUMIN_PLATFORM_WRITES_ENABLED");
    expect(STRICT_WRITE_FLAGS).toContain("LUMIN_MARKETING_ACTIVATION_ENABLED");
    expect(STRICT_WRITE_FLAGS).toContain("LUMIN_MARKETING_DELETION_ENABLED");
    expect(STRICT_WRITE_FLAGS).not.toContain("AGENCY_WRITES_ENABLED");
    expect(STRICT_WRITE_FLAGS).not.toContain("LUMIN_PLATFORM_ENABLED");
    expect(OBSERVED_WRITE_FLAGS).toEqual(expect.arrayContaining([...STRICT_WRITE_FLAGS]));
  });
});

describe("agency write flags must sit behind the global write switch", () => {
  it("accepts the all-defaults configuration and a fully explicit read-only one", () => {
    expect(() => validateAgencyEnvironment(validAgency)).not.toThrow();
    const explicit = Object.fromEntries(STRICT_WRITE_FLAGS.map((name) => [name, "false"]));
    expect(() =>
      validateAgencyEnvironment({ ...validAgency, AGENCY_WRITES_ENABLED: "false", ...explicit }),
    ).not.toThrow();
  });

  it.each(STRICT_WRITE_FLAGS)("fails startup when %s is true and AGENCY_WRITES_ENABLED is unset", (name) => {
    expect(() => validateAgencyEnvironment({ ...validAgency, [name]: "true" })).toThrow(
      new RegExp(`${name}.*AGENCY_WRITES_ENABLED|AGENCY_WRITES_ENABLED.*${name}`),
    );
  });

  it.each(STRICT_WRITE_FLAGS)("fails startup when %s is true and AGENCY_WRITES_ENABLED is false", (name) => {
    expect(() =>
      validateAgencyEnvironment({ ...validAgency, AGENCY_WRITES_ENABLED: "false", [name]: "true" }),
    ).toThrow(/AGENCY_WRITES_ENABLED/);
  });

  it.each(STRICT_WRITE_FLAGS)("allows %s when the global switch is explicitly true", (name) => {
    expect(() =>
      validateAgencyEnvironment({ ...validAgency, AGENCY_WRITES_ENABLED: "true", LUMIN_PLATFORM_ENABLED: "true", [name]: "true" }),
    ).not.toThrow();
  });

  it("names every offending flag and nothing else", () => {
    let message = "";
    try {
      validateAgencyEnvironment({
        ...validAgency,
        LUMIN_PLATFORM_WRITES_ENABLED: "true",
        LUMIN_MARKETING_ACTIVATION_ENABLED: "true",
        LUMIN_PAUSED_AD_BATCH_ENABLED: "false",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("LUMIN_PLATFORM_WRITES_ENABLED");
    expect(message).toContain("LUMIN_MARKETING_ACTIVATION_ENABLED");
    expect(message).not.toContain("LUMIN_PAUSED_AD_BATCH_ENABLED");
    expect(message).not.toContain("synthetic");
  });

  it.each(["yes", "TRUE", "1", "on", "True "])("rejects the ambiguous value %j for a write flag", (value) => {
    expect(() =>
      validateAgencyEnvironment({ ...validAgency, AGENCY_WRITES_ENABLED: "true", LUMIN_PLATFORM_WRITES_ENABLED: value }),
    ).toThrow(/LUMIN_PLATFORM_WRITES_ENABLED must be an explicit boolean/);
  });

  it("treats an empty variable as unset, as the rest of the platform does", () => {
    expect(() =>
      validateAgencyEnvironment({ ...validAgency, LUMIN_PLATFORM_WRITES_ENABLED: "", AGENCY_WRITES_ENABLED: "" }),
    ).not.toThrow();
  });

  it("does not lock out flags that also gate read-only behaviour", () => {
    expect(() =>
      validateAgencyEnvironment({
        ...validAgency,
        LUMIN_MARKETING_APP_PROMOTION_ENABLED: "true",
        LUMIN_APP_EVENT_TYPES_ENABLED: "true",
        LUMIN_WHATSAPP_SETUP_ENABLED: "true",
        LUMIN_PLATFORM_ENABLED: "true",
      }),
    ).not.toThrow();
  });

  it("keeps the existing explicit-boolean rule for the global switch", () => {
    expect(() => validateAgencyEnvironment({ ...validAgency, AGENCY_WRITES_ENABLED: "yes" })).toThrow(/boolean/);
  });
});

describe("VIDEO_MAX_CONCURRENT_JOBS", () => {
  it.each([undefined, "", "   ", "1", "2", " 3 ", "01", "16"])("accepts %j", (value) => {
    expect(() => validateVideoConcurrency({ VIDEO_MAX_CONCURRENT_JOBS: value })).not.toThrow();
  });

  it.each(["0", "-1", "1.5", "abc", "1e3", "2x", "NaN", "Infinity", "+1", "0x2", "9007199254740993", "1 2"])(
    "rejects %j",
    (value) => {
      expect(() => validateVideoConcurrency({ VIDEO_MAX_CONCURRENT_JOBS: value })).toThrow(
        "VIDEO_MAX_CONCURRENT_JOBS must be a positive integer",
      );
    },
  );
});

describe("startup summary", () => {
  const secretsEnv: NodeJS.ProcessEnv = {
    ...validAgency,
    DEPLOYMENT_MODE: "agency",
    AGENCY_WRITES_ENABLED: "false",
    LUMIN_PLATFORM_ENABLED: "true",
    LUMIN_PLATFORM_WRITES_ENABLED: "false",
    MCP_API_KEY: "synthetic-mcp-key",
  };

  it("reports the mode, the effective access and each write flag as booleans", () => {
    const summary = describeDeployment("agency", secretsEnv);
    expect(summary).toMatchObject({
      deploymentMode: "agency",
      effectiveAccess: "agency_read_only",
      agencyWritesEnabled: false,
      platformEnabled: true,
      platformWritesEffective: false,
    });
    for (const name of OBSERVED_WRITE_FLAGS) expect(summary.writeFlags[name]).toBe(false);
    expect(Object.keys(summary.writeFlags).sort()).toEqual([...OBSERVED_WRITE_FLAGS].sort());
  });

  it("carries no secret, id, URL or free text", () => {
    const text = JSON.stringify(describeDeployment("agency", secretsEnv));
    for (const secret of ["synthetic", "123", "agency.example.com", "/run/secrets"]) {
      expect(text).not.toContain(secret);
    }
    const walk = (value: unknown): void => {
      if (value && typeof value === "object") Object.values(value).forEach(walk);
      else expect(["boolean", "string"]).toContain(typeof value);
    };
    walk(describeDeployment("agency", secretsEnv));
  });

  it("flags the effective-write combinations", () => {
    expect(
      describeDeployment("agency", {
        ...secretsEnv,
        AGENCY_WRITES_ENABLED: "true",
        LUMIN_PLATFORM_WRITES_ENABLED: "true",
      }),
    ).toMatchObject({ effectiveAccess: "agency_writes_enabled", platformWritesEffective: true, legacyWritesWithoutPolicyEngine: false });
    expect(
      describeDeployment("agency", { ...secretsEnv, AGENCY_WRITES_ENABLED: "true", LUMIN_PLATFORM_ENABLED: "false" }),
    ).toMatchObject({ effectiveAccess: "agency_writes_enabled", legacyWritesWithoutPolicyEngine: true });
  });

  it("describes the other modes", () => {
    expect(describeDeployment("awaiting_credentials", {})).toMatchObject({
      deploymentMode: "awaiting_credentials",
      effectiveAccess: "locked",
    });
    expect(describeDeployment("upstream", {})).toMatchObject({
      deploymentMode: "upstream",
      effectiveAccess: "upstream_unrestricted",
    });
  });

  it("counts only an exact true as true", () => {
    const summary = describeDeployment("agency", {
      ...secretsEnv,
      AGENCY_WRITES_ENABLED: "true",
      LUMIN_PLATFORM_WRITES_ENABLED: "TRUE",
    });
    expect(summary.writeFlags.LUMIN_PLATFORM_WRITES_ENABLED).toBe(false);
    expect(summary.platformWritesEffective).toBe(false);
  });
});
