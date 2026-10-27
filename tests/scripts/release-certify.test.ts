import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "../../scripts/release-certify.sh");
const roots: string[] = [];

const gitEnv = {
  GIT_AUTHOR_NAME: "synthetic",
  GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
  GIT_COMMITTER_NAME: "synthetic",
  GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
};

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, env: { ...process.env, ...gitEnv }, encoding: "utf8" }).trim();
}

function makeRepo(files: Record<string, string>): string {
  const repo = mkdtempSync(path.join(tmpdir(), "certify-repo-"));
  roots.push(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), content);
  }
  git(repo, "add", "--all", "--force");
  git(repo, "commit", "--quiet", "-m", "synthetic commit");
  return repo;
}

const cleanIgnore = ".env\n.env.*\n!.env.example\nnode_modules/\ndist/\n*.key\n*.pem\n";

function certify(repo: string, ...args: string[]) {
  const logs = mkdtempSync(path.join(tmpdir(), "certify-logs-"));
  roots.push(logs);
  const result = spawnSync("bash", [script, ...args], {
    env: { ...process.env, CERT_REPO: repo, CERT_LOG_DIR: logs, CERT_BASE: "" },
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("scripts/release-certify.sh", () => {
  it("prints usage and rejects unknown arguments and steps", () => {
    const repo = makeRepo({ ".gitignore": cleanIgnore });
    expect(certify(repo, "--help")).toMatchObject({ code: 0 });
    expect(certify(repo, "--help").out).toContain("Usage:");
    expect(certify(repo, "--bogus").code).toBe(2);
    expect(certify(repo, "--only", "nonsense").code).toBe(2);
  });

  it("names the exact commit and plans every step in a dry run without executing any", () => {
    const repo = makeRepo({ ".gitignore": cleanIgnore });
    const { code, out } = certify(repo, "--dry-run");
    expect(code).toBe(0);
    expect(out).toContain(`commit  : ${git(repo, "rev-parse", "HEAD")}`);
    for (const step of ["tree", "lint", "typecheck", "test", "build", "audit", "files", "secrets", "gitleaks", "guard-quick", "guard-full", "head"]) {
      expect(out).toMatch(new RegExp(`^${step}\\s+PLAN`, "m"));
    }
    expect(out).toContain("DRY RUN: nothing was executed");
  });

  it("passes a clean tree but never calls a partial run a certification", () => {
    const repo = makeRepo({ ".gitignore": cleanIgnore });
    const { code, out } = certify(repo, "--only", "tree,head");
    expect(out).toMatch(/^tree\s+PASS/m);
    expect(out).toMatch(/^head\s+PASS/m);
    expect(code).toBe(3);
    expect(out).toContain("NOT CERTIFIED - partial run");
    expect(out).toContain(git(repo, "rev-parse", "HEAD"));
  });

  it("fails on uncommitted edits and untracked files, and skips the remaining steps", () => {
    const repo = makeRepo({ ".gitignore": cleanIgnore, "a.txt": "one\n" });
    writeFileSync(path.join(repo, "a.txt"), "two\n");
    writeFileSync(path.join(repo, "stray.ts"), "export {};\n");
    const { code, out } = certify(repo, "--only", "tree,files");
    expect(code).toBe(1);
    expect(out).toMatch(/^tree\s+FAIL/m);
    expect(out).toMatch(/^files\s+SKIP\s+-\s+working tree is dirty/m);
    expect(out).toContain("?? stray.ts");
    expect(out).toContain("NOT CERTIFIED - 1 step(s) failed");
  });

  it("treats a tracked secret-bearing file as a failure even when it was committed deliberately", () => {
    const repo = makeRepo({ ".gitignore": cleanIgnore, "config/.env.production": "X=1\n", "keys/server.pem": "synthetic\n" });
    const { code, out } = certify(repo, "--only", "files");
    expect(code).toBe(1);
    expect(out).toMatch(/^files\s+FAIL/m);
    const log = out.match(/logs\s+: (.+)/)?.[1] ?? "";
    expect(execFileSync("cat", [path.join(log, "files.log")], { encoding: "utf8" })).toContain("config/.env.production");
  });

  it("fails when .gitignore stops covering the required entries", () => {
    const repo = makeRepo({ ".gitignore": "dist/\n" });
    const { code, out } = certify(repo, "--only", "files");
    expect(code).toBe(1);
    expect(out).toMatch(/^files\s+FAIL/m);
  });

  it("accepts a repository that tracks nothing prohibited", () => {
    const repo = makeRepo({ ".gitignore": cleanIgnore, ".env.example": "KEY=\n", "src/a.ts": "export {};\n" });
    const { out } = certify(repo, "--only", "files");
    expect(out).toMatch(/^files\s+PASS/m);
  });

  it("fails closed when the secret scanner it depends on is absent", () => {
    const repo = makeRepo({ ".gitignore": cleanIgnore });
    const { code, out } = certify(repo, "--only", "secrets");
    expect(code).toBe(1);
    expect(out).toMatch(/^secrets\s+FAIL/m);
  });

  it("scans only the commits after CERT_BASE and fails when one of them adds a key block", () => {
    const repo = makeRepo({ ".gitignore": cleanIgnore });
    const scanner = path.resolve(__dirname, "../../.github/pre-deploy-guard/scripts/scan-secrets.sh");
    mkdirSync(path.join(repo, ".github/pre-deploy-guard/scripts"), { recursive: true });
    writeFileSync(path.join(repo, ".github/pre-deploy-guard/scripts/scan-secrets.sh"), execFileSync("cat", [scanner], { encoding: "utf8" }), { mode: 0o755 });
    git(repo, "add", "--all");
    git(repo, "commit", "--quiet", "-m", "add scanner");
    const base = git(repo, "rev-parse", "HEAD");
    const marker = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
    writeFileSync(path.join(repo, "note.txt"), `${marker}\nsynthetic\n`);
    git(repo, "add", "--all");
    git(repo, "commit", "--quiet", "-m", "oops");
    const logs = mkdtempSync(path.join(tmpdir(), "certify-logs-"));
    roots.push(logs);
    const result = spawnSync("bash", [script, "--only", "secrets"], {
      env: { ...process.env, CERT_REPO: repo, CERT_LOG_DIR: logs, CERT_BASE: base },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}`).toMatch(/^secrets\s+FAIL/m);
    expect(`${result.stdout}`).toContain(`range   : ${base}..HEAD`);
  });
});
