import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

describe("scripts/release-certify.sh test step (G3-05)", () => {
  const green = { numTotalTests: 100, numPassedTests: 100, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true };

  function shims(options: { json?: object | null; exit?: number; ffmpeg?: boolean } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "certify-shims-"));
    roots.push(dir);
    const log = path.join(dir, "calls.log");
    const program = (body: string) => `#!/usr/bin/env bash\n${body}\n`;
    writeFileSync(
      path.join(dir, "npm"),
      program(`echo "args: $*" >> "${log}"
echo "env: CI=$CI FFMPEG_REQUIRED=$FFMPEG_REQUIRED" >> "${log}"
out=""
for a in "$@"; do case "$a" in --outputFile.json=*) out="\${a#--outputFile.json=}";; esac; done
${options.exit ? `exit ${options.exit}` : ""}
${options.json === null ? "" : `[ -n "$out" ] && printf '%s' '${JSON.stringify(options.json ?? green)}' > "$out"`}
exit 0`),
    );
    chmodSync(path.join(dir, "npm"), 0o755);
    if (options.ffmpeg !== false) {
      for (const name of ["ffmpeg", "ffprobe"]) {
        writeFileSync(path.join(dir, name), program('echo "synthetic"'));
        chmodSync(path.join(dir, name), 0o755);
      }
    }
    return { dir, log };
  }

  function pathWithout(names: string[]): string {
    const dir = mkdtempSync(path.join(tmpdir(), "certify-path-"));
    roots.push(dir);
    for (const entry of (process.env.PATH ?? "").split(":")) {
      if (!entry || !existsSync(entry)) continue;
      for (const name of readdirSync(entry)) {
        if (names.includes(name) || existsSync(path.join(dir, name))) continue;
        try {
          symlinkSync(path.join(entry, name), path.join(dir, name));
        } catch {
          // an unreadable or duplicate entry cannot matter for the tools the script uses
        }
      }
    }
    return dir;
  }

  function certifyTests(repo: string, shim: { dir: string }, extraPath: string = process.env.PATH ?? "", ...args: string[]) {
    const logs = mkdtempSync(path.join(tmpdir(), "certify-logs-"));
    roots.push(logs);
    const result = spawnSync("bash", [script, "--only", "test", ...args], {
      env: { ...process.env, PATH: `${shim.dir}:${extraPath}`, CERT_REPO: repo, CERT_LOG_DIR: logs, CERT_BASE: "" },
      encoding: "utf8",
    });
    return { code: result.status, out: `${result.stdout}${result.stderr}`, logs };
  }

  const repo = () => makeRepo({ ".gitignore": cleanIgnore });

  it("runs the suite with FFMPEG_REQUIRED=1 and CI=1 and asks vitest for a machine-readable result", () => {
    const shim = shims();
    const { out } = certifyTests(repo(), shim);
    const calls = readFileSync(shim.log, "utf8");
    expect(calls).toContain("env: CI=1 FFMPEG_REQUIRED=1");
    expect(calls).toMatch(/args: test --silent -- .*--reporter=json .*--outputFile\.json=/);
    expect(out).toMatch(/^test\s+PASS/m);
  });

  it("passes only when nothing failed and nothing was skipped, and says how many tests ran", () => {
    const shim = shims();
    const { code, out, logs } = certifyTests(repo(), shim);
    expect(code).toBe(3);
    expect(out).toMatch(/^test\s+PASS/m);
    expect(readFileSync(path.join(logs, "test.log"), "utf8")).toContain("tests: total=100 passed=100 failed=0 skipped=0 todo=0");
  });

  it("fails when any test was skipped, and never prints CERTIFIED", () => {
    const shim = shims({ json: { ...green, numPassedTests: 93, numPendingTests: 7 } });
    const { code, out, logs } = certifyTests(repo(), shim);
    expect(code).toBe(1);
    expect(out).toMatch(/^test\s+FAIL/m);
    expect(out).not.toMatch(/RESULT\s+: CERTIFIED/);
    expect(out).toContain("NOT CERTIFIED - 1 step(s) failed");
    expect(readFileSync(path.join(logs, "test.log"), "utf8")).toContain("7 test(s) were skipped or marked todo");
  });

  it("fails when a test is marked todo", () => {
    const shim = shims({ json: { ...green, numPassedTests: 99, numTodoTests: 1 } });
    expect(certifyTests(repo(), shim).out).toMatch(/^test\s+FAIL/m);
  });

  it("fails when vitest reports a failure even though it exited 0", () => {
    const shim = shims({ json: { ...green, numPassedTests: 99, numFailedTests: 1, success: false } });
    expect(certifyTests(repo(), shim).out).toMatch(/^test\s+FAIL/m);
  });

  it("fails when vitest wrote no result, because nothing then proves that nothing was skipped", () => {
    const shim = shims({ json: null });
    const { out, logs } = certifyTests(repo(), shim);
    expect(out).toMatch(/^test\s+FAIL/m);
    expect(readFileSync(path.join(logs, "test.log"), "utf8")).toContain("wrote no result file");
  });

  it("fails when the result reports no tests at all", () => {
    const shim = shims({ json: { ...green, numTotalTests: 0, numPassedTests: 0 } });
    expect(certifyTests(repo(), shim).out).toMatch(/^test\s+FAIL/m);
  });

  it("fails when the suite itself fails", () => {
    const shim = shims({ exit: 1 });
    expect(certifyTests(repo(), shim).out).toMatch(/^test\s+FAIL/m);
  });

  it.each(["ffmpeg", "ffprobe"])("fails before running anything when %s is not on PATH", (missing) => {
    const shim = shims({ ffmpeg: false });
    const { out, logs } = certifyTests(repo(), shim, pathWithout(["ffmpeg", "ffprobe", missing]));
    expect(out).toMatch(/^test\s+FAIL/m);
    expect(readFileSync(path.join(logs, "test.log"), "utf8")).toContain("is not on PATH");
    expect(existsSync(path.join(shim.dir, "calls.log"))).toBe(false);
  });

  it("gives the full guard script the same FFMPEG_REQUIRED=1", () => {
    const target = repo();
    const scripts = path.join(target, ".github/pre-deploy-guard/scripts");
    mkdirSync(scripts, { recursive: true });
    const probe = path.join(target, "guard-env.txt");
    writeFileSync(path.join(scripts, "run-checks.sh"), `#!/usr/bin/env bash\necho "CI=$CI FFMPEG_REQUIRED=$FFMPEG_REQUIRED" > "${probe}"\n`, { mode: 0o755 });
    git(target, "add", "--all");
    git(target, "commit", "--quiet", "-m", "guard probe");
    const logs = mkdtempSync(path.join(tmpdir(), "certify-logs-"));
    roots.push(logs);
    spawnSync("bash", [script, "--only", "guard-full"], { env: { ...process.env, CERT_REPO: target, CERT_LOG_DIR: logs, CERT_BASE: "" }, encoding: "utf8" });
    expect(readFileSync(probe, "utf8").trim()).toBe("CI=1 FFMPEG_REQUIRED=1");
  });
});
