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
