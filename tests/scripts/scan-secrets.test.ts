import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scanner = path.resolve(__dirname, "../../.github/pre-deploy-guard/scripts/scan-secrets.sh");
const dockerfile = path.resolve(__dirname, "../../Dockerfile");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scan(file: string, line: string) {
  const cwd = mkdtempSync(path.join(tmpdir(), "scan-secrets-"));
  dirs.push(cwd);
  const diff = `diff --git a/${file} b/${file}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+${line}\n`;
  const input = path.join(cwd, "input.diff");
  writeFileSync(input, diff);
  // The scanner reads a pipe or a regular file on stdin; a socket pair (what a piped `input` option gives) reads as empty.
  const fd = openSync(input, "r");
  try {
    const result = spawnSync("bash", [scanner], { stdio: [fd, "pipe", "pipe"], cwd, encoding: "utf8" });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    closeSync(fd);
  }
}

// Built at run time so this file never contains a token-shaped literal itself.
const apify = (length: number) => ["apify", "api", "Qz7k".repeat(8).slice(0, length)].join("_");

describe("local secret scanner covers the Apify token shape (G3-12)", () => {
  it("flags an Apify API token in an added line", () => {
    const { code, out } = scan("src/config.ts", `const token = "${apify(24)}";`);
    expect(code).toBe(1);
    expect(out).toContain("src/config.ts:1: apify-api-token");
  });

  it("flags it in an env-style assignment and in docs", () => {
    expect(scan("notes.md", `APIFY_TOKEN=${apify(32)}`).code).toBe(1);
    expect(scan("docs/ops.md", `Use ${apify(20)} for the actor`).code).toBe(1);
  });

  it("does not flag a prefix without a full token body", () => {
    expect(scan("src/config.ts", `const prefix = "${apify(19)}";`).code).toBe(0);
    expect(scan("src/config.ts", 'const prefix = "apify_api_";').code).toBe(0);
  });

  it("still flags the other shapes it already covered", () => {
    const meta = ["EAA", "Qz7k".repeat(6)].join("");
    expect(scan("src/config.ts", `const t = "${meta}";`).code).toBe(1);
  });
});

// Built at run time so this file never contains a token-shaped literal itself.
const metaToken = () => ["EAA", "Qz7k".repeat(6)].join("");

describe("line allowlist is a trailing marker or the matched text, never the whole line (G3R-05)", () => {
  it.each(["// PLACEHOLDER", "// fixture", "# EXAMPLE", "// placeholder", "/* YOUR_TOKEN */", "# <your-token>"])(
    "still flags a real token on a line that merely says %s",
    (comment) => {
      const { code, out } = scan("src/config.ts", `const t = "${metaToken()}"; ${comment}`);
      expect(code).toBe(1);
      expect(out).toContain("meta-access-token");
    },
  );

  it.each(["// gitleaks:allow", "# gitleaks:allow", "/* gitleaks:allow */", "-- gitleaks:allow", "<!-- gitleaks:allow -->", "//gitleaks:allow  "])(
    "skips a line that ends with the documented marker %j",
    (marker) => {
      expect(scan("src/config.ts", `const t = "${metaToken()}"; ${marker}`).code).toBe(0);
    },
  );

  it("does not accept the marker anywhere else on the line", () => {
    expect(scan("src/config.ts", `const note = "gitleaks:allow"; const t = "${metaToken()}";`).code).toBe(1);
    expect(scan("src/config.ts", `const t = "${metaToken()}"; // gitleaks:allow because the token is rotated`).code).toBe(1);
    expect(scan("src/config.ts", `const t = "${metaToken()}"; // gitleaks:allowed`).code).toBe(1);
  });

  it("skips a match whose own text is a known placeholder", () => {
    expect(scan("src/config.ts", `const t = "${["EAA", "EXAMPLE".repeat(4)].join("")}";`).code).toBe(0);
    expect(scan("src/config.ts", `const t = "${["EAA", "placeholder".repeat(3)].join("")}";`).code).toBe(0);
    expect(scan("docs/ops.md", "token EAAabcdefghij1234567890ABCDEFG").code).toBe(0);
  });
});

