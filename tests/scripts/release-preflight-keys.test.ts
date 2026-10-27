import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseKeyringEnv } from "../../src/auth/keyring.js";

const script = path.resolve(__dirname, "../../scripts/release-preflight-keys.sh");

const synthetic = (label: string) => createHash("sha256").update(`synthetic-preflight-${label}`).digest("hex");
const KEY_A = synthetic("a");
const KEY_B = synthetic("b");
const KEY_C = synthetic("c");
const CUSTOM_ID = "ledger-2026";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function preflight(vars: Record<string, string>, cwd?: string) {
  const result = spawnSync("bash", [script], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...vars },
    cwd,
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const keyring = (activeKeyId: string, keys: Record<string, string>) => JSON.stringify({ activeKeyId, keys });
const line = (out: string, name: string) => out.split("\n").find((l) => l.includes(name)) ?? "";
const passes = (out: string, name: string) => line(out, name).startsWith("PASS");

describe("scripts/release-preflight-keys.sh", () => {
  it("prints usage and rejects unknown arguments", () => {
    const help = spawnSync("bash", [script, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage:");
    expect(spawnSync("bash", [script, "--bogus"], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("bash", [script, "--help", "extra"], { encoding: "utf8" }).status).toBe(2);
  });

  it("fails when no encryption variable is set at all", () => {
    const { code, out } = preflight({});
    expect(code).toBe(1);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEY\s+unset$/m);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEYRING_JSON\s+unset$/m);
    expect(out).toContain("FAIL  the release line accepts the keyring");
    expect(out).toContain("no encryption key is configured");
    expect(out).toContain("RESULT: FAIL");
  });

  it("passes the single-key configuration: only TOKEN_ENCRYPTION_KEY, active id primary", () => {
    const { code, out } = preflight({ TOKEN_ENCRYPTION_KEY: KEY_A });
    expect(code).toBe(0);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEY\s+set$/m);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEY_NEXT\s+unset$/m);
    expect(out).toMatch(/^keyring source\s+split variables$/m);
    expect(out).toContain("PASS  active encryption key id is primary");
    expect(out).toContain("RESULT: PASS");
  });

  it("fails the configuration production's variable names suggest: TOKEN_ENCRYPTION_KEY plus TOKEN_ENCRYPTION_KEY_NEXT", () => {
    const { code, out } = preflight({ TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: KEY_B });
    expect(code).toBe(1);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEY_NEXT\s+set$/m);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEY_NEXT_ID\s+unset$/m);
    expect(out).toContain("PASS  the release line accepts the keyring");
    expect(out).toContain("FAIL  active encryption key id is primary");
    expect(out).toContain("TOKEN_ENCRYPTION_KEY_NEXT is set, so the NEXT key becomes the active key");
    expect(out).toContain("FAIL  the active key is the key main@251249e reads");
    expect(out).toContain("RESULT: FAIL - 2 check(s) failed");
  });

  it("reports TOKEN_ENCRYPTION_KEY_NEXT_ID as set without printing the id", () => {
    const { code, out } = preflight({ TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: KEY_B, TOKEN_ENCRYPTION_KEY_NEXT_ID: CUSTOM_ID });
    expect(code).toBe(1);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEY_NEXT_ID\s+set$/m);
    expect(out).not.toContain(CUSTOM_ID);
  });

  it("notes that TOKEN_ENCRYPTION_KEY_NEXT_ID alone changes nothing", () => {
    const { code, out } = preflight({ TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT_ID: CUSTOM_ID });
    expect(code).toBe(0);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEY_NEXT_ID\s+set$/m);
    expect(out).toContain("WARN: TOKEN_ENCRYPTION_KEY_NEXT_ID is set without TOKEN_ENCRYPTION_KEY_NEXT");
  });

  it("passes the target shape: a JSON keyring whose active id is primary and whose primary is TOKEN_ENCRYPTION_KEY", () => {
    const { code, out } = preflight({
      TOKEN_ENCRYPTION_KEY: KEY_A,
      TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A, next: KEY_B }),
    });
    expect(code).toBe(0);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEYRING_JSON\s+set$/m);
    expect(out).toMatch(/^keyring source\s+TOKEN_ENCRYPTION_KEYRING_JSON/m);
    expect(out).toContain("2 key id(s) available for reads");
    expect(out).toContain("PASS  active encryption key id is primary");
    expect(out).toContain("PASS  the active key is the key main@251249e reads");
    expect(out).toContain("RESULT: PASS");
  });

  it("fails a JSON keyring whose active id is not primary, even though it parses", () => {
    const { code, out } = preflight({
      TOKEN_ENCRYPTION_KEY: KEY_A,
      TOKEN_ENCRYPTION_KEYRING_JSON: keyring("next", { primary: KEY_A, next: KEY_B }),
    });
    expect(code).toBe(1);
    expect(out).toContain("PASS  the release line accepts the keyring");
    expect(out).toContain("FAIL  active encryption key id is primary");
    expect(out).toContain("activeKeyId in TOKEN_ENCRYPTION_KEYRING_JSON is not primary");
  });

  it("fails a JSON keyring whose primary is not the key main reads, even though its active id is primary", () => {
    const { code, out } = preflight({
      TOKEN_ENCRYPTION_KEY: KEY_A,
      TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_B, next: KEY_C }),
    });
    expect(code).toBe(1);
    expect(out).toContain("PASS  active encryption key id is primary");
    expect(out).toContain("FAIL  the active key is the key main@251249e reads");
    expect(out).toContain("records written now would be unreadable by main@251249e");
  });

  it("fails a JSON keyring when TOKEN_ENCRYPTION_KEY is absent, because rollback would have no key", () => {
    const { code, out } = preflight({ TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A }) });
    expect(code).toBe(1);
    expect(out).toContain("FAIL  TOKEN_ENCRYPTION_KEY is set and 64 hex characters");
    expect(out).toContain("cannot compare: TOKEN_ENCRYPTION_KEY is missing or malformed");
  });

  it("warns, without failing, when the old split variables linger beside a valid JSON keyring", () => {
    const { code, out } = preflight({
      TOKEN_ENCRYPTION_KEY: KEY_A,
      TOKEN_ENCRYPTION_KEY_NEXT: KEY_B,
      TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A, next: KEY_B }),
    });
    expect(code).toBe(0);
    expect(out).toContain("WARN: TOKEN_ENCRYPTION_KEY_NEXT is set but ignored while TOKEN_ENCRYPTION_KEYRING_JSON is set");
  });

  it("treats an empty value like an unset one, as the application does", () => {
    const { code, out } = preflight({ TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: "   ", TOKEN_ENCRYPTION_KEYRING_JSON: "" });
    expect(code).toBe(0);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEY_NEXT\s+empty \(treated as unset\)$/m);
    expect(out).toMatch(/^TOKEN_ENCRYPTION_KEYRING_JSON\s+empty \(treated as unset\)$/m);
  });

  it.each([
    ["invalid JSON", "{ not json " + KEY_A],
    ["a JSON array", `["${KEY_A}"]`],
    ["no keys object", JSON.stringify({ activeKeyId: "primary" })],
    ["an active id that is not in keys", keyring("primary", { next: KEY_B })],
    ["a short key value", keyring("primary", { primary: KEY_A.slice(1) })],
    ["a non-hex key value", keyring("primary", { primary: "z".repeat(64) })],
    ["an invalid key id", keyring("primary", { primary: KEY_A, "bad id": KEY_B })],
  ])("fails closed on %s without echoing any of it", (_label, json) => {
    const { code, out } = preflight({ TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: json });
    expect(code).toBe(1);
    expect(out).toContain("FAIL  the release line accepts the keyring");
    expect(out).toContain("FAIL  active encryption key id is primary");
    expect(out).toContain("not evaluated: the keyring is not valid");
    expect(out).not.toContain(KEY_A);
    expect(out).not.toContain(KEY_B);
    expect(out).not.toContain("bad id");
  });

  it("fails a malformed TOKEN_ENCRYPTION_KEY without echoing it", () => {
    const { code, out } = preflight({ TOKEN_ENCRYPTION_KEY: "not-a-key-but-secret-shaped" });
    expect(code).toBe(1);
    expect(out).toContain("TOKEN_ENCRYPTION_KEY is not 64 hex characters");
    expect(out).not.toContain("secret-shaped");
  });

  it("never prints a key, a key id, a fingerprint or any 32-character hex run, in any outcome", () => {
    const cases: Record<string, string>[] = [
      { TOKEN_ENCRYPTION_KEY: KEY_A },
      { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: KEY_B, TOKEN_ENCRYPTION_KEY_NEXT_ID: CUSTOM_ID },
      { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_ID: CUSTOM_ID, TOKEN_ENCRYPTION_KEY_PREVIOUS: KEY_C, TOKEN_ENCRYPTION_KEY_PREVIOUS_ID: "older-id" },
      { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A, [CUSTOM_ID]: KEY_B }) },
      { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: keyring(CUSTOM_ID, { primary: KEY_A, [CUSTOM_ID]: KEY_B }) },
      { TOKEN_ENCRYPTION_KEY: KEY_A.toUpperCase(), TOKEN_ENCRYPTION_KEYRING_JSON: keyring(KEY_B, { [KEY_B]: KEY_C }) },
    ];
    const fingerprints = [KEY_A, KEY_B, KEY_C].map((k) => createHash("sha256").update(Buffer.from(k, "hex")).digest("hex").slice(0, 12));
    for (const vars of cases) {
      const { out } = preflight(vars);
      for (const secret of [KEY_A, KEY_B, KEY_C, KEY_A.toUpperCase(), CUSTOM_ID, "older-id", ...fingerprints]) {
        expect(out).not.toContain(secret);
      }
      expect(out).not.toMatch(/[0-9a-f]{32}/i);
    }
  });

  it("reads nothing from disk and writes nothing: an empty working directory stays empty", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "preflight-cwd-"));
    dirs.push(cwd);
    preflight({ TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: KEY_B }, cwd);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("contains no file, process or network access beyond starting node on its own program text", () => {
    const source = readFileSync(script, "utf8");
    for (const forbidden of [/\bcurl\b/, /\bwget\b/, /fetch\(/, /\brequire\(/, /\bimport\b/, /child_process/, /readFile|writeFile|appendFile|createWriteStream/, /https?:\/\//]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  describe("agrees with the application's own keyring parser", () => {
    const cases: Array<[string, Record<string, string>]> = [
      ["nothing set", {}],
      ["single key", { TOKEN_ENCRYPTION_KEY: KEY_A }],
      ["single key with surrounding whitespace", { TOKEN_ENCRYPTION_KEY: `  ${KEY_A}  ` }],
      ["single key in upper case", { TOKEN_ENCRYPTION_KEY: KEY_A.toUpperCase() }],
      ["key and next", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: KEY_B }],
      ["key and next with a custom next id", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: KEY_B, TOKEN_ENCRYPTION_KEY_NEXT_ID: CUSTOM_ID }],
      ["next id colliding with primary", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: KEY_B, TOKEN_ENCRYPTION_KEY_NEXT_ID: "primary" }],
      ["next renamed primary while the current key is renamed", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_ID: "old", TOKEN_ENCRYPTION_KEY_NEXT: KEY_B, TOKEN_ENCRYPTION_KEY_NEXT_ID: "primary" }],
      ["current key renamed", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_ID: "old" }],
      ["only next", { TOKEN_ENCRYPTION_KEY_NEXT: KEY_B }],
      ["previous key beside current", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_PREVIOUS: KEY_B }],
      ["previous key given the id primary (overwrites current in the application)", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_PREVIOUS: KEY_B, TOKEN_ENCRYPTION_KEY_PREVIOUS_ID: "primary" }],
      ["malformed key", { TOKEN_ENCRYPTION_KEY: "abc" }],
      ["invalid current key id", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_ID: "bad id" }],
      ["json primary", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A, next: KEY_B }) }],
      ["json primary, key in upper case", { TOKEN_ENCRYPTION_KEY: KEY_A.toUpperCase(), TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A, next: KEY_B }) }],
      ["json next", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: keyring("next", { primary: KEY_A, next: KEY_B }) }],
      ["json missing active", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { next: KEY_B }) }],
      ["json with a different primary", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_B }) }],
      ["json without TOKEN_ENCRYPTION_KEY", { TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A }) }],
      ["json with a short key", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A.slice(2) }) }],
      ["json with an invalid key id", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A, "bad id": KEY_B }) }],
      ["json that is not JSON", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEYRING_JSON: "{" }],
      ["json beside lingering split variables", { TOKEN_ENCRYPTION_KEY: KEY_A, TOKEN_ENCRYPTION_KEY_NEXT: KEY_B, TOKEN_ENCRYPTION_KEYRING_JSON: keyring("primary", { primary: KEY_A, next: KEY_B }) }],
    ];

    it.each(cases)("%s", (_label, vars) => {
      const appEnv = { NODE_ENV: "production", ...vars } as NodeJS.ProcessEnv;
      let app: { activeKeyId: string; keys: ReadonlyMap<string, Buffer> } | null = null;
      try {
        app = parseKeyringEnv(appEnv);
      } catch {
        app = null;
      }

      const { code, out } = preflight(vars);
      expect(passes(out, "the release line accepts the keyring")).toBe(app !== null);

      if (app === null) {
        expect(code).toBe(1);
        return;
      }
      expect(passes(out, "active encryption key id is primary")).toBe(app.activeKeyId === "primary");

      const mainKey = (vars.TOKEN_ENCRYPTION_KEY ?? "").trim();
      const mainKeyIsHex = /^[0-9a-fA-F]{64}$/.test(mainKey);
      const sameKeyInApp = mainKeyIsHex && app.keys.get(app.activeKeyId)!.equals(Buffer.from(mainKey, "hex"));
      expect(passes(out, "the active key is the key main@251249e reads")).toBe(sameKeyInApp);

      const expectedPass = mainKeyIsHex && app.activeKeyId === "primary" && sameKeyInApp;
      expect(code).toBe(expectedPass ? 0 : 1);
    });
  });
});
