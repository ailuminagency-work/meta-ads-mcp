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