describe("path skips are repository-root files, not directory names (G3R-05)", () => {
  it.each([
    "src/secrets.lock",
    "deploy/.env.example",
    "docs/package-lock.json",
    "packages/app/yarn.lock",
    "x/pnpm-lock.yaml",
    "src/x/scan-secrets.sh",
    "config/.gitleaks.toml",
    "tests/evil/scan-secrets.sh",
    "vendor.lock",
  ])("scans %s", (file) => {
    const { code, out } = scan(file, `token = "${metaToken()}"`);
    expect(code).toBe(1);
    expect(out).toContain(`${file}:1: meta-access-token`);
  });

  it.each([".env.example"])("scans the root %s: a real value in a template is a finding", (file) => {
    expect(scan(file, `META_ACCESS_TOKEN=${metaToken()}`).code).toBe(1);
  });

  it.each(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".gitleaks.toml", ".github/pre-deploy-guard/scripts/scan-secrets.sh"])(
    "still skips the repository's own %s",
    (file) => {
      expect(scan(file, `token = "${metaToken()}"`).code).toBe(0);
    },
  );

  it("reports the repository's real .env.example clean as plain content", () => {
    const content = readFileSync(path.resolve(__dirname, "../../.env.example"), "utf8");
    const cwd = mkdtempSync(path.join(tmpdir(), "scan-secrets-"));
    dirs.push(cwd);
    const input = path.join(cwd, "env.example");
    writeFileSync(input, content);
    const fd = openSync(input, "r");
    try {
      const result = spawnSync("bash", [scanner], { stdio: [fd, "pipe", "pipe"], cwd, encoding: "utf8" });
      expect(`${result.stdout}${result.stderr}`).toBe("");
      expect(result.status).toBe(0);
    } finally {
      closeSync(fd);
    }
  });
});

function scanDiff(diff: string, timeout = 60_000) {
  const cwd = mkdtempSync(path.join(tmpdir(), "scan-secrets-"));
  dirs.push(cwd);
  const input = path.join(cwd, "input.diff");
  writeFileSync(input, diff);
  const fd = openSync(input, "r");
  try {
    const result = spawnSync("bash", [scanner], { stdio: [fd, "pipe", "pipe"], cwd, encoding: "utf8", timeout });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    closeSync(fd);
  }
}

/** The diff git writes for a new file: a name with a space gets a TAB at the end of its --- and +++ lines. */
function gitNewFileDiff(name: string, body: string): string {
  const tab = name.includes(" ") ? "\t" : "";
  return `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}${tab}\n@@ -0,0 +1 @@\n+${body}\n`;
}

describe("path skips match whole file names, whatever follows the name (G3D-05)", () => {
  it.each([
    "package-lock.json x",
    "package-lock.json.bak",
    "yarn.lock old",
    "pnpm-lock.yaml (copy)",
    ".gitleaks.toml backup",
    ".github/pre-deploy-guard/scripts/scan-secrets.sh copy",
    "package-lock.json b/package-lock.json",
    "package-lock.json  ",
  ])("scans a root file named %j", (name) => {
    const { code, out } = scanDiff(gitNewFileDiff(name, `token = "${metaToken()}"`));
    expect(code).toBe(1);
    expect(out).toContain(`${name}:1: meta-access-token`);
  });

  it.each(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".gitleaks.toml", ".github/pre-deploy-guard/scripts/scan-secrets.sh"])(
    "still skips the exact root file %s in the diff git writes",
    (name) => {
      expect(scanDiff(gitNewFileDiff(name, `token = "${metaToken()}"`)).code).toBe(0);
    },
  );

  it("reports a name with spaces whole, not cut at the first space", () => {
    const { out } = scanDiff(gitNewFileDiff("dir with space/file name.txt", `token = "${metaToken()}"`));
    expect(out).toContain("dir with space/file name.txt:1: meta-access-token");
  });

  it("reads the names from a real staged diff: exact skips, spaced names scanned", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "scan-secrets-git-"));
    dirs.push(cwd);
    const git = (...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
    expect(git("init", "-q", ".").status).toBe(0);
    const leaking = `token = "${metaToken()}"\n`;
    for (const name of ["package-lock.json", "package-lock.json x", "yarn.lock copy"]) writeFileSync(path.join(cwd, name), leaking);
    expect(git("add", "--", "package-lock.json", "package-lock.json x", "yarn.lock copy").status).toBe(0);

    const result = spawnSync("bash", [scanner], { stdio: ["ignore", "pipe", "pipe"], cwd, encoding: "utf8" });
    const out = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(1);
    expect(out).toContain("package-lock.json x:1: meta-access-token");
    expect(out).toContain("yarn.lock copy:1: meta-access-token");
    expect(out).not.toMatch(/^package-lock\.json:1:/m);
    expect(out).toContain("2 finding(s)");
  });

  it("attributes each added line to the file it belongs to when one diff holds several files", () => {
    const token = metaToken();
    const diff =
      gitNewFileDiff("package-lock.json", `token = "${token}"`) +
      gitNewFileDiff("src/next.ts", `token = "${token}"`) +
      gitNewFileDiff("yarn.lock", `token = "${token}"`);
    const { code, out } = scanDiff(diff);
    expect(code).toBe(1);
    expect(out).toContain("src/next.ts:1: meta-access-token");
    expect(out).not.toContain("package-lock.json:1");
    expect(out).not.toContain("yarn.lock:1");
  });
});

