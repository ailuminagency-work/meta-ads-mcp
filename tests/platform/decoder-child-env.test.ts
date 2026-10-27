import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeInstagramMp4 } from "../../src/platform/instagram-mp4-decoder.js";
import { decodeVerifiedMp4 } from "../../src/platform/mp4-decoder.js";

vi.setConfig({ testTimeout: 30000 });

const SENTINELS: Record<string, string> = {
  TOKEN_ENCRYPTION_KEY: "synthetic-encryption-key-not-real",
  META_APP_SECRET: "synthetic-app-secret-not-real",
  OAUTH_SECRET: "synthetic-oauth-secret-not-real",
  LUMIN_MEDIA_INGRESS_KEY_TEST: "synthetic-ingress-key-not-real",
  SOME_UNRELATED_SERVER_SETTING: "synthetic-value",
};
const SHELL_ONLY = new Set(["PATH", "PWD", "OLDPWD", "SHLVL", "_"]);

let dir: string;
let dump: string;
const saved: Record<string, string | undefined> = {};

function wrapper(name: "ffprobe" | "ffmpeg"): void {
  const real = execFileSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).trim();
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n{ echo "== ${name}"; env; } >> ${dump}\nexec ${real} "$@"\n`);
  chmodSync(file, 0o755);
}

function invocations(): Array<{ binary: string; env: Record<string, string> }> {
  const out: Array<{ binary: string; env: Record<string, string> }> = [];
  for (const block of readFileSync(dump, "utf8").split(/^== /m).filter(Boolean)) {
    const [binary, ...lines] = block.split("\n");
    const env: Record<string, string> = {};
    for (const line of lines) {
      const at = line.indexOf("=");
      if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
    }
    out.push({ binary, env });
  }
  return out;
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "decoder-env-"));
  dump = path.join(dir, "env.dump");
  wrapper("ffprobe");
  wrapper("ffmpeg");
  saved.PATH = process.env.PATH;
  process.env.PATH = `${dir}:${process.env.PATH}`;
  for (const [key, value] of Object.entries(SENTINELS)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

function expectMinimalEnvironment(seen: Array<{ binary: string; env: Record<string, string> }>, count: number): void {
  expect(seen.map((s) => s.binary)).toHaveLength(count);
  for (const { binary, env } of seen) {
    for (const key of Object.keys(SENTINELS)) expect(Object.hasOwn(env, key), `${binary} inherited ${key}`).toBe(false);
    expect(Object.keys(env).filter((key) => !SHELL_ONLY.has(key)), `${binary} environment`).toEqual([]);
    expect(env.PATH, `${binary} PATH`).toContain(dir);
  }
}

describe("hostile-media child processes get a minimal environment", () => {
  it("runs the standard MP4 decoder's ffprobe and ffmpeg with PATH only, and still decodes", async () => {
    const bytes = await readFile(new URL("../fixtures/video/standard-h264-320x240-1s.mp4", import.meta.url));
    writeFileSync(dump, "");
    const decoded = await decodeVerifiedMp4(bytes);
    expect(decoded).toMatchObject({ verified: true, width: 320, height: 240 });
    expectMinimalEnvironment(invocations(), 2);
  });

  it("runs the Instagram MP4 decoder's four child processes with PATH only, and still decodes", async () => {
    const bytes = await readFile(new URL("../fixtures/video/instagram-baseline-360x640-3s.mp4", import.meta.url));
    writeFileSync(dump, "");
    const decoded = await decodeInstagramMp4(bytes);
    expect(decoded).toMatchObject({ verified: true, closedGop: true });
    expectMinimalEnvironment(invocations(), 4);
  });
});
