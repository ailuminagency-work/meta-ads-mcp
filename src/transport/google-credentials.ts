import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function materializeGoogleCredentials(env: NodeJS.ProcessEnv = process.env): () => void {
  const raw = env.GOOGLE_CREDENTIALS_JSON;
  if (!raw) return () => {};
  if (env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error("Configure one Google credential source only");
  let parsed: { type?: unknown };
  try { parsed = JSON.parse(raw) as { type?: unknown }; }
  catch { throw new Error("GOOGLE_CREDENTIALS_JSON must be valid credential JSON"); }
  if (!parsed || (parsed.type !== "service_account" && parsed.type !== "external_account")) {
    throw new Error("Google credentials must use service_account or external_account type");
  }
  const directory = mkdtempSync(path.join(tmpdir(), "lumin-google-"));
  const file = path.join(directory, "credentials.json");
  writeFileSync(file, raw, { mode: 0o600, flag: "wx" });
  env.GOOGLE_APPLICATION_CREDENTIALS = file;
  delete env.GOOGLE_CREDENTIALS_JSON;
  return () => { rmSync(directory, { recursive: true, force: true }); };
}
