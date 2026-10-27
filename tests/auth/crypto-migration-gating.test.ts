import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface RunResult { code: number | null; killed: boolean; stdout: string; stderr: string; connections: number }

let listener: net.Server;
let connections = 0;
let port = 0;

beforeEach(async () => {
  connections = 0;
  listener = net.createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  port = (listener.address() as net.AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => listener.close(() => resolve()));
});

function runScript(args: string[], env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/migrate-token-encryption.ts", ...args], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, 40_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, killed, stdout, stderr, connections });
    });
  });
}

const productionLikeEnv = () => ({
  NODE_ENV: "production",
  FIRESTORE_PROJECT_ID: "synthetic-production-project",
  GOOGLE_CLOUD_PROJECT: "synthetic-production-project",
  FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`,
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
});

describe("npm run migrate:token-encryption entry point", () => {
  it.each([
    ["apply without an operation id", ["--apply"]],
    ["apply with a short operation id", ["--apply", "--operation-id", "x"]],
    ["resume without apply", ["--resume"]],
    ["verify together with apply", ["--verify", "--apply", "--operation-id", "reviewed-op-1"]],
    ["an unknown flag", ["--force"]],
    ["a non-positive failure budget", ["--apply", "--operation-id", "reviewed-op-1", "--max-failures", "0"]],
  ])("rejects %s before it reads any configuration", async (_label, args) => {
    const result = await runScript(args, productionLikeEnv());
    expect(result.killed).toBe(false);
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("MIGRATION_ARGUMENTS_INVALID");
    expect(result.stdout).toBe("");
    expect(result.connections).toBe(0);
  }, 60_000);

  it.each([
    ["dry run", []],
    ["verify", ["--verify"]],
    ["apply", ["--apply", "--operation-id", "reviewed-op-1"]],
  ])("refuses a %s against any project other than the bound staging identity without opening a Firestore connection", async (_label, args) => {
    const result = await runScript(args, productionLikeEnv());
    expect(result.killed).toBe(false);
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("TOKEN_KEY_MIGRATION_FAILED");
    expect(result.stdout).toBe("");
    expect(result.connections).toBe(0);
  }, 60_000);

  it("refuses to run when a key source conflict would make the active key ambiguous", async () => {
    const env = {
      ...productionLikeEnv(),
      TOKEN_ENCRYPTION_KEYRING_JSON: JSON.stringify({ activeKeyId: "primary", keys: { primary: randomBytes(32).toString("hex") } }),
    };
    const result = await runScript(["--verify"], env);
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("TOKEN_KEY_MIGRATION_FAILED");
    expect(result.connections).toBe(0);
  }, 60_000);
});
