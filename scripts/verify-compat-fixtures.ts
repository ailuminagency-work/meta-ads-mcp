#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface FixtureSet {
  name: string;
  ref: string;
  sources: string[];
}

const FIXTURE_ROOT = "tests/fixtures/crypto";

const SETS: FixtureSet[] = [
  {
    name: "main-251249e",
    ref: "251249e",
    sources: ["src/auth/crypto.ts", "src/store/meta-token-repo.ts"],
  },
  {
    name: "staging-1f08563",
    ref: "1f08563",
    sources: [
      "src/auth/crypto.ts",
      "src/auth/keyring.ts",
      "src/store/meta-token-repo.ts",
      "src/platform/client-asset-reassociation.ts",
      "src/platform/discovery-validation.ts",
      "src/platform/repository.ts",
      "src/platform/oauth.ts",
    ],
  },
];

const SPECIFIER = /((?:from\s+|import\s*\(\s*|import\s+)["'])(\.{1,2}\/[^"']+?)(\.js["'])/g;

function gitBlob(ref: string, file: string): string {
  return execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Specifiers that point at a module also extracted into the same set stay
 * relative to the set; everything else is repointed at the current tree so the
 * fixture composes with this line's unchanged modules.
 */
function rewrite(source: string, file: string, set: FixtureSet): string {
  const localModules = new Set(set.sources.map((entry) => entry.replace(/\.ts$/, "")));
  const fixtureDir = path.posix.join(FIXTURE_ROOT, set.name, path.posix.dirname(file).replace(/^src\/?/, ""));
  return source.replace(SPECIFIER, (_match, head: string, specifier: string, tail: string) => {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    if (localModules.has(resolved)) return `${head}${specifier}${tail}`;
    const target = path.posix.relative(fixtureDir, `${resolved}`);
    return `${head}${target.startsWith(".") ? target : `./${target}`}${tail}`;
  });
}

function expectedFixture(set: FixtureSet, file: string): { target: string; content: string } {
  const original = gitBlob(set.ref, file);
  const header = `// [fixture] git show ${set.ref}:${file} (blob sha256 ${sha256(original)}); only relative import specifiers of modules outside this set are repointed at the current tree.\n`;
  const target = path.posix.join(FIXTURE_ROOT, set.name, file.replace(/^src\//, ""));
  return { target, content: header + rewrite(original, file, set) };
}

function main(): void {
  const write = process.argv.includes("--write");
  let drift = 0;
  for (const set of SETS) {
    for (const file of set.sources) {
      const { target, content } = expectedFixture(set, file);
      const current = existsSync(target) ? readFileSync(target, "utf8") : null;
      if (current === content) {
        console.log(`OK     ${target}`);
        continue;
      }
      if (write) {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
        console.log(`WROTE  ${target}`);
      } else {
        drift++;
        console.log(`DRIFT  ${target}`);
      }
    }
  }
  if (drift > 0) process.exitCode = 2;
}

main();