describe("a line of content that looks like a diff header cannot move the lines after it into a skipped file (G3D-05)", () => {
  it("keeps scanning after an added line whose text is '++ b/package-lock.json'", () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts\n--- /dev/null\n+++ b/src/x.ts\n@@ -0,0 +1,2 @@\n+++ b/package-lock.json\n+const t = "${metaToken()}";\n`;
    const { code, out } = scanDiff(diff);
    expect(code).toBe(1);
    expect(out).toContain("src/x.ts:2: meta-access-token");
  });

  it("keeps scanning after a removed line '-- a/yarn.lock' paired with an added '++ b/yarn.lock'", () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -3 +3,2 @@\n--- a/yarn.lock\n+++ b/yarn.lock\n+const t = "${metaToken()}";\n`;
    const { code, out } = scanDiff(diff);
    expect(code).toBe(1);
    expect(out).toContain("src/x.ts:4: meta-access-token");
  });

  it("keeps scanning after an added line that looks like a diff --git header", () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts\n--- /dev/null\n+++ b/src/x.ts\n@@ -0,0 +1,2 @@\n+diff --git a/package-lock.json b/package-lock.json\n+const t = "${metaToken()}";\n`;
    expect(scanDiff(diff).out).toContain("src/x.ts:2: meta-access-token");
  });

  it("counts context lines and the 'No newline' marker, so the line numbers stay right", () => {
    const diff =
      `diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -8,3 +8,4 @@\n one\n two\n-three\n\\ No newline at end of file\n+three\n+const t = "${metaToken()}";\n` +
      gitNewFileDiff("src/y.ts", `const t = "${metaToken()}";`);
    const { out } = scanDiff(diff);
    expect(out).toContain("src/x.ts:11: meta-access-token");
    expect(out).toContain("src/y.ts:1: meta-access-token");
  });

  it("still scans the added lines of a hunk whose counts understate its length", () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts\n--- /dev/null\n+++ b/src/x.ts\n@@ -0,0 +1 @@\n+const a = 1;\n+const t = "${metaToken()}";\n`;
    expect(scanDiff(diff).out).toContain("src/x.ts:2: meta-access-token");
  });
});

describe("the scan time grows with the findings, not with every added line (G3D-05)", () => {
  it("scans 1500 added lines and finds the one token at the end", () => {
    const lines = Array.from({ length: 1_500 }, (_, index) => `+const value${index} = compute(${index}, "ordinary text, nothing secret");`);
    lines.push(`+const t = "${metaToken()}";`);
    const diff = `diff --git a/src/big.ts b/src/big.ts\n--- /dev/null\n+++ b/src/big.ts\n@@ -0,0 +1,${lines.length} @@\n${lines.join("\n")}\n`;
    const started = Date.now();
    const { code, out } = scanDiff(diff, 40_000);
    expect(code).toBe(1);
    expect(out).toContain("src/big.ts:1501: meta-access-token");
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  it("reports a clean large diff clean", () => {
    const lines = Array.from({ length: 1_500 }, (_, index) => `+const value${index} = compute(${index});`);
    const diff = `diff --git a/src/big.ts b/src/big.ts\n--- /dev/null\n+++ b/src/big.ts\n@@ -0,0 +1,${lines.length} @@\n${lines.join("\n")}\n`;
    expect(scanDiff(diff, 40_000).code).toBe(0);
  }, 60_000);

  it("still finds every pattern after the prefilter: the shapes the scanner knows are all flagged", () => {
    const shapes = [
      metaToken(),
      apify(24),
      `META_APP_SECRET=${"Qz7k".repeat(5)}`,
      `OAUTH_SECRET=${"Qz7k".repeat(9)}`,
      `OAUTH_APPROVAL_PIN=${"Qz7k".repeat(2)}`,
      `TOKEN_ENCRYPTION_KEY=${"ab".repeat(32)}`,
      `SESSION_COOKIE_SECRET=${"Qz7k".repeat(9)}`,
      `MCP_API_KEY=${"Qz7k".repeat(6)}`,
      `GEMINI_API_KEY=${"Qz7k".repeat(6)}`,
      `ya29.${"Qz7k".repeat(9)}`,
      `AKIA${"QZ7K".repeat(4)}`,
      `ghp_${"Qz7k".repeat(10)}`,
      ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" "),
    ];
    for (const shape of shapes) expect(scan("src/shape.ts", `x = "${shape}"`).code, shape.slice(0, 12)).toBe(1);
  });
});

describe("runtime image sizes the libuv threadpool (G3-14)", () => {
  const text = readFileSync(dockerfile, "utf8");

  it("sets UV_THREADPOOL_SIZE=8 and explains why", () => {
    expect(text).toMatch(/^ENV UV_THREADPOOL_SIZE=8$/m);
    const comment = text.slice(0, text.indexOf("ENV UV_THREADPOOL_SIZE=8"));
    expect(comment.split("\n").slice(-6).join("\n")).toMatch(/dns\.lookup/i);
  });

  it("keeps the heap cap and the non-root user", () => {
    expect(text).toMatch(/^ENV NODE_OPTIONS=--max-old-space-size=512$/m);
    expect(text).toMatch(/^USER node$/m);
  });
});
