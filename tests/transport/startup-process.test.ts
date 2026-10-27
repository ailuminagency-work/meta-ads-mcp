import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const tsx = path.join(root, "node_modules", ".bin", "tsx");

interface Outcome {
  code: number | null;
  output: string;
  records: Array<Record<string, unknown>>;
}

function parseRecords(output: string): Array<Record<string, unknown>> {
  return output.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function startProcess(env: Record<string, string>, stopWhen?: (records: Array<Record<string, unknown>>) => boolean): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, ["src/index.ts"], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "production", ...env },
    });
    let output = "";
    let stopping = false;
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`startup process did not finish: ${output.slice(-500)}`));
    }, 25_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (stopWhen && !stopping && stopWhen(parseRecords(output))) {
        stopping = true;
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      clearTimeout(deadline);
      resolve({ code, output, records: parseRecords(output) });
    });
  });
}

const agencyBase = {
  DEPLOYMENT_MODE: "agency",
  META_APP_ID: "123",
  META_APP_SECRET: "synthetic-app-secret-value",
  TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
  SESSION_COOKIE_SECRET: "synthetic-session-secret-".repeat(2),
  OAUTH_SECRET: "synthetic-signing-secret-".repeat(2),
  AUTH_ALLOWED_FB_USER_IDS: "123",
  FIRESTORE_PROJECT_ID: "synthetic-project",
  GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/synthetic.json",
  SERVER_URL: "https://agency.example.com",
};

describe("startup behaviour of the real entry point", () => {
  it("refuses to start in agency mode when a write flag is on and the global switch is not", async () => {
    const outcome = await startProcess({ ...agencyBase, LUMIN_PLATFORM_WRITES_ENABLED: "true" });
    expect(outcome.code).toBe(1);
    const fatal = outcome.records.find((record) => record.msg === "Failed to start server");
    expect(JSON.stringify(fatal)).toContain("LUMIN_PLATFORM_WRITES_ENABLED");
    expect(JSON.stringify(fatal)).toContain("AGENCY_WRITES_ENABLED");
    expect(outcome.records.some((record) => record.msg === "Deployment configuration")).toBe(false);
    expect(outcome.output).not.toContain("synthetic");
  });

  it("refuses an invalid budget ceiling document at startup when the platform is on, without echoing it", async () => {
    const outcome = await startProcess({ ...agencyBase, LUMIN_PLATFORM_ENABLED: "true", LUMIN_MARKETING_BUDGET_CEILINGS: '{"synthetic-marker":' });
    expect(outcome.code).toBe(1);
    expect(JSON.stringify(outcome.records.find((record) => record.msg === "Failed to start server"))).toContain("LUMIN_MARKETING_BUDGET_CEILINGS");
    expect(outcome.records.some((record) => record.msg === "Deployment configuration")).toBe(false);
    expect(outcome.output).not.toContain("synthetic-marker");
  });

  it("refuses LUMIN_PLATFORM_ENABLED=TRUE at startup instead of running a server that cannot register its tools", async () => {
    const outcome = await startProcess({ ...agencyBase, LUMIN_PLATFORM_ENABLED: "TRUE" });
    expect(outcome.code).toBe(1);
    expect(JSON.stringify(outcome.records.find((record) => record.msg === "Failed to start server"))).toContain("LUMIN_PLATFORM_ENABLED must be an explicit boolean");
  });

  it.each(["prodution", "Production", " production"])("refuses to start with NODE_ENV=%j and no DEPLOYMENT_MODE instead of serving unrestricted upstream", async (nodeEnv) => {
    const outcome = await startProcess({ NODE_ENV: nodeEnv, PORT: "0" });
    expect(outcome.code).toBe(1);
    expect(outcome.output).toContain("Failed to start server");
    expect(outcome.output).toContain("DEPLOYMENT_MODE must be set explicitly");
    expect(outcome.output).not.toContain("Starting Meta Ads MCP server");
  });

  it("refuses a VIDEO_MAX_CONCURRENT_JOBS that is not a positive integer", async () => {
    const outcome = await startProcess({ DEPLOYMENT_MODE: "upstream", VIDEO_MAX_CONCURRENT_JOBS: "0" });
    expect(outcome.code).toBe(1);
    expect(JSON.stringify(outcome.records.find((record) => record.msg === "Failed to start server"))).toContain(
      "VIDEO_MAX_CONCURRENT_JOBS must be a positive integer",
    );
  });

  it("logs exactly one configuration line with the mode and each write flag as a boolean", async () => {
    const outcome = await startProcess(
      {
        DEPLOYMENT_MODE: "awaiting_credentials",
        PORT: "0",
        LUMIN_PLATFORM_WRITES_ENABLED: "true",
        META_APP_SECRET: "synthetic-app-secret-value",
        TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
        FIRESTORE_PROJECT_ID: "synthetic-project",
      },
      (records) => records.some((record) => record.msg === "Deployment configuration"),
    );
    const lines = outcome.records.filter((record) => record.msg === "Deployment configuration");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      deploymentMode: "awaiting_credentials",
      effectiveAccess: "locked",
      agencyWritesEnabled: false,
      platformEnabled: false,
      platformWritesEffective: false,
    });
    const flags = lines[0].writeFlags as Record<string, unknown>;
    expect(flags.LUMIN_PLATFORM_WRITES_ENABLED).toBe(true);
    expect(flags.LUMIN_MARKETING_ACTIVATION_ENABLED).toBe(false);
    for (const value of Object.values(flags)) expect(typeof value).toBe("boolean");
    expect(outcome.output).not.toContain("synthetic");
    expect(outcome.output).not.toContain("abab");
  });
});
